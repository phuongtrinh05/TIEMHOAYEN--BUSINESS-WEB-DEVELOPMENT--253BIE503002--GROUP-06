import { randomUUID } from 'node:crypto';
import { getCollection } from '../mongo.js';
import { withTransaction } from './inventory/helpers.js';
import { orderDeliveryAt, releaseReservations } from './inventory/stock.service.js';
import { orderEvent, sumVerifiedPayments } from './admin-order.service.js';
import { emitAdminNotification } from './analytics/notifications.service.js';
import { restoreOrderPoints } from './loyalty-policy.service.js';

/** Đơn còn chờ khoản trả trước (chuyển khoản/ví, hoặc tiền cọc COD). */
export const UNPAID_ORDER_STATUSES = ['Chờ thanh toán', 'Thanh toán thất bại', 'Đã xác nhận đơn hàng'];
export const UNPAID_PAST_DELIVERY_REASON = 'Quá hạn thanh toán';
/** Trạng thái cuối khi khách không thanh toán được trước hạn: đơn không thực hiện, chỉ Admin còn tra cứu. */
export const PAYMENT_FAILED_STATUS = 'Thanh toán thất bại';

/**
 * Khách KHÔNG còn thấy đơn đã thất bại thanh toán sau khi hết hạn (đơn xa: 24 giờ; đơn gần: theo giờ giao).
 * Gồm cả đơn cũ đã bị hủy tự động vì quá hạn thanh toán trước khi đổi quy tắc.
 */
export const HIDE_EXPIRED_PAYMENT_FROM_CUSTOMER = {
  HET_HAN_THANH_TOAN: { $ne: true },
  $nor: [{ TRANG_THAI: 'Đã hủy', LY_DO_HUY: UNPAID_PAST_DELIVERY_REASON }],
};
/** "Chờ thanh toán" kéo dài tối đa 24 giờ. */
export const ORDER_PAYMENT_WINDOW_MS = 24 * 3600_000;
/** Đơn gấp: phải thanh toán trước giờ nhận 4 giờ (vd nhận 20:00 thì thanh toán trước 16:00). */
export const PAY_BEFORE_DELIVERY_MS = 4 * 3600_000;

/** Khoản bắt buộc trả trước: COD là tiền cọc, phương thức khác là toàn bộ đơn. */
export function requiredPrepayment(order: any): number {
  return /cod/i.test(String(order?.PHUONG_THUC_THANH_TOAN || '')) ? Number(order?.TIEN_COC || 0) : Number(order?.TONG_TIEN || 0);
}

/** Đơn giao gần: giờ nhận cách lúc đặt không quá 24 giờ; ngược lại là đơn giao xa. */
export function isNearDeliveryOrder(order: any): boolean {
  const created = order?.NGAY_TAO ? new Date(order.NGAY_TAO).getTime() : NaN;
  const delivery = orderDeliveryAt(order)?.getTime() ?? NaN;
  if (!Number.isFinite(delivery)) return false;
  if (!Number.isFinite(created)) return true;
  return delivery - created <= ORDER_PAYMENT_WINDOW_MS;
}

/**
 * Hạn thanh toán của đơn (khác hạn 5 phút của mã QR):
 * - Đơn giao gần (≤ 24 giờ): phải thanh toán trước giờ nhận 4 giờ (nhận 20:00 → trước 16:00).
 * - Đơn giao xa (> 24 giờ): "Chờ thanh toán" kéo dài 24 giờ kể từ lúc đặt.
 */
export function orderPaymentDeadline(order: any): Date | null {
  const created = order?.NGAY_TAO ? new Date(order.NGAY_TAO).getTime() : NaN;
  const delivery = orderDeliveryAt(order)?.getTime() ?? NaN;
  if (Number.isFinite(delivery) && isNearDeliveryOrder(order)) return new Date(delivery - PAY_BEFORE_DELIVERY_MS);
  if (Number.isFinite(created)) return new Date(created + ORDER_PAYMENT_WINDOW_MS);
  return Number.isFinite(delivery) ? new Date(delivery - PAY_BEFORE_DELIVERY_MS) : null;
}

/** Quy tắc: quá hạn thanh toán mà chưa thu đủ khoản trả trước thì đơn bị hủy. */
export function isUnpaidPastDeadline(order: any, paid: number, now = new Date()): boolean {
  if (order?.HET_HAN_THANH_TOAN === true) return false;
  if (!UNPAID_ORDER_STATUSES.includes(String(order?.TRANG_THAI || ''))) return false;
  const deadline = orderPaymentDeadline(order);
  if (!deadline || deadline.getTime() > now.getTime()) return false;
  const due = requiredPrepayment(order);
  return due > 0 && paid < due;
}
/** Giữ tên cũ cho mã gọi trước đây. */
export const isUnpaidPastDelivery = isUnpaidPastDeadline;

let timer: NodeJS.Timeout | null = null;

