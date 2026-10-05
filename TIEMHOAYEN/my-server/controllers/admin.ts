import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';
import { getAdminOrderDetailById } from '../services/admin-order.service.js';

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value: unknown): string => {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
};

const formatTime = (value: unknown): string => {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: true }).format(date);
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
  const paid = Math.max(Number(paidAmount || 0), Number(deposit || 0));
  const totalAmount = Number(total || 0);
  if (key.includes('that bai')) return 'Thanh toán thất bại';
  if (key.includes('thanh cong') || key.includes('da thanh toan')) return 'Đã thanh toán';
  if (paid > 0 && totalAmount > 0 && paid >= totalAmount) return 'Đã thanh toán';
  if (paid > 0) return 'Đã cọc';
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

const mapAdminProduct = (row: any, image?: any, avgRating = 0) => ({
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
  quantity: Number(row.SO_LUONG || 0),
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
    const paidAmount = rows.reduce((sum, row) => sum + Number(row.SO_TIEN || 0), 0);
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
    const orders = ordersRaw
      .sort((left, right) => (toDate(right.NGAY_TAO)?.getTime() || 0) - (toDate(left.NGAY_TAO)?.getTime() || 0))
      .map((row) => {
        const payment = paymentMap.get(row.DON_HANG_ID);
        return {
          id: row.DON_HANG_ID,
          customerId: row.KHACH_HANG_ID || '',
          createdAt: formatDate(row.NGAY_TAO),
          total: Number(row.TONG_TIEN || 0),
          paymentStatus: normalizePaymentStatus(payment?.latest?.TRANG_THAI_THANH_TOAN, row.TIEN_COC, row.TONG_TIEN, payment?.paidAmount || payment?.latest?.SO_TIEN),
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
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return res.status(400).json({ message: 'Đơn hàng cần có sản phẩm.' });

    const orderCollection = await getCollection<any>('DON_HANG');
    const detailCollection = await getCollection<any>('DON_HANG_CHI_TIET');
    const orderId = await getNextPrefixedId('DON_HANG', 'DON_HANG_ID', 'YEN', 5);
    const subtotal = money(body.subtotal ?? items.reduce((sum: number, item: any) => sum + money(item.price || item.GIA) * Math.max(1, Number(item.quantity || item.qty || item.SO_LUONG || 1)), 0));
    const shipping = money(body.shipping ?? body.shippingFee);
    const total = money(body.total ?? subtotal + shipping);
    const order = {
      _id: orderId,
      DON_HANG_ID: orderId,
      KHACH_HANG_ID: body.customerId || null,
      NGAY_TAO: new Date(),
      TRANG_THAI: body.orderStatus || 'Chờ xử lý',
      TAM_TINH: subtotal,
      PHI_VAN_CHUYEN: shipping,
      TIEN_COC: money(body.deposit || body.paid || 0),
      TONG_TIEN: total,
      PHUONG_THUC_THANH_TOAN: body.paymentMethod || null,
      VAT: Number(body.vat || 0),
      NGAY_MUON_GIAO: parseOptionalDate(body.deliveryDate),
      KHUNG_GIO_MUON_GIAO: body.deliverySlot || body.deliveryTime || null,
      LOI_NHAN_THIEP: body.cardMessage || null,
      AN_THONG_TIN: toBool(body.hideSender),
      GHI_CHU: [body.customerNote, body.adminNote].filter(Boolean).join(' | ') || null,
      TEN_NGUOI_NHAN: body.receiverName || body.receiver?.name || null,
      SDT_NGUOI_NHAN: body.receiverPhone || body.receiver?.phone || null,
      DIA_CHI_GIAO_HANG: body.deliveryAddress || body.receiver?.address || null,
      YEU_CAU_VAT: toBool(body.requestVAT),
      GUI_ANH_QUA_ZALO: toBool(body.sendZaloPhoto),
      DA_CHINH_SUA_GIAO_HANG: false,
      DA_TRU_DIEM_THUONG: false,
    };
    await orderCollection.insertOne(order);
    await detailCollection.insertMany(items.map((item: any) => {
      const productId = String(item.productId || item.id || item.SAN_PHAM_ID || '');
      return {
        _id: { DON_HANG_ID: orderId, SAN_PHAM_ID: productId },
        DON_HANG_ID: orderId,
        SAN_PHAM_ID: productId,
        SO_LUONG: Math.max(1, Number(item.quantity || item.qty || item.SO_LUONG || 1)),
        GIA: money(item.price || item.GIA),
      };
    }));
    const created = await getAdminOrderDetailById(orderId);
    return res.status(201).json({ message: 'Order created.', order: created, orderId });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create order: ' + error.message });
  }
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
    const transactions = (await paymentCollection.find({}).sort({ NGAY_THANH_TOAN: -1 }).toArray()).map((row) => ({
      id: row.THANH_TOAN_ID,
      orderId: row.DON_HANG_ID,
      gateway: row.CONG_THANH_TOAN,
      referenceCode: row.MA_GIAO_DICH,
      amount: Number(row.SO_TIEN || 0),
      status: row.TRANG_THAI_THANH_TOAN,
      paidAt: row.NGAY_THANH_TOAN,
      selected: false,
      ...row,
    }));
    return res.status(200).json({ total: transactions.length, transactions });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load transactions: ' + error.message });
  }
};

export const updateAdminTransaction = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;
    const paymentCollection = await getCollection<any>('THANH_TOAN');
    const { gateway, status, amount, referenceCode, paidAt } = req.body;
    const result = await paymentCollection.findOneAndUpdate(
      { THANH_TOAN_ID: transactionId },
      {
        $set: {
          ...(gateway !== undefined ? { CONG_THANH_TOAN: String(gateway) } : {}),
          ...(status !== undefined ? { TRANG_THAI_THANH_TOAN: normalizeTransactionStatus(status) } : {}),
          ...(amount !== undefined ? { SO_TIEN: money(amount) } : {}),
          ...(referenceCode !== undefined ? { MA_GIAO_DICH: String(referenceCode).trim() } : {}),
          ...(paidAt !== undefined ? { NGAY_THANH_TOAN: parseOptionalDate(paidAt) || new Date() } : {}),
        },
      },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ message: 'Không tìm thấy giao dịch.' });
    return res.status(200).json({ message: 'Transaction updated.', transaction: result });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update transaction: ' + error.message });
  }
};

