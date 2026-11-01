import { ORDER_STATUS } from './constants.js';
import { Dataset, getDataset, OrderRow } from './dataset.js';
import { autoBucket, Bucket, bucketKey, compareRange, enumerateBuckets, inRange, parseCompare, pctChange, resolveRange, vnParts } from './period.js';
import { costLines, getCostModel, getTopics } from './reports.service.js';
import { getInventoryFlows, InventoryFlows, LOSS_EXPORT_TYPES } from './inventory-flows.js';
import { getCollection } from '../../mongo.js';
import { CACHE_TTL, swr } from './cache.js';

/**
 * BẢNG PHÂN TÍCH — phục vụ quyết định kinh doanh (xu hướng, không phải số hằng ngày):
 *  1. Xu hướng doanh thu   2. Sản phẩm theo dịp tặng   3. Khách hàng
 *  4. Chi phí (dữ liệu có sẵn: giá vốn NVL, hao hụt, giảm giá, hoàn tiền, nhập NVL)   5. Hiệu quả vận hành
 * Mỗi khối trả kèm `reportKey` để FE dẫn sang báo cáo chi tiết tương ứng ở Danh sách báo cáo.
 */

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const VOID = [ORDER_STATUS.cancelled, ORDER_STATUS.refunded, ORDER_STATUS.refundAccepted, ORDER_STATUS.paymentFailed] as string[];

const kpi = (key: string, label: string, unit: string, value: number | null, previous: number | null) => ({
  key, label, unit, value, previous,
  change: value === null || previous === null ? null : unit === '%' ? Math.round((value - previous) * 10) / 10 : pctChange(value, previous),
});

const getReviews = () =>
  swr('reviews', { ttlMs: CACHE_TTL.heavyMs, maxStaleMs: CACHE_TTL.heavyMaxStaleMs }, async () =>
    (await getCollection<any>('DANH_GIA')).find({}).project({ DANH_GIA_ID: 1, SAN_PHAM_ID: 1, KHACH_HANG_ID: 1, SO_SAO: 1, NGAY_DANH_GIA: 1, NOI_DUNG: 1 }).toArray().catch(() => [] as any[]));

/** Số liệu của 1 kỳ (dùng cho kỳ này và kỳ so sánh). */
const periodFacts = (ds: Dataset, r: { from: Date; to: Date }, model: Awaited<ReturnType<typeof getCostModel>>, flows: InventoryFlows) => {
  const created = ds.orders.filter((o) => inRange(o.createdAt, r));
  const completed = ds.orders.filter((o) => o.status === ORDER_STATUS.completed && inRange(o.completedAt, r));
  const netRevenue = sum(completed, (o) => o.netRevenue);
  const discount = sum(completed, (o) => o.discount);
  const lines = costLines(ds, completed.map((o) => o.id), model);
  const known = lines.filter((l) => l.cost !== null);
  const goods = sum(lines, (l) => l.revenue);
  const coveredRevenue = sum(known, (l) => l.revenue);
  const cogs = sum(known, (l) => l.cost || 0);
  const losses = flows.exports.filter((x) => LOSS_EXPORT_TYPES.includes(x.type) && inRange(x.at, r));
  const purchases = flows.imports.filter((x) => inRange(x.at, r));
  const cash = ds.payments.filter((p) => p.success && !p.duplicateOf && inRange(p.paidAt, r));
  const refunded = created.filter((o) => o.status === ORDER_STATUS.refunded);
  return {
    created, completed, lines, netRevenue, discount, goods, coveredRevenue, cogs,
    grossProfit: coveredRevenue - cogs,
    coverage: pct(coveredRevenue, goods),
    lossCost: sum(losses, (x) => x.cost),
    losses,
    purchaseTotal: sum(purchases, (x) => x.total),
    purchases,
    cashCollected: sum(cash, (p) => p.amount),
    cash,
    refundAmount: sum(refunded, (o) => ds.paidByOrder.get(o.id) || 0),
    cancelled: created.filter((o) => o.status === ORDER_STATUS.cancelled),
    refundRequests: created.filter((o) => o.refundRequestedAt || [ORDER_STATUS.refundRequested, ORDER_STATUS.refundAccepted, ORDER_STATUS.refunded].includes(o.status as any)),
    paymentFailed: created.filter((o) => o.status === ORDER_STATUS.paymentFailed),
  };
};

