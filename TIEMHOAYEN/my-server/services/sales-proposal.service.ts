import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { escapeRegex, getCollection } from '../mongo.js';
import { availableOf, finishedAvailableOf, InventoryError, withTransaction } from './inventory/helpers.js';
import { MATERIAL_STATUS, RESERVATION_STATUS } from './inventory/constants.js';
import { computeBuildable, supplierOptionsFor } from './inventory/availability.service.js';
import { getActiveBom, getActiveBomMap } from './inventory/bom.service.js';
import { REQUESTS, REQUEST_STATUS, publicRequest } from './order-request.service.js';
import { requestByVerifiedPhone } from './order-access.service.js';
import { reserveOrderLines } from './order-stock.service.js';
import { sweepExpiredReservations } from './inventory/stock.service.js';
import { writeCheckoutOrder } from './checkout-order-writer.service.js';

export const MESSAGES = 'TIN_NHAN_CHAT';
export const SALES_CHAT_TYPES = ['sales_request_customer', 'sales_request_staff'];
const inactive = (status: any) => /ngừng|ngưng|ẩn|khóa/i.test(String(status || ''));
const text = (value: unknown, max = 2000) => {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new InventoryError(400, `Nội dung phải có từ 1–${max} ký tự.`);
  return result;
};
const amount = (value: unknown) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000_000) throw new InventoryError(400, 'Số tiền không hợp lệ.');
  return n;
};
const quantity = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new InventoryError(400, 'Định lượng phải lớn hơn 0 và không quá 1000.');
  return n;
};
const priceOf = (p: any) => {
  const sale = Number(p.GIA_KHUYEN_MAI);
  return amount(sale > 0 && sale < Number(p.GIA) ? sale : p.GIA);
};
export const bomFingerprint = (bom: any) => createHash('sha256').update(JSON.stringify({
  id: bom.bom?.BOM_ID || null, version: bom.bom?.PHIEN_BAN || null,
  lines: [...bom.lines].sort((a: any, b: any) => a.NGUYEN_VAT_LIEU_ID.localeCompare(b.NGUYEN_VAT_LIEU_ID)),
})).digest('hex');

