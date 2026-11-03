import type { Request, Response, NextFunction } from 'express';
import { InventoryError } from '../services/inventory/helpers.js';
import { authorizeCheckout, authorizeOrder, lookupAccess, ownedOrderQuery, ownedRequestQuery, phonePattern, requestOrderOtp, revokeOrderAccess, verifyOrderOtp } from '../services/order-access.service.js';
import { getCollection } from '../mongo.js';
import { sumVerifiedPayments } from '../services/admin-order.service.js';

const customerOrderGroup = (status: unknown, hasAfterSales = false) => {
  if (hasAfterSales) return 'returns';
  const value = String(status || '').toLowerCase();
  if (/chấp nhận hoàn tiền|đã hoàn tiền|hoàn tiền|trả hàng|đổi hàng/.test(value)) return 'returns';
  if (/đã hủy|hủy đơn/.test(value)) return 'cancelled';
  if (/hoàn thành|đã giao|giao thành công/.test(value)) return 'completed';
  if (/đã đặt hàng thành công|đang chuẩn bị|chờ giao hàng|chờ vận chuyển|đang giao/.test(value)) return 'shipping';
  return 'all';
};
const failure = (res: Response, error: any) => res.status(error instanceof InventoryError ? error.status : 500).json({ message: error instanceof InventoryError ? error.message : 'Không thể xác thực tra cứu lúc này.' });
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const accessToken = (req: Request) => String(req.headers['x-request-token'] || req.headers['x-order-access'] || '');
export async function sendLookupOtp(req: Request, res: Response) {
  try { res.setHeader('Cache-Control','no-store'); res.json(await requestOrderOtp(req.body.phone, req.ip || 'unknown', req.body.orderId ? String(req.body.orderId).trim() : undefined, req.body.requestId ? String(req.body.requestId).trim() : undefined)); } catch(e) { failure(res,e); }
}
export async function verifyLookupOtp(req: Request, res: Response) {
  try { res.setHeader('Cache-Control','no-store'); res.json(await verifyOrderOtp(req.body.challengeId, req.body.code)); } catch(e) { failure(res,e); }
}
export async function requireLookup(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control','no-store');
    const token = accessToken(req);
    const orderId = String(req.params.orderId || '');
    if (orderId && /^\/(?:[^/]+)\/payment-(?:status|retry|expired)$/.test(req.path) && await authorizeCheckout(orderId, req.headers['x-checkout-access'])) {
      res.locals.checkoutAccess = true;
      return next();
    }
    res.locals.orderAccess = orderId ? await authorizeOrder(orderId, token) : await lookupAccess(token);
    next();
  } catch(e) { failure(res,e); }
}
/** A phone-verified lookup may act only on an owned Sales request route. */
export async function requireLookupAction(req: Request, res: Response, next: NextFunction) {
  try {
    if (res.locals.checkoutAccess) return next();
    const access = res.locals.orderAccess || await lookupAccess(accessToken(req));
    const verifiedRequestAction = access.authType === 'guest_lookup' && !!req.params.requestId;
    if (access.authType !== 'member' && access.kind !== 'request' && !verifiedRequestAction) {
      throw new InventoryError(403, 'Phiên tra cứu chỉ được xem thông tin. Thao tác này cần xác thực riêng.');
    }
    res.locals.orderAccess = access;
    next();
  } catch (error) { failure(res, error); }
}
export async function lookupHistory(req: Request, res: Response) {
  try {
    const access = await lookupAccess(accessToken(req));
    const page = Math.max(1, Math.min(100000, Math.floor(Number(req.query.page) || 1)));
    // Một lần tải đủ dữ liệu trong phạm vi đã xác minh để UI đổi section mà
    // không gọi lại API cho từng tab. Giới hạn cứng vẫn bảo vệ endpoint.
    const pageSize = Math.max(1, Math.min(500, Math.floor(Number(req.query.pageSize) || 20)));
    const search = String(req.query.search || '').trim().slice(0, 100);
    const status = String(req.query.status || '').trim().slice(0, 80);
    const requestedScope = String(req.query.scope || 'orders');
    const scope = ['orders','requests','all'].includes(requestedScope) ? requestedScope : 'orders';
    const group = ['shipping','completed','returns','cancelled'].includes(String(req.query.group || '')) ? String(req.query.group) : '';
    const deliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : '';
    const ownedOrders = await ownedOrderQuery(access);
    // Đơn tạo từ tư vấn vẫn nằm ở tab Yêu cầu đặt hàng trong lúc chờ thanh
    // toán. Chỉ đưa sang luồng đơn hàng bình thường sau khi đã thu tiền.
    const salesOrderVisibility = access.orderId ? {} : { $or: [
      { YEU_CAU_DAT_HANG_ID: { $exists: false } },
      { YEU_CAU_DAT_HANG_ID: null },
      { TRANG_THAI: { $nin: ['Chờ thanh toán', 'Đã hủy'] } },
    ] };
    const baseQuery: any = access.orderId ? ownedOrders : { $and: [ownedOrders, salesOrderVisibility] };
    const ordersCollection = await getCollection<any>('DON_HANG');
    const detailsCollection = await getCollection<any>('DON_HANG_CHI_TIET');
    const requestsCollection = await getCollection<any>('YEU_CAU_DAT_HANG');
    const baseRequestQuery = ownedRequestQuery(access);
    // These datasets are independent. Start them together instead of waiting for
    // the order list before counting Sales requests.
    const [allOrderStates, allRequestCount] = await Promise.all([
      ordersCollection.find(baseQuery,{projection:{_id:0,DON_HANG_ID:1,TRANG_THAI:1}}).toArray(),
      requestsCollection.countDocuments(baseRequestQuery),
    ]);
    const allOrderIds = allOrderStates.map(order => order.DON_HANG_ID);
    const allAfterSales = await (await getCollection<any>('YEU_CAU_HAU_MAI')).find({ orderId: { $in: allOrderIds } }, { projection: { _id:0,orderId:1,status:1,active:1 } }).toArray();
    const afterSalesOrderIds = [...new Set(allAfterSales.map(row => row.orderId).filter(Boolean))];
    const filteredParts: any[] = [baseQuery];
    if (group === 'shipping') filteredParts.push({ TRANG_THAI: { $regex: 'đã đặt hàng thành công|đang chuẩn bị|chờ giao hàng|chờ vận chuyển|đang giao', $options: 'i' } });
    if (group === 'completed') filteredParts.push({ TRANG_THAI: { $regex: 'hoàn thành|đã giao|giao thành công', $options: 'i' } });
    if (group === 'returns') filteredParts.push({ $or: [
      { TRANG_THAI: { $regex: 'hoàn tiền|trả hàng|đổi hàng', $options: 'i' } },
      ...(afterSalesOrderIds.length ? [{ DON_HANG_ID: { $in: afterSalesOrderIds } }] : []),
    ] });
    if (group === 'cancelled') filteredParts.push({ TRANG_THAI: { $regex: 'đã hủy|hủy đơn', $options: 'i' } });
    if (status) filteredParts.push({ TRANG_THAI: status });
    if (deliveryDate) {
      const from = new Date(`${deliveryDate}T00:00:00.000+07:00`);
      const to = new Date(`${deliveryDate}T23:59:59.999+07:00`);
      filteredParts.push({ $or: [
        { NGAY_MUON_GIAO: { $gte: from, $lte: to } },
        { NGAY_TAO: { $gte: from, $lte: to } },
      ] });
    }
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      const matchingDetails = await detailsCollection.find({
        DON_HANG_ID: { $in: allOrderIds },
        $or: [{ TEN_SAN_PHAM_SNAPSHOT: pattern }, { SAN_PHAM_ID: pattern }],
      }, { projection: { _id: 0, DON_HANG_ID: 1 } }).limit(1000).toArray();
      const productOrderIds = [...new Set(matchingDetails.map(row => row.DON_HANG_ID).filter(Boolean))];
      filteredParts.push({ $or: [
        { DON_HANG_ID: pattern }, { TEN_NGUOI_DAT: pattern }, { TEN_NGUOI_NHAN: pattern },
        { SDT_NGUOI_DAT: pattern }, { EMAIL_NGUOI_DAT: pattern }, { DIA_CHI_GIAO_HANG: pattern },
        ...(productOrderIds.length ? [{ DON_HANG_ID: { $in: productOrderIds } }] : []),
      ] });
    }
    const query: any = filteredParts.length === 1 ? filteredParts[0] : { $and: filteredParts };
    const requestParts: any[] = [ownedRequestQuery(access)];
    if (status) requestParts.push({ status });
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      requestParts.push({ $or: [{requestId:pattern},{orderId:pattern},{'items.name':pattern},{'quote.items.name':pattern}] });
    }
    if (deliveryDate) {
      const from = new Date(`${deliveryDate}T00:00:00.000+07:00`);
      const to = new Date(`${deliveryDate}T23:59:59.999+07:00`);
      requestParts.push({ $or: [
      {'delivery.date':deliveryDate},{'quote.delivery.date':deliveryDate},
      {'delivery.date':deliveryDate.split('-').reverse().join('/')},{'quote.delivery.date':deliveryDate.split('-').reverse().join('/')},
      {createdAt:{$gte:from,$lte:to}},
    ] });
    }
    const requestQuery = { $and: requestParts };
    const [orders, totalOrders, requests, totalRequests] = await Promise.all([
      scope !== 'requests' ? ordersCollection.find(query,{projection:{_id:0,DON_HANG_ID:1,YEU_CAU_DAT_HANG_ID:1,NGAY_TAO:1,TRANG_THAI:1,TONG_TIEN:1,TIEN_COC:1,NGAY_MUON_GIAO:1,KHUNG_GIO_MUON_GIAO:1,TEN_NGUOI_DAT:1,TEN_NGUOI_NHAN:1,DIA_CHI_GIAO_HANG:1}}).sort({NGAY_TAO:-1}).skip((page-1)*pageSize).limit(pageSize).toArray() : [],
      scope !== 'requests' ? ordersCollection.countDocuments(query) : 0,
      scope !== 'orders' ? requestsCollection.find(requestQuery,{projection:{_id:0,requestId:1,status:1,items:1,delivery:1,createdAt:1,orderId:1,reviewReason:1,routing:1,quote:1}}).sort({createdAt:-1}).skip((page-1)*pageSize).limit(pageSize).toArray() : [],
      scope !== 'orders' ? requestsCollection.countDocuments(requestQuery) : 0,
    ]);
    const orderIds = orders.map(order => order.DON_HANG_ID);
    const [details, payments] = await Promise.all([
      detailsCollection.find({ DON_HANG_ID: { $in: orderIds } }, { projection: { _id:0,DON_HANG_ID:1,SAN_PHAM_ID:1,TEN_SAN_PHAM_SNAPSHOT:1,HINH_ANH_SNAPSHOT:1,SO_LUONG:1 } }).toArray(),
      (await getCollection<any>('THANH_TOAN')).find({ DON_HANG_ID: { $in: orderIds } }).toArray(),
    ]);
    const detailsByOrder = new Map<string, any[]>();
    for (const detail of details) {
      const rows = detailsByOrder.get(detail.DON_HANG_ID) || [];
      rows.push(detail);
      detailsByOrder.set(detail.DON_HANG_ID, rows);
    }
    const paymentsByOrder = new Map<string, any[]>();
    for (const payment of payments) {
      const rows = paymentsByOrder.get(payment.DON_HANG_ID) || [];
      rows.push(payment);
      paymentsByOrder.set(payment.DON_HANG_ID, rows);
    }
    const afterMap = new Map(allAfterSales.map(row => [row.orderId, row]));
    const enrichedOrders = orders.map(order => {
      const orderPayments = paymentsByOrder.get(order.DON_HANG_ID) || [];
      const paid = Math.max(0, sumVerifiedPayments(orderPayments));
      const itemRows = detailsByOrder.get(order.DON_HANG_ID) || [];
      return { ...order, items: itemRows, uiGroup: customerOrderGroup(order.TRANG_THAI, afterMap.has(order.DON_HANG_ID)),
        paymentSummary: { deposit: Number(order.TIEN_COC || 0), paid, remaining: Math.max(0, Number(order.TONG_TIEN || 0) - paid) },
        afterSales: afterMap.get(order.DON_HANG_ID) || null };
    });
    const linkedOrderMap = new Map(orders.filter(order => order.YEU_CAU_DAT_HANG_ID).map(order => [order.YEU_CAU_DAT_HANG_ID, order]));
    const enrichedRequests = requests.map(request => request.quote ? {
      ...request,
      linkedOrder: request.orderId ? linkedOrderMap.get(request.requestId) || { DON_HANG_ID: request.orderId } : null,
      originalItems: request.items,
      originalDelivery: request.delivery,
      requestUpdatedByProposal: true,
      items: request.quote.items.map((item: any) => ({ productId: item.id, name: item.name, quantity: item.qty, price: item.price, image: item.image, custom: !!item.custom })),
      delivery: request.quote.delivery,
    } : ({ ...request, linkedOrder: request.orderId ? linkedOrderMap.get(request.requestId) || { DON_HANG_ID: request.orderId } : null }));
    const counts = { all:allOrderStates.length, shipping:0, completed:0, returns:0, cancelled:0, requests:allRequestCount };
    for (const order of allOrderStates) {
      const bucket = customerOrderGroup(order.TRANG_THAI, afterMap.has(order.DON_HANG_ID));
      if (bucket !== 'all') counts[bucket as 'shipping'|'completed'|'returns'|'cancelled']++;
    }
    const statuses = [...new Set(allOrderStates.map(row => String(row.TRANG_THAI || '')).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'vi'));
    res.json({orders:enrichedOrders,requests:enrichedRequests,totalOrders,totalRequests,total:scope === 'all' ? totalOrders + totalRequests : scope === 'requests' ? totalRequests : totalOrders,page,pageSize,counts,statuses:scope === 'requests' ? [] : statuses,scope,group});
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

/** Address book belongs to an authenticated member, never a caller supplied ID. */
export async function requireAddressOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const access = await lookupAccess(accessToken(req));
    if (access.authType !== 'member') throw new InventoryError(403, 'Cần đăng nhập để quản lý địa chỉ.');
    const id = String(req.params.id || req.params.customerId || '');
    if (id && id !== access.customerId) throw new InventoryError(404, 'Không tìm thấy địa chỉ trong tài khoản.');
    if (req.params.addressId) {
      const row = await (await getCollection<any>('DIA_CHI_GIAO_HANG')).findOne({ DIA_CHI_ID: req.params.addressId, KHACH_HANG_ID: access.customerId, DA_XOA: { $nin: [true, 1] } });
      if (!row) throw new InventoryError(404, 'Không tìm thấy địa chỉ trong tài khoản.');
    }
    res.locals.orderAccess = access;
    next();
  } catch (error) { failure(res, error); }
}
