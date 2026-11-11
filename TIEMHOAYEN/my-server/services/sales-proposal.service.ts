import {depositByPolicy, orderEvent} from './admin-order.service.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { escapeRegex, getCollection } from '../mongo.js';
import { availableOf, finishedAvailableOf, InventoryError, withTransaction } from './inventory/helpers.js';
import { COLLECTIONS, MATERIAL_STATUS, PO_STATUS, RESERVATION_STATUS } from './inventory/constants.js';
import { computeBuildable, supplierOptionsFor } from './inventory/availability.service.js';
import { getActiveBom, getActiveBomMap } from './inventory/bom.service.js';
import { REQUESTS, REQUEST_STATUS, publicRequest, assertReservedStockUsable, SALES_CONFIRMED_ORDER_STATUS } from './order-request.service.js';
import { assertWithinShopHours, classifyDeliverySchedule } from './delivery-policy.service.js';
import { requestByVerifiedPhone } from './order-access.service.js';
import { reserveOrderLines } from './order-stock.service.js';
import { releaseReservations, sweepExpiredReservations } from './inventory/stock.service.js';
import { writeCheckoutOrder } from './checkout-order-writer.service.js';

export const MESSAGES = 'TIN_NHAN_CHAT';
export const SALES_CHAT_TYPES = ['sales_request_customer', 'sales_request_staff'];
const consultationCache = new Map<string, { expiresAt: number; version: number; products: any[]; materials: any[]; relatedMaterialIds: string[]; materialNames: Record<string, string> }>();
const CONSULTATION_CACHE_MS = 15_000;
const inactive = (status: any) => /ngừng|ngưng|ẩn|khóa|đã xóa/i.test(String(status || ''));
const text = (value: unknown, max = 2000) => {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new InventoryError(400, `Nội dung phải có từ 1–${max} ký tự.`);
  return result;
};
const optionalText = (value: unknown, max = 2000) => {
  const result = String(value || '').trim();
  if (result.length > max) throw new InventoryError(400, `Nội dung không được vượt quá ${max} ký tự.`);
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
  // Sales cũng chỉ được chốt lịch trong 08:00–22:00.
  assertWithinShopHours(parsed);
  return parsed;
}
const SALES_PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PREPARATION_LEAD_MS = 3 * 60 * 60 * 1000;
function salesPaymentDeadline(delivery: any, acceptedAt: Date) {
  const scheduledAt = deliveryAt(delivery?.date, delivery?.time);
  const preparationCutoff = scheduledAt.getTime() - PREPARATION_LEAD_MS;
  const deadlineMs = Math.min(acceptedAt.getTime() + SALES_PAYMENT_WINDOW_MS, preparationCutoff);
  if (deadlineMs <= acceptedAt.getTime()) throw new InventoryError(409, 'Lịch giao đã quá gần thời điểm chuẩn bị; cần đổi lịch hoặc xử lý như đơn gấp thay vì xác nhận thanh toán tự động.');
  return new Date(deadlineMs);
}
async function snapshotItem(raw: any, index: number, session: ClientSession) {
  const qty = quantity(raw.qty);
  if (!Number.isInteger(qty)) throw new InventoryError(400, 'Số bó phải là số nguyên.');
  if (raw.custom) {
    const name = text(raw.name, 150);
    const image = String(raw.image || '');
    if (!/^\/(?:uploads|assets)\/[\w./-]+$/.test(image) && !/^https?:\/\//.test(image)) throw new InventoryError(400, 'Bó phối mới cần ảnh mẫu hoặc ảnh minh họa hợp lệ.');
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
      materials.push({ materialId: id, name: m.TEN_NGUYEN_VAT_LIEU, quantity: quantity(l.quantity), unit: m.DON_VI_TINH, price: amount(m.GIA_BAN),
        ...(l.replacesMaterialId ? { replacesMaterialId: String(l.replacesMaterialId) } : {}) });
    }
    const baseProductId = String(raw.baseProductId || '');
    if (baseProductId) {
      const resolved = await getActiveBom(baseProductId, session);
      if (!resolved.bom || !resolved.bom.CHO_THAY_THE_NVL) throw new InventoryError(400, 'BOM của sản phẩm này không cho phép thay nguyên vật liệu.');
      const used = new Set<number>();
      for (const line of resolved.lines) {
        const sourceId = line.NGUYEN_VAT_LIEU_ID;
        const index = materials.findIndex((material: any, materialIndex: number) => !used.has(materialIndex)
          && (material.materialId === sourceId || material.replacesMaterialId === sourceId));
        if (index < 0) {
          if (line.BAT_BUOC !== false) throw new InventoryError(400, `Phương án thiếu nguyên vật liệu bắt buộc ${sourceId}.`);
          continue;
        }
        used.add(index);
        const selected: any = materials[index];
        if (selected.materialId === sourceId) continue;
        const rule: any = (line.QUY_TAC_THAY_THE || []).find((item: any) => item.NGUYEN_VAT_LIEU_ID === selected.materialId);
        const allowed = line.CHO_PHEP_THAY_THE && ((line.DS_THAY_THE || []).includes(selected.materialId) || rule);
        if (!allowed) throw new InventoryError(400, `${selected.name} không được BOM cho phép thay thế ${sourceId}.`);
        const ratio = Number(rule?.TY_LE_QUY_DOI || 1);
        const expected = Number(line.DINH_LUONG) * ratio;
        if (Math.abs(selected.quantity - expected) > 0.000001) throw new InventoryError(400, `Định lượng thay thế ${selected.name} phải là ${expected} ${selected.unit}.`);
        if (rule?.SO_LUONG_TOI_DA != null && selected.quantity > Number(rule.SO_LUONG_TOI_DA)) throw new InventoryError(400, `${selected.name} vượt giới hạn thay thế của BOM.`);
      }
      if (used.size !== materials.length) throw new InventoryError(400, 'Phương án có nguyên vật liệu không thuộc BOM hoặc không được khai báo thay thế.');
    }
    const designFee = amount(raw.designFee || 0), extraFee = amount(raw.extraFee || 0);
    const price = amount(Math.round(materials.reduce((sum, l) => sum + l.quantity * l.price, 0)) + designFee + extraFee);
    if (price <= 0) throw new InventoryError(400, 'Giá bó hoa phải lớn hơn 0.');
    const designSource = raw.designSource === 'CUSTOMER_3D' ? 'CUSTOMER_3D' : 'SALES_CUSTOM';
    return { id: `SPYC_${index}`, name, qty, price, image, custom: true, designSource, ...(baseProductId ? { baseProductId } : {}),
      bom: { source: designSource, materials, designFee, extraFee }, description: String(raw.description || '').slice(0, 2000) };
  }
  const id = String(raw.id || '');
  const p = await (await getCollection<any>('SAN_PHAM')).findOne({ SAN_PHAM_ID: id }, { session });
  if (!p || inactive(p.TRANG_THAI)) throw new InventoryError(400, `Sản phẩm ${id} không còn bán.`);
  const image = await (await getCollection<any>('HINH_ANH_SAN_PHAM')).find({ SAN_PHAM_ID: id }, { session }).sort({ LA_ANH_CHINH: -1, HINH_ANH_ID: 1 }).limit(1).next();
  const resolved = await getActiveBom(id, session);
  const price = priceOf(p);
  if (price <= 0) throw new InventoryError(400, 'Mẫu chưa có giá bán hợp lệ.');
  return { id, name: p.TEN_SAN_PHAM, qty, price, image: image?.URL || '', custom: false,
    bom: { source: 'SAN_PHAM', bomId: resolved.bom?.BOM_ID || null, fingerprint: bomFingerprint(resolved), version: resolved.bom?.PHIEN_BAN || null, lines: resolved.lines } };
}