export const createAdminTransaction = async (req: Request, res: Response) => {
  try {
    const paymentCollection = await getCollection<any>('THANH_TOAN');
    const transactionId = await getNextPrefixedId('THANH_TOAN', 'THANH_TOAN_ID', 'TT', 5);
    const transaction = {
      _id: transactionId,
      THANH_TOAN_ID: transactionId,
      DON_HANG_ID: String(req.body.orderCode || req.body.orderId || '').trim(),
      CONG_THANH_TOAN: String(req.body.gateway || req.body.paymentMethod || '').trim(),
      MA_GIAO_DICH: String(req.body.referenceCode || '').trim() || null,
      SO_TIEN: money(req.body.amount),
      TRANG_THAI_THANH_TOAN: normalizeTransactionStatus(req.body.status),
      NGAY_THANH_TOAN: parseOptionalDate(req.body.paidAt) || new Date(),
    };
    await paymentCollection.insertOne(transaction);
    return res.status(201).json({ message: 'Transaction created.', transaction });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create transaction: ' + error.message });
  }
};

export const updateAdminOrderPaymentStatus = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const paymentCollection = await getCollection<any>('THANH_TOAN');
    const orderCollection = await getCollection<any>('DON_HANG');
    const status = normalizeTransactionStatus(req.body.status);
    const amount = money(req.body.paidAmount ?? req.body.amount);
    const gateway = req.body.gateway || req.body.paymentMethod || 'Admin';
    const latest = (await paymentCollection.find({ DON_HANG_ID: orderId }).sort({ NGAY_THANH_TOAN: -1 }).toArray())[0];
    if (latest) {
      await paymentCollection.updateOne(
        { THANH_TOAN_ID: latest.THANH_TOAN_ID },
        { $set: { TRANG_THAI_THANH_TOAN: status, SO_TIEN: amount || latest.SO_TIEN, CONG_THANH_TOAN: gateway, NGAY_THANH_TOAN: new Date() } },
      );
    } else {
      const paymentId = await getNextPrefixedId('THANH_TOAN', 'THANH_TOAN_ID', 'TT', 5);
      await paymentCollection.insertOne({
        _id: paymentId,
        THANH_TOAN_ID: paymentId,
        DON_HANG_ID: orderId,
        CONG_THANH_TOAN: gateway,
        MA_GIAO_DICH: null,
        SO_TIEN: amount,
        TRANG_THAI_THANH_TOAN: status,
        NGAY_THANH_TOAN: new Date(),
      });
    }
    if (status === 'Thành công') await orderCollection.updateOne({ DON_HANG_ID: orderId }, { $set: { TRANG_THAI: 'Chờ xử lý', TIEN_COC: amount } });
    const order = await getAdminOrderDetailById(orderId);
    return res.status(200).json({ message: 'Payment status updated.', order });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể cập nhật trạng thái thanh toán: ' + error.message });
  }
};

