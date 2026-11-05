import { Router } from 'express';
import { getCollection } from '../mongo.js';
import { hashPassword, verifyPassword } from '../utils/passwordHash.js';
import { accountKey, assertStrongPassword, audit, AuthError, endpoint, login, permissions, PASSWORD_RULES, requireIdentity, resetPassword, revokeAllSessions, sendChallenge, verifyChallenge } from '../services/auth.service.js';

export const customerLogin = endpoint(async (req, res) => {
  const { account, token } = await login('KHACH_HANG', req);
  const { MAT_KHAU, ...customer } = account;
  res.json({ customer, token, message: 'Đăng nhập thành công.' });
});
export const employeeLogin = endpoint(async (req, res) => {
  const { account: a, token } = await login('NHAN_VIEN', req);
  res.json({ token, employee: { id: a.NHAN_VIEN_ID, name: a.HO_TEN, email: a.EMAIL, role: a.VAI_TRO, status: a.TRANG_THAI }, permissions: await permissions(a.VAI_TRO) });
});
export const customerSendOtp = endpoint(async (req, res) => res.json(await sendChallenge('KHACH_HANG', req, req.body.purpose === 'DANG_KY' ? 'DANG_KY' : undefined)));
export const customerVerifyOtp = endpoint(async (req, res) => res.json(await verifyChallenge('KHACH_HANG', req, req.body.purpose === 'DANG_KY' ? 'DANG_KY' : undefined)));
export const customerReset = endpoint(async (req, res) => res.json(await resetPassword('KHACH_HANG', req)));
export const authRoutes = Router();
authRoutes.post('/admin/send-otp', endpoint(async (req, res) => res.json(await sendChallenge('NHAN_VIEN', req))));
authRoutes.post('/admin/verify-otp', endpoint(async (req, res) => res.json(await verifyChallenge('NHAN_VIEN', req))));
authRoutes.post('/admin/reset-password', endpoint(async (req, res) => res.json(await resetPassword('NHAN_VIEN', req))));
// Quy tắc mật khẩu để giao diện hiển thị checklist đúng với kiểm tra phía server.
authRoutes.get('/password-rules', (_req, res) => res.json({ rules: PASSWORD_RULES.map(({ key, label }) => ({ key, label })) }));
authRoutes.use(requireIdentity);
authRoutes.get('/me', endpoint(async (req, res) => {
  const { MAT_KHAU, ...account } = req.identity!.account;
  res.json({ type: req.identity!.type, account });
}));
authRoutes.post('/logout', endpoint(async (req, res) => {
  await (await getCollection<any>('PHIEN_DANG_NHAP')).updateOne({ _id: req.identity!.sessionId }, { $set: { DA_THU_HOI: true } });
  await audit(req, 'DANG_XUAT', req.identity!.id);
  res.json({ message: 'Đã đăng xuất.' });
}));
authRoutes.post('/change-password', endpoint(async (req, res) => {
  const identity = req.identity!;
  const password = String(req.body.NEW_PASSWORD || '');
  if (!await verifyPassword(String(req.body.CURRENT_PASSWORD || ''), identity.account.MAT_KHAU)) throw new AuthError(400, 'Mật khẩu hiện tại không đúng.', { field: 'currentPassword' });
  assertStrongPassword(password);
  if (req.body.CONFIRM_PASSWORD !== undefined && req.body.CONFIRM_PASSWORD !== password) throw new AuthError(400, 'Mật khẩu xác nhận không khớp.', { field: 'confirmPassword' });
  if (await verifyPassword(password, identity.account.MAT_KHAU)) throw new AuthError(400, 'Mật khẩu mới phải khác mật khẩu hiện tại.', { field: 'password' });
  const result = await (await getCollection<any>(identity.type)).updateOne({ [accountKey(identity.type)]: identity.id, MAT_KHAU: identity.account.MAT_KHAU }, { $set: { MAT_KHAU: await hashPassword(password), NGAY_DOI_MAT_KHAU: new Date() } });
  if (!result.modifiedCount) throw new AuthError(409, 'Dữ liệu đã thay đổi. Vui lòng đăng nhập lại.');
  // Đổi mật khẩu thì thu hồi toàn bộ phiên, kể cả phiên hiện tại (KH19, AD01).
  await revokeAllSessions(identity.type, identity.id);
  await audit(req, 'DOI_MAT_KHAU', identity.id);
  res.json({ message: 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.' });
}));
