import {syncLuckyOrder} from '../services/lucky-wheel.service.js';
import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId, escapeRegex } from '../mongo.js';
import { getAdminOrderDetailById, sumVerifiedPayments, assertOrderTransition, allowedOrderStatuses, AFTER_SALES, afterSalesChange, afterSalesRead, orderEvent } from '../services/admin-order.service.js';
import { finishedAvailableOf, InventoryError, nextCode, withTransaction } from '../services/inventory/helpers.js';
import { syncCheckoutInventory, changeCheckoutPayment } from '../services/checkout-payment.service.js';
import { releaseReservations } from '../services/inventory/stock.service.js';
import { invalidateAnalyticsCache } from '../services/analytics/cache.js';
import { audit } from '../services/auth.service.js';
import { randomUUID } from 'node:crypto';
import { derivePromotionStatus, ensureVoucherStorage, normalizeVoucherCode } from '../services/pricing-voucher.service.js';
import { awardCompletedOrderPoints, restoreOrderPoints } from '../services/loyalty-policy.service.js';

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

const PRODUCT_STATUSES = ['Đang bán', 'Ngừng bán', 'Đã xóa'] as const;
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const normalizeProductStatus = (value: unknown): typeof PRODUCT_STATUSES[number] => {
  const key = normalizeText(value);
  if (key.includes('xoa') || key === 'deleted') return 'Đã xóa';
  if (key.includes('ngung') || key === 'an' || key === 'hidden' || key.includes('stop') || key === 'inactive') return 'Ngừng bán';
  return 'Đang bán';
};

