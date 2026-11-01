import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { writeFile } from 'node:fs/promises';
import { getCollection } from '../mongo.js';
import { InventoryError, withTransaction } from './inventory/helpers.js';

const ACCESS = 'XAC_THUC_TRA_CUU_DON';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function createStaffAccess(employee: any) {
  const accessToken = `sa_${randomBytes(32).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 8 * 3600000);
  await (await getCollection<any>(ACCESS)).insertOne({ _id: hash(accessToken), kind: 'staff', employeeId: employee.NHAN_VIEN_ID,
    credentialHash: hash(String(employee.MAT_KHAU)), expiresAt, createdAt: new Date() });
  return { accessToken, expiresAt };
}
export async function staffAccess(token: unknown, collections: typeof getCollection = getCollection) {
  if (!/^sa_[a-f0-9]{64}$/.test(String(token))) throw new InventoryError(401, 'Cần đăng nhập nhân viên để thực hiện thao tác.');
  const row = await (await collections<any>(ACCESS)).findOne({ _id: hash(String(token)), kind: 'staff', expiresAt: { $gt: new Date() } });
  const employee = row && await (await collections<any>('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: row.employeeId });
  if (!employee || employee.DA_XOA === true || employee.DA_XOA === 1 || /khóa|ngừng|ngưng|nghỉ|inactive|locked|disabled|terminated|deleted/i.test(String(employee.TRANG_THAI || ''))
    || row.credentialHash !== hash(String(employee.MAT_KHAU))) throw new InventoryError(401, 'Phiên nhân viên đã hết hạn hoặc không còn hiệu lực.');
  return employee;
}
export async function ensureOrderAccessIndexes() {
  await (await getCollection<any>(ACCESS)).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
export function normalizeOrderPhone(value: unknown): string {
  const raw = String(value || '').replace(/[\s().-]/g, '').replace(/^\+84|^84/, '0');
  return /^0\d{9}$/.test(raw) ? raw : '';
}
export function phonePattern(phone: string) {
  const tail = phone.slice(1).split('').join('[\\s().-]*');
  return new RegExp(`^(?:0|\\+?84)[\\s().-]*${tail}$`);
}
export async function requestOrderOtp(value: unknown, ip: string, orderId?: string) {
  const phone = normalizeOrderPhone(value);
  if (!phone) throw new InventoryError(400, 'Nhập số điện thoại người đặt hợp lệ.');
  if (process.env.ORDER_OTP_DELIVERY !== 'console' || process.env.NODE_ENV === 'production') {
    throw new InventoryError(503, 'Kênh gửi OTP chưa được cấu hình. Vui lòng liên hệ shop.');
  }
  const now = new Date();
  const challengeId = `otp_${randomBytes(24).toString('hex')}`;
  const otp = String(randomInt(100000, 1000000));
  const expiresAt = new Date(now.getTime() + 5 * 60000);
  const col = await getCollection<any>(ACCESS);
  const ipHash = hash(ip);
  // One rate bucket document serializes simultaneous sends for this phone/IP.
  await withTransaction(async session => {
    for (const [key, limit, cooldown] of [[`phone:${phone}`, 5, 60000], [`ip:${ipHash}`, 15, 0]] as const) {
      const old = await col.findOne({ _id: key }, { session });
      if (old && cooldown && now.getTime() - new Date(old.lastSentAt).getTime() < cooldown) throw new InventoryError(429, 'Vui lòng chờ 60 giây trước khi gửi lại mã.');
      const sameWindow = old && now.getTime() - new Date(old.windowAt).getTime() < 10 * 60000;
      if (sameWindow && old.count >= limit) throw new InventoryError(429, 'Bạn yêu cầu quá nhiều mã. Vui lòng thử lại sau.');
      await col.updateOne({ _id: key }, { $set: { kind: 'rate', windowAt: sameWindow ? old.windowAt : now, count: sameWindow ? old.count + 1 : 1, lastSentAt: now, expiresAt: new Date(now.getTime() + 10 * 60000) } }, { upsert: true, session });
    }
    await col.updateMany({ kind: 'otp', phone, consumed: false }, { $set: { consumed: true } }, { session });
    await col.insertOne({ _id: challengeId, kind: 'otp', phone, ...(orderId?{orderId}:{}), codeHash: hash(`${challengeId}:${otp}`), attempts: 0, consumed: false, createdAt: now, expiresAt }, { session });
  });
  // Explicit local development transport. Never return the code in an API response.
  console.info(`[ORDER OTP - LOCAL] ${phone}: ${otp} (hiệu lực 5 phút)`);
  if (process.env.ORDER_OTP_LOG_FILE && !process.env.TEST_MONGO_URI) {
    await writeFile(process.env.ORDER_OTP_LOG_FILE, `OTP tra cứu đơn (LOCAL)\nSố điện thoại: ${phone}\nMã OTP: ${otp}\nHết hạn: ${expiresAt.toISOString()}\n`, 'utf8');
  }
  return { challengeId, expiresAt, resendAfterSeconds: 60, delivery: 'console', message: 'Mã xác thực đã được tạo. Môi trường local: xem OTP trong terminal backend.' };
}
export async function verifyOrderOtp(challengeId: unknown, code: unknown) {
  if (!/^otp_[a-f0-9]{48}$/.test(String(challengeId)) || !/^\d{6}$/.test(String(code))) throw new InventoryError(400, 'Mã xác thực không hợp lệ.');
  const col = await getCollection<any>(ACCESS);
  const row = await col.findOne({ _id: challengeId, kind: 'otp', consumed: false, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } });
  if (!row) throw new InventoryError(400, 'Mã đã hết hạn hoặc hết lượt thử. Hãy gửi mã mới.');
  const correct = timingSafeEqual(Buffer.from(row.codeHash, 'hex'), Buffer.from(hash(`${challengeId}:${code}`), 'hex'));
  const updated = await col.findOneAndUpdate({ _id: challengeId, consumed: false, attempts: { $lt: 5 }, expiresAt: { $gt: new Date() } },
    { $inc: { attempts: 1 }, ...(correct ? { $set: { consumed: true } } : {}) }, { returnDocument: 'after' });
  if (!updated || !correct) throw new InventoryError(400, 'Mã xác thực không đúng hoặc hết lượt thử.');
  const token = `oa_${randomBytes(32).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 30 * 60000);
  await col.insertOne({ _id: hash(token), kind: 'lookup', phone: row.phone, ...(row.orderId?{orderId:row.orderId}:{}), createdAt: new Date(), expiresAt });
  return { accessToken: token, phone: row.phone, ...(row.orderId?{orderId:row.orderId}:{}), expiresAt };
}
export async function lookupAccess(token: unknown, session?: ClientSession) {
  if (!/^(?:oa|ra)_[a-f0-9]{64}$/.test(String(token))) throw new InventoryError(401, 'Vui lòng đăng nhập, dùng liên kết riêng hoặc xác minh OTP để xem yêu cầu.');
  const row = await (await getCollection<any>(ACCESS)).findOne({ _id: hash(String(token)), kind: { $in: ['lookup', 'request'] }, expiresAt: { $gt: new Date() } }, { session });
  if (!row) throw new InventoryError(401, 'Phiên truy cập đã hết hạn. Vui lòng đăng nhập lại hoặc xác minh OTP nếu là khách vãng lai.');
  if (row.authType === 'member') {
    const customer = await (await getCollection<any>('KHACH_HANG')).findOne({ KHACH_HANG_ID: row.customerId }, { session });
    if (!customer || customer.DA_XOA === true || customer.DA_XOA === 1 || /khóa|ngừng|inactive/i.test(String(customer.TRANG_THAI || ''))) throw new InventoryError(401, 'Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.');
  }
  return row;
}
export async function createCustomerOrderAccess(customer: any) {
  const accessToken = `oa_${randomBytes(32).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 8 * 3600000);
  const phone = normalizeOrderPhone(customer.SDT);
  await (await getCollection<any>(ACCESS)).insertOne({ _id: hash(accessToken), kind: 'lookup', authType: 'member', customerId: customer.KHACH_HANG_ID, phone, expiresAt, createdAt: new Date() });
  return { accessToken, expiresAt, phone, authType: 'member', customerId: customer.KHACH_HANG_ID };
}
export async function createRequestAccess(requestId: string, session: ClientSession) {
  const accessToken = `ra_${randomBytes(32).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 30 * 86400000);
  await (await getCollection<any>(ACCESS)).insertOne({ _id: hash(accessToken), kind: 'request', authType: 'guest_request', requestId, expiresAt, createdAt: new Date() }, { session });
  return { accessToken, expiresAt };
}
export const ownedRequestQuery = (access: any) => access.authType === 'member' ? { customerId: access.customerId }
  : access.kind === 'request' ? { requestId: access.requestId, customerId: { $in: [null, ''] } }
  : access.orderId ? { _id:'__ORDER_ONLY__' } : { customerId: { $in: [null, ''] }, 'sender.phone': phonePattern(access.phone) };