async function applyInternalSubstitutions(item: any, rawSubstitutions: any, session: ClientSession) {
  const requested = Array.isArray(rawSubstitutions) ? rawSubstitutions.filter((entry: any) => entry.productId === item.id) : [];
  if (!requested.length) return item;
  if (item.custom) throw new InventoryError(400, 'Thay nguyên vật liệu nội bộ chỉ áp dụng cho mẫu sản phẩm trong danh mục.');
  const resolved = await getActiveBom(item.id, session);
  if (!resolved.bom?.CHO_THAY_THE_NVL) throw new InventoryError(400, `BOM của ${item.name} không cho phép thay nguyên vật liệu.`);
  const replacementBySource = new Map<string, string>();
  for (const entry of requested) {
    const sourceId = String(entry.sourceMaterialId || '');
    const substituteId = String(entry.substituteMaterialId || '');
    if (!sourceId || !substituteId || replacementBySource.has(sourceId)) throw new InventoryError(400, 'Danh sách nguyên vật liệu thay thế bị thiếu hoặc trùng.');
    replacementBySource.set(sourceId, substituteId);
  }
  const materialCollection = await getCollection<any>('NGUYEN_VAT_LIEU');
  const materials = [];
  const substitutions = [];
  for (const line of resolved.lines) {
    const sourceId = String(line.NGUYEN_VAT_LIEU_ID);
    const substituteId = replacementBySource.get(sourceId);
    if (!substituteId) {
      materials.push({ materialId: sourceId, quantity: Number(line.DINH_LUONG), unit: line.DON_VI_TINH, role: line.VAI_TRO });
      continue;
    }
    const rule: any = (line.QUY_TAC_THAY_THE || []).find((entry: any) => entry.NGUYEN_VAT_LIEU_ID === substituteId);
    if (!line.CHO_PHEP_THAY_THE || (!(line.DS_THAY_THE || []).includes(substituteId) && !rule)) throw new InventoryError(400, `${substituteId} không được BOM cho phép thay thế ${sourceId}.`);
    const substitute = await materialCollection.findOne({ NGUYEN_VAT_LIEU_ID: substituteId }, { session });
    if (!substitute || inactive(substitute.TRANG_THAI)) throw new InventoryError(409, `Nguyên vật liệu thay thế ${substituteId} không còn sử dụng.`);
    const ratio = Number(rule?.TY_LE_QUY_DOI || 1);
    const replacementQuantity = Number(line.DINH_LUONG) * ratio;
    if (rule?.SO_LUONG_TOI_DA != null && replacementQuantity > Number(rule.SO_LUONG_TOI_DA)) throw new InventoryError(400, `${substitute.TEN_NGUYEN_VAT_LIEU} vượt giới hạn thay thế của BOM.`);
    materials.push({ materialId: substituteId, name: substitute.TEN_NGUYEN_VAT_LIEU, quantity: replacementQuantity,
      unit: substitute.DON_VI_TINH || line.DON_VI_TINH, role: line.VAI_TRO, replacesMaterialId: sourceId });
    substitutions.push({ sourceMaterialId: sourceId, substituteMaterialId: substituteId, sourceName: sourceId,
      substituteName: substitute.TEN_NGUYEN_VAT_LIEU, ratio });
  }
  for (const sourceId of replacementBySource.keys()) if (!resolved.lines.some((line: any) => String(line.NGUYEN_VAT_LIEU_ID) === sourceId)) throw new InventoryError(400, `BOM không có nguyên vật liệu ${sourceId}.`);
  return { ...item, bom: { ...item.bom, source: 'SAN_PHAM_SUBSTITUTION', useMaterialSnapshot: true, materials, substitutions } };
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
    for (const [index, raw] of body.items.entries()) items.push(await applyInternalSubstitutions(await snapshotItem(raw, index, session), body.substitutions, session));
    const ids = items.map(i => i.id);
    if (new Set(ids).size !== ids.length) throw new InventoryError(400, 'Sản phẩm bị trùng; hãy gộp số lượng.');
    const subtotal = amount(items.reduce((sum, i) => sum + i.qty * i.price, 0));
    const shippingFee = amount(body.shippingFee || 0);
    const cardFee = amount(row.giftCard?.fee || 0);
    const total = amount(subtotal + shippingFee + cardFee);
    const method = body.paymentMethod === 'cod' ? 'cod' : body.paymentMethod === 'bank' ? 'bank' : '';
    if (!method) throw new InventoryError(400, 'Chọn chuyển khoản toàn bộ hoặc cọc rồi thanh toán khi nhận hàng.');
    const depositAmount = method === 'cod' ? depositByPolicy(subtotal, total, items) : 0;
    const confirmOriginal = body.confirmOriginal === true;
    if (confirmOriginal) {
      if (row.status !== REQUEST_STATUS.processing || row.quote) throw new InventoryError(409, 'Chỉ xác nhận trực tiếp khi yêu cầu chưa có phương án thay đổi.');
      const originalItems = new Map((row.items || []).map((item: any) => [String(item.productId), Number(item.quantity)]));
      if (items.some(item => item.custom || originalItems.get(String(item.id)) !== Number(item.qty)) || items.length !== originalItems.size) {
        throw new InventoryError(409, 'Mẫu hoặc số lượng đã thay đổi; cần gửi phương án để khách xác nhận.');
      }
      const originalDate = /^\d{2}\/\d{2}\/\d{4}$/.test(String(row.delivery?.date || '')) ? String(row.delivery.date).split('/').reverse().join('-') : String(row.delivery?.date || '');
      if (body.date !== originalDate || body.time !== String(row.delivery?.time || '').match(/\b\d{2}:\d{2}\b/)?.[0]
        || total !== Number(row.originalSummary?.total || 0) || shippingFee !== Number(row.originalSummary?.shippingFee || 0)) {
        throw new InventoryError(409, 'Giá, phí hoặc lịch giao đã thay đổi; cần gửi phương án để khách xác nhận.');
      }
    }
    const quote = { id: randomUUID(), revision: Math.max(Number(row.quote?.revision || 0), ...(row.quoteHistory || []).map((q: any) => Number(q.revision || 0))) + 1, createdAt: new Date(), createdBy: employee.NHAN_VIEN_ID,
      items, delivery: { ...row.delivery, date: body.date, time: body.time }, deliveryAt: at,
      giftCard: row.giftCard || null,
      summary: { subtotal, shippingFee, cardFee, total, depositAmount, loyaltyDiscount: 0, loyaltyPoints: 0 },
      payment: { method, methodName: method === 'cod' ? 'Đặt cọc theo chính sách, còn lại COD' : 'Chuyển khoản', amountToPay: method === 'cod' ? depositAmount : total },
      note: optionalText(body.note), discountNote: 'Giá phương án này chưa áp dụng voucher hoặc điểm của yêu cầu cũ.' };
    await (await getCollection<any>(REQUESTS)).updateOne({ _id: id, version: row.version }, {
      $set: { quote, status: REQUEST_STATUS.quoted,
        acceptedQuoteId: null, acceptedAt: null, customerAcceptedAt: null,
        paymentDeadlineAt: null, acceptance: null, updatedAt: new Date() },
      $inc: { version: 1 }, $push: { quoteHistory: quote, history: { id: randomUUID(), at: new Date(), actor: employee.NHAN_VIEN_ID,
        action: confirmOriginal ? (quote.items.some((item: any) => item.bom?.substitutions?.length) ? 'Sales gửi yêu cầu gốc với NVL thay thế theo BOM để khách xác nhận' : 'Sales gửi yêu cầu gốc để khách xác nhận') : `Gửi phương án phiên bản ${quote.revision}`, quoteId: quote.id } },
    } as any, { session });
    // Xác nhận ngay sẽ tạo đơn ở bước kế tiếp (thông báo tạo đơn gửi riêng); chỉ bản thảo mới cần khách xác nhận.
    if (!confirmOriginal) await orderEvent(session,quote.id+':sent',row.customerId||null,null,'Phương án đặt hoa mới',
      'Vui lòng xem và xác nhận đúng mẫu, giá và lịch giao trước khi thanh toán.','/order-request/'+id);
    return quote;
  });
}

