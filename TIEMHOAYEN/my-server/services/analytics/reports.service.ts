import { getCollection } from '../../mongo.js';
import { ORDER_STATUS, ORDER_VOID_STATUSES } from './constants.js';
import { Dataset, getDataset, normalizeKey } from './dataset.js';
import { CACHE_TTL, swr } from './cache.js';
import { Bucket, bucketKey, enumerateBuckets, inRange, compareRange, parseCompare, resolveRange } from './period.js';
import { computeKpis, getProductImages, getSalesRequestCount } from './dashboard.service.js';
import { getActiveBomMap } from '../inventory/bom.service.js';
import { reconcileInventory } from '../inventory/stock.service.js';
import { ACTIVE_RESERVATION_STATUSES, EXPORT_TYPES, MATERIAL_GROUP } from '../inventory/constants.js';

/* =====================================================================
 * Giá vốn (AD60 pha 2) — 2 phương án, luôn ghi nhãn
 *  - "Thực tế": tổng giá vốn phiếu xuất "Làm hoa theo đơn" đã ghi nhận của đơn
 *  - "Định mức BOM": Σ định lượng × giá vốn hiện hành (hoa: nguồn nhập mới nhất; phụ kiện: BQ)
 *  - Không có BOM / thiếu giá → "Chưa đủ dữ liệu" (không tính 0)
 * ===================================================================== */

const buildCostModel = async () => {
  const [bomMap, materials, sources, exports] = await Promise.all([
    getActiveBomMap(),
    (await getCollection<any>('NGUYEN_VAT_LIEU')).find({}).project({ NGUYEN_VAT_LIEU_ID: 1, NHOM_NVL: 1, LOAI_NVL: 1, GIA_VON_BQ: 1, GIA_NHAP: 1 }).toArray(),
    (await getCollection<any>('CHI_TIET_PHIEU_NHAP_NVL')).aggregate([
      { $match: { LA_NGUON_NHAP: true } },
      { $sort: { THOI_DIEM_NHAN: -1 } },
      { $group: { _id: '$NGUYEN_VAT_LIEU_ID', cost: { $first: '$DON_GIA_VON' } } },
    ]).toArray(),
    (await getCollection<any>('PHIEU_XUAT_NVL')).find({ LOAI_XUAT: EXPORT_TYPES.order, TRANG_THAI: 'Đã ghi nhận' }).project({ DON_HANG_ID: 1, TONG_GIA_VON: 1 }).toArray(),
  ]);
  const latest = new Map(sources.map((s: any) => [s._id, Number(s.cost || 0)]));
  const unitCost = new Map<string, { cost: number; free: boolean }>();
  materials.forEach((m: any) => {
    const cost = m.NHOM_NVL === MATERIAL_GROUP.perishable ? latest.get(m.NGUYEN_VAT_LIEU_ID) || Number(m.GIA_NHAP || 0) : Number(m.GIA_VON_BQ || m.GIA_NHAP || 0);
    unitCost.set(m.NGUYEN_VAT_LIEU_ID, { cost, free: m.LOAI_NVL === 'Phụ liệu chung' });
  });
  /** Giá vốn định mức của 1 sản phẩm; null nếu không đủ dữ liệu. */
  const standardCost = new Map<string, { cost: number | null; note: string }>();
  const productStandard = (productId: string) => {
    if (standardCost.has(productId)) return standardCost.get(productId)!;
    const lines = bomMap.get(productId) || [];
    let result: { cost: number | null; note: string };
    if (!lines.length) result = { cost: null, note: 'Chưa có BOM' };
    else {
      let total = 0;
      let missing = 0;
      let freeZero = 0;
      lines.forEach((l) => {
        const u = unitCost.get(l.NGUYEN_VAT_LIEU_ID);
        if (!u || u.cost <= 0) { if (u?.free) freeZero++; else missing++; return; }
        total += u.cost * Number(l.DINH_LUONG || 0);
      });
      result = missing ? { cost: null, note: `Thiếu giá vốn ${missing} NVL` } : { cost: Math.round(total), note: freeZero ? 'Phụ liệu chung chưa định giá' : '' };
    }
    standardCost.set(productId, result);
    return result;
  };
  const actualByOrder = new Map<string, number>();
  exports.forEach((x: any) => actualByOrder.set(x.DON_HANG_ID, (actualByOrder.get(x.DON_HANG_ID) || 0) + Number(x.TONG_GIA_VON || 0)));
  return { productStandard, actualByOrder };
};