const sanitizeProductHtml = (value: unknown): string => String(value || '')
  .replace(/<(script|style|iframe|object|embed|form|meta|link)[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  .replace(/<(script|style|iframe|object|embed|form|meta|link)\b[^>]*\/?\s*>/gi, '')
  .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  .replace(/\s(?:href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data:text\/html)[\s\S]*?\1/gi, '')
  .trim();

const normalizeProductName = (value: unknown): string => normalizeText(value).replace(/\s+/g, ' ');

type ProductImageInput = { url: string; isPrimary: boolean; sortOrder: number };

const normalizeProductImages = (images: unknown): ProductImageInput[] => {
  if (!Array.isArray(images)) return [];
  return images.map((item: any, index) => ({
    url: String(typeof item === 'string' ? item : item?.url || item?.URL || '').trim(),
    isPrimary: typeof item === 'string' ? index === 0 : Boolean(item?.isPrimary ?? item?.LA_ANH_CHINH),
    sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : index,
  })).filter((item) => item.url).sort((a, b) => a.sortOrder - b.sortOrder);
};

const validateProductImage = (image: ProductImageInput): string | null => {
  if (/^https?:\/\//i.test(image.url) || image.url.startsWith('/')) return null;
  const match = image.url.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return 'Ảnh phải là URL hợp lệ hoặc tệp ảnh được tải lên.';
  if (!PRODUCT_IMAGE_MIME_TYPES.has(match[1].toLowerCase())) return 'Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP.';
  const bytes = Math.floor(match[2].replace(/\s/g, '').length * 3 / 4);
  return bytes > PRODUCT_IMAGE_MAX_BYTES ? 'Mỗi ảnh không được vượt quá 5 MB.' : null;
};

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
  sku: row.SAN_PHAM_ID,
  name: row.TEN_SAN_PHAM || '',
  description: row.MO_TA || '',
  image: image?.URL || '',
  salePrice: Number(row.GIA || 0),
  discountPrice: Number(row.GIA_KHUYEN_MAI || 0),
  price: Number(row.GIA_KHUYEN_MAI || row.GIA || 0).toLocaleString('vi-VN') + 'đ',
  status: normalizeProductStatus(row.TRANG_THAI),
  statusClass: normalizeProductStatus(row.TRANG_THAI) === 'Đang bán' ? 'selling' : normalizeProductStatus(row.TRANG_THAI) === 'Đã xóa' ? 'deleted' : 'stop',
  style: row.KIEU_DANG || '',
  quantity: finishedAvailableOf(row),
  inventorySource: 'Tồn thành phẩm khả dụng (TON_THANH_PHAM - TP_DANG_GIU)',
  sold: Number(row.DA_BAN || 0),
  rating: Number(avgRating || 0),
  featured: Number(row.DA_BAN || 0) > 0,
  sale: Number(row.GIA_KHUYEN_MAI || 0) > 0 && Number(row.GIA_KHUYEN_MAI) < Number(row.GIA || 0),
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

const standardProductCategories: Record<string, string[]> = {
  color: ['Đỏ', 'Hồng', 'Trắng', 'Vàng', 'Cam', 'Tím', 'Xanh dương', 'Xanh lá', 'Kem', 'Pastel', 'Đa sắc'],
  style: ['Bó hoa', 'Giỏ hoa', 'Hộp hoa', 'Bình hoa', 'Kệ hoa', 'Hoa cầm tay', 'Set hoa và quà'],
  target: ['Người yêu', 'Vợ/Chồng', 'Mẹ', 'Cha', 'Bạn bè', 'Đồng nghiệp', 'Sếp', 'Khách hàng', 'Đối tác', 'Thầy cô'],
  flower: ['Hoa hồng', 'Hoa hướng dương', 'Hoa baby', 'Hoa tulip', 'Hoa cúc', 'Hoa ly', 'Hoa lan', 'Hoa cẩm chướng', 'Hoa đồng tiền', 'Hoa mẫu đơn', 'Hoa sen'],
  topic: ['Sinh nhật', 'Tình yêu', 'Kỷ niệm', 'Chúc mừng', 'Khai trương', 'Tốt nghiệp', 'Cảm ơn', 'Xin lỗi', 'Cưới hỏi', 'Chia buồn', 'Ngày lễ', 'Hoa văn phòng'],
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
    const [customerCollection, orderCollection] = await Promise.all([
      getCollection<any>('KHACH_HANG'),
      getCollection<any>('DON_HANG'),
    ]);

    const ordersStats = await orderCollection.aggregate([
      {
        $group: {
          _id: '$KHACH_HANG_ID',
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: { $ifNull: ['$TONG_TIEN', 0] } },
          latestOrderDate: { $max: '$NGAY_TAO' }
        }
      }
    ]).toArray();

    const statsMap = new Map<string, { totalOrders: number; totalSpent: number; latestOrderDate: any }>();
    for (const stat of ordersStats) {
      if (stat._id) {
        statsMap.set(String(stat._id), {
          totalOrders: Number(stat.totalOrders || 0),
          totalSpent: Number(stat.totalSpent || 0),
          latestOrderDate: stat.latestOrderDate
        });
      }
    }

    const customers = (await customerCollection.find({}).sort({ KHACH_HANG_ID: 1 }).toArray()).map((customer) => {
      const { MAT_KHAU, ...safe } = customer;
      const stats = statsMap.get(customer.KHACH_HANG_ID) || { totalOrders: 0, totalSpent: 0, latestOrderDate: null };
      return {
        ...safe,
        id: customer.KHACH_HANG_ID,
        code: customer.KHACH_HANG_ID,
        name: customer.TEN,
        phone: customer.SDT,
        email: customer.EMAIL,
        memberType: customer.LOAI_THANH_VIEN,
        membershipTier: customer.LOAI_THANH_VIEN,
        points: Number(customer.DIEM_TICH_LUY || 0),
        status: customer.TRANG_THAI || 'Hoạt động',
        totalOrders: stats.totalOrders,
        totalSpent: stats.totalSpent,
        latestOrderDate: stats.latestOrderDate ? formatDate(stats.latestOrderDate) : '',
        createdAt: customer.NGAY_DANG_KY,
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
    const { name, phone, email, birthDate, gender, status, note, ghiChuNoiBo } = req.body;
    const customerCollection = await getCollection<any>('KHACH_HANG');
    const existing = await customerCollection.findOne({ KHACH_HANG_ID: customerId });
    if (!existing) return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });

    const nextPhone = (phone ?? req.body.SDT ?? existing.SDT)?.trim();
    const nextEmail = (email ?? req.body.EMAIL ?? existing.EMAIL)?.trim();

    if (nextPhone && nextPhone !== existing.SDT) {
      const dupPhone = await customerCollection.findOne({ KHACH_HANG_ID: { $ne: customerId }, SDT: nextPhone });
      if (dupPhone) return res.status(409).json({ message: 'Số điện thoại đã thuộc về khách hàng khác.' });
    }
    if (nextEmail && nextEmail !== existing.EMAIL) {
      const dupEmail = await customerCollection.findOne({ KHACH_HANG_ID: { $ne: customerId }, EMAIL: nextEmail });
      if (dupEmail) return res.status(409).json({ message: 'Email đã thuộc về khách hàng khác.' });
    }

    const nextStatus = status ?? req.body.TRANG_THAI;
    const updateDoc: any = {};
    if (name || req.body.TEN) updateDoc.TEN = (name ?? req.body.TEN).trim();
    if (nextPhone) updateDoc.SDT = nextPhone;
    if (nextEmail !== undefined) updateDoc.EMAIL = nextEmail || null;
    if (birthDate !== undefined || req.body.DOB !== undefined) updateDoc.DOB = parseOptionalDate(birthDate ?? req.body.DOB);
    if (gender !== undefined || req.body.GIOI_TINH !== undefined) updateDoc.GIOI_TINH = gender ?? req.body.GIOI_TINH;
    if (nextStatus) updateDoc.TRANG_THAI = nextStatus;
    if (note !== undefined || ghiChuNoiBo !== undefined || req.body.GHI_CHU_NOI_BO !== undefined) {
      updateDoc.GHI_CHU_NOI_BO = note ?? ghiChuNoiBo ?? req.body.GHI_CHU_NOI_BO;
    }

    const result = await customerCollection.findOneAndUpdate(
      { KHACH_HANG_ID: customerId },
      { $set: updateDoc },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });

    if (nextStatus && ['ngừng hoạt động', 'ngung hoat dong', 'khóa', 'khoa'].includes(String(nextStatus).toLowerCase())) {
      const sessionCol = await getCollection('PHIEN_DANG_NHAP');
      await sessionCol.updateMany(
        { TAI_KHOAN_ID: customerId, LOAI_TAI_KHOAN: 'KHACH_HANG' },
        { $set: { DA_THU_HOI: true } }
      );
    }

    await audit(req, nextStatus && nextStatus !== existing.TRANG_THAI ? 'DOI_TRANG_THAI_KHACH_HANG' : 'CAP_NHAT_KHACH_HANG', customerId, {
      truoc: { TEN: existing.TEN, SDT: existing.SDT, EMAIL: existing.EMAIL, TRANG_THAI: existing.TRANG_THAI },
      sau: updateDoc,
    });

    const { MAT_KHAU, ...safeCustomer } = result;
    return res.status(200).json({ message: 'Cập nhật khách hàng thành công.', customer: safeCustomer });
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

/** Shared response contract for the list and create/update responses. */
const adminTransactionView = (row: any) => ({
  ...row, id: row.THANH_TOAN_ID, code: row.THANH_TOAN_ID,
  orderId: row.DON_HANG_ID, orderCode: row.DON_HANG_ID,
  gateway: row.CONG_THANH_TOAN, referenceCode: row.MA_GIAO_DICH || '',
  amount: Number(row.SO_TIEN || 0), status: row.TRANG_THAI_THANH_TOAN,
  paidAt: row.NGAY_THANH_TOAN, transactionDate: row.NGAY_THANH_TOAN, selected: false,
});

export const getAdminTransactions = async (_req: Request, res: Response) => {
  try {
    const paymentCollection = await getCollection<any>('THANH_TOAN');
    const rows = await paymentCollection.find({}).sort({ NGAY_THANH_TOAN: -1 }).toArray();
    const orders = await (await getCollection<any>('DON_HANG')).find({ DON_HANG_ID: { $in: rows.map(r => r.DON_HANG_ID) } }).toArray();
    const transactions = rows.map((row) => {
      const order = orders.find(o => o.DON_HANG_ID === row.DON_HANG_ID);
      const paid = Math.max(0, sumVerifiedPayments(rows.filter(p => p.DON_HANG_ID === row.DON_HANG_ID)));
      return { ...adminTransactionView(row),
        total: Number(order?.TONG_TIEN || 0), deposit: Number(order?.TIEN_COC || 0), paid,
        remaining: Math.max(0, Number(order?.TONG_TIEN || 0) - paid),
        editable: row.TRANG_THAI_THANH_TOAN === 'Chờ thanh toán' && !!order && !['Đã hủy','Đã hoàn tiền'].includes(order.TRANG_THAI),
        history: row.LICH_SU || [], confirmedAt: row.XAC_NHAN_LUC || null, confirmedBy: row.NGUOI_XAC_NHAN || '' };
    });
    return res.status(200).json({ total: transactions.length, transactions });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load transactions: ' + error.message });
  }
};

export const updateAdminTransaction = async (req: Request, res: Response) => {
  try {
    const transaction = await withTransaction(async session => {
      const updated = await changeCheckoutPayment(session, String(req.params.transactionId), req.body,
        String(res.locals?.adminEmployee?.NHAN_VIEN_ID || req.identity?.id || ''));
      await syncLuckyOrder(session, updated.DON_HANG_ID);
      return updated;
    });
    return res.json({ message: 'Đã xác minh giao dịch.', transaction: adminTransactionView(transaction) });
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
      const updated = await changeCheckoutPayment(session, target.THANH_TOAN_ID, { status: normalizeTransactionStatus(req.body.status), amount: req.body.amount, referenceCode: reference || undefined },
        String(res.locals?.adminEmployee?.NHAN_VIEN_ID || req.identity?.id || ''));
      await syncLuckyOrder(session, orderId);
      return updated;
    });
    return res.status(201).json({ message: 'Đã ghi nhận khoản thu hợp lệ.', transaction: adminTransactionView(transaction) });
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
      }, String(res.locals?.adminEmployee?.NHAN_VIEN_ID || req.identity?.id || ''));
      await syncLuckyOrder(session, orderId);
    });
    const order = await getAdminOrderDetailById(orderId);
    return res.json({ message: 'Đã xác minh thanh toán.', order });
  } catch (e: any) {
    return res.status(e instanceof InventoryError ? e.status : e.code === 11000 ? 409 : 500).json({ message: e instanceof InventoryError ? e.message : 'Không thể xác minh thanh toán.' });
  }
};

export const getAdminProducts = async (req: Request, res: Response) => {
  try {
    const [productCollection, reviewCollection, materialCollection] = await Promise.all([
      getCollection<any>('SAN_PHAM'),
      getCollection<any>('DANH_GIA'),
      getCollection<any>('NGUYEN_VAT_LIEU'),
    ]);
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const sortBy = String(req.query.sortBy || 'code');
    const sortDirection = String(req.query.sortDirection || 'desc') === 'asc' ? 1 : -1;
    const paginationRequested = req.query.page !== undefined || req.query.pageSize !== undefined;
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 100)));
    const filter: any = {};
    if (search) {
      const pattern = escapeRegex(search);
      filter.$or = [
        { SAN_PHAM_ID: { $regex: pattern, $options: 'i' } },
        { TEN_SAN_PHAM: { $regex: pattern, $options: 'i' } },
      ];
    }
    if (status && status !== 'all') filter.TRANG_THAI = normalizeProductStatus(status);
    else if (req.query.includeDeleted !== 'true') filter.TRANG_THAI = { $ne: 'Đã xóa' };
    const sortFields: Record<string, string> = { code: 'SAN_PHAM_ID', name: 'TEN_SAN_PHAM', price: 'GIA', quantity: 'SO_LUONG', status: 'TRANG_THAI', sold: 'DA_BAN' };
    const total = await productCollection.countDocuments(filter);
    const cursor = productCollection.find(filter).sort({ [sortFields[sortBy] || 'SAN_PHAM_ID']: sortDirection });
    if (paginationRequested) cursor.skip((page - 1) * pageSize).limit(pageSize);
    const productsRaw = await cursor.toArray();
    const imageMap = await getPrimaryImageMap(productsRaw.map((product) => product.SAN_PHAM_ID));
    const reviews = await reviewCollection.find({}).toArray();
    const ratingMap = new Map<string, number>();
    for (const product of productsRaw) {
      const productReviews = reviews.filter((review) => review.SAN_PHAM_ID === product.SAN_PHAM_ID);
      ratingMap.set(product.SAN_PHAM_ID, productReviews.length ? productReviews.reduce((sum, review) => sum + Number(review.SO_SAO || 0), 0) / productReviews.length : 0);
    }
    const products = productsRaw.map((product) => mapAdminProduct(product, imageMap.get(product.SAN_PHAM_ID), ratingMap.get(product.SAN_PHAM_ID)));
    const nextCode = await calculateNextProductCode();
    return res.status(200).json({
      total, page, pageSize: paginationRequested ? pageSize : total,
      totalPages: paginationRequested ? Math.max(1, Math.ceil(total / pageSize)) : 1,
      products,
      nextCode,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load admin products: ' + error.message });
  }
};

