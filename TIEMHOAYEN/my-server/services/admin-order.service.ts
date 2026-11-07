import { getCollection } from '../mongo.js';
import type { ClientSession } from 'mongodb';
import { InventoryError, withTransaction } from './inventory/helpers.js';
import { receiveReturnedFinishedGoods } from './inventory/stock.service.js';
import { emitAdminNotification } from './analytics/notifications.service.js';
import { assertWithinShopHours } from './delivery-policy.service.js';

import { slot24h } from './time-format.js';
import { evaluateVoucher, loadVoucherContext } from './voucher-policy.service.js';
export { slot24h };

/** Bỏ các phần địa chỉ rỗng hoặc chữ "null"/"undefined" (do ghép chuỗi khi số nhà trống). */
export function cleanAddress(value: unknown): string {
  return String(value ?? '').split(',').map(part => part.trim()).filter(part => part && !/^(null|undefined)$/i.test(part)).join(', ');
}

const statusKey = (v: unknown) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').trim().toLowerCase();
export const paymentSucceeded = (v: unknown) => ['thanh cong', 'thanh toan thanh cong', 'da thanh toan', 'da coc', 'success', 'paid'].includes(statusKey(v));
export function depositByPolicy(subtotal: number, total: number, items: Array<{ name?: string; qty?: number }>) {
  if (subtotal < 50000) return 0;
  const special = items.reduce((sum, item) => sum + Number(item.qty || 0), 0) >= 10
    || items.some(item => /cuoi|su kien|wedding|event/.test(statusKey(item.name)));
  const amount = special ? Math.round(subtotal * .7) : subtotal < 300000 ? 50000 : subtotal < 500000 ? 100000
    : Math.round(subtotal * (subtotal < 1000000 ? .3 : subtotal < 2000000 ? .4 : .5));
  return Math.min(total, amount);
}

/** Only verified receipts count. The required deposit is never evidence of receipt. */
export function sumVerifiedPayments(payments: any[]): number {
  const seen = new Set<string>();
  return payments.reduce((sum, p) => {
    if (!paymentSucceeded(p.TRANG_THAI_THANH_TOAN)) return sum;
    const key = String(p.MA_GIAO_DICH || p.THANH_TOAN_ID || p._id || '');
    if (!key || seen.has(key)) return sum;
    seen.add(key);
    const value = Number(p.SO_TIEN);
    return sum + (Number.isSafeInteger(value) && value > 0 ? (p.LOAI_GIAO_DICH === 'HOAN_TIEN' ? -value : value) : 0);
  }, 0);
}

/** Một nguồn tính tiền dùng chung: khoản thu và khoản hoàn luôn tách riêng. */
export function summarizePayments(payments: any[], totalPayable = 0, requiredDeposit = 0) {
  const seen = new Set<string>();
  let successfulReceiptsTotal = 0;
  let actualRefundsTotal = 0;
  for (const payment of payments) {
    if (!paymentSucceeded(payment.TRANG_THAI_THANH_TOAN)) continue;
    const key = String(payment.MA_GIAO_DICH || payment.THANH_TOAN_ID || payment._id || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const amount = Number(payment.SO_TIEN);
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;
    if (payment.LOAI_GIAO_DICH === 'HOAN_TIEN') actualRefundsTotal += amount;
    else successfulReceiptsTotal += amount;
  }
  const netCollected = Math.max(0, successfulReceiptsTotal - actualRefundsTotal);
  const remainingAmount = Math.max(0, Number(totalPayable || 0) - successfulReceiptsTotal);
  const paymentStatus = remainingAmount === 0 && Number(totalPayable || 0) > 0 ? 'PAID'
    : successfulReceiptsTotal > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
  return { totalPayable:Number(totalPayable || 0), requiredDeposit:Number(requiredDeposit || 0), successfulReceiptsTotal,
    actualRefundsTotal, netCollected, remainingAmount, paymentStatus };
}

export function assertOrderTransition(order: any, next: string, paid: number) {
  const current = String(order.TRANG_THAI || '');
  if (current === next) return;
  const allowed: Record<string, string[]> = {
    'Chờ thanh toán': ['Đã hủy'], 'Thanh toán thất bại': ['Đã hủy'],
    // Đơn tạo từ Yêu cầu đặt hàng sau khi Sales xác nhận; thanh toán hợp lệ sẽ tự chuyển sang Đã đặt hàng thành công.
    'Đã xác nhận đơn hàng': ['Đã hủy'],
    'Đã đặt hàng thành công': ['Đang chuẩn bị hàng', 'Đã hủy'],
    'Chờ xử lý': ['Đang chuẩn bị hàng', 'Đã hủy'],
    'Đang chuẩn bị': ['Chờ vận chuyển'], 'Đang chuẩn bị hàng': ['Chờ vận chuyển'],
    'Chờ vận chuyển': ['Đang giao'], 'Đang giao': ['Đã giao', 'Giao hàng thành công', 'Giao không thành công'],
    'Đã giao': ['Hoàn thành'], 'Giao hàng thành công': ['Hoàn thành'],
    'Giao không thành công': ['Chờ vận chuyển'],
    'Yêu cầu hoàn tiền/trả hàng': ['Từ chối hoàn tiền/trả hàng'],
  };
  if (!allowed[current]?.includes(next)) throw new InventoryError(409, 'Không được bỏ qua bước hoặc đổi trạng thái theo luồng này. Hậu mãi cần hồ sơ xử lý riêng.');
  if (next === 'Từ chối hoàn tiền/trả hàng') return;
  if (next === 'Đã hủy') {
    if (order.THOI_DIEM_BAT_DAU_THUC_TE) throw new InventoryError(409, 'Đã bắt đầu chuẩn bị; cần xử lý hủy theo chính sách riêng.');
    return;
  }
  const due = /cod/i.test(String(order.PHUONG_THUC_THANH_TOAN)) ? Number(order.TIEN_COC || 0) : Number(order.TONG_TIEN || 0);
  if (paid < due) throw new InventoryError(409, 'Chưa xác minh đủ khoản thanh toán cần thiết.');
  if (/^Đang chuẩn bị/.test(next) && !order.THOI_DIEM_CHUAN_BI_DU_KIEN) throw new InventoryError(409, 'Nhân viên cần nhập thời điểm chuẩn bị dự kiến T.');
  if (next === 'Hoàn thành' && paid < Number(order.TONG_TIEN || 0)) throw new InventoryError(409, 'Cần xác minh đủ số dư trước khi hoàn thành đơn.');
}

const vnd = (value: number) => `${Math.max(0, Math.round(value)).toLocaleString('vi-VN')}đ`;
const MAIN_NEXT_STATUS: Record<string, string> = {
  'Chờ thanh toán': 'Đã đặt hàng thành công', 'Thanh toán thất bại': 'Đã đặt hàng thành công', 'Đã xác nhận đơn hàng': 'Đã đặt hàng thành công',
  'Đã đặt hàng thành công': 'Đang chuẩn bị hàng', 'Chờ xử lý': 'Đang chuẩn bị hàng',
  'Đang chuẩn bị': 'Chờ vận chuyển', 'Đang chuẩn bị hàng': 'Chờ vận chuyển', 'Chờ vận chuyển': 'Đang giao',
  'Đang giao': 'Đã giao', 'Giao không thành công': 'Chờ vận chuyển', 'Đã giao': 'Hoàn thành', 'Giao hàng thành công': 'Hoàn thành',
};
export type OrderNextStep = { nextStatus: string | null; blocked: boolean; reason: string; action: 'payment' | 'preparation' | 'start-preparation' | 'status' | 'after-sales' | 'none' };

/**
 * Giải thích bước tiếp theo của đơn cho Admin: đi tiếp được không, nếu không thì vì sao và cần làm gì.
 * Dùng đúng điều kiện của assertOrderTransition, không nới quy tắc.
 */
export function orderNextStep(order: any, paid: number): OrderNextStep {
  const current = String(order?.TRANG_THAI || '');
  const nextStatus = MAIN_NEXT_STATUS[current] || null;
  const total = Number(order?.TONG_TIEN || 0);
  const due = /cod/i.test(String(order?.PHUONG_THUC_THANH_TOAN)) ? Number(order?.TIEN_COC || 0) : total;
  if (['Hoàn thành', 'Đã hủy'].includes(current)) return { nextStatus: null, blocked: false, reason: 'Đơn đã kết thúc, không còn bước tiếp theo.', action: 'none' };
  if (!nextStatus) return { nextStatus: null, blocked: true, reason: 'Đơn đang trong quy trình hoàn tiền/trả hàng. Xử lý tại mục Chăm sóc khách hàng (hậu mãi).', action: 'after-sales' };
  if (nextStatus === 'Đã đặt hàng thành công') {
    return { nextStatus, blocked: true, action: 'payment',
      reason: `Đơn chưa ghi nhận thanh toán (cần ${vnd(due)}, đã thu ${vnd(paid)}). Ghi nhận giao dịch "Đã thanh toán" ở trang Thanh toán, đơn sẽ tự chuyển sang "Đã đặt hàng thành công".` };
  }
  const needsPayment = nextStatus !== 'Hoàn thành' && paid < due;
  if (needsPayment) {
    return { nextStatus, blocked: true, action: 'payment',
      reason: `Chưa ghi nhận đủ ${/cod/i.test(String(order?.PHUONG_THUC_THANH_TOAN)) ? 'tiền cọc' : 'tiền thanh toán'}: cần ${vnd(due)}, đã thu ${vnd(paid)} (còn thiếu ${vnd(due - paid)}). Ghi nhận giao dịch ở trang Thanh toán trước.` };
  }
  if (nextStatus === 'Hoàn thành' && paid < total) {
    return { nextStatus, blocked: true, action: 'payment',
      reason: `Chưa thu đủ tiền đơn: tổng ${vnd(total)}, đã thu ${vnd(paid)} (còn ${vnd(total - paid)}). Ghi nhận khoản còn lại ở trang Thanh toán trước khi hoàn thành.` };
  }
  if (nextStatus === 'Đang chuẩn bị hàng') {
    if (!order?.THOI_DIEM_CHUAN_BI_DU_KIEN) return { nextStatus, blocked: true, action: 'preparation',
      reason: 'Chưa có thời điểm chuẩn bị T. Nhập T ở khối "Thời điểm chuẩn bị đặt trước", bấm "Lưu T dự kiến" rồi bấm "Bắt đầu chuẩn bị".' };
    return { nextStatus, blocked: false, action: 'start-preparation',
      reason: 'Đã đủ điều kiện. Bấm "Bắt đầu chuẩn bị" ở khối "Thời điểm chuẩn bị đặt trước" (bước này kiểm tra và xuất NVL nên không chọn trong danh sách).' };
  }
  try { assertOrderTransition(order, nextStatus, paid); }
  catch (error: any) { return { nextStatus, blocked: true, action: 'status', reason: String(error?.message || 'Chưa đủ điều kiện chuyển bước.') }; }
  return { nextStatus, blocked: false, action: 'status', reason: `Có thể chuyển sang "${nextStatus}".` };
}

/* ===== Phân quyền cập nhật trạng thái theo vai trò =====
 * - Admin: mọi trạng thái hợp lệ theo luồng.
 * - Nhân viên kho: chỉ "Chờ vận chuyển" (cùng Admin là hai vai trò duy nhất được chuyển sang bước này).
 * - Nhân viên giao hàng: chỉ "Đang giao", "Giao thành công" và "Giao không thành công".
 * - Vai trò khác có quyền đơn hàng: không được chuyển sang "Chờ vận chuyển".
 */
export const WAREHOUSE_ORDER_STATUSES = ['Chờ vận chuyển'];
export const SHIPPER_ORDER_STATUSES = ['Đang giao', 'Đã giao', 'Giao hàng thành công', 'Giao không thành công'];
const WAREHOUSE_ORDER_ACTIONS = ['note', 'preparation', 'start-preparation', 'handover-media'];
const SHIPPER_ORDER_ACTIONS = ['handover-media'];

export type OrderStaffKind = 'admin' | 'warehouse' | 'shipper' | 'other';
export function orderStaffKind(role: unknown): OrderStaffKind {
  const key = statusKey(role);
  if (key === 'admin') return 'admin';
  if (/\bkho\b/.test(key)) return 'warehouse';
  if (/giao hang|shipper|van chuyen/.test(key)) return 'shipper';
  return 'other';
}

export function roleCanSetOrderStatus(role: unknown, next: string): boolean {
  const kind = orderStaffKind(role);
  if (kind === 'admin') return true;
  if (kind === 'warehouse') return WAREHOUSE_ORDER_STATUSES.includes(next);
  if (kind === 'shipper') return SHIPPER_ORDER_STATUSES.includes(next);
  return !WAREHOUSE_ORDER_STATUSES.includes(next);
}

export function assertRoleCanSetOrderStatus(role: unknown, next: string) {
  if (roleCanSetOrderStatus(role, next)) return;
  const kind = orderStaffKind(role);
  const message = WAREHOUSE_ORDER_STATUSES.includes(next)
    ? 'Chỉ Admin hoặc nhân viên kho được chuyển đơn sang "Chờ vận chuyển".'
    : kind === 'shipper' ? 'Nhân viên giao hàng chỉ được cập nhật "Đang giao", "Giao thành công" hoặc "Giao không thành công".'
    : kind === 'warehouse' ? 'Nhân viên kho chỉ được chuyển đơn sang "Chờ vận chuyển".'
    : 'Vai trò của bạn không được cập nhật trạng thái này.';
  throw new InventoryError(403, message);
}

export function assertRoleCanDoOrderAction(role: unknown, action: string) {
  const kind = orderStaffKind(role);
  if (kind === 'warehouse' && !WAREHOUSE_ORDER_ACTIONS.includes(action)) throw new InventoryError(403, 'Nhân viên kho không được thực hiện thao tác này trên đơn hàng.');
  if (kind === 'shipper' && !SHIPPER_ORDER_ACTIONS.includes(action)) throw new InventoryError(403, 'Nhân viên giao hàng không được thực hiện thao tác này trên đơn hàng.');
}

export function allowedOrderStatuses(order: any, paid: number, role?: unknown): string[] {
  return ['Đang chuẩn bị hàng', 'Chờ vận chuyển', 'Đang giao', 'Đã giao', 'Hoàn thành', 'Giao không thành công', 'Đã hủy', 'Từ chối hoàn tiền/trả hàng'].filter(next => {
    if (next === 'Đang chuẩn bị hàng') return false; // command Bắt đầu chuẩn bị kiểm tra/xuất kho riêng
    if (next === order.TRANG_THAI) return false;
    if (role !== undefined && !roleCanSetOrderStatus(role, next)) return false;
    try { assertOrderTransition(order, next, paid); return true; } catch { return false; }
  });
}

export function validateCheckoutDelivery(delivery: any) {
  const input = String(delivery?.date || '');
  const date = /^\d{2}\/\d{2}\/\d{4}$/.test(input) ? input.split('/').reverse().join('-') : input;
  const slot = String(delivery?.time || '').trim();
  const matches = [...slot.matchAll(/(\d{1,2}):([0-5]\d)\s*(AM|PM)?/gi)];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !matches.length || matches.length > 2 || slot.replace(/\d{1,2}:[0-5]\d\s*(?:AM|PM)?/gi, '').replace(/[\s–—-]/g, '')) throw new InventoryError(400, 'Cần ngày và giờ giao hợp lệ.');
  const values = matches.map(m => {
    let hour = Number(m[1]);
    if (m[3]) {
      if (hour < 1 || hour > 12) throw new InventoryError(400, 'Giờ giao không hợp lệ.');
      hour = hour % 12 + (m[3].toUpperCase() === 'PM' ? 12 : 0);
    }
    if (hour > 23) throw new InventoryError(400, 'Giờ giao không hợp lệ.');
    return `${String(hour).padStart(2, '0')}:${m[2]}`;
  });
  if (values.length === 2 && values[0] >= values[1]) throw new InventoryError(400, 'Khung giờ giao không hợp lệ.');
  const at = new Date(`${date}T${values[values.length - 1]}:00+07:00`);
  const startAt = new Date(`${date}T${values[0]}:00+07:00`);
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(at.getTime()) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date || startAt.getTime() <= Date.now()) throw new InventoryError(400, 'Ngày giao không tồn tại hoặc lịch giao đã qua.', { code: 'DELIVERY_IN_PAST' });
  // Cả khung giờ phải nằm trong 08:00–22:00; không tự chuyển lịch ngoài giờ thành yêu cầu Sales.
  assertWithinShopHours(startAt, at);
  return { ...delivery, date, time: slot, deliveryAt: at.toISOString(), deliveryStartAt: startAt.toISOString() };
}

