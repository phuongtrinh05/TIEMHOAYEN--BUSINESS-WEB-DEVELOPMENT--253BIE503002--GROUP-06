import { NextFunction, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { getCollection } from '../mongo.js';
import { staffAccess } from '../services/order-access.service.js';
import { active } from '../services/auth.service.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * AD53: không tin danh tính nhân viên do trình duyệt tự gửi.
 * Xóa x-admin-id / x-admin-role của client, rồi chỉ gắn lại khi có phiên nhân viên hợp lệ
 * (Bearer sa_... hoặc x-admin-session as_...). Các route cũ đọc x-admin-id vì vậy luôn nhận
 * mã nhân viên đã xác thực, và nhật ký hệ thống ghi đúng người thực hiện.
 */
export async function attachVerifiedStaff(req: Request, _res: Response, next: NextFunction) {
  delete req.headers['x-admin-id'];
  delete req.headers['x-admin-role'];
  try {
    const bearer = String(req.headers.authorization || '').match(/^Bearer (sa_[a-f0-9]{64})$/)?.[1];
    let employee: any = null;
    let sessionId = '';
    if (bearer) {
      employee = await staffAccess(bearer).catch(() => null);
      sessionId = employee ? sha(bearer) : '';
    }
    const sessionToken = String(req.headers['x-admin-session'] || '');
    if (!employee && /^as_[a-f0-9]{64}$/.test(sessionToken)) {
      const row = await (await getCollection<any>('PHIEN_DANG_NHAP_ADMIN')).findOne({ _id: sha(sessionToken), expiresAt: { $gt: new Date() } });
      const account = row?.employeeId ? await (await getCollection<any>('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: row.employeeId }) : null;
      if (active(account)) { employee = account; sessionId = String(row._id); }
    }
    if (employee) {
      req.headers['x-admin-id'] = employee.NHAN_VIEN_ID;
      req.headers['x-admin-role'] = String(employee.VAI_TRO || '');
      req.identity ||= { id: employee.NHAN_VIEN_ID, type: 'NHAN_VIEN', account: employee, sessionId };
    }
  } catch { /* không có phiên nhân viên hợp lệ: tiếp tục như khách */ }
  next();
}
