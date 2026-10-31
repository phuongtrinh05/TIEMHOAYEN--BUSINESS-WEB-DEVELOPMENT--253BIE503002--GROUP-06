import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const uri = process.env.TEST_MONGO_URI;
if (!uri)
    test('content needs TEST_MONGO_URI', { skip: true }, () => { });
else {
    if (!/^mongodb:\/\/127\.0\.0\.1:/.test(uri))
        throw Error('Local test database required');
    process.env.MONGO_URI = uri;
    process.env.MONGO_DATABASE = 'TIEM_HOA_YEN_CONTENT_TEST_' + randomUUID().replaceAll('-', '');
    let mongo: typeof import('../mongo.js'), server: any, base: string;
    const staff = { 'x-admin-id': 'NV_CONTENT' };
    const req = (p: string, m = 'GET', b?: any, h: any = {}) => fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...h }, ...(b ? { body: JSON.stringify(b) } : {}) });
    const save = async (b: any, id = '') => { const r = await req('/blogs/admin' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', b, staff); const d: any = await r.json(); assert.ok(r.ok, JSON.stringify(d)); return d.blog; };
    const valid = { title: 'Bài test', content: '<p>Nội dung thật</p>', category: 'Chăm sóc hoa', coverImage: '/cover.jpg', status: 'Đã đăng' };
    before(async () => { mongo = await import('../mongo.js'); await (await mongo.getCollection<any>('NHAN_VIEN')).insertOne({ NHAN_VIEN_ID: 'NV_CONTENT', HO_TEN: 'Biên tập viên', EMAIL: 'private@example.com', VAI_TRO: 'Admin' }); const express = (await import('express')).default; const app = express(); app.use(express.json()); app.use('/blogs', (await import('../routes/blog.js')).default); app.use('/content', (await import('../routes/content.js')).default); app.use('/contacts', (await import('../routes/contact.js')).default); server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); base = 'http://127.0.0.1:' + server.address().port; });
    after(async () => { if (server) {
        server.closeAllConnections();
        await new Promise<void>(r => server.close(() => r()));
    } if (mongo) {
        await (await mongo.getDb()).dropDatabase();
        await (await mongo.getMongoClient()).close();
    } });
    test('author, permissions, publish validation, private draft and HTML sanitization', async () => {
        assert.equal((await req('/blogs/admin')).status, 403);
        const d = await save({ title: 'Nháp', status: 'Nháp', staffId: 'FAKE' });
        assert.equal(d.NHAN_VIEN_ID, 'NV_CONTENT');
        assert.equal((await req('/blogs/' + d.BAI_VIET_ID)).status, 404);
        assert.equal((await req('/blogs/admin', 'POST', { ...valid, content: '<p>&nbsp;</p>' }, staff)).status, 400);
        const b = await save({ ...valid, content: '<p onclick="x()">Text</p><script>x()</script>' });
        const pub: any = await (await req('/blogs/' + b.BAI_VIET_ID)).json();
        assert.ok(!JSON.stringify(pub).includes('private@example'));
        assert.ok(!pub.NOI_DUNG.includes('script'));
        assert.ok(!pub.NOI_DUNG.includes('onclick'));
    });
    test('autosave preserves published content; version blocks stale writes', async () => {
        let b = await save(valid);
        b = await save({ title: 'Working copy', content: 'Draft', action: 'autosave', version: b.PHIEN_BAN }, b.BAI_VIET_ID);
        const pub: any = await (await req('/blogs/' + b.BAI_VIET_ID)).json();
        assert.equal(pub.TIEU_DE, valid.title);
        assert.equal(pub.BAN_LAM_VIEC, undefined);
        assert.equal(b.BAN_LAM_VIEC.TIEU_DE, 'Working copy');
        assert.equal((await req('/blogs/admin/' + b.BAI_VIET_ID, 'PUT', { title: 'stale', version: 1 }, staff)).status, 409);
    });
    test('schedule publishes once, hidden cancels schedule and direct public access', async () => {
        let b = await save({ ...valid, status: 'Chờ đăng', scheduledAt: new Date(Date.now() + 60000) });
        assert.equal((await req('/blogs/' + b.BAI_VIET_ID)).status, 404);
        await (await mongo.getCollection<any>('BAI_VIET')).updateOne({ BAI_VIET_ID: b.BAI_VIET_ID }, { $set: { THOI_DIEM_HEN_DANG: new Date(0) } });
        await (await import('../services/content.service.js')).publishDueBlogs();
        b = await (await req('/blogs/admin/' + b.BAI_VIET_ID, 'GET', undefined, staff)).json();
        assert.equal(b.TRANG_THAI, 'Đã đăng');
        b = await save({ ...valid, status: 'Ẩn', version: b.PHIEN_BAN }, b.BAI_VIET_ID);
        assert.equal(b.THOI_DIEM_HEN_DANG, null);
        assert.equal((await req('/blogs/' + b.BAI_VIET_ID)).status, 404);
        assert.equal((await req('/blogs/admin', 'POST', { ...valid, status: 'Chờ đăng', scheduledAt: new Date(0) }, staff)).status, 400);
    });
    test('list filters and related only return published articles', async () => {
        const a = await save({ ...valid, title: 'Flower care unique' });
        await save({ ...valid, title: 'Flower care private', status: 'Nháp' });
        const r: any = await (await req('/blogs?keyword=Flower&page=1&pageSize=1')).json();
        assert.equal(r.total, 1);
        assert.equal(r.blogs[0].BAI_VIET_ID, a.BAI_VIET_ID);
        const related: any = await (await req('/blogs/' + a.BAI_VIET_ID + '/related')).json();
        assert.ok(related.every((b: any) => b.TRANG_THAI === 'Đã đăng' && b.BAI_VIET_ID !== a.BAI_VIET_ID));
    });
    test('website status, transactional history and stale update checks', async () => {
        const body = { name: 'Policy', code: 'policy-test', type: 'Chính sách', content: 'Policy body', status: 'Ẩn' };
        let r = await req('/content/admin/website', 'POST', body, staff);
        assert.equal(r.status, 200);
        let w: any = await r.json();
        assert.equal((await req('/content/website/policy-test')).status, 404);
        r = await req('/content/admin/website/' + w.NOI_DUNG_ID, 'PUT', { ...body, status: 'Hiển thị', version: w.PHIEN_BAN }, staff);
        assert.equal(r.status, 200);
        w = await r.json();
        assert.equal((await req('/content/website/policy-test')).status, 200);
        const hist: any = await (await req('/content/admin/website/' + w.NOI_DUNG_ID + '/history', 'GET', undefined, staff)).json();
        assert.equal(hist.length, 2);
        assert.equal(hist[0].DU_LIEU_TRUOC.TRANG_THAI, 'Ẩn');
    });
    test('contact concurrent retry creates one ticket and message', async () => {
        const b = { fullName: 'Khách test', phoneOrEmail: 'test@example.com', subject: 'Tư vấn', message: 'Nội dung', clientRequestId: randomUUID() };
        const results = await Promise.all([req('/contacts', 'POST', b), req('/contacts', 'POST', b)]);
        for (const r of results)
            assert.equal(r.status, 201);
        const a: any = await results[0].json(), other: any = await results[1].json();
        assert.equal(a.requestId, other.requestId);
        assert.equal(await (await mongo.getCollection<any>('TIN_NHAN_CHAT')).countDocuments({ HO_TRO_ID: a.requestId }), 1);
        assert.equal((await req('/contacts', 'POST', { ...b, message: 'changed' })).status, 409);
    });
    test('uploaded file signature and private/public access', async () => {
        const bad = new FormData();
        bad.append('file', new Blob(['fake'], { type: 'image/png' }), 'fake.png');
        assert.equal((await fetch(base + '/content/files', { method: 'POST', headers: staff, body: bad })).status, 400);
        const f = new FormData();
        f.append('file', new Blob(['%PDF-1.4\n test'], { type: 'application/pdf' }), 'test.pdf');
        const uploaded = await fetch(base + '/content/files', { method: 'POST', headers: staff, body: f });
        assert.equal(uploaded.status, 201);
        const file: any = await uploaded.json();
        assert.equal((await req('/content/files/' + file.id)).status, 404);
        assert.equal((await req('/content/files/' + file.id, 'GET', undefined, staff)).status, 200);
        assert.equal((await req('/content/admin/website', 'POST', { name: 'File', code: 'file-public-test', type: 'Hướng dẫn', content: '', file, status: 'Hiển thị' }, staff)).status, 200);
        assert.equal((await req('/content/files/' + file.id)).status, 200);
    });
 test('orphan cleanup retains history files and only removes old unreferenced uploads',async()=>{
   const {ObjectId}=await import('mongodb');const kept=new ObjectId(),orphan=new ObjectId();const old=new Date(Date.now()-8*86400000);
   const col=await mongo.getCollection<any>('TEP_TIN.files');await col.insertMany([{_id:kept,metadata:{createdAt:old}},{_id:orphan,metadata:{createdAt:old}}]);
   await(await mongo.getCollection<any>('LICH_SU_NOI_DUNG')).insertOne({DU_LIEU_SAU:{TEP_TIN:{id:String(kept)}}});
   await(await import('../services/content-files.service.js')).cleanupContentFiles();
   assert.ok(await col.findOne({_id:kept}));assert.equal(await col.findOne({_id:orphan}),null);
 });

}