export const getAdminProducts = async (_req: Request, res: Response) => {
  try {
    const [productCollection, reviewCollection] = await Promise.all([
      getCollection<any>('SAN_PHAM'),
      getCollection<any>('DANH_GIA'),
    ]);
    const productsRaw = await productCollection.find({}).sort({ SAN_PHAM_ID: -1 }).toArray();
    const imageMap = await getPrimaryImageMap(productsRaw.map((product) => product.SAN_PHAM_ID));
    const reviews = await reviewCollection.find({}).toArray();
    const ratingMap = new Map<string, number>();
    for (const product of productsRaw) {
      const productReviews = reviews.filter((review) => review.SAN_PHAM_ID === product.SAN_PHAM_ID);
      ratingMap.set(product.SAN_PHAM_ID, productReviews.length ? productReviews.reduce((sum, review) => sum + Number(review.SO_SAO || 0), 0) / productReviews.length : 0);
    }
    const products = productsRaw.map((product) => mapAdminProduct(product, imageMap.get(product.SAN_PHAM_ID), ratingMap.get(product.SAN_PHAM_ID)));
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
      SO_LUONG: Number(body.quantity ?? body.SO_LUONG ?? 0),
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
  const imageMap = await getPrimaryImageMap([productId]);
  const images = await (await getCollection<any>('HINH_ANH_SAN_PHAM')).find({ SAN_PHAM_ID: productId }).toArray();
  return { ...mapAdminProduct(product, imageMap.get(productId)), raw: product, images };
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
          ...(body.quantity !== undefined || body.SO_LUONG !== undefined ? { SO_LUONG: Number(body.quantity ?? body.SO_LUONG ?? 0) } : {}),
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

const mapAdminMaterial = (row: any, index = 0) => ({
  id: index + 1,
  code: row.NGUYEN_VAT_LIEU_ID,
  name: row.TEN_NGUYEN_VAT_LIEU || '',
  image: row.URL_HINH_ANH || '',
  unit: row.DON_VI_TINH || '',
  quantity: Number(row.SO_LUONG_TON || 0),
  importPrice: Number(row.GIA_NHAP || 0),
  sellPrice: Number(row.GIA_BAN || 0),
  selected: false,
  description: row.MO_TA || '',
  status: Number(row.SO_LUONG_TON || 0) <= 0 ? 'Hết hàng' : Number(row.SO_LUONG_TON || 0) <= 10 ? 'Sắp hết hàng' : 'Còn hàng',
  raw: row,
});

export const getAdminMaterials = async (_req: Request, res: Response) => {
  try {
    const materials = (await (await getCollection<any>('NGUYEN_VAT_LIEU')).find({}).sort({ NGUYEN_VAT_LIEU_ID: 1 }).toArray()).map(mapAdminMaterial);
    return res.status(200).json({ total: materials.length, materials });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load materials: ' + error.message });
  }
};

export const createAdminMaterial = async (req: Request, res: Response) => {
  try {
    const materialCollection = await getCollection<any>('NGUYEN_VAT_LIEU');
    const id = String(req.body.code || '').trim() || await getNextPrefixedId('NGUYEN_VAT_LIEU', 'NGUYEN_VAT_LIEU_ID', 'NVL', 3);
    const material = {
      _id: id,
      NGUYEN_VAT_LIEU_ID: id,
      TEN_NGUYEN_VAT_LIEU: req.body.name || req.body.TEN_NGUYEN_VAT_LIEU,
      DON_VI_TINH: req.body.unit || req.body.DON_VI_TINH,
      SO_LUONG_TON: Number(req.body.quantity ?? req.body.SO_LUONG_TON ?? 0),
      GIA_NHAP: money(req.body.importPrice ?? req.body.GIA_NHAP),
      GIA_BAN: money(req.body.sellPrice ?? req.body.GIA_BAN),
      MO_TA: req.body.description || req.body.MO_TA || '',
      URL_HINH_ANH: req.body.image || req.body.URL_HINH_ANH || '',
    };
    await materialCollection.insertOne(material);
    return res.status(201).json({ message: 'Material created.', material: mapAdminMaterial(material) });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create material: ' + error.message });
  }
};

export const updateAdminMaterial = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const result = await (await getCollection<any>('NGUYEN_VAT_LIEU')).findOneAndUpdate(
      { NGUYEN_VAT_LIEU_ID: req.params.materialId },
      {
        $set: {
          TEN_NGUYEN_VAT_LIEU: body.name ?? body.TEN_NGUYEN_VAT_LIEU,
          DON_VI_TINH: body.unit ?? body.DON_VI_TINH,
          SO_LUONG_TON: Number(body.quantity ?? body.SO_LUONG_TON ?? 0),
          GIA_NHAP: money(body.importPrice ?? body.GIA_NHAP),
          GIA_BAN: money(body.sellPrice ?? body.GIA_BAN),
          MO_TA: body.description ?? body.MO_TA ?? '',
          URL_HINH_ANH: body.image ?? body.URL_HINH_ANH ?? '',
        },
      },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ message: 'Không tìm thấy nguyên vật liệu.' });
    return res.status(200).json({ message: 'Material updated.', material: mapAdminMaterial(result) });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update material: ' + error.message });
  }
};

