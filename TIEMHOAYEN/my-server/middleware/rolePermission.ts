import { NextFunction, Request, Response } from 'express';
import { InventoryError } from '../services/inventory/helpers.js';
import { PermissionAction } from '../services/role-permission.service.js';
import { identify, allowed } from '../services/auth.service.js';

const actionByMethod: Record<string, PermissionAction> = {
  GET: 'view',
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

/** Nhân viên đã xác thực qua phiên đăng nhập của main (auth.service), không tin ID do trình duyệt gửi. */
export async function authenticatedEmployee(req: Request) {
  req.identity = req.identity || await identify(req);
  if (!req.identity || req.identity.type !== 'NHAN_VIEN') throw new InventoryError(401, 'Cần đăng nhập nhân viên để thực hiện thao tác.');
  req.headers['x-admin-id'] = req.identity.id;
  return req.identity.account;
}

export const requireAdminPermission = (moduleKey: string, forcedAction?: PermissionAction) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const action = forcedAction || actionByMethod[req.method] || 'view';
      req.identity = await identify(req);
      if (!req.identity) return res.status(401).json({ message: 'Vui lòng đăng nhập lại.' });
      if (req.identity.type === 'NHAN_VIEN') {
        res.locals.adminEmployee = req.identity.account;
        req.headers['x-admin-id'] = req.identity.id;
      }
      if (!await allowed(req.identity, moduleKey, action)) {
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
