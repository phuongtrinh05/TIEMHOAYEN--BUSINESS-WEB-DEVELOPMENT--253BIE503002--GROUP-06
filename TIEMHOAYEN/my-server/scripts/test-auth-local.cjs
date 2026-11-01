const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const uri = 'mongodb://127.0.0.1:27018';
const dbName = 'TIEM_HOA_YEN_LOCAL_TEST';
const client = new MongoClient(uri);
const password = 'LocalTest!2026';
const hash = x => createHash('sha256').update(x).digest('hex');
let count = 0;
async function request(path, status, body, token, method = body ? 'POST' : 'GET', headers = {}) {
  const res = await fetch('http://localhost:3001/api' + path, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json();
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
  count++; return data;
}
(async () => {
  await client.connect(); const db = client.db(dbName);
  // Only this explicitly named local test database is reset. No production .env is read.
  for (const name of ['PHIEN_DANG_NHAP','XAC_THUC_TAI_KHOAN','GIOI_HAN_XAC_THUC','HOP_THU_THU_NGHIEM','NHAT_KY_HE_THONG','NHOM_QUYEN']) await db.collection(name).deleteMany({});
  for (const name of ['PHIEN_DANG_NHAP','XAC_THUC_TAI_KHOAN','GIOI_HAN_XAC_THUC','PHIEN_TRUY_CAP_KHACH']) await db.collection(name).createIndex({ HET_HAN: 1 }, { expireAfterSeconds: 0 });
  const pass = await bcrypt.hash(password, 10);
  for (const [id, phone] of [['CUST9001','0900000001'],['CUST9002','0900000002']]) {
    await db.collection('KHACH_HANG').replaceOne({ KHACH_HANG_ID: id }, { _id: id, KHACH_HANG_ID: id, TEN: 'Khách thử ' + id, SDT: phone, EMAIL: id.toLowerCase()+'@example.test', MAT_KHAU: pass, TRANG_THAI: 'Hoạt động', DA_XOA: false, GIOI_TINH: 'Nam', DOB: null }, { upsert: true });
  }
  for (const [id, role] of [['NVTEST01','Admin'],['NVTEST02','Nhân viên bán hàng']]) await db.collection('NHAN_VIEN').replaceOne({ NHAN_VIEN_ID: id }, { _id: id, NHAN_VIEN_ID: id, HO_TEN: 'Nhân viên thử', EMAIL: id.toLowerCase()+'@example.test', MAT_KHAU: pass, VAI_TRO: role, TRANG_THAI: 'Hoạt động' }, { upsert: true });
  await db.collection('DIA_CHI_GIAO_HANG').replaceOne({ DIA_CHI_ID: 'DCTEST02' }, { _id: 'DCTEST02', DIA_CHI_ID: 'DCTEST02', KHACH_HANG_ID: 'CUST9002' }, { upsert: true });
  const a = await request('/customers/login',200,{ SDT:'0900000001', MAT_KHAU:password });
  assert.ok(a.token); assert.equal(a.customer.MAT_KHAU,undefined);
  await request('/customers/CUST9001',200,null,a.token);
  await request('/customers/CUST9002',403,null,a.token);
  await request('/customers/addresses/DCTEST02',403,{},a.token,'DELETE');
  await request('/cart/customer/CUST9002',403,null,a.token);
  await request('/employees',401,null,null,'GET',{'x-admin-role':'Admin','x-admin-id':'NVTEST01'});
  await request('/admin/staff-accounts',403,null,a.token);
  await request('/customers/forgot-password',400,{ SDT:'0900000001',NEW_PASSWORD:'Stolen!123' },null,'PUT');
  const admin=await request('/admin/auth/login',200,{email:'nvtest01@example.test',password});
  const sales=await request('/admin/auth/login',200,{email:'nvtest02@example.test',password});
  await request('/admin/staff-accounts',403,null,sales.token);
  const staff=await request('/employees',200,null,admin.token);
  assert.ok(staff.every(s=>s.MAT_KHAU===undefined));
  await request('/admin/staff-accounts/NVTEST02',200,{TRANG_THAI:'Ngừng hoạt động'},admin.token,'PATCH');
  await request('/auth/me',401,null,sales.token);
  await request('/admin/auth/login',403,{email:'nvtest02@example.test',password});
  await request('/admin/staff-accounts/NVTEST02',200,{TRANG_THAI:'Hoạt động'},admin.token,'PATCH');
  const challenge=await request('/customers/send-otp',200,{SDT:'0900000001'});
  await request('/customers/send-otp',429,{SDT:'0900000001'});
  await request('/customers/verify-otp',400,{challengeId:challenge.challengeId,OTP:'000000'});
  const mail=await db.collection('HOP_THU_THU_NGHIEM').findOne({EMAIL:'cust9001@example.test'},{sort:{NGAY_TAO:-1}});
  const verified=await request('/customers/verify-otp',200,{challengeId:challenge.challengeId,OTP:mail.MA_OTP});
  await request('/customers/verify-otp',400,{challengeId:challenge.challengeId,OTP:mail.MA_OTP});
  await request('/customers/forgot-password',200,{resetToken:verified.resetToken,NEW_PASSWORD:password},null,'PUT');
  await request('/customers/forgot-password',400,{resetToken:verified.resetToken,NEW_PASSWORD:'Replay!123'},null,'PUT');
  await request('/auth/me',401,null,a.token);
  const b=await request('/customers/login',200,{SDT:'0900000002',MAT_KHAU:password});
  await request('/auth/logout',200,{},b.token);
  await request('/auth/me',401,null,b.token);
  const expired=await request('/customers/send-otp',200,{SDT:'0900000002'});
  await db.collection('XAC_THUC_TAI_KHOAN').updateOne({_id:expired.challengeId},{$set:{HET_HAN:new Date(0)}});
  const mailB=await db.collection('HOP_THU_THU_NGHIEM').findOne({EMAIL:'cust9002@example.test'},{sort:{NGAY_TAO:-1}});
  await request('/customers/verify-otp',400,{challengeId:expired.challengeId,OTP:mailB.MA_OTP});
  await db.collection('KHACH_HANG').deleteMany({SDT:'0900000003'});
  const reg=await request('/customers',201,{TEN:'Đăng ký thử',SDT:'0900000003',EMAIL:'register@example.test',MAT_KHAU:password,GIOI_TINH:'Nam'});
  assert.equal(reg.customer.TRANG_THAI,'Chờ xác minh');
  await request('/customers/login',403,{SDT:'0900000003',MAT_KHAU:password});
  const rc=await request('/customers/send-otp',200,{SDT:'0900000003',purpose:'DANG_KY'});
  const rm=await db.collection('HOP_THU_THU_NGHIEM').findOne({EMAIL:'register@example.test'},{sort:{NGAY_TAO:-1}});
  await request('/customers/verify-otp',200,{challengeId:rc.challengeId,OTP:rm.MA_OTP,purpose:'DANG_KY'});
  await request('/customers/login',200,{SDT:'0900000003',MAT_KHAU:password});
  const logs=await request('/admin/audit-logs',200,null,admin.token);
  assert.ok(logs.some(l=>l.HANH_DONG==='CAP_NHAT_NHAN_VIEN' && l.NGUOI_THUC_HIEN_ID==='NVTEST01'));
  assert.ok(!JSON.stringify(logs).includes(password));
  // Leave rate counters clean for manual UI tests.
  await db.collection('GIOI_HAN_XAC_THUC').deleteMany({});
  console.log(`PASS: ${count} HTTP checks; ownership, header forgery, OTP expiry/replay, reset, registration, lock/logout, audit.`);
})().catch(e=>{ console.error(e); process.exitCode=1; }).finally(()=>client.close());