export async function requestForCustomer(id: string, token: string, session?: ClientSession) {
  return requestByVerifiedPhone(id, token, session);
}
async function ownedRequest(id: string, employee: any, session?: ClientSession) {
  const row = await (await getCollection<any>(REQUESTS)).findOne({ _id: id }, { session });
  if (!row) throw new InventoryError(404, 'Không tìm thấy yêu cầu.');
  if (row.assignedTo !== employee.NHAN_VIEN_ID) throw new InventoryError(403, 'Bạn chưa tiếp nhận yêu cầu này.');
  return row;
}
function assertVersion(row: any, version: unknown) {
  if (!Number.isInteger(version) || row.version !== version) throw new InventoryError(409, 'Yêu cầu vừa thay đổi. Vui lòng tải lại.');
}
function deliveryAt(date: unknown, time: unknown) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) throw new InventoryError(400, 'Chọn ngày và giờ giao hợp lệ.');
  const parsed = new Date(`${date}T${time}:00+07:00`);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) throw new InventoryError(400, 'Thời gian giao phải ở tương lai.');
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
  if (key !== String(date)) throw new InventoryError(400, 'Ngày giao không tồn tại.');
  return parsed;
}
async function snapshotItem(raw: any, index: number, session: ClientSession) {
  const qty = quantity(raw.qty);
  if (!Number.isInteger(qty)) throw new InventoryError(400, 'Số bó phải là số nguyên.');
  if (raw.custom) {
    const name = text(raw.name, 150);
    const image = String(raw.image || '');
    if (!/^\/uploads\/materials\/[\w.-]+$/.test(image) && !/^https?:\/\//.test(image)) throw new InventoryError(400, 'Bó phối mới cần ảnh mẫu hoặc ảnh minh họa hợp lệ.');
    const imageDescription = text(raw.imageDescription, 300);
    if (!Array.isArray(raw.materials) || !raw.materials.length || raw.materials.length > 40) throw new InventoryError(400, 'Bó phối mới cần 1–40 nguyên vật liệu.');
    const seen = new Set<string>();
    const materials = [];
    for (const l of raw.materials) {
      const id = String(l.materialId || '');
      if (seen.has(id)) throw new InventoryError(400, 'Nguyên vật liệu bị trùng; hãy gộp định lượng.');
      seen.add(id);
      const m = await (await getCollection<any>('NGUYEN_VAT_LIEU')).findOne({ NGUYEN_VAT_LIEU_ID: id }, { session });
      if (!m || inactive(m.TRANG_THAI)) throw new InventoryError(400, `Nguyên vật liệu ${id} không còn sử dụng.`);
      if (!(Number(m.GIA_BAN) > 0)) throw new InventoryError(400, `${m.TEN_NGUYEN_VAT_LIEU}: chưa có giá bán NVL. Cần cập nhật trước khi báo giá.`);
      materials.push({ materialId: id, name: m.TEN_NGUYEN_VAT_LIEU, quantity: quantity(l.quantity), unit: m.DON_VI_TINH, price: amount(m.GIA_BAN) });
    }
    const designFee = amount(raw.designFee || 0), extraFee = amount(raw.extraFee || 0);
    const price = amount(Math.round(materials.reduce((sum, l) => sum + l.quantity * l.price, 0)) + designFee + extraFee);
    if (price <= 0) throw new InventoryError(400, 'Giá bó hoa phải lớn hơn 0.');
    return { id: `SPYC_${index}`, name, qty, price, image, imageDescription, custom: true,
      bom: { materials, designFee, extraFee }, description: String(raw.description || '').slice(0, 2000) };
  }
  const id = String(raw.id || '');
  const p = await (await getCollection<any>('SAN_PHAM')).findOne({ SAN_PHAM_ID: id }, { session });
  if (!p || inactive(p.TRANG_THAI)) throw new InventoryError(400, `Sản phẩm ${id} không còn bán.`);
  const image = await (await getCollection<any>('HINH_ANH_SAN_PHAM')).find({ SAN_PHAM_ID: id }, { session }).sort({ LA_ANH_CHINH: -1, HINH_ANH_ID: 1 }).limit(1).next();
  const resolved = await getActiveBom(id, session);
  const price = priceOf(p);
  if (price <= 0) throw new InventoryError(400, 'Mẫu chưa có giá bán hợp lệ.');
  return { id, name: p.TEN_SAN_PHAM, qty, price, image: image?.URL || '', custom: false,
    imageDescription: 'Ảnh mẫu sản phẩm', bom: { fingerprint: bomFingerprint(resolved), version: resolved.bom?.PHIEN_BAN || null, lines: resolved.lines } };
}

/** A proposal is a new immutable commercial snapshot; it never overwrites the original request. */
export async function propose(id: string, body: any, employee: any) {
  return withTransaction(async session => {
    const row = await ownedRequest(id, employee, session);
    assertVersion(row, body.version);
    if (![REQUEST_STATUS.processing, REQUEST_STATUS.quoted, REQUEST_STATUS.accepted].includes(row.status)) throw new InventoryError(409, 'Yêu cầu không thể sửa phương án ở trạng thái này.');
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 20) throw new InventoryError(400, 'Phương án cần 1–20 dòng sản phẩm.');
    const at = deliveryAt(body.date, body.time);
    const items = [];
    for (const [index, raw] of body.items.entries()) items.push(await snapshotItem(raw, index, session));
    const ids = items.map(i => i.id);
    if (new Set(ids).size !== ids.length) throw new InventoryError(400, 'Sản phẩm bị trùng; hãy gộp số lượng.');
    const subtotal = amount(items.reduce((sum, i) => sum + i.qty * i.price, 0));
    const shippingFee = amount(body.shippingFee || 0), total = amount(subtotal + shippingFee);
    const method = body.paymentMethod === 'cod' ? 'cod' : body.paymentMethod === 'bank' ? 'bank' : '';
    if (!method) throw new InventoryError(400, 'Chọn chuyển khoản toàn bộ hoặc cọc rồi thanh toán khi nhận hàng.');
    const depositAmount = method === 'cod' ? amount(body.depositAmount) : 0;
    if (method === 'cod' && (depositAmount <= 0 || depositAmount > total)) throw new InventoryError(400, 'Tiền cọc thỏa thuận phải lớn hơn 0 và không vượt tổng đơn.');
    const quote = { id: randomUUID(), revision: Math.max(Number(row.quote?.revision || 0), ...(row.quoteHistory || []).map((q: any) => Number(q.revision || 0))) + 1, createdAt: new Date(), createdBy: employee.NHAN_VIEN_ID,
      items, delivery: { ...row.delivery, date: body.date, time: body.time }, deliveryAt: at,
      summary: { subtotal, shippingFee, total, depositAmount, loyaltyDiscount: 0, loyaltyPoints: 0 },
      payment: { method, methodName: method === 'cod' ? 'Cọc thỏa thuận với Sales, còn lại COD' : 'Chuyển khoản', amountToPay: method === 'cod' ? depositAmount : total },
      note: text(body.note), discountNote: 'Giá phương án này chưa áp dụng voucher hoặc điểm của yêu cầu cũ.' };
    await (await getCollection<any>(REQUESTS)).updateOne({ _id: id, version: row.version }, {
      $set: { quote, status: REQUEST_STATUS.quoted, acceptedQuoteId: null, acceptedAt: null, acceptance: null, updatedAt: new Date() },
      $inc: { version: 1 }, $push: { quoteHistory: quote, history: { id: randomUUID(), at: new Date(), actor: employee.NHAN_VIEN_ID, action: `Gửi phương án phiên bản ${quote.revision}`, quoteId: quote.id } },
    } as any, { session });
    return quote;
  });
}

