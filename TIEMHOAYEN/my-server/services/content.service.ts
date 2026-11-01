import {cleanupContentFiles} from './content-files.service.js';
import type { Request, Response, NextFunction } from 'express';
import sanitizeHtml from 'sanitize-html';
import { getCollection } from '../mongo.js';
import { InventoryError, withTransaction } from './inventory/helpers.js';
import { hasPermission } from './role-permission.service.js';
import { randomBytes } from 'node:crypto';
export const BLOG_CATEGORIES = ['Chăm sóc hoa', 'Gợi ý chọn hoa', 'Ý nghĩa các loài hoa', 'Dịp đặc biệt', 'Tin tức cửa hàng'];
export const blogStatus = (s: any) => s === 'Hiển thị' ? 'Đã đăng' : String(s || 'Nháp');
export const publicBlogQuery = { TRANG_THAI: { $in: ['Đã đăng', 'Hiển thị'] } };
export const cleanHtml = (value: any) => sanitizeHtml(String(value || ''), { allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'h1', 'h2', 'figure', 'figcaption'], allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height'], '*': ['class'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] }, allowedSchemes: ['http', 'https', 'mailto', 'tel'], allowProtocolRelative: false });
export const plain = (v: any) => sanitizeHtml(String(v || ''), { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;|\u00a0/g, ' ').trim();
export const contentError = (res: Response, e: any) => res.status(e instanceof InventoryError ? e.status : 500).json({ message: e instanceof InventoryError ? e.message : 'Chưa lưu/tải được nội dung. Vui lòng thử lại.' });
export const newContentId = (prefix: string) => prefix + randomBytes(8).toString('hex').toUpperCase();
export async function requireContentStaff(req: Request, res: Response, next: NextFunction) {
    try {
        const employee = await (await getCollection<any>('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: String(req.headers['x-admin-id'] || '') });
        const action = req.method === 'GET' ? 'view' : req.method === 'DELETE' ? 'delete' : req.method === 'POST' && ['/', '/admin', '/admin/website', '/files'].includes(req.path) ? 'create' : 'update';
        if (!employee || /khóa|ngừng|nghỉ|inactive/i.test(String(employee.TRANG_THAI || '')) || !hasPermission(employee.VAI_TRO, 'content', action))
            throw new InventoryError(403, 'Bạn không có quyền quản lý nội dung.');
        res.locals.contentEmployee = employee;
        res.setHeader('Cache-Control', 'no-store');
        next();
    }
    catch (e) {
        contentError(res, e);
    }
}
export function blogFields(body: any, publish = false) {
    const title = String(body.title || '').trim(), category = String(body.category || '').trim(), cover = String(body.coverImage || '').trim();
    if (!title || title.length > 250)
        throw new InventoryError(400, 'Tiêu đề bắt buộc, tối đa 250 ký tự.');
    if (String(body.content || '').length > 500000)
        throw new InventoryError(400, 'Nội dung quá dài.');
    if (/data\s*:/i.test(String(body.content || '')) || /^data:/i.test(cover))
        throw new InventoryError(400, 'Hãy upload ảnh rồi sử dụng URL, không lưu ảnh base64.');
    if (cover && !/^(https?:\/\/|\/(?!\/)|assets\/)/i.test(cover))
        throw new InventoryError(400, 'Đường dẫn ảnh bìa không hợp lệ.');
    const content = cleanHtml(body.content);
    if (publish && (!category || !cover || !plain(content)))
        throw new InventoryError(400, 'Khi đăng/hẹn đăng cần danh mục, ảnh bìa và nội dung hợp lệ.');
    return { TIEU_DE: title, DANH_MUC_BLOG: category, ANH_BIA: cover || null, NOI_DUNG: content };
}
export async function enrichBlog(row: any, admin = false) {
    const employee = row.NHAN_VIEN_ID ? await (await getCollection<any>('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: row.NHAN_VIEN_ID }) : null;
    const { _id, BAN_LAM_VIEC, ...safe } = row;
    return { ...safe, NOI_DUNG: cleanHtml(safe.NOI_DUNG), TRANG_THAI: blogStatus(row.TRANG_THAI), TEN_NHAN_VIEN: employee?.HO_TEN || 'Tiệm Hoa Yên', ...(admin ? { BAN_LAM_VIEC } : {}) };
}
export async function publishDueBlogs() {
    const col = await getCollection<any>('BAI_VIET');
    const due = await col.find({ TRANG_THAI: 'Chờ đăng', THOI_DIEM_HEN_DANG: { $lte: new Date() } }).limit(100).toArray();
    for (const b of due) {
        try {
            blogFields({ title: b.TIEU_DE, category: b.DANH_MUC_BLOG, content: b.NOI_DUNG, coverImage: b.ANH_BIA }, true);
            await col.updateOne({ _id: b._id, TRANG_THAI: 'Chờ đăng', PHIEN_BAN: b.PHIEN_BAN, THOI_DIEM_HEN_DANG: b.THOI_DIEM_HEN_DANG }, { $set: { TRANG_THAI: 'Đã đăng', NGAY_DANG: new Date(), NGAY_CAP_NHAT: new Date(), THOI_DIEM_HEN_DANG: null }, $inc: { PHIEN_BAN: 1 } });
        }
        catch (e) {
            if (e instanceof InventoryError)
                await col.updateOne({ _id: b._id, TRANG_THAI: 'Chờ đăng', PHIEN_BAN: b.PHIEN_BAN }, { $set: { TRANG_THAI: 'Nháp', THOI_DIEM_HEN_DANG: null, LOI_HEN_DANG: e.message }, $inc: { PHIEN_BAN: 1 } });
            else
                throw e;
        }
    }
}
export function startContentJobs() {
    const cleanup=setInterval(()=>cleanupContentFiles().catch(()=>console.error('Chưa dọn được file nội dung không sử dụng.')),24*3600000);cleanup.unref(); const timer = setInterval(() => publishDueBlogs().catch(() => console.error('Chưa xử lý được lịch Blog.')), 30000); timer.unref(); publishDueBlogs().catch(() => { }); }
export function versionQuery(row: any, version: any) { if (Number(version) !== Number(row.PHIEN_BAN || 0))
    throw new InventoryError(409, 'Nội dung vừa được người khác cập nhật. Hãy tải lại trước khi lưu.'); return row.PHIEN_BAN === undefined ? { $or: [{ PHIEN_BAN: { $exists: false } }, { PHIEN_BAN: 0 }] } : { PHIEN_BAN: row.PHIEN_BAN }; }