export const uploadAdminMaterialImage = (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ message: 'Chưa chọn ảnh.' });
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return res.status(201).json({
    message: 'Upload image thành công.',
    url: `${publicBaseUrl}/uploads/materials/${req.file.filename}`,
  });
};

export const deleteAdminMaterial = async (req: Request, res: Response) => {
  try {
    await (await getCollection<any>('NGUYEN_VAT_LIEU')).deleteOne({ NGUYEN_VAT_LIEU_ID: req.params.materialId });
    return res.status(200).json({ message: 'Material deleted.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete material: ' + error.message });
  }
};

export const getAdminSuppliers = async (_req: Request, res: Response) => {
  try {
    const suppliers = await (await getCollection<any>('NHA_CUNG_CAP')).find({}).sort({ NHA_CUNG_CAP_ID: 1 }).toArray();
    return res.status(200).json({ total: suppliers.length, suppliers });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load suppliers: ' + error.message });
  }
};

export const createAdminSupplier = async (req: Request, res: Response) => {
  try {
    const id = String(req.body.code || '').trim() || await getNextPrefixedId('NHA_CUNG_CAP', 'NHA_CUNG_CAP_ID', 'NCC', 3);
    const supplier = {
      _id: id,
      NHA_CUNG_CAP_ID: id,
      TEN_NHA_CUNG_CAP: req.body.name || req.body.TEN_NHA_CUNG_CAP,
      NGUOI_DAI_DIEN: req.body.representative || req.body.NGUOI_DAI_DIEN || '',
      SDT: req.body.phone || req.body.SDT || '',
      EMAIL: req.body.email || req.body.EMAIL || '',
      DIA_CHI: req.body.address || req.body.DIA_CHI || '',
      MA_SO_THUE: req.body.taxCode || req.body.MA_SO_THUE || '',
      TRANG_THAI: req.body.status || req.body.TRANG_THAI || 'Hoạt động',
    };
    await (await getCollection<any>('NHA_CUNG_CAP')).insertOne(supplier);
    return res.status(201).json({ message: 'Supplier created.', supplier });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create supplier: ' + error.message });
  }
};