export const calculateNextProductCode = async (): Promise<string> => {
  const productCollection = await getCollection<any>('SAN_PHAM');
  const counterCollection = await getCollection<any>('BO_DEM_MA');

  const rows = await productCollection
    .find({ SAN_PHAM_ID: { $regex: '^SP\\d+$' } })
    .project({ SAN_PHAM_ID: 1 })
    .toArray();

  const existingIds = new Set<string>();
  let maxNum = 0;

  for (const row of rows) {
    const id = String(row.SAN_PHAM_ID || '').trim();
    existingIds.add(id);
    const match = id.match(/^SP0*(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const counter = await counterCollection.findOne({ _id: 'SAN_PHAM:SP' });
  if (counter && typeof counter.value === 'number' && counter.value > maxNum) {
    maxNum = counter.value;
  }

  let nextNum = maxNum + 1;
  let candidate = `SP${String(nextNum).padStart(4, '0')}`;

  while (existingIds.has(candidate) || (await productCollection.findOne({ SAN_PHAM_ID: candidate }, { projection: { _id: 1 } }))) {
    nextNum++;
    candidate = `SP${String(nextNum).padStart(4, '0')}`;
  }

  return candidate;
};

export const getAdminNextProductCode = async (_req: Request, res: Response) => {
  try {
    const code = await calculateNextProductCode();
    return res.status(200).json({ code });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể lấy mã sản phẩm tiếp theo: ' + error.message });
  }
};

export const createAdminProduct = async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const name = String(body.name || body.TEN_SAN_PHAM || '').trim();
    const salePrice = money(body.salePrice ?? body.GIA);
    const discountPrice = money(body.discountPrice ?? body.GIA_KHUYEN_MAI);
    const categories = [body.topic || body.CHU_DE_ID, ...asCategoryList(body.colors), ...asCategoryList(body.targets), ...asCategoryList(body.flowers), ...asCategoryList(body.collections), body.color, body.target, body.flower].filter((value) => String(value || '').trim());
    const images = normalizeProductImages(body.images);
    const validationError = validateProductPayload({ name, salePrice, discountPrice, categories, images });
    if (validationError) return res.status(400).json({ message: validationError });
    let productId = '';
    await withTransaction(async (session) => {
      const productCollection = await getCollection<any>('SAN_PHAM');
      const reservationToken = String(body.codeReservationToken || '').trim();
      if (reservationToken) {
        const reservationCollection = await getCollection<any>('MA_SAN_PHAM_DA_CAP');
        const reservation = await reservationCollection.findOne({
          _id: reservationToken, DA_DUNG: { $ne: true }, HET_HAN_LUC: { $gt: new Date() },
        }, { session });
        if (!reservation) throw new InventoryError(409, 'Mã sản phẩm đã hết hạn. Vui lòng mở lại form.');
        productId = String(reservation.SAN_PHAM_ID || '');
        if (await productCollection.findOne({ SAN_PHAM_ID: productId }, { session })) throw new InventoryError(409, 'Mã sản phẩm đã tồn tại. Vui lòng mở lại form.');
        await reservationCollection.updateOne(
          { _id: reservationToken },
          { $set: { DA_DUNG: true, DUNG_LUC: new Date() } },
          { session }
        );
      } else productId = await nextCode('SAN_PHAM', 'SAN_PHAM_ID', 'SP', 4);

      const duplicate = await productCollection.findOne({ $or: [
        { TEN_SAN_PHAM_KEY: normalizeProductName(name) },
        { TEN_SAN_PHAM: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } },
      ] }, { session });
      if (duplicate) throw new InventoryError(409, 'Tên sản phẩm đã tồn tại.');
      const topicId = await resolveLookupId('topic', body.topic || body.CHU_DE_ID, session);
      const product = {
        _id: productId, SAN_PHAM_ID: productId, CHU_DE_ID: topicId,
        TEN_SAN_PHAM: name, TEN_SAN_PHAM_KEY: normalizeProductName(name),
        MO_TA: sanitizeProductHtml(body.description ?? body.MO_TA),
        GIA: salePrice, GIA_KHUYEN_MAI: discountPrice || null,
        TRANG_THAI: normalizeProductStatus(body.status), KIEU_DANG: String(body.style || body.KIEU_DANG || '').trim(),
        SO_LUONG: 0, TON_THANH_PHAM: 0, TP_DANG_GIU: 0, DA_BAN: 0,
        NGUON_TON: 'Tồn thành phẩm khả dụng (TON_THANH_PHAM - TP_DANG_GIU)', NGAY_TAO: new Date(), NGAY_CAP_NHAT: new Date(),
      };
      await productCollection.insertOne(product, { session });
      await replaceProductRelations(productId, body, session);
      await replaceProductImages(productId, images, session);
      await replaceProductRecipe(productId, body.materials || [], session);
    });
    const created = await getAdminProduct(productId);
    return res.status(201).json({ message: 'Tạo sản phẩm thành công.', product: created });
  } catch (error: any) {
    return res.status(error instanceof InventoryError ? error.status : error?.code === 11000 ? 409 : 500).json({ message: error.message || 'Không thể tạo sản phẩm.' });
  }
};

export const reserveAdminProductCode = async (_req: Request, res: Response) => {
  try {
    const productId = await nextCode('SAN_PHAM', 'SAN_PHAM_ID', 'SP', 4);
    const token = randomUUID();
    await (await getCollection<any>('MA_SAN_PHAM_DA_CAP')).insertOne({
      _id: token, SAN_PHAM_ID: productId, DA_DUNG: false,
      TAO_LUC: new Date(), HET_HAN_LUC: new Date(Date.now() + 60 * 60 * 1000),
    });
    return res.status(200).json({ code: productId, token, expiresInMinutes: 60 });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể cấp mã sản phẩm: ' + error.message });
  }
};

const validateProductPayload = ({ name, salePrice, discountPrice, categories, images }: any): string | null => {
  if (!name) return 'Tên sản phẩm là bắt buộc.';
  if (!(salePrice > 0)) return 'Giá bán phải lớn hơn 0.';
  if (discountPrice < 0 || (discountPrice > 0 && discountPrice >= salePrice)) return 'Giá khuyến mãi phải nhỏ hơn giá bán.';
  if (!categories.length) return 'Sản phẩm phải có ít nhất một danh mục.';
  if (!images.length) return 'Sản phẩm phải có ít nhất một ảnh.';
  if (images.filter((image: ProductImageInput) => image.isPrimary).length !== 1) return 'Sản phẩm phải có đúng một ảnh đại diện.';
  return images.map(validateProductImage).find(Boolean) || null;
};

const asCategoryList = (value: unknown): unknown[] => Array.isArray(value) ? value : value ? [value] : [];