/**
 * Sales "Xác nhận ngay": yêu cầu gốc (cho phép NVL thay thế theo BOM) được chuyển thành đơn hàng ngay,
 * trạng thái "Đã xác nhận đơn hàng", khách thanh toán trong hạn. Đổi mẫu/số lượng/giá/lịch thì phải gửi bản thảo.
 */
export async function confirmOriginalRequest(id: string, body: any, employee: any) {
  const quote = await propose(id, { ...body, confirmOriginal: true }, employee);
  const requests = await getCollection<any>(REQUESTS);
  const proposed = await requests.findOne({ _id: id });
  if (!proposed) throw new InventoryError(404, 'Không tìm thấy yêu cầu.');
  const acceptedAt = new Date();
  const accepted = await requests.findOneAndUpdate({ _id: id, version: proposed.version, status: REQUEST_STATUS.quoted, 'quote.id': quote.id }, {
    $set: { status: REQUEST_STATUS.accepted, acceptedQuoteId: quote.id, acceptedAt, customerAcceptedAt: null,
      acceptance: { via: 'sales_direct_confirmation', quoteId: quote.id, actor: employee.NHAN_VIEN_ID, at: acceptedAt }, updatedAt: acceptedAt },
    $inc: { version: 1 },
    $push: { history: { id: randomUUID(), at: acceptedAt, actor: employee.NHAN_VIEN_ID, action: 'Sales xác nhận yêu cầu', quoteId: quote.id } },
  } as any, { returnDocument: 'after', includeResultMetadata: false });
  if (!accepted) throw new InventoryError(409, 'Yêu cầu vừa thay đổi. Vui lòng tải lại.');
  try {
    await convertProposal(id, { quoteId: quote.id, version: accepted.version }, employee);
  } catch (error: any) {
    // Không tạo được đơn (vd. thiếu NVL): trả yêu cầu về đúng trạng thái trước khi bấm để Sales xử lý tiếp.
    await requests.updateOne({ _id: id, version: accepted.version, status: REQUEST_STATUS.accepted, 'quote.id': quote.id }, {
      $set: { status: REQUEST_STATUS.processing, quote: null, acceptedQuoteId: null, acceptedAt: null, acceptance: null, updatedAt: new Date() },
      $pull: { quoteHistory: { id: quote.id } },
      $inc: { version: 1 },
      $push: { history: { id: randomUUID(), at: new Date(), actor: employee.NHAN_VIEN_ID, action: 'Xác nhận yêu cầu không thành công', note: String(error?.message || '') } },
    } as any);
    throw error;
  }
  const row = await requests.findOne({ _id: id });
  return publicRequest(row);
}

