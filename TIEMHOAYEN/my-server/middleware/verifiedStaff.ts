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

let apiWriteGeneration = 0;
/** Sau mỗi thao tác ghi, lần đọc tiếp theo không dùng chung kết quả đã bắt đầu trước đó. */
export function trackApiWrites(req: Request, res: Response, next: NextFunction) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) res.once('finish', () => { apiWriteGeneration += 1; });
  next();
}

type SharedJson = { status: number; cacheControl: unknown; body: unknown } | null;
const inFlightJson = new Map<string, Promise<SharedJson>>();
const SHARED_READ_MAX_MS = 30_000;

/**
 * Nhân viên bấm qua lại giữa các trang: các GET giống hệt đang chạy dùng chung một lần đọc DB.
 * Đặt SAU middleware phân quyền; khóa gồm mã nhân viên nên không chia sẻ dữ liệu giữa các tài khoản.
 */
export function shareInFlightGet(req: Request, res: Response, next: NextFunction) {
  const staffId = String(req.headers['x-admin-id'] || '');
  if (req.method !== 'GET' || !staffId) return next();
  const key = `${apiWriteGeneration}:${staffId}:${req.originalUrl}`;
  const running = inFlightJson.get(key);
  if (running) {
    void running.then((shared) => {
      if (!shared) return next();
      if (shared.cacheControl) res.setHeader('Cache-Control', shared.cacheControl as string);
      res.status(shared.status).json(shared.body);
    });
    return;
  }
  let settle!: (value: SharedJson) => void;
  const shared = new Promise<SharedJson>((resolve) => { settle = resolve; });
  inFlightJson.set(key, shared);
  const finish = (value: SharedJson) => {
    clearTimeout(timer);
    if (inFlightJson.get(key) === shared) inFlightJson.delete(key);
    settle(value);
  };
  const timer = setTimeout(() => finish(null), SHARED_READ_MAX_MS);
  timer.unref();
  const json = res.json.bind(res);
  res.json = (body: any) => {
    finish({ status: res.statusCode, cacheControl: res.getHeader('Cache-Control'), body });
    return json(body);
  };
  res.once('finish', () => finish(null));
  next();
}
