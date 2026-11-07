import { getCollection } from '../mongo.js';
import { withTransaction } from './inventory/helpers.js';
import { DELIVERED_ORDER_STATUSES, orderEvent, summarizePayments, supportDeadline, AFTER_SALES, AFTER_SALES_STATUS, AFTER_SALES_SLA_MS } from './admin-order.service.js';
import { emitAdminNotification } from './analytics/notifications.service.js';

export const AUTO_COMPLETE_ACTOR = 'AUTO_COMPLETE';

/**
 * Đơn giao thành công được tự chuyển "Hoàn thành" khi:
 * - đã hết 1 giờ được gửi yêu cầu hỗ trợ,
 * - không có yêu cầu hỗ trợ/hậu mãi nào cho đơn,
 * - đã thu đủ tiền (giữ đúng điều kiện chuyển "Hoàn thành" của luồng đơn).
 */
export function autoCompleteDecision(order: any, paid: number, hasSupportRequest: boolean, now = new Date()): 'complete' | 'wait' | 'skip' | 'needs-payment' {
  if (!DELIVERED_ORDER_STATUSES.includes(String(order?.TRANG_THAI || ''))) return 'skip';
  const deadline = supportDeadline(order);
  if (!deadline || deadline.getTime() > now.getTime()) return 'wait';
  if (hasSupportRequest) return 'skip';
  if (paid < Number(order?.TONG_TIEN || 0)) return 'needs-payment';
  return 'complete';
}

let timer: NodeJS.Timeout | null = null;

export async function autoCompleteDeliveredOrders(now = new Date()) {
  const orders = await getCollection<any>('DON_HANG');
  const candidates = await orders.find({ TRANG_THAI: { $in: DELIVERED_ORDER_STATUSES } }, { projection: { DON_HANG_ID: 1 } }).limit(200).toArray();
  let completed = 0;
  for (const candidate of candidates) {
    const orderId = String(candidate.DON_HANG_ID || '');
    if (!orderId) continue;
    try {
      const result = await withTransaction(async session => {
        const order = await orders.findOne({ DON_HANG_ID: orderId }, { session });
        if (!order) return 'skip';
        const receipts = await (await getCollection<any>('THANH_TOAN')).find({ DON_HANG_ID: orderId }, { session }).toArray();
        // Chỉ hồ sơ hỗ trợ còn đang mở mới giữ đơn ở "Giao thành công"; xử lý xong thì đơn được hoàn thành.
        const hasSupportRequest = !!(await (await getCollection<any>(AFTER_SALES)).findOne({ orderId, active: true }, { session, projection: { _id: 1 } }));
        // Dùng tổng tiền đã thu (không trừ khoản hoàn) để kiểm tra đã thu đủ.
        const decision = autoCompleteDecision(order, summarizePayments(receipts).successfulReceiptsTotal, hasSupportRequest, now);
        if (decision === 'needs-payment') {
          await emitAdminNotification({ key: `ORDER_AUTO_COMPLETE_BLOCKED:${orderId}`, type: 'ORDER_AUTO_COMPLETE_BLOCKED', group: 'Đơn hàng', priority: 'Trung bình',
            module: 'orders', stateful: true, entityId: orderId, title: `Chưa thể hoàn thành — ${orderId}`,
            message: 'Đơn đã hết thời gian hỗ trợ nhưng chưa ghi nhận đủ tiền. Ghi nhận khoản còn lại để đơn hoàn thành.',
            link: `/orders/order-detail/${orderId}` }, session);
          return decision;
        }
        if (decision !== 'complete') return decision;
        const write = await orders.updateOne(
          { DON_HANG_ID: orderId, TRANG_THAI: order.TRANG_THAI },
          {
            $set: { TRANG_THAI: 'Hoàn thành', NGAY_HOAN_THANH: order.NGAY_HOAN_THANH || now, NGAY_CAP_NHAT: now },
            $push: { LICH_SU_TRANG_THAI: { from: order.TRANG_THAI, to: 'Hoàn thành', at: now, actor: AUTO_COMPLETE_ACTOR, reason: 'Hết 1 giờ hỗ trợ sau giao hàng, không có yêu cầu hỗ trợ' } },
          } as any,
          { session },
        );
        if (write.modifiedCount !== 1) return 'skip';
        await orderEvent(session, `${orderId}:status:Hoàn thành`, order.KHACH_HANG_ID || null, orderId, 'Đơn hàng đã hoàn thành',
          'Cảm ơn bạn đã mua hoa tại Tiệm Hoa Yên. Bạn có thể đánh giá sản phẩm trong trang đơn hàng.');
        return decision;
      });
      if (result === 'complete') completed++;
    } catch (error) {
      console.error(`[order-complete] Không hoàn thành được đơn ${orderId}`, error);
    }
  }
  return completed;
}

