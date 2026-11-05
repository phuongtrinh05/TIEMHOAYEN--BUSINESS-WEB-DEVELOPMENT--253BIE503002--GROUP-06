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
export class AuthError extends Error { constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); } }
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
    if (e instanceof AuthError) { res.status(e.status).json({ ...e.extra, message: e.message }); return; }
    res.status(500).json({ message: 'Không thể xử lý yêu cầu. Vui lòng thử lại.' });
  }
};

// ===== Quy tắc mật khẩu dùng chung (KH01, KH05, AD01) =====
export const PASSWORD_RULES = [
  { key: 'length', label: 'từ 8 đến 72 ký tự', test: (p: string) => p.length >= 8 && p.length <= 72 },
  { key: 'lower', label: 'ít nhất 1 chữ thường', test: (p: string) => /[a-z]/.test(p) },
  { key: 'upper', label: 'ít nhất 1 chữ hoa', test: (p: string) => /[A-Z]/.test(p) },
  { key: 'digit', label: 'ít nhất 1 chữ số', test: (p: string) => /\d/.test(p) },
  { key: 'special', label: 'ít nhất 1 ký tự đặc biệt', test: (p: string) => /[^A-Za-z0-9\s]/.test(p) },
];
export function assertStrongPassword(password: string) {
  const missing = PASSWORD_RULES.filter(rule => !rule.test(password));
  if (missing.length) throw new AuthError(400, `Mật khẩu cần ${missing.map(rule => rule.label).join(', ')}.`, { field: 'password', failedRules: missing.map(rule => rule.key) });
}