/** Khách đã mua trước kỳ (để tách khách mới / quay lại). */
const firstOrderAt = (ds: Dataset) => {
  const m = new Map<string, Date>();
  ds.orders.forEach((o) => {
    if (!o.customerId || !o.createdAt || VOID.includes(o.status)) return;
    const cur = m.get(o.customerId);
    if (!cur || o.createdAt < cur) m.set(o.customerId, o.createdAt);
  });
  return m;
};

const groupRevenue = (ds: Dataset, lines: ReturnType<typeof costLines>, keyOf: (productId: string) => string) => {
  const m = new Map<string, { name: string; revenue: number; quantity: number; orders: Set<string>; cost: number; costComplete: boolean; products: Set<string> }>();
  lines.forEach((l) => {
    const name = keyOf(l.productId) || 'Chưa phân loại';
    const g = m.get(name) || { name, revenue: 0, quantity: 0, orders: new Set<string>(), cost: 0, costComplete: true, products: new Set<string>() };
    g.revenue += l.revenue; g.quantity += l.quantity; g.orders.add(l.orderId); g.products.add(l.productId);
    if (l.cost === null) g.costComplete = false; else g.cost += l.cost;
    m.set(name, g);
  });
  const total = sum([...m.values()], (g) => g.revenue);
  return [...m.values()].map((g) => ({
    name: g.name, revenue: g.revenue, quantity: g.quantity, orders: g.orders.size, products: g.products.size, share: pct(g.revenue, total),
    grossProfit: g.costComplete ? g.revenue - g.cost : null, margin: g.costComplete ? pct(g.revenue - g.cost, g.revenue) : null,
  })).sort((a, b) => b.revenue - a.revenue);
};