/**
 * Hạn xử lý hồ sơ hỗ trợ (mỗi bước 1 giờ):
 * - Khách không bổ sung trong 1 giờ: tự từ chối (Không đủ căn cứ).
 * - Chưa tiếp nhận / chưa quyết định quá 1 giờ: nhắc Admin.
 */
export async function sweepAfterSalesDeadlines(now = new Date()) {
  const col = await getCollection<any>(AFTER_SALES);
  const cutoff = new Date(now.getTime() - AFTER_SALES_SLA_MS);
  const overdueInfo = await col.find({ active: true, status: { $in: [AFTER_SALES_STATUS.needInfo, 'Cần bổ sung'] },
    $or: [{ 'additionalRequest.dueAt': { $lte: now } }, { 'additionalRequest.dueAt': { $exists: false }, 'additionalRequest.at': { $lte: cutoff } }] }).limit(100).toArray();
  let rejected = 0;
  for (const row of overdueInfo) {
    const reason = 'Quá 1 giờ khách chưa bổ sung bằng chứng theo yêu cầu.';
    const result = await col.updateOne({ _id: row._id, version: row.version, status: row.status }, {
      $set: { status: AFTER_SALES_STATUS.rejected, active: false, updatedAt: now,
        decision: { actor: 'SYSTEM', at: now, reason, reasonCode: 'INSUFFICIENT_EVIDENCE', policyVersion: 'THY-AFTER-SALES-2026-11', maxRefund: 0 } },
      $inc: { version: 1 },
      $push: { history: { action: 'auto-reject', actor: 'SYSTEM', at: now, reason, from: row.status, to: AFTER_SALES_STATUS.rejected, status: AFTER_SALES_STATUS.rejected } },
    } as any);
    if (result.modifiedCount !== 1) continue;
    rejected++;
    await orderEvent(undefined, `${row._id}:auto-reject`, row.customerId || null, row.orderId, 'Yêu cầu hỗ trợ đã đóng', reason);
  }
  const lateClaim = await col.find({ active: true, status: { $in: [AFTER_SALES_STATUS.submitted, 'Chờ tiếp nhận'] },
    $or: [{ 'sla.claimBy': { $lte: now } }, { 'sla.claimBy': { $exists: false }, requestedAt: { $lte: cutoff } }] }, { projection: { _id: 1, orderId: 1 } }).limit(100).toArray();
  for (const row of lateClaim) await emitAdminNotification({ key: `AFTER_SALES_LATE_CLAIM:${row._id}`, type: 'AFTER_SALES_OVERDUE', group: 'Khiếu nại', priority: 'Cao', module: 'orders',
    stateful: true, entityId: String(row._id), title: `Quá hạn tiếp nhận — ${row.orderId}`, message: 'Hồ sơ hỗ trợ chưa được tiếp nhận sau 1 giờ.', link: `/orders/order-detail/${row.orderId}` });
  const lateDecision = await col.find({ active: true, status: AFTER_SALES_STATUS.reviewing,
    $or: [{ 'sla.decideBy': { $lte: now } }, { 'sla.decideBy': { $exists: false }, assignedAt: { $lte: cutoff } }] }, { projection: { _id: 1, orderId: 1 } }).limit(100).toArray();
  for (const row of lateDecision) await emitAdminNotification({ key: `AFTER_SALES_LATE_DECISION:${row._id}`, type: 'AFTER_SALES_OVERDUE', group: 'Khiếu nại', priority: 'Cao', module: 'orders',
    stateful: true, entityId: String(row._id), title: `Quá hạn quyết định — ${row.orderId}`, message: 'Hồ sơ hỗ trợ đã tiếp nhận quá 1 giờ nhưng chưa có quyết định.', link: `/orders/order-detail/${row.orderId}` });
  return { rejected, lateClaim: lateClaim.length, lateDecision: lateDecision.length };
}

export function startOrderAutoCompleteJob() {
  if (timer) return;
  const run = () => sweepAfterSalesDeadlines()
    .catch(error => console.error('[after-sales] Không quét được hạn hồ sơ hỗ trợ', error))
    .then(() => autoCompleteDeliveredOrders())
    .catch(error => console.error('[order-complete] Không quét được đơn đã giao', error));
  void run();
  timer = setInterval(run, 60_000);
  timer.unref?.();
}