const resolveLookupId = async (type: string, value: unknown, session: any): Promise<string | null> => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const config = categoryConfig[type];
  if (!config) return null;
  const row = await (await getCollection<any>(config.collection)).findOne({
    $or: [{ [config.idField]: raw }, { [config.nameField]: raw }],
  }, { session });
  if (row) return row[config.idField] || null;
  throw new InventoryError(400, `Giá trị phân loại "${raw}" không tồn tại trong database.`);
};

const replaceProductRelations = async (productId: string, body: any, session: any) => {
  for (const [type, singularField, pluralField] of [
    ['color', 'color', 'colors'], ['target', 'target', 'targets'], ['flower', 'flower', 'flowers'], ['collection', 'collection', 'collections'],
  ] as const) {
    const config = categoryConfig[type];
    const collection = await getCollection<any>(config.linkCollection!);
    await collection.deleteMany({ SAN_PHAM_ID: productId }, { session });
    const rawValues = Array.isArray(body[pluralField]) ? body[pluralField] : Array.isArray(body[singularField]) ? body[singularField] : [body[singularField]];
    const values = [...new Set(rawValues.map((value: unknown) => String(value || '').trim()).filter(Boolean))];
    const rows = [];
    for (const value of values) {
      const lookupId = await resolveLookupId(type, value, session);
      if (lookupId) rows.push({ SAN_PHAM_ID: productId, [config.idField]: lookupId });
    }
    if (rows.length) await collection.insertMany(rows, { session });
  }
};

const replaceProductImages = async (productId: string, images: ProductImageInput[], session?: any) => {
  const imageCollection = await getCollection<any>('HINH_ANH_SAN_PHAM');
  await imageCollection.deleteMany({ SAN_PHAM_ID: productId }, { session });
  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    const imageId = await nextCode('HINH_ANH_SAN_PHAM', 'HINH_ANH_ID', 'HA', 5);
    await imageCollection.insertOne({
      _id: imageId,
      HINH_ANH_ID: imageId,
      SAN_PHAM_ID: productId,
      URL: image.url,
      LA_ANH_CHINH: image.isPrimary,
      THU_TU: index,
    }, { session });
  }
};

const replaceProductRecipe = async (productId: string, materials: any[], session: any) => {
  const collection = await getCollection<any>('CONG_THUC_SAN_PHAM');
  await collection.deleteMany({ SAN_PHAM_ID: productId }, { session });
  const materialCollection = await getCollection<any>('NGUYEN_VAT_LIEU');
  const rows: any[] = [];
  for (const item of Array.isArray(materials) ? materials : []) {
    const value = String(item?.code || item?.name || '').trim();
    if (!value) continue;
    const material = await materialCollection.findOne({ $or: [
      { NGUYEN_VAT_LIEU_ID: value },
      { TEN_NGUYEN_VAT_LIEU: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } },
    ] }, { session });
    if (!material) throw new InventoryError(400, `Nguyên vật liệu "${value}" không tồn tại.`);
    rows.push({
      SAN_PHAM_ID: productId, NGUYEN_VAT_LIEU_ID: material.NGUYEN_VAT_LIEU_ID, SO_LUONG_CAN: Number(item.quantity || 0),
      DON_VI_TINH: String(item.unit || '').trim(), GHI_CHU: String(item.note || '').trim(),
    });
  }
  if (rows.length) await collection.insertMany(rows, { session });
};

const getAdminProduct = async (productId: string) => {
  const productCollection = await getCollection<any>('SAN_PHAM');
  const product = await productCollection.findOne({ SAN_PHAM_ID: productId });
  if (!product) return null;
  const imageMap = await getPrimaryImageMap([productId]);
  const images = await (await getCollection<any>('HINH_ANH_SAN_PHAM')).find({ SAN_PHAM_ID: productId }).sort({ THU_TU: 1, HINH_ANH_ID: 1 }).toArray();
  return { ...mapAdminProduct(product, imageMap.get(productId)), raw: product, images };
};

const getLinkedLookupNames = async (productId: string, type: 'color' | 'target' | 'flower' | 'collection'): Promise<string[]> => {
  const config = categoryConfig[type];
  const links = await (await getCollection<any>(config.linkCollection!)).find({ SAN_PHAM_ID: productId }).toArray();
  const ids = links.map((link) => link[config.idField]).filter(Boolean);
  if (!ids.length) return [];
  const lookups = await (await getCollection<any>(config.collection)).find({ [config.idField]: { $in: ids } }).toArray();
  return lookups.map((lookup) => String(lookup[config.nameField] || '')).filter(Boolean);
};

const buildAdminProductDetail = async (productId: string) => {
  const summary = await getAdminProduct(productId);
  if (!summary) return null;
  const raw = summary.raw;
  const [topic, colorValues, targetValues, flowerValues, collectionValues, recipeRows, colors, targets, topics, flowers, collections, materials, allProducts] = await Promise.all([
    raw.CHU_DE_ID ? (await getCollection<any>('CHU_DE')).findOne({ CHU_DE_ID: raw.CHU_DE_ID }) : null,
    getLinkedLookupNames(productId, 'color'), getLinkedLookupNames(productId, 'target'), getLinkedLookupNames(productId, 'flower'), getLinkedLookupNames(productId, 'collection'),
    (await getCollection<any>('CONG_THUC_SAN_PHAM')).find({ SAN_PHAM_ID: productId }).toArray(),
    (await getCollection<any>('MAU_SAC')).find({}).sort({ TEN_MAU_SAC: 1 }).toArray(),
    (await getCollection<any>('DOI_TUONG')).find({}).sort({ TEN_DOI_TUONG: 1 }).toArray(),
    (await getCollection<any>('CHU_DE')).find({}).sort({ TEN_CHU_DE: 1 }).toArray(),
    (await getCollection<any>('HOA_TUOI')).find({}).sort({ TEN_HOA_TUOI: 1 }).toArray(),
    (await getCollection<any>('BO_SUU_TAP')).find({}).sort({ TEN_BO_SUU_TAP: 1 }).toArray(),
    (await getCollection<any>('NGUYEN_VAT_LIEU')).find({}).sort({ TEN_NGUYEN_VAT_LIEU: 1 }).toArray(),
    (await getCollection<any>('SAN_PHAM')).find({ KIEU_DANG: { $nin: [null, ''] } }).project({ KIEU_DANG: 1 }).toArray(),
  ]);
  const materialMap = new Map(materials.map((item) => [item.NGUYEN_VAT_LIEU_ID, item]));
  const mappedRecipe = recipeRows.map((item, index) => ({
    id: index + 1, code: item.NGUYEN_VAT_LIEU_ID, name: materialMap.get(item.NGUYEN_VAT_LIEU_ID)?.TEN_NGUYEN_VAT_LIEU || item.NGUYEN_VAT_LIEU_ID,
    image: materialMap.get(item.NGUYEN_VAT_LIEU_ID)?.HINH_ANH || '', quantity: Number(item.SO_LUONG_CAN || 0),
    unit: item.DON_VI_TINH || materialMap.get(item.NGUYEN_VAT_LIEU_ID)?.DON_VI_TINH || '', note: item.GHI_CHU || '',
    importPrice: Number(materialMap.get(item.NGUYEN_VAT_LIEU_ID)?.GIA_NHAP || 0),
  }));
  return {
    product: {
      name: raw.TEN_SAN_PHAM || '', code: raw.SAN_PHAM_ID, note: raw.MO_TA || '',
      color: colorValues[0] || '', colors: colorValues, target: targetValues[0] || '', targets: targetValues,
      flower: flowerValues[0] || '', flowers: flowerValues, collections: collectionValues,
      topic: topic?.TEN_CHU_DE || '', style: raw.KIEU_DANG || '', quantity: finishedAvailableOf(raw),
      inventorySource: raw.NGUON_TON || 'Tồn thành phẩm khả dụng (TON_THANH_PHAM - TP_DANG_GIU)', status: normalizeProductStatus(raw.TRANG_THAI),
      isPublished: normalizeProductStatus(raw.TRANG_THAI) === 'Đang bán',
      images: summary.images.map((image: any, index: number) => ({ url: image.URL, isPrimary: Boolean(image.LA_ANH_CHINH), sortOrder: Number(image.THU_TU ?? index) })),
      importPrice: mappedRecipe.reduce((sum, item) => sum + item.quantity * Number(item.importPrice || 0), 0),
      salePrice: Number(raw.GIA || 0), discountPrice: Number(raw.GIA_KHUYEN_MAI || 0), recipe: '',
    },
    options: {
      colors: colors.map((item) => item.TEN_MAU_SAC), targets: targets.map((item) => item.TEN_DOI_TUONG), topics: topics.map((item) => item.TEN_CHU_DE), flowers: flowers.map((item) => item.TEN_HOA_TUOI), collections: collections.map((item) => item.TEN_BO_SUU_TAP),
      styles: [...new Set(allProducts.map((item) => item.KIEU_DANG).filter(Boolean))].sort(),
      materials: materials.map((item, index) => ({ id: index + 1, code: item.NGUYEN_VAT_LIEU_ID, name: item.TEN_NGUYEN_VAT_LIEU, image: item.HINH_ANH || '', quantity: 1, unit: item.DON_VI_TINH || '', note: '', importPrice: Number(item.GIA_NHAP || 0) })),
    },
    materials: mappedRecipe,
  };
};

