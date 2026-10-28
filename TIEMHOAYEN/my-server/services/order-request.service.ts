import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { getCollection } from '../mongo.js';
import { InventoryError, withTransaction } from './inventory/helpers.js';
import { INVENTORY_CONFIG, RESERVATION_STATUS } from './inventory/constants.js';
import { reserveProducts, sweepExpiredReservations } from './inventory/stock.service.js';
import { requestWorkflow } from './request-workflow.js';
import { requestByVerifiedPhone } from './order-access.service.js';

export const REQUESTS = 'YEU_CAU_DAT_HANG';
const CHECKOUTS = 'PHIEN_DAT_HANG';
export const REQUEST_STATUS = { waiting: 'Chờ Sales tiếp nhận', processing: 'Sales đang xử lý', quoted: 'Chờ khách xác nhận', accepted: 'Khách đã đồng ý', converted: 'Đã lên đơn', rejected: 'Đã từ chối', closed: 'Đã tư vấn', cancelled: 'Khách đã hủy' } as const;

/** The browser keeps this key through retries. A persisted outcome never reserves twice. */
export async function routeCheckout(
  key: string,
  payload: any,
  items: { productId: string; quantity: number }[],
  create: (session: ClientSession, orderId: string) => Promise<any>,
) {
  if (!/^[\w-]{16,100}$/.test(key)) throw new InventoryError(400, 'Thiếu mã phiên đặt hàng hợp lệ. Vui lòng tải lại trang.');
  const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const sessions = await getCollection<any>(CHECKOUTS);
  const existingOutcome = async () => {
    const existing = await sessions.findOne({ _id: key });
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint) throw new InventoryError(409, 'Phiên này đã gửi nội dung khác. Vui lòng bắt đầu lần đặt hàng mới.');
    return existing.result;
  };
  const old = await existingOutcome();
  if (old) return old;
  await sweepExpiredReservations();
  // Unique order ID: scanning max(existing)+1 races between different buyers.
  const orderId = `YEN${randomBytes(8).toString('hex').toUpperCase()}`;
  let shortage: InventoryError | undefined;
  try {
    return await withTransaction(async session => {
      await sessions.insertOne({ _id: key, fingerprint, createdAt: new Date() }, { session });
      try {
        await reserveProducts(items, {
          orderId, paymentSessionId: key, status: RESERVATION_STATUS.temporary,
          actor: { id: payload.customerId || null, role: 'customer' },
        }, session);
      } catch (error) {
        if (error instanceof InventoryError && error.status === 409) shortage = error;
        throw error;
      }
      const result = { kind: 'order', ...await create(session, orderId) };
      await sessions.updateOne({ _id: key }, { $set: { result } }, { session });
      return result;
    });
  } catch (error: any) {
    // A double click can race before the first transaction commits.
    if (error.code === 11000) {
      const old = await existingOutcome();
      if (old) return old;
    }
    if (error !== shortage) throw error;
  }
  // Reservation transaction has rolled back ALL lines. A request creates no payment.
  const requestId = `YC${randomBytes(8).toString('hex').toUpperCase()}`;
  const result = { kind: 'sales_request', requestId, status: REQUEST_STATUS.waiting,
    message: 'Số lượng khả dụng đã thay đổi. Yêu cầu đã được chuyển đến nhân viên Sales; shop sẽ liên hệ xác nhận trước khi thanh toán.' };
  try {
    return await withTransaction(async session => {
      await sessions.insertOne({ _id: key, fingerprint, result, createdAt: new Date() }, { session });
      const products = await getCollection<any>('SAN_PHAM');
      const snapshot = [];
      for (const item of items) {
        const product = await products.findOne({ SAN_PHAM_ID: item.productId }, { session });
        snapshot.push({ ...item, name: product?.TEN_SAN_PHAM || item.productId, price: Number(product?.GIA || 0) });
      }
      await (await getCollection<any>(REQUESTS)).insertOne({
        _id: requestId, requestId,
        status: REQUEST_STATUS.waiting, assignedTo: null, assignedName: null,
        sender: payload.sender, receiver: payload.receiver, delivery: payload.delivery,
        flags: payload.flags || {}, originalSummary: payload.summary || {},
        customerId: payload.customerId || null, items: snapshot,
        reason: shortage!.message, shortages: shortage!.details || null,
        createdAt: new Date(), updatedAt: new Date(), version: 0,
        history: [{ id: randomUUID(), at: new Date(), action: 'Tạo yêu cầu do thiếu tồn khả dụng' }],
      }, { session });
      return result;
    });
  } catch (error: any) {
    if (error.code === 11000) {
      const old = await existingOutcome();
      if (old) return old;
    }
    throw error;
  }
}

