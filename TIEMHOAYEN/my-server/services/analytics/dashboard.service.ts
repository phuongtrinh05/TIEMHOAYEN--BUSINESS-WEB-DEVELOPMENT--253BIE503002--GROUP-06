import {
  ANALYTICS_CONFIG,
  ATTENTION_RULES,
  DELIVERY_ACTIVE_STATUSES,
  KPI_DICTIONARY,
  ORDER_FINAL_STATUSES,
  ORDER_STATUS,
  ORDER_VOID_STATUSES,
} from './constants.js';
import { Dataset, getDataset, OrderRow } from './dataset.js';
import { CACHE_TTL, swr } from './cache.js';
import { vnStartOfDay, autoBucket, bucketKey, Bucket, DateRange, enumerateBuckets, inRange, pctChange, compareRange, parseCompare, resolveRange } from './period.js';
import { getCollection } from '../../mongo.js';
import { getInventoryAlerts } from '../inventory/availability.service.js';

/* =====================================================================
 * KPI (D05) — tính cho 1 kỳ
 * ===================================================================== */

export const computeKpis = (ds: Dataset, r: { from: Date; to: Date }) => {
  const created = ds.orders.filter((o) => inRange(o.createdAt, r));
  const completed = ds.orders.filter((o) => o.status === ORDER_STATUS.completed && inRange(o.completedAt, r));
  const netRevenue = completed.reduce((s, o) => s + o.netRevenue, 0);
  const cashCollected = ds.payments.filter((p) => p.success && !p.duplicateOf && inRange(p.paidAt, r)).reduce((s, p) => s + p.amount, 0);
  const cancelled = created.filter((o) => o.status === ORDER_STATUS.cancelled).length;
  const refundRequests = created.filter((o) => o.refundRequestedAt || [ORDER_STATUS.refundRequested, ORDER_STATUS.refundAccepted, ORDER_STATUS.refunded].includes(o.status as any)).length;
  const itemsSold = completed.reduce((s, o) => s + (ds.detailsByOrder.get(o.id) || []).reduce((x, d) => x + d.quantity, 0), 0);
  return {
    netRevenue,
    cashCollected,
    newOrders: created.length,
    completedOrders: completed.length,
    avgOrderValue: completed.length ? Math.round(netRevenue / completed.length) : null,
    cancelRate: created.length ? Math.round((cancelled / created.length) * 1000) / 10 : null,
    cancelledOrders: cancelled,
    refundRequestRate: created.length ? Math.round((refundRequests / created.length) * 1000) / 10 : null,
    refundRequests,
    newCustomers: ds.customers.filter((c) => inRange(c.registeredAt, r)).length,
    itemsSold,
    estimatedCompletionDates: completed.filter((o) => o.completedAtEstimated).length,
  };
};

/* =====================================================================
 * Nguồn phụ có cache (đọc song song với bộ dữ liệu chính)
 * ===================================================================== */

/** Cảnh báo kho (dùng chung Dashboard + bộ quét thông báo). */
export const getCachedInventoryAlerts = (opts: { fresh?: boolean; allowStale?: boolean } = {}) =>
  swr('inventoryAlerts', { ttlMs: CACHE_TTL.heavyMs, maxStaleMs: CACHE_TTL.heavyMaxStaleMs, ...opts }, () => getInventoryAlerts()).catch(() => null);

export const getSalesRequestCount = (fresh = false) =>
  swr('salesRequestCount', { ttlMs: CACHE_TTL.datasetMs, maxStaleMs: CACHE_TTL.datasetMaxStaleMs, fresh }, async () =>
    (await getCollection<any>('YEU_CAU_DAT_HANG')).countDocuments({ status: { $in: ['Chờ Sales tiếp nhận', 'Sales đang xử lý', 'Khách đã đồng ý'] } }).catch(() => 0));

