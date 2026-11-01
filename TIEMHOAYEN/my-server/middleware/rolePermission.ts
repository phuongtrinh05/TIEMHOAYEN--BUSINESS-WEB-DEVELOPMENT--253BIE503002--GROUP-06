import { NextFunction, Request, Response } from 'express';
import { getCollection } from '../mongo.js';
import { hasPermission, PermissionAction } from '../services/role-permission.service.js';
import { identify, allowed } from '../services/auth.service.js';

const actionByMethod: Record<string, PermissionAction> = {
  GET: 'view',
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

export const requireAdminPermission = (moduleKey: string, forcedAction?: PermissionAction) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const action = forcedAction || actionByMethod[req.method] || 'view';
      req.identity = await identify(req);
      if (!req.identity) return res.status(401).json({ message: 'Vui lòng đăng nhập lại.' });
      if (!await allowed(req.identity, moduleKey, action)) {
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
