import { getCollection } from '../../mongo.js';
import { ORDER_STATUS, PAYMENT_SUCCESS_STATUSES } from './constants.js';
import { parseDeliveryWindow } from './period.js';
import { CACHE_TTL, swr } from './cache.js';

/**
 * Nạp & chuẩn hóa dữ liệu đơn – tiền – khách cho Dashboard/Báo cáo.
 * Một chỗ duy nhất quyết định: trạng thái đơn chuẩn, ngày hoàn thành, giao dịch hợp lệ (loại trùng).
 */

export const normalizeKey = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();

export const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Chuẩn hóa trạng thái đơn về bộ ORDER_STATUS. */
export const normalizeOrderStatus = (raw: unknown): string => {
  const s = String(raw || '').trim();
  const k = normalizeKey(s);
  if (!s) return ORDER_STATUS.pending;
  if (k.includes('da hoan tien')) return ORDER_STATUS.refunded;
  if (k.includes('chap nhan hoan')) return ORDER_STATUS.refundAccepted;
  if (k.includes('yeu cau hoan') || k.includes('tra hang')) return ORDER_STATUS.refundRequested;
  if (k.includes('that bai')) return ORDER_STATUS.paymentFailed;
  if (k.includes('huy')) return ORDER_STATUS.cancelled;
  if (k.includes('hoan thanh')) return ORDER_STATUS.completed;
  if (k.includes('da giao') || k.includes('giao hang thanh cong') || k.includes('giao thanh cong')) return ORDER_STATUS.delivered;
  if (k.includes('dang giao')) return ORDER_STATUS.shipping;
  if (k.includes('van chuyen')) return ORDER_STATUS.waitingShip;
  if (k.includes('chuan bi')) return ORDER_STATUS.preparing;
  if (k.includes('xac nhan')) return ORDER_STATUS.confirmed;
  if (k.includes('cho thanh toan')) return ORDER_STATUS.waitingPayment;
  if (k.includes('cho xu ly')) return ORDER_STATUS.pending;
  return s;
};

export interface OrderRow {
  id: string;
  customerId: string | null;
  status: string;
  rawStatus: string;
  createdAt: Date | null;
  completedAt: Date | null;
  completedAtEstimated: boolean;
  cancelledAt: Date | null;
  refundRequestedAt: Date | null;
  total: number;
  shipping: number;
  vat: number;
  deposit: number;
  netRevenue: number; // TONG_TIEN − PHI_VAN_CHUYEN
  paymentMethod: string;
  cancelReason: string;
  deliveryStart: Date | null;
  deliveryEnd: Date | null;
  deliverySlot: string;
  recipient: string;
  address: string;
  prepStartAt: Date | null;
  materialIssued: boolean;
  stockChecked: boolean;
  raw: any;
}

export interface PaymentRow {
  id: string;
  orderId: string;
  amount: number;
  method: string;
  status: string;
  success: boolean;
  paidAt: Date | null;
  transactionCode: string;
  duplicateOf: string | null;
}

export interface DetailRow { orderId: string; productId: string; quantity: number; price: number; amount: number; }

