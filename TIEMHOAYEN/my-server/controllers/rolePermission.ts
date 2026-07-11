import { Request, Response } from 'express';
import { sql } from '../db.js';
import {
  defaultRolePermissions,
  getRolePermissions,
  permissionActions,
  permissionModules,
  resolveRoleName,
} from '../services/role-permission.service.js';

export const getAdminRolePermissions = async (_req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      SELECT VAI_TRO, COUNT(*) AS TOTAL
      FROM NHAN_VIEN
      GROUP BY VAI_TRO
      ORDER BY
        CASE WHEN VAI_TRO = N'Admin' THEN 0 ELSE 1 END,
        VAI_TRO ASC
    `);

    const roleCounts = new Map<string, number>();
    for (const row of result.recordset) {
      const roleName = resolveRoleName(row.VAI_TRO);
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

    const request = new sql.Request();
    request.input('EMAIL', sql.NVarChar(255), email);
    request.input('MAT_KHAU', sql.NVarChar(255), password);

    const result = await request.query(`
      SELECT TOP 1
        NHAN_VIEN_ID,
        HO_TEN,
        EMAIL,
        VAI_TRO,
        TRANG_THAI
      FROM NHAN_VIEN
      WHERE EMAIL = @EMAIL
        AND MAT_KHAU = @MAT_KHAU
    `);

    const employee = result.recordset[0];
    if (!employee) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
    }

    const status = String(employee.TRANG_THAI || '').trim().toLowerCase();
    if (status && status !== 'hoạt động' && status !== 'hoat dong') {
      return res.status(403).json({ message: 'Tài khoản nhân viên không hoạt động.' });
    }

    const role = resolveRoleName(employee.VAI_TRO);
    return res.status(200).json({
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