const getCostModel = (fresh = false) => swr('costModel', { ttlMs: CACHE_TTL.heavyMs, maxStaleMs: CACHE_TTL.heavyMaxStaleMs, fresh }, buildCostModel);
const getTopics = () =>
  swr('topics', { ttlMs: CACHE_TTL.heavyMs * 5, maxStaleMs: CACHE_TTL.heavyMaxStaleMs * 6 }, async () => (await getCollection<any>('CHU_DE')).find({}).toArray().catch(() => [] as any[]));

/** Làm nóng các cache phụ (gọi ngầm sau mỗi lượt quét thông báo) → lần mở Dashboard kế tiếp không phải chờ DB. */
export const warmAnalyticsCaches = () =>
  Promise.allSettled([getCostModel(), getTopics(), getSalesRequestCount(), getProductImages()]);

/** Giá vốn từng dòng đơn đã hoàn thành. */
const costLines = (ds: Dataset, orderIds: string[], model: Awaited<ReturnType<typeof buildCostModel>>) => {
  const out: { orderId: string; productId: string; quantity: number; revenue: number; cost: number | null; method: 'Thực tế (phiếu xuất)' | 'Định mức BOM' | 'Chưa đủ dữ liệu'; note: string }[] = [];
  orderIds.forEach((orderId) => {
    const lines = ds.detailsByOrder.get(orderId) || [];
    const actual = model.actualByOrder.get(orderId);
    const std = lines.map((l) => model.productStandard(l.productId));
    if (actual !== undefined && actual > 0) {
      // phân bổ giá vốn thực tế của đơn theo tỷ trọng giá vốn định mức (nếu thiếu thì theo doanh thu)
      const weights = std.every((s) => s.cost !== null) ? lines.map((l, i) => (std[i].cost || 0) * l.quantity) : lines.map((l) => l.amount);
      const sum = weights.reduce((s, w) => s + w, 0) || 1;
      lines.forEach((l, i) => out.push({ orderId, productId: l.productId, quantity: l.quantity, revenue: l.amount, cost: Math.round((actual * weights[i]) / sum), method: 'Thực tế (phiếu xuất)', note: '' }));
    } else {
      lines.forEach((l, i) => out.push({
        orderId, productId: l.productId, quantity: l.quantity, revenue: l.amount,
        cost: std[i].cost === null ? null : std[i].cost! * l.quantity,
        method: std[i].cost === null ? 'Chưa đủ dữ liệu' : 'Định mức BOM', note: std[i].note,
      }));
    }
  });
  return out;
};

/* =====================================================================
 * Báo cáo phân tích (AD04 + AD60)
 * ===================================================================== */

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