export async function respondToProposal(id: string, token: string, body: any) {
  const response = await withTransaction(async session => {
    const row = await requestForCustomer(id, token, session);
    if (!['accept', 'decline'].includes(body.action)) throw new InventoryError(400, 'Lựa chọn không hợp lệ.');
    if (!row.quote || row.quote.id !== body.quoteId) throw new InventoryError(409, 'Phương án đã được thay đổi. Vui lòng xem phiên bản mới.');
    if (body.action === 'accept' && row.acceptedQuoteId === body.quoteId && [REQUEST_STATUS.accepted, REQUEST_STATUS.pendingPayment, REQUEST_STATUS.converted].includes(row.status)) return publicRequest(row);
    if (row.status !== REQUEST_STATUS.quoted) throw new InventoryError(409, 'Phương án không còn chờ xác nhận.');
    deliveryAt(row.quote.delivery.date, row.quote.delivery.time);
    const accept = body.action === 'accept';
    const acceptedAt = accept ? new Date() : null;
    const paymentDeadlineAt = acceptedAt ? salesPaymentDeadline(row.quote.delivery, acceptedAt) : null;
    const updates = { status: accept ? REQUEST_STATUS.accepted : REQUEST_STATUS.processing,
      acceptedQuoteId: accept ? row.quote.id : null, acceptedAt, customerAcceptedAt: acceptedAt, paymentDeadlineAt,
      acceptance: accept ? { via: 'website', quoteId: row.quote.id, at: acceptedAt } : null, updatedAt: new Date() };
    await (await getCollection<any>(REQUESTS)).updateOne({ _id: id, version: row.version }, {
      $set: updates, $inc: { version: 1 },
      $push: { history: { id: randomUUID(), at: new Date(), actor: 'CUSTOMER', action: accept ? 'Khách đồng ý phương án' : 'Khách muốn tư vấn lại', quoteId: row.quote.id } },
    } as any, { session });
    if(accept) await orderEvent(session,row.quote.id+':accepted',row.customerId||null,null,'Đã ghi nhận xác nhận phương án','Shop sẽ kiểm tra tồn lần cuối trước khi tạo đơn.','/order-request/'+id);
    return publicRequest({ ...row, ...updates });
  });
  if (body.action !== 'accept') return response;
  const accepted = await (await getCollection<any>(REQUESTS)).findOne({ _id: id });
  if (!accepted || accepted.status !== REQUEST_STATUS.accepted) return response;
  await convertProposal(id, { quoteId: accepted.quote.id, version: accepted.version }, {
    NHAN_VIEN_ID: accepted.assignedTo, HO_TEN: accepted.assignedName,
  });
  const converted = await (await getCollection<any>(REQUESTS)).findOne({ _id: id });
  return publicRequest(converted);
}

export async function convertProposal(id: string, body: any, employee: any) {
  await sweepExpiredReservations();
  return withTransaction(async session => {
    const row = await ownedRequest(id, employee, session);
    if ([REQUEST_STATUS.pendingPayment, REQUEST_STATUS.converted].includes(row.status) && row.quote?.id === body.quoteId) return row.orderResult;
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
    const customItems = items.filter((item: any) => item.custom);
    for (const item of customItems) {
      const bomId = `BOMYC_${row.quote.id}_${item.id}`;
      const bomType = item.designSource === 'CUSTOMER_3D' ? 'THIET_KE_3D_KHACH_HANG' : 'PHUONG_AN_BO_PHOI_SALES';
      await (await getCollection<any>('BOM_SAN_PHAM')).updateOne({ BOM_ID: bomId }, { $setOnInsert: {
        _id: bomId, BOM_ID: bomId, SAN_PHAM_ID: item.id, PHIEN_BAN: 1, TRANG_THAI: 'Hiệu lực', LOAI_BOM: bomType,
        NGUON_THIET_KE: item.designSource || 'SALES_CUSTOM', YEU_CAU_DAT_HANG_ID: id, PHUONG_AN_ID: row.quote.id,
        CHO_THAY_THE_NVL: false, TAO_LUC: new Date(), NGUOI_TAO: employee.NHAN_VIEN_ID,
      } }, { upsert: true, session });
      if (item.bom.materials.length) await (await getCollection<any>('CHI_TIET_BOM')).bulkWrite(item.bom.materials.map((line: any, lineIndex: number) => {
        const lineId = `${bomId}:${line.materialId}:${lineIndex}`;
        return { updateOne: { filter: { _id: lineId }, update: { $setOnInsert: {
          _id: lineId, BOM_ID: bomId, NGUYEN_VAT_LIEU_ID: line.materialId,
          DINH_LUONG: line.quantity, DON_VI_TINH: line.unit, VAI_TRO: 'Thành phần bó tùy chỉnh', BAT_BUOC: true,
          CHO_PHEP_THAY_THE: false, DS_THAY_THE: [],
        } }, upsert: true } };
      }), { session });
      item.bom = { ...item.bom, bomId, type: bomType };
    }
    await reserveOrderLines(session, items, ctx);
    await assertReservedStockUsable(session, orderId, new Date(row.quote.deliveryAt).toISOString(), true);
    // Khách có tối đa 24 giờ (và không muộn hơn mốc chuẩn bị) để thanh toán đơn đã xác nhận.
    const paymentDeadlineAt = row.paymentDeadlineAt && new Date(row.paymentDeadlineAt).getTime() > Date.now()
      ? row.paymentDeadlineAt : salesPaymentDeadline(row.quote.delivery, new Date());
    const checkoutData = { customerId: row.customerId, sender: row.sender, receiver: row.receiver, flags: row.flags, giftCard: row.quote.giftCard || row.giftCard || null,
      delivery: row.quote.delivery, summary: row.quote.summary, payment: row.quote.payment, items,
      checkoutSessionId: paymentSessionId, paymentDeadlineAt };
    const result = { kind: 'order', ...await writeCheckoutOrder(session, orderId, checkoutData, { requestId: id, quote: row.quote, pendingOrderStatus: SALES_CONFIRMED_ORDER_STATUS }) };
    // Đơn đã xác nhận giữ NVL tới hạn thanh toán của khách, không phải hạn 5 phút của mã QR thường.
    if (result.requiresPayment) await (await getCollection<any>('GIU_TON')).updateMany(
      { DON_HANG_ID: orderId, TRANG_THAI: RESERVATION_STATUS.temporary },
      { $set: { HET_HAN_LUC: new Date(paymentDeadlineAt) } }, { session });
    await (await getCollection<any>(MESSAGES)).updateMany({ YEU_CAU_ID: id, LOAI_TIN_NHAN: { $in: SALES_CHAT_TYPES } }, { $set: { DON_HANG_ID: orderId } }, { session });
    const requestStatus = result.requiresPayment ? REQUEST_STATUS.pendingPayment : REQUEST_STATUS.converted;
    await (await getCollection<any>(REQUESTS)).updateOne({ _id: id, version: row.version }, {
      $set: { orderId, orderResult: result, checkoutData, status: requestStatus, paymentDeadlineAt: result.requiresPayment ? paymentDeadlineAt : null, updatedAt: new Date() }, $inc: { version: 1 },
      $push: { history: { id: randomUUID(), at: new Date(), actor: employee.NHAN_VIEN_ID,
        action: result.requiresPayment ? 'Xác nhận yêu cầu, tạo đơn "Đã xác nhận đơn hàng" chờ khách thanh toán' : 'Xác nhận yêu cầu và lên đơn', quoteId: row.quote.id, orderId } },
    } as any, { session });
    return result;
  });
}

