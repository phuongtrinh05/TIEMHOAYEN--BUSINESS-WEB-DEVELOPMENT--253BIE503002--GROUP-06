import { Router, Request } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../utils/passwordHash.js';
import { active, audit, AuthError, endpoint, permissions, revokeAllSessions } from '../services/auth.service.js';
import { defaultRolePermissions, permissionActions, permissionModules, resolveRoleName, setRolePermissionOverride } from '../services/role-permission.service.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';

export const accountAdministration = Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^0\d{9}$/;
// AD52/AD54: trạng thái nhân viên. Không xóa cứng tài khoản đã có lịch sử thao tác.
const STAFF_STATUSES = ['Hoạt động', 'Bị khóa', 'Nghỉ việc'];
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const requester = (req: Request) => req.identity?.account || {};
const requesterIsAdmin = (req: Request) => resolveRoleName(requester(req).VAI_TRO) === 'Admin';

async function assertUniqueContact(email: string | undefined, phone: string | undefined, exceptId?: string) {
  const or: any[] = [];
  if (email) or.push({ EMAIL: { $regex: `^${escapePattern(email)}$`, $options: 'i' } });
  if (phone) or.push({ SDT: phone });
  if (!or.length) return;
  const filter: any = { $or: or };
  if (exceptId) filter.NHAN_VIEN_ID = { $ne: exceptId };
  if (await (await getCollection<any>('NHAN_VIEN')).findOne(filter, { projection: { _id: 1 } })) throw new AuthError(409, 'Email hoặc số điện thoại đã thuộc về nhân viên khác.');
}

// Còn ít nhất một Admin khác đang hoạt động thì mới được hạ quyền/khóa một Admin.
async function assertAnotherActiveAdmin(exceptId: string) {
  const admins = await (await getCollection<any>('NHAN_VIEN')).find({ NHAN_VIEN_ID: { $ne: exceptId }, DA_XOA: { $ne: true } }).toArray();
  if (!admins.some(row => resolveRoleName(row.VAI_TRO) === 'Admin' && active(row))) {
    throw new AuthError(400, 'Phải luôn còn ít nhất một quản trị viên cao nhất đang hoạt động.');
  }
}

accountAdministration.post('/staff-accounts', requireAdminPermission('permissions', 'grant'), endpoint(async (req, res) => {
  const name = String(req.body.HO_TEN || '').trim().replace(/\s+/g, ' ');
  const email = String(req.body.EMAIL || '').trim().toLowerCase();
  const phone = String(req.body.SDT || '').replace(/[\s.-]/g, '');
  const role = String(req.body.VAI_TRO || '');
  if (!name || name.length > 100) throw new AuthError(400, 'Họ tên bắt buộc, tối đa 100 ký tự.', { field: 'name' });
  if (!EMAIL.test(email)) throw new AuthError(400, 'Email không hợp lệ.', { field: 'email' });
  if (!PHONE.test(phone)) throw new AuthError(400, 'Số điện thoại cần 10 chữ số, bắt đầu bằng 0.', { field: 'phone' });
  if (!Object.hasOwn(defaultRolePermissions, role)) throw new AuthError(400, 'Nhóm quyền không hợp lệ.', { field: 'role' });
  if (role === 'Admin' && !requesterIsAdmin(req)) throw new AuthError(403, 'Chỉ quản trị viên cao nhất được tạo tài khoản Admin.');
  await assertUniqueContact(email, phone);
  const id = await getNextPrefixedId('NHAN_VIEN', 'NHAN_VIEN_ID', 'NV', 3);
  await (await getCollection<any>('NHAN_VIEN')).insertOne({
    _id: id, NHAN_VIEN_ID: id, HO_TEN: name, EMAIL: email, SDT: phone, VAI_TRO: role, NGAY_TAO: new Date(),
    TRANG_THAI: 'Hoạt động', NGUOI_TAO_ID: req.identity?.id || null, MAT_KHAU: await hashPassword(randomBytes(32).toString('hex')),
  });
  await audit(req, 'TAO_NHAN_VIEN', id, { HO_TEN: name, EMAIL: email, VAI_TRO: role });
  res.status(201).json({ message: 'Đã tạo nhân viên. Nhân viên bấm "Gửi mã xác thực" ở trang đăng nhập với email này để đặt mật khẩu.', NHAN_VIEN_ID: id });
}));

