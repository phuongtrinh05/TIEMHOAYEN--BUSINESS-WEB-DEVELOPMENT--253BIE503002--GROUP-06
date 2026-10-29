import type { Request, Response, NextFunction } from 'express';
import { InventoryError } from '../services/inventory/helpers.js';
import { authorizeCheckout, authorizeOrder, lookupAccess, ownedOrderQuery, ownedRequestQuery, phonePattern, requestOrderOtp, revokeOrderAccess, verifyOrderOtp } from '../services/order-access.service.js';
import { getCollection } from '../mongo.js';
const failure = (res: Response, error: any) => res.status(error instanceof InventoryError ? error.status : 500).json({ message: error instanceof InventoryError ? error.message : 'Không thể xác thực tra cứu lúc này.' });
export const accessToken = (req: Request) => String(req.headers['x-order-access'] || req.headers['x-request-token'] || '');
export async function sendLookupOtp(req: Request, res: Response) {
  try { res.setHeader('Cache-Control','no-store'); res.json(await requestOrderOtp(req.body.phone, req.ip || 'unknown')); } catch(e) { failure(res,e); }
}
export async function verifyLookupOtp(req: Request, res: Response) {
  try { res.setHeader('Cache-Control','no-store'); res.json(await verifyOrderOtp(req.body.challengeId, req.body.code)); } catch(e) { failure(res,e); }
}
export async function requireLookup(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control','no-store');
    const token = accessToken(req);
    const orderId = String(req.params.orderId || '');
    if (orderId && /^\/(?:[^/]+)\/payment-(?:status|retry|expired)$/.test(req.path) && await authorizeCheckout(orderId, req.headers['x-checkout-access'])) return next();
    res.locals.orderAccess = orderId ? await authorizeOrder(orderId, token) : await lookupAccess(token);
    next();
  } catch(e) { failure(res,e); }
}
export async function lookupHistory(req: Request, res: Response) {
  try {
    const access = await lookupAccess(accessToken(req));
    const page = Math.max(1, Math.min(100000, Math.floor(Number(req.query.page) || 1)));
    const query = await ownedOrderQuery(access);
    const [orders, totalOrders, requests, totalRequests] = await Promise.all([
      (await getCollection<any>('DON_HANG')).find(query,{projection:{_id:0,DON_HANG_ID:1,NGAY_TAO:1,TRANG_THAI:1,TONG_TIEN:1,NGAY_MUON_GIAO:1,KHUNG_GIO_MUON_GIAO:1}}).sort({NGAY_TAO:-1}).skip((page-1)*20).limit(20).toArray(),
      (await getCollection<any>('DON_HANG')).countDocuments(query),
      (await getCollection<any>('YEU_CAU_DAT_HANG')).find(ownedRequestQuery(access),{projection:{_id:0,requestId:1,status:1,items:1,delivery:1,createdAt:1,orderId:1}}).sort({createdAt:-1}).skip((page-1)*20).limit(20).toArray(),
      (await getCollection<any>('YEU_CAU_DAT_HANG')).countDocuments(ownedRequestQuery(access)),
    ]);
    res.json({orders,requests,totalOrders,totalRequests,page});
  } catch(e) { failure(res,e); }
}
export async function endLookup(req: Request, res: Response) {
  try { await revokeOrderAccess(accessToken(req)); res.json({message:'Đã kết thúc phiên tra cứu.'}); } catch(e) { failure(res,e); }
}
export async function requireCustomerLookup(req: Request, res: Response, next: NextFunction) {
  try {
    const access = await lookupAccess(accessToken(req));
    const customer = await (await getCollection<any>('KHACH_HANG')).findOne(access.authType === 'member'
      ? { KHACH_HANG_ID: access.customerId === req.params.id ? access.customerId : null }
      : { KHACH_HANG_ID: req.params.id, SDT: phonePattern(access.phone) });
    if (!customer) throw new InventoryError(404, 'Không tìm thấy lịch sử trong phạm vi được phép.');
    next();
  } catch(e) { failure(res,e); }
}