export async function respondToProposal(id: string, token: string, body: any) {
  return withTransaction(async session => {
    const row = await requestForCustomer(id, token, session);
    if (!['accept', 'decline'].includes(body.action)) throw new InventoryError(400, 'Lựa chọn không hợp lệ.');
    if (!row.quote || row.quote.id !== body.quoteId) throw new InventoryError(409, 'Phương án đã được thay đổi. Vui lòng xem phiên bản mới.');
    if (body.action === 'accept' && row.acceptedQuoteId === body.quoteId && [REQUEST_STATUS.accepted, REQUEST_STATUS.converted].includes(row.status)) return publicRequest(row);
    if (row.status !== REQUEST_STATUS.quoted) throw new InventoryError(409, 'Phương án không còn chờ xác nhận.');
    deliveryAt(row.quote.delivery.date, row.quote.delivery.time);
    const accept = body.action === 'accept';
    const updates = { status: accept ? REQUEST_STATUS.accepted : REQUEST_STATUS.processing,
      acceptedQuoteId: accept ? row.quote.id : null, acceptedAt: accept ? new Date() : null,
      acceptance: accept ? { via: 'website', quoteId: row.quote.id, at: new Date() } : null, updatedAt: new Date() };
    await (await getCollection<any>(REQUESTS)).updateOne({ _id: id, version: row.version }, {
      $set: updates, $inc: { version: 1 },
      $push: { history: { id: randomUUID(), at: new Date(), actor: 'CUSTOMER', action: accept ? 'Khách đồng ý phương án' : 'Khách muốn tư vấn lại', quoteId: row.quote.id } },
    } as any, { session });
    return publicRequest({ ...row, ...updates });
  });
}

