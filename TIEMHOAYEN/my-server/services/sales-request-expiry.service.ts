import { randomUUID } from 'node:crypto';
import { getCollection } from '../mongo.js';
import { withTransaction } from './inventory/helpers.js';
import { releaseReservations } from './inventory/stock.service.js';
import { paymentSucceeded } from './admin-order.service.js';
import { orderEvent } from './admin-order.service.js';
import { emitAdminNotification } from './analytics/notifications.service.js';

const OPEN_PAYMENT = ['Chờ khách thanh toán', 'Chờ thanh toán'];
let timer: NodeJS.Timeout | null = null;

export async function sweepExpiredSalesRequests(now = new Date()) {
  const warningLimit = new Date(now.getTime() + 60 * 60 * 1000);
  const warningRows = await (await getCollection<any>('YEU_CAU_DAT_HANG')).find({
    status: { $in: OPEN_PAYMENT }, paymentDeadlineAt: { $gt: now, $lte: warningLimit },
  }, { projection: { _id: 1, requestId: 1, customerId: 1, paymentDeadlineAt: 1 } }).limit(100).toArray();
  for (const row of warningRows) {
    await orderEvent(undefined, `${row.requestId}:payment-expiring`, row.customerId || null, null,
      'Yêu cầu đặt hoa sắp hết hạn thanh toán', 'Vui lòng hoàn tất khoản cần trả trước trong thời hạn còn lại.', `/order-request/${row.requestId}`);
    await emitAdminNotification({ key: `SALES_PAYMENT_EXPIRING:${row.requestId}`, type: 'SALES_PAYMENT_EXPIRING', group: 'Đơn hàng', priority: 'Cao', module: 'orders', stateful: true,
      entityId: row.requestId, title: `Sắp hết hạn thanh toán — ${row.requestId}`, message: 'Yêu cầu còn dưới 1 giờ để thanh toán.', link: '/orders/requests', queryParams: { requestId: row.requestId } });
  }
  const due = await (await getCollection<any>('YEU_CAU_DAT_HANG')).find({
    status: { $in: OPEN_PAYMENT }, paymentDeadlineAt: { $lte: now },
  }, { projection: { _id: 1 } }).limit(100).toArray();
  let expired = 0;
  for (const candidate of due) {
    const changed = await withTransaction(async session => {
      const requests = await getCollection<any>('YEU_CAU_DAT_HANG');
      const row = await requests.findOne({ _id: candidate._id, status: { $in: OPEN_PAYMENT }, paymentDeadlineAt: { $lte: now } }, { session });
      if (!row) return false;
      const orderId = String(row.orderId || row.orderResult?.orderId || '');
      const payments = await getCollection<any>('THANH_TOAN');
      const paymentRows = orderId ? await payments.find({ DON_HANG_ID: orderId }, { session }).toArray() : [];
      if (paymentRows.some(payment => paymentSucceeded(payment.TRANG_THAI_THANH_TOAN))) return false;
      if (orderId) {
        await releaseReservations({ orderId }, { id: 'PAYMENT_EXPIRY', role: 'system' }, 'Hết hạn thanh toán yêu cầu Sales', session);
        await (await getCollection<any>('DON_HANG')).updateOne({ DON_HANG_ID: orderId, TRANG_THAI: { $in: ['Chờ thanh toán', 'Chờ xử lý'] } }, {
          $set: { TRANG_THAI: 'Đã hủy', LY_DO_HUY: 'Hết hạn thanh toán', NGAY_HUY: now, NGAY_CAP_NHAT: now },
          $push: { LICH_SU_TRANG_THAI: { from: row.orderResult?.orderStatus || 'Chờ thanh toán', to: 'Đã hủy', at: now, actor: 'PAYMENT_EXPIRY', reason: 'Hết hạn thanh toán' } },
        } as any, { session });
        await payments.updateMany({ DON_HANG_ID: orderId, TRANG_THAI_THANH_TOAN: 'Chờ thanh toán' }, {
          $set: { TRANG_THAI_THANH_TOAN: 'Hết hạn', XAC_NHAN_LUC: now, NGUOI_XAC_NHAN: 'PAYMENT_EXPIRY' },
          $push: { LICH_SU: { id: randomUUID(), from: 'Chờ thanh toán', to: 'Hết hạn', actor: 'PAYMENT_EXPIRY', at: now } },
        } as any, { session });
      }
      const result = await requests.updateOne({ _id: row._id, version: row.version, status: { $in: OPEN_PAYMENT } }, {
        $set: { status: 'Hết hạn thanh toán', expiredAt: now, updatedAt: now }, $inc: { version: 1 },
        $push: { history: { id: randomUUID(), at: now, actor: 'SYSTEM', action: 'Hết thời hạn thanh toán đã cấp', orderId: orderId || null } },
      } as any, { session });
      if (result.modifiedCount === 1) await orderEvent(session, `${row.requestId}:payment-expired`, row.customerId || null, null,
        'Yêu cầu đặt hoa đã hết hạn', 'Yêu cầu đã kết thúc vì chưa hoàn tất thanh toán trong thời hạn được cấp.', `/order-request/${row.requestId}`);
      if (result.modifiedCount === 1) await emitAdminNotification({ key: `SALES_PAYMENT_EXPIRED:${row.requestId}`, type: 'SALES_PAYMENT_EXPIRED', group: 'Đơn hàng', priority: 'Cao', module: 'orders', stateful: false,
        entityId: row.requestId, title: `Yêu cầu hết hạn — ${row.requestId}`, message: 'Yêu cầu đã hết thời hạn thanh toán được cấp.', link: '/orders/requests', queryParams: { requestId: row.requestId } }, session);
      return result.modifiedCount === 1;
    });
    if (changed) expired++;
  }
  return expired;
}

export function startSalesRequestExpiryJob() {
  if (timer) return;
  const run = () => sweepExpiredSalesRequests().catch(error => console.error('[sales-request] Không quét được yêu cầu hết hạn', error));
  void run();
  timer = setInterval(run, 60_000);
  timer.unref?.();
}