/** Ảnh chính của mọi sản phẩm (ít thay đổi) → không phải query lại mỗi lần xem top sản phẩm. */
export const getProductImages = () =>
  swr('productImages', { ttlMs: CACHE_TTL.heavyMs * 5, maxStaleMs: CACHE_TTL.heavyMaxStaleMs * 6 }, async () => {
    const rows = await (await getCollection<any>('HINH_ANH_SAN_PHAM')).find({}).project({ SAN_PHAM_ID: 1, URL: 1, URL_HINH_ANH: 1, LA_ANH_CHINH: 1 }).toArray().catch(() => []);
    const map = new Map<string, string>();
    rows
      .sort((a: any, b: any) => Number(b.LA_ANH_CHINH || 0) - Number(a.LA_ANH_CHINH || 0))
      .forEach((im: any) => { const id = String(im.SAN_PHAM_ID); if (!map.has(id) && (im.URL || im.URL_HINH_ANH)) map.set(id, im.URL || im.URL_HINH_ANH); });
    return map;
  });

/** K05 — tiền cọc/đã thu của đơn chưa hoàn thành, chưa hủy/hoàn (tại thời điểm xem). */
export const computeDepositHeld = (ds: Dataset) => {
  let amount = 0;
  let orders = 0;
  ds.orders.forEach((o) => {
    if (o.status === ORDER_STATUS.completed || ORDER_VOID_STATUSES.includes(o.status as any)) return;
    const paid = ds.paidByOrder.get(o.id) || 0;
    if (paid > 0) { amount += paid; orders++; }
  });
  return { amount, orders };
};

/* =====================================================================
 * Chuỗi biểu đồ: kỳ này vs kỳ trước, căn theo vị trí bucket
 * ===================================================================== */

export const computeSeries = (ds: Dataset, r: DateRange, prev: DateRange, bucket: Bucket) => {
  const build = (range: { from: Date; to: Date }) => {
    const buckets = enumerateBuckets(range, bucket);
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    const revenue = buckets.map(() => 0);
    const orders = buckets.map(() => 0);
    const cash = buckets.map(() => 0);
    ds.orders.forEach((o) => {
      if (o.status === ORDER_STATUS.completed && inRange(o.completedAt, range)) {
        const i = idx.get(bucketKey(o.completedAt!, bucket).key);
        if (i !== undefined) revenue[i] += o.netRevenue;
      }
      if (inRange(o.createdAt, range)) {
        const i = idx.get(bucketKey(o.createdAt!, bucket).key);
        if (i !== undefined) orders[i] += 1;
      }
    });
    ds.payments.forEach((p) => {
      if (!p.success || p.duplicateOf || !inRange(p.paidAt, range)) return;
      const i = idx.get(bucketKey(p.paidAt!, bucket).key);
      if (i !== undefined) cash[i] += p.amount;
    });
    return { labels: buckets.map((b) => b.label), revenue, orders, cash };
  };
  const current = build(r);
  const previous = build(prev);
  return { bucket, labels: current.labels, current, previous };
};

/* =====================================================================
 * Cần xử lý (kiểu Haravan) — snapshot hiện tại
 * ===================================================================== */

export const computeNeedAction = async (ds: Dataset, salesRequests?: number) => {
  const count = (s: string) => ds.orders.filter((o) => o.status === s).length;
  const requests = salesRequests ?? (await getSalesRequestCount());
  return [
    { key: 'waitingPayment', label: 'Chờ thanh toán', count: count(ORDER_STATUS.waitingPayment), link: '/orders/order-list', status: ORDER_STATUS.waitingPayment },
    { key: 'pending', label: 'Chờ xử lý', count: count(ORDER_STATUS.pending) + count(ORDER_STATUS.confirmed), link: '/orders/order-list', status: ORDER_STATUS.pending },
    { key: 'preparing', label: 'Đang chuẩn bị', count: count(ORDER_STATUS.preparing), link: '/orders/order-list', status: ORDER_STATUS.preparing },
    { key: 'shipping', label: 'Chờ / đang giao', count: count(ORDER_STATUS.waitingShip) + count(ORDER_STATUS.shipping), link: '/orders/order-list', status: ORDER_STATUS.shipping },
    { key: 'salesRequests', label: 'Yêu cầu đặt hàng (Sales)', count: requests, link: '/orders/requests', status: null },
    { key: 'refunds', label: 'Yêu cầu trả / hoàn', count: count(ORDER_STATUS.refundRequested), link: '/orders/order-list', status: ORDER_STATUS.refundRequested },
  ];
};