export interface Dataset {
  orders: OrderRow[];
  ordersById: Map<string, OrderRow>;
  details: DetailRow[];
  detailsByOrder: Map<string, DetailRow[]>;
  payments: PaymentRow[]; // đã đánh dấu trùng
  paidByOrder: Map<string, number>; // chỉ giao dịch thành công, không trùng
  customers: { id: string; registeredAt: Date | null }[];
  products: Map<string, any>;
  loadedAt: Date;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const mapOrder = (o: any): OrderRow => {
  const status = normalizeOrderStatus(o.TRANG_THAI);
  const created = toDate(o.NGAY_TAO);
  const explicitDone = toDate(o.NGAY_HOAN_THANH);
  const win = parseDeliveryWindow(o.NGAY_MUON_GIAO, o.KHUNG_GIO_MUON_GIAO);
  const fallbackDone = win?.end || toDate(o.NGAY_CAP_NHAT) || created;
  const total = num(o.TONG_TIEN);
  const shipping = num(o.PHI_VAN_CHUYEN);
  return {
    id: String(o.DON_HANG_ID),
    customerId: o.KHACH_HANG_ID || null,
    status,
    rawStatus: String(o.TRANG_THAI || ''),
    createdAt: created,
    completedAt: status === ORDER_STATUS.completed ? (explicitDone || fallbackDone) : null,
    completedAtEstimated: status === ORDER_STATUS.completed && (!explicitDone || Boolean(o.NGAY_HOAN_THANH_UOC_TINH)),
    cancelledAt: toDate(o.NGAY_HUY),
    refundRequestedAt: toDate(o.NGAY_YEU_CAU_HOAN_TIEN_TRA_HANG),
    total,
    shipping,
    vat: num(o.VAT),
    deposit: num(o.TIEN_COC),
    netRevenue: Math.max(0, total - shipping),
    paymentMethod: String(o.PHUONG_THUC_THANH_TOAN || 'Khác'),
    cancelReason: String(o.LY_DO_HUY || '').trim(),
    deliveryStart: win?.start || null,
    deliveryEnd: win?.end || null,
    deliverySlot: String(o.KHUNG_GIO_MUON_GIAO || ''),
    recipient: String(o.TEN_NGUOI_NHAN || ''),
    address: String(o.DIA_CHI_GIAO_HANG || ''),
    prepStartAt: toDate(o.THOI_DIEM_BAT_DAU_CHUAN_BI),
    materialIssued: Boolean(o.DA_XUAT_NVL),
    stockChecked: Boolean(o.KIEM_TRA_TON_KHO),
    raw: o,
  };
};

export const loadDataset = async (): Promise<Dataset> => {
  const [orders, details, payments, customers, products] = await Promise.all([
    (await getCollection<any>('DON_HANG')).find({}).project({
      DON_HANG_ID: 1, KHACH_HANG_ID: 1, TRANG_THAI: 1, NGAY_TAO: 1, NGAY_HOAN_THANH: 1, NGAY_HOAN_THANH_UOC_TINH: 1, LY_DO_HOAN_TIEN_TRA_HANG: 1, DIEM_THUONG_SU_DUNG: 1, NGAY_CAP_NHAT: 1, NGAY_HUY: 1, LY_DO_HUY: 1,
      NGAY_YEU_CAU_HOAN_TIEN_TRA_HANG: 1, TONG_TIEN: 1, PHI_VAN_CHUYEN: 1, VAT: 1, TIEN_COC: 1, PHUONG_THUC_THANH_TOAN: 1,
      NGAY_MUON_GIAO: 1, KHUNG_GIO_MUON_GIAO: 1, TEN_NGUOI_NHAN: 1, DIA_CHI_GIAO_HANG: 1, SDT_NGUOI_NHAN: 1,
      THOI_DIEM_BAT_DAU_CHUAN_BI: 1, DA_XUAT_NVL: 1, KIEM_TRA_TON_KHO: 1,
    }).toArray(),
    (await getCollection<any>('DON_HANG_CHI_TIET')).find({}).project({ DON_HANG_ID: 1, SAN_PHAM_ID: 1, SO_LUONG: 1, GIA: 1 }).toArray(),
    (await getCollection<any>('THANH_TOAN')).find({}).project({ THANH_TOAN_ID: 1, DON_HANG_ID: 1, SO_TIEN: 1, CONG_THANH_TOAN: 1, TRANG_THAI_THANH_TOAN: 1, NGAY_THANH_TOAN: 1, MA_GIAO_DICH: 1 }).toArray(),
    (await getCollection<any>('KHACH_HANG')).find({}).project({ KHACH_HANG_ID: 1, NGAY_DANG_KY: 1, NGAY_TAO: 1 }).toArray(),
    (await getCollection<any>('SAN_PHAM')).find({}).project({ SAN_PHAM_ID: 1, TEN_SAN_PHAM: 1, KIEU_DANG: 1, CHU_DE_ID: 1, GIA: 1, GIA_KHUYEN_MAI: 1, TRANG_THAI: 1 }).toArray(),
  ]);

  const orderRows = orders.map(mapOrder);
  const ordersById = new Map(orderRows.map((o) => [o.id, o]));
  const detailRows: DetailRow[] = details.map((d: any) => ({
    orderId: String(d.DON_HANG_ID), productId: String(d.SAN_PHAM_ID), quantity: num(d.SO_LUONG), price: num(d.GIA), amount: num(d.SO_LUONG) * num(d.GIA),
  }));
  const detailsByOrder = new Map<string, DetailRow[]>();
  detailRows.forEach((d) => detailsByOrder.set(d.orderId, [...(detailsByOrder.get(d.orderId) || []), d]));

  // Giao dịch: loại trùng theo MA_GIAO_DICH (giao dịch đến trước được giữ)
  const sorted = [...payments].sort((a: any, b: any) => (toDate(a.NGAY_THANH_TOAN)?.getTime() || 0) - (toDate(b.NGAY_THANH_TOAN)?.getTime() || 0));
  const firstByCode = new Map<string, string>();
  const paymentRows: PaymentRow[] = sorted.map((p: any) => {
    const status = String(p.TRANG_THAI_THANH_TOAN || '');
    const success = PAYMENT_SUCCESS_STATUSES.includes(status) || normalizeKey(status).includes('thanh cong');
    const code = String(p.MA_GIAO_DICH || '').trim();
    const id = String(p.THANH_TOAN_ID || p._id);
    let duplicateOf: string | null = null;
    if (success && code) {
      const k = `${code}`;
      if (firstByCode.has(k)) duplicateOf = firstByCode.get(k)!;
      else firstByCode.set(k, id);
    }
    return { id, orderId: String(p.DON_HANG_ID || ''), amount: num(p.SO_TIEN), method: String(p.CONG_THANH_TOAN || 'Khác'), status, success, paidAt: toDate(p.NGAY_THANH_TOAN), transactionCode: code, duplicateOf };
  });
  const paidByOrder = new Map<string, number>();
  paymentRows.filter((p) => p.success && !p.duplicateOf).forEach((p) => paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) || 0) + p.amount));

  return {
    orders: orderRows,
    ordersById,
    details: detailRows,
    detailsByOrder,
    payments: paymentRows,
    paidByOrder,
    customers: customers.map((c: any) => ({ id: String(c.KHACH_HANG_ID), registeredAt: toDate(c.NGAY_DANG_KY || c.NGAY_TAO) })),
    products: new Map(products.map((p: any) => [String(p.SAN_PHAM_ID), p])),
    loadedAt: new Date(),
  };
};

/**
 * Bộ dữ liệu dùng chung cho Dashboard / Báo cáo / Thông báo (có cache, xem cache.ts).
 * - fresh: bỏ qua cache (nút Tải lại)
 * - allowStale=false: bộ quét thông báo cần số mới (≤ ttl)
 */
export const getDataset = (opts: { fresh?: boolean; allowStale?: boolean } = {}): Promise<Dataset> =>
  swr('dataset', { ttlMs: CACHE_TTL.datasetMs, maxStaleMs: CACHE_TTL.datasetMaxStaleMs, ...opts }, loadDataset);
