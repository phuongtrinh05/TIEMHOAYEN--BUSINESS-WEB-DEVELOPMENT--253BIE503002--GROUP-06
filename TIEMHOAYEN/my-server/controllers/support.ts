import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { getCollection } from '../mongo.js';
import { InventoryError } from '../services/inventory/helpers.js';
import { hasPermission } from '../services/role-permission.service.js';
import { currentProduct, planChatReply } from '../services/chatbot-brain.service.js';
import { openChatImage } from '../services/chat-media.service.js';
import { SUPPORT_TICKETS, cancelSupportHandoff, publicMessage, rateSupport, readSupport, sendSupport, startSupport, supportDto, supportOrders, supportStaffAction, supportStartRate, updateSupportContact } from '../services/support.service.js';
import { MESSAGES as SALES_MESSAGES, SALES_CHAT_TYPES, sendMessage as sendSalesMessage } from '../services/sales-proposal.service.js';
import { REQUESTS, REQUEST_STATUS, updateSalesRequest } from '../services/order-request.service.js';
import { resolveRoleName } from '../services/role-permission.service.js';
import { isInactiveStatus } from '../utils/account-status.js';
const actor = (req: Request) => ({ orderToken: String(req.headers['x-order-access'] || ''), guestToken: String(req.headers['x-support-token'] || '') });
const fail = (res: Response, e: any) => res.status(e instanceof InventoryError ? e.status : 500).json({ message: e instanceof InventoryError ? e.message : 'Chưa xử lý được cuộc tư vấn. Vui lòng thử lại.' });
export async function requireSupportStaff(req: Request, res: Response, next: NextFunction) {
    try {
        const employee = await (await getCollection<any>('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: String(req.headers['x-admin-id'] || '') });
        const sales = employee && ['Admin', 'Nhân viên bán hàng'].includes(resolveRoleName(employee.VAI_TRO));
        if (!employee || isInactiveStatus(employee.TRANG_THAI) || (!hasPermission(employee.VAI_TRO, 'customerService', 'view') && !sales))
            throw new InventoryError(403, 'Bạn không có quyền xem hộp thư hỗ trợ.');
        const action = req.method === 'GET' ? 'view' : req.method === 'DELETE' ? 'delete' : req.method === 'POST' && req.baseUrl === '/api/faqs' ? 'create' : 'update';
        if (!hasPermission(employee.VAI_TRO, 'customerService', action) && !sales)
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
    res.json(await readSupport(String(req.params.id), actor(req), String(req.query.after || '')));
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
export async function contact(req: Request, res: Response) { try {
    res.json(await updateSupportContact(String(req.params.id), req.body, actor(req)));
}
catch (e) {
    fail(res, e);
} }
export async function cancelHandoff(req: Request, res: Response) { try {
    res.json(await cancelSupportHandoff(String(req.params.id), actor(req)));
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
        const employee = res.locals.supportEmployee;
        const role = resolveRoleName(employee?.VAI_TRO);
        const maySeeGeneralSupport = role !== 'Nhân viên bán hàng';
        const supportRows = maySeeGeneralSupport && req.query.source !== 'Tư vấn đặt hoa'
            ? await col.find(query).sort({ priority: -1, updatedAt: -1 }).limit(300).toArray() : [];
        const messageGroups = await (await getCollection<any>(SALES_MESSAGES)).aggregate([
            { $match: { LOAI_TIN_NHAN: { $in: SALES_CHAT_TYPES } } },
            { $sort: { THOI_GIAN_GUI: -1 } },
            { $group: { _id: '$YEU_CAU_ID', updatedAt: { $first: '$THOI_GIAN_GUI' }, preview: { $first: { $ifNull: ['$NOI_DUNG_TRA_LOI', '$NOI_DUNG_CAU_HOI'] } } } },
            { $limit: 300 },
        ]).toArray();
        const requestIds = messageGroups.map((row: any) => String(row._id || '')).filter(Boolean);
        const requestQuery: any = { requestId: { $in: requestIds } };
        if (role === 'Nhân viên bán hàng') requestQuery.$or = [{ assignedTo: employee.NHAN_VIEN_ID }, { assignedTo: { $in: [null, ''] } }];
        const requestRows = requestIds.length ? await (await getCollection<any>(REQUESTS)).find(requestQuery).toArray() : [];
        const lastByRequest = new Map(messageGroups.map((row: any) => [String(row._id), row]));
        const closed = new Set([REQUEST_STATUS.converted, REQUEST_STATUS.rejected, REQUEST_STATUS.closed, REQUEST_STATUS.cancelled, REQUEST_STATUS.expired]);
        const allSalesRows = requestRows.map((row: any) => ({
            id: `sales:${row.requestId}`, type: 'sales_request', requestId: row.requestId,
            name: row.sender?.name || 'Khách đặt hoa', phone: row.sender?.phone || '', email: row.sender?.email || '',
            customerId: row.customerId || null, source: 'Tư vấn đặt hoa', reason: lastByRequest.get(String(row.requestId))?.preview || row.reviewReason || 'Trao đổi về yêu cầu đặt hoa',
            status: closed.has(row.status) ? 'Đã xử lý' : row.assignedTo ? 'Đang xử lý' : 'Chưa xử lý',
            mode: row.assignedTo ? 'HUMAN' : 'WAITING', assignedTo: row.assignedTo || null, assignedName: row.assignedName || null,
            priority: row.routing?.urgency === 'urgent' ? 'urgent' : 'normal', createdAt: row.createdAt,
            updatedAt: lastByRequest.get(String(row.requestId))?.updatedAt || row.updatedAt || row.createdAt,
            version: Number(row.version || 0), requestStatus: row.status,
        }));
        const salesRows = req.query.source && req.query.source !== 'Tư vấn đặt hoa' ? [] : allSalesRows;
        let combined = [...supportRows.map(t => supportDto(t, true)), ...salesRows];
        if (req.query.status) combined = combined.filter((row: any) => row.status === String(req.query.status));
        combined.sort((a: any, b: any) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
        const total = combined.length;
        const rows = combined.slice((page - 1) * 30, page * 30);
        const supportPending = maySeeGeneralSupport ? await col.countDocuments({ mode: 'WAITING', status: 'Chưa xử lý' }) : 0;
        const salesPending = allSalesRows.filter((row: any) => row.status === 'Chưa xử lý').length;
        const pending = supportPending + salesPending;
        res.json({ tickets: rows, total, pending, supportPending, salesPending, page });
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
        if (String(req.params.id).startsWith('sales:')) {
            const requestId = String(req.params.id).slice(6);
            const row = await (await getCollection<any>(REQUESTS)).findOne({ requestId });
            if (!row) throw new InventoryError(404, 'Không tìm thấy yêu cầu đặt hoa.');
            const employee = res.locals.supportEmployee;
            if (resolveRoleName(employee?.VAI_TRO) === 'Nhân viên bán hàng' && row.assignedTo && row.assignedTo !== employee.NHAN_VIEN_ID) throw new InventoryError(403, 'Yêu cầu đang do Sales khác phụ trách.');
            const closed = [REQUEST_STATUS.converted, REQUEST_STATUS.rejected, REQUEST_STATUS.closed, REQUEST_STATUS.cancelled, REQUEST_STATUS.expired].includes(row.status);
            const ticket = { id: `sales:${requestId}`, type: 'sales_request', requestId, name: row.sender?.name || 'Khách đặt hoa', phone: row.sender?.phone || '', email: row.sender?.email || '', customerId: row.customerId || null,
                source: 'Tư vấn đặt hoa', reason: row.reviewReason || 'Trao đổi về yêu cầu đặt hoa', status: closed ? 'Đã xử lý' : row.assignedTo ? 'Đang xử lý' : 'Chưa xử lý', mode: row.assignedTo ? 'HUMAN' : 'WAITING', assignedTo: row.assignedTo || null, assignedName: row.assignedName || null,
                createdAt: row.createdAt, updatedAt: row.updatedAt, version: Number(row.version || 0), requestStatus: row.status };
            const messageRows = await (await getCollection<any>(SALES_MESSAGES)).find({ YEU_CAU_ID: requestId, LOAI_TIN_NHAN: { $in: SALES_CHAT_TYPES } }).sort({ THOI_GIAN_GUI: 1, TIN_NHAN_ID: 1 }).limit(300).toArray();
            const messages = messageRows.map((message: any) => {
                const customer = message.LOAI_TIN_NHAN === SALES_CHAT_TYPES[0] || (!!message.NOI_DUNG_CAU_HOI && !message.NOI_DUNG_TRA_LOI);
                return { id: message.TIN_NHAN_ID, role: customer ? 'user' : 'assistant', staff: !customer,
                    text: message.NOI_DUNG_TRA_LOI || message.NOI_DUNG_CAU_HOI || '', at: message.THOI_GIAN_GUI };
            });
            return res.json({ ticket, messages, incremental: false });
        }
        const t = await (await getCollection<any>(SUPPORT_TICKETS)).findOne({ _id: req.params.id });
        if (!t)
            throw new InventoryError(404, 'Không tìm thấy yêu cầu.');
        const parsedAfter = req.query.after ? new Date(String(req.query.after)) : null;
        const incremental = !!parsedAfter && !Number.isNaN(parsedAfter.getTime());
        const messages = await (await getCollection<any>('TIN_NHAN_CHAT')).find({ HO_TRO_ID: t._id, ...(incremental ? { THOI_GIAN_GUI: { $gte: parsedAfter } } : {}) }).sort({ THOI_GIAN_GUI: -1, TIN_NHAN_ID: -1 }).limit(300).toArray();
        res.json({ ticket: supportDto(t, true), messages: messages.reverse().map(publicMessage), incremental });
    }
    catch (e) {
        fail(res, e);
    }
}
export async function action(req: Request, res: Response) { try {
    const id = String(req.params.id);
    if (id.startsWith('sales:')) {
        const requestId = id.slice(6), action = String(req.body.action || '');
        if (action === 'reply') return res.json(await sendSalesMessage(requestId, { text: req.body.text, messageId: randomUUID() }, { employee: res.locals.supportEmployee }));
        if (action === 'claim') return res.json(await updateSalesRequest(requestId, { action: 'claim', version: Number(req.body.version || 0) }, res.locals.supportEmployee));
        throw new InventoryError(400, 'Thao tác này thực hiện tại hồ sơ yêu cầu đặt hàng.');
    }
    res.json(await supportStaffAction(id, req.body, res.locals.supportEmployee));
}
catch (e) {
    fail(res, e);
} }
export async function media(req: Request, res: Response) {
    try {
        const { file, stream } = await openChatImage(String(req.params.token || ''));
        res.setHeader('Content-Type', String(file.metadata?.mime || 'application/octet-stream'));
        res.setHeader('Content-Length', String(file.length));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        res.setHeader('Content-Disposition', 'inline');
        stream.once('error', () => res.destroy());
        stream.pipe(res);
    }
    catch (e) {
        fail(res, e);
    }
}
export async function staff(req: Request, res: Response) { try {
    const rows = await (await getCollection<any>('NHAN_VIEN')).find({}, { projection: { NHAN_VIEN_ID: 1, HO_TEN: 1, VAI_TRO: 1, TRANG_THAI: 1 } }).toArray();
    res.json(rows.filter(e => hasPermission(e.VAI_TRO, 'customerService', 'update') && !isInactiveStatus(e.TRANG_THAI)).map(e => ({ id: e.NHAN_VIEN_ID, name: e.HO_TEN || e.NHAN_VIEN_ID })));
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

/** Thẻ sản phẩm khách đang xem (kiểu Shopee): chỉ trả thông tin công khai. */
export async function productPreview(req: Request, res: Response) {
    try {
        const product = await currentProduct(String(req.params.productId || '').slice(0, 80));
        if (!product) return res.status(404).json({ message: 'Sản phẩm không còn bán.' });
        return res.json({ product: { id: product.id, name: product.name, price: product.price, image: product.image } });
    }
    catch (e: any) { return fail(res, e); }
}
