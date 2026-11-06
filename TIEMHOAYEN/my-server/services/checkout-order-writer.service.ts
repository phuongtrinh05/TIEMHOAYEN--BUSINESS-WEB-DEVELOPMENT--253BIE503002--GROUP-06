import {orderEvent} from './admin-order.service.js';
import type { ClientSession } from 'mongodb';
import { getCollection } from '../mongo.js';
import { INVENTORY_CONFIG } from './inventory/constants.js';
import { confirmReservations,recordHeldDemand,recordOrderDemand } from './inventory/stock.service.js';
import { createCheckoutAccess } from './order-access.service.js';
import { InventoryError } from './inventory/helpers.js';
import { consumeCheckoutBenefits } from './checkout-payment.service.js';
import { getActiveBom } from './inventory/bom.service.js';

const dateOnly = (value: unknown): Date | null => {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00.000Z`);
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`) : null;
};
const bit = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

export async function claimCheckoutBenefits(session: ClientSession, orderId: string, payload: any, options: { voucher?: any; loyaltyPoints?: number }) {
  const activeHolds = await (await getCollection<any>('GIU_TON')).find({
    $or: [{ TRANG_THAI: 'CHINH_THUC' }, { TRANG_THAI: 'TAM_CHO_QR', HET_HAN_LUC: { $gt: new Date() } }],
  }, { session, projection: { DON_HANG_ID: 1 } }).toArray();
  const activeIds = [...new Set(activeHolds.map(h => h.DON_HANG_ID))].filter(id => id !== orderId);
  if (options.loyaltyPoints) {
    const customers = await getCollection<any>('KHACH_HANG');
    // Serialize competing checkouts; pending points are derived from live stock holds.
    const customer = await customers.findOneAndUpdate({ KHACH_HANG_ID: payload.customerId }, { $inc: { PHIEN_BAN_DAT_HANG: 1 } }, { session, returnDocument: 'after' });
    const pending = await (await getCollection<any>('DON_HANG')).find({ KHACH_HANG_ID: payload.customerId,
      DON_HANG_ID: { $in: activeIds }, DA_TRU_DIEM_THUONG: { $ne: true }, TRANG_THAI: { $in: ['Chờ thanh toán', 'Chờ xử lý'] },
    }, { session }).toArray();
    const reserved = pending.reduce((sum, row) => sum + Number(row.DIEM_THUONG_SU_DUNG || 0), 0);
    if (!customer || options.loyaltyPoints + reserved > Number(customer.DIEM_TICH_LUY || 0)) throw new InventoryError(409, 'Điểm đang được sử dụng cho đơn khác. Vui lòng chọn lại.');
  }
  if (options.voucher) {
    const vouchers = await getCollection<any>('VOUCHER');
    const locked = await vouchers.findOneAndUpdate({ VOUCHER_ID: options.voucher.VOUCHER_ID, DA_DUNG: { $nin: [true, 1] } }, { $inc: { PHIEN_BAN_DAT_HANG: 1 } }, { session, returnDocument: 'after' });
    const prior = await (await getCollection<any>('DON_HANG_VOUCHER')).findOne({ VOUCHER_ID: options.voucher.VOUCHER_ID, DON_HANG_ID: { $in: activeIds } }, { session });
    if (!locked || prior) throw new InventoryError(409, 'Voucher đã dùng hoặc đang được giữ cho đơn khác.');
  }
}