export async function convertProposal(id: string, body: any, employee: any) {
  await sweepExpiredReservations();
  return withTransaction(async session => {
    const row = await ownedRequest(id, employee, session);
    if (row.status === REQUEST_STATUS.converted && row.quote?.id === body.quoteId) return row.orderResult;
    assertVersion(row, body.version);
    if (row.status !== REQUEST_STATUS.accepted || row.quote?.id !== body.quoteId || row.acceptedQuoteId !== body.quoteId) throw new InventoryError(409, 'Khách chưa đồng ý đúng phiên bản phương án này.');
    deliveryAt(row.quote.delivery.date, row.quote.delivery.time);
    for (const item of row.quote.items) {
      if (item.custom) {
        for (const line of item.bom.materials) {
          const m = await (await getCollection<any>('NGUYEN_VAT_LIEU')).findOne({ NGUYEN_VAT_LIEU_ID: line.materialId }, { session });
          if (!m || inactive(m.TRANG_THAI)) throw new InventoryError(409, 'NVL của phương án đã ngừng sử dụng. Hãy gửi lại phương án mới.');
        }
      } else {
        const p = await (await getCollection<any>('SAN_PHAM')).findOne({ SAN_PHAM_ID: item.id }, { session });
        if (!p || inactive(p.TRANG_THAI)) throw new InventoryError(409, 'Mẫu đã ngừng bán. Hãy tư vấn phương án khác.');
        if (bomFingerprint(await getActiveBom(item.id, session)) !== item.bom.fingerprint) throw new InventoryError(409, 'Công thức mẫu đã thay đổi. Hãy gửi phương án mới để khách xác nhận lại.');
      }
    }
    const orderId = `YEN${randomBytes(8).toString('hex').toUpperCase()}`;
    const paymentSessionId = `sales-${row.quote.id}`;
    const ctx = { orderId, paymentSessionId, status: RESERVATION_STATUS.temporary, actor: { id: employee.NHAN_VIEN_ID, role: 'sales' } };
    const items = row.quote.items.map((item: any) => ({ ...item, id: item.custom ? `SPYC_${row.quote.id}_${item.id}` : item.id }));
    await reserveOrderLines(session, items, ctx);
    const checkoutData = { customerId: row.customerId, sender: row.sender, receiver: row.receiver, flags: row.flags,
      delivery: row.quote.delivery, summary: row.quote.summary, payment: row.quote.payment, items, checkoutSessionId: paymentSessionId };
    const result = { kind: 'order', ...await writeCheckoutOrder(session, orderId, checkoutData, { requestId: id, quote: row.quote }) };
    await (await getCollection<any>(MESSAGES)).updateMany({ YEU_CAU_ID: id, LOAI_TIN_NHAN: { $in: SALES_CHAT_TYPES } }, { $set: { DON_HANG_ID: orderId } }, { session });
    await (await getCollection<any>(REQUESTS)).updateOne({ _id: id, version: row.version }, {
      $set: { orderId, orderResult: result, checkoutData, status: REQUEST_STATUS.converted, updatedAt: new Date() }, $inc: { version: 1 },
      $push: { history: { id: randomUUID(), at: new Date(), actor: employee.NHAN_VIEN_ID, action: 'Lên đơn từ phương án khách đồng ý', quoteId: row.quote.id, orderId } },
    } as any, { session });
    return result;
  });
}

