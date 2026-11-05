import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Kiểm thử các mục feedback AD01, AD33–AD40, AD52–AD55, KH01–KH05, KH33 ở mức API.
test('auth + account administration feedback rules', { skip: !process.env.TEST_MONGO_URI }, async () => {
  const uri = process.env.TEST_MONGO_URI!;
  if (!/^mongodb:\/\/127\.0\.0\.1:/.test(uri)) throw Error('Local test database required');
  process.env.MONGO_URI = uri;
  process.env.MONGO_DATABASE = `AUTH_FEEDBACK_${randomUUID().replaceAll('-', '')}_LOCAL_TEST`;
  const mongo = await import('../mongo.js');
  const { hashPassword } = await import('../utils/passwordHash.js');
  const { loginCustomer, registerCustomer } = await import('../controllers/customer.js');
  const { loginAdminEmployee } = await import('../controllers/rolePermission.js');
  const auth = await import('../services/auth.service.js');
  const { attachVerifiedStaff } = await import('../middleware/verifiedStaff.js');
  const customersApi = await import('../controllers/admin-customer.js');
  const db = await mongo.getDb();
  const call = async (handler: any, req: any) => {
    let status = 200; let body: any;
    const res: any = { locals: {}, status(code: number) { status = code; return this; }, json(data: any) { body = data; return this; }, setHeader() {} };
    await handler({ headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' }, ip: '127.0.0.1', params: {}, query: {}, ...req }, res);
    return { status, body };
  };
  try {
    // KH01: mật khẩu yếu bị từ chối, đăng ký hợp lệ ở trạng thái chờ xác minh.
    let r = await call(registerCustomer, { body: { TEN: 'Khách Test', GIOI_TINH: 'Nữ', SDT: '0911111111', EMAIL: 'KH@Example.test', MAT_KHAU: 'weakpass' } });
    assert.equal(r.status, 400); assert.equal(r.body.field, 'password');
    r = await call(registerCustomer, { body: { TEN: 'Khách Test', GIOI_TINH: 'Nữ', SDT: '0911111111', EMAIL: 'KH@Example.test', MAT_KHAU: 'Strong#Pass1' } });
    assert.equal(r.status, 201); assert.equal(r.body.customer.TRANG_THAI, 'Chờ xác minh'); assert.equal(r.body.customer.EMAIL, 'kh@example.test');
    r = await call(registerCustomer, { body: { TEN: 'Khách Test', GIOI_TINH: 'Nữ', SDT: '0911111111', EMAIL: 'other@example.test', MAT_KHAU: 'Strong#Pass1' } });
    assert.equal(r.status, 409); assert.equal(r.body.pendingVerification, true);
    const customerId = (await db.collection('KHACH_HANG').findOne({ SDT: '0911111111' }))!.KHACH_HANG_ID;
    await db.collection('KHACH_HANG').updateOne({ KHACH_HANG_ID: customerId }, { $set: { TRANG_THAI: 'Hoạt động' } });

    // KH02: không lộ SĐT có tồn tại; sai 5 lần thì khóa tạm, mật khẩu đúng cũng bị chặn.
    r = await call(loginCustomer, { body: { SDT: '0900000000', MAT_KHAU: 'x' } });
    assert.equal(r.status, 401);
    for (let i = 1; i <= 4; i++) {
      r = await call(loginCustomer, { body: { SDT: '0911111111', MAT_KHAU: 'Wrong#Pass1' } });
      assert.equal(r.status, 401); assert.equal(r.body.remainingAttempts, 5 - i);
    }
    r = await call(loginCustomer, { body: { SDT: '0911111111', MAT_KHAU: 'Wrong#Pass1' } });
    assert.equal(r.status, 429); assert.equal(r.body.locked, true);
    r = await call(loginCustomer, { body: { SDT: '0911111111', MAT_KHAU: 'Strong#Pass1' } });
    assert.equal(r.status, 429);
    await db.collection('KHACH_HANG').updateOne({ KHACH_HANG_ID: customerId }, { $unset: { KHOA_DANG_NHAP_DEN: '' } });
    r = await call(loginCustomer, { body: { SDT: '0911111111', MAT_KHAU: 'Strong#Pass1' } });
    assert.equal(r.status, 200); assert.equal(r.body.lastLogin, null);
    const memberToken = r.body.token;
    r = await call(loginCustomer, { body: { SDT: '0911111111', MAT_KHAU: 'Strong#Pass1' } });
    assert.equal(r.body.lastLogin.device, 'Chrome trên Windows');
    assert.ok(await auth.identify({ headers: { authorization: `Bearer ${memberToken}` } } as any));

    // KH05: đặt lại mật khẩu thu hồi mọi phiên thành viên (oa_).
    await db.collection('XAC_THUC_TAI_KHOAN').insertOne({ _id: auth.digest('reset-token') as any, MUC_DICH: 'DAT_LAI_MAT_KHAU', LOAI_TAI_KHOAN: 'KHACH_HANG', TAI_KHOAN_ID: customerId,
      PHIEN_BAN_MAT_KHAU: auth.digest(String((await db.collection('KHACH_HANG').findOne({ KHACH_HANG_ID: customerId }))!.MAT_KHAU)), HET_HAN: new Date(Date.now() + 60000), DA_SU_DUNG: false });
    await assert.rejects(auth.resetPassword('KHACH_HANG', { body: { resetToken: 'reset-token', NEW_PASSWORD: 'Strong#Pass1' }, headers: {} } as any), /khác mật khẩu hiện tại/);
    await db.collection('XAC_THUC_TAI_KHOAN').updateOne({ _id: auth.digest('reset-token') as any }, { $set: { DA_SU_DUNG: false } });
    await auth.resetPassword('KHACH_HANG', { body: { resetToken: 'reset-token', NEW_PASSWORD: 'Newer#Pass2' }, headers: {} } as any);
    assert.equal(await auth.identify({ headers: { authorization: `Bearer ${memberToken}` } } as any), undefined);

    // AD01 + AD53: đăng nhập Admin trả lần đăng nhập trước; header x-admin-id giả bị bỏ.
    await db.collection('NHAN_VIEN').insertMany([
      { NHAN_VIEN_ID: 'NV001', HO_TEN: 'Admin Gốc', EMAIL: 'root@example.test', SDT: '0922222222', VAI_TRO: 'Admin', TRANG_THAI: 'Hoạt động', MAT_KHAU: await hashPassword('Admin#Pass1') },
      { NHAN_VIEN_ID: 'NV002', HO_TEN: 'Bán Hàng', EMAIL: 'sale@example.test', SDT: '0933333333', VAI_TRO: 'Nhân viên bán hàng', TRANG_THAI: 'Hoạt động', MAT_KHAU: await hashPassword('Sale#Pass1') },
    ]);
    r = await call(loginAdminEmployee, { body: { email: 'ROOT@example.test', password: 'Admin#Pass1' } });
    assert.equal(r.status, 200); assert.equal(r.body.lastLogin, null);
    const adminBearer = r.body.accessToken;
    const spoofed: any = { headers: { 'x-admin-id': 'NV001', 'x-admin-role': 'Admin' } };
    await attachVerifiedStaff(spoofed, {} as any, () => {});
    assert.equal(spoofed.headers['x-admin-id'], undefined);
    const verified: any = { headers: { authorization: `Bearer ${adminBearer}`, 'x-admin-id': 'NV002' } };
    await attachVerifiedStaff(verified, {} as any, () => {});
    assert.equal(verified.headers['x-admin-id'], 'NV001'); assert.equal(verified.identity.id, 'NV001');

    // AD33–AD40: danh sách có tổng quan; Admin không sửa SĐT; khóa thu hồi phiên; ghi chú; địa chỉ.
    const admin = (await db.collection('NHAN_VIEN').findOne({ NHAN_VIEN_ID: 'NV001' }))!;
    const asAdmin = { identity: { id: 'NV001', type: 'NHAN_VIEN', account: admin, sessionId: '' } };
    await db.collection('DON_HANG').insertMany([
      { DON_HANG_ID: 'YENTEST0001', KHACH_HANG_ID: customerId, TONG_TIEN: 500000, TRANG_THAI: 'Hoàn thành', NGAY_TAO: new Date() },
      { DON_HANG_ID: 'YENTEST0002', KHACH_HANG_ID: customerId, TONG_TIEN: 300000, TRANG_THAI: 'Đã hủy', NGAY_TAO: new Date() },
      { DON_HANG_ID: 'YENTEST0003', KHACH_HANG_ID: customerId, TONG_TIEN: 200000, TRANG_THAI: 'Đang giao', NGAY_TAO: new Date() },
    ]);
    await db.collection('THANH_TOAN').insertOne({ THANH_TOAN_ID: 'TT1', DON_HANG_ID: 'YENTEST0003', SO_TIEN: 50000, TRANG_THAI_THANH_TOAN: 'Thành công', MA_GIAO_DICH: 'REF1' });
    r = await call(customersApi.getAdminCustomers, { query: { search: 'khach test' } });
    assert.equal(r.body.total, 1);
    const row = r.body.customers[0];
    assert.equal(row.totalOrders, 2); assert.equal(row.totalSpent, 500000); assert.equal(row.debt, 650000); assert.equal(row.point, 0);
    r = await call(customersApi.updateAdminCustomer, { ...asAdmin, params: { customerId }, body: { name: 'Khách Đổi Tên', phone: '0999999999' } });
    assert.equal(r.status, 400); assert.equal(r.body.field, 'phone');
    r = await call(customersApi.updateAdminCustomer, { ...asAdmin, params: { customerId }, body: { name: 'Khách Đổi Tên', phone: '0911111111' } });
    assert.equal(r.status, 200); assert.equal(r.body.customer.name, 'Khách Đổi Tên');
    r = await call(loginCustomer, { body: { SDT: '0911111111', MAT_KHAU: 'Newer#Pass2' } });
    const tokenBeforeLock = r.body.token;
    r = await call(customersApi.setAdminCustomerLock, { ...asAdmin, params: { customerId }, body: { locked: true } });
    assert.equal(r.status, 400);
    r = await call(customersApi.setAdminCustomerLock, { ...asAdmin, params: { customerId }, body: { locked: true, reason: 'Spam đơn' } });
    assert.equal(r.status, 200); assert.equal(r.body.customer.locked, true);
    assert.equal(await auth.identify({ headers: { authorization: `Bearer ${tokenBeforeLock}` } } as any), undefined);
    r = await call(loginCustomer, { body: { SDT: '0911111111', MAT_KHAU: 'Newer#Pass2' } });
    assert.equal(r.status, 403); assert.equal(r.body.locked, true);
    r = await call(customersApi.addAdminCustomerNote, { ...asAdmin, params: { customerId }, body: { content: 'Khách thích hoa trắng' } });
    assert.equal(r.status, 201);
    r = await call(customersApi.createAdminCustomerAddress, { ...asAdmin, params: { customerId }, body: { name: 'A', phone: '123', province: 'HCM', district: 'Q1', ward: 'P1', detailAddress: '1 Lê Lợi' } });
    assert.equal(r.status, 400); assert.equal(r.body.field, 'phone');
    r = await call(customersApi.createAdminCustomerAddress, { ...asAdmin, params: { customerId }, body: { name: 'Người Nhận', phone: '0944444444', province: 'HCM', district: 'Q1', ward: 'P1', detailAddress: '1 Lê Lợi', isDefault: false } });
    assert.equal(r.status, 201); assert.equal(r.body.address.name, 'Người Nhận'); assert.equal(r.body.address.isDefault, true);
    const firstAddress = r.body.address.id;
    r = await call(customersApi.createAdminCustomerAddress, { ...asAdmin, params: { customerId }, body: { name: 'Người Nhận 2', phone: '0955555555', province: 'HCM', district: 'Q3', ward: 'P2', detailAddress: '2 Hai Bà Trưng' } });
    const secondAddress = r.body.address.id;
    r = await call(customersApi.deleteAdminCustomerAddress, { ...asAdmin, params: { customerId, addressId: firstAddress } });
    assert.equal(r.body.newDefaultId, secondAddress);
    r = await call(customersApi.getAdminCustomerDetail, { params: { customerId } });
    assert.equal(r.body.customer.name, 'Khách Đổi Tên'); assert.equal(r.body.notes.length, 1);
    assert.equal(r.body.orders.find((o: any) => o.code === 'YENTEST0003').paymentStatus, 'Đã cọc');
    assert.equal(r.body.addresses[0].isDefault, true);

    // AD55: thao tác của Admin được ghi đúng người thực hiện.
    const lockLog = await db.collection('NHAT_KY_HE_THONG').findOne({ HANH_DONG: 'KHOA_KHACH_HANG' });
    assert.equal(lockLog?.NGUOI_THUC_HIEN_ID, 'NV001');
    assert.equal(await db.collection('NHAT_KY_HE_THONG').countDocuments({ 'NOI_DUNG_THAY_DOI.MAT_KHAU': { $exists: true } }), 0);
  } finally {
    await db.dropDatabase(); await (await mongo.getMongoClient()).close();
  }
});