/** Shared persistence for regular checkout and accepted Sales proposals. Caller validates prices and holds stock in this transaction. */
export async function writeCheckoutOrder(session: ClientSession, orderId: string, payload: any, options: { voucher?: any; loyaltyPoints?: number; loyaltyExpiresAt?: any; requestId?: string; quote?: any; pendingOrderStatus?: string } = {}) {
  const { sender, receiver, delivery, summary, payment, flags } = payload;
  if (String(delivery?.message || '').length > 2000 || String(delivery?.noteShop || '').length > 2000) throw new InventoryError(400, 'Nội dung thiệp và ghi chú tối đa 2.000 ký tự.');
  for (const item of payload.items) {
    if (!item.custom && !item.bom) {
      const resolved = await getActiveBom(item.id, session);
      item.bom = { version: resolved.bom?.PHIEN_BAN || null, lines: resolved.lines };
    }
  }
  await claimCheckoutBenefits(session, orderId, payload, options);
  const number = orderId.replace(/^YEN/, '');
  const paymentId = `TT${number}`.slice(0, 20);
  const transactionCode = `GD${number}`.slice(0, 100);
  const suppliedDeadline = payload.paymentDeadlineAt ? new Date(payload.paymentDeadlineAt) : null;
  const paymentDeadline = suppliedDeadline && Number.isFinite(suppliedDeadline.getTime()) && suppliedDeadline.getTime() > Date.now()
    ? suppliedDeadline.toISOString() : new Date(Date.now() + INVENTORY_CONFIG.holdMinutes * 60_000).toISOString();
  const subtotal = Math.max(0, Number(summary?.subtotal || 0));
  const shippingFee = Math.max(0, Number(summary?.shippingFee || 0));
  const depositAmount = payment?.method === 'cod' ? Math.max(0, Number(summary?.depositAmount || 0)) : 0;
  const total = Math.max(0, Number(summary?.total || 0));
  if (depositAmount > total) throw new InventoryError(400, 'Tiền cọc không được vượt quá nghĩa vụ thanh toán của đơn hàng.');
  const paymentAmount = payment?.method === 'cod' ? depositAmount : total;
  const requiresPayment = paymentAmount > 0;
  const paymentStatus = requiresPayment ? 'Chờ thanh toán' : total > 0 ? 'Chưa thanh toán' : 'Không phát sinh thu tiền';
  // Đơn từ Yêu cầu đặt hàng do Sales xác nhận mang trạng thái riêng trong lúc chờ khách thanh toán.
  const orderStatus = paymentAmount <= 0 ? 'Đã đặt hàng thành công' : options.pendingOrderStatus || 'Chờ thanh toán';
  const paymentMethodName = String(payment?.methodName || payment?.method || '');
  const order = {
    _id: orderId, DON_HANG_ID: orderId, KIEM_TRA_TON_KHO: true, KHONG_GIU_TAM_NVL: payload.inventoryMode === 'FUTURE_DEMAND',
    MA_PHIEN_THANH_TOAN: payload.checkoutSessionId,
    TEN_NGUOI_DAT: String(sender.name), SDT_NGUOI_DAT: String(sender.phone), EMAIL_NGUOI_DAT: String(sender.email || ''),
    KHACH_HANG_ID: payload.customerId || null, NGAY_TAO: new Date(), TRANG_THAI: orderStatus, HAN_THANH_TOAN: requiresPayment ? new Date(paymentDeadline) : null,
    TAM_TINH: subtotal, PHI_VAN_CHUYEN: shippingFee, TIEN_COC: depositAmount, TONG_TIEN: total,
    TINH_TIEN_SNAPSHOT: summary,
    KHONG_YEU_CAU_COC: payment?.method === 'cod' && depositAmount === 0,
    PHUONG_THUC_THANH_TOAN: paymentMethodName, VAT: 0,
    NGAY_MUON_GIAO: dateOnly(delivery?.date), KHUNG_GIO_MUON_GIAO: String(delivery?.time || ''),
    LOI_NHAN_THIEP: String(delivery?.message || ''), GHI_CHU: String(delivery?.noteShop || ''),
    THIEP_TANG: payload.giftCard || null,
    GHI_CHU_NOI_BO: String(payload.adminNote || ''),
    AN_THONG_TIN: bit(flags?.hideSender), YEU_CAU_VAT: bit(flags?.requestVAT), GUI_ANH_QUA_ZALO: bit(flags?.sendZaloPhoto),
    TEN_NGUOI_NHAN: receiver.name, SDT_NGUOI_NHAN: receiver.phone, DIA_CHI_GIAO_HANG: receiver.address,
    DA_CHINH_SUA_GIAO_HANG: false, LY_DO_HUY: null, NGAY_HUY: null, LY_DO_HOAN_TIEN_TRA_HANG: null,
    NGAY_YEU_CAU_HOAN_TIEN_TRA_HANG: null, DIEM_THUONG_SU_DUNG: options.loyaltyPoints || null,
    DA_TRU_DIEM_THUONG: Number(options.loyaltyPoints || 0) > 0, DA_HOAN_DIEM_THUONG: false,
    DIEM_HET_HAN_TRUOC_KHI_DUNG: options.loyaltyExpiresAt || null, LY_DO_TU_CHOI: null,
    ...(options.requestId ? { YEU_CAU_DAT_HANG_ID: options.requestId, PHUONG_AN_SNAPSHOT: options.quote } : {}),
  };
  await (await getCollection<any>('DON_HANG')).insertOne(order, { session });
  await (await getCollection<any>('DON_HANG_CHI_TIET')).insertMany(payload.items.map((item: any) => ({
    _id: { DON_HANG_ID: orderId, SAN_PHAM_ID: item.id }, DON_HANG_ID: orderId, SAN_PHAM_ID: item.id,
    SO_LUONG: item.qty, GIA: item.price, ...(item.bom ? { BOM_SNAPSHOT: item.bom } : {}),
    TEN_SAN_PHAM_SNAPSHOT: item.name, HINH_ANH_SNAPSHOT: item.image,
    SAN_PHAM_TUY_CHINH: !!item.custom,
  })), { session });
  if (options.voucher) {
    await (await getCollection<any>('DON_HANG_VOUCHER')).insertOne({
      _id: { DON_HANG_ID: orderId, VOUCHER_ID: options.voucher.VOUCHER_ID }, DON_HANG_ID: orderId,
      VOUCHER_ID: options.voucher.VOUCHER_ID, MO_TA: `Áp dụng voucher ${options.voucher.MA_VOUCHER}`,
      UU_DAI_SNAPSHOT: options.voucher,
      SO_TIEN_GIAM: Number(summary.productDiscount || 0) + Number(summary.shippingDiscount || 0),
    }, { session });
  }
  if (requiresPayment) await (await getCollection<any>('THANH_TOAN')).insertOne({
    _id: paymentId, THANH_TOAN_ID: paymentId, DON_HANG_ID: orderId, CONG_THANH_TOAN: paymentMethodName,
    MA_GIAO_DICH: transactionCode, SO_TIEN: paymentAmount, TRANG_THAI_THANH_TOAN: paymentStatus, NGAY_THANH_TOAN: new Date(), HET_HAN_LUC: new Date(paymentDeadline),
  }, { session });
  if (paymentAmount <= 0) {
    if (order.KHONG_GIU_TAM_NVL) await recordOrderDemand(orderId, {}, { id: 'PAYMENT', role: 'system' }, { paymentConfirmed: true }, session);
    else {
      await confirmReservations({ paymentSessionId: payload.checkoutSessionId }, orderId, { id: 'PAYMENT', role: 'system' }, session);
      await recordHeldDemand(orderId, { id: 'PAYMENT', role: 'system' }, session);
    }
    await consumeCheckoutBenefits(session, order);
  }
  await orderEvent(session,orderId+':created',payload.customerId||null,orderId,'Đã tạo đơn hàng',requiresPayment?'Đơn đã được tạo, đang chờ khoản thanh toán trước.':'Đã tiếp nhận đơn không yêu cầu trả trước; chưa ghi nhận đã thu tiền.');
  const checkoutAccessToken = await createCheckoutAccess(orderId, session);
  return { message: requiresPayment ? 'Đã tạo đơn chờ thanh toán.' : 'Đã tiếp nhận đơn; không yêu cầu thanh toán trước.', checkoutAccessToken, orderId,
    paymentId: requiresPayment ? paymentId : '', transactionCode: requiresPayment ? transactionCode : '', requiresPayment,
    paymentAmount, paymentDeadline: requiresPayment ? paymentDeadline : null, orderStatus, paymentStatus, summary, items: payload.items,
    paymentWindowSeconds: requiresPayment ? Math.max(0, Math.floor((new Date(paymentDeadline).getTime() - Date.now()) / 1000)) : 0 };
}