export const getAdminProductDetail = async (req: Request, res: Response) => {
  try {
    const detail = await buildAdminProductDetail(req.params.productId);
    if (!detail) return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    return res.status(200).json(detail);
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load product: ' + error.message });
  }
};

export const updateAdminProductDetail = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const payload = req.body || {};
    const body = payload.product ? { ...payload.product, description: payload.product.note, images: payload.product.images, materials: payload.materials } : payload;
    const name = String(body.name || body.TEN_SAN_PHAM || '').trim();
    const salePrice = money(body.salePrice ?? body.GIA);
    const discountPrice = money(body.discountPrice ?? body.GIA_KHUYEN_MAI);
    const categories = [body.topic, ...asCategoryList(body.colors), ...asCategoryList(body.targets), ...asCategoryList(body.flowers), ...asCategoryList(body.collections), body.color, body.target, body.flower].filter((value) => String(value || '').trim());
    const images = normalizeProductImages(body.images);
    const validationError = validateProductPayload({ name, salePrice, discountPrice, categories, images });
    if (validationError) return res.status(400).json({ message: validationError });
    await withTransaction(async (session) => {
      const productCollection = await getCollection<any>('SAN_PHAM');
      const current = await productCollection.findOne({ SAN_PHAM_ID: productId }, { session });
      if (!current) throw new InventoryError(404, 'Không tìm thấy sản phẩm.');
      const duplicate = await productCollection.findOne({ SAN_PHAM_ID: { $ne: productId }, $or: [
        { TEN_SAN_PHAM_KEY: normalizeProductName(name) },
        { TEN_SAN_PHAM: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } },
      ] }, { session });
      if (duplicate) throw new InventoryError(409, 'Tên sản phẩm đã tồn tại.');
      const topicId = await resolveLookupId('topic', body.topic, session);
      await productCollection.updateOne({ SAN_PHAM_ID: productId }, { $set: {
        CHU_DE_ID: topicId, TEN_SAN_PHAM: name, TEN_SAN_PHAM_KEY: normalizeProductName(name),
        MO_TA: sanitizeProductHtml(body.description ?? body.note), GIA: salePrice, GIA_KHUYEN_MAI: discountPrice || null,
        TRANG_THAI: normalizeProductStatus(body.status), KIEU_DANG: String(body.style || '').trim(), NGAY_CAP_NHAT: new Date(),
      } }, { session });
      await replaceProductRelations(productId, body, session);
      await replaceProductImages(productId, images, session);
      await replaceProductRecipe(productId, body.materials || [], session);
    });
    const product = await getAdminProduct(productId);
    return res.status(200).json({ message: 'Cập nhật sản phẩm thành công.', product });
  } catch (error: any) {
    return res.status(error instanceof InventoryError ? error.status : 500).json({ message: error.message || 'Không thể cập nhật sản phẩm.' });
  }
};

export const updateAdminProductStatus = async (req: Request, res: Response) => {
  try {
    const productCollection = await getCollection<any>('SAN_PHAM');
    const rawStatus = String(req.body.status || req.body.TRANG_THAI || '').trim();
    const statusKey = normalizeText(rawStatus);
    if (!rawStatus || !['dang ban', 'active', 'ngung ban', 'inactive', 'stop', 'da xoa', 'deleted'].some((key) => statusKey === key || statusKey.includes(key))) {
      return res.status(400).json({ message: 'Trạng thái sản phẩm không hợp lệ.' });
    }
    const status = normalizeProductStatus(rawStatus);
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
    const result = await (await getCollection<any>('SAN_PHAM')).updateOne(
      { SAN_PHAM_ID: productId },
      { $set: { TRANG_THAI: 'Đã xóa', NGAY_XOA: new Date(), NGAY_CAP_NHAT: new Date() } },
    );
    if (!result.matchedCount) return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    return res.status(200).json({ message: 'Sản phẩm đã được ẩn (xóa mềm), dữ liệu liên quan được bảo toàn.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete product: ' + error.message });
  }
};