/** Mirrors the existing storefront tariff; no new deposit/cutoff policy is introduced. */
export async function priceCheckout(payload: any, session?: ClientSession, collections: typeof getCollection = getCollection) {
  const delivery = validateCheckoutDelivery(payload.delivery);
  if (String(delivery.message || '').length > 2000 || String(delivery.noteShop || '').length > 2000 || String(payload.adminNote || '').length > 2000) throw new InventoryError(400, 'Nội dung thiệp hoặc ghi chú tối đa 2.000 ký tự.');
  const items: any[] = [];
  const merged = new Map<string, number>();
  for (const item of payload.items || []) {
    const id = String(item.id || item.productId || item.SAN_PHAM_ID || '');
    const qty = Number(item.qty ?? item.quantity ?? item.SO_LUONG);
    if (!id || !Number.isSafeInteger(qty) || qty <= 0 || qty > 1000) throw new InventoryError(400, 'Sản phẩm hoặc số lượng không hợp lệ.');
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  if (!merged.size) throw new InventoryError(400, 'Đơn hàng chưa có sản phẩm.');
  const productIds = [...merged.keys()];
  const productCollection = await collections<any>('SAN_PHAM');
  const imageCollection = await collections<any>('HINH_ANH_SAN_PHAM');
  const productCursor: any = productCollection.find({ SAN_PHAM_ID: { $in: productIds } }, { session });
  const imageCursor: any = imageCollection.find({ SAN_PHAM_ID: { $in: productIds } }, { session }).sort({ SAN_PHAM_ID: 1, LA_ANH_CHINH: -1, HINH_ANH_ID: 1 });
  const [customer, products, images] = await Promise.all([
    payload.customerId ? (await collections<any>('KHACH_HANG')).findOne({ KHACH_HANG_ID: payload.customerId }, { session }) : Promise.resolve(null),
    typeof productCursor.toArray === 'function' ? productCursor.toArray() : Promise.all(productIds.map(id => productCollection.findOne({ SAN_PHAM_ID: id }, { session }))).then(rows => rows.filter(Boolean)),
    typeof imageCursor.toArray === 'function' ? imageCursor.toArray() : Promise.all(productIds.map(async id => {
      const row = await imageCollection.find({ SAN_PHAM_ID: id }, { session }).sort({ LA_ANH_CHINH: -1, HINH_ANH_ID: 1 }).limit(1).next();
      return row ? { ...row, SAN_PHAM_ID: row.SAN_PHAM_ID || id } : null;
    })).then(rows => rows.filter(Boolean)),
  ]);
  if (payload.customerId && (!customer || customer.DA_XOA === true || customer.DA_XOA === 1)) throw new InventoryError(400, 'Không tìm thấy tài khoản khách hàng hợp lệ.');
  const productById = new Map(products.map((product: any) => [product.SAN_PHAM_ID, product]));
  const imageByProduct = new Map<string, any>();
  for (const image of images) if (!imageByProduct.has(image.SAN_PHAM_ID)) imageByProduct.set(image.SAN_PHAM_ID, image);
  for (const [id, qty] of merged) {
    if (qty > 1000) throw new InventoryError(400, 'Số lượng gộp vượt giới hạn.');
    const product: any = productById.get(id);
    if (!product || /ngừng|ngưng|ẩn|khóa|đã xóa/i.test(String(product.TRANG_THAI || ''))) throw new InventoryError(400, `Sản phẩm ${id} không còn bán.`);
    const regular = Number(product.GIA), sale = Number(product.GIA_KHUYEN_MAI);
    const price = sale > 0 && sale < regular ? sale : regular;
    if (!Number.isSafeInteger(price) || price <= 0) throw new InventoryError(409, `Sản phẩm ${id} chưa có giá hợp lệ.`);
    const image = imageByProduct.get(id);
    items.push({ id, qty, price, name: product.TEN_SAN_PHAM, image: image?.URL || '' });
  }
  const subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0);
  if (!Number.isSafeInteger(subtotal)) throw new InventoryError(400, 'Giá trị đơn vượt giới hạn tính toán.');
  const address = statusKey(payload.receiver?.address);
  const district = statusKey(payload.receiver?.districtName);
  const inner = ['Quận 1','Quận 3','Quận 4','Quận 5','Quận 6','Quận 7','Quận 8','Quận 10','Quận 11','Quận Bình Thạnh','Quận Phú Nhuận','Quận Tân Bình','Quận Tân Phú','Quận Gò Vấp'].map(statusKey);
  const outer = ['Quận 2','Quận 9','Quận 12','Quận Bình Tân','Thành phố Thủ Đức','Huyện Bình Chánh','Huyện Cần Giờ','Huyện Củ Chi','Huyện Hóc Môn','Huyện Nhà Bè'].map(statusKey);
  const selected = [...inner, ...outer].find(d => address.split(',').some(part => part.trim() === d));
  if (!selected || district && district !== selected || !/ho chi minh|\bhcm\b/.test(address)) throw new InventoryError(400, 'Cần địa chỉ và quận/huyện thuộc Thành phố Hồ Chí Minh để tính phí giao.');
  const method = String(payload.shippingMethod || 'standard');
  if (!['standard', 'fast'].includes(method)) throw new InventoryError(400, 'Phương thức giao hàng không hợp lệ.');
  const fast = method === 'fast', isInner = inner.includes(selected);
  const baseShippingFee = isInner ? (fast ? subtotal < 300000 ? 60000 : subtotal <= 500000 ? 30000 : 0 : subtotal < 300000 ? 30000 : 0)
    : (fast ? subtotal < 300000 ? 80000 : subtotal <= 500000 ? 40000 : 30000 : subtotal < 300000 ? 40000 : subtotal <= 500000 ? 20000 : 0);
  let voucher: any = null, productDiscount = 0, shippingDiscount = 0;
  if (payload.voucher?.id || payload.voucher?.code) {
    // Một bộ luật voucher duy nhất (voucher-policy.service) cho danh sách, báo giá và đặt hàng.
    const voucherCollection = await collections<any>('VOUCHER');
    const code = String(payload.voucher.code || '').trim().toUpperCase();
    voucher = payload.voucher.id
      ? await voucherCollection.findOne({ VOUCHER_ID: String(payload.voucher.id) }, { session })
      : await voucherCollection.findOne({ $or: [{ MA_VOUCHER_CHUAN: code }, { MA_VOUCHER: code }] }, { session });
    const { contextFor } = await loadVoucherContext(payload.customerId || null, items.map(i => ({ id: i.id, qty: i.qty, price: i.price })), baseShippingFee, session, collections);
    const result = evaluateVoucher(voucher, contextFor(voucher));
    if (!result.ok) throw new InventoryError(400, result.reason);
    productDiscount = result.productDiscount;
    shippingDiscount = result.shippingDiscount;
  }
  const loyaltyPoints = Number(payload.summary?.loyaltyPoints || 0);
  if (!Number.isSafeInteger(loyaltyPoints) || loyaltyPoints < 0 || loyaltyPoints % 2) throw new InventoryError(400, 'Điểm sử dụng phải là số chẵn không âm.');
  const loyaltyDiscount = loyaltyPoints / 2 * 1000;
  if (loyaltyPoints) {
    if (!customer || loyaltyPoints > Number(customer.DIEM_TICH_LUY || 0) || loyaltyDiscount > subtotal - productDiscount) throw new InventoryError(400, 'Không đủ điểm hoặc mức giảm vượt tiền hàng.');
  }
  let card: any = null;
  const cardId = String(payload.giftCard?.templateId || '').trim();
  if (cardId) {
    card = await (await collections<any>('CARD_TEMPLATE')).findOne({ CARD_TEMPLATE_ID: cardId }, { session });
    if (!card || !['active', 'đang dùng', 'hoạt động'].includes(statusKey(card.TRANG_THAI))) throw new InventoryError(400, 'Mẫu thiệp không còn khả dụng.');
  }
  const writingMode = String(payload.giftCard?.writingMode || '').trim();
  if (card && !['customer', 'shop'].includes(writingMode)) throw new InventoryError(400, 'Chọn tự viết thiệp hoặc nhờ shop viết.');
  const cardMessage = card && writingMode === 'shop' ? String(payload.giftCard?.message || delivery.message || '').trim() : '';
  if (card && writingMode === 'shop' && !cardMessage) throw new InventoryError(400, 'Vui lòng nhập nội dung thiệp.');
  const cardNote = String(payload.giftCard?.note || '').trim();
  if (cardMessage.length > 500) throw new InventoryError(400, 'Lời nhắn trên thiệp tối đa 500 ký tự.');
  if (cardNote.length > 500) throw new InventoryError(400, 'Ghi chú thiệp tối đa 500 ký tự.');
  const cardFee = card ? Number(card.PHU_PHI || 0) : 0;
  if (!Number.isSafeInteger(cardFee) || cardFee < 0) throw new InventoryError(409, 'Phụ phí thiệp chưa hợp lệ.');
  const shippingFee = baseShippingFee - shippingDiscount;
  const total = subtotal + shippingFee + cardFee - productDiscount - loyaltyDiscount;
  const paymentMethod = String(payload.payment?.method || '');
  if (!['cod','bank','momo','vnpay'].includes(paymentMethod)) throw new InventoryError(400, 'Phương thức thanh toán không được hỗ trợ.');
  let depositAmount = 0;
  if (paymentMethod === 'cod') {
    depositAmount = depositByPolicy(subtotal, total, items);
  }
  return { ...payload, delivery: { ...delivery, message: cardMessage }, giftCard: card ? { templateId: card.CARD_TEMPLATE_ID, code: card.MA_THIEP, name: card.TEN_THIEP, theme: card.CHU_DE, type: card.LOAI, image: card.HINH_ANH, fee: cardFee, writingMode, message: cardMessage, note: cardNote } : null, items, summary: { subtotal, shippingFee, baseShippingFee, cardFee, productDiscount, shippingDiscount, loyaltyPoints, loyaltyDiscount, depositAmount, total },
    payment: { method: paymentMethod, methodName: ({ cod: 'COD', bank: 'Chuyển khoản', momo: 'MoMo', vnpay: 'VNPay' } as Record<string,string>)[paymentMethod] }, validatedVoucher: voucher };
}

