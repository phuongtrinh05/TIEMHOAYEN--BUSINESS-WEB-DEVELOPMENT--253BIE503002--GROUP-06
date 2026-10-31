import {retainContentFiles} from '../services/content-files.service.js';
import { Router } from 'express';
import multer from 'multer';
import { GridFSBucket, ObjectId } from 'mongodb';
import AdmZip from 'adm-zip';
import { getDb, getCollection } from '../mongo.js';
import { InventoryError, withTransaction } from '../services/inventory/helpers.js';
import { requireContentStaff, contentError, cleanHtml, plain, newContentId, versionQuery } from '../services/content.service.js';
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
router.post('/files', requireContentStaff, (req, res, next) => upload.single('file')(req, res, e => e ? res.status(400).json({ message: 'File không hợp lệ hoặc vượt 10 MB.' }) : next()), async (req, res) => {
    try {
        const file = req.file;
        if (!file)
            throw new InventoryError(400, 'Chọn file cần tải lên.');
        const b = file.buffer;
        let mime = '', ext = '';
        if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
            mime = 'image/png';
            ext = 'png';
        }
        else if (b[0] === 255 && b[1] === 216 && b[2] === 255) {
            mime = 'image/jpeg';
            ext = 'jpg';
        }
        else if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
            mime = 'image/webp';
            ext = 'webp';
        }
        else if (b.toString('ascii', 0, 5) === '%PDF-') {
            mime = 'application/pdf';
            ext = 'pdf';
        }
        else if (b[0] === 80 && b[1] === 75) {
            try {
                const zip = new AdmZip(b);
                if (zip.getEntry('[Content_Types].xml') && zip.getEntry('word/document.xml')) {
                    mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                    ext = 'docx';
                }
            }
            catch { }
        }
        if (!mime)
            throw new InventoryError(400, 'Chỉ nhận JPG, PNG, WebP, PDF hoặc DOCX hợp lệ.');
        if (mime.startsWith('image/') && file.size > 5 * 1024 * 1024)
            throw new InventoryError(400, 'Ảnh tối đa 5 MB.');
        const id = new ObjectId(), name = String(file.originalname).replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 180) || `file.${ext}`;
        const bucket = new GridFSBucket(await getDb(), { bucketName: 'TEP_TIN' });
        const stream = bucket.openUploadStreamWithId(id, name, { metadata: { mime, size: file.size, employeeId: res.locals.contentEmployee.NHAN_VIEN_ID, createdAt: new Date() } });
        await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); stream.end(b); });
        res.status(201).json({ id: String(id), url: `/api/content/files/${id}`, name, mime, size: file.size });
    }
    catch (e) {
        contentError(res, e);
    }
});
router.get('/files/:id', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id))
            throw new InventoryError(404, 'Không tìm thấy file.');
        const id = new ObjectId(req.params.id);
        const f = await (await getCollection<any>('TEP_TIN.files')).findOne({ _id: id });
        if (!f)
            throw new InventoryError(404, 'Không tìm thấy file.');
        const path = `/api/content/files/${id}`;
        const isAdmin = String(req.headers['x-admin-id'] || '');
        let permitted = false;
        if (isAdmin) {
            const employee = await (await getCollection<any>('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: isAdmin });
            const { hasPermission } = await import('../services/role-permission.service.js');
            permitted = !!employee && !/khóa|ngừng|nghỉ|inactive/i.test(employee.TRANG_THAI || '') && hasPermission(employee.VAI_TRO, 'content', 'view');
        }
        if (!permitted) {
            const blog = await (await getCollection<any>('BAI_VIET')).findOne({ TRANG_THAI: { $in: ['Đã đăng', 'Hiển thị'] }, $or: [{ ANH_BIA: { $regex: String(id) + '$' } }, { NOI_DUNG: { $regex: String(id) } }] });
            const content = await (await getCollection<any>('NOI_DUNG_WEBSITE')).findOne({ TRANG_THAI: 'Hiển thị', $or: [{ 'TEP_TIN.id': String(id) }, { NOI_DUNG_HTML: { $regex: String(id) } }] });
            if (!blog && !content)
                throw new InventoryError(404, 'File chưa được công khai.');
        }
        res.setHeader('Content-Type', f.metadata.mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Content-Disposition', `${f.metadata.mime.includes('wordprocessingml') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
        const stream = new GridFSBucket(await getDb(), { bucketName: 'TEP_TIN' }).openDownloadStream(id);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
    }
    catch (e) {
        contentError(res, e);
    }
});
router.get('/website-slot/:code', async (req, res) => { try {
    const row = await (await getCollection<any>('NOI_DUNG_WEBSITE')).findOne({ MA_NOI_DUNG: req.params.code });
    res.json(!row ? { configured: false } : row.TRANG_THAI === 'Hiển thị' ? { configured: true, visible: true, TEN_NOI_DUNG: row.TEN_NOI_DUNG, NOI_DUNG_HTML: row.NOI_DUNG_HTML, TEP_TIN: row.TEP_TIN } : { configured: true, visible: false });
}
catch (e) {
    contentError(res, e);
} });
router.get('/website/:code', async (req, res) => { try {
    const row = await (await getCollection<any>('NOI_DUNG_WEBSITE')).findOne({ MA_NOI_DUNG: req.params.code, TRANG_THAI: 'Hiển thị' });
    if (!row)
        throw new InventoryError(404, 'Nội dung không khả dụng.');
    res.json({ TEN_NOI_DUNG: row.TEN_NOI_DUNG, NOI_DUNG_HTML: row.NOI_DUNG_HTML, TEP_TIN: row.TEP_TIN, MA_NOI_DUNG: row.MA_NOI_DUNG });
}
catch (e) {
    contentError(res, e);
} });
router.get('/admin/website', requireContentStaff, async (req, res) => { try {
    res.json(await (await getCollection<any>('NOI_DUNG_WEBSITE')).find({}).sort({ NGAY_CAP_NHAT: -1 }).limit(500).toArray());
}
catch (e) {
    contentError(res, e);
} });
router.get('/admin/website/:id/history', requireContentStaff, async (req, res) => { try {
    res.json(await (await getCollection<any>('LICH_SU_NOI_DUNG')).find({ NOI_DUNG_ID: req.params.id }).sort({ SO_PHIEN_BAN: -1 }).limit(100).toArray());
}
catch (e) {
    contentError(res, e);
} });
async function saveWebsite(req: any, res: any) {
    try {
        const body = req.body, name = String(body.name || '').trim(), code = String(body.code || '').trim(), type = String(body.type || '');
        if (!name || name.length > 200 || !/^[a-z0-9-]{3,100}$/.test(code) || !['Chính sách', 'Giới thiệu', 'Hướng dẫn'].includes(type))
            throw new InventoryError(400, 'Nhập tên, loại và mã nội dung (chữ thường, số, dấu gạch ngang). FAQ quản lý tại Chatbot.');
        const html = cleanHtml(body.content);
        if (!plain(html) && !body.file)
            throw new InventoryError(400, 'Cần nội dung văn bản hoặc file đính kèm.');
        if (!['Hiển thị', 'Ẩn'].includes(body.status))
            throw new InventoryError(400, 'Trạng thái không hợp lệ.');
        let file: any = null;
        if (body.file) {
            if (!ObjectId.isValid(String(body.file.id)))
                throw new InventoryError(400, 'File không hợp lệ.');
            const f = await (await getCollection<any>('TEP_TIN.files')).findOne({ _id: new ObjectId(body.file.id) });
            if (!f)
                throw new InventoryError(400, 'File không tồn tại.');
            file = { id: String(f._id), name: f.filename, mime: f.metadata.mime, size: f.length, url: `/api/content/files/${f._id}` };
        }
        const id = String(req.params.id || newContentId('ND')), actor = res.locals.contentEmployee.NHAN_VIEN_ID;
        const result = await withTransaction(async (session) => {
            await retainContentFiles(html+(file?.url||''),session);
            const col = await getCollection<any>('NOI_DUNG_WEBSITE');
            const old = await col.findOne({ NOI_DUNG_ID: id }, { session });
            if (req.params.id && !old)
                throw new InventoryError(404, 'Nội dung không tồn tại.');
            const duplicate = await col.findOne({ MA_NOI_DUNG: code, NOI_DUNG_ID: { $ne: id } }, { session });
            if (duplicate)
                throw new InventoryError(409, 'Mã nội dung đã tồn tại.');
            const row = { NOI_DUNG_ID: id, MA_NOI_DUNG: code, TEN_NOI_DUNG: name, LOAI_NOI_DUNG: type, NOI_DUNG_HTML: html, TEP_TIN: file, TRANG_THAI: body.status, GHI_CHU: String(body.note || '').slice(0, 1000), NGAY_TAO: old?.NGAY_TAO || new Date(), NGAY_CAP_NHAT: new Date(), NGUOI_CAP_NHAT_ID: actor, PHIEN_BAN: Number(old?.PHIEN_BAN || 0) + 1 };
            if (old) {
                const v = versionQuery(old, body.version);
                const r = await col.updateOne({ NOI_DUNG_ID: id, ...v }, { $set: row }, { session });
                if (!r.modifiedCount)
                    throw new InventoryError(409, 'Nội dung vừa thay đổi.');
            }
            else
                await col.insertOne(row, { session });
            await (await getCollection<any>('LICH_SU_NOI_DUNG')).insertOne({ LICH_SU_ID: newContentId('LS'), NOI_DUNG_ID: id, SO_PHIEN_BAN: row.PHIEN_BAN, HANH_DONG: old ? 'Cập nhật' : 'Tạo', DU_LIEU_TRUOC: old, DU_LIEU_SAU: row, NGUOI_THUC_HIEN_ID: actor, THOI_DIEM: new Date() }, { session });
            return row;
        });
        res.json(result);
    }
    catch (e) {
        if ((e as any).code === 11000)
            return res.status(409).json({ message: 'Mã nội dung đã tồn tại.' });
        contentError(res, e);
    }
}
router.post('/admin/website', requireContentStaff, saveWebsite);
router.put('/admin/website/:id', requireContentStaff, saveWebsite);
export default router;