export const getAnalyticsReport = async (query: any) => {
  const range = resolveRange(query);
  const compare = parseCompare(query.compare);
  const prev = compareRange(range, compare);
  const groupBy = (['day', 'week', 'month', 'quarter', 'year'].includes(query.groupBy) ? query.groupBy : 'day') as Bucket;
  const fresh = query.fresh === '1' || query.fresh === 'true';
  const [ds, model, topics] = await Promise.all([
    getDataset({ fresh }),
    getCostModel(fresh),
    getTopics(),
  ]);

  const completedIds = ds.orders.filter((o) => o.status === ORDER_STATUS.completed && inRange(o.completedAt, range)).map((o) => o.id);
  const lines = costLines(ds, completedIds, model);

  // 1) Theo thời gian
  const buckets = enumerateBuckets(range, groupBy);
  const rowsByKey = new Map(buckets.map((b) => [b.key, {
    key: b.key, label: b.label, newOrders: 0, completedOrders: 0, cancelledOrders: 0, refundRequests: 0,
    netRevenue: 0, cashCollected: 0, cost: 0, costCoveredRevenue: 0,
  }]));
  const row = (d: Date | null) => (d ? rowsByKey.get(bucketKey(d, groupBy).key) : undefined);
  ds.orders.forEach((o) => {
    if (inRange(o.createdAt, range)) {
      const r = row(o.createdAt)!;
      if (r) {
        r.newOrders++;
        if (o.status === ORDER_STATUS.cancelled) r.cancelledOrders++;
        if (o.refundRequestedAt || [ORDER_STATUS.refundRequested, ORDER_STATUS.refundAccepted, ORDER_STATUS.refunded].includes(o.status as any)) r.refundRequests++;
      }
    }
    if (o.status === ORDER_STATUS.completed && inRange(o.completedAt, range)) {
      const r = row(o.completedAt);
      if (r) { r.completedOrders++; r.netRevenue += o.netRevenue; }
    }
  });
  ds.payments.forEach((p) => {
    if (p.success && !p.duplicateOf && inRange(p.paidAt, range)) { const r = row(p.paidAt); if (r) r.cashCollected += p.amount; }
  });
  lines.forEach((l) => {
    const o = ds.ordersById.get(l.orderId)!;
    const r = row(o.completedAt);
    if (r && l.cost !== null) { r.cost += l.cost; r.costCoveredRevenue += l.revenue; }
  });
  const periods = [...rowsByKey.values()].map((r) => ({
    ...r,
    avgOrderValue: r.completedOrders ? Math.round(r.netRevenue / r.completedOrders) : null,
    cancelRate: pct(r.cancelledOrders, r.newOrders),
    grossProfit: r.costCoveredRevenue ? r.costCoveredRevenue - r.cost : null,
  }));

  // 2) Theo sản phẩm
  const byProductMap = new Map<string, any>();
  lines.forEach((l) => {
    const p = ds.products.get(l.productId);
    const x = byProductMap.get(l.productId) || { productId: l.productId, name: p?.TEN_SAN_PHAM || l.productId, style: p?.KIEU_DANG || '', topicId: p?.CHU_DE_ID || '', quantity: 0, revenue: 0, orders: new Set(), cost: 0, costKnownRevenue: 0, methods: new Set<string>() };
    x.quantity += l.quantity; x.revenue += l.revenue; x.orders.add(l.orderId); x.methods.add(l.method);
    if (l.cost !== null) { x.cost += l.cost; x.costKnownRevenue += l.revenue; }
    byProductMap.set(l.productId, x);
  });
  const goodsRevenue = [...byProductMap.values()].reduce((s, x) => s + x.revenue, 0);
  const byProduct = [...byProductMap.values()].map((x) => ({
    productId: x.productId, name: x.name, style: x.style, quantity: x.quantity, orders: x.orders.size, revenue: x.revenue,
    share: pct(x.revenue, goodsRevenue),
    cost: x.costKnownRevenue === x.revenue ? x.cost : null,
    grossProfit: x.costKnownRevenue === x.revenue ? x.revenue - x.cost : null,
    margin: x.costKnownRevenue === x.revenue ? pct(x.revenue - x.cost, x.revenue) : null,
    costMethod: [...x.methods].join(' + '),
  })).sort((a, b) => b.revenue - a.revenue);

  // 3) Theo danh mục: chủ đề (CHU_DE) và kiểu dáng
  const topicName = new Map(topics.map((t: any) => [t.CHU_DE_ID, t.TEN_CHU_DE]));
  const group = (keyOf: (x: any) => string) => {
    const m = new Map<string, any>();
    byProduct.forEach((p) => {
      const key = keyOf(p) || 'Chưa phân loại';
      const g = m.get(key) || { name: key, products: 0, quantity: 0, revenue: 0, cost: 0, costComplete: true };
      g.products++; g.quantity += p.quantity; g.revenue += p.revenue;
      if (p.cost === null) g.costComplete = false; else g.cost += p.cost;
      m.set(key, g);
    });
    return [...m.values()].map((g) => ({ ...g, share: pct(g.revenue, goodsRevenue), grossProfit: g.costComplete ? g.revenue - g.cost : null, cost: g.costComplete ? g.cost : null })).sort((a, b) => b.revenue - a.revenue);
  };
  const productTopic = new Map([...ds.products.values()].map((p: any) => [p.SAN_PHAM_ID, p.CHU_DE_ID]));
  const byTopic = group((p) => topicName.get(productTopic.get(p.productId)) || productTopic.get(p.productId) || '');
  const byStyle = group((p) => p.style);

  // 4) Tiền đã thu theo phương thức
  const byMethodMap = new Map<string, { method: string; transactions: number; amount: number }>();
  ds.payments.filter((p) => p.success && !p.duplicateOf && inRange(p.paidAt, range)).forEach((p) => {
    const x = byMethodMap.get(p.method) || { method: p.method, transactions: 0, amount: 0 };
    x.transactions++; x.amount += p.amount; byMethodMap.set(p.method, x);
  });
  const byPaymentMethod = [...byMethodMap.values()].sort((a, b) => b.amount - a.amount);

  // 5) Lý do hủy (văn bản tự do → gom theo nội dung chuẩn hóa)
  const reasonMap = new Map<string, { reason: string; count: number }>();
  ds.orders.filter((o) => o.status === ORDER_STATUS.cancelled && inRange(o.createdAt, range)).forEach((o) => {
    const key = normalizeKey(o.cancelReason) || 'khong ghi ly do';
    const x = reasonMap.get(key) || { reason: o.cancelReason || 'Không ghi lý do', count: 0 };
    x.count++; reasonMap.set(key, x);
  });
  const cancelReasons = [...reasonMap.values()].sort((a, b) => b.count - a.count).slice(0, 15);

  // 6) Tổng hợp lợi nhuận
  const knownLines = lines.filter((l) => l.cost !== null);
  const profit = {
    goodsRevenue,
    costCoveredRevenue: knownLines.reduce((s, l) => s + l.revenue, 0),
    cost: knownLines.reduce((s, l) => s + (l.cost || 0), 0),
    grossProfit: knownLines.reduce((s, l) => s + l.revenue - (l.cost || 0), 0),
    coverage: pct(knownLines.reduce((s, l) => s + l.revenue, 0), goodsRevenue),
    linesByMethod: ['Thực tế (phiếu xuất)', 'Định mức BOM', 'Chưa đủ dữ liệu'].map((m) => ({ method: m, lines: lines.filter((l) => l.method === m).length })),
    note: 'Lợi nhuận gộp chỉ tính trên phần doanh thu có đủ giá vốn. Doanh thu hàng = Σ SL × giá dòng đơn (chưa trừ voucher/ship).',
  };

  return {
    range: { ...range, previous: prev, compare },
    groupBy,
    summary: { current: computeKpis(ds, range), previous: computeKpis(ds, prev) },
    periods,
    byProduct,
    byTopic,
    byStyle,
    byPaymentMethod,
    cancelReasons,
    profit,
    generatedAt: ds.loadedAt,
  };
};