/* =====================================================================
 * AD05 — Lịch giao trong N phút tới (màu theo mức gấp)
 * ===================================================================== */

export const urgencyOf = (minutesLeft: number) => {
  if (minutesLeft <= ANALYTICS_CONFIG.deliveryRedMinutes) return minutesLeft < 0 ? 'overdue' : 'red';
  if (minutesLeft <= ANALYTICS_CONFIG.deliveryOrangeMinutes) return 'orange';
  return 'green';
};

export const computeDeliveries = (ds: Dataset, mode: 'window' | 'today' = 'window', now = new Date()) => {
  const windowEnd = new Date(now.getTime() + ANALYTICS_CONFIG.deliveryWindowMinutes * 60_000);
  const todayEnd = new Date(vnStartOfDay(now).getTime() + 86_400_000);
  const limit = mode === 'today' ? todayEnd : windowEnd;
  return ds.orders
    .filter((o) => DELIVERY_ACTIVE_STATUSES.includes(o.status as any) && o.deliveryStart)
    // quá giờ (trong 24h qua, chưa giao xong) hoặc sắp tới trong cửa sổ
    .filter((o) => o.deliveryStart!.getTime() <= limit.getTime() && (o.deliveryEnd || o.deliveryStart)!.getTime() >= now.getTime() - 24 * 3_600_000)
    .map((o) => {
      const minutesLeft = Math.round((o.deliveryStart!.getTime() - now.getTime()) / 60_000);
      const items = (ds.detailsByOrder.get(o.id) || []).map((d) => ({ productId: d.productId, name: ds.products.get(d.productId)?.TEN_SAN_PHAM || d.productId, quantity: d.quantity }));
      return {
        orderId: o.id, status: o.status, deliveryAt: o.deliveryStart, slot: o.deliverySlot, minutesLeft,
        urgency: urgencyOf(minutesLeft), recipient: o.recipient, address: o.address, total: o.total, items,
        link: `/orders/order-detail/${encodeURIComponent(o.id)}`,
      };
    })
    .sort((a, b) => a.minutesLeft - b.minutesLeft);
};

/* =====================================================================
 * AD06 — Đơn cần chú ý (K20, thỏa ≥ 1 tiêu chí)
 * ===================================================================== */

