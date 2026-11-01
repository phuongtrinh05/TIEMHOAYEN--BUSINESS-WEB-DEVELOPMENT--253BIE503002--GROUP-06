import { Router } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../utils/passwordHash.js';
import { audit, AuthError, endpoint, permissions } from '../services/auth.service.js';
import { defaultRolePermissions, permissionActions, permissionModules } from '../services/role-permission.service.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';

export const accountAdministration = Router();
accountAdministration.post('/staff-accounts', requireAdminPermission('permissions', 'grant'), endpoint(async (req, res) => {
  const { HO_TEN, EMAIL, SDT, VAI_TRO } = req.body;
  if (!String(HO_TEN || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(EMAIL || '')) || !/^0\d{9}$/.test(String(SDT || '')) || !Object.hasOwn(defaultRolePermissions, VAI_TRO) || VAI_TRO === 'Admin') throw new AuthError(400, 'Thông tin nhân viên hoặc vai trò không hợp lệ.');
  const c = await getCollection<any>('NHAN_VIEN');
  if (await c.findOne({ $or: [{ EMAIL }, { SDT }] })) throw new AuthError(409, 'Email hoặc số điện thoại đã tồn tại.');
  const id = await getNextPrefixedId('NHAN_VIEN', 'NHAN_VIEN_ID', 'NV', 3);
  await c.insertOne({ _id: id, NHAN_VIEN_ID: id, HO_TEN: HO_TEN.trim(), EMAIL, SDT, VAI_TRO, NGAY_TAO: new Date(), TRANG_THAI: 'Hoạt động', MAT_KHAU: await hashPassword(randomBytes(32).toString('hex')) });
  await audit(req, 'TAO_NHAN_VIEN', id, { VAI_TRO });
  res.status(201).json({ message: 'Đã tạo nhân viên. Nhân viên dùng Quên mật khẩu với email này để thiết lập mật khẩu.', NHAN_VIEN_ID: id });
}));
accountAdministration.get('/audit-logs', requireAdminPermission('system', 'view'), endpoint(async (req, res) => {
  const filter: any = {};
  if (typeof req.query.actor === 'string' && req.query.actor.trim()) filter.NGUOI_THUC_HIEN_ID = req.query.actor.trim();
  if (typeof req.query.target === 'string' && req.query.target.trim()) filter.DOI_TUONG_ID = req.query.target.trim();
  if (typeof req.query.action === 'string' && req.query.action.trim()) filter.HANH_DONG = req.query.action.trim();
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    const s = req.query.search.trim();
    filter.$or = [
      { NGUOI_THUC_HIEN_ID: { $regex: s, $options: 'i' } },
      { DOI_TUONG_ID: { $regex: s, $options: 'i' } },
      { HANH_DONG: { $regex: s, $options: 'i' } },
    ];
  }
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || 20)));
  const coll = await getCollection('NHAT_KY_HE_THONG');
  const [total, logs] = await Promise.all([
    coll.countDocuments(filter),
    coll.find(filter).sort({ THOI_GIAN: -1 }).skip((page - 1) * limit).limit(limit).toArray()
  ]);
  res.json({ total, page, limit, logs });
}));
accountAdministration.patch('/staff-accounts/:id', requireAdminPermission('permissions', 'grant'), endpoint(async (req, res) => {
  if (req.params.id === req.identity!.id) throw new AuthError(400, 'Không thể tự đổi quyền hoặc khóa tài khoản đang đăng nhập.');
  const changes: any = {};
  for (const key of ['HO_TEN', 'EMAIL', 'SDT']) {
    if (req.body[key] !== undefined) {
      const value = String(req.body[key]).trim();
      if (!value || (key === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) || (key === 'SDT' && !/^0\d{9}$/.test(value))) throw new AuthError(400, 'Thông tin nhân viên không hợp lệ.');
      changes[key] = value;
    }
  }
  if (req.body.VAI_TRO !== undefined) {
    if (!Object.hasOwn(defaultRolePermissions, req.body.VAI_TRO)) throw new AuthError(400, 'Vai trò không hợp lệ.');
    changes.VAI_TRO = req.body.VAI_TRO;
  }
  if (req.body.TRANG_THAI !== undefined) {
    if (!['Hoạt động', 'Ngừng hoạt động'].includes(req.body.TRANG_THAI)) throw new AuthError(400, 'Trạng thái không hợp lệ.');
    changes.TRANG_THAI = req.body.TRANG_THAI;
  }
  if (!Object.keys(changes).length) throw new AuthError(400, 'Chưa có thay đổi.');
  const c = await getCollection<any>('NHAN_VIEN');
  const before = await c.findOne({ NHAN_VIEN_ID: req.params.id });
  if (!before) throw new AuthError(404, 'Không tìm thấy nhân viên.');
  const duplicates = ['EMAIL','SDT'].filter(k => changes[k]).map(k => ({ [k]: changes[k] }));
  if (duplicates.length && await c.findOne({ NHAN_VIEN_ID: { $ne: req.params.id }, $or: duplicates })) throw new AuthError(409, 'Email hoặc số điện thoại đã tồn tại.');
  // Keep the initial administrator role immutable here; avoids removing the last admin concurrently.
  if (before.VAI_TRO === 'Admin') throw new AuthError(400, 'Không thay đổi tài khoản quản trị gốc tại chức năng này.');
  await c.updateOne({ NHAN_VIEN_ID: req.params.id }, { $set: changes });
  await (await getCollection('PHIEN_DANG_NHAP')).updateMany({ TAI_KHOAN_ID: req.params.id, LOAI_TAI_KHOAN: 'NHAN_VIEN' }, { $set: { DA_THU_HOI: true } });
  await audit(req, 'CAP_NHAT_NHAN_VIEN', req.params.id, { truoc: Object.fromEntries(Object.keys(changes).map(k => [k, before[k]])), sau: changes });
  res.json({ message: 'Đã cập nhật nhân viên và thu hồi phiên cũ.' });
}));
accountAdministration.put('/role-permissions/:role', requireAdminPermission('permissions', 'grant'), endpoint(async (req, res) => {
  const role = req.params.role;
  if (role === 'Admin' || !Object.hasOwn(defaultRolePermissions, role)) throw new AuthError(400, 'Nhóm quyền không hợp lệ hoặc được bảo vệ.');
  const matrix: any = {};
  for (const { key } of permissionModules) {
    matrix[key] = {};
    for (const action of permissionActions) {
      if (typeof req.body.QUYEN?.[key]?.[action] !== 'boolean') throw new AuthError(400, 'Cần đầy đủ ma trận quyền dạng true/false.');
      matrix[key][action] = req.body.QUYEN[key][action];
    }
  }
  const before = await permissions(role);
  await (await getCollection<any>('NHOM_QUYEN')).updateOne({ _id: role }, { $set: { VAI_TRO: role, QUYEN: matrix } }, { upsert: true });
  await audit(req, 'CAP_NHAT_NHOM_QUYEN', role, { truoc: before, sau: matrix });
  res.json({ message: 'Đã lưu quyền. Backend áp dụng từ yêu cầu tiếp theo.' });
}));