async function consultationSources(row: any, relatedMaterialIds: string[], materialNames: Record<string, string>) {
  if (!relatedMaterialIds.length) return { suppliers: [], incomingOrders: [] };
  const deadline = row.quote?.deliveryAt ? new Date(row.quote.deliveryAt) : new Date(`${String(row.delivery?.date || '').split('/').reverse().join('-')}T${/^\d{2}:\d{2}$/.test(row.delivery?.time) ? row.delivery.time : '23:59'}:00+07:00`);
  const [supplierRows, purchaseOrders] = await Promise.all([
    supplierOptionsFor(relatedMaterialIds, Number.isFinite(deadline.getTime()) ? deadline : new Date()),
    getCollection<any>(COLLECTIONS.purchaseOrder).then(collection => collection.find({ TRANG_THAI: PO_STATUS.shipping,
      'CHI_TIET.NGUYEN_VAT_LIEU_ID': { $in: relatedMaterialIds } }).sort({ NGAY_GIO_DU_KIEN_GIAO: 1 }).toArray()),
  ]);
  const suppliers = supplierRows.map(source => ({ ...source, materialName: materialNames[source.materialId] || source.materialId }));
  const incomingOrders = purchaseOrders.flatMap(order => (order.CHI_TIET || []).filter((line: any) => relatedMaterialIds.includes(line.NGUYEN_VAT_LIEU_ID))
    .map((line: any) => ({ orderId: order.PO_ID, materialId: line.NGUYEN_VAT_LIEU_ID,
      materialName: materialNames[line.NGUYEN_VAT_LIEU_ID] || line.NGUYEN_VAT_LIEU_ID,
      quantity: Math.max(0, Number(line.SL_DAT || 0) - Number(line.SL_DA_NHAN || 0)),
      expectedAt: order.NGAY_GIO_DU_KIEN_GIAO, status: order.TRANG_THAI })))
    .filter(order => order.quantity > 0);
  return { suppliers, incomingOrders };
}

