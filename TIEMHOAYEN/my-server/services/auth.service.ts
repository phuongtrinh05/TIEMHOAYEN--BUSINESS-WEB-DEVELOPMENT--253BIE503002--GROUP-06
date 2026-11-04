import { sendGmailOtp } from './gmail-otp.service.js';
import { sendAppsScriptOtp } from './apps-script-otp.service.js';
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { getCollection } from '../mongo.js';
import { hashPassword, verifyPassword, isPasswordHash } from '../utils/passwordHash.js';
import { getRolePermissions, resolveRoleName } from './role-permission.service.js';

export type AccountType = 'KHACH_HANG' | 'NHAN_VIEN';
export type Identity = { id: string; type: AccountType; account: any; sessionId: string };
declare global { namespace Express { interface Request { identity?: Identity } } }
export class AuthError extends Error { constructor(public status: number, message: string) { super(message); } }
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const accountKey = (type: AccountType) => type === 'KHACH_HANG' ? 'KHACH_HANG_ID' : 'NHAN_VIEN_ID';
// Dữ liệu cũ dùng nhiều nhãn trạng thái hoạt động (Hoạt động, Đang hoạt động,
// Đang làm việc hoặc để trống). Chỉ từ chối các trạng thái vô hiệu đã biết để
// việc xác thực phiên nhất quán với luồng đăng nhập hiện tại.
export const active = (row: any) => {
  if (!row || row.DA_XOA === true || row.DA_XOA === 1) return false;
  const status = String(row.TRANG_THAI || '').trim().toLowerCase();
  return !/(chờ xác minh|cho xac minh|bị khóa|bi khoa|khóa|khoa|ngừng|ngung|inactive|vô hiệu|vo hieu|đã xóa|da xoa|nghỉ việc|nghi viec)/i.test(status);
};
const collection = (name: string) => getCollection<any>(name);
export const endpoint = (handler: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try { await handler(req, res); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 500).json({ message: e instanceof AuthError ? e.message : 'Không thể xử lý yêu cầu. Vui lòng thử lại.' });
  }
};
export async function audit(req: Request, action: string, target: string, changes: Record<string, unknown> = {}, success = true) {
  await (await collection('NHAT_KY_HE_THONG')).insertOne({
    NHAT_KY_ID: randomBytes(16).toString('hex'), NGUOI_THUC_HIEN_ID: req.identity?.id || null,
    LOAI_NGUOI_THUC_HIEN: req.identity?.type || 'KHACH', HANH_DONG: action,
    DOI_TUONG_ID: target, THOI_GIAN: new Date(), KET_QUA: success ? 'Thanh cong' : 'That bai',
    // Callers supply an explicit allowlist, never request bodies or credentials.
    NOI_DUNG_THAY_DOI: changes,
  });
}
export async function createSession(type: AccountType, account: any) {
  const token = randomBytes(32).toString('hex');
  await (await collection('PHIEN_DANG_NHAP')).insertOne({
    _id: digest(token), LOAI_TAI_KHOAN: type, TAI_KHOAN_ID: account[accountKey(type)],
    PHIEN_BAN_MAT_KHAU: digest(String(account.MAT_KHAU)), NGAY_TAO: new Date(),
    HET_HAN: new Date(Date.now() + 8 * 3600_000), DA_THU_HOI: false,
  });
  return token;
}
const headerValue = (value: string | string[] | undefined) => String(Array.isArray(value) ? value[0] : value || '').trim();

