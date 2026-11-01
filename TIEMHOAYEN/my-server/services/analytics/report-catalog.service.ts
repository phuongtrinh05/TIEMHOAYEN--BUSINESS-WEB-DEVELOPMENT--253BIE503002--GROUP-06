import { ORDER_STATUS } from './constants.js';
import { Dataset, getDataset, OrderRow } from './dataset.js';
import { autoBucket, Bucket, bucketKey, DateRange, enumerateBuckets, inRange, resolveRange } from './period.js';
import { costLines, CostModel, getCostModel, getReconciliation, getTopics } from './reports.service.js';
import { getInventoryFlows, InventoryFlows, LOSS_EXPORT_TYPES } from './inventory-flows.js';
import { getCachedInventoryAlerts } from './dashboard.service.js';
import { getCollection } from '../../mongo.js';
import { EXPORT_TYPES } from '../inventory/constants.js';

/**
 * DANH SÁCH BÁO CÁO — tra cứu & đối soát.
 * Mỗi báo cáo trả về cùng một khuôn: columns + rows (+ totals, chart) → FE dùng chung 1 màn hình
 * có tìm kiếm, lọc, sắp xếp, phân trang và xuất Excel / CSV / PDF.
 */

export type ColType = 'text' | 'money' | 'number' | 'percent' | 'date' | 'datetime' | 'status';
export interface ReportColumn { key: string; label: string; type: ColType; sum?: boolean }
export interface ReportChart { type: 'line' | 'bar' | 'doughnut'; labels: string[]; series: { label: string; data: number[] }[]; money?: boolean }
export type ReportCategory = 'Bán hàng' | 'Sản phẩm' | 'Khách hàng' | 'Tài chính' | 'Kho' | 'Vận hành' | 'Đối soát';

interface Ctx {
  ds: Dataset;
  range: DateRange;
  groupBy: Bucket;
  status: string;
  model: CostModel;
  flows: InventoryFlows;
  topicName: Map<string, string>;
  fresh: boolean;
}

interface ReportResult { columns: ReportColumn[]; rows: Record<string, any>[]; chart?: ReportChart; note?: string }

