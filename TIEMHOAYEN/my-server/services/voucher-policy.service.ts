import type { ClientSession } from 'mongodb';
import { getCollection } from '../mongo.js';

/**
 * QUY ĐỊNH CHÍNH SÁCH VOUCHER – TIỆM HOA YÊN (mục 1.2, 2.2, 6).
 * Một nơi duy nhất quyết định voucher có dùng được cho giỏ hàng hay không;
 * danh sách "Voucher có sẵn", báo giá và lúc đặt hàng đều gọi hàm này.
 *  - Guest chỉ dùng voucher công khai; voucher cá nhân chỉ tài khoản được cấp dùng.
 *  - Đúng đối tượng, hạng thành viên hiện tại, còn hiệu lực, còn lượt.
 *  - Đơn tối thiểu tính trên sản phẩm hợp lệ, trước phí giao.
 *  - Tiền giảm = MIN(giá trị SP hợp lệ × %, mức giảm tối đa). Mỗi đơn tối đa 01 voucher.
 */

export const voucherKey = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').trim().toLowerCase();
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v || '').split(',').map(s => s.trim())).filter(Boolean);
const truthy = (v: unknown) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';

/** Hạng thành viên chuẩn hoá: dong | bac | vang | kim cuong (chấp nhận tên tiếng Anh). */
export function normalizeTier(value: unknown): string {
  const k = voucherKey(value);
  if (/kim cuong|diamond/.test(k)) return 'kim cuong';
  if (/vang|gold/.test(k)) return 'vang';
  if (/bac|silver/.test(k)) return 'bac';
  if (/dong|bronze|thanh vien|member/.test(k)) return 'dong';
  return k;
}
export const customerTier = (customer: any) => normalizeTier(customer?.LOAI_THANH_VIEN ?? customer?.HANG_THANH_VIEN ?? customer?.HANG ?? 'Đồng');

/** Voucher cá nhân: gắn KHACH_HANG_ID; dùng một lần (DA_DUNG). Voucher công khai: không gắn khách. */
export const isPersonalVoucher = (v: any) => !!v?.KHACH_HANG_ID;
const isShippingType = (t: string) => /ship|van chuyen|phi giao/.test(t);
const isPercentType = (t: string) => /phan tram|percent|%/.test(t);
const isAmountType = (t: string) => /so tien|tien|amount|fixed|cash/.test(t);

export type VoucherCartLine = { id: string; qty: number; price: number; categoryId?: string };
export type VoucherContext = {
  customerId: string | null;
  customer: any | null;
  lines: VoucherCartLine[];
  shippingFee: number;
  /** Số đơn hợp lệ (không hủy) của khách; dùng cho voucher đơn đầu tiên. */
  validOrderCount: number;
  /** Số lần khách đã dùng voucher này ở đơn chưa hủy. */
  usedByCustomer: number;
  now?: Date;
};
export type VoucherEvaluation = {
  ok: boolean;
  reason: string;
  eligibleSubtotal: number;
  minimum: number;
  productDiscount: number;
  shippingDiscount: number;
};

