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
            { CAU_HOI_ID: 'FAQ_LOCKED', CAU_HOI: 'Mật khẩu bí mật là gì?', CAU_TRA_LOI: 'LOCKED_SECRET', TRANG_THAI: 'Bị khóa' },
        ]);
        await (await mongo.getCollection<any>('SAN_PHAM')).insertOne({ SAN_PHAM_ID: 'SP123', TEN_SAN_PHAM: 'Bó hoa test', GIA: 300000, TON_THANH_PHAM: 2, TP_DANG_GIU: 1 });
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
    test('anger escalates immediately; waiting mode suppresses AI; retries do not duplicate', async () => {
        assert.equal(brain.needsImmediateHandoff('người yêu đang giận nên mua hoa gì?'), false);
        const a = await guest();
        const messageId = randomUUID();
        const r = await send(a, 'Tôi rất bức xúc vì shop giao sai', { messageId });
        assert.equal(r.ticket.mode, 'WAITING');
        assert.equal(r.ticket.priority, 'urgent');
        const retry = await support.sendSupport(a.ticket.id, { chatInput: 'Tôi rất bức xúc vì shop giao sai', messageId }, actor(a));
        assert.equal(retry.messages.length, r.messages.length);
        const next = await send(a, 'Cửa hàng mở cửa lúc mấy giờ?');
        assert.equal(next.messages.length, r.messages.length + 1);
        assert.equal(next.messages.at(-1)?.role, 'user');
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
            const a = await guest(), pending = send(a, 'Cửa hàng mở cửa lúc mấy giờ?');
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
}