accountAdministration.patch('/staff-accounts/:id', requireAdminPermission('permissions', 'grant'), endpoint(async (req, res) => {
  const id = String(req.params.id);
  if (id === req.identity?.id) throw new AuthError(400, 'Không thể tự đổi quyền hoặc khóa tài khoản đang đăng nhập.');
  const c = await getCollection<any>('NHAN_VIEN');
  const before = await c.findOne({ NHAN_VIEN_ID: id });
  if (!before) throw new AuthError(404, 'Không tìm thấy nhân viên.');
  const changes: Record<string, any> = {};
  if (req.body.HO_TEN !== undefined) {
    const value = String(req.body.HO_TEN).trim().replace(/\s+/g, ' ');
    if (!value || value.length > 100) throw new AuthError(400, 'Họ tên bắt buộc, tối đa 100 ký tự.', { field: 'name' });
    changes.HO_TEN = value;
  }
  if (req.body.EMAIL !== undefined) {
    const value = String(req.body.EMAIL).trim().toLowerCase();
    if (!EMAIL.test(value)) throw new AuthError(400, 'Email không hợp lệ.', { field: 'email' });
    changes.EMAIL = value;
  }
  if (req.body.SDT !== undefined) {
    const value = String(req.body.SDT).replace(/[\s.-]/g, '');
    if (!PHONE.test(value)) throw new AuthError(400, 'Số điện thoại cần 10 chữ số, bắt đầu bằng 0.', { field: 'phone' });
    changes.SDT = value;
  }
  if (req.body.VAI_TRO !== undefined) {
    if (!Object.hasOwn(defaultRolePermissions, req.body.VAI_TRO)) throw new AuthError(400, 'Nhóm quyền không hợp lệ.', { field: 'role' });
    changes.VAI_TRO = req.body.VAI_TRO;
  }
  if (req.body.TRANG_THAI !== undefined) {
    const status = req.body.TRANG_THAI === 'Ngừng hoạt động' ? 'Bị khóa' : String(req.body.TRANG_THAI);
    if (!STAFF_STATUSES.includes(status)) throw new AuthError(400, 'Trạng thái không hợp lệ.', { field: 'status' });
    changes.TRANG_THAI = status;
    if (status !== 'Hoạt động') {
      const reason = String(req.body.LY_DO || '').trim();
      if (reason.length > 300) throw new AuthError(400, 'Lý do tối đa 300 ký tự.', { field: 'reason' });
      changes.LY_DO_TRANG_THAI = reason || null;
    }
  }
  // Bỏ các trường không đổi để nhật ký chỉ ghi thay đổi thật.
  for (const key of Object.keys(changes)) if (String(changes[key] ?? '') === String(before[key] ?? '')) delete changes[key];
  if (!Object.keys(changes).length) throw new AuthError(400, 'Chưa có thay đổi.');

  const targetIsAdmin = resolveRoleName(before.VAI_TRO) === 'Admin';
  if ((targetIsAdmin || changes.VAI_TRO === 'Admin') && !requesterIsAdmin(req)) throw new AuthError(403, 'Chỉ quản trị viên cao nhất được thay đổi tài khoản Admin.');
  if (targetIsAdmin && ((changes.VAI_TRO && changes.VAI_TRO !== 'Admin') || (changes.TRANG_THAI && changes.TRANG_THAI !== 'Hoạt động'))) await assertAnotherActiveAdmin(id);
  await assertUniqueContact(changes.EMAIL, changes.SDT, id);

  changes.NGAY_CAP_NHAT = new Date();
  changes.NGUOI_CAP_NHAT_ID = req.identity?.id || null;
  await c.updateOne({ NHAN_VIEN_ID: id }, { $set: changes });
  // Đổi quyền, trạng thái hoặc email đăng nhập thì đăng xuất nhân viên khỏi mọi thiết bị.
  const revoke = ['VAI_TRO', 'TRANG_THAI', 'EMAIL'].some(key => key in changes);
  if (revoke) await revokeAllSessions('NHAN_VIEN', id);
  const tracked = Object.keys(changes).filter(key => !['NGAY_CAP_NHAT', 'NGUOI_CAP_NHAT_ID'].includes(key));
  await audit(req, changes.TRANG_THAI ? 'DOI_TRANG_THAI_NHAN_VIEN' : changes.VAI_TRO ? 'DOI_NHOM_QUYEN_NHAN_VIEN' : 'CAP_NHAT_NHAN_VIEN', id, {
    truoc: Object.fromEntries(tracked.map(key => [key, before[key] ?? null])),
    sau: Object.fromEntries(tracked.map(key => [key, changes[key]])),
  });
  res.json({ message: revoke ? 'Đã cập nhật nhân viên và đăng xuất nhân viên khỏi các phiên cũ.' : 'Đã cập nhật nhân viên.' });
}));