export async function consultationOptions(id: string, search: string, employee: any, includeCatalog = false, includeSources = false) {
  const row = await ownedRequest(id, employee);
  const cacheKey = `${id}:${search.trim().toLocaleLowerCase()}:${includeCatalog ? 1 : 0}`;
  const cached = consultationCache.get(cacheKey);
  if (includeSources && cached && cached.version === row.version && cached.expiresAt > Date.now()) {
    const sources = await consultationSources(row, cached.relatedMaterialIds, cached.materialNames);
    return { products: cached.products, catalogIncluded: includeCatalog, materials: cached.materials, ...sources };
  }
  const query: any = { TRANG_THAI: { $nin: ['Ngừng bán', 'Ẩn', 'Đã xóa'] } };
  if (search.trim()) query.$or = [{ TEN_SAN_PHAM: { $regex: escapeRegex(search.slice(0, 100)), $options: 'i' } }, { SAN_PHAM_ID: search.slice(0, 100) }];
  // Sau khi đã gửi phương án, chính phương án đó là nội dung yêu cầu hiện tại
  // trên workspace Sales. Yêu cầu gốc vẫn nằm trong history/row.items.
  const currentItems = row.quote?.items?.length
    ? row.quote.items.map((item: any) => ({ productId: item.baseProductId || item.id, quantity: item.qty,
      name: item.name, price: item.price, image: item.image, custom: item.custom }))
    : row.items;
  const originalIds = [...new Set(currentItems.map((item: any) => item.productId).filter(Boolean))];
  // Atlas latency dominates this screen. These reads are independent, so issue
  // them together instead of paying one network round-trip per collection.
  const [products, original, originalBoms, materials] = await Promise.all([
    includeCatalog || search.trim()
      ? getCollection<any>('SAN_PHAM').then(collection => collection.find(query).sort({ TON_THANH_PHAM: -1, SAN_PHAM_ID: 1 }).limit(30).toArray())
      : Promise.resolve([]),
    getCollection<any>('SAN_PHAM').then(collection => collection.find({ SAN_PHAM_ID: { $in: originalIds } }).toArray()),
    getCollection<any>('BOM_SAN_PHAM').then(collection => collection.find({ SAN_PHAM_ID: { $in: originalIds }, TRANG_THAI: 'Hiệu lực' }).toArray()),
    getCollection<any>('NGUYEN_VAT_LIEU').then(collection => collection.find({ TRANG_THAI: { $ne: MATERIAL_STATUS.hidden } }).sort({ TEN_NGUYEN_VAT_LIEU: 1 }).toArray()),
  ]);
  const all = [...new Map([...original, ...products].map(p => [p.SAN_PHAM_ID, p])).values()];
  const productIds = all.map(p => p.SAN_PHAM_ID);
  const [map, images] = await Promise.all([
    getActiveBomMap(productIds),
    getCollection<any>('HINH_ANH_SAN_PHAM').then(collection => collection.find({ SAN_PHAM_ID: { $in: productIds } }).sort({ LA_ANH_CHINH: -1 }).toArray()),
  ]);
  const byId = new Map(materials.map(m => [m.NGUYEN_VAT_LIEU_ID, m]));
  const choices = all.map(p => {
    const bom = map.get(p.SAN_PHAM_ID) || [];
    const bomHeader = originalBoms.find(b => b.SAN_PHAM_ID === p.SAN_PHAM_ID);
    const computed = computeBuildable(bom, byId);
    const currentItem = currentItems.find((item: any) => item.productId === p.SAN_PHAM_ID);
    const requestedQuantity = Number(currentItem?.quantity || 1);
    const toMake = Math.max(0, requestedQuantity - finishedAvailableOf(p));
    return { id: p.SAN_PHAM_ID, name: currentItem?.name || p.TEN_SAN_PHAM,
      price: Number.isFinite(Number(currentItem?.price)) ? Number(currentItem.price) : priceOf(p),
      image: currentItem?.image || images.find(i => i.SAN_PHAM_ID === p.SAN_PHAM_ID)?.URL || '',
      finished: finishedAvailableOf(p), buildable: inactive(p.TRANG_THAI) || computed.perMaterial.some(m => m.inactive) ? 0 : computed.buildable,
      original: originalIds.includes(p.SAN_PHAM_ID), requestedQuantity,
      formulaReview: !!bomHeader?.CAN_RA_SOAT,
      allowSubstitution: Boolean(bomHeader?.CHO_THAY_THE_NVL),
      requirements: computed.perMaterial.map(m => {
        const line = bom.find(l => l.NGUYEN_VAT_LIEU_ID === m.materialId);
        const ruleMap = new Map((line?.QUY_TAC_THAY_THE || []).map((rule: any) => [rule.NGUYEN_VAT_LIEU_ID, rule]));
        const configuredSubstitutes = [...new Set([...(line?.DS_THAY_THE || []), ...(line?.QUY_TAC_THAY_THE || []).map((rule: any) => rule.NGUYEN_VAT_LIEU_ID)])];
        // Replacement is opt-in at both BOM and line level. A legacy list by
        // itself must never make an important material replaceable.
        const substituteIds = bomHeader?.CHO_THAY_THE_NVL === true && line?.CHO_PHEP_THAY_THE === true
          ? configuredSubstitutes.filter(materialId => materialId !== m.materialId && byId.has(materialId) && !inactive(byId.get(materialId)?.TRANG_THAI))
          : [];
        return { ...m, required: m.perUnit * toMake, missing: Math.max(0, m.perUnit * toMake - m.available),
          role: line?.VAI_TRO || '', requiredLine: line?.BAT_BUOC !== false,
          substitutionExplicitlyAllowed: line?.CHO_PHEP_THAY_THE === true,
          allowSubstitution: substituteIds.length > 0,
          substitutes: substituteIds.map(materialId => {
            const substitute = byId.get(materialId), rule: any = ruleMap.get(materialId) || {};
            return { materialId, name: substitute?.TEN_NGUYEN_VAT_LIEU || materialId, unit: substitute?.DON_VI_TINH || rule.DON_VI_TINH || '',
              available: availableOf(substitute), conversionRatio: Number(rule.TY_LE_QUY_DOI || 1), maxQuantity: rule.SO_LUONG_TOI_DA ?? null,
              condition: rule.DIEU_KIEN || '', note: rule.GHI_CHU || '' };
          }) };
      }), active: !inactive(p.TRANG_THAI) };
  });
  // Bó phối riêng không có SAN_PHAM tương ứng vẫn phải xuất hiện đầy đủ trong
  // card yêu cầu hiện tại, bao gồm thành phần và tồn khả dụng của từng NVL.
  for (const item of row.quote?.items || []) {
    if (!item.custom || item.baseProductId || choices.some(choice => choice.id === item.id)) continue;
    const requestedQuantity = Number(item.qty || 1);
    const requirements = (item.bom?.materials || []).map((line: any) => {
      const material: any = byId.get(line.materialId);
      const perUnit = Number(line.quantity || 0);
      const available = material ? availableOf(material) : 0;
      const required = perUnit * requestedQuantity;
      return { materialId: line.materialId, name: material?.TEN_NGUYEN_VAT_LIEU || line.materialId,
        unit: material?.DON_VI_TINH || '', perUnit, available, required,
        missing: Math.max(0, required - available), role: 'Thành phần bó phối', requiredLine: true,
        allowSubstitution: false, substitutes: [], inactive: !material || inactive(material.TRANG_THAI) };
    });
    const buildable = requirements.length && !requirements.some((line: any) => line.inactive)
      ? Math.min(...requirements.map((line: any) => line.perUnit > 0 ? Math.floor(line.available / line.perUnit) : 0)) : 0;
    choices.push({ id: item.id, name: item.name, price: Number(item.price || 0), image: item.image || '',
      finished: 0, buildable, original: true, requestedQuantity, formulaReview: false,
      allowSubstitution: false, requirements, active: true });
  }
  const relatedMaterialIds = [...new Set(choices.filter(c => c.original).flatMap(c => c.requirements.map(l => l.materialId)))];
  let suppliers: any[] = [], incomingOrders: any[] = [];
  if (includeSources && relatedMaterialIds.length) {
    ({ suppliers, incomingOrders } = await consultationSources(row, relatedMaterialIds,
      Object.fromEntries(materials.map(material => [material.NGUYEN_VAT_LIEU_ID, material.TEN_NGUYEN_VAT_LIEU]))));
  }
  const relevantMaterialIds = new Set(choices.filter(choice => choice.original).flatMap(choice => choice.requirements.flatMap((line: any) => [line.materialId, ...(line.substitutes || []).map((sub: any) => sub.materialId)])));
  const visibleMaterials = includeCatalog ? materials : materials.filter(material => relevantMaterialIds.has(material.NGUYEN_VAT_LIEU_ID));
  const materialOptions = visibleMaterials.map(m => ({ id: m.NGUYEN_VAT_LIEU_ID, name: m.TEN_NGUYEN_VAT_LIEU, unit: m.DON_VI_TINH, available: availableOf(m), price: Number(m.GIA_BAN || 0) }));
  if (!includeSources) {
    consultationCache.set(cacheKey, { expiresAt: Date.now() + CONSULTATION_CACHE_MS, version: row.version,
      products: choices, materials: materialOptions, relatedMaterialIds,
      materialNames: Object.fromEntries(materials.map(material => [material.NGUYEN_VAT_LIEU_ID, material.TEN_NGUYEN_VAT_LIEU])) });
    if (consultationCache.size > 100) {
      for (const [key, value] of consultationCache) if (value.expiresAt <= Date.now()) consultationCache.delete(key);
    }
  }
  return { products: choices, catalogIncluded: includeCatalog, materials: materialOptions, suppliers, incomingOrders };
}