export async function consultationOptions(id: string, search: string, employee: any) {
  const row = await ownedRequest(id, employee);
  const query: any = { TRANG_THAI: { $nin: ['Ngừng bán', 'Ẩn'] } };
  if (search.trim()) query.$or = [{ TEN_SAN_PHAM: { $regex: escapeRegex(search.slice(0, 100)), $options: 'i' } }, { SAN_PHAM_ID: search.slice(0, 100) }];
  const products = await (await getCollection<any>('SAN_PHAM')).find(query).sort({ TON_THANH_PHAM: -1, SAN_PHAM_ID: 1 }).limit(30).toArray();
  const originalIds = row.items.map((item: any) => item.productId);
  const original = await (await getCollection<any>('SAN_PHAM')).find({ SAN_PHAM_ID: { $in: originalIds } }).toArray();
  const all = [...new Map([...original, ...products].map(p => [p.SAN_PHAM_ID, p])).values()];
  const map = await getActiveBomMap(all.map(p => p.SAN_PHAM_ID));
  const originalBoms = await (await getCollection<any>('BOM_SAN_PHAM')).find({ SAN_PHAM_ID: { $in: originalIds }, TRANG_THAI: 'Hiệu lực' }).toArray();
  const materials = await (await getCollection<any>('NGUYEN_VAT_LIEU')).find({ TRANG_THAI: { $ne: MATERIAL_STATUS.hidden } }).sort({ TEN_NGUYEN_VAT_LIEU: 1 }).toArray();
  const byId = new Map(materials.map(m => [m.NGUYEN_VAT_LIEU_ID, m]));
  const images = await (await getCollection<any>('HINH_ANH_SAN_PHAM')).find({ SAN_PHAM_ID: { $in: all.map(p => p.SAN_PHAM_ID) } }).sort({ LA_ANH_CHINH: -1 }).toArray();
  const choices = all.map(p => {
    const bom = map.get(p.SAN_PHAM_ID) || [];
    const computed = computeBuildable(bom, byId);
    const requestedQuantity = Number(row.items.find((item: any) => item.productId === p.SAN_PHAM_ID)?.quantity || 1);
    const toMake = Math.max(0, requestedQuantity - finishedAvailableOf(p));
    return { id: p.SAN_PHAM_ID, name: p.TEN_SAN_PHAM, price: priceOf(p), image: images.find(i => i.SAN_PHAM_ID === p.SAN_PHAM_ID)?.URL || '',
      finished: finishedAvailableOf(p), buildable: inactive(p.TRANG_THAI) || computed.perMaterial.some(m => m.inactive) ? 0 : computed.buildable,
      original: originalIds.includes(p.SAN_PHAM_ID), requestedQuantity,
      formulaReview: !!originalBoms.find(b => b.SAN_PHAM_ID === p.SAN_PHAM_ID)?.CAN_RA_SOAT,
      requirements: computed.perMaterial.map(m => ({ ...m, required: m.perUnit * toMake, missing: Math.max(0, m.perUnit * toMake - m.available) })), active: !inactive(p.TRANG_THAI) };
  });
  const shortageIds = [...new Set(choices.filter(c => c.original).flatMap(c => c.requirements.filter(l => l.available < l.required).map(l => l.materialId)))];
  const deadline = row.quote?.deliveryAt ? new Date(row.quote.deliveryAt) : new Date(`${String(row.delivery?.date || '').split('/').reverse().join('-')}T${/^\d{2}:\d{2}$/.test(row.delivery?.time) ? row.delivery.time : '23:59'}:00+07:00`);
  const suppliers = shortageIds.length ? await supplierOptionsFor(shortageIds, Number.isFinite(deadline.getTime()) ? deadline : new Date()) : [];
  return { products: choices, materials: materials.map(m => ({ id: m.NGUYEN_VAT_LIEU_ID, name: m.TEN_NGUYEN_VAT_LIEU, unit: m.DON_VI_TINH, available: availableOf(m), price: Number(m.GIA_BAN || 0) })), suppliers };
}

export async function ensureSalesRequestIndexes() {
  await (await getCollection<any>(MESSAGES)).createIndex({ YEU_CAU_ID: 1, THOI_GIAN_GUI: -1 }, { name: 'sales_request_conversation_time' });
  await (await getCollection<any>(REQUESTS)).createIndex({ status: 1, createdAt: -1 }, { name: 'sales_queue_status_time' });
}

export async function messages(id: string, actor: { token?: string; employee?: any }) {
  if (actor.employee) await ownedRequest(id, actor.employee); else await requestForCustomer(id, actor.token || '');
  const rows = await (await getCollection<any>(MESSAGES)).find({ YEU_CAU_ID: id, LOAI_TIN_NHAN: { $in: SALES_CHAT_TYPES } }).sort({ THOI_GIAN_GUI: -1, TIN_NHAN_ID: -1 }).limit(100).toArray();
  return rows.reverse().map(mapRequestMessage);
}
const mapRequestMessage = (row: any) => ({ id: row.TIN_NHAN_ID, requestId: row.YEU_CAU_ID,
  senderType: row.LOAI_TIN_NHAN === SALES_CHAT_TYPES[1] ? 'sales' : 'customer', senderName: row.TEN_NGUOI_GUI,
  channel: row.KENH_TRAO_DOI || 'website', text: row.NOI_DUNG_TRA_LOI || row.NOI_DUNG_CAU_HOI || '', at: row.THOI_GIAN_GUI });