export const getAdminCategories = async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type || 'topic');
    if (type === 'style') {
      const products = await (await getCollection<any>('SAN_PHAM')).find({ TRANG_THAI: { $ne: 'Đã xóa' } }).toArray();
      const counts = new Map<string, number>();
      for (const product of products) {
        const name = String(product.KIEU_DANG || 'Chưa phân loại').trim() || 'Chưa phân loại';
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      const categories = Array.from(counts.entries()).sort().map(([name, total]) => ({
        code: `style:${name}`, name, total, selected: false, status: 'Đang hiển thị',
        description: '', image: '', source: 'SAN_PHAM.KIEU_DANG',
      }));
      return res.status(200).json({ type, categories });
    }
    const config = categoryConfig[type];
    if (!config) return res.status(400).json({ message: 'Invalid category type.' });
    const rows = await (await getCollection<any>(config.collection)).find({}).sort({ [config.idField]: 1 }).toArray();
    const linkRows = config.linkCollection ? await (await getCollection<any>(config.linkCollection)).find({}).toArray() : [];
    const products = await (await getCollection<any>('SAN_PHAM')).find({ TRANG_THAI: { $ne: 'Đã xóa' } }).toArray();
    const visibleProductIds = new Set(products.map((product) => String(product.SAN_PHAM_ID)));
    const categories = rows.map((row) => ({
      code: row[config.idField],
      name: row[config.nameField],
      description: String(row.MO_TA || ''),
      image: String(row.HINH_ANH || row.ANH_DAI_DIEN || ''),
      status: row.AN === true || ['Ẩn', 'Đang ẩn', 'Đã xóa'].includes(String(row.TRANG_THAI || '')) ? 'Đang ẩn' : 'Đang hiển thị',
      total: config.linkCollection
        ? new Set(linkRows.filter((link) => link[config.idField] === row[config.idField] && visibleProductIds.has(String(link.SAN_PHAM_ID))).map((link) => link.SAN_PHAM_ID)).size
        : products.filter((product) => product[config.idField] === row[config.idField]).length,
      selected: false,
    }));
    categories.sort((left, right) => String(left.name).localeCompare(String(right.name), 'vi'));
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
    const collection = await getCollection<any>(config.collection);
    const duplicate = await collection.findOne({ [config.nameField]: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
    if (duplicate) return res.status(409).json({ message: 'Tên danh mục đã tồn tại.' });
    const description = sanitizeProductHtml(req.body.description);
    const image = String(req.body.image || '').trim();
    await collection.insertOne({ _id: id, [config.idField]: id, [config.nameField]: name, MO_TA: description, HINH_ANH: image, AN: false, TRANG_THAI: 'Đang hiển thị' });
    return res.status(201).json({ message: 'Đã thêm danh mục.', category: { code: id, name, description, image, status: 'Đang hiển thị', total: 0, selected: false } });
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
    const result = await (await getCollection<any>(config.collection)).updateOne(
      { [config.idField]: req.params.categoryId },
      { $set: { AN: true, TRANG_THAI: 'Đang ẩn', NGAY_CAP_NHAT: new Date() } },
    );
    if (!result.matchedCount) return res.status(404).json({ message: 'Không tìm thấy danh mục.' });
    return res.status(200).json({ message: 'Đã ẩn danh mục; liên kết sản phẩm vẫn được bảo toàn.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete category: ' + error.message });
  }
};

const decodeAdminCategoryId = (type: string, categoryId: string): string =>
  type === 'style' && categoryId.startsWith('style:') ? categoryId.slice(6) : categoryId;

const categoryProductIds = async (type: string, categoryId: string): Promise<string[]> => {
  if (type === 'style') {
    return (await (await getCollection<any>('SAN_PHAM')).find({ KIEU_DANG: categoryId }).project({ SAN_PHAM_ID: 1 }).toArray())
      .map((row) => String(row.SAN_PHAM_ID));
  }
  const config = categoryConfig[type];
  if (!config) return [];
  if (config.linkCollection) {
    return (await (await getCollection<any>(config.linkCollection)).find({ [config.idField]: categoryId }).project({ SAN_PHAM_ID: 1 }).toArray())
      .map((row) => String(row.SAN_PHAM_ID));
  }
  return (await (await getCollection<any>('SAN_PHAM')).find({ [config.idField]: categoryId }).project({ SAN_PHAM_ID: 1 }).toArray())
    .map((row) => String(row.SAN_PHAM_ID));
};

export const getAdminCategoryDetail = async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type || 'topic');
    const categoryId = decodeAdminCategoryId(type, String(req.params.categoryId || ''));
    let category: any;
    if (type === 'style') {
      category = { code: `style:${categoryId}`, name: categoryId, description: '', image: '', status: 'Đang hiển thị', source: 'SAN_PHAM.KIEU_DANG' };
    } else {
      const config = categoryConfig[type];
      if (!config) return res.status(400).json({ message: 'Loại danh mục không hợp lệ.' });
      const row = await (await getCollection<any>(config.collection)).findOne({ [config.idField]: categoryId });
      if (!row) return res.status(404).json({ message: 'Không tìm thấy danh mục.' });
      category = {
        code: row[config.idField], name: row[config.nameField], description: String(row.MO_TA || ''),
        image: String(row.HINH_ANH || row.ANH_DAI_DIEN || ''),
        status: row.AN === true || ['Ẩn', 'Đang ẩn', 'Đã xóa'].includes(String(row.TRANG_THAI || '')) ? 'Đang ẩn' : 'Đang hiển thị',
      };
    }
    const ids = await categoryProductIds(type, categoryId);
    const rows = ids.length ? await (await getCollection<any>('SAN_PHAM')).find({ SAN_PHAM_ID: { $in: ids }, TRANG_THAI: { $ne: 'Đã xóa' } }).toArray() : [];
    const imageMap = await getPrimaryImageMap(ids);
    const products = rows.map((row) => ({
      id: row.SAN_PHAM_ID, code: row.SAN_PHAM_ID, sku: row.SAN_PHAM_ID, name: row.TEN_SAN_PHAM || '',
      image: imageMap.get(row.SAN_PHAM_ID)?.URL || '', price: Number(row.GIA || 0), status: normalizeProductStatus(row.TRANG_THAI),
    })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    return res.status(200).json({ type, category: { ...category, total: products.length }, products });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể tải chi tiết danh mục: ' + error.message });
  }
};

export const updateAdminCategory = async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type || 'topic');
    const rawId = String(req.params.categoryId || '');
    const categoryId = decodeAdminCategoryId(type, rawId);
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Tên danh mục là bắt buộc.' });
    const requestedIds = Array.isArray(req.body.productIds) ? [...new Set(req.body.productIds.map((id: unknown) => String(id).trim()).filter(Boolean))] : null;
    await withTransaction(async (session) => {
      const products = await getCollection<any>('SAN_PHAM');
      if (type === 'style') {
        const currentIds = await categoryProductIds(type, categoryId);
        const activeCurrentIds = (await products.find({ SAN_PHAM_ID: { $in: currentIds }, TRANG_THAI: { $ne: 'Đã xóa' } }, { session }).project({ SAN_PHAM_ID: 1 }).toArray()).map((row) => String(row.SAN_PHAM_ID));
        if (requestedIds && activeCurrentIds.some((id) => !requestedIds.includes(id))) {
          throw new InventoryError(400, 'Không thể gỡ Kiểu dáng làm sản phẩm mất phân loại. Hãy chuyển sản phẩm sang Kiểu dáng khác trong trang sản phẩm.');
        }
        await products.updateMany({ KIEU_DANG: categoryId }, { $set: { KIEU_DANG: name, NGAY_CAP_NHAT: new Date() } }, { session });
        if (requestedIds?.length) await products.updateMany({ SAN_PHAM_ID: { $in: requestedIds } }, { $set: { KIEU_DANG: name, NGAY_CAP_NHAT: new Date() } }, { session });
        return;
      }
      const config = categoryConfig[type];
      if (!config) throw new InventoryError(400, 'Loại danh mục không hợp lệ.');
      const collection = await getCollection<any>(config.collection);
      const duplicate = await collection.findOne({ [config.idField]: { $ne: categoryId }, [config.nameField]: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } }, { session });
      if (duplicate) throw new InventoryError(409, 'Tên danh mục đã tồn tại.');
      await collection.updateOne({ [config.idField]: categoryId }, { $set: {
        [config.nameField]: name, MO_TA: sanitizeProductHtml(req.body.description), HINH_ANH: String(req.body.image || '').trim(),
        AN: req.body.status === 'Đang ẩn', TRANG_THAI: req.body.status === 'Đang ẩn' ? 'Đang ẩn' : 'Đang hiển thị', NGAY_CAP_NHAT: new Date(),
      } }, { session });
      if (!requestedIds) return;
      const currentIds = await categoryProductIds(type, categoryId);
      const deletedCurrentIds = (await products.find({ SAN_PHAM_ID: { $in: currentIds }, TRANG_THAI: 'Đã xóa' }, { session }).project({ SAN_PHAM_ID: 1 }).toArray()).map((row) => String(row.SAN_PHAM_ID));
      const activeCurrentIds = currentIds.filter((id) => !deletedCurrentIds.includes(id));
      if (!config.linkCollection) {
        if (activeCurrentIds.some((id) => !requestedIds.includes(id))) throw new InventoryError(400, 'Chủ đề là phân loại bắt buộc. Hãy chuyển sản phẩm sang chủ đề khác trước khi gỡ.');
        await products.updateMany({ SAN_PHAM_ID: { $in: requestedIds } }, { $set: { [config.idField]: categoryId, NGAY_CAP_NHAT: new Date() } }, { session });
      } else {
        const links = await getCollection<any>(config.linkCollection);
        const effectiveIds = [...new Set([...requestedIds, ...deletedCurrentIds])];
        const removedIds = activeCurrentIds.filter((id) => !requestedIds.includes(id));
        for (const productId of removedIds) {
          const product = await products.findOne({ SAN_PHAM_ID: productId }, { session });
          if (String(product?.CHU_DE_ID || '').trim()) continue;
          const otherLinkConfigs = Object.entries(categoryConfig).filter(([otherType, item]) => otherType !== type && Boolean(item.linkCollection));
          let hasOtherClassification = false;
          for (const [, item] of otherLinkConfigs) {
            if (await (await getCollection<any>(item.linkCollection!)).countDocuments({ SAN_PHAM_ID: productId }, { session })) {
              hasOtherClassification = true;
              break;
            }
          }
          if (!hasOtherClassification) throw new InventoryError(400, `Không thể gỡ ${productId}: sản phẩm phải còn ít nhất một phân loại.`);
        }
        await links.deleteMany({ [config.idField]: categoryId }, { session });
        if (effectiveIds.length) await links.insertMany(effectiveIds.map((productId) => ({ [config.idField]: categoryId, SAN_PHAM_ID: productId })), { session });
      }
    });
    if (type === 'style') req.params.categoryId = `style:${name}`;
    return getAdminCategoryDetail(req, res);
  } catch (error: any) {
    return res.status(error instanceof InventoryError ? error.status : 500).json({ message: error.message || 'Không thể cập nhật danh mục.' });
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
    if (status === 'Đã hủy') await restoreOrderPoints(session, current);
    if (status === 'Hoàn thành') await awardCompletedOrderPoints(session, current);
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
    return res.status(200).json({ total: campaigns.length, campaigns: campaigns.map((item, index) => ({
      id: index + 1, code: item.CHIEN_DICH_ID, name: item.TEN_CHIEN_DICH || '', description: item.MO_TA || '',
      startDate: item.NGAY_BAT_DAU, endDate: item.NGAY_KET_THUC, status: derivePromotionStatus(item),
      active: item.KICH_HOAT !== false, approved: item.DA_DUYET === true, audience: item.DOI_TUONG || 'Tất cả',
      membershipTiers: item.HANG_THANH_VIEN || [], totalLimit: Number(item.GIOI_HAN_TONG || 0),
      perUserLimit: Number(item.GIOI_HAN_MOI_NGUOI || 0), firstOrderOnly: item.DON_DAU_TIEN === true,
      selected: false,
    })) });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load campaigns: ' + error.message });
  }
};

