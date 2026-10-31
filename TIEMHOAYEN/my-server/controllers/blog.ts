import {retainContentFiles} from '../services/content-files.service.js';
import { Request, Response } from 'express';
import { getCollection, escapeRegex } from '../mongo.js';
import { InventoryError, withTransaction } from '../services/inventory/helpers.js';
import { BLOG_CATEGORIES, publicBlogQuery, blogStatus, blogFields, enrichBlog, publishDueBlogs, versionQuery, newContentId, contentError } from '../services/content.service.js';
export async function categories(_req: Request, res: Response) { try {
    const existing = await (await getCollection<any>('BAI_VIET')).distinct('DANH_MUC_BLOG', publicBlogQuery);
    res.json([...new Set([...BLOG_CATEGORIES, ...existing.filter(Boolean)])]);
}
catch (e) {
    contentError(res, e);
} }
export async function list(req: Request, res: Response) {
    try {
        await publishDueBlogs();
        const admin = !!res.locals.contentEmployee;
        const query: any = admin ? {} : { ...publicBlogQuery };
        const keyword = String(req.query.keyword || '').trim().slice(0, 150);
        if (keyword)
            query.$or = [{ TIEU_DE: { $regex: escapeRegex(keyword), $options: 'i' } }, { BAI_VIET_ID: { $regex: escapeRegex(keyword), $options: 'i' } }];
        if (req.query.category)
            query.DANH_MUC_BLOG = String(req.query.category);
        if (admin && req.query.status)
            query.TRANG_THAI = req.query.status === 'Đã đăng' ? { $in: ['Đã đăng', 'Hiển thị'] } : String(req.query.status);
        if (admin && (req.query.from || req.query.to)) {
            query.NGAY_CAP_NHAT = {};
            for (const k of ['from', 'to'])
                if (req.query[k]) {
                    const d = new Date(String(req.query[k]));
                    if (!Number.isFinite(d.getTime()))
                        throw new InventoryError(400, 'Ngày lọc không hợp lệ.');
                    query.NGAY_CAP_NHAT[k === 'from' ? '$gte' : '$lte'] = d;
                }
        }
        const col = await getCollection<any>('BAI_VIET');
        const page = Math.min(100000, Math.max(1, Math.floor(Number(req.query.page) || 1))), pageSize = Math.min(50, Math.max(1, Math.floor(Number(req.query.pageSize) || 12)));
        const paged = req.query.page !== undefined;
        const sorts:Record<string,any>={newest:{NGAY_DANG:-1,NGAY_CAP_NHAT:-1,BAI_VIET_ID:1},oldest:{NGAY_DANG:1,BAI_VIET_ID:1},views:{LUOT_XEM:-1,BAI_VIET_ID:1},code:{BAI_VIET_ID:1}};
        const rows = await col.find(query).sort(sorts[String(req.query.sort)]||sorts.newest).skip(paged ? (page - 1) * pageSize : 0).limit(paged ? pageSize : 100).toArray();
        const blogs = await Promise.all(rows.map(r => enrichBlog(r, admin)));
        res.json(paged ? { blogs, total: await col.countDocuments(query), page, pageSize } : blogs);
    }
    catch (e) {
        contentError(res, e);
    }
}
export async function detail(req: Request, res: Response) { try {
    await publishDueBlogs();
    const b = await (await getCollection<any>('BAI_VIET')).findOne({ BAI_VIET_ID: req.params.id, ...(res.locals.contentEmployee ? {} : publicBlogQuery) });
    if (!b)
        throw new InventoryError(404, 'Bài viết không khả dụng.');
    res.json(await enrichBlog(b, !!res.locals.contentEmployee));
}
catch (e) {
    contentError(res, e);
} }
export async function related(req: Request, res: Response) { try {
    const col = await getCollection<any>('BAI_VIET');
    const b = await col.findOne({ BAI_VIET_ID: req.params.id, ...publicBlogQuery });
    if (!b)
        throw new InventoryError(404, 'Bài viết không khả dụng.');
    const same = await col.find({ ...publicBlogQuery, BAI_VIET_ID: { $ne: b.BAI_VIET_ID }, DANH_MUC_BLOG: b.DANH_MUC_BLOG }).sort({ NGAY_DANG: -1 }).limit(4).toArray();
    const ids = [b.BAI_VIET_ID, ...same.map(x => x.BAI_VIET_ID)];
    const more = same.length < 4 ? await col.find({ ...publicBlogQuery, BAI_VIET_ID: { $nin: ids } }).sort({ NGAY_DANG: -1 }).limit(4 - same.length).toArray() : [];
    res.json(await Promise.all([...same, ...more].map(b => enrichBlog(b))));
}
catch (e) {
    contentError(res, e);
} }
export async function save(req: Request, res: Response) {
    try {
        const col = await getCollection<any>('BAI_VIET'), id = String(req.params.id || newContentId('BV'));
        const old = req.params.id ? await col.findOne({ BAI_VIET_ID: id }) : null;
        if (req.params.id && !old)
            throw new InventoryError(404, 'Không tìm thấy bài viết.');
        const action = req.body.action || 'save';
        const working = action === 'autosave';
        const status = working ? (old ? blogStatus(old.TRANG_THAI) : 'Nháp') : blogStatus(req.body.status || 'Nháp');
        if (!['Nháp', 'Chờ đăng', 'Đã đăng', 'Ẩn'].includes(status))
            throw new InventoryError(400, 'Trạng thái không hợp lệ.');
        const fields = blogFields(req.body, !working && ['Chờ đăng', 'Đã đăng'].includes(status));
        let schedule: any = null;
        if (status === 'Chờ đăng' && !working) {
            schedule = new Date(req.body.scheduledAt);
            if (!Number.isFinite(schedule.getTime()) || schedule.getTime() <= Date.now())
                throw new InventoryError(400, 'Lịch đăng phải ở tương lai, theo giờ Việt Nam.');
        }
        await withTransaction(session=>retainContentFiles(JSON.stringify(fields),session));
        const actor = res.locals.contentEmployee.NHAN_VIEN_ID, now = new Date();
        if (old) {
            const v = versionQuery(old, req.body.version);
            const values = working ? { BAN_LAM_VIEC: { ...fields, NGAY_LUU: now, NGUOI_SUA_ID: actor }, NGAY_CAP_NHAT: now } : { ...fields, TRANG_THAI: status, THOI_DIEM_HEN_DANG: schedule, NGAY_CAP_NHAT: now, NGUOI_CAP_NHAT_ID: actor, ...(status === 'Đã đăng' && blogStatus(old.TRANG_THAI) !== 'Đã đăng' ? { NGAY_DANG: now } : {}) };
            const r = await col.findOneAndUpdate({ BAI_VIET_ID: id, ...v }, { $set: values, $inc: { PHIEN_BAN: 1 }, ...(!working ? { $unset: { BAN_LAM_VIEC: '' } } : {}) }, { returnDocument: 'after' });
            if (!r)
                throw new InventoryError(409, 'Bài viết vừa thay đổi. Hãy tải lại.');
            res.json({ blog: await enrichBlog(r, true) });
        }
        else {
            const row = { BAI_VIET_ID: id, ...fields, TRANG_THAI: status, THOI_DIEM_HEN_DANG: schedule, NGAY_TAO: now, NGAY_CAP_NHAT: now, NGAY_DANG: status === 'Đã đăng' ? now : null, NHAN_VIEN_ID: actor, NGUOI_CAP_NHAT_ID: actor, PHIEN_BAN: 1, LUOT_XEM: 0 };
            await col.insertOne(row);
            res.status(201).json({ blog: await enrichBlog(row, true) });
        }
    }
    catch (e) {
        contentError(res, e);
    }
}
export async function remove(req: Request, res: Response) { try {
    const col = await getCollection<any>('BAI_VIET');
    const old = await col.findOne({ BAI_VIET_ID: req.params.id });
    if (!old)
        throw new InventoryError(404, 'Không tìm thấy bài viết.');
    const v = versionQuery(old, req.body.version);
    const r = await col.deleteOne({ BAI_VIET_ID: req.params.id, ...v });
    if (!r.deletedCount)
        throw new InventoryError(409, 'Bài viết vừa thay đổi.');
    res.json({ message: 'Đã xóa bài viết.' });
}
catch (e) {
    contentError(res, e);
} }