export async function sendMessage(id: string, body: any, actor: { token?: string; employee?: any }) {
  const row = actor.employee ? await ownedRequest(id, actor.employee) : await requestForCustomer(id, actor.token || '');
  if ([REQUEST_STATUS.rejected, REQUEST_STATUS.closed, REQUEST_STATUS.cancelled].includes(row.status)) throw new InventoryError(409, 'Yêu cầu đã kết thúc.');
  if (!/^[\w-]{16,100}$/.test(String(body.messageId))) throw new InventoryError(400, 'Mã tin nhắn không hợp lệ.');
  const content = text(body.text);
  const senderType = actor.employee ? 'sales' : 'customer';
  const channel = actor.employee && body.channel === 'phone' ? 'phone' : 'website';
  const entry = { _id: `${id}:${senderType}:${body.messageId}`, TIN_NHAN_ID: `${id}:${senderType}:${body.messageId}`,
    YEU_CAU_ID: id, DON_HANG_ID: row.orderId || null, KHACH_HANG_ID: row.customerId || null,
    NHAN_VIEN_ID: actor.employee?.NHAN_VIEN_ID || null, CAU_HOI_ID: null, SAN_PHAM_ID: null,
    NOI_DUNG_CAU_HOI: senderType === 'customer' ? content : null, NOI_DUNG_TRA_LOI: senderType === 'sales' ? content : null,
    LOAI_TIN_NHAN: senderType === 'sales' ? SALES_CHAT_TYPES[1] : SALES_CHAT_TYPES[0], THOI_GIAN_GUI: new Date(), TRANG_THAI: 'completed',
    HINH_ANH: null, TEN_FILE_ANH: null, LOAI_FILE_ANH: null,
    TEN_NGUOI_GUI: actor.employee ? row.assignedName : row.sender?.name || 'Khách hàng', KENH_TRAO_DOI: channel, MA_TIN_NHAN_CLIENT: body.messageId };
  const col = await getCollection<any>(MESSAGES);
  const existing = await col.findOne({ _id: entry._id });
  if (existing && (mapRequestMessage(existing).text !== content || existing.KENH_TRAO_DOI !== channel)) throw new InventoryError(409, 'Mã tin nhắn đã được dùng cho nội dung khác.');
  try { await col.updateOne({ _id: entry._id }, { $setOnInsert: entry }, { upsert: true }); }
  catch (error: any) {
    if (error.code !== 11000) throw error;
    const repeated = await col.findOne({ _id: entry._id });
    if (!repeated || mapRequestMessage(repeated).text !== content || repeated.KENH_TRAO_DOI !== channel) throw new InventoryError(409, 'Mã tin nhắn bị trùng với nội dung khác.');
  }
  return mapRequestMessage(existing || entry);
}

