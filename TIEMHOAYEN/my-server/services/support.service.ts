import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { getCollection } from '../mongo.js';
import { InventoryError, withTransaction } from './inventory/helpers.js';
import { lookupAccess, normalizeOrderPhone, ownedOrderQuery, ownedRequestQuery } from './order-access.service.js';
import { needsImmediateHandoff, planChatReply } from './chatbot-brain.service.js';
import { hasPermission } from './role-permission.service.js';
export const SUPPORT_TICKETS = 'YEU_CAU_HO_TRO';
const MESSAGES = 'TIN_NHAN_CHAT';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export async function ensureSupportIndexes() {
    await (await getCollection<any>(SUPPORT_TICKETS)).createIndex({ customerId: 1, updatedAt: -1 });
    await (await getCollection<any>('TIN_NHAN_CHAT')).createIndex({ HO_TRO_ID: 1, THOI_GIAN_GUI: 1 });
    await (await getCollection<any>('CAU_HOI_CO_SAN')).createIndex({ CAU_HOI_CHUAN: 1 }, { unique: true, partialFilterExpression: { CAU_HOI_CHUAN: { $type: 'string' } } });
}
export async function supportStartRate(ip: string) {
    await withTransaction(async (session) => {
        const col = await getCollection<any>('XAC_THUC_TRA_CUU_DON');
        const id = `support-start:${hash(ip)}`;
        const row = await col.findOne({ _id: id }, { session });
        const now = new Date();
        const recent = row && now.getTime() - new Date(row.windowAt).getTime() < 600000;
        if (recent && row.count >= 20)
            throw new InventoryError(429, 'Bạn mở quá nhiều phiên hỗ trợ. Vui lòng thử lại sau.');
        await col.updateOne({ _id: id }, { $set: { kind: 'support_rate', count: recent ? row.count + 1 : 1, windowAt: recent ? row.windowAt : now, expiresAt: new Date(now.getTime() + 600000) } }, { upsert: true, session });
    });
}
export const supportText = (s: any, max = 2000) => { const value = String(s || '').trim(); if (!value || value.length > max)
    throw new InventoryError(400, `Nội dung cần từ 1 đến ${max} ký tự.`); return value; };
