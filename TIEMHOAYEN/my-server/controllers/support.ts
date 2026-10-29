import type { Request, Response, NextFunction } from 'express';
import { getCollection } from '../mongo.js';
import { InventoryError } from '../services/inventory/helpers.js';
import { hasPermission } from '../services/role-permission.service.js';
import { planChatReply } from '../services/chatbot-brain.service.js';
import { SUPPORT_TICKETS, publicMessage, rateSupport, readSupport, sendSupport, startSupport, supportDto, supportOrders, supportStaffAction, supportStartRate } from '../services/support.service.js';
const actor = (req: Request) => ({ orderToken: String(req.headers['x-order-access'] || ''), guestToken: String(req.headers['x-support-token'] || '') });
const fail = (res: Response, e: any) => res.status(e instanceof InventoryError ? e.status : 500).json({ message: e instanceof InventoryError ? e.message : 'Chưa xử lý được cuộc tư vấn. Vui lòng thử lại.' });
export async function requireSupportStaff(req: Request, res: Response, next: NextFunction) {
    try {
        const employee = await (await getCollection<any>('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: String(req.headers['x-admin-id'] || '') });
        if (!employee || /khóa|ngừng|nghỉ|inactive/i.test(String(employee.TRANG_THAI || '')) || !hasPermission(employee.VAI_TRO, 'customerService', 'view'))
            throw new InventoryError(403, 'Bạn không có quyền xem hộp thư hỗ trợ.');
        const action = req.method === 'GET' ? 'view' : req.method === 'DELETE' ? 'delete' : req.method === 'POST' && req.baseUrl === '/api/faqs' ? 'create' : 'update';
        if (!hasPermission(employee.VAI_TRO, 'customerService', action))
            throw new InventoryError(403, 'Bạn không có quyền xử lý hỗ trợ.');
        res.locals.supportEmployee = employee;
        next();
    }
    catch (e) {
        fail(res, e);
    }
}
export async function start(req: Request, res: Response) {
    try {
        res.setHeader('Cache-Control', 'no-store');
        await supportStartRate(req.ip || 'unknown');
        res.json(await startSupport(req.body, actor(req)));
    }
    catch (e) {
        fail(res, e);
    }
}
export async function read(req: Request, res: Response) { try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await readSupport(String(req.params.id), actor(req)));
}
catch (e) {
    fail(res, e);
} }
export async function send(req: Request, res: Response) { try {
    res.json(await sendSupport(String(req.params.id), req.body, actor(req)));
}
catch (e) {
    fail(res, e);
} }
export async function orders(req: Request, res: Response) { try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await supportOrders(String(req.params.id), actor(req), String(req.query.orderId || '')));
}
catch (e) {
    fail(res, e);
} }
export async function rate(req: Request, res: Response) { try {
    res.json(await rateSupport(String(req.params.id), req.body, actor(req)));
}
catch (e) {
    fail(res, e);
} }
export async function list(req: Request, res: Response) {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const query: any = { $or: [{ mode: { $ne: 'AI' } }, { status: 'Đã xử lý' }] };
        if (req.query.status)
            query.status = String(req.query.status);
        if (req.query.source)
            query.source = String(req.query.source);
        const page = Math.max(1, Math.min(100000, Math.floor(Number(req.query.page) || 1)));
        const col = await getCollection<any>(SUPPORT_TICKETS);
        const [rows, total, pending] = await Promise.all([col.find(query).sort({ priority: -1, updatedAt: -1 }).skip((page - 1) * 30).limit(30).toArray(), col.countDocuments(query), col.countDocuments({ mode: 'WAITING', status: 'Chưa xử lý' })]);
        res.json({ tickets: rows.map(t => supportDto(t, true)), total, pending, page });
    }
    catch (e) {
        fail(res, e);
    }
}
export async function summary(_req: Request, res: Response) {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ pending: await (await getCollection<any>(SUPPORT_TICKETS)).countDocuments({ mode: 'WAITING', status: 'Chưa xử lý' }) });
    }
    catch (e) {
        fail(res, e);
    }
}
export async function detail(req: Request, res: Response) {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const t = await (await getCollection<any>(SUPPORT_TICKETS)).findOne({ _id: req.params.id });
        if (!t)
            throw new InventoryError(404, 'Không tìm thấy yêu cầu.');
        const messages = await (await getCollection<any>('TIN_NHAN_CHAT')).find({ HO_TRO_ID: t._id }).sort({ THOI_GIAN_GUI: -1, TIN_NHAN_ID: -1 }).limit(300).toArray();
        res.json({ ticket: supportDto(t, true), messages: messages.reverse().map(publicMessage) });
    }
    catch (e) {
        fail(res, e);
    }
}
export async function action(req: Request, res: Response) { try {
    res.json(await supportStaffAction(String(req.params.id), req.body, res.locals.supportEmployee));
}
catch (e) {
    fail(res, e);
} }
export async function staff(req: Request, res: Response) { try {
    const rows = await (await getCollection<any>('NHAN_VIEN')).find({}, { projection: { NHAN_VIEN_ID: 1, HO_TEN: 1, VAI_TRO: 1, TRANG_THAI: 1 } }).toArray();
    res.json(rows.filter(e => hasPermission(e.VAI_TRO, 'customerService', 'update') && !/khóa|ngừng|nghỉ|inactive/i.test(String(e.TRANG_THAI || ''))).map(e => ({ id: e.NHAN_VIEN_ID, name: e.HO_TEN || e.NHAN_VIEN_ID })));
}
catch (e) {
    fail(res, e);
} }
export async function testChat(req: Request, res: Response) { try {
    const result = await planChatReply({ chatInput: String(req.body.chatInput || '').slice(0, 2000), productId: req.body.productId });
    res.json({ ...result, test: true, message: 'Chế độ thử nghiệm: không tạo ticket, không gửi thông báo, không lưu lịch sử khách.' });
}
catch (e) {
    fail(res, e);
} }
