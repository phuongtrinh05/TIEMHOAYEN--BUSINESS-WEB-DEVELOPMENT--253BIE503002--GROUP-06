import { Request, Response, NextFunction } from 'express';
import { getCollection } from '../mongo.js';
import { allowed } from '../services/auth.service.js';

export async function customerAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const identity = req.identity!;
    if (identity.type === 'NHAN_VIEN') {
      if (await allowed(identity, 'customers', req.method === 'GET' ? 'view' : 'update')) return next();
    } else {
      const parts = req.path.split('/').filter(Boolean);
      let owner = parts[0];
      if (parts[0] === 'addresses') {
        const address = await (await getCollection('DIA_CHI_GIAO_HANG')).findOne({ DIA_CHI_ID: parts[1] });
        owner = String(address?.KHACH_HANG_ID || '');
      }
      if (owner === identity.id) return next();
    }
    res.status(403).json({ message: 'Bạn không có quyền truy cập dữ liệu này.' });
  } catch { res.status(503).json({ message: 'Không thể kiểm tra quyền truy cập.' }); }
}
