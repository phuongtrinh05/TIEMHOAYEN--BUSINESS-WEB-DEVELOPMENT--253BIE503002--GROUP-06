import type { ClientSession } from 'mongodb';
import { getCollection } from '../mongo.js';
import { InventoryError } from './inventory/helpers.js';
import { confirmReservations, releaseReservations } from './inventory/stock.service.js';

/** Called inside the same transaction as payment writes for stock-checked orders. */
export async function syncCheckoutInventory(session: ClientSession, orderId: string, success: boolean) {
  const orders = await getCollection<any>('DON_HANG');
  const order = await orders.findOne({ DON_HANG_ID: orderId }, { session });
  if (!order?.KIEM_TRA_TON_KHO) return;
  const paid = await (await getCollection<any>('THANH_TOAN')).findOne({ DON_HANG_ID: orderId,
    TRANG_THAI_THANH_TOAN: { $in: ['Thành công', 'Thanh toán thành công', 'Đã thanh toán'] } }, { session });
  if (paid) {
    if (!success) throw new InventoryError(409, 'Đơn đã thu tiền; cần xử lý hủy/hoàn riêng, không đổi giao dịch thành thất bại.');
    return;
  }
  if (!['Chờ thanh toán', 'Chờ xử lý', 'Thanh toán thất bại'].includes(order.TRANG_THAI)) {
    throw new InventoryError(409, 'Trạng thái đơn không cho phép xác nhận thanh toán.');
  }
  const filter = order.MA_PHIEN_THANH_TOAN ? { paymentSessionId: order.MA_PHIEN_THANH_TOAN } : { orderId };
  if (success) {
    await confirmReservations(filter, orderId, { id: 'PAYMENT', role: 'system' }, session);
    await orders.updateOne({ DON_HANG_ID: orderId }, { $set: { TRANG_THAI: 'Chờ xử lý' } }, { session });
  } else {
    await releaseReservations(filter, { id: 'PAYMENT', role: 'system' }, 'Hết hạn / thất bại thanh toán', session);
  }
}
