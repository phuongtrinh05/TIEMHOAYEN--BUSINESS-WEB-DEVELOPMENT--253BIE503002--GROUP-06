import type { ClientSession } from 'mongodb';
import { getCollection } from '../mongo.js';
import { INVENTORY_CONFIG } from './inventory/constants.js';
import { confirmReservations } from './inventory/stock.service.js';
import { createCheckoutAccess } from './order-access.service.js';

const dateOnly = (value: unknown): Date | null => {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00.000Z`);
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`) : null;
};
const bit = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

/** Shared persistence for regular checkout and accepted Sales proposals. Caller validates prices and holds stock in this transaction. */
export async function writeCheckoutOrder(session: ClientSession, orderId: string, payload: any, options: { voucher?: any; loyaltyPoints?: number; requestId?: string; quote?: any } = {}) {
  const { sender, receiver, delivery, summary, payment, flags } = payload;
  const number = orderId.replace(/^YEN/, '');
  const paymentId = `TT${number}`.slice(0, 20);
  const transactionCode = `GD${number}`.slice(0, 100);
  const paymentDeadline = new Date(Date.now() + INVENTORY_CONFIG.holdMinutes * 60_000).toISOString();
  const subtotal = Math.max(0, Number(summary?.subtotal || 0));
  const shippingFee = Math.max(0, Number(summary?.shippingFee || 0));
  const depositAmount = payment?.method === 'cod' ? Math.max(0, Number(summary?.depositAmount || 0)) : 0;
  const total = Math.max(0, Number(summary?.total || 0));
  const paymentAmount = payment?.method === 'cod' ? depositAmount : total;
  const paymentStatus = paymentAmount <= 0 ? 'Thành công' : 'Chờ thanh toán';
  const orderStatus = paymentAmount <= 0 ? 'Chờ xử lý' : 'Chờ thanh toán';
  const paymentMethodName = String(payment?.methodName || payment?.method || '');
  const order = {
    _id: orderId, DON_HANG_ID: orderId, KIEM_TRA_TON_KHO: true,
    MA_PHIEN_THANH_TOAN: payload.checkoutSessionId,
    TEN_NGUOI_DAT: String(sender.name), SDT_NGUOI_DAT: String(sender.phone), EMAIL_NGUOI_DAT: String(sender.email || ''),
    KHACH_HANG_ID: payload.customerId || null, NGAY_TAO: new Date(), TRANG_THAI: orderStatus,
    TAM_TINH: subtotal, PHI_VAN_CHUYEN: shippingFee, TIEN_COC: depositAmount, TONG_TIEN: total,
    PHUONG_THUC_THANH_TOAN: paymentMethodName, VAT: 0,
    NGAY_MUON_GIAO: dateOnly(delivery?.date), KHUNG_GIO_MUON_GIAO: String(delivery?.time || ''),
    LOI_NHAN_THIEP: String(delivery?.message || ''), GHI_CHU: String(delivery?.noteShop || ''),
    AN_THONG_TIN: bit(flags?.hideSender), YEU_CAU_VAT: bit(flags?.requestVAT), GUI_ANH_QUA_ZALO: bit(flags?.sendZaloPhoto),
    TEN_NGUOI_NHAN: receiver.name, SDT_NGUOI_NHAN: receiver.phone, DIA_CHI_GIAO_HANG: receiver.address,
    DA_CHINH_SUA_GIAO_HANG: false, LY_DO_HUY: null, NGAY_HUY: null, LY_DO_HOAN_TIEN_TRA_HANG: null,
    NGAY_YEU_CAU_HOAN_TIEN_TRA_HANG: null, DIEM_THUONG_SU_DUNG: options.loyaltyPoints || null,
    DA_TRU_DIEM_THUONG: false, LY_DO_TU_CHOI: null,
    ...(options.requestId ? { YEU_CAU_DAT_HANG_ID: options.requestId, PHUONG_AN_SNAPSHOT: options.quote } : {}),
  };
  await (await getCollection<any>('DON_HANG')).insertOne(order, { session });
  await (await getCollection<any>('DON_HANG_CHI_TIET')).insertMany(payload.items.map((item: any) => ({
    _id: { DON_HANG_ID: orderId, SAN_PHAM_ID: item.id }, DON_HANG_ID: orderId, SAN_PHAM_ID: item.id,
    SO_LUONG: item.qty, GIA: item.price, ...(item.bom ? { BOM_SNAPSHOT: item.bom } : {}),
    ...(options.quote ? { TEN_SAN_PHAM_SNAPSHOT: item.name, HINH_ANH_SNAPSHOT: item.image, SAN_PHAM_TUY_CHINH: !!item.custom } : {}),
  })), { session });
  if (options.voucher) {
    await (await getCollection<any>('DON_HANG_VOUCHER')).insertOne({
      _id: { DON_HANG_ID: orderId, VOUCHER_ID: options.voucher.VOUCHER_ID }, DON_HANG_ID: orderId,
      VOUCHER_ID: options.voucher.VOUCHER_ID, MO_TA: `Áp dụng voucher ${options.voucher.MA_VOUCHER}`,
    }, { session });
  }
  await (await getCollection<any>('THANH_TOAN')).insertOne({
    _id: paymentId, THANH_TOAN_ID: paymentId, DON_HANG_ID: orderId, CONG_THANH_TOAN: paymentMethodName,
    MA_GIAO_DICH: transactionCode, SO_TIEN: paymentAmount, TRANG_THAI_THANH_TOAN: paymentStatus, NGAY_THANH_TOAN: new Date(),
  }, { session });
  if (paymentAmount <= 0) await confirmReservations({ paymentSessionId: payload.checkoutSessionId }, orderId, { id: 'PAYMENT', role: 'system' }, session);
  const checkoutAccessToken = await createCheckoutAccess(orderId, session);
  return { message: 'Tạo đơn hàng và mã thanh toán thành công.', checkoutAccessToken, orderId, paymentId, transactionCode,
    paymentAmount, paymentDeadline, orderStatus, paymentStatus, paymentWindowSeconds: INVENTORY_CONFIG.holdMinutes * 60 };
}