export function evaluateVoucher(v: any, ctx: VoucherContext): VoucherEvaluation {
  const now = ctx.now || new Date();
  const fail = (reason: string, extra: Partial<VoucherEvaluation> = {}): VoucherEvaluation =>
    ({ ok: false, reason, eligibleSubtotal: 0, minimum: 0, productDiscount: 0, shippingDiscount: 0, ...extra });
  if (!v) return fail('Voucher không tồn tại.');
  if (v.DA_XOA === true || v.DA_XOA === 1 || /da xoa/.test(voucherKey(v.TRANG_THAI))) return fail('Voucher không còn tồn tại.');
  if (v.KICH_HOAT === false || /tam dung|paused|thu hoi|khoa/.test(voucherKey(v.TRANG_THAI))) return fail('Voucher đang tạm dừng.');
  if (Object.prototype.hasOwnProperty.call(v, 'DA_DUYET') && v.DA_DUYET !== true) return fail('Voucher chưa được duyệt.');
  const start = v.NGAY_BAT_DAU ? new Date(v.NGAY_BAT_DAU) : null;
  const end = v.NGAY_KET_THUC ? new Date(v.NGAY_KET_THUC) : null;
  if (start && now < start) return fail(`Voucher áp dụng từ ${start.toLocaleDateString('vi-VN')}.`);
  if (end) { const endOfDay = new Date(end); endOfDay.setUTCHours(16, 59, 59, 999); if (now > endOfDay) return fail('Voucher đã hết hạn.'); }

  // Đối tượng (mục 1.2, 2.2).
  const audience = voucherKey(v.DOI_TUONG);
  if (isPersonalVoucher(v)) {
    if (!ctx.customerId) return fail('Đăng nhập tài khoản được cấp để dùng voucher này.');
    if (v.KHACH_HANG_ID !== ctx.customerId) return fail('Voucher cá nhân không thuộc tài khoản này.');
    if (truthy(v.DA_DUNG) || ctx.usedByCustomer > 0) return fail('Voucher đã được sử dụng.');
  } else {
    const guestOnly = /^guest$|vang lai/.test(audience);
    const memberOnly = /member|thanh vien|tai khoan/.test(audience);
    if (memberOnly && !ctx.customerId) return fail('Voucher dành cho thành viên. Đăng nhập để sử dụng.');
    if (guestOnly && ctx.customerId) return fail('Voucher chỉ dành cho khách vãng lai.');
  }
  const tiers = list(v.HANG_THANH_VIEN).map(normalizeTier);
  if (tiers.length) {
    if (!ctx.customerId) return fail('Voucher dành cho hạng thành viên. Đăng nhập để sử dụng.');
    if (!tiers.includes(customerTier(ctx.customer))) return fail(`Voucher dành cho hạng ${list(v.HANG_THANH_VIEN).join(', ')}.`);
  }
  if (truthy(v.DON_DAU_TIEN) && ctx.validOrderCount > 0) return fail('Voucher chỉ áp dụng cho đơn đầu tiên.');

  // Lượt dùng.
  const totalLimit = num(v.GIOI_HAN_TONG ?? v.TONG_LUOT);
  if (!isPersonalVoucher(v) && totalLimit > 0 && num(v.LUOT_DA_DUNG) >= totalLimit) return fail('Voucher đã hết lượt sử dụng.');
  const perUser = num(v.GIOI_HAN_MOI_NGUOI);
  if (!isPersonalVoucher(v) && perUser > 0 && ctx.usedByCustomer >= perUser) return fail('Bạn đã dùng hết lượt của voucher này.');

  // Sản phẩm hợp lệ và đơn tối thiểu (trước phí giao).
  const productScope = new Set(list(v.SAN_PHAM_IDS));
  const categoryScope = new Set(list(v.CHU_DE_IDS ?? v.DANH_MUC_IDS));
  const eligible = ctx.lines.filter(l => (!productScope.size || productScope.has(l.id)) && (!categoryScope.size || categoryScope.has(String(l.categoryId || ''))));
  const eligibleSubtotal = eligible.reduce((s, l) => s + l.qty * l.price, 0);
  const minimum = Math.max(0, num(v.DON_TOI_THIEU ?? v.GIA_TRI_DON_TOI_THIEU ?? v.DON_HANG_TOI_THIEU));
  if (!eligibleSubtotal) return fail('Giỏ hàng chưa có sản phẩm thuộc phạm vi voucher.', { minimum });
  if (eligibleSubtotal < minimum) return fail(`Cần mua thêm ${(minimum - eligibleSubtotal).toLocaleString('vi-VN')}đ (đơn tối thiểu ${minimum.toLocaleString('vi-VN')}đ, chưa gồm phí giao).`, { eligibleSubtotal, minimum });

  const type = voucherKey(v.LOAI_GIAM_GIA);
  const value = Math.max(0, num(v.GIA_TRI_GIAM));
  const cap = Math.max(0, num(v.MUC_GIAM_TOI_DA ?? v.GIAM_TOI_DA ?? v.TRAN_GIAM));
  let productDiscount = 0, shippingDiscount = 0;
  if (isShippingType(type)) {
    const raw = isPercentType(type) ? ctx.shippingFee * value / 100 : value;
    shippingDiscount = Math.min(ctx.shippingFee, raw, cap > 0 ? cap : Number.POSITIVE_INFINITY);
  } else if (isPercentType(type)) {
    if (value > 100) return fail('Tỷ lệ voucher không hợp lệ.');
    productDiscount = Math.min(eligibleSubtotal * value / 100, cap > 0 ? cap : Number.POSITIVE_INFINITY);
  } else if (isAmountType(type)) {
    productDiscount = Math.min(eligibleSubtotal, value, cap > 0 ? cap : Number.POSITIVE_INFINITY);
  } else return fail('Loại voucher chưa được hỗ trợ.');
  return { ok: true, reason: '', eligibleSubtotal, minimum, productDiscount: Math.round(productDiscount), shippingDiscount: Math.round(shippingDiscount) };
}

