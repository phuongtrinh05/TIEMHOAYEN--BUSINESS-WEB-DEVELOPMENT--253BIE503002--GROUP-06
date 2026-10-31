import { Request, Response } from 'express';
import { getCollection } from '../mongo.js';
import { createHash, randomUUID } from 'node:crypto';
import { supportDto, supportStartRate } from '../services/support.service.js';
import { InventoryError, withTransaction } from '../services/inventory/helpers.js';
import { normalizeOrderPhone, lookupAccess } from '../services/order-access.service.js';
export const createContact = async (req: Request, res: Response) => {
    try {
        const fullName = String(req.body.fullName || req.body.hoTen || '').trim(), contact = String(req.body.phoneOrEmail || req.body.contactInfo || req.body.phone || req.body.email || '').trim(), subject = String(req.body.subject || req.body.chuDe || '').trim(), message = String(req.body.message || req.body.noiDung || '').trim();
        if (!fullName || fullName.length > 100)
            throw new InventoryError(400, 'Họ tên bắt buộc, tối đa 100 ký tự.');
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
        const phone = isEmail ? '' : normalizeOrderPhone(contact);
        if (!isEmail && !phone || contact.length > 200)
            throw new InventoryError(400, 'Nhập đúng email hoặc số điện thoại liên hệ.');
        if (!subject || subject.length > 200 || !message || message.length > 2000)
            throw new InventoryError(400, 'Chủ đề và nội dung bắt buộc, tối đa 200 / 2000 ký tự.');
        const key = String(req.body.clientRequestId || randomUUID());
        if (!/^[\w-]{16,100}$/.test(key))
            throw new InventoryError(400, 'Mã yêu cầu không hợp lệ.');
        const hash = (s: string) => createHash('sha256').update(s).digest('hex');
        let customerId: any = null;
        const token = String(req.headers['x-order-access'] || '');
        if (token) {
            const access = await lookupAccess(token);
            if (access.authType === 'member')
                customerId = access.customerId;
        }
        const id = 'LH' + hash(key).slice(0, 24).toUpperCase(), ticketId = 'HT' + hash('ticket:' + key).slice(0, 24).toUpperCase(), guestToken = customerId ? null : 'sg_' + hash('contact-session:' + key), fingerprint = hash(JSON.stringify({ fullName, contact, subject, message, customerId }));
        await supportStartRate(req.ip || 'unknown');
        const result = await withTransaction(async (session) => {
            const col = await getCollection<any>('LIEN_HE');
            const old = await col.findOne({ _id: id }, { session });
            if (old) {
                if (old.FINGERPRINT !== fingerprint)
                    throw new InventoryError(409, 'Mã gửi đã dùng với nội dung khác.');
                const ticket = await (await getCollection<any>('YEU_CAU_HO_TRO')).findOne({ _id: old.HO_TRO_ID }, { session });
                return ticket;
            }
            const now = new Date();
            const ticket = { _id: ticketId, customerId, guestHash: guestToken ? hash(guestToken) : null, name: fullName, phone, email: isEmail ? contact : '', source: 'Form', status: 'Chưa xử lý', mode: 'WAITING', priority: subject === 'Khiếu nại' ? 'urgent' : 'normal', assignedTo: null, assignedName: null, reason: subject, version: 0, round: 1, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 12 * 3600000), history: [{ at: now, actor: 'customer', action: 'Gửi form liên hệ' }], notes: [], ratings: [], preferences: {} };
            await (await getCollection<any>('YEU_CAU_HO_TRO')).insertOne(ticket, { session });
            await (await getCollection<any>('TIN_NHAN_CHAT')).insertOne({ _id: ticketId + ':form', TIN_NHAN_ID: ticketId + ':form', HO_TRO_ID: ticketId, KHACH_HANG_ID: customerId, LOAI_TIN_NHAN: 'support_customer', NOI_DUNG_CAU_HOI: subject + ': ' + message, THOI_GIAN_GUI: now, TRANG_THAI: 'completed' }, { session });
            await col.insertOne({ _id: id, LIEN_HE_ID: id, MA_YEU_CAU_CLIENT: hash(key), FINGERPRINT: fingerprint, HO_TEN: fullName, THONG_TIN_LIEN_HE: contact, LOAI_LIEN_HE: isEmail ? 'Email' : 'Điện thoại', KHACH_HANG_ID: customerId, CHU_DE: subject, NOI_DUNG: message, TRANG_THAI: 'Chưa xử lý', NGAY_TAO: now, HO_TRO_ID: ticketId }, { session });
            return ticket;
        });
        res.status(201).json({ message: `Đã nhận yêu cầu ${ticketId}. Nhân viên sẽ phản hồi trong khung hỗ trợ hoặc liên hệ theo thông tin bạn cung cấp.`, contactId: id, requestId: ticketId, support: { ticket: supportDto(result), messages: [], guestToken, expiresAt: result.expiresAt } });
    }
    catch (e: any) {
        if (e instanceof InventoryError)
            return res.status(e.status).json({ message: e.message });
        res.status(500).json({ message: 'Chưa gửi được yêu cầu. Bạn thử lại, nội dung đã nhập vẫn được giữ.' });
    }
};
export const getAllContacts = async (_req: Request, res: Response) => { try {
    res.json(await (await getCollection('LIEN_HE')).find({}).sort({ NGAY_TAO: -1 }).limit(500).toArray());
}
catch {
    res.status(500).json({ message: 'Chưa tải được liên hệ.' });
} };