export const updateAdminSupplier = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const result = await (await getCollection<any>('NHA_CUNG_CAP')).findOneAndUpdate(
      { NHA_CUNG_CAP_ID: req.params.supplierId },
      {
        $set: {
          TEN_NHA_CUNG_CAP: body.name ?? body.TEN_NHA_CUNG_CAP,
          NGUOI_DAI_DIEN: body.representative ?? body.NGUOI_DAI_DIEN ?? '',
          SDT: body.phone ?? body.SDT ?? '',
          EMAIL: body.email ?? body.EMAIL ?? '',
          DIA_CHI: body.address ?? body.DIA_CHI ?? '',
          MA_SO_THUE: body.taxCode ?? body.MA_SO_THUE ?? '',
          TRANG_THAI: body.status ?? body.TRANG_THAI ?? 'Hoạt động',
        },
      },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ message: 'Không tìm thấy nhà cung cấp.' });
    return res.status(200).json({ message: 'Supplier updated.', supplier: result });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update supplier: ' + error.message });
  }
};

export const deleteAdminSupplier = async (req: Request, res: Response) => {
  try {
    await (await getCollection<any>('NHA_CUNG_CAP')).deleteOne({ NHA_CUNG_CAP_ID: req.params.supplierId });
    return res.status(200).json({ message: 'Supplier deleted.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete supplier: ' + error.message });
  }
};

const getReceiptDetails = (body: any) => Array.isArray(body.details)
  ? body.details
  : Array.isArray(body.materials)
    ? body.materials
    : [];

const adjustStock = async (materialId: string, delta: number) => {
  await (await getCollection<any>('NGUYEN_VAT_LIEU')).updateOne(
    { NGUYEN_VAT_LIEU_ID: materialId },
    { $inc: { SO_LUONG_TON: delta } },
  );
};

const mapImportDetail = (receiptId: string, detail: any) => {
  const materialId = detail.materialCode || detail.materialId || detail.NGUYEN_VAT_LIEU_ID;
  const quantity = Number(detail.quantity ?? detail.SO_LUONG_NHAP ?? 0);
  const unitPrice = money(detail.unitPrice ?? detail.DON_GIA_NHAP);
  return {
    _id: { PHIEU_NHAP_ID: receiptId, NGUYEN_VAT_LIEU_ID: materialId },
    PHIEU_NHAP_ID: receiptId,
    NGUYEN_VAT_LIEU_ID: materialId,
    SO_LUONG_NHAP: quantity,
    DON_GIA_NHAP: unitPrice,
    THANH_TIEN: quantity * unitPrice,
  };
};

const mapExportDetail = (receiptId: string, detail: any) => {
  const materialId = detail.materialCode || detail.materialId || detail.NGUYEN_VAT_LIEU_ID;
  return {
    _id: { PHIEU_XUAT_ID: receiptId, NGUYEN_VAT_LIEU_ID: materialId },
    PHIEU_XUAT_ID: receiptId,
    NGUYEN_VAT_LIEU_ID: materialId,
    SO_LUONG_XUAT: Number(detail.quantity ?? detail.SO_LUONG_XUAT ?? 0),
  };
};

export const getAdminImports = async (_req: Request, res: Response) => {
  try {
    const imports = await (await getCollection<any>('PHIEU_NHAP_NVL')).find({}).sort({ NGAY_NHAP: -1 }).toArray();
    return res.status(200).json({ total: imports.length, imports });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load imports: ' + error.message });
  }
};