/** Đơn chưa hủy của khách (đơn đầu tiên, giới hạn lượt). */
const ACTIVE_ORDER = { TRANG_THAI: { $nin: ['Đã hủy', 'Hủy', 'Thanh toán thất bại'] } };

const rowsOf = async (cursor: any): Promise<any[]> => (cursor && typeof cursor.toArray === 'function' ? cursor.toArray() : []);

export async function loadVoucherContext(customerId: string | null, lines: VoucherCartLine[], shippingFee: number, session?: ClientSession, collections: typeof getCollection = getCollection) {
  const productIds = [...new Set(lines.map(l => l.id))];
  const products = productIds.length
    ? await rowsOf((await collections<any>('SAN_PHAM')).find({ SAN_PHAM_ID: { $in: productIds } }, { session, projection: { SAN_PHAM_ID: 1, CHU_DE_ID: 1 } }))
    : [];
  const category = new Map(products.map(p => [String(p.SAN_PHAM_ID), String(p.CHU_DE_ID || '')]));
  const withCategory = lines.map(l => ({ ...l, categoryId: l.categoryId || category.get(l.id) || '' }));
  const customer = customerId ? await (await collections<any>('KHACH_HANG')).findOne({ KHACH_HANG_ID: customerId }, { session }) : null;
  const orders = customerId
    ? await rowsOf((await collections<any>('DON_HANG')).find({ KHACH_HANG_ID: customerId, ...ACTIVE_ORDER }, { session, projection: { DON_HANG_ID: 1 } }))
    : [];
  const orderIds = orders.map(o => o.DON_HANG_ID);
  const links = orderIds.length
    ? await rowsOf((await collections<any>('DON_HANG_VOUCHER')).find({ DON_HANG_ID: { $in: orderIds } }, { session, projection: { VOUCHER_ID: 1 } }))
    : [];
  const usage = new Map<string, number>();
  for (const l of links) usage.set(String(l.VOUCHER_ID), (usage.get(String(l.VOUCHER_ID)) || 0) + 1);
  return {
    contextFor: (voucher: any): VoucherContext => ({ customerId, customer, lines: withCategory, shippingFee, validOrderCount: orders.length, usedByCustomer: usage.get(String(voucher?.VOUCHER_ID)) || 0 }),
    customer,
  };
}

/** Voucher khách nhìn thấy trong "Voucher có sẵn": voucher cá nhân của khách + voucher công khai còn hiệu lực. */
export async function listCandidateVouchers(customerId: string | null) {
  const now = new Date();
  const filter: any = {
    $and: [
      { $or: [{ DA_XOA: { $exists: false } }, { DA_XOA: { $nin: [true, 1] } }] },
      { $or: [{ NGAY_KET_THUC: null }, { NGAY_KET_THUC: { $exists: false } }, { NGAY_KET_THUC: { $gte: new Date(now.getTime() - 24 * 3600_000) } }] },
      customerId ? { $or: [{ KHACH_HANG_ID: customerId }, { KHACH_HANG_ID: null }, { KHACH_HANG_ID: '' }, { KHACH_HANG_ID: { $exists: false } }] }
        : { $or: [{ KHACH_HANG_ID: null }, { KHACH_HANG_ID: '' }, { KHACH_HANG_ID: { $exists: false } }] },
    ],
  };
  return (await getCollection<any>('VOUCHER')).find(filter).toArray();
}