export async function recordContact(id: string, body: any, employee: any) {
  return withTransaction(async session => {
    const row = await ownedRequest(id, employee, session);
    assertVersion(row, body.version);
    if (![REQUEST_STATUS.processing, REQUEST_STATUS.quoted, REQUEST_STATUS.accepted].includes(row.status)) throw new InventoryError(409, 'Yêu cầu đã kết thúc hoặc chưa được tiếp nhận.');
    if (!['connected', 'unreachable', 'agreed'].includes(body.outcome)) throw new InventoryError(400, 'Chọn kết quả liên hệ.');
    const note = text(body.note);
    let followUpAt: Date | null = null;
    if (body.followUpAt) {
      followUpAt = new Date(body.followUpAt);
      if (!Number.isFinite(followUpAt.getTime()) || followUpAt.getTime() <= Date.now()) throw new InventoryError(400, 'Hẹn gọi lại phải ở tương lai.');
    }
    const agreed = body.outcome === 'agreed';
    if (agreed) {
      if (row.status !== REQUEST_STATUS.quoted || row.quote?.id !== body.quoteId || body.readBackConfirmed !== true) throw new InventoryError(409, 'Cần đọc lại và xác nhận đúng mẫu, tổng giá, tiền cọc, lịch giao của phương án hiện tại.');
      deliveryAt(row.quote.delivery.date, row.quote.delivery.time);
    }
    const updates: any = { contactStatus: body.outcome === 'unreachable' ? 'unreachable' : 'connected', lastContactAt: new Date(), followUpAt, updatedAt: new Date() };
    if (agreed) Object.assign(updates, { status: REQUEST_STATUS.accepted, acceptedQuoteId: row.quote.id, acceptedAt: new Date(),
      acceptance: { via: 'phone', quoteId: row.quote.id, actor: employee.NHAN_VIEN_ID, phone: row.sender?.phone, at: new Date(), note,
        total: row.quote.summary.total, amountToPay: row.quote.payment.amountToPay, delivery: row.quote.delivery } });
    const history = { id: randomUUID(), at: new Date(), actor: employee.NHAN_VIEN_ID,
      action: agreed ? 'Khách đồng ý phương án qua điện thoại' : body.outcome === 'unreachable' ? 'Chưa liên lạc được, cần gọi lại' : 'Đã trao đổi qua điện thoại', note, quoteId: agreed ? row.quote.id : null };
    await (await getCollection<any>(REQUESTS)).updateOne({ _id: id, version: row.version }, { $set: updates, $inc: { version: 1 }, $push: { history } } as any, { session });
    const messageId = `CALL-${history.id}`;
    await (await getCollection<any>(MESSAGES)).insertOne({ _id: messageId, TIN_NHAN_ID: messageId, YEU_CAU_ID: id, DON_HANG_ID: null,
      KHACH_HANG_ID: row.customerId || null, NHAN_VIEN_ID: employee.NHAN_VIEN_ID, SAN_PHAM_ID: null, CAU_HOI_ID: null,
      NOI_DUNG_CAU_HOI: null, NOI_DUNG_TRA_LOI: agreed ? `Đã thống nhất phương án ${row.quote.revision} qua điện thoại: ${note}` : body.outcome === 'unreachable' ? 'Shop đã gọi nhưng chưa liên lạc được. Bạn nhắn giúp thời gian tiện nghe máy nhé.' : note,
      LOAI_TIN_NHAN: SALES_CHAT_TYPES[1], THOI_GIAN_GUI: new Date(), TRANG_THAI: 'completed', TEN_NGUOI_GUI: row.assignedName, KENH_TRAO_DOI: 'phone',
      HINH_ANH: null, TEN_FILE_ANH: null, LOAI_FILE_ANH: null }, { session });
    return { status: updates.status || row.status };
  });
}

export async function customerChangeRequest(id: string, token: string, body: any) {
  return withTransaction(async session => {
    const row = await requestForCustomer(id, token, session);
    if (body.action === 'cancel' && row.status === REQUEST_STATUS.cancelled) return publicRequest(row);
    if ([REQUEST_STATUS.converted, REQUEST_STATUS.rejected, REQUEST_STATUS.closed, REQUEST_STATUS.cancelled].includes(row.status)) throw new InventoryError(409, 'Yêu cầu đã kết thúc hoặc đã lên đơn. Vui lòng xem đơn để xử lý tiếp.');
    let updates: any;
    if (body.action === 'cancel') updates = { status: REQUEST_STATUS.cancelled, acceptedQuoteId: null, acceptance: null, updatedAt: new Date() };
    else if (body.action === 'reschedule') {
      deliveryAt(body.date, body.time);
      updates = { delivery: { ...row.delivery, date: body.date, time: body.time }, quote: null, acceptedQuoteId: null, acceptedAt: null, acceptance: null,
        status: row.assignedTo ? REQUEST_STATUS.processing : REQUEST_STATUS.waiting, updatedAt: new Date() };
    } else throw new InventoryError(400, 'Thao tác không hợp lệ.');
    await (await getCollection<any>(REQUESTS)).updateOne({ _id: id, version: row.version }, { $set: updates, $inc: { version: 1 },
      $push: { history: { id: randomUUID(), at: new Date(), actor: 'CUSTOMER', action: body.action === 'cancel' ? 'Khách dừng yêu cầu' : 'Khách đề nghị đổi lịch giao',
        oldDelivery: row.delivery, newDelivery: updates.delivery || null } } } as any, { session });
    return publicRequest({ ...row, ...updates });
  });
}