/* =====================================================================
 * Đối chiếu đơn – tiền – kho
 * ===================================================================== */

/** Đối chiếu có cache (nặng nhất: quét sổ kho). fresh=true khi bấm Tải lại. */
export const getReconciliation = (opts: { fresh?: boolean; allowStale?: boolean } = {}) =>
  swr('reconciliation', { ttlMs: CACHE_TTL.heavyMs, maxStaleMs: CACHE_TTL.heavyMaxStaleMs, ...opts }, () => computeReconciliation(opts));

const computeReconciliation = async ({ fresh, allowStale }: { fresh?: boolean; allowStale?: boolean }) => {
  // Đọc song song mọi nguồn (trước đây tuần tự → nhiều vòng round-trip tới Atlas)
  const [ds, marker, bomMap, activeRes, rec] = await Promise.all([
    getDataset({ fresh, allowStale }),
    getCollection<any>('BO_DEM_MA').then((c) => c.findOne({ _id: 'migration:inventory-v1' as any })).catch(() => null),
    getActiveBomMap().catch(() => new Map<string, any[]>()),
    getCollection<any>('GIU_TON').then((c) => c.find({ TRANG_THAI: { $in: ACTIVE_RESERVATION_STATUSES }, DON_HANG_ID: { $ne: null } }).toArray()).catch(() => [] as any[]),
    reconcileInventory(false).catch(() => null), // kho chưa migrate → bỏ qua
  ]);
  const issues: { code: string; group: 'Tiền' | 'Kho' | 'Dữ liệu'; severity: 'Cao' | 'Trung bình' | 'Thấp'; title: string; hint: string; rows: any[] }[] = [];
  const add = (code: string, group: any, severity: any, title: string, hint: string, rows: any[]) => issues.push({ code, group, severity, title, hint, rows });
  const link = (id: string) => `/orders/order-detail/${encodeURIComponent(id)}`;

  // Tiền
  add('PAID_LESS', 'Tiền', 'Cao', 'Đơn hoàn thành nhưng tiền đã thu < tổng tiền',
    'Kiểm tra giao dịch COD / chuyển khoản còn thiếu chưa ghi nhận.',
    ds.orders.filter((o) => o.status === ORDER_STATUS.completed && (ds.paidByOrder.get(o.id) || 0) < o.total)
      .map((o) => ({ orderId: o.id, total: o.total, paid: ds.paidByOrder.get(o.id) || 0, diff: o.total - (ds.paidByOrder.get(o.id) || 0), link: link(o.id) })));
  add('PAID_MORE', 'Tiền', 'Trung bình', 'Tiền đã thu lớn hơn tổng tiền đơn', 'Có thể ghi nhận trùng hoặc cần hoàn tiền thừa.',
    ds.orders.filter((o) => (ds.paidByOrder.get(o.id) || 0) > o.total && o.total > 0)
      .map((o) => ({ orderId: o.id, total: o.total, paid: ds.paidByOrder.get(o.id) || 0, diff: (ds.paidByOrder.get(o.id) || 0) - o.total, link: link(o.id) })));
  add('PAID_BUT_VOID', 'Tiền', 'Cao', 'Đơn đã hủy / thất bại nhưng vẫn có tiền thu thành công', 'Cần lập hoàn tiền hoặc sửa trạng thái.',
    ds.orders.filter((o) => [ORDER_STATUS.cancelled, ORDER_STATUS.paymentFailed].includes(o.status as any) && (ds.paidByOrder.get(o.id) || 0) > 0)
      .map((o) => ({ orderId: o.id, status: o.status, paid: ds.paidByOrder.get(o.id) || 0, link: link(o.id) })));
  add('DUP_TRANSACTION', 'Tiền', 'Cao', 'Giao dịch thành công trùng mã giao dịch', 'Chỉ giao dịch đầu tiên được tính vào doanh thu/tiền đã thu.',
    ds.payments.filter((p) => p.duplicateOf).map((p) => ({ paymentId: p.id, duplicateOf: p.duplicateOf, orderId: p.orderId, transactionCode: p.transactionCode, amount: p.amount, link: link(p.orderId) })));
  add('PAYMENT_NO_ORDER', 'Dữ liệu', 'Trung bình', 'Giao dịch không gắn với đơn tồn tại', 'Kiểm tra mã đơn trên giao dịch.',
    ds.payments.filter((p) => !ds.ordersById.has(p.orderId)).map((p) => ({ paymentId: p.id, orderId: p.orderId, amount: p.amount, status: p.status })));

  // Dữ liệu
  add('NO_DETAILS', 'Dữ liệu', 'Trung bình', 'Đơn không có dòng sản phẩm', 'Không tính được sản phẩm bán chạy / giá vốn.',
    ds.orders.filter((o) => !(ds.detailsByOrder.get(o.id) || []).length).map((o) => ({ orderId: o.id, status: o.status, total: o.total, link: link(o.id) })));
  add('TOTAL_MISMATCH', 'Dữ liệu', 'Thấp', 'Tổng tiền đơn khác Σ dòng sản phẩm + ship (chênh > 1.000đ)', 'Có thể do voucher / điểm thưởng — kiểm tra lại cách lưu.',
    ds.orders.filter((o) => {
      const lines = ds.detailsByOrder.get(o.id) || [];
      if (!lines.length) return false;
      const sum = lines.reduce((s, l) => s + l.amount, 0) + o.shipping;
      return Math.abs(sum - o.total) > 1000 && !o.raw.DIEM_THUONG_SU_DUNG;
    }).map((o) => {
      const sum = (ds.detailsByOrder.get(o.id) || []).reduce((s, l) => s + l.amount, 0) + o.shipping;
      return { orderId: o.id, total: o.total, linesPlusShipping: sum, diff: o.total - sum, link: link(o.id) };
    }));
  add('NO_COMPLETION_DATE', 'Dữ liệu', 'Thấp', 'Đơn hoàn thành chưa có ngày hoàn thành (đang ước tính)', 'Chạy npm run analytics:migrate để ghi NGAY_HOAN_THANH ước tính; từ nay hệ thống tự ghi khi chuyển "Hoàn thành".',
    ds.orders.filter((o) => o.completedAtEstimated).map((o) => ({ orderId: o.id, estimatedAt: o.completedAt, link: link(o.id) })));

  // Kho
  const goLive: Date | null = marker?.at ? new Date(marker.at) : null;
  if (goLive) {
    add('NO_MATERIAL_ISSUE', 'Kho', 'Trung bình', 'Đơn đang giao/hoàn thành (sau ngày áp dụng kho mới) chưa có phiếu xuất NVL', 'Lập phiếu xuất "Làm hoa theo đơn" hoặc "Cắm bó sẵn" để tồn kho khớp.',
      ds.orders.filter((o) => [ORDER_STATUS.shipping, ORDER_STATUS.delivered, ORDER_STATUS.completed].includes(o.status as any) && o.createdAt && o.createdAt >= goLive && !o.materialIssued
        && (ds.detailsByOrder.get(o.id) || []).some((d) => (bomMap.get(d.productId) || []).length))
        .map((o) => ({ orderId: o.id, status: o.status, createdAt: o.createdAt, link: link(o.id) })));
  }
  add('VOID_WITH_RESERVATION', 'Kho', 'Cao', 'Đơn đã hủy / hoàn nhưng còn giữ tồn', 'Nhả giữ tồn để NVL quay lại khả dụng (Kho → Tổng quan → Đang giữ).',
    activeRes.filter((r: any) => ORDER_VOID_STATUSES.includes(ds.ordersById.get(r.DON_HANG_ID)?.status as any))
      .map((r: any) => ({ orderId: r.DON_HANG_ID, reservationId: r.MA_GIU_TON, item: r.NGUYEN_VAT_LIEU_ID || r.SAN_PHAM_ID, quantity: r.SO_LUONG, link: '/materials/stock' })));
  if (rec) {
    add('STOCK_LEDGER', 'Kho', 'Cao', 'Bộ đếm tồn lệch sổ biến động kho', 'Mở Kho → Tổng quan → Đối soát để xem chi tiết và sửa.',
      rec.diffs.map((d: any) => ({ kind: d.kind, id: d.id, name: d.name || '', counters: d.counters, ledger: d.ledger, link: '/materials/stock' })));
  }

  const filtered = issues.map((i) => ({ ...i, count: i.rows.length, rows: i.rows.slice(0, 100) }));
  return {
    generatedAt: ds.loadedAt,
    inventoryGoLive: goLive,
    totals: { issues: filtered.filter((i) => i.count > 0).length, rows: filtered.reduce((s, i) => s + i.count, 0) },
    issues: filtered.sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || ['Cao', 'Trung bình', 'Thấp'].indexOf(a.severity) - ['Cao', 'Trung bình', 'Thấp'].indexOf(b.severity)),
  };
};
