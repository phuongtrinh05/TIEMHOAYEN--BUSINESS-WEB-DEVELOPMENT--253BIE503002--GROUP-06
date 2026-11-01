import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import { getCollection } from '../mongo.js';
import { allowed, identify, digest } from '../services/auth.service.js';
import { authorizeOrder, lookupAccess } from '../services/order-access.service.js';

export const ownerAccess = (readOwner: (req: Request) => string) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    req.identity = await identify(req);
    if (!req.identity) return res.status(401).json({ message: 'Vui lòng đăng nhập.' });
    if (req.identity.type !== 'KHACH_HANG' || req.identity.id !== String(readOwner(req) || '')) return res.status(403).json({ message: 'Bạn không có quyền truy cập dữ liệu này.' });
    next();
  } catch { res.status(503).json({ message: 'Chưa kiểm tra được quyền truy cập.' }); }
};
export async function issueGuestAccess(orderId: string) {
  const token = randomBytes(32).toString('hex');
  await (await getCollection<any>('PHIEN_TRUY_CAP_KHACH')).insertOne({ _id: digest(token), DON_HANG_ID: orderId, HET_HAN: new Date(Date.now() + 30 * 86400000) });
  return token;
}
export async function orderAccess(req: Request, res: Response, next: NextFunction) {
  try {
    req.identity = await identify(req);
    if (await allowed(req.identity, 'orders', req.method === 'GET' ? 'view' : 'update')) return next();
    const id = String(req.params.orderId || req.body.orderId || '');
    const order = await (await getCollection<any>('DON_HANG')).findOne({ DON_HANG_ID: id });
    if (order && req.identity?.type === 'KHACH_HANG' && order.KHACH_HANG_ID === req.identity.id) return next();
    // Phiên tra cứu đơn của main (x-order-access): thành viên hoặc khách đã xác minh OTP.
    const lookupToken = String(req.headers['x-order-access'] || '');
    if (order && /^oa_[a-f0-9]{64}$/.test(lookupToken)) {
      try { res.locals.orderAccess = await authorizeOrder(id, lookupToken); return next(); } catch { /* thử cách khác */ }
    }
    const token = String(req.headers['x-guest-token'] || '');
    if (order && !order.KHACH_HANG_ID && /^[a-f0-9]{64}$/.test(token)) {
      const grant = await (await getCollection<any>('PHIEN_TRUY_CAP_KHACH')).findOne({ _id: digest(token), DON_HANG_ID: id, HET_HAN: { $gt: new Date() } });
      if (grant) return next();
    }
    res.status(403).json({ message: 'Bạn không có quyền truy cập đơn hàng này. Khách vãng lai vui lòng xác minh số điện thoại bằng OTP ở trang Tra cứu đơn hàng.' });
  } catch { res.status(503).json({ message: 'Chưa kiểm tra được quyền truy cập.' }); }
}
// Lịch sử đánh giá của khách vãng lai: chỉ theo SĐT đã xác minh OTP trong phiên tra cứu.
export async function verifiedLookupPhone(req: Request, res: Response, next: NextFunction) {
  try {
    const access = await lookupAccess(String(req.headers['x-order-access'] || ''));
    req.body.phone = access.phone;
    next();
  } catch { res.status(401).json({ message: 'Vui lòng xác minh số điện thoại bằng OTP ở trang Tra cứu đơn hàng để xem lịch sử đánh giá.' }); }
}
export async function orderCreator(req: Request, res: Response, next: NextFunction) {
  try {
    req.identity = await identify(req);
    if (req.identity?.type === 'KHACH_HANG') req.body.customerId = req.identity.id;
    else if (req.body.customerId || req.headers.authorization) return res.status(401).json({ message: 'Vui lòng đăng nhập lại.' });
    next();
  } catch { res.status(503).json({ message: 'Chưa kiểm tra được quyền truy cập.' }); }
}