export async function ownedOrderQuery(access: any) {
  if (access.kind === 'request') {
    const request = await (await getCollection<any>('YEU_CAU_DAT_HANG')).findOne({ requestId: access.requestId, customerId: { $in: [null, ''] } });
    return { DON_HANG_ID: request?.orderId || '__DENIED__', KHACH_HANG_ID: { $in: [null, ''] } };
  }
  return access.authType === 'member' ? { KHACH_HANG_ID: access.customerId } : { ...await orderPhoneQuery(access.phone), ...(access.orderId?{DON_HANG_ID:access.orderId}:{}) };
}
export async function requestByVerifiedPhone(id: string, token: string, session?: ClientSession) {
  const access = await lookupAccess(token, session);
  const row = await (await getCollection<any>('YEU_CAU_DAT_HANG')).findOne({ _id: id, ...ownedRequestQuery(access) }, { session });
  if (!row) throw new InventoryError(404, 'Không tìm thấy yêu cầu trong phạm vi được phép.');
  return row;
}
export async function orderPhoneQuery(phone: string) {
  return { KHACH_HANG_ID: { $in: [null, ''] }, SDT_NGUOI_DAT: phonePattern(phone) };
}
export async function authorizeOrder(id: string, token: string) {
  const access = await lookupAccess(token);
  const order = await (await getCollection<any>('DON_HANG')).findOne({ DON_HANG_ID: id, ...await ownedOrderQuery(access) });
  if (!order) throw new InventoryError(404, 'Không tìm thấy đơn trong phạm vi được phép.');
  return access;
}
export async function createCheckoutAccess(orderId: string, session: ClientSession) {
  const token = `co_${randomBytes(32).toString('hex')}`;
  await (await getCollection<any>(ACCESS)).insertOne({ _id: hash(token), kind: 'checkout', orderId, expiresAt: new Date(Date.now() + 2 * 3600000) }, { session });
  return token;
}
export async function authorizeCheckout(orderId: string, token: unknown) {
  if (!/^co_[a-f0-9]{64}$/.test(String(token))) return false;
  return !!await (await getCollection<any>(ACCESS)).findOne({ _id: hash(String(token)), kind: 'checkout', orderId, expiresAt: { $gt: new Date() } });
}
export async function revokeOrderAccess(token: string) {
  await (await getCollection<any>(ACCESS)).updateOne({ _id: hash(token), kind: 'lookup' }, { $set: { expiresAt: new Date(0) } });
}