export const createAdminCampaign = async (req: Request, res: Response) => {
  try {
    const start = parseOptionalDate(req.body.startDate || req.body.NGAY_BAT_DAU);
    const end = parseOptionalDate(req.body.endDate || req.body.NGAY_KET_THUC);
    if (!start || !end || start >= end) return res.status(400).json({ message: 'Ngày bắt đầu phải nhỏ hơn ngày kết thúc.' });
    const campaignId = await getNextPrefixedId('CHIEN_DICH', 'CHIEN_DICH_ID', 'CD', 3);
    const campaign = {
      _id: campaignId,
      CHIEN_DICH_ID: campaignId,
      TEN_CHIEN_DICH: req.body.name || req.body.TEN_CHIEN_DICH,
      MO_TA: req.body.description || req.body.MO_TA || null,
      NGAY_BAT_DAU: start,
      NGAY_KET_THUC: end,
      TRANG_THAI: req.body.status || req.body.TRANG_THAI || null,
      KICH_HOAT: req.body.active === true,
      DA_DUYET: req.body.approved === true,
      DOI_TUONG: req.body.audience || 'Tất cả',
      HANG_THANH_VIEN: req.body.membershipTiers || [],
      GIOI_HAN_TONG: Math.max(0, Number(req.body.totalLimit || 0)),
      GIOI_HAN_MOI_NGUOI: Math.max(0, Number(req.body.perUserLimit || 0)),
      DON_DAU_TIEN: req.body.firstOrderOnly === true,
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
    const start = parseOptionalDate(body.startDate || body.NGAY_BAT_DAU);
    const end = parseOptionalDate(body.endDate || body.NGAY_KET_THUC);
    if (!start || !end || start >= end) return res.status(400).json({ message: 'Ngày bắt đầu phải nhỏ hơn ngày kết thúc.' });
    const result = await (await getCollection<any>('CHIEN_DICH')).findOneAndUpdate(
      { CHIEN_DICH_ID: req.params.campaignId },
      {
        $set: {
          TEN_CHIEN_DICH: body.name ?? body.TEN_CHIEN_DICH,
          MO_TA: body.description ?? body.MO_TA ?? null,
          NGAY_BAT_DAU: start,
          NGAY_KET_THUC: end,
          TRANG_THAI: body.status ?? body.TRANG_THAI ?? null,
          KICH_HOAT: body.active === true,
          DA_DUYET: body.approved === true,
          DOI_TUONG: body.audience || 'Tất cả',
          HANG_THANH_VIEN: body.membershipTiers || [],
          GIOI_HAN_TONG: Math.max(0, Number(body.totalLimit || 0)),
          GIOI_HAN_MOI_NGUOI: Math.max(0, Number(body.perUserLimit || 0)),
          DON_DAU_TIEN: body.firstOrderOnly === true,
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
    const result = await (await getCollection<any>('CHIEN_DICH')).updateOne(
      { CHIEN_DICH_ID: req.params.campaignId },
      { $set: { KICH_HOAT: false, TRANG_THAI: 'Tạm dừng', NGAY_CAP_NHAT: new Date() } },
    );
    if (!result.matchedCount) return res.status(404).json({ message: 'Không tìm thấy chiến dịch.' });
    return res.status(200).json({ message: 'Đã tạm dừng chiến dịch; dữ liệu voucher và đơn cũ được bảo toàn.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete campaign: ' + error.message });
  }
};

export const getAdminVouchers = async (_req: Request, res: Response) => {
  try {
    const vouchers = await (await getCollection<any>('VOUCHER')).find({}).sort({ VOUCHER_ID: 1 }).toArray();
    const customerIds = [...new Set(vouchers.map(item => item.KHACH_HANG_ID).filter(Boolean))];
    const customers = customerIds.length ? await (await getCollection<any>('KHACH_HANG')).find({ KHACH_HANG_ID: { $in: customerIds } }).toArray() : [];
    const customerNames = new Map(customers.map(item => [item.KHACH_HANG_ID, item.HO_TEN || item.TEN_KHACH_HANG || '']));
    return res.status(200).json({ total: vouchers.length, vouchers: vouchers.map((item, index) => ({
      id: index + 1, code: item.VOUCHER_ID, voucherCode: item.MA_VOUCHER || '', campaignCode: item.CHIEN_DICH_ID || '',
      customerId: item.KHACH_HANG_ID || '', customerName: customerNames.get(item.KHACH_HANG_ID) || '',
      discountType: item.LOAI_GIAM_GIA || '', discountValue: Number(item.GIA_TRI_GIAM || 0),
      maxDiscount: Number(item.MUC_GIAM_TOI_DA || 0), minimumOrder: Number(item.DON_TOI_THIEU || 0),
      productIds: item.SAN_PHAM_IDS || [], categoryIds: item.CHU_DE_IDS || [], audience: item.DOI_TUONG || 'Tất cả',
      membershipTiers: item.HANG_THANH_VIEN || [], totalLimit: Number(item.GIOI_HAN_TONG || 0),
      perUserLimit: Number(item.GIOI_HAN_MOI_NGUOI || 0), firstOrderOnly: item.DON_DAU_TIEN === true,
      active: item.KICH_HOAT !== false, startDate: item.NGAY_BAT_DAU, endDate: item.NGAY_KET_THUC,
      used: item.DA_DUNG === true, usageCount: Number(item.LUOT_DA_DUNG || 0), status: derivePromotionStatus(item), selected: false,
    })) });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load vouchers: ' + error.message });
  }
};

export const getAdminNextVoucherId = async (_req: Request, res: Response) => {
  try {
    const voucherId = await getNextPrefixedId('VOUCHER', 'VOUCHER_ID', 'VC', 4);
    return res.status(200).json({ voucherId });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot allocate voucher ID: ' + error.message });
  }
};

const normalizeAdminDiscountType = (value: unknown): string => {
  const text = String(value || '').trim();
  const key = normalizeText(text);
  if (key.includes('ship') || key.includes('van chuyen')) return 'Phí vận chuyển';
  if (key.includes('phan') || key.includes('%')) return 'Phần trăm';
  if (key.includes('tien') || key.includes('amount')) return 'Số tiền';
  return text || 'Phần trăm';
};

export const createAdminVoucher = async (req: Request, res: Response) => {
  try {
    await ensureVoucherStorage();
    const body = req.body || {};
    const code = normalizeVoucherCode(body.voucherCode || body.code);
    const start = parseOptionalDate(body.startDate);
    const end = parseOptionalDate(body.endDate);
    const discountType = normalizeAdminDiscountType(body.discountType);
    const discountValue = Number(body.discountValue || body.value || 0);
    if (!code) return res.status(400).json({ message: 'Thiếu mã voucher.' });
    if (!start || !end || start >= end) return res.status(400).json({ message: 'Ngày bắt đầu phải nhỏ hơn ngày kết thúc.' });
    if (discountValue <= 0 || (discountType === 'Phần trăm' && discountValue > 100)) return res.status(400).json({ message: 'Giá trị giảm không hợp lệ.' });
    const customerIds = Array.isArray(body.customerIds) ? [...new Set(body.customerIds.map(String).filter(Boolean))] : body.customerId ? [String(body.customerId)] : [];
    const quantity = Math.max(1, Math.min(500, Math.floor(Number(body.quantity || 1))));
    const recipients: Array<string | null> = customerIds.length ? customerIds.flatMap(customerId => Array(quantity).fill(customerId)) : Array(quantity).fill(null);
    if (recipients.length > 500) return res.status(400).json({ message: 'Mỗi lần chỉ được tạo tối đa 500 voucher.' });
    const codes = recipients.map((_, index) => recipients.length === 1 ? code : `${code}-${String(index + 1).padStart(3, '0')}`);
    const voucherCollection = await getCollection<any>('VOUCHER');
    if (await voucherCollection.findOne({ $or: [{ MA_VOUCHER_CHUAN: { $in: codes } }, { MA_VOUCHER: { $in: codes } }] })) return res.status(409).json({ message: 'Mã voucher đã tồn tại sau chuẩn hóa.' });
    const firstId = await getNextPrefixedId('VOUCHER', 'VOUCHER_ID', 'VC', 4);
    const expectedVoucherId = String(body.expectedVoucherId || '').trim().toUpperCase();
    if (expectedVoucherId && expectedVoucherId !== firstId) {
      return res.status(409).json({
        message: `Mã voucher vừa được cập nhật thành ${firstId}. Vui lòng kiểm tra và lưu lại.`,
        voucherId: firstId,
      });
    }
    const firstNumber = Number(firstId.slice(2));
    if (firstNumber + recipients.length - 1 > 9999) {
      return res.status(409).json({ message: 'Đã đạt giới hạn 9.999 ID voucher theo định dạng VC0000.' });
    }
    const employeeId = body.employeeId || await getFirstEmployeeId();
    const vouchers = recipients.map((customerId, index) => {
      const voucherId = `VC${String(firstNumber + index).padStart(4, '0')}`;
      return {
        _id: voucherId, VOUCHER_ID: voucherId, NHAN_VIEN_ID: employeeId,
        CHIEN_DICH_ID: body.campaignCode || body.campaignId || null, KHACH_HANG_ID: customerId,
        MA_VOUCHER: codes[index], MA_VOUCHER_CHUAN: codes[index], LOAI_GIAM_GIA: discountType, GIA_TRI_GIAM: discountValue,
        MUC_GIAM_TOI_DA: Math.max(0, Number(body.maxDiscount || 0)), DON_TOI_THIEU: Math.max(0, Number(body.minimumOrder || 0)),
        SAN_PHAM_IDS: Array.isArray(body.productIds) ? body.productIds : [], CHU_DE_IDS: Array.isArray(body.categoryIds) ? body.categoryIds : [],
        DOI_TUONG: customerId ? 'Tài khoản được cấp' : body.audience || 'Tất cả', HANG_THANH_VIEN: Array.isArray(body.membershipTiers) ? body.membershipTiers : [],
        GIOI_HAN_TONG: Math.max(0, Number(body.totalLimit || (customerId ? 1 : 0))), GIOI_HAN_MOI_NGUOI: Math.max(0, Number(body.perUserLimit || (customerId ? 1 : 0))),
        DON_DAU_TIEN: body.firstOrderOnly === true, KICH_HOAT: body.active === true,
        NGAY_BAT_DAU: start, NGAY_KET_THUC: end, DA_DUNG: false,
      };
    });
    await voucherCollection.insertMany(vouchers, { ordered: true });
    return res.status(201).json({ message: `Đã tạo ${vouchers.length} voucher.`, voucher: vouchers[0], vouchers });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create voucher: ' + error.message });
  }
};

export const updateAdminVoucher = async (req: Request, res: Response) => {
  try {
    await ensureVoucherStorage();
    const body = req.body || {};
    const code = normalizeVoucherCode(body.voucherCode || body.code);
    const start = parseOptionalDate(body.startDate);
    const end = parseOptionalDate(body.endDate);
    const discountType = normalizeAdminDiscountType(body.discountType);
    const discountValue = Number(body.discountValue || body.value || 0);
    if (!code) return res.status(400).json({ message: 'Thiếu mã voucher.' });
    if (!start || !end || start >= end) return res.status(400).json({ message: 'Ngày bắt đầu phải nhỏ hơn ngày kết thúc.' });
    if (discountValue <= 0 || (discountType === 'Phần trăm' && discountValue > 100)) return res.status(400).json({ message: 'Giá trị giảm không hợp lệ.' });
    const voucherCollection = await getCollection<any>('VOUCHER');
    if (await voucherCollection.findOne({ MA_VOUCHER_CHUAN: code, VOUCHER_ID: { $ne: req.params.voucherId } })) return res.status(409).json({ message: 'Mã voucher đã tồn tại sau chuẩn hóa.' });
    const result = await voucherCollection.findOneAndUpdate(
      { VOUCHER_ID: req.params.voucherId },
      {
        $set: {
          CHIEN_DICH_ID: body.campaignCode ?? body.campaignId ?? null,
          MA_VOUCHER: code, MA_VOUCHER_CHUAN: code,
          LOAI_GIAM_GIA: discountType, GIA_TRI_GIAM: discountValue,
          MUC_GIAM_TOI_DA: Math.max(0, Number(body.maxDiscount || 0)),
          DON_TOI_THIEU: Math.max(0, Number(body.minimumOrder || 0)),
          SAN_PHAM_IDS: Array.isArray(body.productIds) ? body.productIds : [],
          CHU_DE_IDS: Array.isArray(body.categoryIds) ? body.categoryIds : [],
          DOI_TUONG: body.audience || (body.customerId ? 'Tài khoản được cấp' : 'Tất cả'),
          HANG_THANH_VIEN: Array.isArray(body.membershipTiers) ? body.membershipTiers : [],
          GIOI_HAN_TONG: Math.max(0, Number(body.totalLimit || (body.customerId ? 1 : 0))),
          GIOI_HAN_MOI_NGUOI: Math.max(0, Number(body.perUserLimit || (body.customerId ? 1 : 0))),
          DON_DAU_TIEN: body.firstOrderOnly === true,
          KICH_HOAT: body.active === true,
          NGAY_BAT_DAU: start, NGAY_KET_THUC: end,
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
    const result = await (await getCollection<any>('VOUCHER')).updateOne(
      { VOUCHER_ID: req.params.voucherId },
      { $set: { KICH_HOAT: false, TRANG_THAI: 'Tạm dừng', NGAY_CAP_NHAT: new Date() } },
    );
    if (!result.matchedCount) return res.status(404).json({ message: 'Không tìm thấy voucher.' });
    return res.status(200).json({ message: 'Đã tạm dừng voucher; lịch sử sử dụng được bảo toàn.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete voucher: ' + error.message });
  }
};

export const getAdminAfterSales = async (_req: Request,res: Response) => {try{return res.json({requests:await (await getCollection<any>(AFTER_SALES)).find({}).sort({updatedAt:-1}).limit(500).toArray()});}catch{return res.status(500).json({message:'Chưa đọc được danh sách hậu mãi.'});}};
export const changeAdminAfterSales = async (req: Request,res: Response) => {try{return res.json({request:await afterSalesChange(String(req.params.requestId),req.body,String(res.locals.adminEmployee?.NHAN_VIEN_ID||''))});}catch(e:any){return res.status(e instanceof InventoryError?e.status:e.code===11000?409:500).json({message:e instanceof InventoryError?e.message:'Chưa xử lý được. Hãy tải lại hồ sơ.'});}};
