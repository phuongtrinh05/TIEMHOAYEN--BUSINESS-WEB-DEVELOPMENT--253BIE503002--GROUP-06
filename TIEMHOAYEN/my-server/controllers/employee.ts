import { AuthError, endpoint } from '../services/auth.service.js';
import { getCollection } from '../mongo.js';

// AD54: hồ sơ nhân viên. Thêm/sửa/khóa dùng chung API /api/admin/staff-accounts (gộp giao diện).
const PRIVATE_FIELDS = { MAT_KHAU: 0, SO_LAN_DANG_NHAP_SAI: 0 } as const;
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getAllEmployees = endpoint(async (req, res) => {
  const filter: any = { DA_XOA: { $ne: true } };
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  if (search) {
    const pattern = { $regex: escapePattern(search), $options: 'i' };
    filter.$or = [{ NHAN_VIEN_ID: pattern }, { HO_TEN: pattern }, { EMAIL: pattern }, { SDT: pattern }];
  }
  if (typeof req.query.role === 'string' && req.query.role.trim()) filter.VAI_TRO = req.query.role.trim();
  res.json(await (await getCollection('NHAN_VIEN')).find(filter, { projection: PRIVATE_FIELDS }).sort({ NHAN_VIEN_ID: 1 }).toArray());
});

export const getEmployeeById = endpoint(async (req, res) => {
  const employee = await (await getCollection('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: String(req.params.id) }, { projection: PRIVATE_FIELDS });
  if (!employee) throw new AuthError(404, 'Không tìm thấy nhân viên.');
  res.json(employee);
});