// AD52: Admin yêu cầu đặt lại mật khẩu. Mật khẩu cũ mất hiệu lực ngay, nhân viên tự đặt mới bằng OTP email.
accountAdministration.post('/staff-accounts/:id/reset-password', requireAdminPermission('permissions', 'grant'), endpoint(async (req, res) => {
  const id = String(req.params.id);
  if (id === req.identity?.id) throw new AuthError(400, 'Hãy dùng chức năng Đổi mật khẩu cho tài khoản của chính bạn.');
  const c = await getCollection<any>('NHAN_VIEN');
  const target = await c.findOne({ NHAN_VIEN_ID: id });
  if (!target) throw new AuthError(404, 'Không tìm thấy nhân viên.');
  if (resolveRoleName(target.VAI_TRO) === 'Admin' && !requesterIsAdmin(req)) throw new AuthError(403, 'Chỉ quản trị viên cao nhất được đặt lại mật khẩu tài khoản Admin.');
  await c.updateOne({ NHAN_VIEN_ID: id }, { $set: { MAT_KHAU: await hashPassword(randomBytes(32).toString('hex')), YEU_CAU_DAT_LAI_MAT_KHAU: new Date() }, $unset: { KHOA_DANG_NHAP_DEN: '' } });
  await revokeAllSessions('NHAN_VIEN', id);
  await audit(req, 'YEU_CAU_DAT_LAI_MAT_KHAU', id);
  res.json({ message: `Đã vô hiệu mật khẩu cũ và đăng xuất ${target.HO_TEN || id}. Nhân viên bấm "Gửi mã xác thực" ở trang đăng nhập để đặt mật khẩu mới.` });
}));

// AD53: chỉ quản trị viên cao nhất (Admin) được sửa ma trận quyền.
accountAdministration.put('/role-permissions/:role', requireAdminPermission('permissions', 'grant'), endpoint(async (req, res) => {
  if (!requesterIsAdmin(req)) throw new AuthError(403, 'Chỉ quản trị viên cao nhất được thay đổi phân quyền.');
  const role = req.params.role;
  if (role === 'Admin' || !Object.hasOwn(defaultRolePermissions, role)) throw new AuthError(400, 'Nhóm quyền không hợp lệ hoặc được bảo vệ.');
  const matrix: any = {};
  for (const { key } of permissionModules) {
    matrix[key] = {};
    for (const action of permissionActions) {
      if (typeof req.body.QUYEN?.[key]?.[action] !== 'boolean') throw new AuthError(400, 'Cần đầy đủ ma trận quyền dạng true/false.');
      matrix[key][action] = req.body.QUYEN[key][action];
    }
    // Có quyền thao tác thì phải xem được module đó.
    if (permissionActions.some(action => action !== 'view' && matrix[key][action])) matrix[key].view = true;
  }
  const before = await permissions(role);
  await (await getCollection<any>('NHOM_QUYEN')).updateOne({ _id: role }, { $set: { VAI_TRO: role, QUYEN: matrix, NGAY_CAP_NHAT: new Date(), NGUOI_CAP_NHAT_ID: req.identity?.id || null } }, { upsert: true });
  setRolePermissionOverride(role, matrix);
  const changed = Object.fromEntries(permissionModules.flatMap(({ key }) => permissionActions
    .filter(action => Boolean(before?.[key]?.[action]) !== matrix[key][action])
    .map(action => [`${key}.${action}`, { truoc: Boolean(before?.[key]?.[action]), sau: matrix[key][action] }])));
  await audit(req, 'CAP_NHAT_NHOM_QUYEN', role, { thayDoi: changed });
  res.json({ message: 'Đã lưu phân quyền. Quyền mới áp dụng từ thao tác tiếp theo của nhân viên.', permissions: matrix });
}));