export interface AdminOrderProductDto {
  id: string;
  name: string;
  image: string;
  qty: number;
  price: number;
}

export interface AdminOrderDetailDto {
  snapshotAvailable: boolean;
  allowedStatuses: string[];
  nextStep: OrderNextStep;
  history: any[];
  preparationAt: string | null;
  preparationStartedAt: string | null;
  preparationStartedBy: string | null;
  materialIssued: boolean;
  materialExportId: string | null;
  preparationHistory: any[];
  preparationPriority: { level: string; label: string; minutesToT: number | null };
  id: string;
  requestId: string | null;
  orderVersion: string | null;
  orderStatus: string;
  paymentStatus: string;
  createdAt: string;
  createdTime: string;
  estimatedDelivery: string;
  senderName: string;
  senderCustomerId: string;
  senderPhone: string;
  senderEmail: string;
  senderAvatar: string;
  receiverName: string;
  receiverPhone: string;
  receiverEmail: string;
  deliveryDate: string;
  deliverySlot: string;
  deliveryAddress: string;
  shipperName: string;
  shipperPhone: string;
  shipperAvatar: string;
  products: AdminOrderProductDto[];
  customerNote: string;
  cardTemplate: string;
  cardMessage: string;
  giftCard?: any;
  handoverMedia: string[];
  subtotal: number;
  shippingFee: number;
  voucher: string | null;
  voucherDiscount: number;
  loyaltyPoints: number;
  loyaltyDiscount: number;
  tax: number;
  total: number;
  paid: number;
  refunded: number;
  remaining: number;
  paymentSummary: ReturnType<typeof summarizePayments>;
  paymentMethod: string;
  adminNote: string;
  adminNoteTime: string;
  supportDeadline: string | null;
  supportException: any;
  reviewId: string;
  rating: number;
  reviewText: string;
  reviewTime: string;
  adminReplyText: string;
  adminReplyTime: string;
  refundReason: string;
  adminRejectReason: string;
  raw: {
    hiddenInfo: boolean;
    requireVat: boolean;
    sendGiftImageToZalo: boolean;
    deliveryEdited: boolean;
  };
}

