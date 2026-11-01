import { AFTER_SALES,afterSalesChange,afterSalesRead,orderEvent } from '../services/admin-order.service.js';
import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';
import { getAdminOrderDetailById, sumVerifiedPayments, assertOrderTransition, allowedOrderStatuses } from '../services/admin-order.service.js';
import { createOrder } from './order.js';
import { randomUUID } from 'node:crypto';
import { finishedAvailableOf, InventoryError, withTransaction } from '../services/inventory/helpers.js';
import { computeBuildable } from '../services/inventory/availability.service.js';
import { getActiveBomMap } from '../services/inventory/bom.service.js';
import { syncCheckoutInventory, changeCheckoutPayment } from '../services/checkout-payment.service.js';
import { releaseReservations } from '../services/inventory/stock.service.js';
import { invalidateAnalyticsCache } from '../services/analytics/cache.js';

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value: unknown): string => {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
};

const formatTime = (value: unknown): string => {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: true }).format(date);
};

const parseOptionalDate = (value: unknown): Date | null => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00.000Z`);
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeText = (value: unknown): string => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .trim()
  .toLowerCase();

const toBool = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 'true';

const normalizeOrderStatus = (status: unknown): string => {
  const raw = String(status || '').trim();
  const key = normalizeText(raw);
  if (!raw) return 'Chờ xử lý';
  if (key.includes('huy')) return 'Đã hủy';
  if (key.includes('hoan thanh')) return 'Hoàn thành';
  if (key.includes('giao hang thanh cong') || key.includes('da giao')) return 'Đã giao';
  if (key.includes('dang giao')) return 'Đang giao';
  if (key.includes('chuan bi')) return 'Đang chuẩn bị hàng';
  if (key.includes('van chuyen')) return 'Chờ vận chuyển';
  if (key.includes('thanh toan') && key.includes('that bai')) return 'Thanh toán thất bại';
  if (key.includes('thanh toan')) return 'Chờ thanh toán';
  return raw;
};

const normalizeTransactionStatus = (status: unknown): string => {
  const value = String(status || '').trim();
  const key = normalizeText(value);
  if (key.includes('that bai') || key.includes('failed')) return 'Thất bại';
  if (key.includes('thanh cong') || key.includes('da thanh toan') || key.includes('paid') || key.includes('success')) return 'Thành công';
  return value || 'Chờ thanh toán';
};

const normalizePaymentStatus = (status: unknown, deposit: unknown = 0, total: unknown = 0, paidAmount: unknown = 0): string => {
  const key = normalizeText(status);
  const paid = Math.max(0, Number(paidAmount || 0));
  const totalAmount = Number(total || 0);
  if (totalAmount === 0 && (key.includes('thanh cong') || key.includes('da thanh toan'))) return 'Đã thanh toán';
  if (paid > 0 && totalAmount > 0 && paid >= totalAmount) return 'Đã thanh toán';
  if (paid > 0) return 'Đã cọc';
  if (key.includes('that bai')) return 'Thanh toán thất bại';
  return 'Chờ thanh toán';
};

const money = (value: unknown): number => Math.max(0, Math.round(Number(value || 0) || 0));

const getFirstEmployeeId = async (): Promise<string> => {
  const employeeCollection = await getCollection<any>('NHAN_VIEN');
  const employee = await employeeCollection.findOne({}, { sort: { NHAN_VIEN_ID: 1 }, projection: { NHAN_VIEN_ID: 1 } });
  return employee?.NHAN_VIEN_ID || 'NV001';
};

const sanitizeEmployee = (employee: any) => {
  const { MAT_KHAU, ...safeEmployee } = employee || {};
  return safeEmployee;
};

const getPrimaryImageMap = async (productIds: string[]) => {
  const imageCollection = await getCollection<any>('HINH_ANH_SAN_PHAM');
  const images = await imageCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray();
  const imageMap = new Map<string, any>();

  for (const image of images.sort((left, right) => {
    if (Boolean(left.LA_ANH_CHINH) !== Boolean(right.LA_ANH_CHINH)) return Boolean(left.LA_ANH_CHINH) ? -1 : 1;
    return String(left.HINH_ANH_ID || '').localeCompare(String(right.HINH_ANH_ID || ''), 'vi');
  })) {
    if (!imageMap.has(image.SAN_PHAM_ID)) imageMap.set(image.SAN_PHAM_ID, image);
  }

  return imageMap;
};

const mapAdminProduct = (row: any, image?: any, avgRating = 0, stock?: { finished: number; buildable: number }) => ({
  id: row.SAN_PHAM_ID,
  code: row.SAN_PHAM_ID,
  name: row.TEN_SAN_PHAM || '',
  description: row.MO_TA || '',
  image: image?.URL || '',
  salePrice: Number(row.GIA || 0),
  discountPrice: Number(row.GIA_KHUYEN_MAI || 0),
  price: Number(row.GIA_KHUYEN_MAI || row.GIA || 0),
  status: row.TRANG_THAI || '',
  style: row.KIEU_DANG || '',
  // Không dùng SO_LUONG cũ: với sản phẩm theo BOM, khả năng bán phải giảm
  // ngay khi thành phẩm/NVL được giữ cho đơn khác.
  quantity: stock ? stock.finished + stock.buildable : Number(row.SO_LUONG || 0),
  finishedAvailable: stock?.finished ?? 0,
  buildable: stock?.buildable ?? 0,
  sold: Number(row.DA_BAN || 0),
  rating: Number(avgRating || 0),
  selected: false,
});

const getLatestPaymentByOrderIds = async (orderIds: string[]) => {
  const paymentCollection = await getCollection<any>('THANH_TOAN');
  const payments = await paymentCollection.find({ DON_HANG_ID: { $in: orderIds } }).toArray();
  const grouped = new Map<string, any[]>();

  for (const payment of payments) {
    grouped.set(payment.DON_HANG_ID, [...(grouped.get(payment.DON_HANG_ID) || []), payment]);
  }

  return new Map(Array.from(grouped.entries()).map(([orderId, rows]) => {
    const sorted = rows.sort((left, right) => {
      const dateDiff = (toDate(right.NGAY_THANH_TOAN)?.getTime() || 0) - (toDate(left.NGAY_THANH_TOAN)?.getTime() || 0);
      if (dateDiff !== 0) return dateDiff;
      return String(right.THANH_TOAN_ID || '').localeCompare(String(left.THANH_TOAN_ID || ''), 'vi');
    });
    const paidAmount = sumVerifiedPayments(rows);
    return [orderId, { latest: sorted[0] || null, paidAmount }];
  }));
};

const categoryConfig: Record<string, { collection: string; idField: string; nameField: string; prefix: string; linkCollection?: string }> = {
  topic: { collection: 'CHU_DE', idField: 'CHU_DE_ID', nameField: 'TEN_CHU_DE', prefix: 'CD' },
  flower: { collection: 'HOA_TUOI', idField: 'HOA_TUOI_ID', nameField: 'TEN_HOA_TUOI', prefix: 'HT', linkCollection: 'HOA_TUOI_SAN_PHAM' },
  target: { collection: 'DOI_TUONG', idField: 'DOI_TUONG_ID', nameField: 'TEN_DOI_TUONG', prefix: 'DT', linkCollection: 'DOI_TUONG_SAN_PHAM' },
  color: { collection: 'MAU_SAC', idField: 'MAU_SAC_ID', nameField: 'TEN_MAU_SAC', prefix: 'MS', linkCollection: 'MAU_SAC_SAN_PHAM' },
  collection: { collection: 'BO_SUU_TAP', idField: 'BO_SUU_TAP_ID', nameField: 'TEN_BO_SUU_TAP', prefix: 'BST', linkCollection: 'BO_SUU_TAP_SAN_PHAM' },
};

export const getAdminAddressOptions = async (_req: Request, res: Response) => {
  try {
    const addressCollection = await getCollection<any>('DIA_CHI_GIAO_HANG');
    const addresses = await addressCollection.find({ DA_XOA: { $ne: true } }).toArray();
    const unique = (field: string) => Array.from(new Set(addresses.map((item) => String(item[field] || '').trim()).filter(Boolean))).sort();
    return res.status(200).json({
      provinces: unique('TINH_THANH'),
      districts: unique('QUAN_HUYEN'),
      wards: unique('PHUONG_XA'),
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể tải dữ liệu địa chỉ: ' + error.message });
  }
};

export const getAdminStaffAccounts = async (_req: Request, res: Response) => {
  try {
    const employeeCollection = await getCollection<any>('NHAN_VIEN');
    const staff = (await employeeCollection.find({}).sort({ NHAN_VIEN_ID: 1 }).toArray()).map(sanitizeEmployee);
    return res.status(200).json({ total: staff.length, staff });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể tải danh sách tài khoản quản trị.', detail: error.message });
  }
};

export const getAdminOrders = async (_req: Request, res: Response) => {
  try {
    const orderCollection = await getCollection<any>('DON_HANG');
    const ordersRaw = await orderCollection.find({}).toArray();
    const paymentMap = await getLatestPaymentByOrderIds(ordersRaw.map((order) => order.DON_HANG_ID));
    const ids = ordersRaw.map(order => order.DON_HANG_ID);
    const customers = await (await getCollection<any>('KHACH_HANG')).find({ KHACH_HANG_ID: { $in: ordersRaw.map(o => o.KHACH_HANG_ID).filter(Boolean) } }, { projection: { KHACH_HANG_ID: 1, TEN: 1 } }).toArray();
    const details = await (await getCollection<any>('DON_HANG_CHI_TIET')).find({ DON_HANG_ID: { $in: ids } }).toArray();
    const products = await (await getCollection<any>('SAN_PHAM')).find({ SAN_PHAM_ID: { $in: details.map(i => i.SAN_PHAM_ID) } }, { projection: { SAN_PHAM_ID: 1, TEN_SAN_PHAM: 1 } }).toArray();
    const productNames = new Map(products.map(p => [p.SAN_PHAM_ID, p.TEN_SAN_PHAM]));
    const orders = ordersRaw
      .sort((left, right) => (toDate(right.NGAY_TAO)?.getTime() || 0) - (toDate(left.NGAY_TAO)?.getTime() || 0))
      .map((row) => {
        const payment = paymentMap.get(row.DON_HANG_ID);
        return {
          id: row.DON_HANG_ID,
          senderName: row.TEN_NGUOI_DAT || customers.find(c => c.KHACH_HANG_ID === row.KHACH_HANG_ID)?.TEN || 'Khách vãng lai',
          receiverName: row.TEN_NGUOI_NHAN || '',
          products: details.filter(i => i.DON_HANG_ID === row.DON_HANG_ID).map(i => ({ name: i.TEN_SAN_PHAM_SNAPSHOT || productNames.get(i.SAN_PHAM_ID) || i.SAN_PHAM_ID, qty: i.SO_LUONG })),
          deliveryDate: formatDate(row.NGAY_MUON_GIAO), deliverySlot: row.KHUNG_GIO_MUON_GIAO || '',
          deposit: Number(row.TIEN_COC || 0), paid: Math.max(0, payment?.paidAmount || 0),
          remaining: Math.max(0, Number(row.TONG_TIEN || 0) - (payment?.paidAmount || 0)),
          allowedStatuses: allowedOrderStatuses(row, payment?.paidAmount || 0), adminNote: row.GHI_CHU_NOI_BO || '',
          customerId: row.KHACH_HANG_ID || '',
          createdAt: formatDate(row.NGAY_TAO),
          total: Number(row.TONG_TIEN || 0),
          paymentStatus: normalizePaymentStatus(payment?.latest?.TRANG_THAI_THANH_TOAN, row.TIEN_COC, row.TONG_TIEN, payment?.paidAmount || 0),
          orderStatus: normalizeOrderStatus(row.TRANG_THAI),
          selected: false,
        };
      });
    return res.status(200).json({ total: orders.length, orders });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể lấy danh sách đơn hàng: ' + error.message });
  }
};

export const getAdminOrderDetail = async (req: Request, res: Response) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId) return res.status(400).json({ message: 'Thiếu mã đơn hàng.' });
    const order = await getAdminOrderDetailById(orderId);
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    return res.status(200).json({ order });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể lấy chi tiết đơn hàng: ' + error.message });
  }
};

export const createAdminOrder = async (req: Request, res: Response) => {
  const body = req.body || {};
  // Admin uses exactly the same price validation, reservation and idempotency as Customer.
  // It never treats a user-entered paid/deposit field as a verified receipt.
  res.locals.adminCheckout = true;
  req.body = {
    checkoutSessionId: body.checkoutSessionId,
    customerId: body.customerId || body.senderCustomerId || null,
    sender: { name: body.senderName, phone: body.senderPhone, email: body.senderEmail },
    receiver: { name: body.receiverName, phone: body.receiverPhone, address: body.deliveryAddress,
      districtName: body.districtName, provinceName: body.provinceName },
    delivery: { date: body.deliveryDate, time: body.deliverySlot || body.deliveryTime, message: body.cardMessage, noteShop: body.customerNote },
    shippingMethod: body.shippingMethod || 'standard',
    items: body.items || body.products,
    payment: { method: /cod|tiền mặt|nhận hàng/i.test(String(body.paymentMethod)) ? 'cod'
      : /momo/i.test(String(body.paymentMethod)) ? 'momo' : /vnpay/i.test(String(body.paymentMethod)) ? 'vnpay'
      : /chuyển khoản|^bank$/i.test(String(body.paymentMethod)) ? 'bank' : '' },
    summary: { loyaltyPoints: body.loyaltyPoints || 0, loyaltyDiscount: Number(body.loyaltyPoints || 0) / 2 * 1000 },
    voucher: body.voucher || null,
    adminNote: String(body.adminNote || ''),
    flags: { hideSender: body.hideSender, requestVAT: body.requestVAT, sendZaloPhoto: body.sendZaloPhoto },
  };
  return createOrder(req, res);
};

export const getAdminCustomers = async (_req: Request, res: Response) => {
  try {
    const customerCollection = await getCollection<any>('KHACH_HANG');
    const customers = (await customerCollection.find({}).sort({ KHACH_HANG_ID: 1 }).toArray()).map((customer) => {
      const { MAT_KHAU, ...safe } = customer;
      return {
        ...safe,
        id: customer.KHACH_HANG_ID,
        name: customer.TEN,
        phone: customer.SDT,
        email: customer.EMAIL,
        memberType: customer.LOAI_THANH_VIEN,
        points: Number(customer.DIEM_TICH_LUY || 0),
        selected: false,
      };
    });
    return res.status(200).json({ total: customers.length, customers });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể tải khách hàng: ' + error.message });
  }
};

export const getAdminCustomerDetail = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const [customerCollection, addressCollection, orderCollection, wishlistCollection] = await Promise.all([
      getCollection<any>('KHACH_HANG'),
      getCollection<any>('DIA_CHI_GIAO_HANG'),
      getCollection<any>('DON_HANG'),
      getCollection<any>('YEU_THICH'),
    ]);
    const customer = await customerCollection.findOne({ KHACH_HANG_ID: customerId });
    if (!customer) return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    const [addresses, orders, wishlist] = await Promise.all([
      addressCollection.find({ KHACH_HANG_ID: customerId, DA_XOA: { $ne: true } }).toArray(),
      orderCollection.find({ KHACH_HANG_ID: customerId }).sort({ NGAY_TAO: -1 }).toArray(),
      wishlistCollection.find({ KHACH_HANG_ID: customerId }).toArray(),
    ]);
    const { MAT_KHAU, ...safeCustomer } = customer;
    return res.status(200).json({
      customer: safeCustomer,
      addresses,
      orders,
      favorites: wishlist,
      stats: {
        totalOrders: orders.length,
        totalSpent: orders.reduce((sum, order) => sum + Number(order.TONG_TIEN || 0), 0),
        favorites: wishlist.length,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể tải chi tiết khách hàng: ' + error.message });
  }
};

export const updateAdminCustomer = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { name, phone, email, birthDate, gender, status } = req.body;
    const customerCollection = await getCollection<any>('KHACH_HANG');
    const result = await customerCollection.findOneAndUpdate(
      { KHACH_HANG_ID: customerId },
      {
        $set: {
          TEN: name ?? req.body.TEN,
          SDT: phone ?? req.body.SDT,
          EMAIL: email ?? req.body.EMAIL ?? null,
          DOB: parseOptionalDate(birthDate ?? req.body.DOB),
          GIOI_TINH: gender ?? req.body.GIOI_TINH,
          ...(status ? { TRANG_THAI: status } : {}),
        },
      },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    const { MAT_KHAU, ...safeCustomer } = result;
    return res.status(200).json({ message: 'Customer updated.', customer: safeCustomer });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update customer: ' + error.message });
  }
};

const normalizeAddressBody = (body: any) => ({
  TEN_NGUOI_NHAN: body.receiverName || body.TEN_NGUOI_NHAN || '',
  SDT_NGUOI_NHAN: body.receiverPhone || body.SDT_NGUOI_NHAN || '',
  TINH_THANH: body.province || body.TINH_THANH || '',
  QUAN_HUYEN: body.district || body.QUAN_HUYEN || '',
  PHUONG_XA: body.ward || body.PHUONG_XA || '',
  DIA_CHI_CHI_TIET: body.detailAddress || body.DIA_CHI_CHI_TIET || '',
});

export const createAdminCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const addressCollection = await getCollection<any>('DIA_CHI_GIAO_HANG');
    const addressId = await getNextPrefixedId('DIA_CHI_GIAO_HANG', 'DIA_CHI_ID', 'DC', 4);
    const isDefault = toBool(req.body.isDefault ?? req.body.LA_MAC_DINH);
    if (isDefault) await addressCollection.updateMany({ KHACH_HANG_ID: customerId }, { $set: { LA_MAC_DINH: false } });
    const address = {
      _id: addressId,
      DIA_CHI_ID: addressId,
      KHACH_HANG_ID: customerId,
      ...normalizeAddressBody(req.body),
      LA_MAC_DINH: isDefault,
      DA_XOA: false,
    };
    await addressCollection.insertOne(address);
    return res.status(201).json({ message: 'Address created.', address });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create address: ' + error.message });
  }
};

export const updateAdminCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { customerId, addressId } = req.params;
    const addressCollection = await getCollection<any>('DIA_CHI_GIAO_HANG');
    const isDefault = toBool(req.body.isDefault ?? req.body.LA_MAC_DINH);
    if (isDefault) await addressCollection.updateMany({ KHACH_HANG_ID: customerId }, { $set: { LA_MAC_DINH: false } });
    const result = await addressCollection.findOneAndUpdate(
      { KHACH_HANG_ID: customerId, DIA_CHI_ID: addressId },
      { $set: { ...normalizeAddressBody(req.body), LA_MAC_DINH: isDefault } },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ message: 'Không tìm thấy địa chỉ.' });
    return res.status(200).json({ message: 'Address updated.', address: result });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update address: ' + error.message });
  }
};

export const setDefaultAdminCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { customerId, addressId } = req.params;
    const addressCollection = await getCollection<any>('DIA_CHI_GIAO_HANG');
    await addressCollection.updateMany({ KHACH_HANG_ID: customerId }, { $set: { LA_MAC_DINH: false } });
    const result = await addressCollection.updateOne({ KHACH_HANG_ID: customerId, DIA_CHI_ID: addressId }, { $set: { LA_MAC_DINH: true } });
    if (result.matchedCount === 0) return res.status(404).json({ message: 'Không tìm thấy địa chỉ.' });
    return res.status(200).json({ message: 'Default address updated.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot set default address: ' + error.message });
  }
};

export const deleteAdminCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { customerId, addressId } = req.params;
    const addressCollection = await getCollection<any>('DIA_CHI_GIAO_HANG');
    const result = await addressCollection.updateOne(
      { KHACH_HANG_ID: customerId, DIA_CHI_ID: addressId },
      { $set: { DA_XOA: true, LA_MAC_DINH: false } },
    );
    if (result.matchedCount === 0) return res.status(404).json({ message: 'Không tìm thấy địa chỉ.' });
    return res.status(200).json({ message: 'Address deleted.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete address: ' + error.message });
  }
};

export const getAdminTransactions = async (_req: Request, res: Response) => {
  try {
    const paymentCollection = await getCollection<any>('THANH_TOAN');
    const rows = await paymentCollection.find({}).sort({ NGAY_THANH_TOAN: -1 }).toArray();
    const orders = await (await getCollection<any>('DON_HANG')).find({ DON_HANG_ID: { $in: rows.map(r => r.DON_HANG_ID) } }).toArray();
    const transactions = rows.map((row, index) => {
      const order = orders.find(o => o.DON_HANG_ID === row.DON_HANG_ID);
      const paid = Math.max(0, sumVerifiedPayments(rows.filter(p => p.DON_HANG_ID === row.DON_HANG_ID)));
      return { ...row, id: index + 1, code: row.THANH_TOAN_ID, orderCode: row.DON_HANG_ID,
        orderId: row.DON_HANG_ID, gateway: row.CONG_THANH_TOAN || '', referenceCode: row.MA_GIAO_DICH || '',
        amount: Number(row.SO_TIEN || 0), status: row.TRANG_THAI_THANH_TOAN,
        transactionDate: row.NGAY_THANH_TOAN, paidAt: row.NGAY_THANH_TOAN,
        total: Number(order?.TONG_TIEN || 0), deposit: Number(order?.TIEN_COC || 0), paid,
        remaining: Math.max(0, Number(order?.TONG_TIEN || 0) - paid),
        editable: row.TRANG_THAI_THANH_TOAN === 'Chờ thanh toán' && !!order && !['Đã hủy','Đã hoàn tiền'].includes(order.TRANG_THAI),
        history: row.LICH_SU || [], confirmedAt: row.XAC_NHAN_LUC || null, confirmedBy: row.NGUOI_XAC_NHAN || '', selected: false };
    });
    return res.status(200).json({ total: transactions.length, transactions });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load transactions: ' + error.message });
  }
};

export const updateAdminTransaction = async (req: Request, res: Response) => {
  try {
    const transaction = await withTransaction(session => changeCheckoutPayment(session, String(req.params.transactionId), req.body,
      String(res.locals?.adminEmployee?.NHAN_VIEN_ID || req.headers?.['x-admin-id'] || '')));
    return res.json({ message: 'Đã xác minh giao dịch.', transaction });
  } catch (e: any) {
    return res.status(e instanceof InventoryError ? e.status : e.code === 11000 ? 409 : 500).json({ message: e instanceof InventoryError ? e.message : 'Không thể cập nhật giao dịch.' });
  }
};

export const createAdminTransaction = async (req: Request, res: Response) => {
  try {
    const orderId = String(req.body.orderCode || req.body.orderId || '').trim();
    const transaction = await withTransaction(async session => {
      const payments = await getCollection<any>('THANH_TOAN');
      const orders = await getCollection<any>('DON_HANG');
      const order = await orders.findOne({ DON_HANG_ID: orderId }, { session });
      if (!order) throw new InventoryError(404, 'Không tìm thấy đơn hàng.');
      const rows = await payments.find({ DON_HANG_ID: orderId }, { session }).toArray();
      const reference = String(req.body.referenceCode || '').trim();
      const prior = reference && rows.find(p => p.MA_GIAO_DICH === reference);
      let target = prior || rows.find(p => p.TRANG_THAI_THANH_TOAN === 'Chờ thanh toán');
      if (!target) {
        const paid = sumVerifiedPayments(rows), remaining = Number(order.TONG_TIEN) - paid;
        if (!(paid > 0 || order.KHONG_YEU_CAU_COC) || !(remaining > 0) || Number(req.body.amount) !== remaining || !reference) throw new InventoryError(409, 'Cần khoản thu số dư chính xác và mã tham chiếu riêng.');
        if (['Đã hủy', 'Thanh toán thất bại'].includes(order.TRANG_THAI)) throw new InventoryError(409, 'Đơn không còn cho phép thu số dư.');
        const id = `TT${randomUUID().replaceAll('-', '')}`;
        target = { _id: id, THANH_TOAN_ID: id, DON_HANG_ID: orderId, CONG_THANH_TOAN: order.PHUONG_THUC_THANH_TOAN,
          SO_TIEN: remaining, LOAI_GIAO_DICH: 'SO_DU', MA_GIAO_DICH: reference, TRANG_THAI_THANH_TOAN: 'Chờ thanh toán', NGAY_THANH_TOAN: new Date() };
        await orders.updateOne({ DON_HANG_ID: orderId }, { $inc: { PHIEN_BAN_THANH_TOAN: 1 } }, { session });
        await payments.insertOne(target, { session });
      }
      if (normalizeTransactionStatus(req.body.status) === 'Chờ thanh toán') {
        if (target.TRANG_THAI_THANH_TOAN !== 'Chờ thanh toán' || Number(req.body.amount) !== Number(target.SO_TIEN)) throw new InventoryError(409, 'Không thể mở lại hoặc sửa tiền một giao dịch đã xử lý.');
        return target;
      }
      return changeCheckoutPayment(session, target.THANH_TOAN_ID, { status: normalizeTransactionStatus(req.body.status), amount: req.body.amount, referenceCode: reference || undefined },
        String(res.locals?.adminEmployee?.NHAN_VIEN_ID || ''));
    });
    return res.status(201).json({ message: 'Đã ghi nhận khoản thu hợp lệ.', transaction });
  } catch (e: any) {
    return res.status(e instanceof InventoryError ? e.status : e.code === 11000 ? 409 : 500).json({ message: e instanceof InventoryError ? e.message : 'Không thể ghi nhận khoản thu.' });
  }
};

export const updateAdminOrderPaymentStatus = async (req: Request, res: Response) => {
  try {
    const orderId = String(req.params.orderId);
    await withTransaction(async session => {
      const payments = await getCollection<any>('THANH_TOAN');
      const rows = await payments.find({ DON_HANG_ID: orderId }, { session }).sort({ NGAY_THANH_TOAN: -1 }).toArray();
      const payment = rows.find(p => p.TRANG_THAI_THANH_TOAN === 'Chờ thanh toán') || rows.find(p => p.TRANG_THAI_THANH_TOAN === 'Thành công');
      if (!payment) throw new InventoryError(409, 'Đơn không có phiên thanh toán hợp lệ.');
      await changeCheckoutPayment(session, payment.THANH_TOAN_ID, {
        status: normalizeTransactionStatus(req.body.status),
        amount: req.body.paidAmount ?? req.body.amount,
        referenceCode: req.body.referenceCode,
      }, String(res.locals?.adminEmployee?.NHAN_VIEN_ID || req.headers?.['x-admin-id'] || ''));
    });
    const order = await getAdminOrderDetailById(orderId);
    return res.json({ message: 'Đã xác minh thanh toán.', order });
  } catch (e: any) {
    return res.status(e instanceof InventoryError ? e.status : e.code === 11000 ? 409 : 500).json({ message: e instanceof InventoryError ? e.message : 'Không thể xác minh thanh toán.' });
  }
};

export const getAdminProducts = async (_req: Request, res: Response) => {
  try {
    const [productCollection, reviewCollection, materialCollection] = await Promise.all([
      getCollection<any>('SAN_PHAM'),
      getCollection<any>('DANH_GIA'),
      getCollection<any>('NGUYEN_VAT_LIEU'),
    ]);
    const productsRaw = await productCollection.find({}).sort({ SAN_PHAM_ID: -1 }).toArray();
    const productIds = productsRaw.map((product) => product.SAN_PHAM_ID);
    const [imageMap, reviews, materials, bomMap] = await Promise.all([
      getPrimaryImageMap(productIds),
      reviewCollection.find({}).toArray(),
      materialCollection.find({}).toArray(),
      getActiveBomMap(productIds),
    ]);
    const materialsById = new Map(materials.map((material) => [material.NGUYEN_VAT_LIEU_ID, material]));
    const ratingMap = new Map<string, number>();
    for (const product of productsRaw) {
      const productReviews = reviews.filter((review) => review.SAN_PHAM_ID === product.SAN_PHAM_ID);
      ratingMap.set(product.SAN_PHAM_ID, productReviews.length ? productReviews.reduce((sum, review) => sum + Number(review.SO_SAO || 0), 0) / productReviews.length : 0);
    }
    const products = productsRaw.map((product) => {
      const finished = Math.floor(finishedAvailableOf(product));
      const buildable = computeBuildable(bomMap.get(product.SAN_PHAM_ID) || [], materialsById).buildable;
      return mapAdminProduct(product, imageMap.get(product.SAN_PHAM_ID), ratingMap.get(product.SAN_PHAM_ID), { finished, buildable });
    });
    return res.status(200).json({ total: products.length, products });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load admin products: ' + error.message });
  }
};

export const createAdminProduct = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const productId = String(body.sku || body.productId || '').trim() || await getNextPrefixedId('SAN_PHAM', 'SAN_PHAM_ID', 'SP', 4);
    if (!body.name && !body.TEN_SAN_PHAM) return res.status(400).json({ message: 'Missing product fields.' });
    const productCollection = await getCollection<any>('SAN_PHAM');
    const product = {
      _id: productId,
      SAN_PHAM_ID: productId,
      CHU_DE_ID: body.topic || body.CHU_DE_ID || null,
      TEN_SAN_PHAM: body.name || body.TEN_SAN_PHAM,
      MO_TA: body.description || body.MO_TA || '',
      GIA: money(body.salePrice ?? body.GIA),
      GIA_KHUYEN_MAI: money(body.discountPrice ?? body.GIA_KHUYEN_MAI),
      TRANG_THAI: body.status || 'Đang bán',
      KIEU_DANG: body.style || body.KIEU_DANG || '',
      DA_BAN: 0,
    };
    await productCollection.insertOne(product);
    await replaceProductImages(productId, body.images || []);
    const created = await getAdminProduct(productId);
    return res.status(201).json({ message: 'Product created.', product: created });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create product: ' + error.message });
  }
};

const replaceProductImages = async (productId: string, images: any[]) => {
  if (!Array.isArray(images)) return;
  const imageCollection = await getCollection<any>('HINH_ANH_SAN_PHAM');
  await imageCollection.deleteMany({ SAN_PHAM_ID: productId });
  let index = 0;
  for (const image of images.map((item) => typeof item === 'string' ? item : item?.url || item?.URL).filter(Boolean)) {
    const imageId = await getNextPrefixedId('HINH_ANH_SAN_PHAM', 'HINH_ANH_ID', 'HA', 5);
    await imageCollection.insertOne({
      _id: imageId,
      HINH_ANH_ID: imageId,
      SAN_PHAM_ID: productId,
      URL: image,
      LA_ANH_CHINH: index === 0,
    });
    index += 1;
  }
};

const getAdminProduct = async (productId: string) => {
  const productCollection = await getCollection<any>('SAN_PHAM');
  const product = await productCollection.findOne({ SAN_PHAM_ID: productId });
  if (!product) return null;
  const [imageMap, images, materials, bomMap] = await Promise.all([
    getPrimaryImageMap([productId]),
    (await getCollection<any>('HINH_ANH_SAN_PHAM')).find({ SAN_PHAM_ID: productId }).toArray(),
    (await getCollection<any>('NGUYEN_VAT_LIEU')).find({}).toArray(),
    getActiveBomMap([productId]),
  ]);
  const materialsById = new Map(materials.map((material) => [material.NGUYEN_VAT_LIEU_ID, material]));
  const stock = {
    finished: Math.floor(finishedAvailableOf(product)),
    buildable: computeBuildable(bomMap.get(productId) || [], materialsById).buildable,
  };
  return { ...mapAdminProduct(product, imageMap.get(productId), 0, stock), raw: product, images };
};

export const getAdminProductDetail = async (req: Request, res: Response) => {
  try {
    const product = await getAdminProduct(req.params.productId);
    if (!product) return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    return res.status(200).json({ product });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load product: ' + error.message });
  }
};

export const updateAdminProductDetail = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const body = req.body || {};
    const productCollection = await getCollection<any>('SAN_PHAM');
    const result = await productCollection.findOneAndUpdate(
      { SAN_PHAM_ID: productId },
      {
        $set: {
          ...(body.topic !== undefined || body.CHU_DE_ID !== undefined ? { CHU_DE_ID: body.topic || body.CHU_DE_ID || null } : {}),
          ...(body.name !== undefined || body.TEN_SAN_PHAM !== undefined ? { TEN_SAN_PHAM: body.name || body.TEN_SAN_PHAM } : {}),
          ...(body.description !== undefined || body.MO_TA !== undefined ? { MO_TA: body.description || body.MO_TA || '' } : {}),
          ...(body.salePrice !== undefined || body.GIA !== undefined ? { GIA: money(body.salePrice ?? body.GIA) } : {}),
          ...(body.discountPrice !== undefined || body.GIA_KHUYEN_MAI !== undefined ? { GIA_KHUYEN_MAI: money(body.discountPrice ?? body.GIA_KHUYEN_MAI) } : {}),
          ...(body.status !== undefined ? { TRANG_THAI: body.status } : {}),
          ...(body.style !== undefined || body.KIEU_DANG !== undefined ? { KIEU_DANG: body.style || body.KIEU_DANG || '' } : {}),
          // Số lượng bán được là dữ liệu dẫn xuất từ tồn thành phẩm + BOM,
          // không cho form chi tiết ghi đè vào SO_LUONG cũ.
        },
      },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    if (Array.isArray(body.images)) await replaceProductImages(productId, body.images);
    const product = await getAdminProduct(productId);
    return res.status(200).json({ message: 'Product updated.', product });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update product: ' + error.message });
  }
};

export const updateAdminProductStatus = async (req: Request, res: Response) => {
  try {
    const productCollection = await getCollection<any>('SAN_PHAM');
    const status = String(req.body.status || req.body.TRANG_THAI || '').trim();
    const result = await productCollection.updateOne({ SAN_PHAM_ID: req.params.productId }, { $set: { TRANG_THAI: status } });
    if (result.matchedCount === 0) return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    return res.status(200).json({ message: 'Product status updated.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update product status: ' + error.message });
  }
};

export const deleteAdminProduct = async (req: Request, res: Response) => {
  try {
    const productId = req.params.productId;
    await Promise.all([
      (await getCollection<any>('SAN_PHAM')).deleteOne({ SAN_PHAM_ID: productId }),
      (await getCollection<any>('HINH_ANH_SAN_PHAM')).deleteMany({ SAN_PHAM_ID: productId }),
    ]);
    return res.status(200).json({ message: 'Product deleted.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete product: ' + error.message });
  }
};

export const getAdminCategories = async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type || 'topic');
    if (type === 'style') {
      const products = await (await getCollection<any>('SAN_PHAM')).find({}).toArray();
      const counts = new Map<string, number>();
      for (const product of products) {
        const name = String(product.KIEU_DANG || 'Chưa phân loại').trim() || 'Chưa phân loại';
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      const categories = Array.from(counts.entries()).sort().map(([name, total], index) => ({
        code: `STYLE${String(index + 1).padStart(3, '0')}`,
        name,
        total,
        selected: false,
      }));
      return res.status(200).json({ type, categories });
    }
    const config = categoryConfig[type];
    if (!config) return res.status(400).json({ message: 'Invalid category type.' });
    const rows = await (await getCollection<any>(config.collection)).find({}).sort({ [config.idField]: 1 }).toArray();
    const linkRows = config.linkCollection ? await (await getCollection<any>(config.linkCollection)).find({}).toArray() : [];
    const products = !config.linkCollection ? await (await getCollection<any>('SAN_PHAM')).find({}).toArray() : [];
    const categories = rows.map((row) => ({
      code: row[config.idField],
      name: row[config.nameField],
      total: config.linkCollection
        ? new Set(linkRows.filter((link) => link[config.idField] === row[config.idField]).map((link) => link.SAN_PHAM_ID)).size
        : products.filter((product) => product[config.idField] === row[config.idField]).length,
      selected: false,
    }));
    return res.status(200).json({ type, categories });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load categories: ' + error.message });
  }
};

export const createAdminCategory = async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type || 'topic');
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Missing category name.' });
    if (type === 'style') return res.status(400).json({ message: 'Style categories are generated from product data.' });
    const config = categoryConfig[type];
    if (!config) return res.status(400).json({ message: 'Invalid category type.' });
    const id = await getNextPrefixedId(config.collection, config.idField, config.prefix, 3);
    await (await getCollection<any>(config.collection)).insertOne({ _id: id, [config.idField]: id, [config.nameField]: name });
    return res.status(201).json({ message: 'Category created.', category: { code: id, name, total: 0, selected: false } });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create category: ' + error.message });
  }
};

export const deleteAdminCategory = async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type || 'topic');
    if (type === 'style') return res.status(400).json({ message: 'Style categories are generated from product data.' });
    const config = categoryConfig[type];
    if (!config) return res.status(400).json({ message: 'Invalid category type.' });
    await (await getCollection<any>(config.collection)).deleteOne({ [config.idField]: req.params.categoryId });
    return res.status(200).json({ message: 'Category deleted.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete category: ' + error.message });
  }
};

// Các API NVL / NCC / phiếu nhập / phiếu xuất đã chuyển sang controllers/inventory.ts
// (services/inventory/*) để áp dụng quy tắc kho mới: Nháp→Đã ghi nhận, FIFO, giữ tồn, sổ biến động.

export const uploadAdminMaterialImage = (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ message: 'Chưa chọn ảnh.' });
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return res.status(201).json({
    message: 'Upload image thành công.',
    url: `${publicBaseUrl}/uploads/materials/${req.file.filename}`,
  });
};

export const updateAdminOrderStatus = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    let status = String(req.body.status || req.body.TRANG_THAI || '').trim();
    await withTransaction(async session => {
    const orders = await getCollection<any>('DON_HANG');
    const current = await orders.findOne({ DON_HANG_ID: orderId }, { session });
    if (!current) throw new InventoryError(404, 'Không tìm thấy đơn hàng.');
    const actor = String(res.locals?.adminEmployee?.NHAN_VIEN_ID || '');
    if (req.body.action === 'note' || req.body.action === 'preparation') {
      const changes: any = {};
      if (req.body.action === 'note') {
        if (typeof req.body.adminNote !== 'string' || req.body.adminNote.length > 2000) throw new InventoryError(400, 'Ghi chú nội bộ tối đa 2.000 ký tự.');
        changes.GHI_CHU_NOI_BO = req.body.adminNote.trim();
      } else {
        const at = toDate(req.body.preparationAt);
        if (current.TRANG_THAI !== 'Chờ xử lý' || !at || current.THOI_DIEM_BAT_DAU_CHUAN_BI && new Date(current.THOI_DIEM_BAT_DAU_CHUAN_BI).getTime() <= Date.now()) throw new InventoryError(409, 'Chỉ nhập T cho đơn chờ xử lý, chưa bắt đầu chuẩn bị.');
        const date = current.NGAY_MUON_GIAO ? new Date(current.NGAY_MUON_GIAO).toISOString().slice(0, 10) : '';
        if (!date || at.getTime() > new Date(`${date}T23:59:59+07:00`).getTime()) throw new InventoryError(400, 'T không được sau ngày giao đã chốt.');
        changes.THOI_DIEM_BAT_DAU_CHUAN_BI = at; changes.NGUOI_NHAP_T = actor;
      }
      await orders.updateOne({ DON_HANG_ID: orderId }, { $set: { ...changes, NGAY_CAP_NHAT: new Date() },
        $push: { LICH_SU_TRANG_THAI: { from: current.TRANG_THAI, to: current.TRANG_THAI, action: req.body.action, at: new Date(), actor } } } as any, { session });
      return;
    }
    if (!status) throw new InventoryError(400, 'Thiếu trạng thái đơn.');
    if (status === 'Giao thành công') status = 'Đã giao';
    if (status === 'Từ chối hoàn tiền/trả hàng' && (typeof req.body.rejectReason !== 'string' || !req.body.rejectReason.trim() || req.body.rejectReason.length > 2000)) throw new InventoryError(400, 'Cần lý do từ chối từ 1–2.000 ký tự.');
    if (status === current.TRANG_THAI) {
      if (status === 'Từ chối hoàn tiền/trả hàng' && current.LY_DO_TU_CHOI !== req.body.rejectReason.trim()) throw new InventoryError(409, 'Quyết định đã được ghi nhận; không ghi đè lý do đã chốt.');
      return;
    }
    if (status === 'Từ chối hoàn tiền/trả hàng' && await (await getCollection<any>(AFTER_SALES)).findOne({orderId,active:true},{session})) throw new InventoryError(409,'Yêu cầu có hồ sơ hậu mãi độc lập. Hãy xử lý quyết định trong hồ sơ để đồng bộ kết quả.');
    if (status === 'Từ chối hoàn tiền/trả hàng' && !String(current.LY_DO_HOAN_TIEN_TRA_HANG || '').trim()) throw new InventoryError(409, 'Thiếu nội dung yêu cầu trả/hoàn gốc; cần bổ sung hồ sơ hậu mãi ở Stage 4.');
    const receipts = await (await getCollection<any>('THANH_TOAN')).find({ DON_HANG_ID: orderId }, { session }).toArray();
    assertOrderTransition(current, status, sumVerifiedPayments(receipts));
    await orderEvent(session,orderId+':status:'+status,current.KHACH_HANG_ID||null,String(orderId),'Cập nhật đơn hàng',status);
    if (current?.KIEM_TRA_TON_KHO && status === 'Đã hủy') {
      await releaseReservations({ orderId }, { id: String(req.headers['x-admin-id'] || ''), role: 'Admin' }, 'Admin hủy đơn', session);
    }
    await (await getCollection<any>('DON_HANG')).updateOne(
      { DON_HANG_ID: orderId },
      {
        $set: {
          TRANG_THAI: status,
          ...(status === 'Từ chối hoàn tiền/trả hàng' ? { LY_DO_TU_CHOI: String(req.body.rejectReason).trim() } : {}),
          // Mốc thời gian cho Dashboard/Báo cáo (D05): doanh thu tính theo ngày hoàn thành, tỷ lệ hủy theo ngày hủy
          ...(status === 'Hoàn thành' && !current?.NGAY_HOAN_THANH ? { NGAY_HOAN_THANH: new Date() } : {}),
          ...(status === 'Đã hủy' && !current?.NGAY_HUY ? { NGAY_HUY: new Date() } : {}),
          NGAY_CAP_NHAT: new Date(),
        },
        $push: { LICH_SU_TRANG_THAI: { from: current.TRANG_THAI, to: status, at: new Date(), actor, ...(status === 'Từ chối hoàn tiền/trả hàng' ? { reason: req.body.rejectReason.trim() } : {}) } },
      } as any,
      { session },
    );
    });
    invalidateAnalyticsCache(); // Dashboard lấy số mới ở lần xem tiếp theo
    const order = await getAdminOrderDetailById(orderId);
    return res.status(200).json({ message: 'Order status updated.', order });
  } catch (error: any) {
    return res.status(error instanceof InventoryError ? error.status : 500).json({ message: error instanceof InventoryError ? error.message : 'Không thể cập nhật trạng thái đơn.' });
  }
};

export const getAdminDashboard = async (_req: Request, res: Response) => {
  try {
    const [orders, customers, details, products, materials] = await Promise.all([
      (await getCollection<any>('DON_HANG')).find({}).toArray(),
      (await getCollection<any>('KHACH_HANG')).find({}).toArray(),
      (await getCollection<any>('DON_HANG_CHI_TIET')).find({}).toArray(),
      (await getCollection<any>('SAN_PHAM')).find({}).toArray(),
      (await getCollection<any>('NGUYEN_VAT_LIEU')).find({}).toArray(),
    ]);
    const recentOrdersRaw = orders.sort((left, right) => (toDate(right.NGAY_TAO)?.getTime() || 0) - (toDate(left.NGAY_TAO)?.getTime() || 0)).slice(0, 10);
    const paymentMap = await getLatestPaymentByOrderIds(recentOrdersRaw.map((order) => order.DON_HANG_ID));
    const imageMap = await getPrimaryImageMap(products.map((product) => product.SAN_PHAM_ID));
    const detailProductCounts = new Map<string, number>();
    details.forEach((detail) => detailProductCounts.set(detail.SAN_PHAM_ID, (detailProductCounts.get(detail.SAN_PHAM_ID) || 0) + Number(detail.SO_LUONG || 0)));
    const bestProducts = products
      .map((product) => ({ ...product, TOTAL_ORDERS: detailProductCounts.get(product.SAN_PHAM_ID) || 0 }))
      .sort((left, right) => Number(right.TOTAL_ORDERS || 0) - Number(left.TOTAL_ORDERS || 0))
      .slice(0, 5)
      .map((product) => ({
        id: product.SAN_PHAM_ID,
        name: product.TEN_SAN_PHAM,
        price: Number(product.GIA || 0),
        status: product.TRANG_THAI,
        orders: Number(product.TOTAL_ORDERS || 0),
        image: imageMap.get(product.SAN_PHAM_ID)?.URL || '',
      }));
    const recentOrders = recentOrdersRaw.map((order) => {
      const payment = paymentMap.get(order.DON_HANG_ID);
      return {
        id: order.DON_HANG_ID,
        customer: order.KHACH_HANG_ID || '',
        date: formatDate(order.NGAY_TAO),
        total: `${Number(order.TONG_TIEN || 0).toLocaleString('vi-VN')}đ`,
        payment: normalizePaymentStatus(payment?.latest?.TRANG_THAI_THANH_TOAN, order.TIEN_COC, order.TONG_TIEN, payment?.paidAmount || 0),
        status: normalizeOrderStatus(order.TRANG_THAI),
      };
    });
    return res.status(200).json({
      summary: {
        totalOrders: orders.length,
        newOrders: orders.filter((order) => ['Chờ xử lý', 'Chờ thanh toán'].includes(String(order.TRANG_THAI))).length,
        completedOrders: orders.filter((order) => normalizeText(order.TRANG_THAI).includes('hoan thanh')).length,
        cancelledOrders: orders.filter((order) => normalizeText(order.TRANG_THAI).includes('huy')).length,
        revenue: orders.reduce((sum, order) => sum + Number(order.TONG_TIEN || 0), 0),
        newCustomers: customers.length,
        productsSold: details.reduce((sum, detail) => sum + Number(detail.SO_LUONG || 0), 0),
        warningMaterials: materials.filter((material) => material.TRANG_THAI !== 'Ngừng sử dụng' && (Number(material.TON_THUC ?? material.SO_LUONG_TON ?? 0) - Number(material.TON_DANG_GIU || 0) - Number(material.TON_KHONG_DAT || 0)) <= Number(material.NGUONG_CANH_BAO ?? 10)).length,
      },
      chart: [],
      orders: recentOrders,
      deliveries: recentOrdersRaw.map((order) => ({
        id: order.DON_HANG_ID,
        customer: order.KHACH_HANG_ID || '',
        address: order.DIA_CHI_GIAO_HANG || '',
        slot: order.KHUNG_GIO_MUON_GIAO || '',
        total: Number(order.TONG_TIEN || 0),
      })),
      bestProducts,
      // Cảnh báo NVL theo tồn KHẢ DỤNG so với ngưỡng (D01.7 tầng 1)
      warningMaterials: materials
        .filter((material) => material.TRANG_THAI !== 'Ngừng sử dụng')
        .map((material) => {
          const available = Number(material.TON_THUC ?? material.SO_LUONG_TON ?? 0) - Number(material.TON_DANG_GIU || 0) - Number(material.TON_KHONG_DAT || 0);
          const threshold = Number(material.NGUONG_CANH_BAO ?? 10) || 1;
          return { id: material.NGUYEN_VAT_LIEU_ID, name: material.TEN_NGUYEN_VAT_LIEU, image: material.URL_HINH_ANH || '', unit: material.DON_VI_TINH || '', quantity: Math.max(0, available), ratio: available / threshold };
        })
        .sort((a, b) => a.ratio - b.ratio)
        .slice(0, 5),
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load dashboard: ' + error.message });
  }
};

export const getAdminCampaigns = async (_req: Request, res: Response) => {
  try {
    const campaigns = await (await getCollection<any>('CHIEN_DICH')).find({}).sort({ CHIEN_DICH_ID: 1 }).toArray();
    return res.status(200).json({ total: campaigns.length, campaigns });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load campaigns: ' + error.message });
  }
};

export const createAdminCampaign = async (req: Request, res: Response) => {
  try {
    const campaignId = await getNextPrefixedId('CHIEN_DICH', 'CHIEN_DICH_ID', 'CD', 3);
    const campaign = {
      _id: campaignId,
      CHIEN_DICH_ID: campaignId,
      TEN_CHIEN_DICH: req.body.name || req.body.TEN_CHIEN_DICH,
      MO_TA: req.body.description || req.body.MO_TA || null,
      NGAY_BAT_DAU: parseOptionalDate(req.body.startDate || req.body.NGAY_BAT_DAU),
      NGAY_KET_THUC: parseOptionalDate(req.body.endDate || req.body.NGAY_KET_THUC),
      TRANG_THAI: req.body.status || req.body.TRANG_THAI || null,
    };
    await (await getCollection<any>('CHIEN_DICH')).insertOne(campaign);
    return res.status(201).json({ message: 'Campaign created.', campaign });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create campaign: ' + error.message });
  }
};

export const updateAdminCampaign = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const result = await (await getCollection<any>('CHIEN_DICH')).findOneAndUpdate(
      { CHIEN_DICH_ID: req.params.campaignId },
      {
        $set: {
          TEN_CHIEN_DICH: body.name ?? body.TEN_CHIEN_DICH,
          MO_TA: body.description ?? body.MO_TA ?? null,
          NGAY_BAT_DAU: parseOptionalDate(body.startDate || body.NGAY_BAT_DAU),
          NGAY_KET_THUC: parseOptionalDate(body.endDate || body.NGAY_KET_THUC),
          TRANG_THAI: body.status ?? body.TRANG_THAI ?? null,
        },
      },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ message: 'Không tìm thấy chiến dịch.' });
    return res.status(200).json({ message: 'Campaign updated.', campaign: result });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update campaign: ' + error.message });
  }
};

export const deleteAdminCampaign = async (req: Request, res: Response) => {
  try {
    await (await getCollection<any>('CHIEN_DICH')).deleteOne({ CHIEN_DICH_ID: req.params.campaignId });
    return res.status(200).json({ message: 'Campaign deleted.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete campaign: ' + error.message });
  }
};

export const getAdminVouchers = async (_req: Request, res: Response) => {
  try {
    const vouchers = await (await getCollection<any>('VOUCHER')).find({}).sort({ VOUCHER_ID: 1 }).toArray();
    return res.status(200).json({ total: vouchers.length, vouchers });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load vouchers: ' + error.message });
  }
};

const normalizeAdminDiscountType = (value: unknown): string => {
  const text = String(value || '').trim();
  const key = normalizeText(text);
  if (key.includes('phan') || key.includes('%')) return 'Phần trăm';
  if (key.includes('tien') || key.includes('amount')) return 'Số tiền';
  return text || 'Phần trăm';
};

export const createAdminVoucher = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const voucherId = await getNextPrefixedId('VOUCHER', 'VOUCHER_ID', 'VC', 5);
    const voucher = {
      _id: voucherId,
      VOUCHER_ID: voucherId,
      NHAN_VIEN_ID: body.employeeId || await getFirstEmployeeId(),
      CHIEN_DICH_ID: body.campaignCode || body.campaignId || null,
      KHACH_HANG_ID: body.customerId || null,
      MA_VOUCHER: String(body.voucherCode || body.code || '').trim(),
      LOAI_GIAM_GIA: normalizeAdminDiscountType(body.discountType),
      GIA_TRI_GIAM: Number(body.discountValue || body.value || 0),
      NGAY_BAT_DAU: parseOptionalDate(body.startDate),
      NGAY_KET_THUC: parseOptionalDate(body.endDate),
      DA_DUNG: false,
    };
    if (!voucher.MA_VOUCHER) return res.status(400).json({ message: 'Missing voucher code.' });
    await (await getCollection<any>('VOUCHER')).insertOne(voucher);
    return res.status(201).json({ message: 'Voucher created.', voucher });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create voucher: ' + error.message });
  }
};

export const updateAdminVoucher = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const result = await (await getCollection<any>('VOUCHER')).findOneAndUpdate(
      { VOUCHER_ID: req.params.voucherId },
      {
        $set: {
          CHIEN_DICH_ID: body.campaignCode ?? body.campaignId ?? null,
          MA_VOUCHER: String(body.voucherCode || body.code || '').trim(),
          LOAI_GIAM_GIA: normalizeAdminDiscountType(body.discountType),
          GIA_TRI_GIAM: Number(body.discountValue || body.value || 0),
          NGAY_BAT_DAU: parseOptionalDate(body.startDate),
          NGAY_KET_THUC: parseOptionalDate(body.endDate),
        },
      },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ message: 'Không tìm thấy voucher.' });
    return res.status(200).json({ message: 'Voucher updated.', voucher: result });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update voucher: ' + error.message });
  }
};

export const deleteAdminVoucher = async (req: Request, res: Response) => {
  try {
    await (await getCollection<any>('VOUCHER')).deleteOne({ VOUCHER_ID: req.params.voucherId });
    return res.status(200).json({ message: 'Voucher deleted.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete voucher: ' + error.message });
  }
};

export const getAdminAfterSales = async (_req: Request,res: Response) => {try{return res.json({requests:await (await getCollection<any>(AFTER_SALES)).find({}).sort({updatedAt:-1}).limit(500).toArray()});}catch{return res.status(500).json({message:'Chưa đọc được danh sách hậu mãi.'});}};
export const changeAdminAfterSales = async (req: Request,res: Response) => {try{return res.json({request:await afterSalesChange(String(req.params.requestId),req.body,String(res.locals.adminEmployee?.NHAN_VIEN_ID||''))});}catch(e:any){return res.status(e instanceof InventoryError?e.status:e.code===11000?409:500).json({message:e instanceof InventoryError?e.message:'Chưa xử lý được. Hãy tải lại hồ sơ.'});}};