export async function cancelUnpaidOrdersPastDelivery(now = new Date()) {
  const orders = await getCollection<any>('DON_HANG');
  // Lọc thô: đơn tạo trước 24 giờ hoặc có ngày giao ≤ ngày mai; hạn chính xác tính bằng orderPaymentDeadline.
  const tomorrow = new Date(now.getTime() + ORDER_PAYMENT_WINDOW_MS);
  const candidates = await orders.find(
    { TRANG_THAI: { $in: UNPAID_ORDER_STATUSES }, HET_HAN_THANH_TOAN: { $ne: true }, $or: [{ NGAY_TAO: { $lte: new Date(now.getTime() - ORDER_PAYMENT_WINDOW_MS) } }, { NGAY_MUON_GIAO: { $ne: null, $lte: tomorrow } }] },
    { projection: { DON_HANG_ID: 1 } },
  ).limit(300).toArray();
  let cancelled = 0;
  for (const candidate of candidates) {
    const orderId = String(candidate.DON_HANG_ID || '');
    if (!orderId) continue;
    try {
      const changed = await withTransaction(async session => {
        const order = await orders.findOne({ DON_HANG_ID: orderId }, { session });
        if (!order) return false;
        const payments = await getCollection<any>('THANH_TOAN');
        const receipts = await payments.find({ DON_HANG_ID: orderId }, { session }).toArray();
        if (!isUnpaidPastDeadline(order, sumVerifiedPayments(receipts), now)) return false;
        const write = await orders.updateOne(
          { DON_HANG_ID: orderId, TRANG_THAI: order.TRANG_THAI },
          {
            // Quy trình: thanh toán không thành công → "Thanh toán thất bại", đơn không thực hiện; Admin vẫn tra cứu được.
            $set: { TRANG_THAI: PAYMENT_FAILED_STATUS, HET_HAN_THANH_TOAN: true, LY_DO_THAT_BAI: UNPAID_PAST_DELIVERY_REASON, NGAY_HET_HAN_THANH_TOAN: now, NGAY_CAP_NHAT: now },
            $push: { LICH_SU_TRANG_THAI: { from: order.TRANG_THAI, to: PAYMENT_FAILED_STATUS, at: now, actor: 'PAYMENT_EXPIRY', reason: UNPAID_PAST_DELIVERY_REASON } },
          } as any,
          { session },
        );
        if (write.modifiedCount !== 1) return false;
        if (order.KIEM_TRA_TON_KHO) await releaseReservations({ orderId }, { id: 'PAYMENT_EXPIRY', role: 'system' }, UNPAID_PAST_DELIVERY_REASON, session);
        await restoreOrderPoints(session, order);
        await payments.updateMany({ DON_HANG_ID: orderId, TRANG_THAI_THANH_TOAN: 'Chờ thanh toán' }, {
          $set: { TRANG_THAI_THANH_TOAN: 'Thất bại', XAC_NHAN_LUC: now, NGUOI_XAC_NHAN: 'PAYMENT_EXPIRY' },
          $push: { LICH_SU: { id: randomUUID(), from: 'Chờ thanh toán', to: 'Thất bại', actor: 'PAYMENT_EXPIRY', at: now } },
        } as any, { session });
        if (order.YEU_CAU_DAT_HANG_ID) {
          await (await getCollection<any>('YEU_CAU_DAT_HANG')).updateOne(
            { _id: order.YEU_CAU_DAT_HANG_ID, status: { $in: ['Chờ khách thanh toán', 'Chờ thanh toán'] } },
            { $set: { status: 'Hết hạn thanh toán', expiredAt: now, updatedAt: now }, $inc: { version: 1 },
              $push: { history: { id: randomUUID(), at: now, actor: 'SYSTEM', action: UNPAID_PAST_DELIVERY_REASON, orderId } } } as any,
            { session },
          );
        }
        await orderEvent(session, `${orderId}:unpaid-past-delivery`, order.KHACH_HANG_ID || null, orderId, 'Thanh toán không thành công',
          'Đơn đã quá hạn thanh toán (đơn giao xa: 24 giờ kể từ lúc đặt; đơn giao gần: trước giờ nhận 4 giờ) nên không thực hiện được.');
        await emitAdminNotification({ key: `ORDER_UNPAID_PAST_DELIVERY:${orderId}`, type: 'ORDER_UNPAID_PAST_DELIVERY', group: 'Đơn hàng', priority: 'Trung bình',
          module: 'orders', stateful: false, entityId: orderId, title: `Thanh toán thất bại — ${orderId}`, message: UNPAID_PAST_DELIVERY_REASON + '.',
          link: `/orders/order-detail/${orderId}` }, session);
        return true;
      });
      if (changed) cancelled++;
    } catch (error) {
      console.error(`[order-expiry] Không hủy được đơn ${orderId}`, error);
    }
  }
  return cancelled;
}

export function startUnpaidOrderExpiryJob() {
  if (timer) return;
  const run = () => cancelUnpaidOrdersPastDelivery().catch(error => console.error('[order-expiry] Không quét được đơn quá hạn', error));
  void run();
  timer = setInterval(run, 60_000);
  timer.unref?.();
}
