import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('OTP: saved customer/admin email uses Gmail; missing email uses console; only newest code is valid', { skip: !process.env.TEST_MONGO_URI }, async () => {
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
  try {
    for (const [type, id, phone, email, purpose] of [
      ['KHACH_HANG', 'WITH_EMAIL', '0900000011', 'customer@example.test', 'KHOI_PHUC_MAT_KHAU'],
      ['KHACH_HANG', 'NO_EMAIL', '0900000022', null, 'KHOI_PHUC_MAT_KHAU'],
      ['NHAN_VIEN', 'ADMIN', '0900000033', 'admin@example.test', 'KHOI_PHUC_MAT_KHAU'],
      ['KHACH_HANG', 'REGISTER', '0900000044', 'register@example.test', 'DANG_KY'],
    ] as const) {
      await db.collection(type).insertOne({ [auth.accountKey(type)]: id, SDT: phone, EMAIL: email, MAT_KHAU: 'TestOnly!123', TRANG_THAI: purpose === 'DANG_KY' ? 'Chờ xác minh' : 'Hoạt động' });
      const req: any = { body: type === 'NHAN_VIEN' ? { EMAIL: email } : { SDT: phone }, ip: id, headers: {} };
      const send = async () => {
        logs = ''; const count = emails.length;
        const result = await auth.sendChallenge(type, req, purpose);
        assert.equal(result.expiresIn, 60); assert.equal(result.resendAfter, 0);
        if (email) { assert.equal(result.delivery, 'email'); assert.equal(emails.length, count + 1); assert.equal(emails.at(-1)!.to, email); assert.equal(logs, ''); }
        else { assert.equal(result.delivery, 'console'); assert.equal(emails.length, count); assert.ok(logs.includes(phone)); }
        const code = email ? emails.at(-1)!.code : logs.match(/: (\d{6}) /)![1];
        assert.ok(!JSON.stringify(result).includes(code));
        return { result, code };
      };
      const old = await send(); const latest = await send(); assert.notEqual(old.code, latest.code);
      const verify: any = { body: { challengeId: latest.result.challengeId, OTP: old.code }, headers: {} };
      await assert.rejects(auth.verifyChallenge(type, verify, purpose));
      verify.body.OTP = latest.code;
      await auth.verifyChallenge(type, verify, purpose);
      await assert.rejects(auth.verifyChallenge(type, verify, purpose));
    }
    fail = true;
    await assert.rejects(auth.sendChallenge('NHAN_VIEN', { body: { EMAIL: 'admin@example.test' }, ip: 'failure', headers: {} } as any), /Chưa gửi được email/);
    assert.equal((await db.collection('XAC_THUC_TAI_KHOAN').findOne({ TAI_KHOAN_ID: 'ADMIN', MUC_DICH: 'KHOI_PHUC_MAT_KHAU' }))?.DA_SU_DUNG, true);
  } finally {
    globalThis.fetch = originalFetch; console.log = originalLog;
    await db.dropDatabase(); await (await mongo.getMongoClient()).close();
  }
});
