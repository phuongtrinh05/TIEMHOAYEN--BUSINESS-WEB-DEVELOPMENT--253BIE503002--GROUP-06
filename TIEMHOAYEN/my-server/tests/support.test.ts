import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const uri = process.env.TEST_MONGO_URI;
if (!uri)
    test('support integration requires TEST_MONGO_URI (isolated replica set)', { skip: true }, () => { });
else {
    if (!/^mongodb:\/\/127\.0\.0\.1:/.test(uri))
        throw new Error('Support tests require a local test MongoDB.');
    process.env.MONGO_URI = uri;
    process.env.MONGO_DATABASE = `TIEM_HOA_YEN_SUPPORT_TEST_${randomUUID().replaceAll('-', '')}`;
    process.env.GROQ_API_KEY = '';
    process.env.API_key = '';
    let mongo: typeof import('../mongo.js'), support: typeof import('../services/support.service.js'), brain: typeof import('../services/chatbot-brain.service.js');
    const guest = () => support.startSupport({ name: 'Khách test', phone: '0901234567' }, {});
    const actor = (r: any) => ({ guestToken: r.guestToken });
    const send = (r: any, text: string, extra: any = {}) => support.sendSupport(r.ticket.id, { chatInput: text, messageId: randomUUID(), ...extra }, actor(r));
    const employee = { NHAN_VIEN_ID: 'NV_TEST', HO_TEN: 'CSKH test', VAI_TRO: 'Admin' };
    before(async () => {
        mongo = await import('../mongo.js');
        support = await import('../services/support.service.js');
        brain = await import('../services/chatbot-brain.service.js');
        await (await mongo.getCollection<any>('CAU_HOI_CO_SAN')).insertMany([
            { CAU_HOI_ID: 'FAQ_OPEN', CAU_HOI: 'Cửa hàng mở cửa lúc mấy giờ?', CAU_TRA_LOI: 'Mở cửa từ 8h đến 20h.', TRANG_THAI: 'Hoạt động' },
            { CAU_HOI_ID: 'FAQ_DEPOSIT', CAU_HOI: 'Shop có yêu cầu đặt cọc không?', CAU_TRA_LOI: 'Đơn hàng cần đặt cọc trước.', TRANG_THAI: 'Hoạt động' },
            { CAU_HOI_ID: 'FAQ_LOCKED', CAU_HOI: 'Mật khẩu bí mật là gì?', CAU_TRA_LOI: 'LOCKED_SECRET', TRANG_THAI: 'Bị khóa' },
        ]);
        await (await mongo.getCollection<any>('SAN_PHAM')).insertOne({ SAN_PHAM_ID: 'SP123', TEN_SAN_PHAM: 'Bó hoa test', GIA: 300000, TON_THANH_PHAM: 2, TP_DANG_GIU: 1, TRANG_THAI: 'Đang bán' });
        await (await mongo.getCollection<any>('HOA_TUOI')).insertOne({ HOA_TUOI_ID: 'HT_TEST', TEN_HOA_TUOI: 'Hoa hồng', TRANG_THAI: 'Đang hiển thị' });
        await (await mongo.getCollection<any>('HOA_TUOI_SAN_PHAM')).insertOne({ HOA_TUOI_ID: 'HT_TEST', SAN_PHAM_ID: 'SP123' });
        await (await mongo.getCollection<any>('YEU_CAU_TAO_ANH')).insertMany([
            { YEU_CAU_ID: 'IMG_RED', FLOWER_TYPES: 'rose', COLOR: 'red', OCCASION: 'birthday', URL_ANH_KET_QUA: 'https://example.com/red.jpg', TRANG_THAI: 'Hoạt động' },
            { YEU_CAU_ID: 'IMG_LOCKED', FLOWER_TYPES: 'rose', COLOR: 'red', URL_ANH_KET_QUA: 'https://example.com/locked.jpg', TRANG_THAI: 'Bị khóa' },
        ]);
        await support.ensureSupportIndexes();
    });
    after(async () => { if (mongo) {
        await (await mongo.getDb()).dropDatabase();
        await (await mongo.getMongoClient()).close();
    } });
    test('guest contact gate is enforced on server; another guest cannot read chat', async () => {
        await assert.rejects(support.startSupport({}, {}));
        await assert.rejects(support.startSupport({ customerId: 'KH_FAKE', name: 'Fake', phone: '0901234567' }, {}));
        const anonymous = await support.startSupport({ anonymous: true }, {});
        assert.equal(anonymous.ticket.name, 'Khách vãng lai');
        assert.equal(anonymous.ticket.phone, '');
        const handoff = await send(anonymous, 'gặp nhân viên');
        assert.equal(handoff.ticket.contactRequired, true);
        const contacted = await support.updateSupportContact(anonymous.ticket.id, { name: 'Khách ẩn danh', phone: '0901111222' }, actor(anonymous));
        assert.equal(contacted.ticket.contactRequired, false);
        assert.equal(contacted.ticket.phone, '0901111222');
        const anonymous2 = await support.startSupport({ anonymous: true }, {});
        const handoff2 = await send(anonymous2, 'gặp nhân viên');
        assert.equal(handoff2.ticket.contactRequired, true);
        const cancelled = await support.cancelSupportHandoff(anonymous2.ticket.id, actor(anonymous2));
        assert.equal(cancelled.ticket.contactRequired, false);
        assert.equal(cancelled.ticket.mode, 'AI');
        const a = await guest(), b = await guest();
        await assert.rejects(support.readSupport(a.ticket.id, actor(b)));
        await assert.rejects(support.supportOrders(a.ticket.id, actor(a)));
        assert.equal((await support.readSupport(a.ticket.id, actor(a))).ticket.name, 'Khách test');
    });
    test('public FAQ works without OTP and locked FAQ never answers', async () => {
        const a = await guest();
        const response = await send(a, 'Cửa hàng mở cửa lúc mấy giờ?');
        assert.equal(response.messages.at(-1)?.text, 'Mở cửa từ 8h đến 20h.');
        const locked = await brain.planChatReply({ chatInput: 'Mật khẩu bí mật là gì?' });
        assert.equal(locked.intent, 'handoff');
        assert.ok(!locked.reply.includes('LOCKED_SECRET'));
        assert.equal((await brain.planChatReply({ chatInput: 'Mình đặt hoa có cần cọc không?' })).faqId, 'FAQ_DEPOSIT');
        assert.match((await brain.planChatReply({ chatInput: 'Shop có bán hoa gì?' })).reply, /Hoa hồng/);
    });
    test('product context uses current server price and stock, ignoring browser values', async () => {
        const result = await brain.planChatReply({ chatInput: 'bó này còn không giá bao nhiêu?', productId: 'SP123', productInfo: { price: 1, available: 999 } });
        assert.equal(result.intent, 'product');
        assert.equal(result.product?.price, 300000);
        assert.equal(result.product?.finished, 1);
        await (await mongo.getCollection<any>('SAN_PHAM')).updateOne({ SAN_PHAM_ID: 'SP123' }, { $set: { GIA: 400000 } });
        assert.equal((await brain.planChatReply({ chatInput: 'bó này giá bao nhiêu?', productId: 'SP123' })).product?.price, 400000);
        assert.equal((await brain.planChatReply({ chatInput: 'đơn của tôi có bó này giao chưa?', productId: 'SP123' })).intent, 'order');
    });
    test('image retrieval distinguishes flower names from colors and uses active library only', async () => {
        assert.equal(brain.imagePreferences('hoa hồng').color, null);
        assert.equal(brain.imagePreferences('cẩm tú cầu').color, null);
        assert.equal(brain.imagePreferences('hoa hồng màu hồng').color, 'pink');
        const before = await (await mongo.getCollection<any>('YEU_CAU_TAO_ANH')).countDocuments();
        const result = await brain.planChatReply({ chatInput: 'xem ảnh hoa hồng đỏ sinh nhật' });
        assert.equal(result.images?.[0].id, 'IMG_RED');
        assert.ok(result.images?.every(i => i.id !== 'IMG_LOCKED'));
        assert.equal(await (await mongo.getCollection<any>('YEU_CAU_TAO_ANH')).countDocuments(), before);
    });
    test('anger escalates immediately; public FAQ still answers while unassigned; retries do not duplicate', async () => {
        assert.equal(brain.needsImmediateHandoff('người yêu đang giận nên mua hoa gì?'), false);
        const a = await guest();
        const messageId = randomUUID();
        const r = await send(a, 'Tôi rất bức xúc vì shop giao sai', { messageId });
        assert.equal(r.ticket.mode, 'WAITING');
        assert.equal(r.ticket.priority, 'urgent');
        const retry = await support.sendSupport(a.ticket.id, { chatInput: 'Tôi rất bức xúc vì shop giao sai', messageId }, actor(a));
        assert.equal(retry.messages.length, r.messages.length);
        const next = await send(a, 'Cửa hàng mở cửa lúc mấy giờ?');
        assert.equal(next.messages.length, r.messages.length + 2);
        assert.equal(next.messages.at(-1)?.text, 'Mở cửa từ 8h đến 20h.');
    });
    test('staff ownership, explicit closing, one rating per round, private notes and reopening', async () => {
        const a = await guest();
        let r = await send(a, 'gặp nhân viên');
        let t = await support.supportStaffAction(a.ticket.id, { action: 'claim', version: r.ticket.version }, employee);
        await assert.rejects(support.supportStaffAction(a.ticket.id, { action: 'reply', version: t.version, text: 'x' }, { NHAN_VIEN_ID: 'NV_OTHER', VAI_TRO: 'CSKH' }));
        t = await support.supportStaffAction(a.ticket.id, { action: 'reply', version: t.version, text: 'Nhân viên đang kiểm tra.' }, employee);
        assert.equal(t.status, 'Đang xử lý');
        t = await support.supportStaffAction(a.ticket.id, { action: 'note', version: t.version, text: 'PRIVATE_NOTE' }, employee);
        assert.ok(!JSON.stringify(await support.readSupport(a.ticket.id, actor(a))).includes('PRIVATE_NOTE'));
        t = await support.supportStaffAction(a.ticket.id, { action: 'close', version: t.version }, employee);
        assert.equal(t.ratingEligible, true);
        await assert.rejects(support.rateSupport(a.ticket.id, { round: 1, score: 6 }, actor(a)));
        await support.rateSupport(a.ticket.id, { round: 1, score: 5 }, actor(a));
        await assert.rejects(support.rateSupport(a.ticket.id, { round: 1, score: 4 }, actor(a)));
        await assert.rejects(support.supportStaffAction(a.ticket.id, { action: 'assign', version: t.version, employeeId: 'NV_TEST' }, employee));
        r = await send(a, 'Tôi cần hỗ trợ thêm');
        assert.equal(r.ticket.round, 2);
        assert.equal(r.ticket.mode, 'HUMAN');
        assert.equal(r.ticket.rating, null);
    });
    test('two concurrent staff claims allow exactly one; stale changes fail', async () => {
        const a = await guest(), r = await send(a, 'gặp nhân viên');
        const attempts = await Promise.allSettled(['A', 'B'].map(id => support.supportStaffAction(a.ticket.id, { action: 'claim', version: r.ticket.version }, { NHAN_VIEN_ID: id, VAI_TRO: 'CSKH' })));
        assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    });
    test('customer can return an assigned conversation to the AI assistant', async () => {
        const a = await guest(), waiting = await send(a, 'gặp nhân viên');
        const claimed = await support.supportStaffAction(a.ticket.id, { action: 'claim', version: waiting.ticket.version }, { NHAN_VIEN_ID: 'NV_AI_RETURN', TEN: 'Nhân viên test', VAI_TRO: 'CSKH' });
        assert.equal(claimed.mode, 'HUMAN');
        const returned = await support.cancelSupportHandoff(a.ticket.id, actor(a));
        assert.equal(returned.ticket.mode, 'AI');
        assert.equal(returned.ticket.assignedTo, null);
    });
    test('members start without contact form or OTP and only see their own orders', async () => {
        const access = await import('../services/order-access.service.js');
        const member = { KHACH_HANG_ID: 'KH_MEMBER', TEN: 'Thành viên', SDT: '0912345678', TRANG_THAI: 'Hoạt động' };
        await (await mongo.getCollection<any>('KHACH_HANG')).insertOne(member);
        const grant = await access.createCustomerOrderAccess(member), auth = { orderToken: grant.accessToken };
        const a = await support.startSupport({}, auth);
        await (await mongo.getCollection<any>('DON_HANG')).insertMany([
            { DON_HANG_ID: 'YEN_MINE', KHACH_HANG_ID: member.KHACH_HANG_ID, TONG_TIEN: 300000 },
            { DON_HANG_ID: 'YEN_OTHER', KHACH_HANG_ID: 'KH_OTHER', TONG_TIEN: 900000 },
        ]);
        const orders = await support.supportOrders(a.ticket.id, auth);
        assert.deepEqual(orders.orders.map(o => o.DON_HANG_ID), ['YEN_MINE']);
        const r = await support.sendSupport(a.ticket.id, { chatInput: 'đơn của tôi giao chưa?', messageId: randomUUID() }, auth);
        assert.ok('authRequired' in r && r.authRequired === false);
        assert.ok('orderData' in r && r.orderData.orders.length === 1);
        assert.ok(!JSON.stringify(r.messages).includes('YEN_MINE'));
        await assert.rejects(support.readSupport(a.ticket.id, {}));
    });
    test('verified guest order access remains scoped to OTP phone', async () => {
        const a = await guest();
        const token = `oa_${randomBytes(32).toString('hex')}`;
        await (await mongo.getCollection<any>('XAC_THUC_TRA_CUU_DON')).insertOne({ _id: createHash('sha256').update(token).digest('hex'), kind: 'lookup', phone: '0901234567', expiresAt: new Date(Date.now() + 60000) });
        await (await mongo.getCollection<any>('DON_HANG')).insertMany([
            { DON_HANG_ID: 'YEN_GUEST', SDT_NGUOI_DAT: '0901234567' },
            { DON_HANG_ID: 'YEN_FOREIGN', SDT_NGUOI_DAT: '0999999999' },
        ]);
        const r = await support.supportOrders(a.ticket.id, { ...actor(a), orderToken: token });
        assert.deepEqual(r.orders.map(o => o.DON_HANG_ID), ['YEN_GUEST']);
    });
    test('dry run leaves no ticket, message or notification records', async () => {
        const counts = async () => Promise.all(['YEU_CAU_HO_TRO', 'TIN_NHAN_CHAT', 'THONG_BAO'].map(async (c) => (await mongo.getCollection<any>(c)).countDocuments()));
        const before = await counts();
        await brain.planChatReply({ chatInput: 'gặp nhân viên' });
        assert.deepEqual(await counts(), before);
    });
    test('staff takeover prevents a delayed AI reply from being written', async () => {
        const axios = createRequire(`${process.cwd()}/package.json`)('axios');
        const original = axios.post;
        let release!: (value: any) => void, entered!: () => void;
        const called = new Promise<void>(resolve => { entered = resolve; });
        axios.post = (async () => { entered(); return new Promise(resolve => { release = resolve; }); }) as typeof axios.post;
        process.env.GROQ_API_KEY = 'test-only-mocked';
        try {
            const a = await guest(), pending = send(a, 'Shop có nhận gói quà kèm thiệp viết tay không?');
            await Promise.race([called, new Promise((_, reject) => setTimeout(() => reject(new Error('Mock AI was not called')), 2000))]);
            const current = await support.readSupport(a.ticket.id, actor(a));
            await support.supportStaffAction(a.ticket.id, { action: 'claim', version: current.ticket.version }, employee);
            release({ data: { choices: [{ message: { content: JSON.stringify({ intent: 'faq', faqIds: ['FAQ_OPEN'], productId: null }) } }] } });
            const r = await pending;
            assert.equal(r.ticket.mode, 'HUMAN');
            assert.equal(r.messages.length, 2);
            assert.equal(r.messages.at(-1)?.role, 'user');
        }
        finally {
            axios.post = original;
            process.env.GROQ_API_KEY = '';
        }
    });
    test('HTTP routes enforce persisted staff permissions and link contact forms to the inbox', async () => {
        const express = (await import('express')).default;
        const app = express();
        app.use(express.json());
        app.use('/api/support', (await import('../routes/support.js')).default);
        app.use('/api/contacts', (await import('../routes/contact.js')).default);
        app.use('/api/faqs', (await import('../routes/faq.js')).default);
        await (await mongo.getCollection<any>('NHAN_VIEN')).insertMany([employee, { NHAN_VIEN_ID: 'NV_VIEW', HO_TEN: 'Sales', VAI_TRO: 'Sales', TRANG_THAI: 'Hoạt động' }]);
        const server = app.listen(0, '127.0.0.1');
        await new Promise<void>(resolve => server.once('listening', resolve));
        const port = (server.address() as {
            port: number;
        }).port;
        const request = (path: string, method = 'GET', body?: any, headers: any = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
        try {
            assert.equal((await request('/api/support/admin/tickets', 'GET', undefined, { 'x-admin-role': 'Admin' })).status, 403);
            assert.equal((await request('/api/support/admin/test', 'POST', { chatInput: 'test' }, { 'x-admin-id': 'NV_VIEW' })).status, 403);
            const staff = { 'x-admin-id': employee.NHAN_VIEN_ID };
            assert.equal((await request('/api/support/admin/test', 'POST', { chatInput: 'gặp nhân viên' }, staff)).status, 200);
            const form = await request('/api/contacts', 'POST', { fullName: 'Khách từ form', phoneOrEmail: 'form@example.com', subject: 'Hỗ trợ', message: 'Xin tư vấn' });
            assert.equal(form.status, 201);
            const data: any = await form.json();
            const ticket = await support.readSupport(data.support.ticket.id, actor(data.support));
            assert.equal(ticket.ticket.source, 'Form');
            assert.equal(ticket.ticket.mode, 'WAITING');
            assert.ok(ticket.messages.some(m => m.text.includes('Xin tư vấn')));
            assert.equal((await request('/api/contacts')).status, 403);
            const inbox = await request('/api/support/admin/tickets', 'GET', undefined, staff);
            assert.equal(inbox.status, 200);
            const payload: any = await inbox.json();
            assert.ok(payload.tickets.some((t: any) => t.id === ticket.ticket.id));
            const faq = { question: 'Câu hỏi mới cho test?', answer: 'Trả lời đã duyệt', category: 'Khác' };
            assert.equal((await request('/api/faqs', 'POST', faq)).status, 403);
            const created = await request('/api/faqs', 'POST', faq, staff);
            assert.equal(created.status, 201);
            assert.equal((await created.json() as any).faq.TRANG_THAI, 'Bị khóa');
            assert.equal((await request('/api/faqs', 'POST', { ...faq, question: '  CÂU HỎI MỚI CHO TEST?  ' }, staff)).status, 409);
        }
        finally {
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
    test('support tickets store only standard names and code still reads legacy names', async () => {
        const r: any = await guest();
        const raw = (await mongo.getDb()).collection<any>('YEU_CAU_HO_TRO');
        const row = await raw.findOne({ _id: r.ticket.id });
        assert.ok(row.SDT);
        assert.ok(row.MA_BAM_KHACH_VANG_LAI);
        assert.ok(row.TRANG_THAI);
        assert.equal(row.phone, undefined);
        assert.equal(row.guestHash, undefined);
        assert.equal(row.status, undefined);
        await send(r, 'Cửa hàng mở cửa lúc mấy giờ?');
        const updated = await raw.findOne({ _id: r.ticket.id });
        assert.ok(updated.PHIEN_BAN > 0);
        assert.equal(updated.version, undefined);
        assert.ok(updated.SO_TIN_NHAN > 0);
        assert.equal(updated.messageCount, undefined);
        assert.equal(updated.busyUntil, undefined);
        assert.equal(updated.KHOA_XU_LY_DEN, undefined);
        const wrapped = await mongo.getCollection<any>('YEU_CAU_HO_TRO');
        const read = await wrapped.findOne({ _id: r.ticket.id, status: updated.TRANG_THAI });
        assert.equal(read.guestHash, row.MA_BAM_KHACH_VANG_LAI);
        assert.equal(read.MA_BAM_KHACH_VANG_LAI, undefined);
        assert.equal(read.SDT, undefined);
        const [listed] = await wrapped.find({ _id: r.ticket.id }).toArray();
        assert.equal(listed.phone, row.SDT);
        assert.equal(listed.TEN, undefined);
    });
    test('wave 2 tables filter, sort and project by standard names', async () => {
        const db = await mongo.getDb();
        const tickets = db.collection<any>('YEU_CAU_HO_TRO'), images = db.collection<any>('YEU_CAU_TAO_ANH'), designs = db.collection<any>('THIET_KE_3D');
        await tickets.insertMany([
            { _id: 'W2-A', status: 'OLD', TRANG_THAI: 'W2-NEW', name: 'old', TEN: 'A', updatedAt: new Date(2000), NGAY_CAP_NHAT: new Date(1000), ratings: [], DS_DANH_GIA: [{ round: 7 }] },
            { _id: 'W2-B', status: 'OLD', TRANG_THAI: 'W2-NEW', name: 'old', TEN: 'B', updatedAt: new Date(1000), NGAY_CAP_NHAT: new Date(2000), ratings: [{ round: 7 }], DS_DANH_GIA: [] },
        ]);
        await images.insertOne({ _id: 'W2-IMG', COLOR: 'old', MAU_SAC: 'Đỏ', OCCASION: 'old', DIP: 'Sinh nhật' });
        await designs.insertOne({ _id: 'W2-DESIGN', name: 'old', TEN: 'Bó mới', image: 'old', HINH_ANH: 'new-image' });
        const wrapped = await mongo.getCollection<any>('YEU_CAU_HO_TRO');
        assert.equal(await wrapped.countDocuments({ status: 'OLD' }), 0);
        const first = await wrapped.findOne({ status: 'W2-NEW' }, { sort: { updatedAt: -1 } });
        assert.equal(first._id, 'W2-B');
        assert.equal(first.name, 'B');
        assert.equal(first.TEN, undefined);
        const rated = await wrapped.find({ 'ratings.round': 7 }).project({ name: 1 }).toArray();
        assert.deepEqual(rated, [{ _id: 'W2-A', name: 'A' }]);
        const image = await (await mongo.getCollection<any>('YEU_CAU_TAO_ANH')).findOne({ COLOR: 'Đỏ' });
        assert.equal(image.OCCASION, 'Sinh nhật');
        assert.equal(image.MAU_SAC, undefined);
        const design = await (await mongo.getCollection<any>('THIET_KE_3D')).findOne({ _id: 'W2-DESIGN' });
        assert.equal(design.name, 'Bó mới');
        assert.equal(design.image, 'new-image');
        await Promise.all([tickets.deleteMany({ _id: { $in: ['W2-A', 'W2-B'] } }), images.deleteOne({ _id: 'W2-IMG' }), designs.deleteOne({ _id: 'W2-DESIGN' })]);
    });
    test('wave 3 stores counters and admin sessions only by standard names', async () => {
        const { nextCode } = await import('../services/inventory/helpers.js');
        const db = await mongo.getDb();
        await db.collection<any>('W3_TEST').insertOne({ _id: 'W30007', W3_ID: 'W30007' });
        assert.equal(await nextCode('W3_TEST', 'W3_ID', 'W3', 4), 'W30008');
        assert.equal(await nextCode('W3_TEST', 'W3_ID', 'W3', 4), 'W30009');
        const counter = await db.collection<any>('BO_DEM_MA').findOne({ _id: 'W3_TEST:W3' });
        assert.equal(counter.value, undefined);
        assert.equal(counter.GIA_TRI, 9);
        assert.ok(counter.NGAY_TAO instanceof Date);
        assert.equal(counter.createdAt, undefined);
        const wrappedCounter = await (await mongo.getCollection<any>('BO_DEM_MA')).findOne({ _id: 'W3_TEST:W3' });
        assert.equal(wrappedCounter.value, 9);
        assert.equal(wrappedCounter.GIA_TRI, undefined);
        const sessions = await mongo.getCollection<any>('PHIEN_DANG_NHAP_ADMIN');
        const expiresAt = new Date(Date.now() + 60000);
        await sessions.insertOne({ _id: 'W3-SESSION', employeeId: 'NV_W3', expiresAt });
        const raw = await db.collection<any>('PHIEN_DANG_NHAP_ADMIN').findOne({ _id: 'W3-SESSION' as any });
        assert.equal(raw.NHAN_VIEN_ID, 'NV_W3');
        assert.equal(raw.HET_HAN.getTime(), expiresAt.getTime());
        assert.equal(raw.employeeId, undefined);
        assert.equal(raw.expiresAt, undefined);
        const row = await sessions.findOne({ _id: 'W3-SESSION', expiresAt: { $gt: new Date() } });
        assert.equal(row.employeeId, 'NV_W3');
        assert.equal(row.NHAN_VIEN_ID, undefined);
        assert.equal((await sessions.deleteMany({ employeeId: 'NV_W3' })).deletedCount, 1);
        await Promise.all([db.collection('W3_TEST').drop(), db.collection<any>('BO_DEM_MA').deleteOne({ _id: 'W3_TEST:W3' })]);
    });
    test('wave 3 reads counters and admin sessions by standard names', async () => {
        const { nextCode } = await import('../services/inventory/helpers.js');
        const db = await mongo.getDb();
        await db.collection<any>('BO_DEM_MA').insertOne({ _id: 'W3R_TEST:WR', value: 1, GIA_TRI: 20 });
        assert.equal(await nextCode('W3R_TEST', 'W3R_ID', 'WR', 4), 'WR0021');
        const counter = await db.collection<any>('BO_DEM_MA').findOne({ _id: 'W3R_TEST:WR' });
        assert.equal(counter.GIA_TRI, 21);
        const now = Date.now();
        await db.collection<any>('PHIEN_DANG_NHAP_ADMIN').insertMany([
            { _id: 'W3R-LIVE', employeeId: 'OLD', NHAN_VIEN_ID: 'NV_W3R', expiresAt: new Date(now - 60000), HET_HAN: new Date(now + 60000) },
            { _id: 'W3R-EXPIRED', employeeId: 'NV_W3R', NHAN_VIEN_ID: 'NV_OTHER', expiresAt: new Date(now + 60000), HET_HAN: new Date(now - 60000) },
        ] as any[]);
        const sessions = await mongo.getCollection<any>('PHIEN_DANG_NHAP_ADMIN');
        const live = await sessions.findOne({ _id: 'W3R-LIVE', expiresAt: { $gt: new Date() } });
        assert.equal(live.employeeId, 'NV_W3R');
        assert.equal(live.NHAN_VIEN_ID, undefined);
        assert.equal(await sessions.findOne({ _id: 'W3R-EXPIRED', expiresAt: { $gt: new Date() } }), null);
        assert.equal((await sessions.deleteMany({ employeeId: 'NV_W3R' })).deletedCount, 1);
        assert.ok(await db.collection<any>('PHIEN_DANG_NHAP_ADMIN').findOne({ _id: 'W3R-EXPIRED' as any }));
        await Promise.all([db.collection<any>('BO_DEM_MA').deleteOne({ _id: 'W3R_TEST:WR' }), db.collection<any>('PHIEN_DANG_NHAP_ADMIN').deleteOne({ _id: 'W3R-EXPIRED' as any })]);
    });
    test('wave 5 mirrors customer birth date and avatar, including pipeline updates', async () => {
        const raw = (await mongo.getDb()).collection<any>('KHACH_HANG');
        const customers = await mongo.getCollection<any>('KHACH_HANG');
        const dob = new Date('2000-01-02T00:00:00Z');
        await customers.insertOne({ _id: 'W5-CUSTOMER', KHACH_HANG_ID: 'W5-CUSTOMER', DOB: dob, AVATAR: null, DIEM_TICH_LUY: 1 });
        let row = await raw.findOne({ _id: 'W5-CUSTOMER' });
        assert.equal(row.NGAY_SINH.getTime(), dob.getTime());
        assert.equal(row.ANH_DAI_DIEN, null);
        const updated = await customers.findOneAndUpdate({ _id: 'W5-CUSTOMER' }, { $set: { AVATAR: '/avatar.png' } }, { returnDocument: 'after' });
        assert.equal(updated.AVATAR, '/avatar.png');
        assert.equal(updated.ANH_DAI_DIEN, undefined);
        assert.equal(updated.NGAY_SINH, undefined);
        assert.equal((await raw.findOne({ _id: 'W5-CUSTOMER' })).ANH_DAI_DIEN, '/avatar.png');
        await customers.updateOne({ _id: 'W5-CUSTOMER' }, [{ $set: { DIEM_TICH_LUY: { $add: ['$DIEM_TICH_LUY', 1] } } }]);
        row = await raw.findOne({ _id: 'W5-CUSTOMER' });
        assert.equal(row.DIEM_TICH_LUY, 2);
        assert.equal(row.ANH_DAI_DIEN, '/avatar.png');
        await customers.updateOne({ _id: 'W5-CUSTOMER' }, [{ $set: { AVATAR: '/next.png' } }]);
        assert.equal((await raw.findOne({ _id: 'W5-CUSTOMER' })).ANH_DAI_DIEN, '/next.png');
        await customers.updateOne({ _id: 'W5-CUSTOMER' }, [{ $unset: 'AVATAR' }]);
        row = await raw.findOne({ _id: 'W5-CUSTOMER' });
        assert.equal('AVATAR' in row, false);
        assert.equal('ANH_DAI_DIEN' in row, false);
        await raw.deleteOne({ _id: 'W5-CUSTOMER' });
    });
    test('wave 5 reads customer birth date and avatar by standard names', async () => {
        const raw = (await mongo.getDb()).collection<any>('KHACH_HANG');
        const customers = await mongo.getCollection<any>('KHACH_HANG');
        const oldDate = new Date('1990-01-01T00:00:00Z'), newDate = new Date('2001-02-03T00:00:00Z');
        await raw.insertOne({ _id: 'W5R-CUSTOMER', KHACH_HANG_ID: 'W5R-CUSTOMER', DOB: oldDate, NGAY_SINH: newDate, AVATAR: '/old.png', ANH_DAI_DIEN: '/new.png', TEN: 'W5R' });
        assert.equal(await customers.countDocuments({ _id: 'W5R-CUSTOMER', AVATAR: '/old.png' }), 0);
        const row = await customers.findOne({ _id: 'W5R-CUSTOMER', AVATAR: '/new.png' });
        assert.equal(row.DOB.getTime(), newDate.getTime());
        assert.equal(row.AVATAR, '/new.png');
        assert.equal(row.NGAY_SINH, undefined);
        assert.equal(row.ANH_DAI_DIEN, undefined);
        const [picked] = await customers.find({ _id: 'W5R-CUSTOMER' }).project({ AVATAR: 1, DOB: 1 }).toArray();
        assert.deepEqual(picked, { _id: 'W5R-CUSTOMER', AVATAR: '/new.png', DOB: newDate });
        const hidden = await customers.findOne({ _id: 'W5R-CUSTOMER' }, { projection: { AVATAR: 0 } });
        assert.equal(hidden.AVATAR, undefined);
        assert.equal(hidden.ANH_DAI_DIEN, undefined);
        const [hiddenRow] = await customers.find({ _id: 'W5R-CUSTOMER' }).project({ DOB: 0 }).toArray();
        assert.equal(hiddenRow.DOB, undefined);
        assert.equal(hiddenRow.AVATAR, '/new.png');
        await raw.deleteOne({ _id: 'W5R-CUSTOMER' });
    });
    test('wave 7 stores order workflow writes only by standard names, including bulk OTP buckets and refund upserts', async () => {
        const db = await mongo.getDb();
        const access = await mongo.getCollection<any>('XAC_THUC_TRA_CUU_DON'), rawAccess = db.collection<any>('XAC_THUC_TRA_CUU_DON');
        const now = new Date(), expiresAt = new Date(now.getTime() + 60000);
        const rate = { updateOne: { filter: { _id: 'W7-RATE' }, update: [{ $set: { kind: 'rate', windowAt: now, count: { $add: [{ $ifNull: ['$count', 0] }, 1] }, lastSentAt: now, expiresAt } }], upsert: true } };
        await access.bulkWrite([rate, rate, { insertOne: { document: { _id: 'W7-OTP', kind: 'otp', phone: '0900000007', consumed: false, codeHash: 'hash', expiresAt } } },
            { updateMany: { filter: { _id: 'W7-OTP', consumed: false }, update: { $set: { consumed: true } } } }] as any, { ordered: true });
        const bucket = await rawAccess.findOne({ _id: 'W7-RATE' });
        assert.equal(bucket.count, undefined);
        assert.equal(bucket.SO_LUONG, 2);
        assert.equal(bucket.PHAN_LOAI, 'rate');
        const otp = await rawAccess.findOne({ _id: 'W7-OTP' });
        assert.equal(otp.DA_SU_DUNG, true);
        assert.equal(otp.MA_BAM_OTP, 'hash');
        const read = await access.findOne({ _id: 'W7-OTP', consumed: true });
        assert.equal(read.codeHash, 'hash');
        assert.equal(read.MA_BAM_OTP, undefined);
        const ledger = await mongo.getCollection<any>('HOAN_TIEN'), rawLedger = db.collection<any>('HOAN_TIEN');
        await ledger.updateOne({ requestId: 'W7-CASE' }, { $setOnInsert: { _id: 'RF:W7-CASE', requestId: 'W7-CASE', orderId: 'W7-ORDER', amount: 50000, refundedAmount: 0, status: 'Pending', history: [] } }, { upsert: true });
        await ledger.updateOne({ requestId: 'W7-CASE', status: 'Pending', refundedAmount: 0 }, { $set: { refundedAmount: 50000, status: 'Succeeded' }, $push: { history: { action: 'refund' } } } as any);
        const refund = await rawLedger.findOne({ _id: 'RF:W7-CASE' as any });
        assert.equal(refund.YEU_CAU_ID, 'W7-CASE');
        assert.equal(refund.SO_TIEN, 50000);
        assert.equal(refund.SO_TIEN_DA_HOAN, 50000);
        assert.equal(refund.TRANG_THAI, 'Succeeded');
        assert.equal(refund.LICH_SU.length, 1);
        assert.equal(refund.history, undefined);
        assert.equal(refund.requestId, undefined);
        const cases = await mongo.getCollection<any>('YEU_CAU_HAU_MAI'), rawCases = db.collection<any>('YEU_CAU_HAU_MAI');
        await cases.insertOne({ _id: 'W7-CASE', requestId: 'W7-CASE', orderId: 'W7-ORDER', type: 'refund', status: 'Chờ tiếp nhận', active: true, version: 0, sla: { claimBy: now }, history: [] });
        await cases.updateOne({ _id: 'W7-CASE', version: 0 }, { $set: { 'sla.decideBy': expiresAt, status: 'Đang xem xét' }, $inc: { version: 1 } });
        const row = await rawCases.findOne({ _id: 'W7-CASE' as any });
        assert.equal(row.PHIEN_BAN, 1);
        assert.equal(row.TRANG_THAI, 'Đang xem xét');
        assert.equal(row.THOI_HAN_XU_LY.decideBy.getTime(), expiresAt.getTime());
        assert.equal(row.status, undefined);
        assert.equal(row.sla, undefined);
        const [listed] = await cases.find({ _id: 'W7-CASE', active: true }).toArray();
        assert.equal(listed.status, 'Đang xem xét');
        assert.equal(listed.TRANG_THAI, undefined);
        await Promise.all([rawAccess.deleteMany({ _id: { $in: ['W7-RATE', 'W7-OTP'] } } as any), rawLedger.deleteOne({ _id: 'RF:W7-CASE' as any }), rawCases.deleteOne({ _id: 'W7-CASE' as any })]);
    });
    test('wave 7 reads order workflow tables by standard names, including realtime scope', async () => {
        const db = await mongo.getDb();
        const rawRequests = db.collection<any>('YEU_CAU_DAT_HANG'), requests = await mongo.getCollection<any>('YEU_CAU_DAT_HANG');
        await rawRequests.insertOne({ _id: 'W7R-REQ', requestId: 'W7R-REQ', YEU_CAU_ID: 'W7R-REQ', status: 'old', TRANG_THAI: 'new', customerId: 'W7R-OLD', KHACH_HANG_ID: 'W7R-NEW', tokenHash: 'secret', MA_BAM_TOKEN: 'secret', sender: { phone: '0900000000' }, NGUOI_GUI: { phone: '0900000077' } });
        assert.equal(await requests.countDocuments({ _id: 'W7R-REQ', status: 'old' }), 0);
        const row = await requests.findOne({ _id: 'W7R-REQ', status: 'new', 'sender.phone': '0900000077' }, { projection: { tokenHash: 0 } });
        assert.equal(row.status, 'new');
        assert.equal(row.customerId, 'W7R-NEW');
        assert.equal(row.sender.phone, '0900000077');
        assert.equal(row.TRANG_THAI, undefined);
        assert.equal(row.tokenHash, undefined);
        assert.equal(row.MA_BAM_TOKEN, undefined);
        const stream = requests.watch([{ $match: { operationType: { $in: ['insert', 'update'] }, $and: [{ 'fullDocument.customerId': 'W7R-NEW' }, { 'documentKey._id': 'W7R-REQ' }] } }], { fullDocument: 'updateLookup', maxAwaitTimeMS: 200 });
        try {
            await stream.tryNext();
            await rawRequests.updateOne({ _id: 'W7R-REQ' as any }, { $set: { TRANG_THAI: 'changed' } });
            let change: any = null;
            for (let attempt = 0; attempt < 25 && !change; attempt++) change = await stream.tryNext();
            assert.equal(change?.documentKey?._id, 'W7R-REQ');
        } finally { await stream.close(); }
        const rawLedger = db.collection<any>('HOAN_TIEN'), ledger = await mongo.getCollection<any>('HOAN_TIEN');
        await rawLedger.insertOne({ _id: 'W7R-RF', requestId: 'W7R-OTHER', YEU_CAU_ID: 'W7R-OTHER', orderId: 'W7R-ORDER', DON_HANG_ID: 'W7R-ORDER', amount: 1, SO_TIEN: 70000, status: 'Pending', TRANG_THAI: 'Pending' });
        const [sum] = await ledger.aggregate([{ $match: { orderId: 'W7R-ORDER', status: { $in: ['Pending'] }, requestId: { $ne: 'W7R-REQ' } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]).toArray();
        assert.equal(sum.total, 70000);
        const access = await mongo.getCollection<any>('XAC_THUC_TRA_CUU_DON'), rawAccess = db.collection<any>('XAC_THUC_TRA_CUU_DON');
        const now = new Date(), rate = () => ({ updateOne: { filter: { _id: 'W7R-RATE', $or: [{ count: { $lt: 2 } }, { count: { $exists: false } }] }, update: [{ $set: { kind: 'rate', count: { $add: [{ $ifNull: ['$count', 0] }, 1] }, windowAt: now } }], upsert: true } });
        await access.bulkWrite([rate()] as any);
        await access.bulkWrite([rate()] as any);
        await assert.rejects(access.bulkWrite([rate()] as any), (error: any) => error?.code === 11000);
        const bucket = await rawAccess.findOne({ _id: 'W7R-RATE' as any });
        assert.equal(bucket.count, undefined);
        assert.equal(bucket.SO_LUONG, 2);
        await Promise.all([rawRequests.deleteOne({ _id: 'W7R-REQ' as any }), rawLedger.deleteOne({ _id: 'W7R-RF' as any }), rawAccess.deleteOne({ _id: 'W7R-RATE' as any })]);
    });
    test('startup indexes use standard field names and keep one open after-sales case per order', async () => {
        const db = await mongo.getDb();
        const { ensureOrderAccessIndexes } = await import('../services/order-access.service.js');
        const { ensureSupportIndexes } = await import('../services/support.service.js');
        const { ensureSalesRequestIndexes } = await import('../services/sales-proposal.service.js');
        for (let round = 0; round < 2; round++) { await ensureOrderAccessIndexes(); await ensureSupportIndexes(); await ensureSalesRequestIndexes(); }
        const indexOf = async (table: string, name: string) => (await db.collection(table).indexes()).find((index) => index.name === name) as any;
        assert.deepEqual((await indexOf('XAC_THUC_TRA_CUU_DON', 'std_het_han_ttl')).key, { HET_HAN: 1 });
        assert.equal((await indexOf('XAC_THUC_TRA_CUU_DON', 'std_het_han_ttl')).expireAfterSeconds, 0);
        assert.deepEqual((await indexOf('YEU_CAU_HO_TRO', 'std_khach_ngay_cap_nhat')).key, { KHACH_HANG_ID: 1, NGAY_CAP_NHAT: -1 });
        assert.deepEqual((await indexOf('YEU_CAU_DAT_HANG', 'std_sales_queue_trang_thai_ngay_tao')).key, { TRANG_THAI: 1, NGAY_TAO: -1 });
        assert.deepEqual((await indexOf('YEU_CAU_HAU_MAI', 'std_hau_mai_don_ngay_tao')).key, { DON_HANG_ID: 1, NGAY_TAO: -1 });
        const unique = await indexOf('YEU_CAU_HAU_MAI', 'std_hau_mai_mot_ho_so_mo');
        assert.equal(unique.unique, true);
        assert.deepEqual(unique.partialFilterExpression, { DANG_HOAT_DONG: true });
        const cases = await mongo.getCollection<any>('YEU_CAU_HAU_MAI');
        await cases.insertOne({ _id: 'IDX-A', orderId: 'IDX-ORDER', active: true, createdAt: new Date() });
        await assert.rejects(cases.insertOne({ _id: 'IDX-B', orderId: 'IDX-ORDER', active: true, createdAt: new Date() }), (error: any) => error?.code === 11000);
        await cases.updateOne({ _id: 'IDX-A' }, { $set: { active: false } });
        await cases.insertOne({ _id: 'IDX-B', orderId: 'IDX-ORDER', active: true, createdAt: new Date() });
        await cases.deleteMany({ _id: { $in: ['IDX-A', 'IDX-B'] } });
    });
}