export const computeAttentionOrders = (ds: Dataset, forecastShortageOrders: Set<string>, now = new Date()) => {
  const out: any[] = [];
  ds.orders.forEach((o) => {
    if (ORDER_FINAL_STATUSES.includes(o.status as any) && o.status !== ORDER_STATUS.paymentFailed) return;
    const reasons: { code: string; label: string; detail: string }[] = [];
    const ageMin = o.createdAt ? (now.getTime() - o.createdAt.getTime()) / 60_000 : 0;
    if ([ORDER_STATUS.pending, ORDER_STATUS.confirmed].includes(o.status as any) && ageMin > ANALYTICS_CONFIG.pendingTooLongMinutes) {
      reasons.push({ code: 'pendingTooLong', label: ATTENTION_RULES.pendingTooLong, detail: `Đã chờ ${formatDuration(ageMin)}` });
    }
    if (o.status === ORDER_STATUS.paymentFailed && ageMin < ANALYTICS_CONFIG.notificationLookbackDays * 1440) {
      reasons.push({ code: 'paymentFailed', label: ATTENTION_RULES.paymentFailed, detail: 'Liên hệ khách thanh toán lại hoặc hủy' });
    }
    if (o.deliveryStart && [ORDER_STATUS.pending, ORDER_STATUS.confirmed, ORDER_STATUS.preparing, ORDER_STATUS.waitingShip].includes(o.status as any)) {
      const left = (o.deliveryStart.getTime() - now.getTime()) / 60_000;
      if (left <= ANALYTICS_CONFIG.deliveryOrangeMinutes && (o.deliveryEnd || o.deliveryStart).getTime() > now.getTime() - 7 * 86_400_000) {
        reasons.push({ code: 'deliveryAtRisk', label: ATTENTION_RULES.deliveryAtRisk, detail: left < 0 ? `Quá giờ giao ${formatDuration(-left)}` : `Còn ${Math.round(left)} phút, đang "${o.status}"` });
      }
    }
    if (o.status === ORDER_STATUS.refundRequested) {
      reasons.push({ code: 'refundRequest', label: ATTENTION_RULES.refundRequest, detail: String(o.raw.LY_DO_HOAN_TIEN_TRA_HANG || 'Chưa xử lý') });
    }
    if (forecastShortageOrders.has(o.id)) {
      reasons.push({ code: 'stockRisk', label: ATTENTION_RULES.stockRisk, detail: 'Dự báo thiếu NVL trước lịch chuẩn bị T' });
    } else if (o.deliveryStart && !o.prepStartAt && !o.materialIssued && [ORDER_STATUS.pending, ORDER_STATUS.confirmed, ORDER_STATUS.preparing].includes(o.status as any)) {
      const hours = (o.deliveryStart.getTime() - now.getTime()) / 3_600_000;
      if (hours >= 0 && hours <= ANALYTICS_CONFIG.missingPrepHours) {
        reasons.push({ code: 'stockRisk', label: ATTENTION_RULES.stockRisk, detail: `Giao trong ${Math.round(hours)} giờ nhưng chưa nhập thời điểm chuẩn bị T` });
      }
    }
    if (reasons.length) {
      out.push({
        orderId: o.id, status: o.status, createdAt: o.createdAt, deliveryAt: o.deliveryStart, total: o.total,
        paid: ds.paidByOrder.get(o.id) || 0, customerId: o.customerId, recipient: o.recipient, reasons,
        link: `/orders/order-detail/${encodeURIComponent(o.id)}`,
      });
    }
  });
  const weight = (x: any) => Math.min(...x.reasons.map((r: any) => Object.keys(ATTENTION_RULES).indexOf(r.code)));
  return out.sort((a, b) => (a.deliveryAt && b.deliveryAt ? new Date(a.deliveryAt).getTime() - new Date(b.deliveryAt).getTime() : weight(a) - weight(b)));
};

const formatDuration = (minutes: number) => {
  const m = Math.round(minutes);
  if (m < 60) return `${m} phút`;
  if (m < 1440) return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
  return `${Math.floor(m / 1440)} ngày`;
};

/* =====================================================================
 * AD07 — Sản phẩm bán chạy (chỉ đơn Hoàn thành, theo ngày hoàn thành)
 * ===================================================================== */