// Phiên Admin của main (x-admin-session = as_...) -> danh tính NHAN_VIEN.
async function identifyAdminSession(req: Request): Promise<Identity | undefined> {
  const token = headerValue(req.headers['x-admin-session']);
  if (!/^as_[a-f0-9]{64}$/.test(token)) return undefined;
  const row = await (await collection('PHIEN_DANG_NHAP_ADMIN')).findOne({ _id: digest(token), expiresAt: { $gt: new Date() } });
  if (!row?.employeeId) return undefined;
  const account = await (await collection('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: row.employeeId });
  if (!active(account)) return undefined;
  return { id: account.NHAN_VIEN_ID, type: 'NHAN_VIEN', account, sessionId: row._id };
}

// Phiên thành viên của main (oa_..., authType member) -> danh tính KHACH_HANG.
// Phiên tra cứu OTP của khách vãng lai không được coi là đăng nhập.
async function identifyMemberSession(req: Request): Promise<Identity | undefined> {
  const bearer = req.headers.authorization?.match(/^Bearer (oa_[a-f0-9]{64})$/)?.[1] || '';
  const token = bearer || headerValue(req.headers['x-order-access']);
  if (!/^oa_[a-f0-9]{64}$/.test(token)) return undefined;
  const row = await (await collection('XAC_THUC_TRA_CUU_DON')).findOne({ _id: digest(token), kind: 'lookup', authType: 'member', expiresAt: { $gt: new Date() } });
  if (!row?.customerId) return undefined;
  const account = await (await collection('KHACH_HANG')).findOne({ KHACH_HANG_ID: row.customerId });
  if (!active(account)) return undefined;
  return { id: account.KHACH_HANG_ID, type: 'KHACH_HANG', account, sessionId: row._id };
}

export async function identify(req: Request): Promise<Identity | undefined> {
  const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  if (!token) return (await identifyAdminSession(req)) || (await identifyMemberSession(req));
  const row = await (await collection('PHIEN_DANG_NHAP')).findOne({ _id: digest(token), DA_THU_HOI: false, HET_HAN: { $gt: new Date() } });
  if (!row || !['KHACH_HANG', 'NHAN_VIEN'].includes(row.LOAI_TAI_KHOAN)) return undefined;
  const account = await (await collection(row.LOAI_TAI_KHOAN)).findOne({ [accountKey(row.LOAI_TAI_KHOAN)]: row.TAI_KHOAN_ID });
  if (!active(account) || digest(String(account.MAT_KHAU)) !== row.PHIEN_BAN_MAT_KHAU) return undefined;
  return { id: row.TAI_KHOAN_ID, type: row.LOAI_TAI_KHOAN, account, sessionId: row._id };
}
export async function requireIdentity(req: Request, res: Response, next: NextFunction) {
  try { req.identity = await identify(req); if (!req.identity) { res.status(401).json({ message: 'Vui lòng đăng nhập lại.' }); return; } next(); }
  catch { res.status(503).json({ message: 'Không thể xác thực phiên.' }); }
}
export async function permissions(role: string) {
  const row = await (await collection('NHOM_QUYEN')).findOne({ VAI_TRO: resolveRoleName(role) });
  return row?.QUYEN || getRolePermissions(role);
}
export async function allowed(identity: Identity | undefined, module: string, action: string) {
  if (identity?.type !== 'NHAN_VIEN') return false;
  if (resolveRoleName(identity.account.VAI_TRO) === 'Admin') return true;
  return Boolean((await permissions(identity.account.VAI_TRO))?.[module]?.[action]);
}
export async function rateLimit(key: string, max: number, seconds: number) {
  if (process.env.ORDER_OTP_DELIVERY === 'console' || process.env.NODE_ENV !== 'production') {
    return;
  }
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const row = await (await collection('GIOI_HAN_XAC_THUC')).findOneAndUpdate(
    { _id: digest(`${key}:${bucket}`) }, { $inc: { SO_LAN: 1 }, $setOnInsert: { HET_HAN: new Date((bucket + 2) * seconds * 1000) } },
    { upsert: true, returnDocument: 'after' });
  if (row.SO_LAN > max) throw new AuthError(429, 'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau.');
}
export async function login(type: AccountType, req: Request) {
  const identifier = String(type === 'KHACH_HANG' ? req.body.SDT || '' : req.body.email || '').trim();
  const password = String(type === 'KHACH_HANG' ? req.body.MAT_KHAU || '' : req.body.password || '');
  await rateLimit(`login:${type}:${identifier}`, 5, 900);
  await rateLimit(`login-ip:${req.ip}`, 30, 900);
  const account = await (await collection(type)).findOne(type === 'KHACH_HANG' ? { SDT: identifier } : { EMAIL: identifier });
  if (!account || !await verifyPassword(password, account.MAT_KHAU)) {
    await audit(req, 'DANG_NHAP', type, {}, false);
    throw new AuthError(401, 'Thông tin đăng nhập không đúng.');
  }
  if (!active(account)) throw new AuthError(403, 'Tài khoản chưa xác minh hoặc đã bị khóa.');
  if (!isPasswordHash(account.MAT_KHAU)) {
    const hashed = await hashPassword(password);
    const result = await (await collection(type)).updateOne({ [accountKey(type)]: account[accountKey(type)], MAT_KHAU: account.MAT_KHAU }, { $set: { MAT_KHAU: hashed } });
    if (!result.modifiedCount) throw new AuthError(409, 'Tài khoản đã thay đổi. Vui lòng đăng nhập lại.');
    account.MAT_KHAU = hashed;
  }
  const token = await createSession(type, account);
  req.identity = { id: account[accountKey(type)], type, account, sessionId: digest(token) };
  await audit(req, 'DANG_NHAP', req.identity.id);
  return { account, token };
}
function otpDigest(id: string, code: string) {
  const secret = process.env.AUTH_OTP_SECRET || 'tiem-hoa-yen-default-auth-otp-secret-key-2026-secure';
  return createHmac('sha256', secret).update(`${id}:${code}`).digest('hex');
}
export async function deliverOtp(email: string, code: string) {
  if (process.env.AUTH_OTP_DELIVERY === 'test' && process.env.NODE_ENV !== 'production' && /^mongodb:\/\/(127\.0\.0\.1|localhost):/.test(process.env.MONGO_URI || '') && /_LOCAL_TEST$/.test(process.env.MONGO_DATABASE || '')) {
    await (await collection('HOP_THU_THU_NGHIEM')).insertOne({ EMAIL: email, MA_OTP: code, NGAY_TAO: new Date() });
    return;
  }
  if (process.env.APPS_SCRIPT_OTP_URL) {
    try { await sendAppsScriptOtp(email, code); return; }
    catch { throw new AuthError(503, 'Chưa gửi được email xác minh. Vui lòng liên hệ shop hoặc thử lại sau.'); }
  }
  if (process.env.GMAIL_CLIENT_ID || process.env.GMAIL_SENDER) {
    try { await sendGmailOtp(email, code); return; }
    catch { throw new AuthError(503, 'Chưa gửi được email xác minh. Vui lòng liên hệ shop hoặc thử lại sau.'); }
  }
  if (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM) throw new AuthError(503, 'Chưa cấu hình gửi email. Vui lòng liên hệ quản trị viên.');
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to: [email], subject: 'Tiệm Hoa Yên - Mã xác minh', text: `Mã xác minh của bạn: ${code}. Không chia sẻ mã này với người khác.` }),
    signal: AbortSignal.timeout(15000),
  });
  if (!result.ok) throw new AuthError(503, 'Chưa gửi được email. Vui lòng thử lại sau.');
}
export async function deliverSmsOtp(phone: string, code: string) {
  if (process.env.AUTH_OTP_DELIVERY === 'console' || process.env.NODE_ENV !== 'production' && (process.env.AUTH_SMS_DELIVERY === 'console' || !process.env.AUTH_SMS_GATEWAY_URL)) {
    console.log(`[OTP SMS LOCAL] ${phone}: ${code} (hết hạn sau 60 giây)`);
    return;
  }
  if (process.env.AUTH_OTP_DELIVERY === 'test' && process.env.NODE_ENV !== 'production' && /^mongodb:\/\/(127\.0\.0\.1|localhost):/.test(process.env.MONGO_URI || '') && /_LOCAL_TEST$/.test(process.env.MONGO_DATABASE || '')) {
    await (await collection('HOP_THU_THU_NGHIEM')).insertOne({ SDT: phone, MA_OTP: code, NGAY_TAO: new Date() });
    return;
  }
  const url = process.env.AUTH_SMS_GATEWAY_URL;
  const secret = process.env.AUTH_SMS_GATEWAY_TOKEN;
  if (!url || !url.startsWith('https://') || !secret) throw new AuthError(503, 'Chưa cấu hình dịch vụ gửi SMS OTP. Vui lòng liên hệ quản trị viên.');
  const result = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phone.replace(/^0/, '+84'), message: `Tiem Hoa Yen: Ma OTP cua ban la ${code}. Het han sau 60 giay. Khong chia se ma nay.` }),
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (!result.ok) throw new AuthError(503, 'Chưa gửi được SMS. Vui lòng thử lại sau.');
}
export async function sendChallenge(type: AccountType, req: Request, purpose = 'KHOI_PHUC_MAT_KHAU') {
  const customerRecovery = type === 'KHACH_HANG' && purpose === 'KHOI_PHUC_MAT_KHAU';
  const identifier = String(customerRecovery ? req.body.SDT || '' : req.body.EMAIL || req.body.email || req.body.SDT || '').trim();
  if (customerRecovery && !/^0\d{9}$/.test(identifier)) throw new AuthError(400, 'Số điện thoại không hợp lệ.');
  await rateLimit(`otp-ip:${req.ip}`, 20, 3600);
  await rateLimit(`otp-account:${type}:${identifier}`, 5, 3600);
  const id = digest(`${type}:${purpose}:${identifier}`);
  otpDigest(id, 'configuration-check');
  const account = await (await collection(type)).findOne(identifier.includes('@') ? { EMAIL: identifier } : { SDT: identifier });
  if (!account || account.DA_XOA) throw new AuthError(404, 'Tài khoản chưa được đăng ký. Vui lòng kiểm tra lại thông tin.');
  const email = String(account.EMAIL || '').trim();
  const sms = type === 'KHACH_HANG' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!sms && !email) throw new AuthError(400, 'Tài khoản chưa có email nhận mã xác minh.');
  if (purpose === 'DANG_KY' ? account.TRANG_THAI !== 'Chờ xác minh' : !active(account)) {
    throw new AuthError(403, purpose === 'DANG_KY' ? 'Tài khoản không ở trạng thái chờ xác minh.' : 'Tài khoản chưa xác minh hoặc đã bị khóa.');
  }
  const challenges = await collection('XAC_THUC_TAI_KHOAN');
  const ttl = 60;
  let code = '';
  let stored = false;
  for (let attempt = 0; attempt < 5 && !stored; attempt++) {
    const previous = await challenges.findOne({ _id: id });
    do { code = String(randomInt(100000, 1000000)); } while (previous?.MA_BAM === otpDigest(id, code));
    try {
      const result = await challenges.updateOne(
        { _id: id, MA_BAM: previous?.MA_BAM ?? { $exists: false } },
        { $set: { MA_BAM: otpDigest(id, code), LOAI_TAI_KHOAN: type, TAI_KHOAN_ID: account[accountKey(type)], MUC_DICH: purpose, HET_HAN: new Date(Date.now() + ttl * 1000), SO_LAN_SAI: 0, GIOI_HAN_SAI: 5, DA_SU_DUNG: false, GUI_LAI_SAU: new Date() } },
        { upsert: !previous });
      stored = !!(result.matchedCount || result.upsertedCount);
    } catch (error: any) { if (error.code !== 11000) throw error; }
  }
  if (!stored) throw new AuthError(409, 'Có yêu cầu gửi mã mới hơn. Vui lòng thử lại.');
  try { if (sms) { console.log(`[OTP SMS] ${account.SDT}: ${code} (hết hạn sau 60 giây)`); } else await deliverOtp(email, code); }
  catch (error) { await challenges.updateOne({ _id: id, MA_BAM: otpDigest(id, code) }, { $set: { DA_SU_DUNG: true } }); throw error; }
  const maskedEmail = email.replace(/^(.).*(@.*)$/, '$1***$2');
  return { challengeId: id, expiresIn: ttl, resendAfter: 0, delivery: sms ? 'console' : 'email', message: sms ? 'Mã xác minh có hiệu lực trong 60 giây.' : `Mã xác minh đã được gửi đến email ${maskedEmail}.` };
}
export async function verifyChallenge(type: AccountType, req: Request, purpose = 'KHOI_PHUC_MAT_KHAU') {
  const id = String(req.body.challengeId || '');
  const code = String(req.body.OTP || '');
  const c = await collection('XAC_THUC_TAI_KHOAN');
  const filter = { _id: id, LOAI_TAI_KHOAN: type, MUC_DICH: purpose, DA_SU_DUNG: false, HET_HAN: { $gt: new Date() }, $expr: { $lt: ['$SO_LAN_SAI', '$GIOI_HAN_SAI'] } };
  const row = await c.findOneAndUpdate({ ...filter, MA_BAM: otpDigest(id, code) }, { $set: { DA_SU_DUNG: true } }, { returnDocument: 'before' });
  if (!row) { await c.updateOne(filter, { $inc: { SO_LAN_SAI: 1 } }); throw new AuthError(400, 'Mã không hợp lệ, đã hết hạn hoặc vượt số lần thử.'); }
  if (purpose === 'DANG_KY') {
    await (await collection(type)).updateOne({ [accountKey(type)]: row.TAI_KHOAN_ID, TRANG_THAI: 'Chờ xác minh' }, { $set: { TRANG_THAI: 'Hoạt động' } });
    await audit(req, 'XAC_MINH_DANG_KY', row.TAI_KHOAN_ID);
    return { message: 'Xác minh thành công. Bạn có thể đăng nhập.' };
  }
  const token = randomBytes(32).toString('hex');
  const account = await (await collection(type)).findOne({ [accountKey(type)]: row.TAI_KHOAN_ID });
  if (!active(account)) throw new AuthError(403, 'Tài khoản không hoạt động.');
  await c.insertOne({ _id: digest(token), MUC_DICH: 'DAT_LAI_MAT_KHAU', LOAI_TAI_KHOAN: type, TAI_KHOAN_ID: row.TAI_KHOAN_ID, PHIEN_BAN_MAT_KHAU: digest(String(account.MAT_KHAU)), HET_HAN: new Date(Date.now() + 300000), DA_SU_DUNG: false });
  return { resetToken: token, message: 'OTP hợp lệ.' };
}
export async function resetPassword(type: AccountType, req: Request) {
  const password = String(req.body.NEW_PASSWORD || '');
  if (password.length < 8 || password.length > 72) throw new AuthError(400, 'Mật khẩu cần từ 8 đến 72 ký tự.');
  const hashed = await hashPassword(password);
  const c = await collection('XAC_THUC_TAI_KHOAN');
  const row = await c.findOneAndUpdate({ _id: digest(String(req.body.resetToken || '')), LOAI_TAI_KHOAN: type, MUC_DICH: 'DAT_LAI_MAT_KHAU', DA_SU_DUNG: false, HET_HAN: { $gt: new Date() } }, { $set: { DA_SU_DUNG: true } }, { returnDocument: 'before' });
  if (!row) throw new AuthError(400, 'Vui lòng xác minh OTP trước khi đặt lại mật khẩu.');
  const account = await (await collection(type)).findOne({ [accountKey(type)]: row.TAI_KHOAN_ID });
  if (!active(account) || digest(String(account.MAT_KHAU)) !== row.PHIEN_BAN_MAT_KHAU) throw new AuthError(400, 'Tài khoản đã thay đổi. Vui lòng xác minh lại.');
  const result = await (await collection(type)).updateOne({ [accountKey(type)]: row.TAI_KHOAN_ID, MAT_KHAU: account.MAT_KHAU }, { $set: { MAT_KHAU: hashed } });
  if (!result.modifiedCount) throw new AuthError(400, 'Mật khẩu đã thay đổi. Vui lòng xác minh lại.');
  await (await collection('PHIEN_DANG_NHAP')).updateMany({ TAI_KHOAN_ID: row.TAI_KHOAN_ID, LOAI_TAI_KHOAN: type }, { $set: { DA_THU_HOI: true } });
  await audit(req, 'DAT_LAI_MAT_KHAU', row.TAI_KHOAN_ID);
  return { message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' };
}
