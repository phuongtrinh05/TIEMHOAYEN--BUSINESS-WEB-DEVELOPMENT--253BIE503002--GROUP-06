import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('OTP: saved email uses Gmail; missing email uses SMS channel; 60s resend cooldown; only newest code is valid; attempt limits', { skip: !process.env.TEST_MONGO_URI }, async () => {
  const uri = process.env.TEST_MONGO_URI!;
  if (!/^mongodb:\/\/127\.0\.0\.1:/.test(uri)) throw Error('Local test database required');
  process.env.MONGO_URI = uri;
  process.env.MONGO_DATABASE = `OTP_EMAIL_${randomUUID().replaceAll('-', '')}_LOCAL_TEST`;
  process.env.NODE_ENV = 'production';
  process.env.AUTH_OTP_DELIVERY = 'console'; // Old setting must not override real email.
  Object.assign(process.env, { GMAIL_SENDER: 'shop@example.test', GMAIL_CLIENT_ID: 'test-client', GMAIL_CLIENT_SECRET: 'test-secret', GMAIL_REFRESH_TOKEN: 'test-refresh' });
  const mongo = await import('../mongo.js');
  const auth = await import('../services/auth.service.js');
  const db = await mongo.getDb();
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const emails: { to: string; code: string }[] = [];
  let logs = '';
  let fail = false;
  globalThis.fetch = (async (url: any, options: any) => {
    if (fail) return new Response('{}', { status: 401 });
    if (String(url) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access' });
    assert.equal(String(url), 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    const raw = Buffer.from(JSON.parse(options.body).raw, 'base64url').toString('utf8');
    assert.ok(raw.includes('From: shop@example.test'));
    const text = Buffer.from(raw.split('\r\n\r\n')[1], 'base64').toString('utf8');
    emails.push({ to: raw.match(/To: (.*)\r\n/)![1], code: text.match(/\b\d{6}\b/)![0] });
    return Response.json({ id: 'mock-message' });
  }) as typeof fetch;
  console.log = (...args) => { logs += args.join(' '); };
  const challenges = db.collection<any>('XAC_THUC_TAI_KHOAN');
  try {
    for (const [type, id, phone, email, purpose] of [
      ['KHACH_HANG', 'WITH_EMAIL', '0900000011', 'customer@example.test', 'KHOI_PHUC_MAT_KHAU'],
      ['KHACH_HANG', 'NO_EMAIL', '0900000022', null, 'KHOI_PHUC_MAT_KHAU'],
      ['NHAN_VIEN', 'ADMIN', '0900000033', 'admin@example.test', 'KHOI_PHUC_MAT_KHAU'],
      ['KHACH_HANG', 'REGISTER', '0900000044', 'register@example.test', 'DANG_KY'],
    ] as const) {
      await db.collection(type).insertOne({ [auth.accountKey(type)]: id, SDT: phone, EMAIL: email, MAT_KHAU: 'TestOnly!123', TRANG_THAI: purpose === 'DANG_KY' ? 'Chờ xác minh' : 'Hoạt động' });
      const req: any = { body: type === 'NHAN_VIEN' ? { EMAIL: email } : { SDT: phone }, ip: id, headers: {} };
      const customerRecovery = type === 'KHACH_HANG' && purpose === 'KHOI_PHUC_MAT_KHAU';
      const send = async () => {
        logs = ''; const count = emails.length;
        const result: any = await auth.sendChallenge(type, req, purpose);
        assert.equal(result.expiresIn, 60); assert.equal(result.resendAfter, 60);
        assert.equal(result.attemptLimit, type === 'NHAN_VIEN' ? 3 : 5);
        // Khôi phục mật khẩu khách hàng không tiết lộ kênh/tài khoản (KH03).
        if (customerRecovery) assert.equal(result.delivery, 'registered');
        if (email) { if (!customerRecovery) assert.equal(result.delivery, 'email'); assert.equal(emails.length, count + 1); assert.equal(emails.at(-1)!.to, email); assert.equal(logs, ''); }
        else { assert.equal(emails.length, count); assert.ok(logs.includes(phone)); }
        const code = email ? emails.at(-1)!.code : logs.match(/: (\d{6}) /)![1];
        assert.ok(!JSON.stringify(result).includes(code));
        return { result, code };
      };
      const old = await send();
      // Gửi lại trước 60 giây bị chặn (KH04).
      await assert.rejects(auth.sendChallenge(type, req, purpose), (error: any) => error.status === 429 && Number(error.extra?.resendAfter) > 0);
      await challenges.updateOne({ _id: old.result.challengeId }, { $set: { GUI_LAI_SAU: new Date(Date.now() - 1000) } });
      const latest = await send(); assert.notEqual(old.code, latest.code);
      const verify: any = { body: { challengeId: latest.result.challengeId, OTP: old.code }, headers: {} };
      await assert.rejects(auth.verifyChallenge(type, verify, purpose), (error: any) => error.extra?.remainingAttempts === (type === 'NHAN_VIEN' ? 2 : 4));
      verify.body.OTP = latest.code;
      await auth.verifyChallenge(type, verify, purpose);
      await assert.rejects(auth.verifyChallenge(type, verify, purpose));
    }

    // Admin: sai 3 lần thì mã đúng cũng không dùng được nữa (AD01).
    await challenges.updateMany({}, { $set: { GUI_LAI_SAU: new Date(Date.now() - 1000) } });
    const adminReq: any = { body: { EMAIL: 'admin@example.test' }, ip: 'limit', headers: {} };
    const sent: any = await auth.sendChallenge('NHAN_VIEN', adminReq);
    const right = emails.at(-1)!.code;
    const wrong = right === '111111' ? '222222' : '111111';
    for (let i = 0; i < 3; i++) await assert.rejects(auth.verifyChallenge('NHAN_VIEN', { body: { challengeId: sent.challengeId, OTP: wrong }, headers: {} } as any));
    await assert.rejects(auth.verifyChallenge('NHAN_VIEN', { body: { challengeId: sent.challengeId, OTP: right }, headers: {} } as any), (error: any) => error.extra?.attemptsExceeded === true);

    // Khách nhập SĐT chưa đăng ký: phản hồi giống hệt, không gửi gì (KH03).
    const before = emails.length; logs = '';
    const unknown: any = await auth.sendChallenge('KHACH_HANG', { body: { SDT: '0999999999' }, ip: 'unknown', headers: {} } as any);
    assert.equal(unknown.delivery, 'registered'); assert.equal(emails.length, before); assert.equal(logs, '');

    fail = true;
    await challenges.updateMany({}, { $set: { GUI_LAI_SAU: new Date(Date.now() - 1000) } });
    await assert.rejects(auth.sendChallenge('NHAN_VIEN', { body: { EMAIL: 'admin@example.test' }, ip: 'failure', headers: {} } as any), /Chưa gửi được email/);
    assert.equal((await challenges.findOne({ TAI_KHOAN_ID: 'ADMIN', MUC_DICH: 'KHOI_PHUC_MAT_KHAU' }))?.DA_SU_DUNG, true);
  } finally {
    globalThis.fetch = originalFetch; console.log = originalLog;
    await db.dropDatabase(); await (await mongo.getMongoClient()).close();
  }
});
