import {orderEvent} from './admin-order.service.js';
import type { ClientSession } from 'mongodb';
import { getCollection } from '../mongo.js';
import { INVENTORY_CONFIG } from './inventory/constants.js';
import { confirmReservations,recordOrderDemand } from './inventory/stock.service.js';
import { createCheckoutAccess } from './order-access.service.js';
import {holdLuckyReward,syncLuckyOrder} from './lucky-wheel.service.js';
import {InventoryError} from './inventory/helpers.js';

const dateOnly = (value: unknown): Date | null => {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00.000Z`);
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`) : null;
};
const bit = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

/** Shared persistence for regular checkout and accepted Sales proposals. Caller validates prices and holds stock in this transaction. */
export async function writeCheckoutOrder(session: ClientSession, orderId: string, payload: any, options: { voucher?: any; loyaltyPoints?: number; loyaltyExpiresAt?: any; requestId?: string; quote?: any } = {}) {
  const { sender, receiver, delivery, summary, payment, flags } = payload;
  if (String(delivery?.message || '').length > 2000 || String(delivery?.noteShop || '').length > 2000) throw new InventoryError(400, 'Nội dung thiệp và ghi chú tối đa 2.000 ký tự.');
  let frozenProductValue=0;
  for(const item of payload.items){
    let price=Number(item.price);
    if(!item.custom){
      const p=await (await getCollection<any>('SAN_PHAM')).findOne({SAN_PHAM_ID:item.id},{session});
      if(p){const sale=Number(p.GIA_KHUYEN_MAI);price=sale>0&&sale<Number(p.GIA)?sale:Number(p.GIA);}
    }
    if(payload.luckyRewardId&&price!==Number(item.price))throw new InventoryError(409,'Giá sản phẩm đã đổi. Tải lại giỏ trước khi dùng thưởng.');
    frozenProductValue+=price*Number(item.qty);
  }
  let lucky:any=null;
  if(payload.luckyRewardId){
    if(!payload.customerId||Number(summary.subtotal)!==frozenProductValue)throw new InventoryError(400,'Đăng nhập và dùng đúng giá sản phẩm để áp dụng thưởng.');
    lucky=await holdLuckyReward(session,payload.customerId,String(payload.luckyRewardId),orderId,payload);
    if(payment?.method==='cod'&&(!(Number(summary.depositAmount)>0)||Number(summary.depositAmount)>Number(summary.total)))throw new InventoryError(400,'Tiền cọc không hợp lệ.');
  }
  const number = orderId.replace(/^YEN/, '');
  const paymentId = `TT${number}`.slice(0, 20);
  const transactionCode = `GD${number}`.slice(0, 100);
  const paymentDeadline = new Date(Date.now() + INVENTORY_CONFIG.holdMinutes * 60_000).toISOString();
  const subtotal = Math.max(0, Number(summary?.subtotal || 0));
  const shippingFee = Math.max(0, Number(summary?.shippingFee || 0));
  const depositAmount = payment?.method === 'cod' ? Math.max(0, Number(summary?.depositAmount || 0)) : 0;
  const total = Math.max(0, Number(summary?.total || 0));
  if (depositAmount > total) throw new InventoryError(400, 'Tiền cọc không được vượt quá nghĩa vụ thanh toán của đơn hàng.');
  const paymentAmount = payment?.method === 'cod' ? depositAmount : total;
  const requiresPayment = paymentAmount > 0;
  const paymentStatus = requiresPayment ? 'Chờ thanh toán' : total > 0 ? 'Chưa thanh toán' : 'Không phát sinh thu tiền';
  const orderStatus = paymentAmount <= 0 ? 'Chờ xử lý' : 'Chờ thanh toán';
  const paymentMethodName = String(payment?.methodName || payment?.method || '');
  const order = {
    _id: orderId, DON_HANG_ID: orderId, KIEM_TRA_TON_KHO: true, KHONG_GIU_TAM_NVL: payload.inventoryMode === 'FUTURE_DEMAND',
    MA_PHIEN_THANH_TOAN: payload.checkoutSessionId,
    TEN_NGUOI_DAT: String(sender.name), SDT_NGUOI_DAT: String(sender.phone), EMAIL_NGUOI_DAT: String(sender.email || ''),
    KHACH_HANG_ID: payload.customerId || null, NGAY_TAO: new Date(), TRANG_THAI: orderStatus,
    TAM_TINH: subtotal, PHI_VAN_CHUYEN: shippingFee, TIEN_COC: depositAmount, TONG_TIEN: total,
    GIA_TRI_SAN_PHAM_DA_CHOT: frozenProductValue,
    ...(lucky?{VQ_PHAN_THUONG_ID:lucky.reward.id,VQ_GIAM_GIA:lucky.discount}:{}),
    GIAM_GIA_SAN_PHAM: Math.max(0, Number(summary?.productVoucherDiscount || 0)),
    GIAM_GIA_PHI_SHIP: Math.max(0, Number(summary?.shippingVoucherDiscount || 0)),
    TINH_TIEN_SNAPSHOT: summary,
    KHONG_YEU_CAU_COC: payment?.method === 'cod' && depositAmount === 0,
    PHUONG_THUC_THANH_TOAN: paymentMethodName, VAT: 0,
    NGAY_MUON_GIAO: dateOnly(delivery?.date), KHUNG_GIO_MUON_GIAO: String(delivery?.time || ''),
    LOI_NHAN_THIEP: String(delivery?.message || ''), GHI_CHU: String(delivery?.noteShop || ''),
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
    _id: { DON_HANG_ID: orderId, LINE_KEY: item.lineKey || item.id },
    DON_HANG_ID: orderId, SAN_PHAM_ID: item.id, LINE_KEY: item.lineKey || item.id,
    BIEN_THE_ID: item.variantId || null, THIET_KE_ID: item.designId || null,
    CAU_HINH_SNAPSHOT: item.configuration || {},
    SO_LUONG: item.qty, GIA: item.price,
    GIA_NIEM_YET_SNAPSHOT: Number(item.regularPrice ?? item.price),
    THANH_TIEN_SNAPSHOT: Number(item.lineTotal ?? item.price * item.qty),
    ...(item.designId ? {THIET_KE_3D_ID:item.designId} : {}),
    TEN_SAN_PHAM_SNAPSHOT: String(item.name || item.id), HINH_ANH_SNAPSHOT: String(item.image || ''),
    ...(item.bom ? { BOM_SNAPSHOT: item.bom } : {}), SAN_PHAM_TUY_CHINH: !!item.custom,
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
    MA_GIAO_DICH: transactionCode, SO_TIEN: paymentAmount, TRANG_THAI_THANH_TOAN: paymentStatus, NGAY_THANH_TOAN: new Date(),
  }, { session });
  if (paymentAmount <= 0) {
    if(order.KHONG_GIU_TAM_NVL)await recordOrderDemand(orderId,{}, {id:'PAYMENT',role:'system'}, {}, session);
    else await confirmReservations({ paymentSessionId: payload.checkoutSessionId }, orderId, { id: 'PAYMENT', role: 'system' }, session);
    await syncLuckyOrder(session,orderId);
  }
  await orderEvent(session,orderId+':created',payload.customerId||null,orderId,'Đã tạo đơn hàng',requiresPayment?'Đơn đã được tạo, đang chờ khoản thanh toán trước.':'Đã tiếp nhận đơn không yêu cầu trả trước; chưa ghi nhận đã thu tiền.');
  const checkoutAccessToken = await createCheckoutAccess(orderId, session);
  return { message: requiresPayment ? 'Đã tạo đơn chờ thanh toán.' : 'Đã tiếp nhận đơn; không yêu cầu thanh toán trước.', checkoutAccessToken, orderId,
    paymentId: requiresPayment ? paymentId : '', transactionCode: requiresPayment ? transactionCode : '', requiresPayment,
    paymentAmount, paymentDeadline: requiresPayment ? paymentDeadline : null, orderStatus, paymentStatus, summary, items: payload.items,
    paymentWindowSeconds: INVENTORY_CONFIG.holdMinutes * 60 };
}
