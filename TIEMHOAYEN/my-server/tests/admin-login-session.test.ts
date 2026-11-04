import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';

test('admin login returns both sessions accepted by admin identity and business permissions', { skip: !process.env.TEST_MONGO_URI }, async () => {
  const uri = process.env.TEST_MONGO_URI!;
  if (!/^mongodb:\/\/127\.0\.0\.1:/.test(uri)) throw Error('Local test database required');
  process.env.MONGO_URI = uri;
  process.env.MONGO_DATABASE = `ADMIN_SESSION_${randomUUID().replaceAll('-', '')}_LOCAL_TEST`;
  const mongo = await import('../mongo.js');
  const { hashPassword } = await import('../utils/passwordHash.js');
  const { loginAdminEmployee } = await import('../controllers/rolePermission.js');
  const { identify } = await import('../services/auth.service.js');
  const { authenticatedEmployee } = await import('../middleware/rolePermission.js');
  const db = await mongo.getDb();
  try {
    await db.collection('NHAN_VIEN').insertOne({ NHAN_VIEN_ID: 'NV_TEST', EMAIL: 'admin@example.test', VAI_TRO: 'Admin', TRANG_THAI: 'Hoạt động', MAT_KHAU: await hashPassword('Local-test-only-384!') });
    let result: any, status = 200;
    const res: any = { status(code: number) { status = code; return this; }, json(data: any) { result = data; return this; }, setHeader() {} };
    await loginAdminEmployee({ body: { email: 'admin@example.test', password: 'incorrect-password' } } as any, res);
    assert.equal(status, 401);
    assert.equal(await db.collection('PHIEN_DANG_NHAP_ADMIN').countDocuments(), 0);
    status = 200;
    await loginAdminEmployee({ body: { email: 'admin@example.test', password: 'Local-test-only-384!' } } as any, res);
    assert.equal(status, 200);
    assert.match(result.adminSessionToken, /^as_[a-f0-9]{64}$/);
    assert.match(result.accessToken, /^sa_[a-f0-9]{64}$/);
    const stored = await db.collection('PHIEN_DANG_NHAP_ADMIN').findOne({ _id: createHash('sha256').update(result.adminSessionToken).digest('hex') as any });
    assert.equal(stored?.employeeId, 'NV_TEST');
    assert.equal((await identify({ headers: { 'x-admin-session': result.adminSessionToken } } as any))?.id, 'NV_TEST');
    assert.equal((await authenticatedEmployee({ headers: { authorization: `Bearer ${result.accessToken}` } } as any)).NHAN_VIEN_ID, 'NV_TEST');
    assert.ok(!JSON.stringify(result).includes('MAT_KHAU'));
    await db.collection('NHAN_VIEN').insertOne({ NHAN_VIEN_ID: 'NV_STAFF', EMAIL: 'staff@example.test', VAI_TRO: 'Nhân viên bán hàng', TRANG_THAI: 'Đang làm việc', MAT_KHAU: await hashPassword('Local-test-only-384!') });
    await loginAdminEmployee({ body: { email: 'staff@example.test', password: 'Local-test-only-384!' } } as any, res);
    assert.equal(status, 200);
    assert.equal(result.employee.id, 'NV_STAFF');
    assert.equal((await authenticatedEmployee({ headers: { authorization: `Bearer ${result.accessToken}` } } as any)).NHAN_VIEN_ID, 'NV_STAFF');
    const { loginCustomer } = await import('../controllers/customer.js');
    const { customerAccess } = await import('../middleware/customerAccess.js');
    await db.collection('KHACH_HANG').insertOne({ KHACH_HANG_ID: 'KH_TEST', SDT: '0900000001', HO_TEN: 'Local Test', TRANG_THAI: 'Hoạt động', MAT_KHAU: await hashPassword('Local-test-only-384!') });
    await loginCustomer({ body: { SDT: '0900000001', MAT_KHAU: 'Local-test-only-384!' }, headers: {} } as any, res);
    assert.equal(status, 200);
    assert.equal(result.customer.KHACH_HANG_ID, 'KH_TEST');
    const identity = await identify({ headers: { 'x-order-access': result.token } } as any);
    assert.equal(identity?.id, 'KH_TEST');
    let allowed = false;
    await customerAccess({ identity, path: '/KH_TEST', method: 'GET' } as any, res, () => { allowed = true; });
    assert.equal(allowed, true);
    await customerAccess({ identity, path: '/KH_OTHER', method: 'GET' } as any, res, () => { throw Error('Other customer data exposed'); });
    assert.equal(status, 403);
  } finally {
    await db.dropDatabase();
    await (await mongo.getMongoClient()).close();
  }
});
