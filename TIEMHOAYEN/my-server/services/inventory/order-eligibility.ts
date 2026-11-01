import type { ClientSession } from 'mongodb';
import { COLLECTIONS } from './constants.js';
import { col } from './helpers.js';
export const PAID_STATUSES = ['Thành công', 'Thanh toán thành công', 'Đã thanh toán', 'Đã cọc'];
/** Payment evidence, not a client flag, determines which orders may consume forecast capacity. */
export const eligiblePaidOrderIds = async (ids: string[], session?: ClientSession): Promise<Set<string>> => {
  if (!ids.length) return new Set();
  const payments = await (await col('THANH_TOAN')).find({ DON_HANG_ID: {$in: [...new Set(ids)]}, TRANG_THAI_THANH_TOAN: {$in: PAID_STATUSES} }, {session}).project({DON_HANG_ID: 1}).toArray();
  const orders = await (await col(COLLECTIONS.order)).find({ DON_HANG_ID: {$in: payments.map(p => p.DON_HANG_ID)}, TRANG_THAI: {$nin: ['Đã hủy', 'Hủy đơn hàng', 'Đã từ chối', 'Đã hoàn tiền']} }, {session}).project({DON_HANG_ID: 1}).toArray();
  return new Set(orders.map(o => String(o.DON_HANG_ID)));
};
