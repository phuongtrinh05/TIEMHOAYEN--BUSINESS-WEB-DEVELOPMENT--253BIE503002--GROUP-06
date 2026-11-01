import {orderEvent} from './admin-order.service.js';
import type { ClientSession } from 'mongodb';
import { getCollection } from '../mongo.js';
import { InventoryError } from './inventory/helpers.js';
import { confirmReservations, releaseReservations } from './inventory/stock.service.js';
import { randomUUID, createHash } from 'node:crypto';
import { paymentSucceeded, sumVerifiedPayments } from './admin-order.service.js';

/** All money-changing entry points share this transaction-scoped command. */
export async function changeCheckoutPayment(session: ClientSession, paymentId: string, body: any, actor: string, collections: typeof getCollection = getCollection) {
  const payments = await collections<any>('THANH_TOAN');
  const current = await payments.findOne({ THANH_TOAN_ID: paymentId }, { session });
  if (!current) throw new InventoryError(404, 'Không tìm thấy giao dịch.');
  if (current.LOAI_GIAO_DICH === 'HOAN_TIEN') throw new InventoryError(409, 'Giao dịch hoàn tiền cần xử lý trong hồ sơ hậu mãi, không đổi trạng thái tại khoản thu.');
  const order = await (await collections<any>('DON_HANG')).findOne({ DON_HANG_ID: current.DON_HANG_ID }, { session });
  if (!order) throw new InventoryError(404, 'Không tìm thấy đơn của giao dịch.');
  const requested = String(body.status ?? current.TRANG_THAI_THANH_TOAN);
  const success = paymentSucceeded(requested);
  const failed = ['Thất bại', 'Thanh toán thất bại', 'Hết hạn'].includes(requested);
  if (!success && !failed) throw new InventoryError(400, 'Chỉ xác nhận thành công hoặc thất bại cho giao dịch đang chờ.');
  const amount = body.amount === undefined ? Number(current.SO_TIEN) : Number(body.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount !== Number(current.SO_TIEN)) throw new InventoryError(409, 'Số tiền phải khớp nghĩa vụ thanh toán, không được sửa khoản thu.');
  const reference = String(body.referenceCode ?? current.MA_GIAO_DICH ?? '').trim();
  const target = success ? 'Thành công' : 'Thất bại';
  if (paymentSucceeded(current.TRANG_THAI_THANH_TOAN)) {
    if (!success || reference !== String(current.MA_GIAO_DICH || '')) throw new InventoryError(409, 'Giao dịch đã thu tiền; điều chỉnh/hoàn tiền phải xử lý riêng.');
    return current;
  }
  if (current.TRANG_THAI_THANH_TOAN !== 'Chờ thanh toán') {
    if (!success && failed) return current;
    throw new InventoryError(409, 'Phiên thanh toán đã kết thúc. Cần tạo phiên hợp lệ mới.');
  }
  if (success) {
    if (!reference) throw new InventoryError(400, 'Cần mã tham chiếu khi xác nhận đã thu tiền.');
    // Serialize different receipts of the same order, including balance payments.
    await (await collections<any>('DON_HANG')).updateOne({ DON_HANG_ID: order.DON_HANG_ID }, { $inc: { PHIEN_BAN_THANH_TOAN: 1 } }, { session });
    if (['Đã hủy', 'Đã hoàn tiền'].includes(order.TRANG_THAI)) throw new InventoryError(409, 'Đơn không cho phép ghi nhận khoản thu mới.');
    const previous = await payments.find({ DON_HANG_ID: order.DON_HANG_ID }, { session }).toArray();
    const collected = sumVerifiedPayments(previous);
    const due = current.LOAI_GIAO_DICH !== 'SO_DU' && String(order.PHUONG_THUC_THANH_TOAN || '').toLowerCase().includes('cod')
      ? Number(order.TIEN_COC) : Number(order.TONG_TIEN);
    if (collected >= due || amount !== due - collected || collected + amount > Number(order.TONG_TIEN)) throw new InventoryError(409, 'Khoản thu phải khớp nghĩa vụ còn lại; không được ghi tiền trùng hoặc vượt số dư.');
    const claimId = `payment-reference:${createHash('sha256').update(reference).digest('hex')}`;
    const claims = await collections<any>('PHIEN_DAT_HANG');
    const claim = await claims.findOne({ _id: claimId }, { session });
    if (claim && claim.paymentId !== paymentId) throw new InventoryError(409, 'Mã tham chiếu đã được dùng cho giao dịch khác.');
    const duplicate = await payments.findOne({ MA_GIAO_DICH: reference, THANH_TOAN_ID: { $ne: paymentId }, TRANG_THAI_THANH_TOAN: { $in: ['Thành công', 'Thanh toán thành công', 'Đã thanh toán', 'Đã cọc'] } }, { session });
    if (duplicate) throw new InventoryError(409, 'Mã tham chiếu đã được ghi nhận.');
    if (!claim) await claims.insertOne({ _id: claimId, paymentId, createdAt: new Date() }, { session });
  }
  if (current.LOAI_GIAO_DICH !== 'SO_DU') await syncCheckoutInventory(session, current.DON_HANG_ID, success);
  const updated = await payments.findOneAndUpdate({ THANH_TOAN_ID: paymentId, TRANG_THAI_THANH_TOAN: 'Chờ thanh toán' }, {
    $set: { TRANG_THAI_THANH_TOAN: target, MA_GIAO_DICH: reference || null, XAC_NHAN_LUC: new Date(), NGUOI_XAC_NHAN: actor },
    $push: { LICH_SU: { id: randomUUID(), from: current.TRANG_THAI_THANH_TOAN, to: target, actor, at: new Date() } },
  } as any, { session, returnDocument: 'after' });
  if (!updated) throw new InventoryError(409, 'Giao dịch vừa được người khác xử lý.');
  if (success) {
    await consumeCheckoutBenefits(session, order);
    await orderEvent(session,paymentId+':verified',order.KHACH_HANG_ID||null,order.DON_HANG_ID,'Đã xác minh thanh toán','Shop đã xác minh khoản thu '+amount.toLocaleString('vi-VN')+'đ.');
  }
  return updated;
}

