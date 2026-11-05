import express from 'express';
import { getAdminRolePermissions, loginAdminEmployee } from '../controllers/rolePermission.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';
import { getCollection } from '../mongo.js';
import { createHash } from 'node:crypto';
import { audit } from '../services/auth.service.js';

const router = express.Router();
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

router.post('/auth/login', loginAdminEmployee);
// Đăng xuất thu hồi cả phiên điều hướng (as_) lẫn token nghiệp vụ (sa_).
router.post('/auth/logout', async (req, res) => {
  try {
    const sessionToken = String(req.headers['x-admin-session'] || '');
    const bearer = String(req.headers.authorization || '').match(/^Bearer (sa_[a-f0-9]{64})$/)?.[1] || '';
    let employeeId = '';
    if (/^as_[a-f0-9]{64}$/.test(sessionToken)) {
      const sessions = await getCollection<any>('PHIEN_DANG_NHAP_ADMIN');
      const row = await sessions.findOne({ _id: sha(sessionToken) });
      employeeId = String(row?.employeeId || '');
      await sessions.deleteOne({ _id: sha(sessionToken) });
    }
    if (bearer) {
      const access = await getCollection<any>('XAC_THUC_TRA_CUU_DON');
      const row = await access.findOne({ _id: sha(bearer), kind: 'staff' });
      employeeId ||= String(row?.employeeId || '');
      await access.deleteOne({ _id: sha(bearer), kind: 'staff' });
    }
    if (employeeId) {
      req.identity = { id: employeeId, type: 'NHAN_VIEN', account: {}, sessionId: '' };
      await audit(req, 'DANG_XUAT_ADMIN', employeeId);
    }
    res.json({ message: 'Đã đăng xuất.' });
  } catch {
    res.status(500).json({ message: 'Chưa đăng xuất được. Vui lòng thử lại.' });
  }
});
router.get('/role-permissions', requireAdminPermission('permissions', 'view'), getAdminRolePermissions);

export default router;