export const createAdminImport = async (req: Request, res: Response) => {
  try {
    const receiptId = await getNextPrefixedId('PHIEU_NHAP_NVL', 'PHIEU_NHAP_ID', 'PN', 6);
    const details = getReceiptDetails(req.body).map((detail: any) => mapImportDetail(receiptId, detail));
    const total = details.reduce((sum: number, detail: any) => sum + Number(detail.THANH_TIEN || 0), 0);
    const receipt = {
      _id: receiptId,
      PHIEU_NHAP_ID: receiptId,
      NHA_CUNG_CAP_ID: req.body.supplier || req.body.supplierCode || req.body.NHA_CUNG_CAP_ID || null,
      NHAN_VIEN_ID: req.body.staff || req.body.employeeId || await getFirstEmployeeId(),
      NGAY_NHAP: parseOptionalDate(req.body.importDate) || new Date(),
      TONG_TIEN: total,
      GHI_CHU: req.body.note || req.body.GHI_CHU || null,
    };
    await (await getCollection<any>('PHIEU_NHAP_NVL')).insertOne(receipt);
    if (details.length) await (await getCollection<any>('CHI_TIET_PHIEU_NHAP_NVL')).insertMany(details);
    for (const detail of details) await adjustStock(detail.NGUYEN_VAT_LIEU_ID, Number(detail.SO_LUONG_NHAP || 0));
    return res.status(201).json({ message: 'Import created.', import: receipt, details });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create import: ' + error.message });
  }
};

export const updateAdminImport = async (req: Request, res: Response) => {
  try {
    const { receiptId } = req.params;
    await deleteImportDetailsAndReverseStock(receiptId);
    const details = getReceiptDetails(req.body).map((detail: any) => mapImportDetail(receiptId, detail));
    const total = details.reduce((sum: number, detail: any) => sum + Number(detail.THANH_TIEN || 0), 0);
    await (await getCollection<any>('PHIEU_NHAP_NVL')).updateOne(
      { PHIEU_NHAP_ID: receiptId },
      {
        $set: {
          NHA_CUNG_CAP_ID: req.body.supplier || req.body.supplierCode || req.body.NHA_CUNG_CAP_ID || null,
          NHAN_VIEN_ID: req.body.staff || req.body.employeeId || await getFirstEmployeeId(),
          NGAY_NHAP: parseOptionalDate(req.body.importDate) || new Date(),
          TONG_TIEN: total,
          GHI_CHU: req.body.note || req.body.GHI_CHU || null,
        },
      },
    );
    if (details.length) await (await getCollection<any>('CHI_TIET_PHIEU_NHAP_NVL')).insertMany(details);
    for (const detail of details) await adjustStock(detail.NGUYEN_VAT_LIEU_ID, Number(detail.SO_LUONG_NHAP || 0));
    return res.status(200).json({ message: 'Import updated.', details });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update import: ' + error.message });
  }
};

const deleteImportDetailsAndReverseStock = async (receiptId: string) => {
  const detailCollection = await getCollection<any>('CHI_TIET_PHIEU_NHAP_NVL');
  const details = await detailCollection.find({ PHIEU_NHAP_ID: receiptId }).toArray();
  for (const detail of details) await adjustStock(detail.NGUYEN_VAT_LIEU_ID, -Number(detail.SO_LUONG_NHAP || 0));
  await detailCollection.deleteMany({ PHIEU_NHAP_ID: receiptId });
};

export const deleteAdminImport = async (req: Request, res: Response) => {
  try {
    const { receiptId } = req.params;
    await deleteImportDetailsAndReverseStock(receiptId);
    await (await getCollection<any>('PHIEU_NHAP_NVL')).deleteOne({ PHIEU_NHAP_ID: receiptId });
    return res.status(200).json({ message: 'Import deleted.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete import: ' + error.message });
  }
};

export const getAdminExports = async (_req: Request, res: Response) => {
  try {
    const exports = await (await getCollection<any>('PHIEU_XUAT_NVL')).find({}).sort({ NGAY_XUAT: -1 }).toArray();
    return res.status(200).json({ total: exports.length, exports });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load exports: ' + error.message });
  }
};

