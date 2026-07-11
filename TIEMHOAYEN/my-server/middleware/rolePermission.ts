import { NextFunction, Request, Response } from 'express';
import { sql } from '../db.js';
import { hasPermission, PermissionAction } from '../services/role-permission.service.js';

const actionByMethod: Record<string, PermissionAction> = {
  GET: 'view',
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

const getHeaderValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
};

const getEmployeeRoleById = async (employeeId: string): Promise<string> => {
  const request = new sql.Request();
  request.input('NHAN_VIEN_ID', sql.NVarChar(20), employeeId);
  const result = await request.query(`
    SELECT TOP 1 VAI_TRO
    FROM NHAN_VIEN
    WHERE NHAN_VIEN_ID = @NHAN_VIEN_ID
  `);

  return result.recordset[0]?.VAI_TRO || '';
};

const resolveRequestRole = async (req: Request): Promise<string> => {
  const role = getHeaderValue(req.headers['x-admin-role']);
  if (role.trim()) return role.trim();

  const employeeId = getHeaderValue(req.headers['x-admin-id']);
  if (employeeId.trim()) {
    return getEmployeeRoleById(employeeId.trim());
  }

  return '';
};

export const requireAdminPermission = (moduleKey: string, forcedAction?: PermissionAction) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const action = forcedAction || actionByMethod[req.method] || 'view';
      const role = await resolveRequestRole(req);

      if (!role || !hasPermission(role, moduleKey, action)) {
        return res.status(403).json({
          message: 'Bạn không có quyền thực hiện chức năng này.',
          required: { module: moduleKey, action },
        });
      }

      return next();
    } catch (error: any) {
      return res.status(500).json({
        message: 'Không thể kiểm tra phân quyền.',
        detail: error.message,
      });
    }
  };
};