export const computeBestProducts = async (ds: Dataset, r: { from: Date; to: Date }, sort: 'quantity' | 'revenue' = 'quantity', limit = 5) => {
  const stats = new Map<string, { productId: string; quantity: number; revenue: number; orders: Set<string> }>();
  ds.orders.filter((o) => o.status === ORDER_STATUS.completed && inRange(o.completedAt, r)).forEach((o) => {
    (ds.detailsByOrder.get(o.id) || []).forEach((d) => {
      const s = stats.get(d.productId) || { productId: d.productId, quantity: 0, revenue: 0, orders: new Set<string>() };
      s.quantity += d.quantity;
      s.revenue += d.amount;
      s.orders.add(o.id);
      stats.set(d.productId, s);
    });
  });
  const totalRevenue = [...stats.values()].reduce((s, x) => s + x.revenue, 0);
  const rows = [...stats.values()]
    .sort((a, b) => (sort === 'revenue' ? b.revenue - a.revenue || b.quantity - a.quantity : b.quantity - a.quantity || b.revenue - a.revenue))
    .slice(0, limit);
  const images = await getProductImages();
  return rows.map((x, i) => {
    const p = ds.products.get(x.productId);
    return {
      rank: i + 1, productId: x.productId, name: p?.TEN_SAN_PHAM || x.productId, style: p?.KIEU_DANG || '', status: p?.TRANG_THAI || '',
      quantity: x.quantity, revenue: x.revenue, orders: x.orders.size, share: totalRevenue ? Math.round((x.revenue / totalRevenue) * 1000) / 10 : 0,
      image: images.get(x.productId) || '', link: `/products/product-detail?id=${encodeURIComponent(x.productId)}`,
    };
  });
};

/* =====================================================================
 * Tổng quan (AD02) — một API, một bộ lọc chung
 * ===================================================================== */

export const getDashboardOverview = async (query: any) => {
  const range = resolveRange(query);
  const compare = parseCompare(query.compare);
  const prev = compareRange(range, compare);
  const fresh = query.fresh === '1' || query.fresh === 'true';
  // Đọc song song: bộ dữ liệu chính + cảnh báo kho + số yêu cầu Sales (đều có cache)
  const [ds, alerts, salesRequests] = await Promise.all([getDataset({ fresh }), getCachedInventoryAlerts({ fresh }), getSalesRequestCount(fresh)]);
  const cur = computeKpis(ds, range);
  const old = computeKpis(ds, prev);
  const deposit = computeDepositHeld(ds);
  const kpis = KPI_DICTIONARY.filter((k) => k.key !== 'grossProfit').map((k) => {
    if (k.key === 'depositHeld') return { ...k, value: deposit.amount, previous: null, change: null, extra: `${deposit.orders} đơn` };
    const value = (cur as any)[k.key];
    const previous = (old as any)[k.key];
    const change = value === null || previous === null ? null : k.unit === '%' ? Math.round((value - previous) * 10) / 10 : pctChange(value, previous);
    return { ...k, value, previous, change };
  });

  const shortageOrders = new Set<string>((alerts?.forecastShortages || []).map((f: any) => f.orderId));

  return {
    range: { ...range, previous: prev, compare },
    generatedAt: ds.loadedAt,
    kpis,
    dataQuality: { estimatedCompletionDates: cur.estimatedCompletionDates },
    // Kỳ đang xem trống → FE gợi ý nhảy tới thời điểm có đơn gần nhất
    latestOrderAt: ds.orders.reduce<Date | null>((m, o) => (o.createdAt && (!m || o.createdAt > m) ? o.createdAt : m), null),
    series: computeSeries(ds, range, prev, autoBucket(range)),
    needAction: await computeNeedAction(ds, salesRequests),
    deliveries: computeDeliveries(ds, query.deliveryMode === 'today' ? 'today' : 'window'),
    attentionOrders: computeAttentionOrders(ds, shortageOrders).slice(0, 50),
    bestProducts: await computeBestProducts(ds, range, query.bestSort === 'revenue' ? 'revenue' : 'quantity', 5),
    inventory: alerts ? {
      summary: alerts.summary,
      materials: alerts.materialAlerts.slice(0, 6),
    } : null,
    config: {
      deliveryRedMinutes: ANALYTICS_CONFIG.deliveryRedMinutes,
      deliveryOrangeMinutes: ANALYTICS_CONFIG.deliveryOrangeMinutes,
      deliveryWindowMinutes: ANALYTICS_CONFIG.deliveryWindowMinutes,
      pendingTooLongMinutes: ANALYTICS_CONFIG.pendingTooLongMinutes,
    },
  };
};

export type { OrderRow };