export type SupportActor = {
    orderToken?: string;
    guestToken?: string;
};
export async function supportOwner(id: string, actor: SupportActor, session?: ClientSession) {
    const ticket = await (await getCollection<any>(SUPPORT_TICKETS)).findOne({ _id: id }, { session });
    if (!ticket)
        throw new InventoryError(404, 'Không tìm thấy cuộc tư vấn.');
    if (ticket.customerId) {
        const access = await lookupAccess(actor.orderToken, session);
        if (access.authType !== 'member' || access.customerId !== ticket.customerId)
            throw new InventoryError(403, 'Cuộc tư vấn không thuộc tài khoản đang đăng nhập.');
    }
    else if (!/^sg_[a-f0-9]{64}$/.test(actor.guestToken || '') || ticket.guestHash !== hash(actor.guestToken!) || new Date(ticket.expiresAt).getTime() <= Date.now())
        throw new InventoryError(401, 'Phiên chat đã hết hạn. Vui lòng nhập lại thông tin liên hệ.');
    return ticket;
}
export function supportDto(t: any, staff = false) {
    const ratings = t.ratings || [];
    return { id: t._id, customerId: t.customerId, name: t.name, phone: t.phone, email: staff ? t.email : undefined, source: t.source, status: t.status, mode: t.mode, priority: t.priority,
        assignedTo: t.assignedTo, assignedName: t.assignedName, reason: t.reason, productId: t.productId, selectedImageId: t.selectedImageId, version: t.version, round: t.round,
        createdAt: t.createdAt, updatedAt: t.updatedAt, rating: ratings.find((r: any) => r.round === t.round) || null, ratingEligible: t.status === 'Đã xử lý' && !ratings.some((r: any) => r.round === t.round),
        ...(staff ? { history: t.history || [], notes: t.notes || [], ratings } : {}), contactVerified: false };
}
async function addMessage(ticket: any, text: string, sender: 'customer' | 'bot' | 'staff' | 'system', options: any = {}, session?: ClientSession) {
    const id = options.id || `SUP-${randomUUID()}`;
    const row = { _id: id, TIN_NHAN_ID: id, HO_TRO_ID: ticket._id, KHACH_HANG_ID: ticket.customerId || null, DON_HANG_ID: null, SAN_PHAM_ID: ticket.productId || null, NHAN_VIEN_ID: options.employeeId || null,
        CAU_HOI_ID: options.faqId || null, YEU_CAU_ID: options.imageId || null, NOI_DUNG_CAU_HOI: sender === 'customer' ? text : null, NOI_DUNG_TRA_LOI: sender !== 'customer' ? text : null,
        LOAI_TIN_NHAN: `support_${sender}`, THOI_GIAN_GUI: new Date(), TRANG_THAI: 'completed', HINH_ANH: options.image || null, ANH_GOI_Y: options.images || [], PRODUCT_SNAPSHOT: options.product || null };
    await (await getCollection<any>(MESSAGES)).insertOne(row, { session });
    return row;
}
export async function readSupport(id: string, actor: SupportActor) {
    const ticket = await supportOwner(id, actor);
    const rows = await (await getCollection<any>(MESSAGES)).find({ HO_TRO_ID: id }, { projection: { _id: 0 } }).sort({ THOI_GIAN_GUI: -1, TIN_NHAN_ID: -1 }).limit(300).toArray();
    return { ticket: supportDto(ticket), messages: rows.reverse().map(publicMessage) };
}
export function publicMessage(m: any) {
    return { id: m.TIN_NHAN_ID, role: m.LOAI_TIN_NHAN === 'support_customer' ? 'user' : 'bot', text: m.NOI_DUNG_CAU_HOI || m.NOI_DUNG_TRA_LOI || '', at: m.THOI_GIAN_GUI, image: m.HINH_ANH || null, images: m.ANH_GOI_Y || [], product: m.PRODUCT_SNAPSHOT || null, staff: m.LOAI_TIN_NHAN === 'support_staff' };
}
export async function startSupport(body: any, actor: SupportActor, source = 'Chat'): Promise<{
    ticket: any;
    messages: any[];
    guestToken?: string | null;
    expiresAt?: Date;
}> {
    if (body.ticketId) {
        try {
            await supportOwner(String(body.ticketId), actor);
            return readSupport(String(body.ticketId), actor);
        }
        catch (e) {
            if (actor.orderToken)
                throw e;
        }
    }
    let customer: any = null;
    if (actor.orderToken) {
        const access = await lookupAccess(actor.orderToken);
        if (access.authType === 'member')
            customer = await (await getCollection<any>('KHACH_HANG')).findOne({ KHACH_HANG_ID: access.customerId });
    }
    if (!customer && body.customerId)
        throw new InventoryError(401, 'Vui lòng đăng nhập lại, không thể nhận diện tài khoản bằng mã gửi từ trình duyệt.');
    const name = customer?.TEN || supportText(body.name, 100);
    const phone = normalizeOrderPhone(customer?.SDT || body.phone);
    const email = String(customer?.EMAIL || body.email || '').trim();
    if (!phone && !(source === 'Form' && email))
        throw new InventoryError(400, 'Nhập SĐT liên hệ hợp lệ trước khi bắt đầu chat.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
        throw new InventoryError(400, 'Email chưa hợp lệ.');
    if (customer && source === 'Chat') {
        const active = await (await getCollection<any>(SUPPORT_TICKETS)).findOne({ customerId: customer.KHACH_HANG_ID, source: 'Chat', status: { $ne: 'Đã xử lý' } }, { sort: { updatedAt: -1 } });
        if (active)
            return readSupport(active._id, actor);
    }
    const id = `HT${randomBytes(12).toString('hex').toUpperCase()}`, guestToken = customer ? null : `sg_${randomBytes(32).toString('hex')}`;
    const now = new Date();
    const ticket = { _id: id, customerId: customer?.KHACH_HANG_ID || null, guestHash: guestToken ? hash(guestToken) : null, name, phone, email, source,
        status: 'Chưa xử lý', mode: source === 'Form' ? 'WAITING' : 'AI', priority: 'normal', assignedTo: null, assignedName: null, reason: source === 'Form' ? 'Form liên hệ' : null, version: 0, round: 1,
        createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 12 * 3600000), history: [], notes: [], ratings: [], preferences: {} };
    await (await getCollection<any>(SUPPORT_TICKETS)).insertOne(ticket);
    await addMessage(ticket, 'Chào bạn! Mình có thể giải đáp thông tin, tìm mẫu hoa có sẵn hoặc chuyển bạn đến nhân viên.', 'bot');
    return { ticket: supportDto(ticket), messages: [], guestToken, expiresAt: ticket.expiresAt };
}
export async function supportOrders(id: string, actor: SupportActor, orderId = '') {
    const ticket = await supportOwner(id, actor);
    const access = await lookupAccess(actor.orderToken);
    const query = await ownedOrderQuery(access);
    const orders = await (await getCollection<any>('DON_HANG')).find({ ...query, ...(orderId ? { DON_HANG_ID: orderId } : {}) }, { projection: { _id: 0, DON_HANG_ID: 1, TRANG_THAI: 1, TONG_TIEN: 1, NGAY_TAO: 1, NGAY_MUON_GIAO: 1, KHUNG_GIO_MUON_GIAO: 1 } }).sort({ NGAY_TAO: -1 }).limit(20).toArray();
    const requests = await (await getCollection<any>('YEU_CAU_DAT_HANG')).find(ownedRequestQuery(access), { projection: { _id: 0, requestId: 1, status: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(20).toArray();
    return { orders, requests };
}
export async function sendSupport(id: string, body: any, actor: SupportActor) {
    const text = supportText(body.chatInput || (body.imageDataUrl ? 'Khách gửi ảnh cần nhân viên tư vấn' : body.selectedImageId ? 'Tôi muốn tư vấn mẫu này' : ''));
    if (!/^[\w-]{16,100}$/.test(String(body.messageId || '')))
        throw new InventoryError(400, 'Thiếu mã tin nhắn hợp lệ.');
    if (body.imageDataUrl && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(body.imageDataUrl) || body.imageDataUrl.length > 7 * 1024 * 1024))
        throw new InventoryError(400, 'Ảnh phải là JPG/PNG/WEBP, tối đa 5MB.');
    const col = await getCollection<any>(SUPPORT_TICKETS);
    let ticket = await supportOwner(id, actor);
    const messageKey = `${id}:${body.messageId}`;
    const duplicate = await (await getCollection<any>(MESSAGES)).findOne({ _id: messageKey });
    if (duplicate)
        return { ...await readSupport(id, actor), duplicate: true };
    const lock = await col.findOneAndUpdate({ _id: id, $or: [{ busyUntil: { $exists: false } }, { busyUntil: null }, { busyUntil: { $lte: new Date() } }] }, { $set: { busyUntil: new Date(Date.now() + 20000) } }, { returnDocument: 'after' });
    if (!lock)
        throw new InventoryError(409, 'Tin trước đang được xử lý. Vui lòng đợi một chút.');
    try {
        let selectedImage: any = null;
        if (body.selectedImageId) {
            selectedImage = await (await getCollection<any>('YEU_CAU_TAO_ANH')).findOne({ YEU_CAU_ID: body.selectedImageId, TRANG_THAI: 'Hoạt động' });
            if (!selectedImage)
                throw new InventoryError(400, 'Mẫu ảnh không còn khả dụng.');
        }
        await withTransaction(async (session) => {
            const current = await supportOwner(id, actor, session);
            const recent = current.messageWindowAt && Date.now() - new Date(current.messageWindowAt).getTime() < 600000;
            if (recent && Number(current.messageCount) >= 30)
                throw new InventoryError(429, 'Bạn nhắn quá nhanh. Vui lòng đợi một chút rồi thử lại.');
            const reopen = current.status === 'Đã xử lý';
            await col.updateOne({ _id: id }, { $set: { messageWindowAt: recent ? current.messageWindowAt : new Date(), messageCount: recent ? Number(current.messageCount) + 1 : 1 } }, { session });
            await addMessage(current, text, 'customer', { id: messageKey, image: body.imageDataUrl || selectedImage?.URL_ANH_KET_QUA, imageId: selectedImage?.YEU_CAU_ID }, session);
            await col.updateOne({ _id: id }, { $set: { updatedAt: new Date(), ...(needsImmediateHandoff(text) ? { priority: 'urgent' } : {}), ...(body.productId ? { productId: String(body.productId).slice(0, 80) } : {}), ...(selectedImage ? { selectedImageId: selectedImage.YEU_CAU_ID } : {}), ...(reopen ? { status: current.assignedTo ? 'Đang xử lý' : 'Chưa xử lý', mode: current.assignedTo ? 'HUMAN' : 'WAITING' } : {}) }, $inc: { version: 1, ...(reopen ? { round: 1 } : {}) }, ...(reopen ? { $push: { history: { at: new Date(), action: 'Khách mở lại yêu cầu', actor: 'customer' } } } : {}) } as any, { session });
        });
        ticket = await col.findOne({ _id: id });
        if (ticket.mode !== 'AI')
            return readSupport(id, actor);
        const history = await (await getCollection<any>(MESSAGES)).find({ HO_TRO_ID: id }).sort({ THOI_GIAN_GUI: -1 }).limit(6).toArray();
        const plan: any = await planChatReply({ ...body, chatInput: text, productId: body.productId || ticket.productId, preferences: ticket.preferences }, history.reverse());
        let authRequired = false, orderData: any = null;
        if (plan.intent === 'order') {
            try {
                orderData = await supportOrders(id, actor, String(body.orderId || text.match(/\bYEN[a-z0-9]+\b/i)?.[0] || '').toUpperCase());
                plan.reply = 'Mình đã tải thông tin trong phạm vi bạn được phép xem. Bạn chọn đơn bên dưới để xem chi tiết; thay đổi/hủy đơn cần xác nhận riêng.';
            }
            catch (e: any) {
                if (e instanceof InventoryError && [401, 403].includes(e.status)) {
                    authRequired = true;
                    plan.reply = 'Để bảo vệ thông tin đơn riêng, bạn xác minh SĐT người đặt bằng OTP trong khung bên dưới nhé. Điền thông tin đầu phiên chưa thay thế xác thực.';
                }
                else
                    throw e;
            }
        }
        // Re-check inside the transaction: a late AI response cannot talk over a staff takeover.
        await withTransaction(async (session) => {
            const fresh = await col.findOne({ _id: id }, { session });
            if (fresh.mode !== 'AI')
                return;
            const handoff = plan.intent === 'handoff';
            await col.updateOne({ _id: id }, { $set: { updatedAt: new Date(), ...(plan.preferences ? { preferences: plan.preferences } : {}), ...(handoff ? { mode: 'WAITING', status: 'Chưa xử lý', reason: plan.reason, priority: needsImmediateHandoff(text) ? 'urgent' : 'normal' } : {}) }, $inc: { version: 1 }, ...(handoff ? { $push: { history: { at: new Date(), action: 'Chuyển nhân viên', reason: plan.reason, actor: 'bot' } } } : {}) } as any, { session });
            await addMessage(ticket, plan.reply, 'bot', { id: `${messageKey}:reply`, faqId: plan.faqId, images: plan.images, product: plan.product }, session);
        });
        return { ...await readSupport(id, actor), authRequired, ...(orderData ? { orderData } : {}) };
    }
    catch (e: any) {
        if (e.code === 11000)
            return readSupport(id, actor);
        throw e;
    }
    finally {
        await col.updateOne({ _id: id }, { $unset: { busyUntil: '' } });
    }
}
export async function supportStaffAction(id: string, body: any, employee: any) {
    return withTransaction(async (session) => {
        const col = await getCollection<any>(SUPPORT_TICKETS);
        const t = await col.findOne({ _id: id }, { session });
        if (!t)
            throw new InventoryError(404, 'Không tìm thấy yêu cầu.');
        if (t.version !== body.version)
            throw new InventoryError(409, 'Yêu cầu vừa thay đổi, hãy tải lại.');
        const actor = employee.NHAN_VIEN_ID, action = String(body.action || '');
        if (action !== 'claim' && t.assignedTo !== actor && employee.VAI_TRO !== 'Admin')
            throw new InventoryError(403, 'Bạn chưa tiếp nhận yêu cầu này.');
        const updates: any = { updatedAt: new Date() };
        if (action === 'claim') {
            if (t.assignedTo && t.assignedTo !== actor && employee.VAI_TRO !== 'Admin')
                throw new InventoryError(409, 'Nhân viên khác đã tiếp nhận.');
            if (t.status === 'Đã xử lý')
                throw new InventoryError(409, 'Mở lại yêu cầu trước khi tiếp nhận.');
            Object.assign(updates, { assignedTo: actor, assignedName: employee.HO_TEN || actor, mode: 'HUMAN', status: 'Đang xử lý' });
        }
        else if (action === 'reply') {
            if (t.mode !== 'HUMAN' || t.status !== 'Đang xử lý')
                throw new InventoryError(409, 'Cần tiếp nhận yêu cầu trước khi trả lời.');
            await addMessage(t, supportText(body.text), 'staff', { employeeId: actor }, session);
        }
        else if (action === 'close') {
            if (t.status === 'Đã xử lý')
                throw new InventoryError(409, 'Yêu cầu đã kết thúc.');
            Object.assign(updates, { status: 'Đã xử lý', mode: 'HUMAN', closedAt: new Date() });
            await addMessage(t, 'Nhân viên đã kết thúc hỗ trợ. Bạn có thể đánh giá trải nghiệm từ 1 đến 5 sao bên dưới.', 'system', {}, session);
        }
        else if (action === 'ai') {
            if (t.status === 'Đã xử lý')
                throw new InventoryError(409, 'Mở lại yêu cầu trước.');
            Object.assign(updates, { mode: 'AI', reason: null });
        }
        else if (action === 'reopen') {
            if (t.status !== 'Đã xử lý')
                throw new InventoryError(409, 'Yêu cầu chưa đóng.');
            Object.assign(updates, { status: 'Đang xử lý', mode: 'HUMAN', round: t.round + 1, assignedTo: actor, assignedName: employee.HO_TEN || actor });
        }
        else if (action === 'assign') {
            if (t.status === 'Đã xử lý')
                throw new InventoryError(409, 'Mở lại yêu cầu trước khi chuyển nhân viên.');
            const target = await (await getCollection<any>('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: String(body.employeeId || '') }, { session });
            if (!target || !hasPermission(target.VAI_TRO, 'customerService', 'update') || /khóa|ngừng|nghỉ|inactive/i.test(String(target.TRANG_THAI || '')))
                throw new InventoryError(400, 'Nhân viên được chọn không có quyền hỗ trợ.');
            Object.assign(updates, { assignedTo: target.NHAN_VIEN_ID, assignedName: target.HO_TEN || target.NHAN_VIEN_ID, mode: 'HUMAN', status: 'Đang xử lý' });
        }
        else if (action === 'note') {
            await col.updateOne({ _id: id }, { $push: { notes: { text: supportText(body.text), at: new Date(), actor } } } as any, { session });
        }
        else
            throw new InventoryError(400, 'Thao tác không hợp lệ.');
        await col.updateOne({ _id: id }, { $set: updates, $inc: { version: 1 }, $push: { history: { at: new Date(), actor, action, note: action === 'note' ? undefined : body.text || undefined } } } as any, { session });
        return supportDto({ ...t, ...updates, version: t.version + 1 }, true);
    });
}
export async function rateSupport(id: string, body: any, actor: SupportActor) {
    const t = await supportOwner(id, actor);
    const score = Number(body.score), round = Number(body.round);
    if (!Number.isInteger(score) || score < 1 || score > 5 || t.status !== 'Đã xử lý' || round !== t.round)
        throw new InventoryError(400, 'Chỉ đánh giá lần hỗ trợ đã kết thúc, từ 1 đến 5 sao.');
    const comment = String(body.comment || '').trim();
    if (comment.length > 1000)
        throw new InventoryError(400, 'Nhận xét tối đa 1000 ký tự.');
    const updated = await (await getCollection<any>(SUPPORT_TICKETS)).updateOne({ _id: id, status: 'Đã xử lý', round, 'ratings.round': { $ne: round } }, { $push: { ratings: { round, score, comment, at: new Date() } } } as any);
    if (!updated.modifiedCount)
        throw new InventoryError(409, 'Lần hỗ trợ này đã được đánh giá.');
    return { message: 'Cảm ơn bạn đã đánh giá.' };
}
