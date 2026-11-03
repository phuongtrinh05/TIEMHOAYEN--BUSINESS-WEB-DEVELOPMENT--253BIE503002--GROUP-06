import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { writeFile } from 'node:fs/promises';
import { getCollection } from '../mongo.js';
import { InventoryError } from './inventory/helpers.js';

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
export async function requestOrderOtp(value: unknown, ip: string, orderId?: string, requestId?: string) {
  const phone = normalizeOrderPhone(value);
  if (!phone) throw new InventoryError(400, 'Nhập số điện thoại người đặt hợp lệ.');
  const scopedOrderId = String(orderId || '').trim().toUpperCase();
  if (scopedOrderId && !/^YEN[A-Z0-9]{8,32}$/.test(scopedOrderId)) throw new InventoryError(400, 'Mã đơn hàng không đúng định dạng.');
  const scopedRequestId = String(requestId || '').trim().toUpperCase();
  if (scopedRequestId && !/^YC[A-Z0-9]{8,32}$/.test(scopedRequestId)) throw new InventoryError(400, 'Mã yêu cầu không đúng định dạng.');
  // When a code is supplied, validate the code + ordering phone pair before
  // creating an OTP. A code belonging to another phone is deliberately
  // reported as invalid and never receives a challenge.
  if (scopedOrderId) {
    const order = await (await getCollection<any>('DON_HANG')).findOne({ DON_HANG_ID: scopedOrderId, SDT_NGUOI_DAT: phonePattern(phone) }, { projection: { _id: 1 } });
    if (!order) throw new InventoryError(404, 'Mã đơn hàng không hợp lệ.');
  }
  if (scopedRequestId) {
    const request = await (await getCollection<any>('YEU_CAU_DAT_HANG')).findOne({ requestId: scopedRequestId, 'sender.phone': phonePattern(phone) }, { projection: { _id: 1 } });
    if (!request) throw new InventoryError(404, 'Mã yêu cầu đặt hàng không hợp lệ.');
  }
  if (process.env.ORDER_OTP_DELIVERY !== 'console' || process.env.NODE_ENV === 'production') {
    throw new InventoryError(503, 'Kênh gửi OTP chưa được cấu hình. Vui lòng liên hệ shop.');
  }
  const now = new Date();
  const challengeId = `otp_${randomBytes(24).toString('hex')}`;
  const otp = String(randomInt(100000, 1000000));
  const expiresAt = new Date(now.getTime() + 5 * 60000);
  const col = await getCollection<any>(ACCESS);
  const ipHash = hash(ip);
  // Atomic rate buckets avoid the previous read/update transaction round trips.
  const windowStart = new Date(now.getTime() - 10 * 60000);
  const rateExpiresAt = new Date(now.getTime() + 10 * 60000);
  const rateOperation = (key: string, limit: number, cooldown: number) => {
    const filter: any = { _id: key, $and: [
      { $or: [{ windowAt: { $exists: false } }, { windowAt: { $lt: windowStart } }, { count: { $lt: limit } }] },
      ...(cooldown ? [{ $or: [{ lastSentAt: { $exists: false } }, { lastSentAt: { $lt: new Date(now.getTime() - cooldown) } }] }] : []),
    ] };
    return { updateOne: { filter, update: [{ $set: {
        kind: 'rate',
        windowAt: { $cond: [{ $gte: [{ $ifNull: ['$windowAt', new Date(0)] }, windowStart] }, '$windowAt', now] },
        count: { $cond: [{ $gte: [{ $ifNull: ['$windowAt', new Date(0)] }, windowStart] }, { $add: [{ $ifNull: ['$count', 0] }, 1] }, 1] },
        lastSentAt: now, expiresAt: rateExpiresAt,
      } }], upsert: true } } as any;
  };
  try {
    // One ordered command: if a rate bucket is blocked, duplicate-key stops the
    // command before old OTPs are consumed or a new challenge is inserted.
    await col.bulkWrite([
      rateOperation(`phone:${phone}`, 5, 60000),
      rateOperation(`ip:${ipHash}`, 15, 0),
      { updateMany: { filter: { kind: 'otp', phone, consumed: false }, update: { $set: { consumed: true } } } },
      { insertOne: { document: { _id: challengeId, kind: 'otp', phone, ...(scopedOrderId?{orderId:scopedOrderId}:{}), ...(scopedRequestId?{requestId:scopedRequestId}:{}), codeHash: hash(`${challengeId}:${otp}`), attempts: 0, consumed: false, createdAt: now, expiresAt } } },
    ], { ordered: true });
  } catch (error: any) {
    if (error?.code === 11000) throw new InventoryError(429, 'Bạn đang yêu cầu mã quá nhanh. Vui lòng chờ 60 giây rồi thử lại.');
    throw error;
  }
  // Explicit local development transport. Never return the code in an API response.
  console.info(`[ORDER OTP - LOCAL] ${phone}: ${otp} (hiệu lực 5 phút)`);
  if (process.env.ORDER_OTP_LOG_FILE && !process.env.TEST_MONGO_URI) {
    void writeFile(process.env.ORDER_OTP_LOG_FILE, `OTP tra cứu đơn (LOCAL)\nSố điện thoại: ${phone}\nMã OTP: ${otp}\nHết hạn: ${expiresAt.toISOString()}\n`, 'utf8').catch(() => {});
  }
  return { challengeId, expiresAt, resendAfterSeconds: 60, delivery: 'console', message: 'Mã xác thực đã được tạo. Môi trường local: xem OTP trong terminal backend.' };
}
export async function verifyOrderOtp(challengeId: unknown, code: unknown) {
  if (!/^otp_[a-f0-9]{48}$/.test(String(challengeId)) || !/^\d{6}$/.test(String(code))) throw new InventoryError(400, 'Mã xác thực không hợp lệ.');
  const col = await getCollection<any>(ACCESS);
  const now = new Date();
  const expectedHash = hash(`${challengeId}:${code}`);
  // Verify and consume the challenge atomically in one Atlas round trip.
  const row = await col.findOneAndUpdate({ _id: challengeId, kind: 'otp', codeHash: expectedHash,
    consumed: false, expiresAt: { $gt: now }, attempts: { $lt: 5 } },
    { $inc: { attempts: 1 }, $set: { consumed: true } }, { returnDocument: 'after' });
  if (!row) {
    // Record a wrong attempt asynchronously; the response does not wait for it.
    void col.updateOne({ _id: challengeId, kind: 'otp', consumed: false, expiresAt: { $gt: now }, attempts: { $lt: 5 } },
      { $inc: { attempts: 1 } }).catch(() => {});
    throw new InventoryError(400, 'Mã xác thực không đúng, đã hết hạn hoặc hết lượt thử.');
  }
  const token = `oa_${randomBytes(32).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 30 * 60000);
  await col.insertOne({ _id: hash(token), kind: 'lookup', authType: 'guest_lookup', readOnly: true, phone: row.phone, ...(row.orderId?{orderId:row.orderId}:{}), ...(row.requestId?{requestId:row.requestId}:{}), createdAt: new Date(), expiresAt });
  return { accessToken: token, authType: 'guest_lookup', readOnly: true, phone: row.phone, ...(row.orderId?{orderId:row.orderId}:{}), ...(row.requestId?{requestId:row.requestId}:{}), expiresAt };
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
  : access.orderId ? { _id:'__ORDER_ONLY__' }
  : access.requestId ? { requestId: access.requestId, 'sender.phone': phonePattern(access.phone) }
  // KH34 authorizes the ordering phone, not the way the checkout was created.
  // The same phone can have older Guest rows and newer rows linked to an
  // account; after OTP verification both belong to the same lookup scope.
  : { 'sender.phone': phonePattern(access.phone) };
export async function ownedOrderQuery(access: any): Promise<any> {
  if (access.kind === 'request') {
    const request = await (await getCollection<any>('YEU_CAU_DAT_HANG')).findOne({ requestId: access.requestId, customerId: { $in: [null, ''] } });
    return { DON_HANG_ID: request?.orderId || '__DENIED__', KHACH_HANG_ID: { $in: [null, ''] } };
  }
  if (access.requestId) return { DON_HANG_ID: '__REQUEST_ONLY__', KHACH_HANG_ID: { $in: [null, ''] } };
  if (access.orderId) return { DON_HANG_ID: access.orderId, SDT_NGUOI_DAT: phonePattern(access.phone) };
  return access.authType === 'member' ? { KHACH_HANG_ID: access.customerId } : await orderPhoneQuery(access.phone);
}
export async function requestByVerifiedPhone(id: string, token: string, session?: ClientSession) {
  const access = await lookupAccess(token, session);
  const row = await (await getCollection<any>('YEU_CAU_DAT_HANG')).findOne({ _id: id, ...ownedRequestQuery(access) }, { session });
  if (!row) throw new InventoryError(404, 'Không tìm thấy yêu cầu trong phạm vi được phép.');
  return row;
}
export async function orderPhoneQuery(phone: string) {
  // Do not exclude account-linked orders here. Guest lookup is a read-only OTP
  // scope over SDT_NGUOI_DAT, so ownership is established by the verified
  // ordering phone itself.
  return { SDT_NGUOI_DAT: phonePattern(phone) };
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