interface ReportDef {
  key: string;
  name: string;
  category: ReportCategory;
  description: string;
  icon: string;
  popular?: boolean;
  /** true = số tại thời điểm xem, không theo khoảng ngày */
  snapshot?: boolean;
  filters: ('groupBy' | 'status')[];
  run: (c: Ctx) => Promise<ReportResult> | ReportResult;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const orderLink = (id: string) => `/orders/order-detail/${encodeURIComponent(id)}`;
const VOID = [ORDER_STATUS.cancelled, ORDER_STATUS.refunded, ORDER_STATUS.refundAccepted, ORDER_STATUS.paymentFailed] as string[];

const col = (key: string, label: string, type: ColType = 'text', s = false): ReportColumn => ({ key, label, type, ...(s ? { sum: true } : {}) });
const completedIn = (c: Ctx) => c.ds.orders.filter((o) => o.status === ORDER_STATUS.completed && inRange(o.completedAt, c.range));
const topicOf = (c: Ctx, productId: string) => {
  const t = c.ds.products.get(productId)?.CHU_DE_ID;
  return c.topicName.get(String(t)) || (t ? String(t) : 'Chưa phân loại');
};
const customerName = (c: Ctx, o: OrderRow) => (o.customerId ? c.ds.customersById.get(o.customerId)?.name || o.customerId : 'Khách vãng lai');

/** Gom dòng giá vốn theo 1 khóa (sản phẩm / dịp / kiểu dáng). */
const groupLines = (c: Ctx, keyOf: (productId: string) => string) => {
  const lines = costLines(c.ds, completedIn(c).map((o) => o.id), c.model);
  const m = new Map<string, any>();
  lines.forEach((l) => {
    const k = keyOf(l.productId) || 'Chưa phân loại';
    const x = m.get(k) || { key: k, products: new Set(), quantity: 0, orders: new Set(), revenue: 0, cost: 0, complete: true, methods: new Set() };
    x.products.add(l.productId); x.orders.add(l.orderId); x.quantity += l.quantity; x.revenue += l.revenue; x.methods.add(l.method);
    if (l.cost === null) x.complete = false; else x.cost += l.cost;
    m.set(k, x);
  });
  const total = sum([...m.values()], (x) => x.revenue);
  return [...m.values()].map((x) => ({
    key: x.key, products: x.products.size, quantity: x.quantity, orders: x.orders.size, revenue: x.revenue, share: pct(x.revenue, total),
    cost: x.complete ? x.cost : null, grossProfit: x.complete ? x.revenue - x.cost : null, margin: x.complete ? pct(x.revenue - x.cost, x.revenue) : null,
    costMethod: [...x.methods].join(' + '),
  })).sort((a, b) => b.revenue - a.revenue);
};

const timeBuckets = (c: Ctx) => {
  const buckets = enumerateBuckets(c.range, c.groupBy);
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  const at = (d: Date | null) => (d ? idx.get(bucketKey(d, c.groupBy).key) : undefined);
  return { buckets, at };
};

export const REPORTS: ReportDef[] = [
  /* ------------------------------ BÁN HÀNG ------------------------------ */
  {
    key: 'sales-by-time', name: 'Doanh thu theo thời gian', category: 'Bán hàng', icon: 'bi-graph-up', popular: true, filters: ['groupBy'],
    description: 'Đơn mới, đơn hoàn thành, giảm giá, doanh thu thuần và tiền đã thu theo ngày / tuần / tháng / quý / năm.',
    run: (c) => {
      const { buckets, at } = timeBuckets(c);
      const rows = buckets.map((b) => ({ period: b.label, newOrders: 0, completed: 0, cancelled: 0, gross: 0, discount: 0, netRevenue: 0, cash: 0, aov: null as number | null }));
      c.ds.orders.forEach((o) => {
        const i = at(inRange(o.createdAt, c.range) ? o.createdAt : null);
        if (i !== undefined) { rows[i].newOrders++; if (o.status === ORDER_STATUS.cancelled) rows[i].cancelled++; }
        const j = at(o.status === ORDER_STATUS.completed && inRange(o.completedAt, c.range) ? o.completedAt : null);
        if (j !== undefined) { rows[j].completed++; rows[j].netRevenue += o.netRevenue; rows[j].discount += o.discount; rows[j].gross += o.netRevenue + o.discount; }
      });
      c.ds.payments.forEach((p) => { const i = at(p.success && !p.duplicateOf && inRange(p.paidAt, c.range) ? p.paidAt : null); if (i !== undefined) rows[i].cash += p.amount; });
      rows.forEach((r) => { r.aov = r.completed ? Math.round(r.netRevenue / r.completed) : null; });
      return {
        columns: [col('period', 'Kỳ'), col('newOrders', 'Đơn mới', 'number', true), col('completed', 'Đơn hoàn thành', 'number', true), col('cancelled', 'Đơn hủy', 'number', true),
          col('gross', 'DT trước giảm giá', 'money', true), col('discount', 'Giảm giá', 'money', true), col('netRevenue', 'Doanh thu thuần', 'money', true), col('cash', 'Tiền đã thu', 'money', true), col('aov', 'Giá trị đơn TB', 'money')],
        rows,
        chart: { type: 'line', labels: rows.map((r) => r.period), series: [{ label: 'Doanh thu thuần', data: rows.map((r) => r.netRevenue) }, { label: 'Tiền đã thu', data: rows.map((r) => r.cash) }], money: true },
      };
    },
  },
  {
    key: 'orders-detail', name: 'Chi tiết đơn hàng', category: 'Bán hàng', icon: 'bi-receipt', popular: true, filters: ['status'],
    description: 'Từng đơn tạo trong kỳ: khách, dịp tặng, tạm tính, giảm giá, phí ship, tổng tiền, đã thu, còn phải thu.',
    run: (c) => {
      const rows = c.ds.orders.filter((o) => inRange(o.createdAt, c.range) && (!c.status || o.status === c.status)).map((o) => {
        const paid = c.ds.paidByOrder.get(o.id) || 0;
        const topics = [...new Set((c.ds.detailsByOrder.get(o.id) || []).map((d) => topicOf(c, d.productId)))].join(', ');
        return {
          orderId: o.id, createdAt: o.createdAt, customer: customerName(c, o), recipient: o.recipient, status: o.status, occasion: topics,
          subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, total: o.total, paid, remaining: Math.max(0, o.total - paid),
          method: o.paymentMethod, deliveryAt: o.deliveryStart, _link: orderLink(o.id),
        };
      }).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
      return {
        columns: [col('orderId', 'Mã đơn'), col('createdAt', 'Ngày tạo', 'datetime'), col('customer', 'Khách hàng'), col('recipient', 'Người nhận'), col('status', 'Trạng thái', 'status'),
          col('occasion', 'Dịp tặng'), col('subtotal', 'Tạm tính', 'money', true), col('discount', 'Giảm giá', 'money', true), col('shipping', 'Phí ship', 'money', true),
          col('total', 'Tổng tiền', 'money', true), col('paid', 'Đã thu', 'money', true), col('remaining', 'Còn phải thu', 'money', true), col('method', 'Thanh toán'), col('deliveryAt', 'Giờ giao', 'datetime')],
        rows,
      };
    },
  },
  /* ------------------------------ SẢN PHẨM ------------------------------ */
  {
    key: 'sales-by-product', name: 'Doanh thu & lợi nhuận theo sản phẩm', category: 'Sản phẩm', icon: 'bi-flower2', popular: true, filters: [],
    description: 'Số lượng bán, doanh thu hàng, giá vốn, lợi nhuận gộp và biên của từng sản phẩm (đơn hoàn thành).',
    run: (c) => {
      const rows = groupLines(c, (id) => id).map((g) => {
        const p = c.ds.products.get(g.key);
        return { product: p?.TEN_SAN_PHAM || g.key, productId: g.key, occasion: topicOf(c, g.key), style: p?.KIEU_DANG || '', quantity: g.quantity, orders: g.orders, revenue: g.revenue, share: g.share, cost: g.cost, grossProfit: g.grossProfit, margin: g.margin, costMethod: g.costMethod, _link: `/products/product-detail?id=${encodeURIComponent(g.key)}` };
      });
      return {
        columns: [col('product', 'Sản phẩm'), col('productId', 'Mã SP'), col('occasion', 'Dịp tặng'), col('style', 'Kiểu dáng'), col('quantity', 'SL bán', 'number', true), col('orders', 'Số đơn', 'number'),
          col('revenue', 'Doanh thu hàng', 'money', true), col('share', 'Tỷ trọng', 'percent'), col('cost', 'Giá vốn', 'money', true), col('grossProfit', 'LN gộp', 'money', true), col('margin', 'Biên LN', 'percent'), col('costMethod', 'Cách tính giá vốn')],
        rows,
        chart: { type: 'bar', labels: rows.slice(0, 10).map((r) => r.product), series: [{ label: 'Doanh thu hàng', data: rows.slice(0, 10).map((r) => r.revenue) }], money: true },
        note: 'Giá vốn ưu tiên phiếu xuất "Làm hoa theo đơn"; chưa có thì dùng định mức BOM; thiếu BOM / giá → "Chưa đủ dữ liệu" (không tính 0).',
      };
    },
  },
  {
    key: 'sales-by-occasion', name: 'Doanh thu theo dịp tặng', category: 'Sản phẩm', icon: 'bi-gift', popular: true, filters: [],
    description: 'Hiệu quả từng dịp tặng (chủ đề sản phẩm): số mẫu bán, số lượng, doanh thu, tỷ trọng, lợi nhuận gộp.',
    run: (c) => {
      const rows = groupLines(c, (id) => topicOf(c, id)).map((g) => ({ occasion: g.key, products: g.products, quantity: g.quantity, orders: g.orders, revenue: g.revenue, share: g.share, grossProfit: g.grossProfit, margin: g.margin }));
      return {
        columns: [col('occasion', 'Dịp tặng'), col('products', 'Số mẫu bán', 'number'), col('quantity', 'SL bán', 'number', true), col('orders', 'Số đơn', 'number', true), col('revenue', 'Doanh thu hàng', 'money', true), col('share', 'Tỷ trọng', 'percent'), col('grossProfit', 'LN gộp', 'money', true), col('margin', 'Biên LN', 'percent')],
        rows,
        chart: { type: 'doughnut', labels: rows.map((r) => r.occasion), series: [{ label: 'Doanh thu hàng', data: rows.map((r) => r.revenue) }], money: true },
      };
    },
  },
  {
    key: 'sales-by-style', name: 'Doanh thu theo kiểu dáng', category: 'Sản phẩm', icon: 'bi-basket', filters: [],
    description: 'Bó, giỏ, hộp, kệ, bình… bán được bao nhiêu và lời bao nhiêu.',
    run: (c) => {
      const rows = groupLines(c, (id) => String(c.ds.products.get(id)?.KIEU_DANG || '')).map((g) => ({ style: g.key, products: g.products, quantity: g.quantity, revenue: g.revenue, share: g.share, grossProfit: g.grossProfit, margin: g.margin }));
      return {
        columns: [col('style', 'Kiểu dáng'), col('products', 'Số mẫu bán', 'number'), col('quantity', 'SL bán', 'number', true), col('revenue', 'Doanh thu hàng', 'money', true), col('share', 'Tỷ trọng', 'percent'), col('grossProfit', 'LN gộp', 'money', true), col('margin', 'Biên LN', 'percent')],
        rows,
        chart: { type: 'bar', labels: rows.map((r) => r.style), series: [{ label: 'Doanh thu hàng', data: rows.map((r) => r.revenue) }], money: true },
      };
    },
  },
  /* ------------------------------ KHÁCH HÀNG ------------------------------ */
  {
    key: 'sales-by-customer', name: 'Doanh thu theo khách hàng', category: 'Khách hàng', icon: 'bi-people', popular: true, filters: [],
    description: 'Khách mua trong kỳ: mới hay quay lại, số đơn, doanh thu thuần, giá trị đơn TB, lần mua gần nhất.',
    run: (c) => {
      const first = new Map<string, Date>();
      c.ds.orders.forEach((o) => { if (o.customerId && o.createdAt && !VOID.includes(o.status)) { const f = first.get(o.customerId); if (!f || o.createdAt < f) first.set(o.customerId, o.createdAt); } });
      const m = new Map<string, any>();
      completedIn(c).forEach((o) => {
        const id = o.customerId || '__guest';
        const x = m.get(id) || { id, orders: 0, revenue: 0, last: null as Date | null };
        x.orders++; x.revenue += o.netRevenue; if (!x.last || (o.completedAt && o.completedAt > x.last)) x.last = o.completedAt;
        m.set(id, x);
      });
      const rows = [...m.values()].map((x) => {
        const cu = c.ds.customersById.get(x.id);
        return {
          customer: x.id === '__guest' ? 'Khách vãng lai (không tài khoản)' : cu?.name || x.id, customerId: x.id === '__guest' ? '' : x.id, phone: cu?.phone || '',
          type: x.id === '__guest' ? '—' : (first.get(x.id)?.getTime() || 0) >= c.range.from.getTime() ? 'Mới' : 'Quay lại',
          orders: x.orders, revenue: x.revenue, aov: Math.round(x.revenue / x.orders), lastOrderAt: x.last,
          ...(x.id !== '__guest' ? { _link: `/customers/detail?id=${encodeURIComponent(x.id)}` } : {}),
        };
      }).sort((a, b) => b.revenue - a.revenue);
      return {
        columns: [col('customer', 'Khách hàng'), col('customerId', 'Mã KH'), col('phone', 'SĐT'), col('type', 'Loại', 'status'), col('orders', 'Số đơn', 'number', true), col('revenue', 'Doanh thu thuần', 'money', true), col('aov', 'Giá trị đơn TB', 'money'), col('lastOrderAt', 'Mua gần nhất', 'date')],
        rows,
      };
    },
  },
  {
    key: 'new-customers', name: 'Khách hàng đăng ký mới', category: 'Khách hàng', icon: 'bi-person-plus', filters: [],
    description: 'Tài khoản tạo trong kỳ và đã mua bao nhiêu (chuyển đổi khách mới).',
    run: (c) => {
      const rows = c.ds.customers.filter((cu) => inRange(cu.registeredAt, c.range)).map((cu) => {
        const orders = c.ds.orders.filter((o) => o.customerId === cu.id && o.status === ORDER_STATUS.completed);
        return { customer: cu.name || cu.id, customerId: cu.id, phone: cu.phone, registeredAt: cu.registeredAt, orders: orders.length, revenue: sum(orders, (o) => o.netRevenue), converted: orders.length ? 'Đã mua' : 'Chưa mua', _link: `/customers/detail?id=${encodeURIComponent(cu.id)}` };
      }).sort((a, b) => (b.registeredAt?.getTime() || 0) - (a.registeredAt?.getTime() || 0));
      return {
        columns: [col('customer', 'Khách hàng'), col('customerId', 'Mã KH'), col('phone', 'SĐT'), col('registeredAt', 'Ngày đăng ký', 'date'), col('converted', 'Chuyển đổi', 'status'), col('orders', 'Đơn hoàn thành', 'number', true), col('revenue', 'Doanh thu thuần', 'money', true)],
        rows,
        note: `Tỷ lệ chuyển đổi: ${pct(rows.filter((r) => r.orders > 0).length, rows.length) ?? 0}% khách mới đã có đơn hoàn thành.`,
      };
    },
  },
  {
    key: 'reviews', name: 'Đánh giá sản phẩm', category: 'Khách hàng', icon: 'bi-star', filters: [],
    description: 'Đánh giá của khách trong kỳ, số sao và nội dung — lọc nhanh đánh giá thấp để xử lý.',
    run: async (c) => {
      const rows = (await (await getCollection<any>('DANH_GIA')).find({}).toArray().catch(() => [] as any[]))
        .filter((r: any) => inRange(new Date(r.NGAY_DANH_GIA), c.range))
        .map((r: any) => ({
          reviewedAt: new Date(r.NGAY_DANH_GIA), product: c.ds.products.get(String(r.SAN_PHAM_ID))?.TEN_SAN_PHAM || r.SAN_PHAM_ID, stars: Number(r.SO_SAO || 0),
          customer: r.KHACH_HANG_ID ? c.ds.customersById.get(String(r.KHACH_HANG_ID))?.name || r.TEN_KHACH_HANG || r.KHACH_HANG_ID : 'Ẩn danh',
          content: String(r.NOI_DUNG || ''), orderId: r.DON_HANG_ID || '', _link: `/products/product-detail?id=${encodeURIComponent(String(r.SAN_PHAM_ID))}`,
        })).sort((a: any, b: any) => b.reviewedAt.getTime() - a.reviewedAt.getTime());
      return {
        columns: [col('reviewedAt', 'Ngày', 'datetime'), col('product', 'Sản phẩm'), col('customer', 'Khách hàng'), col('stars', 'Số sao', 'number'), col('content', 'Nội dung'), col('orderId', 'Mã đơn')],
        rows,
        chart: { type: 'bar', labels: ['5★', '4★', '3★', '2★', '1★'], series: [{ label: 'Số đánh giá', data: [5, 4, 3, 2, 1].map((s) => rows.filter((r: any) => r.stars === s).length) }] },
      };
    },
  },
  /* ------------------------------ TÀI CHÍNH ------------------------------ */
  {
    key: 'business-result', name: 'Báo cáo kết quả hoạt động kinh doanh', category: 'Tài chính', icon: 'bi-clipboard-data', popular: true, filters: ['groupBy'],
    description: 'Doanh thu trước giảm giá → giảm giá → doanh thu thuần → giá vốn → lợi nhuận gộp → hao hụt NVL, theo từng kỳ.',
    run: (c) => {
      const { buckets, at } = timeBuckets(c);
      const rows = buckets.map((b) => ({ period: b.label, gross: 0, discount: 0, netRevenue: 0, coveredRevenue: 0, cogs: 0, grossProfit: 0, loss: 0, afterLoss: 0, coverage: null as number | null }));
      const completed = completedIn(c);
      completed.forEach((o) => { const i = at(o.completedAt); if (i !== undefined) { rows[i].netRevenue += o.netRevenue; rows[i].discount += o.discount; rows[i].gross += o.netRevenue + o.discount; } });
      const goods = new Array(rows.length).fill(0);
      costLines(c.ds, completed.map((o) => o.id), c.model).forEach((l) => {
        const i = at(c.ds.ordersById.get(l.orderId)?.completedAt || null);
        if (i === undefined) return;
        goods[i] += l.revenue;
        if (l.cost !== null) { rows[i].cogs += l.cost; rows[i].coveredRevenue += l.revenue; }
      });
      c.flows.exports.filter((x) => LOSS_EXPORT_TYPES.includes(x.type) && inRange(x.at, c.range)).forEach((x) => { const i = at(x.at); if (i !== undefined) rows[i].loss += x.cost; });
      rows.forEach((r, i) => { r.grossProfit = r.coveredRevenue - r.cogs; r.afterLoss = r.grossProfit - r.loss; r.coverage = pct(r.coveredRevenue, goods[i]); });
      return {
        columns: [col('period', 'Kỳ'), col('gross', 'DT trước giảm giá', 'money', true), col('discount', 'Giảm giá', 'money', true), col('netRevenue', 'Doanh thu thuần', 'money', true),
          col('cogs', 'Giá vốn NVL', 'money', true), col('grossProfit', 'LN gộp', 'money', true), col('loss', 'Hao hụt / hủy NVL', 'money', true), col('afterLoss', 'LN sau hao hụt', 'money', true), col('coverage', 'Phủ giá vốn', 'percent')],
        rows,
        chart: { type: 'bar', labels: rows.map((r) => r.period), series: [{ label: 'Doanh thu thuần', data: rows.map((r) => r.netRevenue) }, { label: 'LN gộp', data: rows.map((r) => r.grossProfit) }], money: true },
        note: 'Chưa gồm chi phí vận hành (mặt bằng, lương…). LN gộp chỉ tính trên phần doanh thu có đủ giá vốn ("Phủ giá vốn").',
      };
    },
  },
  {
    key: 'cashflow-by-day', name: 'Dòng tiền theo ngày giao dịch', category: 'Tài chính', icon: 'bi-cash-coin', popular: true, filters: ['status'],
    description: 'Từng giao dịch thanh toán (cọc, COD, chuyển khoản…) theo ngày; đánh dấu giao dịch trùng mã.',
    run: (c) => {
      const rows = c.ds.payments.filter((p) => inRange(p.paidAt, c.range) && (!c.status || p.status === c.status)).map((p) => ({
        paidAt: p.paidAt, paymentId: p.id, transactionCode: p.transactionCode, orderId: p.orderId, method: p.method, status: p.status,
        amount: p.amount, counted: p.success && !p.duplicateOf ? p.amount : 0, note: p.duplicateOf ? `Trùng với ${p.duplicateOf} — không tính` : '',
        _link: orderLink(p.orderId),
      })).sort((a, b) => (b.paidAt?.getTime() || 0) - (a.paidAt?.getTime() || 0));
      return {
        columns: [col('paidAt', 'Thời điểm', 'datetime'), col('paymentId', 'Mã thanh toán'), col('transactionCode', 'Mã giao dịch'), col('orderId', 'Mã đơn'), col('method', 'Phương thức'),
          col('status', 'Trạng thái', 'status'), col('amount', 'Số tiền', 'money', true), col('counted', 'Tính vào tiền đã thu', 'money', true), col('note', 'Ghi chú')],
        rows,
      };
    },
  },
  {
    key: 'payments-by-method', name: 'Tiền đã thu theo phương thức', category: 'Tài chính', icon: 'bi-credit-card', filters: [],
    description: 'Tiền mặt / chuyển khoản / ví điện tử… chiếm bao nhiêu trong tiền đã thu.',
    run: (c) => {
      const m = new Map<string, { method: string; transactions: number; amount: number; orders: Set<string> }>();
      c.ds.payments.filter((p) => p.success && !p.duplicateOf && inRange(p.paidAt, c.range)).forEach((p) => {
        const x = m.get(p.method) || { method: p.method, transactions: 0, amount: 0, orders: new Set<string>() };
        x.transactions++; x.amount += p.amount; x.orders.add(p.orderId); m.set(p.method, x);
      });
      const total = sum([...m.values()], (x) => x.amount);
      const rows = [...m.values()].map((x) => ({ method: x.method, transactions: x.transactions, orders: x.orders.size, amount: x.amount, share: pct(x.amount, total) })).sort((a, b) => b.amount - a.amount);
      return {
        columns: [col('method', 'Phương thức'), col('transactions', 'Số giao dịch', 'number', true), col('orders', 'Số đơn', 'number'), col('amount', 'Tiền đã thu', 'money', true), col('share', 'Tỷ trọng', 'percent')],
        rows,
        chart: { type: 'doughnut', labels: rows.map((r) => r.method), series: [{ label: 'Tiền đã thu', data: rows.map((r) => r.amount) }], money: true },
      };
    },
  },
  {
    key: 'deposits', name: 'Tiền cọc đang giữ', category: 'Tài chính', icon: 'bi-piggy-bank', snapshot: true, filters: [],
    description: 'Đơn chưa hoàn thành (chưa hủy/hoàn) đã thu tiền — số tiền khách đã trả trước mà shop đang giữ.',
    run: (c) => {
      const rows = c.ds.orders.filter((o) => o.status !== ORDER_STATUS.completed && !VOID.includes(o.status) && (c.ds.paidByOrder.get(o.id) || 0) > 0).map((o) => {
        const paid = c.ds.paidByOrder.get(o.id) || 0;
        return { orderId: o.id, createdAt: o.createdAt, customer: customerName(c, o), status: o.status, total: o.total, paid, remaining: Math.max(0, o.total - paid), deliveryAt: o.deliveryStart, _link: orderLink(o.id) };
      }).sort((a, b) => (a.deliveryAt?.getTime() || 0) - (b.deliveryAt?.getTime() || 0));
      return {
        columns: [col('orderId', 'Mã đơn'), col('createdAt', 'Ngày tạo', 'datetime'), col('customer', 'Khách hàng'), col('status', 'Trạng thái', 'status'), col('total', 'Tổng tiền', 'money', true), col('paid', 'Đã thu (cọc)', 'money', true), col('remaining', 'Còn phải thu', 'money', true), col('deliveryAt', 'Giờ giao', 'datetime')],
        rows,
      };
    },
  },
  /* ------------------------------ VẬN HÀNH ------------------------------ */
  {
    key: 'delivery-schedule', name: 'Lịch giao theo ngày & khung giờ', category: 'Vận hành', icon: 'bi-truck', filters: ['status'],
    description: 'Đơn có ngày giao trong kỳ: khung giờ, người nhận, địa chỉ, sản phẩm — dùng để phân công giao hoa.',
    run: (c) => {
      const rows = c.ds.orders.filter((o) => o.deliveryStart && inRange(o.deliveryStart, c.range) && !VOID.includes(o.status) && (!c.status || o.status === c.status)).map((o) => ({
        deliveryAt: o.deliveryStart, slot: o.deliverySlot, orderId: o.id, recipient: o.recipient, address: o.address, status: o.status,
        items: (c.ds.detailsByOrder.get(o.id) || []).map((d) => `${c.ds.products.get(d.productId)?.TEN_SAN_PHAM || d.productId} ×${d.quantity}`).join(', '),
        total: o.total, remaining: Math.max(0, o.total - (c.ds.paidByOrder.get(o.id) || 0)), _link: orderLink(o.id),
      })).sort((a, b) => a.deliveryAt!.getTime() - b.deliveryAt!.getTime());
      return {
        columns: [col('deliveryAt', 'Giờ giao', 'datetime'), col('slot', 'Khung giờ'), col('orderId', 'Mã đơn'), col('recipient', 'Người nhận'), col('address', 'Địa chỉ'), col('items', 'Sản phẩm'), col('status', 'Trạng thái', 'status'), col('remaining', 'Thu khi giao', 'money', true)],
        rows,
      };
    },
  },
  {
    key: 'cancellations', name: 'Đơn hủy & lý do', category: 'Vận hành', icon: 'bi-x-octagon', filters: [],
    description: 'Đơn tạo trong kỳ đã hủy: lý do, tiền đã thu (cần hoàn hay không).',
    run: (c) => {
      const rows = c.ds.orders.filter((o) => o.status === ORDER_STATUS.cancelled && inRange(o.createdAt, c.range)).map((o) => ({
        orderId: o.id, createdAt: o.createdAt, cancelledAt: o.cancelledAt, customer: customerName(c, o), total: o.total, paid: c.ds.paidByOrder.get(o.id) || 0, reason: o.cancelReason || 'Không ghi lý do', _link: orderLink(o.id),
      }));
      const reasons = new Map<string, number>();
      rows.forEach((r) => reasons.set(r.reason, (reasons.get(r.reason) || 0) + 1));
      const sorted = [...reasons.entries()].sort((a, b) => b[1] - a[1]);
      return {
        columns: [col('orderId', 'Mã đơn'), col('createdAt', 'Ngày tạo', 'datetime'), col('cancelledAt', 'Ngày hủy', 'datetime'), col('customer', 'Khách hàng'), col('total', 'Tổng tiền', 'money', true), col('paid', 'Đã thu', 'money', true), col('reason', 'Lý do')],
        rows,
        chart: { type: 'bar', labels: sorted.map((x) => x[0]), series: [{ label: 'Số đơn', data: sorted.map((x) => x[1]) }] },
      };
    },
  },
  {
    key: 'refunds', name: 'Yêu cầu trả hàng / hoàn tiền', category: 'Vận hành', icon: 'bi-arrow-counterclockwise', filters: ['status'],
    description: 'Đơn có yêu cầu trả/hoàn: trạng thái xử lý, tiền đã thu, lý do khách đưa ra.',
    run: (c) => {
      const states = [ORDER_STATUS.refundRequested, ORDER_STATUS.refundAccepted, ORDER_STATUS.refunded] as string[];
      const rows = c.ds.orders.filter((o) => (o.refundRequestedAt || states.includes(o.status)) && inRange(o.refundRequestedAt || o.createdAt, c.range) && (!c.status || o.status === c.status)).map((o) => ({
        orderId: o.id, requestedAt: o.refundRequestedAt, status: o.status, customer: customerName(c, o), total: o.total, paid: c.ds.paidByOrder.get(o.id) || 0, reason: String(o.raw.LY_DO_HOAN_TIEN_TRA_HANG || ''), _link: orderLink(o.id),
      }));
      return {
        columns: [col('orderId', 'Mã đơn'), col('requestedAt', 'Ngày yêu cầu', 'datetime'), col('status', 'Trạng thái', 'status'), col('customer', 'Khách hàng'), col('total', 'Tổng tiền', 'money', true), col('paid', 'Đã thu', 'money', true), col('reason', 'Lý do')],
        rows,
      };
    },
  },
  /* ------------------------------ KHO ------------------------------ */
  {
    key: 'material-usage', name: 'Xuất dùng & hao hụt NVL', category: 'Kho', icon: 'bi-box-arrow-up', filters: [],
    description: 'Theo từng NVL: số lượng & giá vốn xuất làm hoa, xuất hao hụt / hủy / kiểm kê trong kỳ.',
    run: (c) => {
      const m = new Map<string, any>();
      c.flows.exports.filter((x) => inRange(x.at, c.range)).forEach((x) => {
        const loss = LOSS_EXPORT_TYPES.includes(x.type);
        const make = x.type === EXPORT_TYPES.order || x.type === EXPORT_TYPES.readyMade;
        x.lines.forEach((l) => {
          const r = m.get(l.materialId) || { materialId: l.materialId, usedQty: 0, usedCost: 0, lossQty: 0, lossCost: 0, otherQty: 0 };
          if (make) { r.usedQty += l.quantity; r.usedCost += l.cost; } else if (loss) { r.lossQty += l.quantity; r.lossCost += l.cost; } else r.otherQty += l.quantity;
          m.set(l.materialId, r);
        });
      });
      const rows = [...m.values()].map((r) => {
        const mat = c.flows.materials.get(r.materialId);
        return { material: mat?.name || r.materialId, materialId: r.materialId, unit: mat?.unit || '', ...r, lossRate: pct(r.lossQty, r.usedQty + r.lossQty), _link: '/materials' };
      }).sort((a, b) => b.usedCost + b.lossCost - (a.usedCost + a.lossCost));
      return {
        columns: [col('material', 'Nguyên vật liệu'), col('materialId', 'Mã NVL'), col('unit', 'ĐVT'), col('usedQty', 'SL xuất làm hoa', 'number', true), col('usedCost', 'Giá vốn xuất làm hoa', 'money', true),
          col('lossQty', 'SL hao hụt / hủy', 'number', true), col('lossCost', 'Giá vốn hao hụt', 'money', true), col('lossRate', 'Tỷ lệ hao hụt', 'percent'), col('otherQty', 'SL xuất khác', 'number', true)],
        rows,
        chart: { type: 'bar', labels: rows.slice(0, 10).map((r) => r.material), series: [{ label: 'Xuất làm hoa', data: rows.slice(0, 10).map((r) => r.usedCost) }, { label: 'Hao hụt / hủy', data: rows.slice(0, 10).map((r) => r.lossCost) }], money: true },
      };
    },
  },
  {
    key: 'material-purchases', name: 'Nhập NVL theo nhà cung cấp', category: 'Kho', icon: 'bi-box-arrow-in-down', filters: [],
    description: 'Phiếu nhập đã ghi nhận trong kỳ: nhà cung cấp, số dòng, SL không đạt, thành tiền.',
    run: (c) => {
      const rows = c.flows.imports.filter((x) => inRange(x.at, c.range)).map((x) => ({
        receivedAt: x.at, importId: x.id, supplier: c.flows.suppliers.get(String(x.supplierId)) || 'Không rõ NCC', lines: x.lines.length,
        quantity: sum(x.lines, (l) => l.quantity), rejected: sum(x.lines, (l) => l.rejected), total: x.total, _link: '/materials/imports',
      })).sort((a, b) => (b.receivedAt?.getTime() || 0) - (a.receivedAt?.getTime() || 0));
      const bySupplier = new Map<string, number>();
      rows.forEach((r) => bySupplier.set(r.supplier, (bySupplier.get(r.supplier) || 0) + r.total));
      const s = [...bySupplier.entries()].sort((a, b) => b[1] - a[1]);
      return {
        columns: [col('receivedAt', 'Thời điểm nhận', 'datetime'), col('importId', 'Mã phiếu nhập'), col('supplier', 'Nhà cung cấp'), col('lines', 'Số dòng', 'number'), col('quantity', 'SL thực nhận', 'number', true), col('rejected', 'SL không đạt', 'number', true), col('total', 'Thành tiền', 'money', true)],
        rows,
        chart: { type: 'bar', labels: s.map((x) => x[0]), series: [{ label: 'Tiền nhập', data: s.map((x) => x[1]) }], money: true },
      };
    },
  },
  {
    key: 'stock-alerts', name: 'NVL hết / sắp hết', category: 'Kho', icon: 'bi-exclamation-diamond', snapshot: true, filters: [],
    description: 'NVL dưới ngưỡng cảnh báo tại thời điểm xem, kèm gợi ý số lượng cần nhập.',
    run: async (c) => {
      const alerts: any = await getCachedInventoryAlerts({ fresh: c.fresh });
      const rows = (alerts?.materialAlerts || []).map((m: any) => ({ material: m.name, materialId: m.materialId, unit: m.unit, status: m.label, available: m.available, threshold: m.threshold, maxLevel: m.maxLevel, suggestedOrder: m.suggestedOrder, _link: '/materials' }));
      return {
        columns: [col('material', 'Nguyên vật liệu'), col('materialId', 'Mã NVL'), col('unit', 'ĐVT'), col('status', 'Tình trạng', 'status'), col('available', 'Khả dụng', 'number'), col('threshold', 'Ngưỡng', 'number'), col('maxLevel', 'Tối đa', 'number'), col('suggestedOrder', 'Gợi ý nhập', 'number', true)],
        rows,
        note: alerts ? undefined : 'Chưa đọc được dữ liệu kho (chạy npm run inventory:migrate).',
      };
    },
  },
  /* ------------------------------ ĐỐI SOÁT ------------------------------ */
  {
    key: 'reconciliation', name: 'Đối chiếu đơn – tiền – kho', category: 'Đối soát', icon: 'bi-check2-square', popular: true, snapshot: true, filters: ['status'],
    description: 'Đơn hoàn thành thiếu tiền, đơn hủy vẫn có tiền, giao dịch trùng, đơn thiếu phiếu xuất NVL, tồn kho lệch sổ…',
    run: async (c) => {
      const rec = await getReconciliation({ fresh: c.fresh });
      const rows = rec.issues.filter((i) => i.count > 0 && (!c.status || i.severity === c.status)).flatMap((i) => i.rows.map((r: any) => ({
        severity: i.severity, group: i.group, issue: i.title, orderId: r.orderId || r.id || r.paymentId || '',
        detail: Object.entries(r).filter(([k]) => !['link', 'orderId'].includes(k)).map(([k, v]) => `${k}: ${v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' && v ? JSON.stringify(v) : v}`).join(' · '),
        hint: i.hint, ...(r.link ? { _link: r.link } : {}),
      })));
      return {
        columns: [col('severity', 'Mức độ', 'status'), col('group', 'Nhóm'), col('issue', 'Vấn đề'), col('orderId', 'Mã'), col('detail', 'Chi tiết'), col('hint', 'Cách xử lý')],
        rows,
        chart: { type: 'bar', labels: rec.issues.filter((i) => i.count > 0).map((i) => i.code), series: [{ label: 'Số trường hợp', data: rec.issues.filter((i) => i.count > 0).map((i) => i.count) }] },
        note: `Kiểm ${rec.issues.length} quy tắc · ${rec.totals.issues} nhóm lệch · ${rec.totals.rows} trường hợp (mỗi nhóm hiển thị tối đa 100 dòng).`,
      };
    },
  },
];

/** Danh mục báo cáo (không kèm dữ liệu). */
export const getReportCatalog = () => ({
  categories: ['Bán hàng', 'Sản phẩm', 'Khách hàng', 'Tài chính', 'Vận hành', 'Kho', 'Đối soát'],
  reports: REPORTS.map(({ run, ...r }) => r),
});

const STATUS_OPTIONS: Record<string, (ds: Dataset) => string[]> = {
  'orders-detail': (ds) => [...new Set(ds.orders.map((o) => o.status))].sort(),
  'delivery-schedule': (ds) => [...new Set(ds.orders.filter((o) => !VOID.includes(o.status)).map((o) => o.status))].sort(),
  refunds: () => [ORDER_STATUS.refundRequested, ORDER_STATUS.refundAccepted, ORDER_STATUS.refunded],
  'cashflow-by-day': (ds) => [...new Set(ds.payments.map((p) => p.status))].filter(Boolean).sort(),
  reconciliation: () => ['Cao', 'Trung bình', 'Thấp'],
};

export const runReport = async (key: string, query: any) => {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw Object.assign(new Error('Không tìm thấy báo cáo.'), { status: 404 });
  const range = resolveRange(query);
  const fresh = query.fresh === '1' || query.fresh === 'true';
  const groupBy = (['day', 'week', 'month', 'quarter', 'year'].includes(query.groupBy) ? query.groupBy : autoBucket(range) === 'hour' ? 'day' : autoBucket(range)) as Bucket;
  const [ds, model, flows, topics] = await Promise.all([getDataset({ fresh }), getCostModel(fresh), getInventoryFlows({ fresh }), getTopics()]);
  const ctx: Ctx = { ds, range, groupBy, status: String(query.status || ''), model, flows, topicName: new Map(topics.map((t: any) => [String(t.CHU_DE_ID), String(t.TEN_CHU_DE)])), fresh };
  const result = await def.run(ctx);
  const rows = result.rows.slice(0, 5000);
  const totals = Object.fromEntries(result.columns.filter((c) => c.sum).map((c) => [c.key, sum(result.rows, (r) => Number(r[c.key]) || 0)]));
  const { run, ...meta } = def;
  return {
    ...meta, range, groupBy, generatedAt: ds.loadedAt,
    statusOptions: STATUS_OPTIONS[key]?.(ds) || [],
    columns: result.columns, rows, totalRows: result.rows.length, truncated: result.rows.length > rows.length, totals,
    chart: result.chart || null, note: result.note || null,
  };
};