// AD55: tra cứu nhật ký. Chỉ đọc, không có API sửa/xóa nhật ký.
accountAdministration.get('/audit-logs', requireAdminPermission('system', 'view'), endpoint(async (req, res) => {
  const filter: any = {};
  const text = (key: string) => typeof req.query[key] === 'string' ? String(req.query[key]).trim().slice(0, 100) : '';
  if (text('actor')) filter.NGUOI_THUC_HIEN_ID = text('actor');
  if (text('target')) filter.DOI_TUONG_ID = text('target');
  if (text('action')) filter.HANH_DONG = text('action');
  if (text('result')) filter.KET_QUA = text('result') === 'fail' ? 'That bai' : 'Thanh cong';
  const from = text('from') ? new Date(`${text('from')}T00:00:00+07:00`) : null;
  const to = text('to') ? new Date(`${text('to')}T23:59:59.999+07:00`) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw new AuthError(400, 'Khoảng thời gian không hợp lệ.');
  if (from || to) filter.THOI_GIAN = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (text('search')) {
    const s = escapePattern(text('search'));
    filter.$or = [
      { NGUOI_THUC_HIEN_ID: { $regex: s, $options: 'i' } },
      { DOI_TUONG_ID: { $regex: s, $options: 'i' } },
      { HANH_DONG: { $regex: s, $options: 'i' } },
    ];
  }
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || 20)));
  const coll = await getCollection<any>('NHAT_KY_HE_THONG');
  const [total, logs, actions] = await Promise.all([
    coll.countDocuments(filter),
    coll.find(filter).sort({ THOI_GIAN: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    coll.distinct('HANH_DONG'),
  ]);
  const staffIds = [...new Set(logs.filter(log => log.LOAI_NGUOI_THUC_HIEN === 'NHAN_VIEN').map(log => log.NGUOI_THUC_HIEN_ID).filter(Boolean))];
  const customerIds = [...new Set(logs.filter(log => log.LOAI_NGUOI_THUC_HIEN === 'KHACH_HANG').map(log => log.NGUOI_THUC_HIEN_ID).filter(Boolean))];
  const [staff, customers] = await Promise.all([
    staffIds.length ? (await getCollection<any>('NHAN_VIEN')).find({ NHAN_VIEN_ID: { $in: staffIds } }, { projection: { NHAN_VIEN_ID: 1, HO_TEN: 1, VAI_TRO: 1 } }).toArray() : [],
    customerIds.length ? (await getCollection<any>('KHACH_HANG')).find({ KHACH_HANG_ID: { $in: customerIds } }, { projection: { KHACH_HANG_ID: 1, TEN: 1 } }).toArray() : [],
  ]);
  const staffById = new Map(staff.map(row => [row.NHAN_VIEN_ID, row]));
  const customerById = new Map(customers.map(row => [row.KHACH_HANG_ID, row]));
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    total, page, limit, actions: actions.filter(Boolean).sort(),
    logs: logs.map(log => {
      const person = log.LOAI_NGUOI_THUC_HIEN === 'NHAN_VIEN' ? staffById.get(log.NGUOI_THUC_HIEN_ID) : customerById.get(log.NGUOI_THUC_HIEN_ID);
      return {
        ...log,
        TEN_NGUOI_THUC_HIEN: person?.HO_TEN || person?.TEN || '',
        VAI_TRO_NGUOI_THUC_HIEN: log.LOAI_NGUOI_THUC_HIEN === 'NHAN_VIEN' ? (person?.VAI_TRO || 'Nhân viên') : log.LOAI_NGUOI_THUC_HIEN === 'KHACH_HANG' ? 'Khách hàng' : 'Khách',
      };
    }),
  });
}));