const formatDate = (value: Date | string | null | undefined): string => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const formatTime = (value: Date | string | null | undefined): string => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
};

const repairMojibakeText = (value: unknown): string => {
  const raw = String(value || '');
  if (!/[\u00c2\u00c3\u00c4\u00c6\u00e1]/.test(raw)) return raw;

  try {
    const repaired = Buffer.from(raw, 'latin1').toString('utf8');
    return repaired.includes('�') ? raw : repaired;
  } catch {
    return raw;
  }
};

const textKey = (value: unknown): string => repairMojibakeText(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .replace(/[�\?]/g, '')
  .toLowerCase();

const normalizeOrderStatus = (status: unknown): string => {
  const raw = repairMojibakeText(status).trim();
  const key = textKey(raw);

  if (!raw) return 'Đã đặt hàng thành công';
  if (key.includes('van chuyen')) return 'Chờ vận chuyển';
  if (/\bhuy\b/.test(key) || key.includes('da huy')) return 'Đã hủy';
  if (key.includes('hoan thanh')) return 'Hoàn thành';
  if (key.includes('da giao')) return 'Đã giao';
  if (key.includes('dang giao')) return 'Đang giao';
  if (key.includes('chuan bi')) return 'Đang chuẩn bị hàng';
  if (key.includes('dat hang thanh cong')) return 'Đã đặt hàng thành công';
  if (key.includes('thanh to') && key.includes('bai')) return 'Thanh toán thất bại';
  if (key.includes('thanh to') || key.includes('cho thanh to') || key.includes('ch thanh to')) return 'Chờ thanh toán';

  return raw;
};

const normalizePaymentStatus = (status: unknown, deposit: unknown, total: unknown, paidAmount: unknown = 0): string => {
  const raw = repairMojibakeText(status).trim();
  const key = textKey(raw);
  const depositAmount = Number(deposit || 0);
  const totalAmount = Number(total || 0);
  const paid = Math.max(Number(paidAmount || 0), depositAmount);

  if (key.includes('that bai') || key.includes('failed') || key.includes('fail') || (key.includes('thanh to') && key.includes('bai'))) {
    return 'Thanh toán thất bại';
  }

  if (key.includes('thanh cong') || key.includes('da thanh toan') || key.includes('success')) {
    return 'Đã thanh toán';
  }

  if (key.includes('coc')) return 'Đã cọc';
  if (key.includes('dang') || key.includes('pending')) return 'Chờ thanh toán';
  if (key.includes('chua') || key.includes('cho')) return 'Chờ thanh toán';
  if (paid > 0 && totalAmount > 0 && paid >= totalAmount) return 'Đã thanh toán';
  if (paid > 0) return 'Đã cọc';

  return 'Chờ thanh toán';
};

const normalizeLatestPaymentStatus = (
  status: unknown,
  deposit: unknown,
  total: unknown = 0,
  paidAmount: unknown = 0,
): string => {
  const key = textKey(status);
  if (key) return normalizePaymentStatus(status, 0, 0, 0);
  return normalizePaymentStatus('', deposit, total, paidAmount);
};

const boolFromSql = (value: unknown): boolean => value === true || value === 1 || value === '1';

const getPrimaryImages = async (productIds: string[]) => {
  const imageCollection = await getCollection<any>('HINH_ANH_SAN_PHAM');
  const images = await imageCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray();
  const imageMap = new Map<string, any>();

  for (const image of images.sort((left, right) => {
    if (Boolean(left.LA_ANH_CHINH) !== Boolean(right.LA_ANH_CHINH)) {
      return Boolean(left.LA_ANH_CHINH) ? -1 : 1;
    }
    return String(left.HINH_ANH_ID || '').localeCompare(String(right.HINH_ANH_ID || ''), 'vi');
  })) {
    if (!imageMap.has(image.SAN_PHAM_ID)) {
      imageMap.set(image.SAN_PHAM_ID, image);
    }
  }

  return imageMap;
};

export const getAdminOrderDetailById = async (orderId: string, role?: unknown): Promise<AdminOrderDetailDto | null> => {
  const [
    orderCollection,
    customerCollection,
    paymentCollection,
    itemCollection,
    productCollection,
    reviewCollection,
  ] = await Promise.all([
    getCollection<any>('DON_HANG'),
    getCollection<any>('KHACH_HANG'),
    getCollection<any>('THANH_TOAN'),
    getCollection<any>('DON_HANG_CHI_TIET'),
    getCollection<any>('SAN_PHAM'),
    getCollection<any>('DANH_GIA'),
  ]);
  const order = await orderCollection.findOne({ DON_HANG_ID: orderId });
  if (!order) return null;

  const [customer, payments, items, review] = await Promise.all([
    order.KHACH_HANG_ID ? customerCollection.findOne({ KHACH_HANG_ID: order.KHACH_HANG_ID }) : null,
    paymentCollection.find({ DON_HANG_ID: orderId }).toArray(),
    itemCollection.find({ DON_HANG_ID: orderId }).sort({ SAN_PHAM_ID: 1 }).toArray(),
    reviewCollection.findOne({ DON_HANG_ID: orderId }, { sort: { NGAY_DANH_GIA: -1, DANH_GIA_ID: -1 } }),
  ]);
  const productIds = items.map((item) => item.SAN_PHAM_ID).filter(Boolean);
  const [productsRaw, imageMap] = await Promise.all([
    productCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
    getPrimaryImages(productIds),
  ]);
  const productMap = new Map(productsRaw.map((product) => [product.SAN_PHAM_ID, product]));
  const products = items.map((item) => {
    const product = productMap.get(item.SAN_PHAM_ID);
    const image = imageMap.get(item.SAN_PHAM_ID);
    return {
      id: item.SAN_PHAM_ID || '',
      name: item.TEN_SAN_PHAM_SNAPSHOT || product?.TEN_SAN_PHAM || item.SAN_PHAM_ID || 'Sản phẩm',
      image: item.HINH_ANH_SNAPSHOT || image?.URL || 'assets/images/logo-main.png',
      qty: Number(item.SO_LUONG || 0),
      price: Number(item.GIA || 0),
    };
  });

  const latestPayment = payments.sort((left, right) => {
    const dateDiff = new Date(right.NGAY_THANH_TOAN || 0).getTime() - new Date(left.NGAY_THANH_TOAN || 0).getTime();
    if (dateDiff !== 0) return dateDiff;
    return String(right.THANH_TOAN_ID || '').localeCompare(String(left.THANH_TOAN_ID || ''), 'vi');
  })[0] || null;
  const paymentSummary = summarizePayments(payments, Number(order.TONG_TIEN || 0), Number(order.TIEN_COC || 0));
  const paidAmount = paymentSummary.successfulReceiptsTotal;
  const reviewTime = review?.NGAY_DANH_GIA
    ? `${formatDate(review.NGAY_DANH_GIA)} ${formatTime(review.NGAY_DANH_GIA)}`.trim()
    : '';
  const adminReplyTime = review?.NGAY_PHAN_HOI_SHOP
    ? `${formatDate(review.NGAY_PHAN_HOI_SHOP)} ${formatTime(review.NGAY_PHAN_HOI_SHOP)}`.trim()
    : '';
  const noteParts = String(order.GHI_CHU || '')
    .split(' | ')
    .map((part) => part.trim())
    .filter(Boolean);
  const customerNote = noteParts[0] || '';
  const adminNote = order.GHI_CHU_NOI_BO || (noteParts.length > 1 ? noteParts.slice(1).join(' | ') : '');
  const noteEvent = [...(order.LICH_SU_TRANG_THAI || [])].reverse().find(event => event.action === 'note');
  const adminNoteTime = adminNote && noteEvent
    ? `${noteEvent.actor || 'Nhân viên'} | ${formatDate(noteEvent.at)} ${formatTime(noteEvent.at)}`.trim()
    : '';
  const total = Number(order.TONG_TIEN || 0);
  const voucherLinks = await (await getCollection<any>('DON_HANG_VOUCHER')).find({ DON_HANG_ID: orderId }).toArray();
  const voucherRows = await (await getCollection<any>('VOUCHER')).find({ VOUCHER_ID: { $in: voucherLinks.map(v => v.VOUCHER_ID) } }).toArray();
  const voucherLabel = voucherLinks.map(v => v.UU_DAI_SNAPSHOT?.MA_VOUCHER || voucherRows.find(r => r.VOUCHER_ID === v.VOUCHER_ID)?.MA_VOUCHER || v.VOUCHER_ID).join(', ');
  const deposit = Number(order.TIEN_COC || 0);
  const paid = paidAmount;
  const paymentStatus = total === 0 && paymentSucceeded(latestPayment?.TRANG_THAI_THANH_TOAN) ? 'Đã thanh toán' : paid > 0 ? (paid >= total ? 'Đã thanh toán' : 'Đã cọc')
    : /thất bại/i.test(String(latestPayment?.TRANG_THAI_THANH_TOAN)) ? 'Thanh toán thất bại' : 'Chờ thanh toán';

  const plannedAt = order.THOI_DIEM_CHUAN_BI_DU_KIEN ? new Date(order.THOI_DIEM_CHUAN_BI_DU_KIEN) : null;
  const minutesToT = plannedAt && Number.isFinite(plannedAt.getTime()) ? Math.round((plannedAt.getTime() - Date.now()) / 60000) : null;
  const preparationPriority = order.THOI_DIEM_BAT_DAU_THUC_TE || ['Hoàn thành', 'Đã hủy'].includes(String(order.TRANG_THAI)) || minutesToT === null
    ? { level: 'none', label: '', minutesToT }
    : minutesToT < 0 ? { level: 'overdue', label: 'Quá T, chưa bắt đầu', minutesToT }
      : minutesToT <= 60 ? { level: 'urgent', label: 'Khẩn cấp', minutesToT }
        : minutesToT <= 180 ? { level: 'high', label: 'Ưu tiên cao', minutesToT }
          : minutesToT <= 1440 ? { level: 'soon', label: 'Sắp đến lịch', minutesToT }
            : { level: 'normal', label: 'Bình thường', minutesToT };
  return {
    allowedStatuses: allowedOrderStatuses(order, paid, role),
    nextStep: orderNextStep(order, paid),
    snapshotAvailable: !!order.TINH_TIEN_SNAPSHOT && items.every(item => !!item.TEN_SAN_PHAM_SNAPSHOT),
    history: order.LICH_SU_TRANG_THAI || [],
    preparationHistory: order.LICH_SU_T || [],
    preparationAt: order.THOI_DIEM_CHUAN_BI_DU_KIEN ? new Date(order.THOI_DIEM_CHUAN_BI_DU_KIEN).toISOString() : null,
    preparationStartedAt: order.THOI_DIEM_BAT_DAU_THUC_TE ? new Date(order.THOI_DIEM_BAT_DAU_THUC_TE).toISOString() : null,
    preparationStartedBy: order.NGUOI_BAT_DAU_CHUAN_BI || null,
    materialIssued: !!order.DA_XUAT_NVL,
    materialExportId: order.PHIEU_XUAT_NVL_ID || null,
    preparationPriority,
    id: order.DON_HANG_ID,
    requestId: order.YEU_CAU_DAT_HANG_ID || null,
    orderVersion: order.NGAY_CAP_NHAT ? new Date(order.NGAY_CAP_NHAT).toISOString() : null,
    orderStatus: normalizeOrderStatus(order.TRANG_THAI),
    paymentStatus,
    createdAt: formatDate(order.NGAY_TAO),
    createdTime: formatTime(order.NGAY_TAO),
    estimatedDelivery: order.KHUNG_GIO_MUON_GIAO || '',
    senderName: order.TEN_NGUOI_DAT || customer?.TEN || 'Khách lẻ',
    senderCustomerId: order.KHACH_HANG_ID || '',
    senderPhone: order.SDT_NGUOI_DAT || customer?.SDT || '',
    senderEmail: order.EMAIL_NGUOI_DAT || customer?.EMAIL || '',
    senderAvatar: customer?.AVATAR || '',
    receiverName: order.TEN_NGUOI_NHAN || '',
    receiverPhone: order.SDT_NGUOI_NHAN || '',
    receiverEmail: '',
    deliveryDate: formatDate(order.NGAY_MUON_GIAO),
    deliverySlot: slot24h(order.KHUNG_GIO_MUON_GIAO),
    deliveryAddress: cleanAddress(order.DIA_CHI_GIAO_HANG),
    shipperName: order.NHAN_VIEN_GIAO_HANG?.name || order.TEN_NHAN_VIEN_GIAO || '',
    shipperPhone: order.NHAN_VIEN_GIAO_HANG?.phone || '',
    shipperAvatar: order.NHAN_VIEN_GIAO_HANG?.avatar || 'assets/images/logo-main.png',
    products,
    customerNote,
    cardTemplate: order.THIEP_TANG?.name || (order.LOI_NHAN_THIEP ? 'Thiệp cơ bản' : 'Không có thiệp'),
    cardMessage: order.THIEP_TANG?.message || order.LOI_NHAN_THIEP || '',
    giftCard: order.THIEP_TANG || null,
    handoverMedia: Array.isArray(order.MEDIA_BAN_GIAO) ? order.MEDIA_BAN_GIAO : [],
    subtotal: Number(order.TAM_TINH || 0),
    shippingFee: Number(order.PHI_VAN_CHUYEN || 0),
    voucher: voucherLabel || null,
    voucherDiscount: Number(order.TINH_TIEN_SNAPSHOT?.productDiscount || 0) + Number(order.TINH_TIEN_SNAPSHOT?.shippingDiscount || 0),
    loyaltyPoints: Number(order.DIEM_THUONG_SU_DUNG || 0),
    loyaltyDiscount: Number(order.TINH_TIEN_SNAPSHOT?.loyaltyDiscount || 0),
    tax: Number(order.VAT || 0),
    total,
    paid,
    refunded: paymentSummary.actualRefundsTotal,
    remaining: Math.max(total - paid, 0),
    paymentSummary,
    paymentMethod: latestPayment?.CONG_THANH_TOAN || order.PHUONG_THUC_THANH_TOAN || '',
    adminNote,
    adminNoteTime,
    supportDeadline: supportDeadline(order)?.toISOString() || null,
    supportException: order.HO_TRO_NGOAI_LE || null,
    reviewId: review?.DANH_GIA_ID || '',
    rating: Number(review?.SO_SAO || 0),
    reviewText: review?.NOI_DUNG || '',
    reviewTime,
    adminReplyText: review?.PHAN_HOI_SHOP || '',
    adminReplyTime,
    refundReason: order.LY_DO_HOAN_TIEN_TRA_HANG || '',
    adminRejectReason: order.LY_DO_TU_CHOI || '',
    raw: {
      hiddenInfo: boolFromSql(order.AN_THONG_TIN),
      requireVat: boolFromSql(order.YEU_CAU_VAT),
      sendGiftImageToZalo: boolFromSql(order.GUI_ANH_QUA_ZALO),
      deliveryEdited: boolFromSql(order.DA_CHINH_SUA_GIAO_HANG),
    },
  };
};


export const AFTER_SALES = 'YEU_CAU_HAU_MAI';
export const REFUND_LEDGER = 'HOAN_TIEN';
export const AFTER_SALES_STATUS = {
  submitted: 'Đã gửi yêu cầu', reviewing: 'Đang xem xét', needInfo: 'Cần bổ sung thông tin',
  approved: 'Đã phê duyệt', rejected: 'Đã từ chối', executing: 'Đang thực hiện phương án',
  refundPending: 'Chờ hoàn tiền', refundReview: 'Cần đối soát hoàn tiền', completed: 'Đã xử lý xong',
} as const;
export async function orderEvent(session: ClientSession | undefined, key: string, customerId: string | null, orderId: string | null, title: string, message: string, link?: string) {
  if (!customerId) return; // Guest sees private order/request history, never a public notification.
  const id = 'EV:' + key;
  await (await getCollection<any>('THONG_BAO')).updateOne({ _id: id }, { $setOnInsert: {
    THONG_BAO_ID: id, KHACH_HANG_ID: customerId, DON_HANG_ID: orderId, LOAI_THONG_BAO: 'order', TIEU_DE: title,
    NOI_DUNG: message, HINH_ANH: null, DUONG_DAN: link || '/order-detail/' + orderId, DA_DOC: false, DA_XEM: false, NGAY_TAO: new Date()
  } }, { upsert: true, ...(session ? { session } : {}) });
}
export function refundableAmount(receipts: any[]): number { return Math.max(0, sumVerifiedPayments(receipts)); }

/* ===== Hạn gửi hỗ trợ sau giao hàng =====
 * Khách được gửi yêu cầu hỗ trợ (trả hàng, hoàn tiền, khiếu nại…) trong 1 giờ kể từ lúc giao thành công.
 * Hết 1 giờ mà không có yêu cầu nào thì đơn tự chuyển "Hoàn thành".
 */
export const SUPPORT_WINDOW_MS = 60 * 60 * 1000;
export const DELIVERED_ORDER_STATUSES = ['Đã giao', 'Giao thành công', 'Giao hàng thành công'];

/** Thời điểm giao thành công: trường đã lưu, nếu không có thì lấy từ lịch sử trạng thái. */
export function orderDeliveredAt(order: any): Date | null {
  const direct = order?.NGAY_GIAO_THUC_TE || order?.DA_GIAO_LUC;
  if (direct) {
    const value = new Date(direct);
    if (Number.isFinite(value.getTime())) return value;
  }
  const history: any[] = Array.isArray(order?.LICH_SU_TRANG_THAI) ? order.LICH_SU_TRANG_THAI : [];
  for (let index = history.length - 1; index >= 0; index--) {
    const row = history[index];
    if (DELIVERED_ORDER_STATUSES.includes(String(row?.to || '')) && row?.at) {
      const value = new Date(row.at);
      if (Number.isFinite(value.getTime())) return value;
    }
  }
  return null;
}

/** Hạn gửi hỗ trợ = giao thành công + 1 giờ; nếu nhân viên mở ngoại lệ thì lấy mốc ngoại lệ muộn hơn. */
export function supportDeadline(order: any): Date | null {
  const deliveredAt = orderDeliveredAt(order);
  const normal = deliveredAt ? deliveredAt.getTime() + SUPPORT_WINDOW_MS : NaN;
  const exceptionUntil = order?.HO_TRO_NGOAI_LE?.until ? new Date(order.HO_TRO_NGOAI_LE.until).getTime() : NaN;
  const latest = Math.max(Number.isFinite(normal) ? normal : -Infinity, Number.isFinite(exceptionUntil) ? exceptionUntil : -Infinity);
  return Number.isFinite(latest) ? new Date(latest) : null;
}

/* ===== Quy tắc hậu mãi (THY-AFTER-SALES-2026-11) ===== */
export const AFTER_SALES_SLA_MS = 60 * 60 * 1000; // tiếp nhận / quyết định / khách bổ sung: mỗi bước 1 giờ
/** Lỗi về hoa và giao hàng: bắt buộc có ít nhất 1 ảnh/video. */
export const EVIDENCE_REQUIRED_ISSUES = ['damaged', 'partial_damage', 'wrong_item', 'missing_accessory', 'wrong_address'];
/** Lỗi do shop: hoàn 100% giá trị sản phẩm lỗi + phí ship. */
export const SHOP_FAULT_ISSUES = ['damaged', 'wrong_item', 'wrong_address', 'shop_unable'];
export const PARTIAL_DAMAGE_MIN_RATE = 0.3;
export const SECOND_APPROVAL_AMOUNT = 2_000_000;
export const SECOND_APPROVAL_RATE = 0.5;
export const ADMIN_APPROVAL_STATUS = 'Chờ Admin duyệt';

export type RefundSuggestion = { amount: number; minAmount: number; rate: number; affectedValue: number; shipping: number; basis: string };

/**
 * Mức hoàn gợi ý (tiền mặt), tính theo giá sau giảm giá. Quy tắc: KHÔNG trả lại điểm thưởng và voucher đã dùng,
 * và phần giá trị đã trả bằng điểm/voucher cũng không quy ra tiền mặt.
 * Không vượt quá tiền đã thực thu của đơn.
 */
export function suggestRefund(order: any, details: any[], items: Array<{ productId: string; quantity: number }>, issueType: string, paid: number): RefundSuggestion {
  const snapshot = order?.TINH_TIEN_SNAPSHOT || {};
  const subtotal = Number(snapshot.subtotal ?? order?.TAM_TINH ?? 0);
  const productDiscount = Number(snapshot.productDiscount || 0) + Number(snapshot.loyaltyDiscount || 0);
  const ratio = subtotal > 0 ? Math.max(0, subtotal - productDiscount) / subtotal : 1;
  const listValue = items.reduce((sum, item) => {
    const line = details.find(detail => detail.SAN_PHAM_ID === item.productId);
    return sum + Number(line?.GIA || 0) * Number(item.quantity || 0);
  }, 0);
  const affectedValue = Math.round(listValue * ratio);
  const shipping = Math.max(0, Number(snapshot.shippingFee ?? order?.PHI_VAN_CHUYEN ?? 0) - Number(snapshot.shippingDiscount || 0));
  const cap = (value: number) => Math.max(0, Math.min(Math.round(value), Math.max(0, paid)));
  if (SHOP_FAULT_ISSUES.includes(issueType)) {
    return { amount: cap(affectedValue + shipping), minAmount: 0, rate: 1, affectedValue, shipping, basis: 'Lỗi shop: 100% giá trị sản phẩm lỗi (sau giảm giá) + phí ship. Không trả lại điểm/voucher đã dùng.' };
  }
  if (issueType === 'partial_damage') {
    const minAmount = cap(affectedValue * PARTIAL_DAMAGE_MIN_RATE);
    return { amount: minAmount, minAmount, rate: PARTIAL_DAMAGE_MIN_RATE, affectedValue, shipping: 0, basis: 'Hoa hỏng một phần: theo tỷ lệ thỏa thuận, tối thiểu 30% giá trị sản phẩm lỗi. Không trả lại điểm/voucher đã dùng.' };
  }
  if (issueType === 'missing_accessory') {
    return { amount: 0, minAmount: 0, rate: 0, affectedValue, shipping: 0, basis: 'Thiếu phụ kiện: giao bù; nếu không giao bù được thì hoàn đúng giá phụ kiện.' };
  }
  if (issueType === 'overpayment') {
    return { amount: cap(paid - Number(order?.TONG_TIEN || 0)), minAmount: 0, rate: 0, affectedValue: 0, shipping: 0, basis: 'Thanh toán dư: hoàn phần thu vượt tổng đơn.' };
  }
  return { amount: 0, minAmount: 0, rate: 0, affectedValue, shipping: 0, basis: 'Lỗi do khách, quá hạn hoặc chưa xác định lỗi shop: 0%.' };
}

/** Hoàn trên 2 triệu hoặc trên 50% giá trị đơn cần Admin duyệt lần 2. */
export function needsSecondApproval(amount: number, orderTotal: number): boolean {
  return amount > SECOND_APPROVAL_AMOUNT || (orderTotal > 0 && amount > orderTotal * SECOND_APPROVAL_RATE);
}
export function afterSalesInput(body: any, details: any[]) {
  if (!body || !['return','exchange','refund'].includes(body.type)) throw new InventoryError(400, 'Chọn trả hàng, đổi hàng hoặc hoàn tiền.');
  const reason = String(body.reason || '').trim();
  if (!reason || reason.length > 2000) throw new InventoryError(400, 'Lý do cần từ 1–2.000 ký tự.');
  const items = Array.isArray(body.items) && body.items.length ? body.items : details.map(d => ({ productId:d.SAN_PHAM_ID, quantity:d.SO_LUONG }));
  const seen = new Set();
  for (const item of items) {
    const row = details.find(d => d.SAN_PHAM_ID === item.productId);
    if (!row || seen.has(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > Number(row.SO_LUONG)) throw new InventoryError(400, 'Sản phẩm hoặc số lượng khiếu nại không thuộc đơn.');
    seen.add(item.productId);
  }
  const description = String(body.description || body.reason || '').trim();
  if (!description || description.length > 2000) throw new InventoryError(400, 'Mô tả chi tiết cần từ 1–2.000 ký tự.');
  const issueType = String(body.issueType || '').trim().slice(0, 80);
  const reasonCode = String(body.reasonCode || '').trim().slice(0, 80);
  const detectedAt = body.detectedAt ? new Date(body.detectedAt) : null;
  if (detectedAt && !Number.isFinite(detectedAt.getTime())) throw new InventoryError(400, 'Thời điểm phát hiện sự cố không hợp lệ.');
  const accessory = body.accessory ? String(body.accessory).trim().slice(0, 120) : null;
  const evidence = Array.isArray(body.evidence) ? body.evidence : [];
  if (evidence.length > 10 || evidence.some((v: any) => typeof v !== 'string' || v.length > 2000 || !/^https?:\/\//.test(v) && !/^\/uploads\/[\w./-]+$/.test(v))) throw new InventoryError(400, 'Tối đa 10 liên kết bằng chứng ảnh/video hợp lệ.');
  if (EVIDENCE_REQUIRED_ISSUES.includes(issueType) && !evidence.length) throw new InventoryError(400, 'Lỗi về hoa hoặc giao hàng cần ít nhất 1 ảnh/video bằng chứng.');
  const media = evidence.map((url: string) => ({ url, type: /\.(mp4|webm|mov)(?:\?|$)/i.test(url) ? 'video' : 'image', uploadedAt: new Date(), uploadedBy: 'CUSTOMER' }));
  return { type:body.type, issueType, reasonCode, reason, description, detectedAt, accessory, items, evidence, media };
}
export async function afterSalesRead(orderId: string) {
  return (await getCollection<any>(AFTER_SALES)).find({orderId}, {projection:{_id:0}}).sort({createdAt:-1}).toArray();
}
export async function afterSalesCreate(orderId: string, body: any) {
  const { randomUUID } = await import('node:crypto');
  const { withTransaction } = await import('./inventory/helpers.js');
  return withTransaction(async session => {
    const orders = await getCollection<any>('DON_HANG');
    const order = await orders.findOne({DON_HANG_ID:orderId},{session});
    if (!order) throw new InventoryError(404,'Không tìm thấy đơn.');
    const receipts = await (await getCollection<any>('THANH_TOAN')).find({DON_HANG_ID:orderId},{session}).toArray();
    // Yêu cầu hỗ trợ chỉ mở sau khi đơn giao thành công, trong 1 giờ (hoặc tới hạn ngoại lệ do nhân viên mở).
    if (![...DELIVERED_ORDER_STATUSES, 'Hoàn thành'].includes(String(order.TRANG_THAI))) throw new InventoryError(409, 'Yêu cầu hỗ trợ chỉ gửi được sau khi đơn giao hàng thành công. Vui lòng liên hệ shop qua chat nếu cần.');
    const deadline = supportDeadline(order);
    if (!deadline || Date.now() > deadline.getTime()) throw new InventoryError(409, 'Đã quá 1 giờ kể từ lúc giao hàng thành công nên không thể gửi yêu cầu hỗ trợ cho đơn này. Vui lòng liên hệ shop qua chat nếu cần.');
    const details = await (await getCollection<any>('DON_HANG_CHI_TIET')).find({DON_HANG_ID:orderId},{session}).toArray();
    const input = afterSalesInput(body,details);
    const col = await getCollection<any>(AFTER_SALES);
    const idempotencyKey = String(body.idempotencyKey || '').trim().slice(0, 100);
    if (idempotencyKey) { const repeated = await col.findOne({ orderId, idempotencyKey }, { session }); if (repeated) return repeated; }
    const active = await col.findOne({orderId,active:true},{session});
    if (active) return active;
    const previous = await col.find({ orderId, status: { $nin: [AFTER_SALES_STATUS.rejected, 'Đã từ chối'] } }, { session }).toArray();
    for (const item of input.items) {
      const bought = Number(details.find(detail => detail.SAN_PHAM_ID === item.productId)?.SO_LUONG || 0);
      const used = previous.reduce((sum, request) => sum + Number((request.items || []).find((line: any) => line.productId === item.productId)?.approvedQuantity
        ?? (request.items || []).find((line: any) => line.productId === item.productId)?.quantity ?? 0), 0);
      if (Number(item.quantity) > Math.max(0, bought - used)) throw new InventoryError(409, 'Số lượng yêu cầu vượt phần sản phẩm còn có thể xử lý hậu mãi.');
    }
    // Order lock also protects installations where the approved partial index is not yet installed.
    await orders.updateOne({DON_HANG_ID:orderId},{$inc:{PHIEN_BAN_THANH_TOAN:1}},{session});
    const id='HM'+randomUUID().replaceAll('-',''); const now=new Date();
    const suggestion = suggestRefund(order, details, input.items, input.issueType, refundableAmount(receipts));
    const row={_id:id,requestId:id,orderId,customerId:order.KHACH_HANG_ID || null,
      requester:{name:order.TEN_NGUOI_DAT||order.TEN_NGUOI_NHAN||'Khách hàng',phone:order.SDT_NGUOI_DAT||null,email:order.EMAIL_NGUOI_DAT||null},
      idempotencyKey:idempotencyKey||null,...input, suggestion,
      sla:{ claimBy: new Date(now.getTime() + AFTER_SALES_SLA_MS) },
      status:AFTER_SALES_STATUS.submitted,active:true,version:0,assignedTo:null,requestedAt:now,deliveredAt:orderDeliveredAt(order),
      createdAt:now,updatedAt:now,history:[{action:'Khách gửi yêu cầu',from:null,to:AFTER_SALES_STATUS.submitted,actor:'CUSTOMER',at:now}]};
    await col.insertOne(row,{session});
    await orderEvent(session,id+':created',row.customerId,orderId,'Đã nhận yêu cầu hậu mãi','Shop đã tiếp nhận yêu cầu; chưa có quyết định hoàn tiền.');
    await emitAdminNotification({
      key:`AFTER_SALES_NEW:${id}`, type:'REFUND_REQUEST', group:'Khiếu nại', priority:'Cao',
      title:`Hồ sơ hậu mãi mới — ${orderId}`,
      message:`${row.requester.name} vừa gửi yêu cầu ${row.type}.`,
      link:`/orders/order-detail/${orderId}`, module:'orders', entityId:id, stateful:false,
    }, session);
    return row;
  });
}
export async function afterSalesChange(id: string, body: any, actor: string, actorRole: unknown = '') {
  const { withTransaction } = await import('./inventory/helpers.js');
  const { createHash } = await import('node:crypto');
  return withTransaction(async session => {
    const col = await getCollection<any>(AFTER_SALES); const row = await col.findOne({_id:id},{session});
    if (!row) throw new InventoryError(404,'Không tìm thấy hồ sơ.');
    if (!Number.isInteger(body.version) || body.version !== row.version) throw new InventoryError(409,'Hồ sơ đã thay đổi; tải lại trước khi xử lý.');
    const orders=await getCollection<any>('DON_HANG'); const order=await orders.findOne({DON_HANG_ID:row.orderId},{session});
    const payments=await getCollection<any>('THANH_TOAN');const receipts=await payments.find({DON_HANG_ID:row.orderId},{session}).toArray();
    const maximum=refundableAmount(receipts); const now=new Date(); const updates:any={updatedAt:now};
    if(!actor) throw new InventoryError(401,'Cần xác thực nhân viên.');
    let reason=String(body.reason||'').trim();
    if(body.action==='claim') {
      if(![AFTER_SALES_STATUS.submitted,'Chờ tiếp nhận'].includes(row.status)) throw new InventoryError(409,'Hồ sơ đã được tiếp nhận.');
      Object.assign(updates,{status:AFTER_SALES_STATUS.reviewing,assignedTo:actor,assignedAt:now,sla:{...(row.sla||{}),decideBy:new Date(now.getTime()+AFTER_SALES_SLA_MS)}});
    } else if (body.action === 'admin-approve' || body.action === 'admin-return') {
      // Duyệt lần 2: chỉ Admin, áp dụng cho khoản hoàn trên 2 triệu hoặc trên 50% giá trị đơn.
      if (orderStaffKind(actorRole) !== 'admin') throw new InventoryError(403, 'Chỉ Admin được duyệt lần 2 khoản hoàn này.');
      if (row.status !== ADMIN_APPROVAL_STATUS) throw new InventoryError(409, 'Hồ sơ không ở bước chờ Admin duyệt.');
      if (!reason || reason.length > 2000) throw new InventoryError(400, 'Cần ghi nhận định của Admin, tối đa 2.000 ký tự.');
      const maxRefund = Number(row.decision?.maxRefund || 0);
      if (body.action === 'admin-approve') {
        const approvedStatus = ['return','exchange'].includes(row.type) ? AFTER_SALES_STATUS.executing
          : maxRefund > 0 ? AFTER_SALES_STATUS.refundPending : AFTER_SALES_STATUS.executing;
        Object.assign(updates, { status: approvedStatus, decision: { ...row.decision, adminApproval: { actor, at: now, reason } } });
      } else {
        await (await getCollection<any>(REFUND_LEDGER)).updateOne({ requestId: id, status: 'Pending', refundedAmount: 0 },
          { $set: { status: 'Cancelled', updatedAt: now }, $push: { history: { action: 'Admin trả về xem xét lại', actor, at: now, reason } } } as any, { session });
        Object.assign(updates, { status: AFTER_SALES_STATUS.reviewing, decision: { ...row.decision, adminReturned: { actor, at: now, reason } },
          sla: { ...(row.sla || {}), decideBy: new Date(now.getTime() + AFTER_SALES_SLA_MS) } });
      }
    } else {
      if(row.assignedTo!==actor) throw new InventoryError(403,'Bạn chưa tiếp nhận hồ sơ này.');
      const rejectReasonLabels: Record<string, string> = {
        INSUFFICIENT_EVIDENCE: 'Không đủ căn cứ xác định lỗi từ cửa hàng',
        CUSTOMER_STORAGE_OR_USE: 'Lỗi do bảo quản hoặc sử dụng',
        OUTSIDE_SUPPORT_POLICY: 'Không thuộc điều kiện hỗ trợ đã công bố',
        PRODUCT_MISMATCH: 'Sản phẩm hoặc thông tin không khớp hồ sơ',
        OTHER: 'Lý do khác',
      };
      const incomingReasonCode = String(body.reasonCode || '').trim();
      if (body.action === 'reject' && incomingReasonCode !== 'OTHER' && !reason) reason = rejectReasonLabels[incomingReasonCode] || '';
      if(!reason || reason.length>2000) throw new InventoryError(400,'Cần lý do/kết quả xử lý tối đa 2.000 ký tự.');
      if (body.action === 'request-info') {
        if (![AFTER_SALES_STATUS.reviewing, AFTER_SALES_STATUS.needInfo, 'Cần bổ sung'].includes(row.status)) throw new InventoryError(409, 'Hồ sơ không còn ở bước bổ sung bằng chứng.');
        // Khách có 1 giờ để bổ sung; quá hạn hệ thống tự từ chối.
        Object.assign(updates, { status: AFTER_SALES_STATUS.needInfo, additionalRequest: { reason, actor, at: now, dueAt: new Date(now.getTime() + AFTER_SALES_SLA_MS) } });
      } else if (body.action === 'receive-return') {
        if (![AFTER_SALES_STATUS.executing, AFTER_SALES_STATUS.approved, 'Đã chấp nhận'].includes(row.status) || !['return', 'exchange'].includes(row.type) || row.returnReceipt) throw new InventoryError(409, 'Hồ sơ chưa được duyệt trả/đổi hoặc đã ghi nhận hàng trả.');
        const receivedItems = Array.isArray(body.items) ? body.items : [];
        if (!receivedItems.length) throw new InventoryError(400, 'Cần nhập số lượng hàng thực nhận.');
        const normalized = receivedItems.map((item: any) => {
          const requested = row.items.find((line: any) => line.productId === item.productId);
          const receivedQuantity = Number(item.receivedQuantity), sellableQuantity = Number(item.sellableQuantity);
          if (!requested || !Number.isSafeInteger(receivedQuantity) || receivedQuantity < 1 || receivedQuantity > Number(requested.quantity)
            || !Number.isSafeInteger(sellableQuantity) || sellableQuantity < 0 || sellableQuantity > receivedQuantity) throw new InventoryError(400, 'Số lượng hàng trả không thuộc phạm vi hồ sơ đã duyệt.');
          return { productId: String(item.productId), receivedQuantity, sellableQuantity };
        });
        if (new Set(normalized.map((item: any) => item.productId)).size !== normalized.length) throw new InventoryError(400, 'Sản phẩm thực nhận bị trùng.');
        const stockResult = await receiveReturnedFinishedGoods(session, row.orderId, normalized, { id: actor, role: 'Admin' }, id);
        Object.assign(updates, { returnReceipt: { items: normalized, ...stockResult, actor, at: now, note: reason },
          status: Number(row.decision?.maxRefund || 0) > 0 ? AFTER_SALES_STATUS.refundPending : AFTER_SALES_STATUS.executing });
      } else if(body.action==='accept'||body.action==='reject') {
        if(row.status!==AFTER_SALES_STATUS.reviewing) throw new InventoryError(409,'Quyết định đã chốt hoặc hồ sơ chưa được xem xét.');
        const reasonCode = String(body.reasonCode || (body.action === 'reject' ? 'OTHER' : '')).trim();
        const allowedRejectReasons = ['INSUFFICIENT_EVIDENCE','CUSTOMER_STORAGE_OR_USE','OUTSIDE_SUPPORT_POLICY','PRODUCT_MISMATCH','OTHER'];
        if (body.action === 'reject' && !allowedRejectReasons.includes(reasonCode)) throw new InventoryError(400, 'Cần chọn lý do từ chối hợp lệ.');
        if (body.action === 'reject' && reasonCode === 'OTHER' && reason.length < 10) throw new InventoryError(400, 'Lý do Khác cần giải thích tối thiểu 10 ký tự.');
        const maxRefund=body.action==='reject'?0:Number(body.maxRefund||0);
        const ledger = await getCollection<any>(REFUND_LEDGER);
        const reserved = body.action === 'accept' ? await ledger.aggregate([
          { $match: { orderId: row.orderId, status: { $in: ['Pending', 'Processing', 'Đã duyệt', 'Đang hoàn'] }, requestId: { $ne: id } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ], { session }).toArray() : [];
        const remainingCapacity = Math.max(0, maximum - Number(reserved[0]?.total || 0));
        if(!Number.isSafeInteger(maxRefund)||maxRefund<0||maxRefund>remainingCapacity) throw new InventoryError(409,'Mức hoàn được duyệt vượt tiền thực thu còn lại hoặc đã được giữ cho hồ sơ khác.');
        // Hoàn khác mức gợi ý (theo chính sách) thì phải ghi lý do; khách xem được lý do này.
        const suggestion: RefundSuggestion | null = row.suggestion || null;
        const deviationReason = String(body.deviationReason || '').trim();
        const deviates = body.action === 'accept' && !!suggestion && maxRefund !== Number(suggestion.amount);
        if (deviates && (deviationReason.length < 10 || deviationReason.length > 1000)) throw new InventoryError(400, `Mức hoàn khác mức gợi ý (${Number(suggestion!.amount).toLocaleString('vi-VN')}đ): cần ghi lý do cho khách, 10–1.000 ký tự.`);
        const secondApproval = body.action === 'accept' && needsSecondApproval(maxRefund, Number(order?.TONG_TIEN || 0));
        if (body.action === 'accept' && maxRefund > 0) await ledger.updateOne(
          { requestId: id },
          { $setOnInsert: { _id: `RF:${id}`, requestId: id, orderId: row.orderId, amount: maxRefund, refundedAmount: 0, status: 'Pending', method: null, reference: null, createdAt: now, history: [{ action: 'Duyệt hạn mức hoàn', actor, at: now, reason }] } },
          { upsert: true, session },
        );
        const approvedStatus = ['return','exchange'].includes(row.type) ? AFTER_SALES_STATUS.executing
          : maxRefund > 0 ? AFTER_SALES_STATUS.refundPending : AFTER_SALES_STATUS.executing;
        Object.assign(updates,{status:body.action==='reject'?AFTER_SALES_STATUS.rejected:secondApproval?ADMIN_APPROVAL_STATUS:approvedStatus,active:body.action!=='reject',
          decision:{actor,at:now,reason,reasonCode:body.action==='reject'?reasonCode:null,policyVersion:'THY-AFTER-SALES-2026-11',maxRefund,resolution:String(body.resolution||row.type),approvedItems:body.items||row.items,
            suggestedAmount:suggestion?Number(suggestion.amount):null,deviationReason:deviates?deviationReason:null,needsAdminApproval:secondApproval}});
      } else if(body.action==='refund') {
        if(![AFTER_SALES_STATUS.refundPending,AFTER_SALES_STATUS.refundReview,'Đã chấp nhận'].includes(row.status)||row.refund) throw new InventoryError(409,'Chưa có quyết định hợp lệ hoặc đã hoàn.');
        if (row.type === 'return' && !row.returnReceipt) throw new InventoryError(409, 'Cần xác nhận thực nhận và kiểm tra chất lượng hàng trả trước khi hoàn tiền.');
        const amount=Number(body.amount);const reference=String(body.reference||'').trim();
        if(!Number.isSafeInteger(amount)||amount<=0||amount>maximum||amount>Number(row.decision?.maxRefund)||!reference||reference.length>200) throw new InventoryError(409,'Khoản hoàn/mã tham chiếu không hợp lệ hoặc vượt hạn mức.');
        if(body.transferred!==true) throw new InventoryError(400,'Chỉ ghi nhận sau khi đã chuyển tiền thực tế và đối soát chứng từ.');
        await orders.updateOne({DON_HANG_ID:row.orderId},{$inc:{PHIEN_BAN_THANH_TOAN:1}},{session});
        const paymentId='HT'+id;const key='refund-reference:'+createHash('sha256').update(reference).digest('hex');
        const claims=await getCollection<any>('PHIEN_DAT_HANG');if(await payments.findOne({MA_GIAO_DICH:reference,TRANG_THAI_THANH_TOAN:{$in:['Thành công','Đã thanh toán','Đã cọc']}},{session}) || await claims.findOne({_id:key},{session})) throw new InventoryError(409,'Mã hoàn tiền đã được sử dụng.');
        await claims.insertOne({_id:key,paymentId,createdAt:now},{session});
        await payments.insertOne({_id:paymentId,THANH_TOAN_ID:paymentId,DON_HANG_ID:row.orderId,LOAI_GIAO_DICH:'HOAN_TIEN',SO_TIEN:amount,MA_GIAO_DICH:reference,CONG_THANH_TOAN:order?.PHUONG_THUC_THANH_TOAN,TRANG_THAI_THANH_TOAN:'Thành công',NGAY_THANH_TOAN:now,XAC_NHAN_LUC:now,NGUOI_XAC_NHAN:actor,LICH_SU:[{action:'Đối soát hoàn tiền thực tế',actor,at:now,reason}]},{session});
        const ledgerResult = await (await getCollection<any>(REFUND_LEDGER)).updateOne(
          { requestId: id, status: { $in: ['Pending','Processing','Đã duyệt'] }, refundedAmount: 0 },
          { $set: { refundedAmount: amount, status: 'Succeeded', method: order?.PHUONG_THUC_THANH_TOAN || null, reference, paymentId, actor, refundedAt: now, updatedAt: now }, $push: { history: { action: 'Đối soát hoàn tiền thực tế', actor, at: now, reason, amount, reference } } } as any,
          { session },
        );
        if (ledgerResult.modifiedCount !== 1) throw new InventoryError(409, 'Khoản hoàn đã được xử lý hoặc không còn ở trạng thái cho phép. Vui lòng tải lại hồ sơ.');
        Object.assign(updates,{status:AFTER_SALES_STATUS.completed,active:false,refund:{amount,reference,paymentId,actor,at:now,status:'Succeeded'}});
      } else if(body.action==='complete') {
        if(![AFTER_SALES_STATUS.executing,AFTER_SALES_STATUS.approved,'Đã chấp nhận'].includes(row.status)||Number(row.decision?.maxRefund)>0) throw new InventoryError(409,'Cần đối soát khoản hoàn đã duyệt trước khi kết thúc.');
        if (['return', 'exchange'].includes(row.type) && !row.returnReceipt) throw new InventoryError(409, 'Cần xác nhận thực nhận và kiểm tra chất lượng hàng trả trước khi kết thúc hồ sơ.');
        Object.assign(updates,{status:AFTER_SALES_STATUS.completed,active:false});
      } else throw new InventoryError(400,'Thao tác không hợp lệ.');
    }
    await col.updateOne({_id:id,version:row.version},{$set:updates,$inc:{version:1},$push:{history:{action:body.action,actor,at:now,reason,from:row.status,to:updates.status||row.status,status:updates.status}}} as any,{session});
    await orderEvent(session,id+':'+(row.version+1),row.customerId,row.orderId,'Cập nhật yêu cầu hậu mãi',updates.status+'. '+reason);
    return {...row,...updates,version:row.version+1};
  });
}

export async function afterSalesSupplement(orderId: string, requestId: string, body: any) {
  return withTransaction(async session => {
    const col = await getCollection<any>(AFTER_SALES);
    const row = await col.findOne({ _id: requestId, orderId }, { session });
    if (!row) throw new InventoryError(404, 'Không tìm thấy hồ sơ hậu mãi.');
    if (![AFTER_SALES_STATUS.needInfo,'Cần bổ sung'].includes(row.status) || row.active !== true) throw new InventoryError(409, 'Hồ sơ hiện không chờ bổ sung bằng chứng.');
    if (!Number.isInteger(body.version) || body.version !== row.version) throw new InventoryError(409, 'Hồ sơ đã thay đổi, vui lòng tải lại.');
    const evidence = Array.isArray(body.evidence) ? body.evidence : [];
    if (!evidence.length || evidence.length > 10 || evidence.some((v: any) => typeof v !== 'string' || v.length > 2000 || !/^https?:\/\//.test(v) && !/^\/uploads\/[\w./-]+$/.test(v))) throw new InventoryError(400, 'Cần từ 1–10 liên kết ảnh/video hợp lệ.');
    const now = new Date();
    const merged = [...new Set([...(row.evidence || []), ...evidence])].slice(0, 10);
    const media = merged.map((url: string) => ({ url, type: /\.(mp4|webm|mov)(?:\?|$)/i.test(url) ? 'video' : 'image', uploadedAt: now, uploadedBy: 'CUSTOMER' }));
    const result = await col.findOneAndUpdate(
      { _id: requestId, orderId, version: row.version, status: { $in: [AFTER_SALES_STATUS.needInfo,'Cần bổ sung'] } },
      { $set: { evidence: merged, media, status: AFTER_SALES_STATUS.reviewing, updatedAt: now }, $inc: { version: 1 },
        $push: { history: { action: 'Khách bổ sung bằng chứng', actor:'CUSTOMER', from:row.status, to:AFTER_SALES_STATUS.reviewing, at: now } } } as any,
      { session, returnDocument: 'after' },
    );
    if (!result) throw new InventoryError(409, 'Hồ sơ vừa được cập nhật.');
    await orderEvent(session, `${requestId}:supplement:${row.version + 1}`, row.customerId, orderId, 'Đã bổ sung bằng chứng', 'Shop sẽ tiếp tục xem xét hồ sơ hậu mãi của bạn.');
    await emitAdminNotification({
      key:`AFTER_SALES_SUPPLEMENT:${requestId}:${row.version + 1}`, type:'REFUND_REQUEST', group:'Khiếu nại', priority:'Cao',
      title:`Khách đã bổ sung hồ sơ — ${orderId}`,
      message:'Khách đã bổ sung bằng chứng và hồ sơ đang chờ nhân viên tiếp tục xem xét.',
      link:`/orders/order-detail/${orderId}`, module:'orders', entityId:requestId, stateful:false,
    }, session);
    return result;
  });
}
