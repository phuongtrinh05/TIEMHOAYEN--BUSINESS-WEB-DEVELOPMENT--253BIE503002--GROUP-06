import {getActiveBom,makeBomSnapshot} from './inventory/bom.service.js';
import {getDesign,isDesignProduct,designFutureDay} from './design3d.service.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { getCollection } from '../mongo.js';
import { InventoryError, withTransaction } from './inventory/helpers.js';
import { INVENTORY_CONFIG, RESERVATION_STATUS } from './inventory/constants.js';
import { reserveProducts, reserveMaterialNeeds, sweepExpiredReservations } from './inventory/stock.service.js';
import { requestWorkflow } from './request-workflow.js';
import { requestByVerifiedPhone, createRequestAccess, lookupAccess } from './order-access.service.js';
import { checkProductAvailability } from './inventory/availability.service.js';
import { emitAdminNotification } from './analytics/notifications.service.js';

/** Checkout boundary check on the actual allocated stock; does not change the inventory schema. */
export async function assertReservedStockUsable(session: ClientSession, orderId: string, deliveryAt: string, salesReviewed = false) {
  const when = new Date(deliveryAt), now = new Date();
  const day = (v: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(v);
  const future = day(when) !== day(now);
  const holds = await (await getCollection<any>('GIU_TON')).find({ DON_HANG_ID: orderId, TRANG_THAI: { $in: [RESERVATION_STATUS.temporary, RESERVATION_STATUS.official] } }, { session }).toArray();
  const productIds = [...new Set(holds.filter(hold => hold.LOAI_DOI_TUONG === 'THANH_PHAM').map(hold => hold.SAN_PHAM_ID).filter(Boolean))];
  const materialIds = [...new Set(holds.filter(hold => hold.LOAI_DOI_TUONG !== 'THANH_PHAM').map(hold => hold.NGUYEN_VAT_LIEU_ID).filter(Boolean))];
  const receiptIds = [...new Set(holds.map(hold => hold.PHIEU_NHAP_NGUON).filter(Boolean))];
  const [products, materials, sources] = await Promise.all([
    productIds.length ? (await getCollection<any>('SAN_PHAM')).find({ SAN_PHAM_ID: { $in: productIds } }, { session }).toArray() : [],
    materialIds.length ? (await getCollection<any>('NGUYEN_VAT_LIEU')).find({ NGUYEN_VAT_LIEU_ID: { $in: materialIds } }, { session }).toArray() : [],
    receiptIds.length && materialIds.length ? (await getCollection<any>('CHI_TIET_PHIEU_NHAP_NVL')).find({
      PHIEU_NHAP_ID: { $in: receiptIds }, NGUYEN_VAT_LIEU_ID: { $in: materialIds }, LA_NGUON_NHAP: true,
    }, { session }).toArray() : [],
  ]);
  const productById = new Map(products.map(row => [row.SAN_PHAM_ID, row]));
  const materialById = new Map(materials.map(row => [row.NGUYEN_VAT_LIEU_ID, row]));
  const sourceByKey = new Map(sources.map(row => [`${row.PHIEU_NHAP_ID}:${row.NGUYEN_VAT_LIEU_ID}`, row]));
  for (const hold of holds) {
    const product = hold.LOAI_DOI_TUONG === 'THANH_PHAM';
    const item: any = product ? productById.get(hold.SAN_PHAM_ID) : materialById.get(hold.NGUYEN_VAT_LIEU_ID);
    const source: any = hold.PHIEU_NHAP_NGUON ? sourceByKey.get(`${hold.PHIEU_NHAP_NGUON}:${hold.NGUYEN_VAT_LIEU_ID}`) : item;
    if (!item || /ngừng|ngưng|khóa|hỏng/i.test(String(item.TRANG_THAI || ''))) throw new InventoryError(409, 'Thành phẩm hoặc nguyên liệu không còn đủ điều kiện sử dụng.');
    const expiration = source?.NGAY_HET_HAN || source?.HAN_SU_DUNG_DEN || source?.expiresAt;
    const expires = expiration ? new Date(expiration) : null;
    if (expires && (!Number.isFinite(expires.getTime()) || expires <= now || expires < when)) throw new InventoryError(409, 'Hàng đã hết hạn hoặc không bảo đảm hạn dùng tới lịch giao.');
    // The inventory module treats shelf days as a quality-review threshold, not a disposal date.
    const shelfDays = Number(item.SO_NGAY_BAO_QUAN || 0);
    const received = source?.THOI_DIEM_NHAN ? new Date(source.THOI_DIEM_NHAN).getTime() : NaN;
    const qualityUntil = Number.isFinite(received) && shelfDays > 0 ? received + shelfDays * 86400000 : NaN;
    // Số ngày bảo quản là cờ rà soát cho đơn tương lai, không phải ngày hết hạn
    // cứng. Đơn cùng ngày đã đủ tồn và giữ được nguồn thực tế thì đi tiếp.
    if (future && !product && item.NHOM_NVL === 'DE_HU' && !salesReviewed &&
      (!Number.isFinite(qualityUntil) || qualityUntil <= Math.max(now.getTime(), when.getTime()))) {
      throw new InventoryError(409, 'Nguồn hoa cần Sales xác minh chất lượng theo thời điểm nhận và số ngày bảo quản trước khi nhận cọc.');
    }
    if (future && !salesReviewed && !expires && (product || item.NHOM_NVL === 'DE_HU' && !Number.isFinite(qualityUntil))) throw new InventoryError(409, 'Đơn tương lai cần Sales xác minh hạn dùng, nguồn hoa và lịch chuẩn bị trước khi nhận cọc.');
  }
}

export const REQUESTS = 'YEU_CAU_DAT_HANG';
const CHECKOUTS = 'PHIEN_DAT_HANG';
export const REQUEST_STATUS = { waiting: 'Chờ Sales tiếp nhận', processing: 'Sales đang xử lý', quoted: 'Chờ khách xác nhận', accepted: 'Khách đã đồng ý',
  pendingPayment: 'Chờ khách thanh toán', converted: 'Đã lên đơn', rejected: 'Đã từ chối', closed: 'Đã tư vấn', cancelled: 'Khách đã hủy', expired: 'Hết hạn thanh toán' } as const;

/** The browser keeps this key through retries. A persisted outcome never reserves twice. */
export async function routeCheckout(
  key: string,
  payload: any,
  items: { productId: string; quantity: number }[],
  create: (session: ClientSession, orderId: string, prepared?: any) => Promise<any>,
  prepare?: (session: ClientSession) => Promise<any>,
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
  // Inventory cleanup already runs every 60 seconds. Triggering it here is only
  // a best-effort safety net and must never make a customer wait behind up to
  // 200 expired reservations and their transactions.
  void sweepExpiredReservations().catch(error => console.error('[checkout] Không quét được giữ tồn hết hạn', error));
  // Unique order ID: scanning max(existing)+1 races between different buyers.
  const orderId = `YEN${randomBytes(8).toString('hex').toUpperCase()}`;
  let shortage: InventoryError | undefined;
  let prepared = payload;
  try {
    return await withTransaction(async session => {
      await sessions.insertOne({ _id: key, fingerprint, createdAt: new Date() }, { session });
      if (prepare) prepared = await prepare(session);
      try {
        if (prepared.delivery?.deliveryAt) {
          const checks = await Promise.all(items.map(item => checkProductAvailability(item.productId, item.quantity, prepared.delivery.deliveryAt)));
          const review = checks.filter(check => check.decision !== 'available');
          if (review.length) throw new InventoryError(409, 'Shop cần kiểm tra khả năng đáp ứng lịch giao và nguyên liệu.', { availability: review });
        }
        await reserveProducts(items, {
          orderId, paymentSessionId: key, status: RESERVATION_STATUS.temporary,
          actor: { id: payload.customerId || null, role: 'customer' },
        }, session);
        if (prepared.delivery?.deliveryAt) await assertReservedStockUsable(session, orderId, prepared.delivery.deliveryAt);
      } catch (error) {
        if (error instanceof InventoryError && error.status === 409) shortage = error;
        throw error;
      }
      const result = { kind: 'order', ...await create(session, orderId, prepared) };
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
  const shortageDetails: any = shortage?.details || {};
  const availability = Array.isArray(shortageDetails.availability) ? shortageDetails.availability : [];
  const futureDelivery = availability.some((check: any) => check.sameDay === false);
  const routing = availability.find((check: any) => check.routing?.requiresSales)?.routing || {
    scheduleClass: futureDelivery ? 'FUTURE_UNCERTAIN' : 'INSUFFICIENT_STOCK',
    priority: 'NORMAL', reasonCodes: [futureDelivery ? 'FUTURE_SUPPLY_UNVERIFIED' : 'INSUFFICIENT_STOCK'],
    deliveryAt: prepared.delivery?.deliveryAt, evaluatedAt: new Date().toISOString(), timezone: 'Asia/Ho_Chi_Minh',
  };
  const reviewReason = availability.flatMap((check: any) => check.reasons || []).filter(Boolean).join(' ') || (futureDelivery
    ? 'Bạn chọn lịch giao ở ngày tương lai. Shop cần xác minh nguồn hoa, lịch chuẩn bị và khả năng giao trước khi xác nhận đơn.'
    : 'Tồn thành phẩm hiện không đủ; phần còn lại cũng chưa đủ nguyên vật liệu trong BOM để đáp ứng toàn bộ yêu cầu.');
  const result: any = { kind: 'sales_request', requestId, status: REQUEST_STATUS.waiting,
    message: `${reviewReason} Shop đã tiếp nhận yêu cầu để tư vấn. Đây chưa phải đơn đã xác nhận; bạn chưa cần thanh toán.` };
  try {
    return await withTransaction(async session => {
      if (!payload.customerId) {
        const access = await createRequestAccess(requestId, session);
        Object.assign(result, { requestAccessToken: access.accessToken, requestAccessExpiresAt: access.expiresAt,
          requestUrl: `/order-request/${requestId}#access=${access.accessToken}` });
      }
      await sessions.insertOne({ _id: key, fingerprint, result, createdAt: new Date() }, { session });
      const products = await getCollection<any>('SAN_PHAM');
      // Fetch every product in one round trip. The old per-line findOne loop
      // made a Sales request increasingly slow for a cart with many flowers.
      const productRows = await products.find({ SAN_PHAM_ID: { $in: items.map(item => item.productId) } }, { session }).toArray();
      const productById = new Map(productRows.map(product => [String(product.SAN_PHAM_ID), product]));
      const snapshot = items.map(item => {
        const product = productById.get(item.productId);
        const priced = prepared.items?.find((line: any) => line.id === item.productId);
        return { ...item, name: priced?.name || product?.TEN_SAN_PHAM || item.productId,
          price: Number(priced?.price ?? product?.GIA ?? 0), image: priced?.image || '' };
      });
      const requestDocument = {
        _id: requestId, requestId,
        status: REQUEST_STATUS.waiting, assignedTo: null, assignedName: null,
        sender: payload.sender, receiver: payload.receiver, delivery: payload.delivery,
        flags: payload.flags || {}, giftCard: prepared.giftCard || null, originalSummary: prepared.summary || {},
        customerId: payload.customerId || null, items: snapshot,
        reason: shortage!.message, shortages: shortage!.details || null,
        requestReason: futureDelivery ? 'future_delivery' : 'inventory_shortage', reviewReason, routing,
        createdAt: new Date(), updatedAt: new Date(), version: 0,
        history: [{ id: randomUUID(), at: new Date(), action: futureDelivery ? 'Tạo yêu cầu do lịch giao tương lai' : 'Tạo yêu cầu do thiếu tồn khả dụng' }],
      };
      await (await getCollection<any>(REQUESTS)).insertOne(requestDocument, { session });
      if (requestDocument.customerId) {
        const { orderEvent } = await import('./admin-order.service.js');
        await orderEvent(session, `${requestId}:created`, requestDocument.customerId, null, 'Shop đã nhận yêu cầu đặt hoa', `Yêu cầu ${requestId} đang chờ nhân viên tiếp nhận.`, `/order-request/${requestId}`);
      }
      const workflow = requestWorkflow(requestDocument);
      await emitAdminNotification({
        key: `SALES_REQUEST_NEW:${requestId}`, type: 'SALES_REQUEST_NEW', group: 'Đơn hàng', priority: 'Cao',
        module: 'orders', stateful: true, entityId: requestId,
        title: `Yêu cầu đặt hàng mới — ${requestId}`,
        message: `${workflow.priorityLabel} · ${workflow.totalQuantity} bó · ${workflow.priorityReasons.join('; ') || 'Sales kiểm tra và tiếp nhận'}`,
        link: '/orders/requests', queryParams: { requestId },
      }, session);
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
  const hasProposal = !!row.quote;
  const requestUpdatedByProposal = hasProposal && row.acceptance?.via !== 'sales_direct_confirmation';
  const displayedItems = hasProposal ? row.quote.items.map((item: any) => ({
    productId: item.id, name: item.name, quantity: item.qty, price: item.price, image: item.image,
    custom: !!item.custom, bom: item.bom || null, description: item.description || '',
  })) : row.items;
  return { requestId: row.requestId, status: row.status, items: displayedItems, delivery: hasProposal ? row.quote.delivery : row.delivery,
    giftCard: hasProposal ? row.quote.giftCard ?? row.giftCard ?? null : row.giftCard ?? null,
    originalItems: hasProposal ? row.items : null, originalDelivery: hasProposal ? row.delivery : null,
    requestUpdatedByProposal,
    requestReason: row.requestReason || null, routing: row.routing || null,
    reviewReason: row.reviewReason || (row.requestReason === 'future_delivery'
      ? 'Bạn chọn lịch giao ở ngày tương lai. Shop cần xác minh nguồn hoa, lịch chuẩn bị và khả năng giao trước khi xác nhận đơn.'
      : 'Tồn thành phẩm hiện không đủ; phần còn lại cũng chưa đủ nguyên vật liệu trong BOM để đáp ứng toàn bộ yêu cầu.'),
    createdAt: row.createdAt, updatedAt: row.updatedAt, customerAcceptedAt: row.customerAcceptedAt || row.acceptedAt || null,
    paymentDeadlineAt: row.paymentDeadlineAt || null, customerMessage: row.customerMessage || '',
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
      paymentDeadline: row.paymentDeadlineAt ? new Date(row.paymentDeadlineAt).toISOString()
        : payment.HET_HAN_LUC ? new Date(payment.HET_HAN_LUC).toISOString()
        : new Date(new Date(payment.NGAY_THANH_TOAN).getTime() + INVENTORY_CONFIG.holdMinutes * 60000).toISOString() };
  }
  return publicRequest(row);
}

export async function updateSalesRequest(id: string, body: any, employee: any) {
  if (!Number.isInteger(body.version)) throw new InventoryError(400, 'Thiếu phiên bản yêu cầu.');
  const requests = await getCollection<any>(REQUESTS);
  const row = await requests.findOne({ _id: id });
  if (!row) throw new InventoryError(404, 'Không tìm thấy yêu cầu.');
  const rowVersion = Number.isInteger(row.version) ? row.version : 0;
  if (rowVersion !== body.version) throw new InventoryError(409, 'Yêu cầu vừa thay đổi. Vui lòng tải lại.');
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
  const versionFilter = Number.isInteger(row.version) ? { version: row.version } : { $or: [{ version: { $exists: false } }, { version: null }] };
  const updated = await requests.findOneAndUpdate({ _id: id, status: row.status, ...versionFilter }, {
    $set: { status, updatedAt: new Date(), ...(body.action === 'reject' ? { acceptedQuoteId: null } : {}), ...(claim ? { assignedTo: employee.NHAN_VIEN_ID, assignedName: employee.HO_TEN || employee.TEN || employee.NHAN_VIEN_ID } : { customerMessage: note }) },
    $inc: { version: 1 },
    $push: { history: { id: randomUUID(), actor: employee.NHAN_VIEN_ID, at: new Date(), action: body.action, note } },
  } as any, { returnDocument: 'after', includeResultMetadata: false });
  if (!updated) throw new InventoryError(409, 'Có nhân viên khác vừa cập nhật. Vui lòng tải lại.');
  if (claim || body.action === 'reject') {
    const { orderEvent } = await import('./admin-order.service.js');
    await orderEvent(undefined, `${id}:${body.action}:${updated.version}`, updated.customerId || null, null,
      claim ? 'Sales đã tiếp nhận yêu cầu' : 'Shop đã từ chối yêu cầu',
      claim ? 'Nhân viên đang kiểm tra khả năng đáp ứng và sẽ liên hệ với bạn.' : note,
      `/order-request/${id}`);
  }
  return updated;
}