export const createAdminExport = async (req: Request, res: Response) => {
  try {
    const receiptId = await getNextPrefixedId('PHIEU_XUAT_NVL', 'PHIEU_XUAT_ID', 'PX', 6);
    const details = getReceiptDetails(req.body).map((detail: any) => mapExportDetail(receiptId, detail));
    const receipt = {
      _id: receiptId,
      PHIEU_XUAT_ID: receiptId,
      NHAN_VIEN_ID: req.body.staff || req.body.employeeId || await getFirstEmployeeId(),
      NGAY_XUAT: parseOptionalDate(req.body.exportDate) || new Date(),
      LY_DO_XUAT: req.body.reason || req.body.LY_DO_XUAT || null,
      GHI_CHU: req.body.note || req.body.GHI_CHU || null,
    };
    await (await getCollection<any>('PHIEU_XUAT_NVL')).insertOne(receipt);
    if (details.length) await (await getCollection<any>('CHI_TIET_PHIEU_XUAT_NVL')).insertMany(details);
    for (const detail of details) await adjustStock(detail.NGUYEN_VAT_LIEU_ID, -Number(detail.SO_LUONG_XUAT || 0));
    return res.status(201).json({ message: 'Export created.', export: receipt, details });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create export: ' + error.message });
  }
};

const deleteExportDetailsAndReverseStock = async (receiptId: string) => {
  const detailCollection = await getCollection<any>('CHI_TIET_PHIEU_XUAT_NVL');
  const details = await detailCollection.find({ PHIEU_XUAT_ID: receiptId }).toArray();
  for (const detail of details) await adjustStock(detail.NGUYEN_VAT_LIEU_ID, Number(detail.SO_LUONG_XUAT || 0));
  await detailCollection.deleteMany({ PHIEU_XUAT_ID: receiptId });
};

export const updateAdminExport = async (req: Request, res: Response) => {
  try {
    const { receiptId } = req.params;
    await deleteExportDetailsAndReverseStock(receiptId);
    const details = getReceiptDetails(req.body).map((detail: any) => mapExportDetail(receiptId, detail));
    await (await getCollection<any>('PHIEU_XUAT_NVL')).updateOne(
      { PHIEU_XUAT_ID: receiptId },
      {
        $set: {
          NHAN_VIEN_ID: req.body.staff || req.body.employeeId || await getFirstEmployeeId(),
          NGAY_XUAT: parseOptionalDate(req.body.exportDate) || new Date(),
          LY_DO_XUAT: req.body.reason || req.body.LY_DO_XUAT || null,
          GHI_CHU: req.body.note || req.body.GHI_CHU || null,
        },
      },
    );
    if (details.length) await (await getCollection<any>('CHI_TIET_PHIEU_XUAT_NVL')).insertMany(details);
    for (const detail of details) await adjustStock(detail.NGUYEN_VAT_LIEU_ID, -Number(detail.SO_LUONG_XUAT || 0));
    return res.status(200).json({ message: 'Export updated.', details });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update export: ' + error.message });
  }
};

export const deleteAdminExport = async (req: Request, res: Response) => {
  try {
    const { receiptId } = req.params;
    await deleteExportDetailsAndReverseStock(receiptId);
    await (await getCollection<any>('PHIEU_XUAT_NVL')).deleteOne({ PHIEU_XUAT_ID: receiptId });
    return res.status(200).json({ message: 'Export deleted.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete export: ' + error.message });
  }
};

export const updateAdminOrderStatus = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const status = String(req.body.status || req.body.TRANG_THAI || '').trim();
    if (!status) return res.status(400).json({ message: 'Missing status.' });
    await (await getCollection<any>('DON_HANG')).updateOne(
      { DON_HANG_ID: orderId },
      {
        $set: {
          TRANG_THAI: status,
          ...(req.body.rejectReason ? { LY_DO_TU_CHOI: String(req.body.rejectReason).trim() } : {}),
        },
      },
    );
    const order = await getAdminOrderDetailById(orderId);
    return res.status(200).json({ message: 'Order status updated.', order });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update order status: ' + error.message });
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
        payment: normalizePaymentStatus(payment?.latest?.TRANG_THAI_THANH_TOAN, order.TIEN_COC, order.TONG_TIEN, payment?.paidAmount || payment?.latest?.SO_TIEN),
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
        warningMaterials: materials.filter((material) => Number(material.SO_LUONG_TON || 0) <= 10).length,
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
      warningMaterials: materials.sort((a, b) => Number(a.SO_LUONG_TON || 0) - Number(b.SO_LUONG_TON || 0)).slice(0, 5),
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