export const getAnalysis = async (query: any) => {
  const range = resolveRange(query);
  const compare = parseCompare(query.compare);
  const prev = compareRange(range, compare);
  const fresh = query.fresh === '1' || query.fresh === 'true';
  const groupBy = (['day', 'week', 'month', 'quarter', 'year'].includes(query.groupBy) ? query.groupBy : autoBucket(range)) as Bucket;

  const [ds, model, flows, topics, reviews] = await Promise.all([
    getDataset({ fresh }), getCostModel(fresh), getInventoryFlows({ fresh }), getTopics(), getReviews(),
  ]);
  const cur = periodFacts(ds, range, model, flows);
  const old = periodFacts(ds, prev, model, flows);
  const topicName = new Map(topics.map((t: any) => [String(t.CHU_DE_ID), String(t.TEN_CHU_DE)]));
  const product = (id: string) => ds.products.get(id);
  const topicOf = (id: string) => topicName.get(String(product(id)?.CHU_DE_ID)) || String(product(id)?.CHU_DE_ID || '');

  /* ---------- buckets dùng chung ---------- */
  const buckets = enumerateBuckets(range, groupBy);
  const prevBuckets = enumerateBuckets(prev, groupBy);
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  const pidx = new Map(prevBuckets.map((b, i) => [b.key, i]));
  const zeros = () => buckets.map(() => 0);
  const put = (arr: number[], map: Map<string, number>, d: Date | null, v: number) => {
    if (!d) return;
    const i = map.get(bucketKey(d, groupBy).key);
    if (i !== undefined && i < arr.length) arr[i] += v;
  };

  /* ================= 1. XU HƯỚNG DOANH THU ================= */
  const revCur = zeros(); const revPrev = zeros(); const ordCur = zeros(); const ordPrev = zeros(); const gpCur = zeros(); const cashCur = zeros();
  cur.completed.forEach((o) => { put(revCur, idx, o.completedAt, o.netRevenue); put(ordCur, idx, o.completedAt, 1); });
  old.completed.forEach((o) => { put(revPrev, pidx, o.completedAt, o.netRevenue); put(ordPrev, pidx, o.completedAt, 1); });
  cur.lines.forEach((l) => { if (l.cost !== null) put(gpCur, idx, ds.ordersById.get(l.orderId)?.completedAt || null, l.revenue - l.cost); });
  cur.cash.forEach((p) => put(cashCur, idx, p.paidAt, p.amount));

  const byWeekday = WEEKDAYS.map((label) => ({ label, revenue: 0, orders: 0 }));
  cur.completed.forEach((o) => { const w = vnParts(o.completedAt!).dow; byWeekday[w].revenue += o.netRevenue; byWeekday[w].orders++; });
  const weekdayOrdered = [...byWeekday.slice(1), byWeekday[0]]; // T2 → CN

  const aov = (f: typeof cur) => (f.completed.length ? Math.round(f.netRevenue / f.completed.length) : null);
  const revenue = {
    reportKey: 'sales-by-time',
    kpis: [
      kpi('netRevenue', 'Doanh thu thuần', 'đ', cur.netRevenue, old.netRevenue),
      kpi('grossProfit', 'Lợi nhuận gộp', 'đ', cur.grossProfit, old.grossProfit),
      kpi('grossMargin', 'Biên lợi nhuận gộp', '%', pct(cur.grossProfit, cur.coveredRevenue), pct(old.grossProfit, old.coveredRevenue)),
      kpi('completedOrders', 'Đơn hoàn thành', 'đơn', cur.completed.length, old.completed.length),
      kpi('avgOrderValue', 'Giá trị đơn TB', 'đ', aov(cur), aov(old)),
      kpi('cashCollected', 'Tiền đã thu', 'đ', cur.cashCollected, old.cashCollected),
    ],
    series: {
      labels: buckets.map((b) => b.label), prevLabels: prevBuckets.map((b) => b.label),
      netRevenue: revCur, netRevenuePrev: revPrev.length ? revPrev : zeros(), completedOrders: ordCur, completedOrdersPrev: ordPrev,
      grossProfit: gpCur, cashCollected: cashCur,
    },
    byWeekday: weekdayOrdered,
    coverage: cur.coverage,
  };

  /* ================= 2. SẢN PHẨM THEO DỊP TẶNG ================= */
  const byTopic = groupRevenue(ds, cur.lines, topicOf);
  const prevTopic = new Map(groupRevenue(ds, old.lines, topicOf).map((g) => [g.name, g.revenue]));
  const productMap = new Map<string, any>();
  cur.lines.forEach((l) => {
    const p = product(l.productId);
    const x = productMap.get(l.productId) || { productId: l.productId, name: p?.TEN_SAN_PHAM || l.productId, topic: topicOf(l.productId) || 'Chưa phân loại', style: p?.KIEU_DANG || '', quantity: 0, revenue: 0, cost: 0, costComplete: true, methods: new Set<string>() };
    x.quantity += l.quantity; x.revenue += l.revenue; x.methods.add(l.method);
    if (l.cost === null) x.costComplete = false; else x.cost += l.cost;
    productMap.set(l.productId, x);
  });
  const products = [...productMap.values()].map((x) => ({
    productId: x.productId, name: x.name, topic: x.topic, style: x.style, quantity: x.quantity, revenue: x.revenue,
    grossProfit: x.costComplete ? x.revenue - x.cost : null, margin: x.costComplete ? pct(x.revenue - x.cost, x.revenue) : null, costMethod: [...x.methods].join(' + '),
  })).sort((a, b) => b.revenue - a.revenue);
  const occasions = {
    reportKey: 'sales-by-occasion',
    byTopic: byTopic.map((g) => ({ ...g, previous: prevTopic.get(g.name) || 0, change: pctChange(g.revenue, prevTopic.get(g.name) || 0) })),
    byStyle: groupRevenue(ds, cur.lines, (id) => String(product(id)?.KIEU_DANG || '')),
    topProducts: products.slice(0, 10),
    // Ma trận dịp × kiểu dáng (doanh thu) để biết nên chuẩn bị mẫu nào cho dịp nào
    matrix: (() => {
      const topicsList = byTopic.slice(0, 6).map((t) => t.name);
      const styles = [...new Set(cur.lines.map((l) => String(product(l.productId)?.KIEU_DANG || 'Chưa phân loại')))].slice(0, 8);
      const cells = topicsList.map((t) => styles.map((s) => sum(cur.lines.filter((l) => (topicOf(l.productId) || 'Chưa phân loại') === t && String(product(l.productId)?.KIEU_DANG || 'Chưa phân loại') === s), (l) => l.revenue)));
      return { topics: topicsList, styles, cells };
    })(),
  };

  /* ================= 3. KHÁCH HÀNG ================= */
  const first = firstOrderAt(ds);
  const buyerStats = (f: typeof cur, r: { from: Date }) => {
    const m = new Map<string, { revenue: number; orders: number; last: Date | null }>();
    f.completed.forEach((o) => {
      if (!o.customerId) return;
      const x = m.get(o.customerId) || { revenue: 0, orders: 0, last: null };
      x.revenue += o.netRevenue; x.orders++; if (!x.last || (o.completedAt && o.completedAt > x.last)) x.last = o.completedAt;
      m.set(o.customerId, x);
    });
    const ids = [...m.keys()];
    const isNew = (id: string) => (first.get(id)?.getTime() || 0) >= r.from.getTime();
    const newIds = ids.filter(isNew);
    const guestRevenue = sum(f.completed.filter((o) => !o.customerId), (o) => o.netRevenue);
    return { m, ids, newIds, returningIds: ids.filter((i) => !isNew(i)), guestRevenue };
  };
  const bc = buyerStats(cur, range);
  const bo = buyerStats(old, prev);
  const newBuyersSeries = zeros(); const returningSeries = zeros();
  const seen = new Set<string>();
  [...cur.completed].sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime()).forEach((o) => {
    if (!o.customerId || seen.has(o.customerId)) return;
    seen.add(o.customerId);
    put((first.get(o.customerId)?.getTime() || 0) >= range.from.getTime() ? newBuyersSeries : returningSeries, idx, o.completedAt, 1);
  });
  const reviewsIn = reviews.filter((r: any) => inRange(new Date(r.NGAY_DANH_GIA), range));
  const reviewsPrev = reviews.filter((r: any) => inRange(new Date(r.NGAY_DANH_GIA), prev));
  const avgStars = (rows: any[]) => (rows.length ? Math.round((sum(rows, (r: any) => Number(r.SO_SAO || 0)) / rows.length) * 10) / 10 : null);
  const revNew = sum(bc.newIds, (i) => bc.m.get(i)!.revenue);
  const revRet = sum(bc.returningIds, (i) => bc.m.get(i)!.revenue);
  const customers = {
    reportKey: 'sales-by-customer',
    kpis: [
      kpi('buyers', 'Khách mua hàng', 'khách', bc.ids.length, bo.ids.length),
      kpi('newBuyers', 'Khách mua lần đầu', 'khách', bc.newIds.length, bo.newIds.length),
      kpi('returnRate', 'Tỷ lệ khách quay lại', '%', pct(bc.returningIds.length, bc.ids.length), pct(bo.returningIds.length, bo.ids.length)),
      kpi('revenuePerBuyer', 'Doanh thu / khách', 'đ', bc.ids.length ? Math.round(sum(bc.ids, (i) => bc.m.get(i)!.revenue) / bc.ids.length) : null, bo.ids.length ? Math.round(sum(bo.ids, (i) => bo.m.get(i)!.revenue) / bo.ids.length) : null),
      kpi('registrations', 'Tài khoản đăng ký mới', 'khách', ds.customers.filter((c) => inRange(c.registeredAt, range)).length, ds.customers.filter((c) => inRange(c.registeredAt, prev)).length),
      kpi('avgRating', 'Điểm đánh giá TB', '★', avgStars(reviewsIn), avgStars(reviewsPrev)),
    ],
    series: { labels: buckets.map((b) => b.label), newBuyers: newBuyersSeries, returningBuyers: returningSeries },
    revenueSplit: [
      { label: 'Khách mới', value: revNew },
      { label: 'Khách quay lại', value: revRet },
      { label: 'Khách vãng lai (không tài khoản)', value: bc.guestRevenue },
    ],
    topCustomers: bc.ids.map((id) => {
      const c = ds.customersById.get(id);
      const x = bc.m.get(id)!;
      return { customerId: id, name: c?.name || id, phone: c?.phone || '', orders: x.orders, revenue: x.revenue, lastOrderAt: x.last, type: bc.newIds.includes(id) ? 'Mới' : 'Quay lại' };
    }).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
    ratingDist: [5, 4, 3, 2, 1].map((stars) => ({ stars, count: reviewsIn.filter((r: any) => Number(r.SO_SAO) === stars).length })),
  };

  /* ================= 4. CHI PHÍ ================= */
  const cogsSeries = zeros(); const lossSeries = zeros(); const purchaseSeries = zeros();
  cur.lines.forEach((l) => { if (l.cost !== null) put(cogsSeries, idx, ds.ordersById.get(l.orderId)?.completedAt || null, l.cost); });
  cur.losses.forEach((x) => put(lossSeries, idx, x.at, x.cost));
  cur.purchases.forEach((x) => put(purchaseSeries, idx, x.at, x.total));
  const supplierTotals = new Map<string, number>();
  cur.purchases.forEach((x) => { const n = flows.suppliers.get(String(x.supplierId)) || 'Không rõ NCC'; supplierTotals.set(n, (supplierTotals.get(n) || 0) + x.total); });
  const lossByType = new Map<string, number>();
  cur.losses.forEach((x) => lossByType.set(x.type, (lossByType.get(x.type) || 0) + x.cost));
  const costs = {
    reportKey: 'business-result',
    // Báo cáo kết quả hoạt động kinh doanh rút gọn (chỉ phần dữ liệu hệ thống có)
    statement: [
      { key: 'gross', label: 'Doanh thu bán hàng (trước giảm giá)', value: cur.netRevenue + cur.discount, previous: old.netRevenue + old.discount, kind: 'income' },
      { key: 'discount', label: '(−) Giảm giá voucher / điểm thưởng', value: cur.discount, previous: old.discount, kind: 'cost' },
      { key: 'net', label: '= Doanh thu thuần', value: cur.netRevenue, previous: old.netRevenue, kind: 'result' },
      { key: 'cogs', label: '(−) Giá vốn NVL của hàng đã bán', value: cur.cogs, previous: old.cogs, kind: 'cost', note: `Phủ ${cur.coverage ?? 0}% doanh thu hàng` },
      { key: 'gp', label: '= Lợi nhuận gộp (phần đủ giá vốn)', value: cur.grossProfit, previous: old.grossProfit, kind: 'result' },
      { key: 'loss', label: '(−) Hao hụt / hủy NVL', value: cur.lossCost, previous: old.lossCost, kind: 'cost' },
      { key: 'afterLoss', label: '= Lợi nhuận sau hao hụt', value: cur.grossProfit - cur.lossCost, previous: old.grossProfit - old.lossCost, kind: 'result' },
    ].map((x) => ({ ...x, change: pctChange(x.value, x.previous) })),
    breakdown: [
      { label: 'Giá vốn NVL hàng bán', value: cur.cogs },
      { label: 'Giảm giá khuyến mãi', value: cur.discount },
      { label: 'Hao hụt / hủy NVL', value: cur.lossCost },
      { label: 'Tiền hoàn cho khách', value: cur.refundAmount },
    ],
    ratios: [
      kpi('cogsRatio', 'Giá vốn / doanh thu hàng', '%', pct(cur.cogs, cur.coveredRevenue), pct(old.cogs, old.coveredRevenue)),
      kpi('discountRatio', 'Giảm giá / doanh thu', '%', pct(cur.discount, cur.netRevenue + cur.discount), pct(old.discount, old.netRevenue + old.discount)),
      kpi('lossRatio', 'Hao hụt / tiền nhập NVL', '%', pct(cur.lossCost, cur.purchaseTotal), pct(old.lossCost, old.purchaseTotal)),
      kpi('purchases', 'Tiền nhập NVL', 'đ', cur.purchaseTotal, old.purchaseTotal),
    ],
    series: { labels: buckets.map((b) => b.label), revenue: revCur, cogs: cogsSeries, loss: lossSeries, purchases: purchaseSeries },
    bySupplier: [...supplierTotals.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6),
    lossByType: [...lossByType.entries()].map(([name, value]) => ({ name, value })),
    coverage: cur.coverage,
    note: 'Chi phí lấy từ dữ liệu sẵn có: giá vốn NVL (phiếu xuất / định mức BOM), phiếu xuất hao hụt – hủy – kiểm kê, giảm giá trên đơn và tiền đã thu của đơn đã hoàn. Chưa gồm chi phí vận hành (mặt bằng, lương…).',
  };

  /* ================= 5. HIỆU QUẢ VẬN HÀNH ================= */
  const explicitDone = cur.completed.filter((o) => !o.completedAtEstimated && o.createdAt);
  const leadHours = explicitDone.map((o) => (o.completedAt!.getTime() - o.createdAt!.getTime()) / 3_600_000).filter((h) => h >= 0);
  const onTime = explicitDone.filter((o) => o.deliveryEnd && o.completedAt!.getTime() <= o.deliveryEnd.getTime() + 30 * 60_000);
  const withDelivery = explicitDone.filter((o) => o.deliveryEnd);
  const deliveryHour = Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, '0')}h`, orders: 0 }));
  ds.orders.filter((o) => o.deliveryStart && inRange(o.deliveryStart, range) && !VOID.includes(o.status)).forEach((o) => { deliveryHour[vnParts(o.deliveryStart!).h].orders++; });
  const firstHour = deliveryHour.findIndex((h) => h.orders > 0);
  const lastHour = 23 - [...deliveryHour].reverse().findIndex((h) => h.orders > 0);
  const paidOrPartly = cur.created.filter((o) => (ds.paidByOrder.get(o.id) || 0) > 0);
  const inProgress = cur.created.filter((o) => [ORDER_STATUS.confirmed, ORDER_STATUS.preparing, ORDER_STATUS.waitingShip, ORDER_STATUS.shipping, ORDER_STATUS.delivered].includes(o.status as any));
  const doneOfCreated = cur.created.filter((o) => o.status === ORDER_STATUS.completed);
  const reasonMap = new Map<string, number>();
  cur.cancelled.forEach((o) => { const k = o.cancelReason || 'Không ghi lý do'; reasonMap.set(k, (reasonMap.get(k) || 0) + 1); });
  const methodMap = new Map<string, number>();
  cur.cash.forEach((p) => methodMap.set(p.method, (methodMap.get(p.method) || 0) + p.amount));
  const created = cur.created.length;
  const operations = {
    reportKey: 'orders-detail',
    kpis: [
      kpi('leadTime', 'Thời gian xử lý TB (giờ)', 'giờ', leadHours.length ? Math.round((sum(leadHours, (h) => h) / leadHours.length) * 10) / 10 : null, null),
      kpi('onTimeRate', 'Hoàn thành đúng hẹn', '%', pct(onTime.length, withDelivery.length), null),
      kpi('cancelRate', 'Tỷ lệ hủy', '%', pct(cur.cancelled.length, created), pct(old.cancelled.length, old.created.length)),
      kpi('refundRate', 'Tỷ lệ yêu cầu trả/hoàn', '%', pct(cur.refundRequests.length, created), pct(old.refundRequests.length, old.created.length)),
      kpi('paymentFailRate', 'Thanh toán thất bại', '%', pct(cur.paymentFailed.length, created), pct(old.paymentFailed.length, old.created.length)),
    ],
    sample: { explicitCompletions: explicitDone.length, totalCompletions: cur.completed.length },
    funnel: [
      { label: 'Đơn tạo trong kỳ', count: created },
      { label: 'Đã thanh toán / đặt cọc', count: paidOrPartly.length },
      { label: 'Đang xử lý / giao', count: inProgress.length + doneOfCreated.length },
      { label: 'Hoàn thành', count: doneOfCreated.length },
    ].map((x) => ({ ...x, rate: pct(x.count, created) })),
    statusBreakdown: [...cur.created.reduce((m, o) => m.set(o.status, (m.get(o.status) || 0) + 1), new Map<string, number>()).entries()]
      .map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    deliveryByHour: firstHour < 0 ? [] : deliveryHour.slice(firstHour, lastHour + 1),
    cancelReasons: [...reasonMap.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    paymentMethods: [...methodMap.entries()].map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
  };

  return {
    range: { ...range, previous: prev, compare },
    groupBy,
    generatedAt: ds.loadedAt,
    latestOrderAt: ds.orders.reduce<Date | null>((m, o: OrderRow) => (o.createdAt && (!m || o.createdAt > m) ? o.createdAt : m), null),
    revenue, occasions, customers, costs, operations,
  };
};