export async function ensureSalesRequestIndexes() {
  await (await getCollection<any>(MESSAGES)).createIndex({ YEU_CAU_ID: 1, THOI_GIAN_GUI: -1 }, { name: 'sales_request_conversation_time' });
  await (await getCollection<any>(REQUESTS)).createIndex({ status: 1, createdAt: -1 }, { name: 'sales_queue_status_time' });
}

export async function messages(id: string, actor: { token?: string; employee?: any }) {
  if (actor.employee) await ownedRequest(id, actor.employee); else await requestForCustomer(id, actor.token || '');
  const collection = await getCollection<any>(MESSAGES);
  if (actor.employee) {
    await collection.updateMany(
      { YEU_CAU_ID: id, LOAI_TIN_NHAN: SALES_CHAT_TYPES[0], NHAN_VIEN_DA_DOC: { $ne: actor.employee.NHAN_VIEN_ID } },
      { $addToSet: { NHAN_VIEN_DA_DOC: actor.employee.NHAN_VIEN_ID }, $set: { DOC_LUC: new Date() } },
    );
  }
  const rows = await collection.find({ YEU_CAU_ID: id, LOAI_TIN_NHAN: { $in: SALES_CHAT_TYPES } }).sort({ THOI_GIAN_GUI: -1, TIN_NHAN_ID: -1 }).limit(100).toArray();
  return rows.reverse().map(mapRequestMessage);
}
export async function unreadCustomerMessages(employee: any) {
  const employeeId = String(employee?.NHAN_VIEN_ID || '');
  if (!employeeId) throw new InventoryError(401, 'Phiên đăng nhập không hợp lệ.');
  const requestRows = await (await getCollection<any>(REQUESTS)).find(
    { assignedTo: employeeId },
    { projection: { _id: 1, requestId: 1, status: 1, 'sender.name': 1 } },
  ).toArray();
  const requestIds = requestRows.map((row: any) => String(row.requestId || row._id));
  if (!requestIds.length) return { unread: 0, conversations: [] };
  const query = {
    YEU_CAU_ID: { $in: requestIds },
    LOAI_TIN_NHAN: SALES_CHAT_TYPES[0],
    NHAN_VIEN_DA_DOC: { $ne: employeeId },
  };
  const collection = await getCollection<any>(MESSAGES);
  const [unread, rows] = await Promise.all([
    collection.countDocuments(query),
    collection.find(query).sort({ THOI_GIAN_GUI: -1, TIN_NHAN_ID: -1 }).limit(200).toArray(),
  ]);
  const requestById = new Map(requestRows.map((row: any) => [String(row.requestId || row._id), row]));
  const grouped = new Map<string, any>();
  for (const row of rows) {
    const requestId = String(row.YEU_CAU_ID || '');
    const request = requestById.get(requestId);
    const current = grouped.get(requestId);
    if (current) current.unread += 1;
    else grouped.set(requestId, {
      requestId,
      customerName: request?.sender?.name || row.TEN_NGUOI_GUI || 'Khách đặt hoa',
      status: request?.status || '',
      lastMessage: row.NOI_DUNG_CAU_HOI || '',
      lastAt: row.THOI_GIAN_GUI,
      unread: 1,
    });
  }
  return { unread, conversations: [...grouped.values()] };
}
const mapRequestMessage = (row: any) => ({ id: row.TIN_NHAN_ID, requestId: row.YEU_CAU_ID,
  senderType: row.LOAI_TIN_NHAN === SALES_CHAT_TYPES[1] ? 'sales' : 'customer', senderName: row.TEN_NGUOI_GUI,
  channel: row.KENH_TRAO_DOI || 'website', text: row.NOI_DUNG_TRA_LOI || row.NOI_DUNG_CAU_HOI || '', at: row.THOI_GIAN_GUI });