// ===== Giới hạn đăng nhập sai và lần đăng nhập gần nhất (AD01, KH02) =====
export const MAX_LOGIN_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;
export const OTP_TTL_SECONDS = 60;
export const OTP_RESEND_SECONDS = 60;
export const otpAttemptLimit = (type: AccountType) => type === 'NHAN_VIEN' ? 3 : 5;
const firstHeader = (value: string | string[] | undefined) => String(Array.isArray(value) ? value[0] : value || '');
export const clientIp = (req: Request) => (firstHeader(req.headers?.['x-forwarded-for']).split(',')[0].trim() || req.ip || '').replace(/^::ffff:/, '');
export function describeDevice(userAgent: unknown) {
  const ua = String(userAgent || '');
  if (!ua) return 'Không xác định';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt khác';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Hệ điều hành khác';
  return `${browser} trên ${os}`;
}
export function assertLoginNotLocked(account: any) {
  const until = account?.KHOA_DANG_NHAP_DEN ? new Date(account.KHOA_DANG_NHAP_DEN) : null;
  if (until && until.getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
    throw new AuthError(429, `Bạn đã nhập sai mật khẩu quá ${MAX_LOGIN_FAILURES} lần. Vui lòng thử lại sau ${minutes} phút hoặc dùng Quên mật khẩu để đặt lại.`, { locked: true, retryAfterMinutes: minutes });
  }
}
// Ghi nhận một lần sai mật khẩu; khóa tạm khi chạm ngưỡng. Trả về số lần còn lại.
export async function recordLoginFailure(type: AccountType, account: any) {
  const c = await collection(type);
  const key = { [accountKey(type)]: account[accountKey(type)] };
  const row = await c.findOneAndUpdate(key, { $inc: { SO_LAN_DANG_NHAP_SAI: 1 } }, { returnDocument: 'after' });
  const failures = Number(row?.SO_LAN_DANG_NHAP_SAI || 0);
  if (failures >= MAX_LOGIN_FAILURES) {
    await c.updateOne(key, { $set: { SO_LAN_DANG_NHAP_SAI: 0, KHOA_DANG_NHAP_DEN: new Date(Date.now() + LOGIN_LOCK_MINUTES * 60000) } });
    return 0;
  }
  return MAX_LOGIN_FAILURES - failures;
}
export function wrongPasswordError(remaining: number, label = 'Thông tin đăng nhập không đúng.') {
  if (remaining <= 0) return new AuthError(429, `Bạn đã nhập sai mật khẩu quá ${MAX_LOGIN_FAILURES} lần. Tài khoản tạm khóa đăng nhập ${LOGIN_LOCK_MINUTES} phút. Vui lòng dùng Quên mật khẩu để đặt lại.`, { locked: true, retryAfterMinutes: LOGIN_LOCK_MINUTES });
  return new AuthError(401, `${label} Bạn còn ${remaining} lần thử.`, { remainingAttempts: remaining });
}
// Lưu lần đăng nhập hiện tại, trả về lần đăng nhập trước đó để hiển thị cho người dùng.
export async function recordLoginSuccess(type: AccountType, account: any, req: Request) {
  const previous = account?.DANG_NHAP_GAN_NHAT || null;
  const current = { THOI_GIAN: new Date(), IP: clientIp(req), THIET_BI: describeDevice(req.headers?.['user-agent']) };
  await (await collection(type)).updateOne({ [accountKey(type)]: account[accountKey(type)] }, { $set: { DANG_NHAP_GAN_NHAT: current, SO_LAN_DANG_NHAP_SAI: 0 }, $unset: { KHOA_DANG_NHAP_DEN: '' } });
  return previous ? { time: previous.THOI_GIAN, ip: previous.IP, device: previous.THIET_BI } : null;
}
// Thu hồi mọi loại phiên của một tài khoản (đổi/đặt lại mật khẩu, khóa tài khoản).
export async function revokeAllSessions(type: AccountType, accountId: string) {
  await (await collection('PHIEN_DANG_NHAP')).updateMany({ TAI_KHOAN_ID: accountId, LOAI_TAI_KHOAN: type }, { $set: { DA_THU_HOI: true } });
  if (type === 'NHAN_VIEN') {
    await (await collection('PHIEN_DANG_NHAP_ADMIN')).deleteMany({ employeeId: accountId });
    await (await collection('XAC_THUC_TRA_CUU_DON')).deleteMany({ kind: 'staff', employeeId: accountId });
  } else {
    await (await collection('XAC_THUC_TRA_CUU_DON')).deleteMany({ authType: 'member', customerId: accountId });
  }
}
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
  if (!account) {
    await audit(req, 'DANG_NHAP', type, {}, false);
    throw new AuthError(401, 'Thông tin đăng nhập không đúng.');
  }
  assertLoginNotLocked(account);
  if (!await verifyPassword(password, account.MAT_KHAU)) {
    await audit(req, 'DANG_NHAP', account[accountKey(type)], { LY_DO: 'Sai mật khẩu' }, false);
    throw wrongPasswordError(await recordLoginFailure(type, account));
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
  const lastLogin = await recordLoginSuccess(type, account, req);
  await audit(req, 'DANG_NHAP', req.identity.id, { IP: clientIp(req), THIET_BI: describeDevice(req.headers?.['user-agent']) });
  return { account, token, lastLogin };
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
  if (process.env.AUTH_OTP_DELIVERY === 'test' && process.env.NODE_ENV !== 'production' && /^mongodb:\/\/(127\.0\.0\.1|localhost):/.test(process.env.MONGO_URI || '') && /_LOCAL_TEST$/.test(process.env.MONGO_DATABASE || '')) {
    await (await collection('HOP_THU_THU_NGHIEM')).insertOne({ SDT: phone, MA_OTP: code, NGAY_TAO: new Date() });
    return;
  }
  const url = process.env.AUTH_SMS_GATEWAY_URL;
  const secret = process.env.AUTH_SMS_GATEWAY_TOKEN;
  const gatewayReady = !!url && url.startsWith('https://') && !!secret;
  // Chưa có dịch vụ SMS (hoặc chủ động chọn console): in mã ra terminal/log của server
  // (Render → Logs) để nhân viên đọc mã cho khách, thay vì báo lỗi.
  if (!gatewayReady || process.env.AUTH_OTP_DELIVERY === 'console' || process.env.AUTH_SMS_DELIVERY === 'console') {
    console.log(`[OTP SMS] ${phone}: ${code} (hết hạn sau 60 giây)`);
    return;
  }
  const result = await fetch(url!, {
    method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phone.replace(/^0/, '+84'), message: `Tiem Hoa Yen: Ma OTP cua ban la ${code}. Het han sau 60 giay. Khong chia se ma nay.` }),
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (!result.ok) throw new AuthError(503, 'Chưa gửi được SMS. Vui lòng thử lại sau.');
}
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maskEmail = (email: string) => email.replace(/^(.).*(@.*)$/, '$1***$2');
const maskPhone = (phone: string) => phone.replace(/^(\d{3})\d+(\d{3})$/, '$1****$2');
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Khách hàng quên mật khẩu: không tiết lộ tài khoản có tồn tại hay không (KH03).
const genericRecoveryResponse = () => ({
  challengeId: digest(randomBytes(16).toString('hex')), expiresIn: OTP_TTL_SECONDS, resendAfter: OTP_RESEND_SECONDS,
  attemptLimit: otpAttemptLimit('KHACH_HANG'), delivery: 'registered',
  message: `Nếu thông tin trùng khớp với tài khoản đã đăng ký, mã xác minh đã được gửi tới email/số điện thoại đã đăng ký. Mã có hiệu lực ${OTP_TTL_SECONDS} giây.`,
});
export async function sendChallenge(type: AccountType, req: Request, purpose = 'KHOI_PHUC_MAT_KHAU') {
  const customerRecovery = type === 'KHACH_HANG' && purpose === 'KHOI_PHUC_MAT_KHAU';
  const rawIdentifier = String(req.body.EMAIL || req.body.email || req.body.SDT || req.body.identifier || '').trim();
  const isEmail = rawIdentifier.includes('@');
  const identifier = isEmail ? rawIdentifier.toLowerCase() : rawIdentifier.replace(/[\s.-]/g, '');
  if (!identifier) throw new AuthError(400, type === 'NHAN_VIEN' ? 'Vui lòng nhập email.' : 'Vui lòng nhập số điện thoại hoặc email.');
  if (isEmail ? !EMAIL_PATTERN.test(identifier) : !/^0\d{9}$/.test(identifier)) throw new AuthError(400, isEmail ? 'Email không hợp lệ.' : 'Số điện thoại không hợp lệ.');
  await rateLimit(`otp-ip:${clientIp(req)}`, 20, 3600);
  await rateLimit(`otp-account:${type}:${identifier}`, 5, 3600);
  const id = digest(`${type}:${purpose}:${identifier}`);
  otpDigest(id, 'configuration-check');
  const query = isEmail ? { EMAIL: { $regex: `^${escapePattern(identifier)}$`, $options: 'i' } } : { SDT: identifier };
  const account = await (await collection(type)).findOne(query);
  const usable = account && !account.DA_XOA && (purpose === 'DANG_KY' ? account.TRANG_THAI === 'Chờ xác minh' : active(account));
  if (!usable) {
    if (customerRecovery) return genericRecoveryResponse();
    if (!account || account.DA_XOA) throw new AuthError(404, 'Không tìm thấy tài khoản với thông tin này. Vui lòng kiểm tra lại.');
    throw new AuthError(403, purpose === 'DANG_KY' ? 'Tài khoản không ở trạng thái chờ xác minh.' : 'Tài khoản chưa xác minh hoặc đã bị khóa.');
  }
  const email = String(account.EMAIL || '').trim();
  const sms = type === 'KHACH_HANG' && !EMAIL_PATTERN.test(email);
  if (!sms && !email) throw new AuthError(400, 'Tài khoản chưa có email nhận mã xác minh.');
  const challenges = await collection('XAC_THUC_TAI_KHOAN');
  const now = Date.now();
  const previous = await challenges.findOne({ _id: id });
  // Chờ 60 giây giữa hai lần gửi (KH04). Gửi lại thì mã cũ bị thay bằng mã mới.
  if (previous && !previous.DA_SU_DUNG && previous.GUI_LAI_SAU && new Date(previous.GUI_LAI_SAU).getTime() > now) {
    const wait = Math.ceil((new Date(previous.GUI_LAI_SAU).getTime() - now) / 1000);
    throw new AuthError(429, `Vui lòng chờ ${wait} giây trước khi gửi lại mã.`, { resendAfter: wait });
  }
  const attemptLimit = otpAttemptLimit(type);
  let code = '';
  let stored = false;
  for (let attempt = 0; attempt < 5 && !stored; attempt++) {
    const current = attempt === 0 ? previous : await challenges.findOne({ _id: id });
    do { code = String(randomInt(100000, 1000000)); } while (current?.MA_BAM === otpDigest(id, code));
    try {
      const result = await challenges.updateOne(
        { _id: id, MA_BAM: current?.MA_BAM ?? { $exists: false } },
        { $set: { MA_BAM: otpDigest(id, code), LOAI_TAI_KHOAN: type, TAI_KHOAN_ID: account[accountKey(type)], MUC_DICH: purpose, HET_HAN: new Date(now + OTP_TTL_SECONDS * 1000), SO_LAN_SAI: 0, GIOI_HAN_SAI: attemptLimit, DA_SU_DUNG: false, GUI_LUC: new Date(now), GUI_LAI_SAU: new Date(now + OTP_RESEND_SECONDS * 1000) } },
        { upsert: !current });
      stored = !!(result.matchedCount || result.upsertedCount);
    } catch (error: any) { if (error.code !== 11000) throw error; }
  }
  if (!stored) throw new AuthError(409, 'Có yêu cầu gửi mã mới hơn. Vui lòng thử lại.');
  try { if (sms) await deliverSmsOtp(String(account.SDT), code); else await deliverOtp(email, code); }
  catch (error) {
    // Gửi thất bại: hủy mã và cho phép gửi lại ngay.
    await challenges.updateOne({ _id: id, MA_BAM: otpDigest(id, code) }, { $set: { DA_SU_DUNG: true, GUI_LAI_SAU: new Date() } });
    throw error;
  }
  await audit(req, 'GUI_OTP', account[accountKey(type)], { MUC_DICH: purpose, KENH: sms ? 'SMS' : 'EMAIL' });
  if (customerRecovery) return { ...genericRecoveryResponse(), challengeId: id };
  return {
    challengeId: id, expiresIn: OTP_TTL_SECONDS, resendAfter: OTP_RESEND_SECONDS, attemptLimit, delivery: sms ? 'sms' : 'email',
    message: sms ? `Mã xác minh đã được gửi tới số điện thoại ${maskPhone(String(account.SDT))}. Mã có hiệu lực ${OTP_TTL_SECONDS} giây.`
      : `Mã xác minh đã được gửi đến email ${maskEmail(email)}. Mã có hiệu lực ${OTP_TTL_SECONDS} giây.`,
  };
}
export async function verifyChallenge(type: AccountType, req: Request, purpose = 'KHOI_PHUC_MAT_KHAU') {
  const id = String(req.body.challengeId || '');
  const code = String(req.body.OTP || req.body.otp || '').trim();
  if (!/^\d{6}$/.test(code)) throw new AuthError(400, 'Vui lòng nhập đủ 6 chữ số của mã xác minh.');
  const c = await collection('XAC_THUC_TAI_KHOAN');
  const current = await c.findOne({ _id: id, LOAI_TAI_KHOAN: type, MUC_DICH: purpose });
  if (!current || current.DA_SU_DUNG || new Date(current.HET_HAN).getTime() <= Date.now()) {
    throw new AuthError(400, 'Mã xác minh đã hết hạn hoặc không còn hiệu lực. Vui lòng bấm Gửi lại mã.', { expired: true });
  }
  const limit = Number(current.GIOI_HAN_SAI || otpAttemptLimit(type));
  if (Number(current.SO_LAN_SAI || 0) >= limit) {
    throw new AuthError(429, `Bạn đã nhập sai mã quá ${limit} lần. Vui lòng bấm Gửi lại mã để nhận mã mới.`, { attemptsExceeded: true, remainingAttempts: 0 });
  }
  const filter = { _id: id, LOAI_TAI_KHOAN: type, MUC_DICH: purpose, DA_SU_DUNG: false, HET_HAN: { $gt: new Date() }, $expr: { $lt: ['$SO_LAN_SAI', '$GIOI_HAN_SAI'] } };
  const row = await c.findOneAndUpdate({ ...filter, MA_BAM: otpDigest(id, code) }, { $set: { DA_SU_DUNG: true } }, { returnDocument: 'before' });
  if (!row) {
    const failed = await c.findOneAndUpdate(filter, { $inc: { SO_LAN_SAI: 1 } }, { returnDocument: 'after' });
    const remaining = Math.max(0, limit - Number(failed?.SO_LAN_SAI ?? limit));
    await audit(req, 'XAC_MINH_OTP', String(current.TAI_KHOAN_ID || ''), { MUC_DICH: purpose }, false);
    if (remaining <= 0) throw new AuthError(429, `Bạn đã nhập sai mã quá ${limit} lần. Vui lòng bấm Gửi lại mã để nhận mã mới.`, { attemptsExceeded: true, remainingAttempts: 0 });
    throw new AuthError(400, `Mã xác minh không đúng. Bạn còn ${remaining} lần thử.`, { remainingAttempts: remaining });
  }
  if (purpose === 'DANG_KY') {
    await (await collection(type)).updateOne({ [accountKey(type)]: row.TAI_KHOAN_ID, TRANG_THAI: 'Chờ xác minh' }, { $set: { TRANG_THAI: 'Hoạt động' } });
    await audit(req, 'XAC_MINH_DANG_KY', row.TAI_KHOAN_ID);
    return { message: 'Xác minh thành công. Bạn có thể đăng nhập.' };
  }
  const token = randomBytes(32).toString('hex');
  const account = await (await collection(type)).findOne({ [accountKey(type)]: row.TAI_KHOAN_ID });
  if (!active(account)) throw new AuthError(403, 'Tài khoản không hoạt động.');
  await c.insertOne({ _id: digest(token), MUC_DICH: 'DAT_LAI_MAT_KHAU', LOAI_TAI_KHOAN: type, TAI_KHOAN_ID: row.TAI_KHOAN_ID, PHIEN_BAN_MAT_KHAU: digest(String(account.MAT_KHAU)), HET_HAN: new Date(Date.now() + 300000), DA_SU_DUNG: false });
  await audit(req, 'XAC_MINH_OTP', row.TAI_KHOAN_ID, { MUC_DICH: purpose });
  return { resetToken: token, expiresIn: 300, message: 'Mã xác minh hợp lệ. Vui lòng đặt mật khẩu mới trong 5 phút.' };
}
export async function resetPassword(type: AccountType, req: Request) {
  const password = String(req.body.NEW_PASSWORD || '');
  assertStrongPassword(password);
  const hashed = await hashPassword(password);
  const c = await collection('XAC_THUC_TAI_KHOAN');
  const row = await c.findOneAndUpdate({ _id: digest(String(req.body.resetToken || '')), LOAI_TAI_KHOAN: type, MUC_DICH: 'DAT_LAI_MAT_KHAU', DA_SU_DUNG: false, HET_HAN: { $gt: new Date() } }, { $set: { DA_SU_DUNG: true } }, { returnDocument: 'before' });
  if (!row) throw new AuthError(400, 'Phiên đặt lại mật khẩu đã hết hạn. Vui lòng xác minh OTP lại.', { expired: true });
  const account = await (await collection(type)).findOne({ [accountKey(type)]: row.TAI_KHOAN_ID });
  if (!active(account) || digest(String(account.MAT_KHAU)) !== row.PHIEN_BAN_MAT_KHAU) throw new AuthError(400, 'Tài khoản đã thay đổi. Vui lòng xác minh lại.');
  if (await verifyPassword(password, account.MAT_KHAU)) throw new AuthError(400, 'Mật khẩu mới phải khác mật khẩu hiện tại.', { field: 'password' });
  const result = await (await collection(type)).updateOne({ [accountKey(type)]: row.TAI_KHOAN_ID, MAT_KHAU: account.MAT_KHAU }, { $set: { MAT_KHAU: hashed, SO_LAN_DANG_NHAP_SAI: 0, NGAY_DOI_MAT_KHAU: new Date() }, $unset: { KHOA_DANG_NHAP_DEN: '' } });
  if (!result.modifiedCount) throw new AuthError(400, 'Mật khẩu đã thay đổi. Vui lòng xác minh lại.');
  await revokeAllSessions(type, row.TAI_KHOAN_ID);
  await audit(req, 'DAT_LAI_MAT_KHAU', row.TAI_KHOAN_ID);
  return { message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' };
}
