import {orderEvent} from './admin-order.service.js';
import type { ClientSession } from 'mongodb';
import { getCollection } from '../mongo.js';
import { InventoryError } from './inventory/helpers.js';
import { confirmReservations, releaseReservations } from './inventory/stock.service.js';
import { recordHeldDemand, recordOrderDemand } from './inventory/stock.service.js';
import { INVENTORY_CONFIG } from './inventory/constants.js';
import { randomUUID, createHash } from 'node:crypto';
import { paymentSucceeded, sumVerifiedPayments } from './admin-order.service.js';
import { claimVoucherUsage } from './pricing-voucher.service.js';

/** All money-changing entry points share this transaction-scoped command. */
export async function changeCheckoutPayment(session: ClientSession, paymentId: string, body: any, actor: string, collections: typeof getCollection = getCollection) {
  const payments = await collections<any>('THANH_TOAN');
  const current = await payments.findOne({ THANH_TOAN_ID: paymentId }, { session });
  if (!current) throw new InventoryError(404, 'Không tìm thấy giao dịch.');
  if (current.LOAI_GIAO_DICH === 'HOAN_TIEN') throw new InventoryError(409, 'Giao dịch hoàn tiền cần xử lý trong hồ sơ hậu mãi, không đổi trạng thái tại khoản thu.');
  const order = await (await collections<any>('DON_HANG')).findOne({ DON_HANG_ID: current.DON_HANG_ID }, { session });
  if (!order) throw new InventoryError(404, 'Không tìm thấy đơn của giao dịch.');
  const requested = String(body.status ?? current.TRANG_THAI_THANH_TOAN);
  const success = paymentSucceeded(requested) || requested === 'Đã thanh toán cọc';
  const failed = ['Thất bại', 'Thanh toán thất bại', 'Thanh toán cọc thất bại', 'Hết hạn'].includes(requested);
  if (current.LOAI_GIAO_DICH === 'SO_DU' && requested === 'Hết hạn') {
    throw new InventoryError(400, 'Khoản số dư chỉ nhận kết quả đã thanh toán hoặc thanh toán thất bại.');
  }
  if (!success && !failed) throw new InventoryError(400, 'Chỉ xác nhận thành công hoặc thất bại cho giao dịch đang chờ.');
  const amount = body.amount === undefined ? Number(current.SO_TIEN) : Number(body.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount !== Number(current.SO_TIEN)) throw new InventoryError(409, 'Số tiền phải khớp nghĩa vụ thanh toán, không được sửa khoản thu.');
  const reference = String(body.referenceCode ?? current.MA_GIAO_DICH ?? '').trim();
  const target = success ? 'Thành công' : requested === 'Hết hạn' || requested === 'EXPIRED' ? 'Hết hạn' : 'Thất bại';
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
    $set: { TRANG_THAI_THANH_TOAN: target, MA_GIAO_DICH: reference || null,
      ...(success ? { XAC_NHAN_LUC: new Date(), NGUOI_XAC_NHAN: actor, NGUON_XAC_NHAN:String(body.source || 'ADMIN_MANUAL') } : {}) },
    $push: { LICH_SU: { id: randomUUID(), from: current.TRANG_THAI_THANH_TOAN, to: target, actor, at: new Date(),
      source:String(body.source || 'ADMIN_MANUAL'), reason:String(body.reason || '').trim() || null, reference:reference || null } },
  } as any, { session, returnDocument: 'after' });
  if (!updated) throw new InventoryError(409, 'Giao dịch vừa được người khác xử lý.');
  if (success) {
    await consumeCheckoutBenefits(session, order);
    if (order.YEU_CAU_DAT_HANG_ID) {
      await (await collections<any>('YEU_CAU_DAT_HANG')).updateOne({ _id: order.YEU_CAU_DAT_HANG_ID, status: { $in: ['Chờ thanh toán', 'Chờ khách thanh toán'] } }, {
        $set: { status: 'Đã lên đơn', updatedAt: new Date() }, $inc: { version: 1 },
        $push: { history: { id: randomUUID(), at: new Date(), actor, action: 'Thanh toán thành công, yêu cầu đã lên đơn', orderId: order.DON_HANG_ID } },
      } as any, { session });
    }
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
      const after = await (await getCollection<any>('KHACH_HANG')).findOne({ KHACH_HANG_ID: order.KHACH_HANG_ID }, { session, projection: { DIEM_TICH_LUY: 1 } });
      await (await getCollection<any>('LICH_SU_DIEM')).insertOne({ NGUON_LOAI: 'DON_HANG', NGUON_ID: order.DON_HANG_ID, LOAI_BUT_TOAN: 'SU_DUNG', KHACH_HANG_ID: order.KHACH_HANG_ID,
        SO_DIEM: -points, SO_DU_SAU: Number(after?.DIEM_TICH_LUY || 0), NGAY_TAO: new Date() }, { session });
    }
    const links = await (await getCollection<any>('DON_HANG_VOUCHER')).find({ DON_HANG_ID: order.DON_HANG_ID }, { session }).toArray();
    for (const link of links) {
      const usageId = `${link.VOUCHER_ID}:${order.DON_HANG_ID}`;
      if (await (await getCollection<any>('VOUCHER_SU_DUNG')).findOne({ _id: usageId }, { session })) continue;
      const voucher = await (await getCollection<any>('VOUCHER')).findOne({ VOUCHER_ID: link.VOUCHER_ID }, { session });
      if (!voucher) throw new InventoryError(409, 'Voucher của đơn không còn tồn tại.');
      const identityKey = order.KHACH_HANG_ID
        ? `member:${order.KHACH_HANG_ID}`
        : `guest:${createHash('sha256').update(String(order.SDT_NGUOI_DAT || '').replace(/\D/g, '')).digest('hex')}`;
      await claimVoucherUsage(session, {
        voucher,
        identityKey,
        perUserLimit: Number(voucher.GIOI_HAN_MOI_NGUOI || (voucher.KHACH_HANG_ID ? 1 : 0)),
      }, order.DON_HANG_ID);
      // Voucher cá nhân dùng một lần: đánh dấu đã dùng. Voucher công khai chỉ tăng lượt (claimVoucherUsage), không khóa với mọi người.
      if (voucher.KHACH_HANG_ID) await (await getCollection<any>('VOUCHER')).updateOne({ VOUCHER_ID: voucher.VOUCHER_ID }, { $set: { DA_DUNG: true } }, { session });
    }

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
  if (!['Chờ thanh toán', 'Đã xác nhận đơn hàng', 'Chờ xử lý', 'Thanh toán thất bại'].includes(order.TRANG_THAI)) {
    throw new InventoryError(409, 'Trạng thái đơn không cho phép xác nhận thanh toán.');
  }
  const filter = order.MA_PHIEN_THANH_TOAN ? { paymentSessionId: order.MA_PHIEN_THANH_TOAN } : { orderId };
  if(order.KHONG_GIU_TAM_NVL) {
    if(success) {
      const latest=await (await getCollection<any>('THANH_TOAN')).find({DON_HANG_ID:orderId},{session}).sort({NGAY_THANH_TOAN:-1}).limit(1).next();
      if(!latest || latest.TRANG_THAI_THANH_TOAN==='Thất bại' || Date.now()>new Date(latest.NGAY_THANH_TOAN).getTime()+INVENTORY_CONFIG.holdMinutes*60000)throw new InventoryError(410,'Phiên thanh toán đã hết hạn; cần tạo QR mới.');
      await recordOrderDemand(orderId,{}, {id:'PAYMENT',role:'system'}, {paymentConfirmed:true}, session);
      // Thanh toán hợp lệ → đơn chính thức, NVL được lập nhu cầu "Chờ giữ" theo T.
      await orders.updateOne({DON_HANG_ID:orderId},{$set:{TRANG_THAI:'Đã đặt hàng thành công',NGAY_CAP_NHAT:new Date()},
        $push:{LICH_SU_TRANG_THAI:{from:order.TRANG_THAI,to:'Đã đặt hàng thành công',at:new Date(),actor:'PAYMENT',reason:'Đã xác nhận nghĩa vụ thanh toán/cọc'}}} as any,{session});
    }
    return;
  }
  if (success) {
    await confirmReservations(filter, orderId, { id: 'PAYMENT', role: 'system' }, session);
    // Đơn đã giữ NVL ngay (dưới 24 giờ / Sales xác nhận): ghi nhu cầu "Đã giữ" liên kết các dòng giữ, không giữ thêm lần nữa.
    await recordHeldDemand(orderId, { id: 'PAYMENT', role: 'system' }, session);
    await orders.updateOne({ DON_HANG_ID: orderId }, { $set: { TRANG_THAI: 'Đã đặt hàng thành công', NGAY_CAP_NHAT: new Date() },
      $push: { LICH_SU_TRANG_THAI: { from: order.TRANG_THAI, to: 'Đã đặt hàng thành công', at: new Date(), actor: 'PAYMENT', reason: 'Đã xác nhận nghĩa vụ thanh toán/cọc' } } } as any, { session });
  } else {
    await releaseReservations(filter, { id: 'PAYMENT', role: 'system' }, 'Hết hạn / thất bại thanh toán', session);
    await orders.updateOne({ DON_HANG_ID: orderId, TRANG_THAI: 'Chờ thanh toán' }, { $set: { TRANG_THAI: 'Thanh toán thất bại' } }, { session });
  }
}