export async function sendMessage(id: string, body: any, actor: { token?: string; employee?: any }) {
  const row = actor.employee ? await ownedRequest(id, actor.employee) : await requestForCustomer(id, actor.token || '');
    if ([REQUEST_STATUS.rejected, REQUEST_STATUS.closed, REQUEST_STATUS.cancelled, REQUEST_STATUS.expired].includes(row.status)) throw new InventoryError(409, 'Yêu cầu đã kết thúc.');
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
    TEN_NGUOI_GUI: actor.employee ? row.assignedName : row.sender?.name || 'Khách hàng', KENH_TRAO_DOI: channel, MA_TIN_NHAN_CLIENT: body.messageId,
    NHAN_VIEN_DA_DOC: actor.employee ? [actor.employee.NHAN_VIEN_ID] : [] };
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
  const contactResult = await withTransaction(async session => {
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
    const acceptedAt = agreed ? new Date() : null;
    if (agreed) Object.assign(updates, { status: REQUEST_STATUS.accepted, acceptedQuoteId: row.quote.id, acceptedAt, customerAcceptedAt: acceptedAt,
      paymentDeadlineAt: salesPaymentDeadline(row.quote.delivery, acceptedAt!),
      acceptance: { via: 'phone', quoteId: row.quote.id, actor: employee.NHAN_VIEN_ID, phone: row.sender?.phone, at: acceptedAt, note,
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
    if(agreed) await orderEvent(session,row.quote.id+':accepted',row.customerId||null,null,'Đã ghi nhận xác nhận phương án','Shop sẽ kiểm tra tồn lần cuối trước khi tạo đơn.','/order-request/'+id);
    return { status: updates.status || row.status };
  });
  if (body.outcome !== 'agreed') return contactResult;
  const accepted = await (await getCollection<any>(REQUESTS)).findOne({ _id: id });
  if (!accepted || accepted.status !== REQUEST_STATUS.accepted || !accepted.quote?.id) return contactResult;
  await convertProposal(id, { quoteId: accepted.quote.id, version: accepted.version }, employee);
  const converted = await (await getCollection<any>(REQUESTS)).findOne({ _id: id });
  return { status: converted?.status || contactResult.status, request: converted ? publicRequest(converted) : undefined };
}

export async function customerChangeRequest(id: string, token: string, body: any) {
  return withTransaction(async session => {
    const row = await requestForCustomer(id, token, session);
    if (body.action === 'cancel' && row.status === REQUEST_STATUS.cancelled) return publicRequest(row);
    const pendingPaymentStatuses = [REQUEST_STATUS.pendingPayment, 'Chờ thanh toán'];
    const cancellingPendingPayment = body.action === 'cancel' && pendingPaymentStatuses.includes(row.status);
    if ([REQUEST_STATUS.converted, REQUEST_STATUS.rejected, REQUEST_STATUS.closed, REQUEST_STATUS.cancelled, REQUEST_STATUS.expired].includes(row.status)
      || pendingPaymentStatuses.includes(row.status) && !cancellingPendingPayment) {
      throw new InventoryError(409, 'Yêu cầu đã tạo đơn hoặc đã kết thúc. Vui lòng xem đơn để xử lý tiếp.');
    }
    let updates: any;
    if (body.action === 'cancel') {
      if (cancellingPendingPayment) {
        const orderId = String(row.orderId || row.orderResult?.orderId || '');
        const paid = await (await getCollection<any>('THANH_TOAN')).findOne({ DON_HANG_ID: orderId,
          TRANG_THAI_THANH_TOAN: { $in: ['Thành công', 'Thanh toán thành công', 'Đã thanh toán', 'Đã cọc'] } }, { session });
        if (paid) throw new InventoryError(409, 'Đơn đã ghi nhận thanh toán. Vui lòng thực hiện hủy/hoàn tại đơn hàng.');
        if (orderId) {
          await releaseReservations({ orderId }, { id: row.customerId || 'CUSTOMER', role: 'customer' }, 'Khách hủy trước khi thanh toán', session);
          await (await getCollection<any>('DON_HANG')).updateOne({ DON_HANG_ID: orderId, TRANG_THAI: { $in: ['Chờ thanh toán', SALES_CONFIRMED_ORDER_STATUS, 'Chờ xử lý'] } }, {
            $set: { TRANG_THAI: 'Đã hủy', LY_DO_HUY: 'Khách hủy trước khi thanh toán', NGAY_CAP_NHAT: new Date() },
            $push: { LICH_SU_TRANG_THAI: { from: SALES_CONFIRMED_ORDER_STATUS, to: 'Đã hủy', at: new Date(), actor: row.customerId || 'CUSTOMER', reason: 'Khách hủy trước khi thanh toán' } },
          } as any, { session });
          await (await getCollection<any>('THANH_TOAN')).updateMany({ DON_HANG_ID: orderId, TRANG_THAI_THANH_TOAN: 'Chờ thanh toán' }, {
            $set: { TRANG_THAI_THANH_TOAN: 'Thất bại', XAC_NHAN_LUC: new Date(), NGUOI_XAC_NHAN: 'CUSTOMER_CANCEL' },
            $push: { LICH_SU: { id: randomUUID(), from: 'Chờ thanh toán', to: 'Thất bại', actor: 'CUSTOMER_CANCEL', at: new Date() } },
          } as any, { session });
        }
      }
      updates = { status: REQUEST_STATUS.cancelled, acceptedQuoteId: null, acceptance: null, updatedAt: new Date() };
    }
    else if (body.action === 'reschedule') {
      // Khách đổi lịch: cùng quy tắc như Checkout (08:00–22:00, không dưới 4 giờ).
      classifyDeliverySchedule(deliveryAt(body.date, body.time));
      updates = { delivery: { ...row.delivery, date: body.date, time: body.time }, quote: null, acceptedQuoteId: null, acceptedAt: null, acceptance: null,
        status: row.assignedTo ? REQUEST_STATUS.processing : REQUEST_STATUS.waiting, updatedAt: new Date() };
    } else throw new InventoryError(400, 'Thao tác không hợp lệ.');
    await (await getCollection<any>(REQUESTS)).updateOne({ _id: id, version: row.version }, { $set: updates, $inc: { version: 1 },
      $push: { history: { id: randomUUID(), at: new Date(), actor: 'CUSTOMER', action: body.action === 'cancel' ? 'Khách dừng yêu cầu' : 'Khách đề nghị đổi lịch giao',
        oldDelivery: row.delivery, newDelivery: updates.delivery || null } } } as any, { session });
    await orderEvent(session, `${id}:customer:${body.action}:${row.version + 1}`, row.customerId || null, row.orderId || null,
      body.action === 'cancel' ? 'Yêu cầu đã được hủy' : 'Đã gửi đề nghị đổi lịch',
      body.action === 'cancel' ? `Yêu cầu ${id} đã được hủy theo đề nghị của bạn.` : `Shop đã nhận đề nghị đổi lịch của yêu cầu ${id}.`, `/order-request/${id}`);
    return publicRequest({ ...row, ...updates });
  });
}