export async function consumeCheckoutBenefits(session: ClientSession, order: any) {
    const orders = await getCollection<any>('DON_HANG');
    if (order.DIEM_THUONG_SU_DUNG && !order.DA_TRU_DIEM_THUONG) {
      const points = Number(order.DIEM_THUONG_SU_DUNG);
      const debit = await (await getCollection<any>('KHACH_HANG')).updateOne({ KHACH_HANG_ID: order.KHACH_HANG_ID, DIEM_TICH_LUY: { $gte: points } }, { $inc: { DIEM_TICH_LUY: -points } }, { session });
      if (!debit.matchedCount) throw new InventoryError(409, 'Không đủ điểm để chốt đơn. Cần đối soát trước khi xác nhận.');
      await orders.updateOne({ DON_HANG_ID: order.DON_HANG_ID }, { $set: { DA_TRU_DIEM_THUONG: true } }, { session });
    }
    const links = await (await getCollection<any>('DON_HANG_VOUCHER')).find({ DON_HANG_ID: order.DON_HANG_ID }, { session }).toArray();
    if (links.length) await (await getCollection<any>('VOUCHER')).updateMany({ VOUCHER_ID: { $in: links.map(v => v.VOUCHER_ID) } }, { $set: { DA_DUNG: true } }, { session });

}

/** Called inside the same transaction as payment writes for stock-checked orders. */
export async function syncCheckoutInventory(session: ClientSession, orderId: string, success: boolean) {
  const orders = await getCollection<any>('DON_HANG');
  const order = await orders.findOne({ DON_HANG_ID: orderId }, { session });
  if (!order?.KIEM_TRA_TON_KHO) return;
  const paid = await (await getCollection<any>('THANH_TOAN')).findOne({ DON_HANG_ID: orderId,
    TRANG_THAI_THANH_TOAN: { $in: ['Thành công', 'Thanh toán thành công', 'Đã thanh toán', 'Đã cọc'] } }, { session });
  if (paid) {
    // A failed balance/duplicate attempt must never release already-confirmed stock.
    // Verified receipts themselves are immutable in changeCheckoutPayment.
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
    await orders.updateOne({ DON_HANG_ID: orderId, TRANG_THAI: 'Chờ thanh toán' }, { $set: { TRANG_THAI: 'Thanh toán thất bại' } }, { session });
  }
}
