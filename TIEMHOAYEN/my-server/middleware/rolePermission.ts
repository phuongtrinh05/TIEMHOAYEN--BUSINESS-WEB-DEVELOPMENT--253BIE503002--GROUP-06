import { NextFunction, Request, Response } from 'express';
import { staffAccess } from '../services/order-access.service.js';
import { InventoryError } from '../services/inventory/helpers.js';
import { hasPermission, PermissionAction } from '../services/role-permission.service.js';

const actionByMethod: Record<string, PermissionAction> = {
  GET: 'view',
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

export async function authenticatedEmployee(req: Request) {
  const header = String(req.headers.authorization || '');
  const employee = await staffAccess(header.startsWith('Bearer ') ? header.slice(7) : '');
  // Keep older handlers on the verified identity, never an ID claimed by the browser.
  req.headers['x-admin-id'] = employee.NHAN_VIEN_ID;
  req.headers['x-admin-role'] = employee.VAI_TRO;
  return employee;
}

export const requireAdminPermission = (moduleKey: string, forcedAction?: PermissionAction) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const action = forcedAction || actionByMethod[req.method] || 'view';
      const employee = await authenticatedEmployee(req);
      res.locals.adminEmployee = employee;
      // Nhật ký hệ thống (AD55) lấy người thực hiện từ phiên đã xác thực.
      req.identity ||= { id: employee.NHAN_VIEN_ID, type: 'NHAN_VIEN', account: employee, sessionId: '' };
      const role = String(employee.VAI_TRO || '');

      if (!role || !hasPermission(role, moduleKey, action)) {
        return res.status(403).json({
          message: 'Bạn không có quyền thực hiện chức năng này.',
          required: { module: moduleKey, action },
        });
      }

      return next();
    } catch (error: any) {
      return res.status(error instanceof InventoryError ? error.status : 500).json({
        message: error instanceof InventoryError ? error.message : 'Không thể kiểm tra phân quyền.',
      });
    }
  };
};