export function publicRequest(row: any) {
  return { requestId: row.requestId, status: row.status, items: row.items, delivery: row.delivery,
    reviewReason: 'Mẫu bạn chọn hiện chưa đủ thành phẩm hoặc nguyên vật liệu khả dụng để đáp ứng toàn bộ yêu cầu. Lượng hàng có thể đã được giữ cho đơn khác trong lúc bạn đặt.',
    createdAt: row.createdAt, updatedAt: row.updatedAt, customerMessage: row.customerMessage || '',
    assignedName: row.assignedName || null, originalTotal: row.originalSummary?.total ?? null, quote: row.quote || null, acceptedQuoteId: row.acceptedQuoteId || null,
    workflow: requestWorkflow(row), orderSummary: row.orderSummary || null,
    orderResult: row.orderResult || null, checkoutData: row.checkoutData || null };
}

export async function getPublicRequest(id: string, token: string) {
  const row = await requestByVerifiedPhone(id, token);
  if (!row) throw new InventoryError(404, 'Không tìm thấy yêu cầu.');
  if (row.orderId) {
    const order = await (await getCollection<any>('DON_HANG')).findOne({ DON_HANG_ID: row.orderId });
    const payment = await (await getCollection<any>('THANH_TOAN')).find({ DON_HANG_ID: row.orderId }).sort({ NGAY_THANH_TOAN: -1 }).limit(1).next();
    row.orderSummary = { status: order?.TRANG_THAI || 'Đã tạo đơn', paymentStatus: payment?.TRANG_THAI_THANH_TOAN || 'Chưa ghi nhận',
      hasPaid: ['Thành công','Đã thanh toán','Đã cọc','Thanh toán thành công'].includes(payment?.TRANG_THAI_THANH_TOAN) };
    if (payment && row.orderResult) row.orderResult = { ...row.orderResult, paymentId: payment.THANH_TOAN_ID, transactionCode: payment.MA_GIAO_DICH,
      paymentAmount: payment.SO_TIEN, paymentStatus: payment.TRANG_THAI_THANH_TOAN,
      paymentDeadline: new Date(new Date(payment.NGAY_THANH_TOAN).getTime() + INVENTORY_CONFIG.holdMinutes * 60000).toISOString() };
  }
  return publicRequest(row);
}

export async function updateSalesRequest(id: string, body: any, employee: any) {
  if (!Number.isInteger(body.version)) throw new InventoryError(400, 'Thiếu phiên bản yêu cầu.');
  const requests = await getCollection<any>(REQUESTS);
  const row = await requests.findOne({ _id: id });
  if (!row) throw new InventoryError(404, 'Không tìm thấy yêu cầu.');
  if (row.version !== body.version) throw new InventoryError(409, 'Yêu cầu vừa thay đổi. Vui lòng tải lại.');
  const claim = body.action === 'claim';
  const editable = [REQUEST_STATUS.processing, REQUEST_STATUS.quoted, REQUEST_STATUS.accepted];
  if (claim ? row.status !== REQUEST_STATUS.waiting : !editable.includes(row.status) || row.assignedTo !== employee.NHAN_VIEN_ID) {
    throw new InventoryError(409, 'Yêu cầu đã được tiếp nhận hoặc không thuộc phần xử lý của bạn.');
  }
  if (!['claim', 'note', 'reject', 'close'].includes(body.action)) throw new InventoryError(400, 'Thao tác không hợp lệ.');
  if (body.action === 'close' && row.status !== REQUEST_STATUS.processing) throw new InventoryError(409, 'Phương án đang xử lý phải được lên đơn hoặc từ chối kèm lý do.');
  const note = String(body.note || '').trim();
  if (!claim && (!note || note.length > 2000)) throw new InventoryError(400, 'Nhập nội dung xử lý từ 1–2000 ký tự.');
  const status = claim ? REQUEST_STATUS.processing : body.action === 'reject' ? REQUEST_STATUS.rejected : body.action === 'close' ? REQUEST_STATUS.closed : row.status;
  const updated = await requests.findOneAndUpdate({ _id: id, version: body.version, status: row.status }, {
    $set: { status, updatedAt: new Date(), ...(body.action === 'reject' ? { acceptedQuoteId: null } : {}), ...(claim ? { assignedTo: employee.NHAN_VIEN_ID, assignedName: employee.HO_TEN || employee.TEN || employee.NHAN_VIEN_ID } : { customerMessage: note }) },
    $inc: { version: 1 },
    $push: { history: { id: randomUUID(), actor: employee.NHAN_VIEN_ID, at: new Date(), action: body.action, note } },
  } as any, { returnDocument: 'after', includeResultMetadata: false });
  if (!updated) throw new InventoryError(409, 'Có nhân viên khác vừa cập nhật. Vui lòng tải lại.');
  return updated;
}
