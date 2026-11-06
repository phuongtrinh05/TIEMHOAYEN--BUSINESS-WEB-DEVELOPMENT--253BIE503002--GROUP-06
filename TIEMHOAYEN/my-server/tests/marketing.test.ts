import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const uri = process.env.TEST_MONGO_URI;
if (!uri) test('marketing requires isolated local MongoDB', { skip: true }, () => {});
else {
  if (!/^mongodb:\/\/127\.0\.0\.1:/.test(uri)) throw new Error('Local test database required');
  process.env.MONGO_URI = uri;
  process.env.MONGO_DATABASE = 'TIEM_HOA_YEN_MARKETING_TEST_' + randomUUID().replaceAll('-', '');
  delete process.env.APPS_SCRIPT_MARKETING_URL;
  delete process.env.APPS_SCRIPT_MARKETING_SECRET;
  let mongo: typeof import('../mongo.js'), m: typeof import('../services/marketing.service.js'), server: any, base: string;
  const staff = { 'x-admin-id': 'NV_MKT' };
  let memberToken = '';
  const request = async (path: string, method = 'GET', body?: any, headers: any = staff) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() as any };
  };
  const customer = (id: string, allowed = true) => ({ _id: id, KHACH_HANG_ID: id, TEN: 'Khách ' + id, EMAIL: id + '@example.com', DOB: new Date('2000-11-01T00:00:00Z'), LOAI_THANH_VIEN: 'Đồng', TRANG_THAI: 'Hoạt động', DONG_Y_NHAN_QUANG_CAO: allowed });
  const template = (id: string, extra: any = {}) => ({ _id: id, MAU_ID: id, TEN_MAU: 'Mẫu ' + id, MUC_DICH: 'Quảng cáo', KENH_GUI: 'website', TIEU_DE: 'Chào {{ten_khach}}', NOI_DUNG: 'Hoa mới cho {{ten_khach}}', TRANG_THAI: 'Đang bật', PHIEN_BAN: 1, ...extra });
  const config = (id: string, templateId: string, extra: any = {}) => ({ _id: id, CAU_HINH_ID: id, MAU_ID: templateId, TEN_CAU_HINH: id, SU_KIEN_KICH_HOAT: 'schedule', THOI_DIEM_GUI: new Date(Date.now() - 60000), TRANG_THAI: 'Đang bật', BAT_DAU_AP_DUNG: new Date(Date.now() - 3600000), PHIEN_BAN: 1, DO_TRE_PHUT: 0, ...extra });
  const col = (n: string) => mongo.getCollection<any>(n);
  before(async () => {
    mongo = await import('../mongo.js'); m = await import('../services/marketing.service.js');
    await m.ensureMarketingIndexes();
    await (await col('NHAN_VIEN')).insertMany([{ NHAN_VIEN_ID: 'NV_MKT', VAI_TRO: 'Admin', EMAIL: 'staff@example.com' }, { NHAN_VIEN_ID: 'NV_VIEW', VAI_TRO: 'Nhân viên bán hàng' }]);
    await (await col('KHACH_HANG')).insertMany([customer('C1'), customer('C2', false), customer('C3')]);
    memberToken = (await (await import('../services/order-access.service.js')).createCustomerOrderAccess(customer('C1'))).accessToken;
    const express = (await import('express')).default, app = express(); app.use(express.json()); app.use('/marketing', express.urlencoded({ extended: false }), (await import('../routes/marketing.js')).default); app.use('/notifications', (await import('../routes/notification.js')).default);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); base = 'http://127.0.0.1:' + server.address().port;
  });
  after(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(r => server.close(r)); await (await mongo.getDb()).dropDatabase(); await (await mongo.getMongoClient()).close(); });
  test('template validation, supported variables, no email subject and malformed placeholders', () => {
    assert.throws(() => m.normalizeTemplate({ TEN_MAU: 'A', MUC_DICH: 'Quảng cáo', KENH_GUI: 'email', NOI_DUNG: 'A' }));
    assert.throws(() => m.normalizeTemplate({ ...template('X'), NOI_DUNG: '{{password}}' }));
    assert.throws(() => m.normalizeTemplate({ ...template('X'), NOI_DUNG: '{{ten_khach' }));
    assert.throws(() => m.render('{{ma_voucher}}', {}));
    assert.equal(m.render('Chào {{ ten_khach }}', { ten_khach: 'An' }), 'Chào An');
    assert.throws(() => m.normalizeConfig({ TEN_CAU_HINH: 'A', SU_KIEN_KICH_HOAT: 'annual', NGAY: 31, THANG: 2 }));
  });
  test('persisted permissions reject role spoofing; template edits use version checks', async () => {
    assert.equal((await request('/marketing/admin/templates', 'GET', undefined, { 'x-admin-role': 'Admin' })).status, 403);
    assert.equal((await request('/marketing/admin/templates', 'POST', template('BAD'), { 'x-admin-id': 'NV_VIEW', 'x-admin-role': 'Admin' })).status, 403);
    const r = await request('/marketing/admin/templates', 'POST', template('HTTP')); assert.equal(r.status, 201);
    assert.equal((await request('/marketing/admin/templates/' + r.data.MAU_ID, 'PUT', { ...r.data, PHIEN_BAN: 999 })).status, 409);
  });
  test('only opted-in active customers get scheduled messages; repeat scans and concurrent workers do not duplicate', async () => {
    const t = template('T1'), c = config('CFG1', 'T1');
    await (await col('MAU_TIN_NHAN')).insertOne(t); await (await col('CAU_HINH_GUI_TU_DONG')).insertOne(c);
    await m.scheduleMarketing(); await m.scheduleMarketing();
    assert.equal(await (await col('LICH_SU_GUI')).countDocuments({ CAU_HINH_ID: 'CFG1' }), 2);
    await Promise.all([m.deliverMarketing(), m.deliverMarketing()]);
    assert.equal(await (await col('THONG_BAO')).countDocuments({ GUI_ID: { $exists: true } }), 2);
    assert.equal(await (await col('LICH_SU_GUI')).countDocuments({ CAU_HINH_ID: 'CFG1', TRANG_THAI: 'Đã gửi' }), 2);
    assert.equal(await (await col('THONG_BAO')).countDocuments({ KHACH_HANG_ID: 'C2' }), 0);
  });
  test('opt-out and inactive status are rechecked after queuing, before dispatch', async () => {
    const t = template('T2'), c = config('CFG2', 'T2'); await (await col('MAU_TIN_NHAN')).insertOne(t); await (await col('CAU_HINH_GUI_TU_DONG')).insertOne(c);
    await m.enqueue(c, t, customer('C1'), 'event'); await m.consent('C1', false); await m.deliverMarketing();
    assert.equal((await (await col('LICH_SU_GUI')).findOne({ CAU_HINH_ID: c.CAU_HINH_ID }))?.TRANG_THAI, 'Đã hủy');
    await m.consent('C1', true);
  });
  test('voucher ownership, validity, campaign and used state checked; sending never consumes voucher', async () => {
    await (await col('VOUCHER')).insertOne({ VOUCHER_ID: 'V1', MA_VOUCHER: 'RIENG', KHACH_HANG_ID: 'C1', NGAY_KET_THUC: new Date(Date.now() + 86400000), DA_DUNG: false });
    const t = template('TV', { MUC_DICH: 'Voucher', NOI_DUNG: 'Mã {{ma_voucher}}' }), c = config('CV', 'TV', { VOUCHER_ID: 'V1' });
    await assert.rejects(m.context(c, t, customer('C3')));
    assert.equal((await m.context(c, t, customer('C1'))).text, 'Mã RIENG');
    assert.equal((await (await col('VOUCHER')).findOne({ VOUCHER_ID: 'V1' }))?.DA_DUNG, false);
    await (await col('VOUCHER')).updateOne({ VOUCHER_ID: 'V1' }, { $set: { DA_DUNG: true } }); await assert.rejects(m.context(c, t, customer('C1')));
  });
  test('personal voucher batches resolve the correct voucher and audit code for each customer', async () => {
    await (await col('VOUCHER')).insertMany([
      { VOUCHER_ID: 'VB1', MA_VOUCHER: 'TRIAN-001', MA_VOUCHER_GOC: 'TRIAN', NHOM_PHAT_HANH_ID: 'GRP1', KHACH_HANG_ID: 'C1', DA_DUNG: false },
      { VOUCHER_ID: 'VB2', MA_VOUCHER: 'TRIAN-002', MA_VOUCHER_GOC: 'TRIAN', NHOM_PHAT_HANH_ID: 'GRP1', KHACH_HANG_ID: 'C3', DA_DUNG: false },
    ]);
    const t = template('TVB', { MUC_DICH: 'Voucher', NOI_DUNG: 'Mã {{ma_voucher}}' });
    const c = config('CVB', 'TVB', { VOUCHER_ID: 'VB1' });
    assert.equal((await m.context(c, t, customer('C1'))).text, 'Mã TRIAN-001');
    assert.equal((await m.context(c, t, customer('C3'))).text, 'Mã TRIAN-002');
    await m.enqueue(c, t, customer('C3'), 'batch');
    const row = await (await col('LICH_SU_GUI')).findOne({ CAU_HINH_ID: 'CVB', KHACH_HANG_ID: 'C3' });
    assert.equal(row?.VOUCHER_ID_THUC_TE, 'VB2');
    assert.equal(row?.MA_VOUCHER_THUC_TE, 'TRIAN-002');
  });
  test('shared voucher usage is counted instead of globally disabled after the first order', async () => {
    const pricing = await import('../services/pricing-voucher.service.js');
    const voucher = { VOUCHER_ID: 'VSHARED', MA_VOUCHER: 'SHARED', GIOI_HAN_TONG: 2, GIOI_HAN_MOI_NGUOI: 1, LUOT_DA_DUNG: 0, DA_DUNG: false };
    await (await col('VOUCHER')).insertOne(voucher);
    await pricing.claimVoucherUsage(undefined as any, { voucher, identityKey: 'member:C1', perUserLimit: 1 }, 'ORDER-S1');
    await pricing.claimVoucherUsage(undefined as any, { voucher: { ...voucher, LUOT_DA_DUNG: 1 }, identityKey: 'member:C3', perUserLimit: 1 }, 'ORDER-S2');
    const stored = await (await col('VOUCHER')).findOne({ VOUCHER_ID: 'VSHARED' });
    assert.equal(stored?.LUOT_DA_DUNG, 2);
    assert.equal(stored?.DA_DUNG, false);
    await assert.rejects(pricing.claimVoucherUsage(undefined as any, { voucher: { ...voucher, LUOT_DA_DUNG: 2 }, identityKey: 'member:C2', perUserLimit: 1 }, 'ORDER-S3'));
  });
  test('reminders follow one-review-per-order, ignore estimated/old/refunded dates, recheck new reviews', async () => {
    const t = template('TR', { MUC_DICH: 'Nhắc đánh giá', NOI_DUNG: 'Đánh giá {{ma_don}}' }), c = config('CR', 'TR', { SU_KIEN_KICH_HOAT: 'order', BAT_DAU_AP_DUNG: new Date(Date.now() - 3600000) });
    await (await col('MAU_TIN_NHAN')).insertOne(t); await (await col('CAU_HINH_GUI_TU_DONG')).insertOne(c);
    await (await col('DON_HANG')).insertMany([
      { DON_HANG_ID: 'O1', KHACH_HANG_ID: 'C2', TRANG_THAI: 'Hoàn thành', NGAY_HOAN_THANH: new Date() },
      { DON_HANG_ID: 'O2', KHACH_HANG_ID: 'C2', TRANG_THAI: 'Hoàn thành', NGAY_HOAN_THANH: new Date(), NGAY_HOAN_THANH_UOC_TINH: true },
      { DON_HANG_ID: 'O3', KHACH_HANG_ID: 'C2', TRANG_THAI: 'Hoàn thành', NGAY_HOAN_THANH: new Date(Date.now() - 86400000) },
    ]);
    await m.scheduleMarketing(); assert.equal(await (await col('LICH_SU_GUI')).countDocuments({ CAU_HINH_ID: 'CR' }), 1);
    await (await col('DANH_GIA')).insertOne({ DON_HANG_ID: 'O1', SAN_PHAM_ID: 'ANY', KHACH_HANG_ID: null });
    await m.deliverMarketing(); assert.equal((await (await col('LICH_SU_GUI')).findOne({ CAU_HINH_ID: 'CR' }))?.TRANG_THAI, 'Đã hủy');
  });
  test('birthdays use Vietnam day and unique year/day event, missing DOB skipped', async () => {
    const t = template('TB', { MUC_DICH: 'Dịp đặc biệt' }), c = config('CB', 'TB', { SU_KIEN_KICH_HOAT: 'birthday' });
    await (await col('MAU_TIN_NHAN')).insertOne(t); await (await col('CAU_HINH_GUI_TU_DONG')).insertOne(c);
    await m.scheduleMarketing(new Date('2027-10-31T18:00:00Z')); await m.scheduleMarketing(new Date('2027-11-01T10:00:00Z'));
    assert.equal(await (await col('LICH_SU_GUI')).countDocuments({ CAU_HINH_ID: 'CB' }), 2);
    await m.scheduleMarketing(new Date('2028-11-01T01:00:00Z')); assert.equal(await (await col('LICH_SU_GUI')).countDocuments({ CAU_HINH_ID: 'CB' }), 4);
  });
  test('paused configurations cancel queued delivery and birthdays never send on the following day', async () => {
    const t = template('TP'), c = config('CP', 'TP'); await (await col('MAU_TIN_NHAN')).insertOne(t); await (await col('CAU_HINH_GUI_TU_DONG')).insertOne(c);
    await m.enqueue(c, t, customer('C1'), 'pause'); await (await col('CAU_HINH_GUI_TU_DONG')).updateOne({ CAU_HINH_ID: 'CP' }, { $set: { TRANG_THAI: 'Tạm dừng' } });
    await m.deliverMarketing(); assert.equal((await (await col('LICH_SU_GUI')).findOne({ CAU_HINH_ID: 'CP' }))?.TRANG_THAI, 'Đã hủy');
    await m.deliverMarketing(new Date('2029-11-02T01:00:00Z'));
    assert.equal(await (await col('LICH_SU_GUI')).countDocuments({ CAU_HINH_ID: 'CB', TRANG_THAI: 'Đã gửi' }), 0);
  });
  test('enable requires current preview and test; email missing credentials never pretends success', async () => {
    const t = await request('/marketing/admin/templates', 'POST', template('TENABLE'));
    const c = await request('/marketing/admin/configs', 'POST', { TEN_CAU_HINH: 'CENABLE', MAU_ID: t.data.MAU_ID, SU_KIEN_KICH_HOAT: 'schedule', THOI_DIEM_GUI: new Date(Date.now() + 86400000).toISOString() }); assert.equal(c.status, 201);
    const path = '/marketing/admin/configs/' + c.data.CAU_HINH_ID;
    assert.equal((await request(path + '/status', 'POST', { TRANG_THAI: 'Đang bật', PHIEN_BAN: 1 })).status, 400);
    assert.equal((await request(path + '/preview', 'POST', {})).status, 200);
    assert.equal((await request(path + '/test', 'POST', {})).status, 200);
    assert.equal((await request(path + '/status', 'POST', { TRANG_THAI: 'Đang bật', PHIEN_BAN: 1 })).status, 200);
    assert.equal(await (await col('THONG_BAO')).countDocuments({ LA_GUI_THU: true }), 0);
    await assert.rejects(m.sendEmail('staff@example.com', 'A', 'B', 'test'), /chưa được cấu hình/);
    await request('/marketing/admin/templates/' + t.data.MAU_ID, 'PUT', { ...t.data, NOI_DUNG: 'Đã sửa' });
    assert.equal((await request(path + '/status', 'POST', { TRANG_THAI: 'Đang bật', PHIEN_BAN: 1 })).status, 400);
  });
  test('preferences require the member session, not a submitted customer id; unsubscribe GET does not mutate', async () => {
    assert.equal((await request('/marketing/preferences', 'PUT', { allowed: true, customerId: 'C2' }, {})).status, 401);
    assert.equal((await request('/marketing/preferences', 'PUT', { allowed: true, customerId: 'C2' }, { 'x-order-access': memberToken })).status, 200);
    assert.equal((await (await col('KHACH_HANG')).findOne({ KHACH_HANG_ID: 'C2' }))?.DONG_Y_NHAN_QUANG_CAO, false);
    const token = await m.unsubscribeToken('C1');
    const r = await fetch(base + '/marketing/unsubscribe?token=' + token); assert.equal(r.status, 200);
    assert.equal((await (await col('KHACH_HANG')).findOne({ KHACH_HANG_ID: 'C1' }))?.DONG_Y_NHAN_QUANG_CAO, true);
    await m.unsubscribe(token); assert.equal((await (await col('KHACH_HANG')).findOne({ KHACH_HANG_ID: 'C1' }))?.DONG_Y_NHAN_QUANG_CAO, false); await m.consent('C1', true);
  });
  test('first-login prompt distinguishes unanswered from explicit refusal and persists the choice across sessions', async () => {
    const c: any = customer('NEW'); delete c.DONG_Y_NHAN_QUANG_CAO;
    await (await col('KHACH_HANG')).insertOne(c);
    const auth = await import('../services/order-access.service.js');
    const token = (await auth.createCustomerOrderAccess(c)).accessToken;
    const headers = { 'x-order-access': token };
    assert.deepEqual((await request('/marketing/preferences', 'GET', undefined, headers)).data, { allowed: false, answered: false });
    await request('/marketing/preferences', 'PUT', { allowed: false }, headers);
    const nextToken = (await auth.createCustomerOrderAccess(c)).accessToken;
    assert.deepEqual((await request('/marketing/preferences', 'GET', undefined, { 'x-order-access': nextToken })).data, { allowed: false, answered: true });
    await request('/marketing/preferences', 'PUT', { allowed: true }, headers);
    assert.deepEqual((await request('/marketing/preferences', 'GET', undefined, headers)).data, { allowed: true, answered: true });
  });
  test('marketing notification content is private even if another customer id is supplied', async () => {
    const anonymous = await request('/notifications?customerId=C1', 'GET', undefined, {}); assert.equal(anonymous.data.notifications.length, 0);
    const own = await request('/notifications?customerId=C1', 'GET', undefined, { 'x-order-access': memberToken }); assert.ok(own.data.notifications.length > 0);
    const other = await request('/notifications?customerId=C3', 'GET', undefined, { 'x-order-access': memberToken }); assert.equal(other.data.notifications.length, 0);
  });
  test('email retries reuse exact text and Apps Script request id, report accepted rather than delivered', async () => {
    const t = template('TE', { KENH_GUI: 'email' }), c = config('CE', 'TE');
    await (await col('MAU_TIN_NHAN')).insertOne(t); await (await col('CAU_HINH_GUI_TU_DONG')).insertOne(c); await m.enqueue(c, t, customer('C1'), 'email');
    process.env.APPS_SCRIPT_MARKETING_URL = 'https://script.google.com/macros/s/test-deployment/exec';
    process.env.APPS_SCRIPT_MARKETING_SECRET = 'test-marketing-secret-at-least-32-characters';
    process.env.MARKETING_PUBLIC_URL = 'https://example.com';
    const original = globalThis.fetch; const calls: any[] = [];
    globalThis.fetch = (async (_url: any, options: any) => {
      calls.push(JSON.parse(options.body));
      if (calls.length === 1) throw new Error('Temporary');
      return new Response(JSON.stringify({ ok: true, code: 'SENT' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      await m.deliverMarketing(); const row = await (await col('LICH_SU_GUI')).findOne({ CAU_HINH_ID: 'CE' }); assert.equal(row.TRANG_THAI, 'Chờ gửi');
      await (await col('LICH_SU_GUI')).updateOne({ GUI_ID: row.GUI_ID }, { $set: { LAN_THU_TIEP_THEO: new Date(0) } });
      await m.deliverMarketing(); assert.equal(calls.length, 2);
      const first = JSON.parse(calls[0].payload), second = JSON.parse(calls[1].payload);
      assert.equal(first.body, second.body); assert.equal(first.requestId, second.requestId);
      assert.match(second.body, /unsubscribe\?token=/);
      assert.equal((await (await col('LICH_SU_GUI')).findOne({ GUI_ID: row.GUI_ID }))?.MA_GUI_NHA_CUNG_CAP, `apps-script:${row.KHOA_CHONG_TRUNG}:SENT`);
    } finally {
      globalThis.fetch = original;
      delete process.env.APPS_SCRIPT_MARKETING_URL;
      delete process.env.APPS_SCRIPT_MARKETING_SECRET;
    }
  });
}
