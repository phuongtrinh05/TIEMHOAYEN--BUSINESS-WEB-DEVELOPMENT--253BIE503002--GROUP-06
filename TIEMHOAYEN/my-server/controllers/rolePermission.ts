import { Request, Response } from 'express';
import {randomBytes,createHash} from 'node:crypto';
import { getCollection } from '../mongo.js';
import {
  defaultRolePermissions,
  getRolePermissions,
  permissionActions,
  permissionModules,
  resolveRoleName,
} from '../services/role-permission.service.js';
import { hashPassword, isPasswordHash, verifyPassword } from '../utils/passwordHash.js';
import { createStaffAccess } from '../services/order-access.service.js';

export const getAdminRolePermissions = async (_req: Request, res: Response) => {
  try {
    const employeeCollection = await getCollection('NHAN_VIEN');
    const result = await employeeCollection.aggregate([
      { $group: { _id: '$VAI_TRO', TOTAL: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray();

    const roleCounts = new Map<string, number>();
    for (const row of result) {
      const roleName = resolveRoleName(row._id);
      roleCounts.set(roleName, (roleCounts.get(roleName) || 0) + Number(row.TOTAL || 0));
    }

    const roles = Array.from(new Set([
      ...Object.keys(defaultRolePermissions),
      ...Array.from(roleCounts.keys()),
    ])).map((roleName) => ({
      name: roleName,
      total: roleCounts.get(roleName) || 0,
      permissions: getRolePermissions(roleName),
    }));

    return res.status(200).json({
      actions: permissionActions,
      modules: permissionModules,
      roles,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Không thể tải dữ liệu phân quyền.',
      detail: error.message,
    });
  }
};

export const loginAdminEmployee = async (req: Request, res: Response) => {
  try {
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ message: 'Vui lòng nhập email và mật khẩu.' });
    }

    const employeeCollection = await getCollection('NHAN_VIEN');
    const employee = await employeeCollection.findOne({ EMAIL: email });
    if (!employee || employee.DA_XOA === true || employee.DA_XOA === 1 || !(await verifyPassword(password, employee.MAT_KHAU))) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
    }

    if (!isPasswordHash(employee.MAT_KHAU)) {
      const passwordHash = await hashPassword(password);
      await employeeCollection.updateOne(
        { NHAN_VIEN_ID: employee.NHAN_VIEN_ID },
        { $set: { MAT_KHAU: passwordHash } },
      );
      employee.MAT_KHAU = passwordHash;
    }

    const status = String(employee.TRANG_THAI || '').trim().toLowerCase();
    if (status && status !== 'hoạt động' && status !== 'hoat dong') {
      return res.status(403).json({ message: 'Tài khoản nhân viên không hoạt động.' });
    }

    const role = resolveRoleName(employee.VAI_TRO);
    const session = await createStaffAccess(employee);
    // Admin navigation/account APIs use the existing as_ session; business APIs
    // use the staff bearer accessToken. Return both contracts after authentication.
    const adminSessionToken = `as_${randomBytes(32).toString('hex')}`;
    await (await getCollection<any>('PHIEN_DANG_NHAP_ADMIN')).insertOne({
      _id: createHash('sha256').update(adminSessionToken).digest('hex'),
      employeeId: employee.NHAN_VIEN_ID, expiresAt: session.expiresAt,
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ...session,
      adminSessionToken,
      employee: {
        id: employee.NHAN_VIEN_ID,
        name: employee.HO_TEN,
        email: employee.EMAIL,
        role,
        status: employee.TRANG_THAI,
      },
      permissions: getRolePermissions(role),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Không thể đăng nhập nhân viên.',
      detail: error.message,
    });
  }
};
