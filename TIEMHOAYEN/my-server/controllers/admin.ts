import { AFTER_SALES,afterSalesChange,afterSalesRead,orderEvent } from '../services/admin-order.service.js';
import { restoreOrderPoints } from '../services/loyalty-policy.service.js';
import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId, escapeRegex } from '../mongo.js';
import { getAdminOrderDetailById, priceCheckout, slot24h, sumVerifiedPayments, summarizePayments, assertOrderTransition, allowedOrderStatuses, assertRoleCanSetOrderStatus, assertRoleCanDoOrderAction, paymentSucceeded } from '../services/admin-order.service.js';
import { createOrder } from './order.js';
import { randomUUID } from 'node:crypto';
import { finishedAvailableOf, InventoryError, nextCode, withTransaction } from '../services/inventory/helpers.js';
import { computeBuildable } from '../services/inventory/availability.service.js';
import { createBomVersion, getActiveBom, getActiveBomMap } from '../services/inventory/bom.service.js';
import { syncCheckoutInventory, changeCheckoutPayment } from '../services/checkout-payment.service.js';
import { assertOrderReadyForMaterialExport, markOrderPreparationStarted, assertPrepTimeChangeAllowed, createExport, releaseReservations, shipFinishedGoodsForOrder, suggestExportLines, syncOrderPrepTime } from '../services/inventory/stock.service.js';
import { invalidateAnalyticsCache } from '../services/analytics/cache.js';
import { audit } from '../services/auth.service.js';
import { derivePromotionStatus, ensureVoucherStorage, normalizeVoucherCode } from '../services/pricing-voucher.service.js';
const escapeAfterSalesSearch = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const displayMatch = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (displayMatch) {
    const displayDate = new Date(`${displayMatch[3]}-${displayMatch[2]}-${displayMatch[1]}T00:00:00+07:00`);
    return Number.isNaN(displayDate.getTime()) ? null : displayDate;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDate = (value: unknown): string => {
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

export const normalizeText = (value: unknown): string => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .trim()
  .toLowerCase();

const toBool = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 'true';

export const normalizeOrderStatus = (status: unknown): string => {
  const raw = String(status || '').trim();
  const key = normalizeText(raw);
  if (!raw) return 'Đã đặt hàng thành công';
  if (key.includes('huy')) return 'Đã hủy';
  if (key.includes('hoan thanh')) return 'Hoàn thành';
  if (key.includes('giao hang thanh cong') || key.includes('da giao')) return 'Đã giao';
  if (key.includes('dang giao')) return 'Đang giao';
  if (key.includes('chuan bi')) return 'Đang chuẩn bị hàng';
  if (key.includes('dat hang thanh cong')) return 'Đã đặt hàng thành công';
  if (key.includes('van chuyen')) return 'Chờ vận chuyển';
  if (key.includes('thanh toan') && key.includes('that bai')) return 'Thanh toán thất bại';
  if (key.includes('thanh toan')) return 'Chờ thanh toán';
  return raw;
};

const normalizeTransactionStatus = (status: unknown): string => {
  const value = String(status || '').trim();
  const key = normalizeText(value);
  if (key.includes('het han') || key.includes('expired')) return 'Hết hạn';
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
  // Không dùng SO_LUONG cũ: với sản phẩm theo BOM, khả năng bán phải giảm
  // ngay khi thành phẩm/NVL được giữ cho đơn khác.
  quantity: stock ? stock.finished + stock.buildable : Number(row.SO_LUONG || 0),
  finishedAvailable: stock?.finished ?? 0,
  buildable: stock?.buildable ?? 0,
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
    const rows = grouped.get(payment.DON_HANG_ID) || [];
    rows.push(payment);
    grouped.set(payment.DON_HANG_ID, rows);
  }

  return new Map(Array.from(grouped.entries()).map(([orderId, rows]) => {
    const sorted = rows.sort((left, right) => {
      const dateDiff = (toDate(right.NGAY_THANH_TOAN)?.getTime() || 0) - (toDate(left.NGAY_THANH_TOAN)?.getTime() || 0);
      if (dateDiff !== 0) return dateDiff;
      return String(right.THANH_TOAN_ID || '').localeCompare(String(left.THANH_TOAN_ID || ''), 'vi');
    });
    return [orderId, { latest: sorted[0] || null, rows }];
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

// AD52/AD54: danh sách nhân viên + tài khoản. Trả trường đã ánh xạ cho giao diện, không trả mật khẩu.
const mapStaffAccount = (row: any) => ({
  code: row.NHAN_VIEN_ID || '',
  name: row.HO_TEN || '',
  email: row.EMAIL || '',
  phone: row.SDT ? String(row.SDT) : '',
  role: row.VAI_TRO || '',
  createdAt: formatDate(row.NGAY_TAO),
  createdDate: toDate(row.NGAY_TAO)?.toISOString() || '',
  status: /nghỉ|nghi viec/i.test(String(row.TRANG_THAI || '')) ? 'Nghỉ việc'
    : /khóa|khoa|ngừng|ngung|inactive/i.test(String(row.TRANG_THAI || '')) ? 'Bị khóa' : 'Hoạt động',
  lastLogin: row.DANG_NHAP_GAN_NHAT ? { time: row.DANG_NHAP_GAN_NHAT.THOI_GIAN, ip: row.DANG_NHAP_GAN_NHAT.IP, device: row.DANG_NHAP_GAN_NHAT.THIET_BI } : null,
  loginLockedUntil: row.KHOA_DANG_NHAP_DEN && new Date(row.KHOA_DANG_NHAP_DEN).getTime() > Date.now() ? row.KHOA_DANG_NHAP_DEN : null,
  selected: false,
});

export const getAdminStaffAccounts = async (req: Request, res: Response) => {
  try {
    const employeeCollection = await getCollection<any>('NHAN_VIEN');
    let staff = (await employeeCollection.find({ DA_XOA: { $ne: true } }, { projection: { MAT_KHAU: 0 } }).sort({ NHAN_VIEN_ID: 1 }).toArray()).map(mapStaffAccount);
    if (req.query.scope === 'delivery') {
      staff = staff.filter(row => /giao|shipper|vận chuyển|van chuyen/i.test(row.role) && row.status === 'Hoạt động')
        .map(row => ({ code: row.code, name: row.name, phone: row.phone, role: row.role, status: row.status, selected: false } as any));
    }
    const keyword = normalizeText(req.query.search || '');
    const role = String(req.query.role || '').trim();
    const status = String(req.query.status || '').trim();
    if (keyword) staff = staff.filter(row => normalizeText([row.code, row.name, row.email, row.phone].join(' ')).includes(keyword));
    if (role) staff = staff.filter(row => row.role === role);
    if (status) staff = staff.filter(row => row.status === status);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ total: staff.length, staff, accounts: staff });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể tải danh sách tài khoản quản trị.' });
  }
};

export const getAdminOrders = async (req: Request, res: Response) => {
  try {
    const orderCollection = await getCollection<any>('DON_HANG');
    const ordersRaw = await orderCollection.find({}, { projection: {
      DON_HANG_ID: 1, KHACH_HANG_ID: 1, TEN_NGUOI_DAT: 1, TEN_NGUOI_NHAN: 1,
      NGAY_MUON_GIAO: 1, KHUNG_GIO_MUON_GIAO: 1, TIEN_COC: 1, TONG_TIEN: 1,
      PHUONG_THUC_THANH_TOAN: 1, NHAN_VIEN_GIAO_HANG_ID: 1, 'NHAN_VIEN_GIAO_HANG.id': 1,
      GHI_CHU_NOI_BO: 1, NGAY_TAO: 1, TRANG_THAI: 1,
    } }).toArray();
    const ids = ordersRaw.map(order => order.DON_HANG_ID);
    const customerIds = [...new Set(ordersRaw.map(o => o.KHACH_HANG_ID).filter(Boolean))];
    const [paymentMap, customers, details] = await Promise.all([
      getLatestPaymentByOrderIds(ids),
      getCollection<any>('KHACH_HANG').then(collection => collection.find({ KHACH_HANG_ID: { $in: customerIds } }, { projection: { KHACH_HANG_ID: 1, TEN: 1 } }).toArray()),
      getCollection<any>('DON_HANG_CHI_TIET').then(collection => collection.find({ DON_HANG_ID: { $in: ids } }, { projection: {
        DON_HANG_ID: 1, SAN_PHAM_ID: 1, TEN_SAN_PHAM_SNAPSHOT: 1, SO_LUONG: 1,
      } }).toArray()),
    ]);
    const products = await (await getCollection<any>('SAN_PHAM')).find({ SAN_PHAM_ID: { $in: details.map(i => i.SAN_PHAM_ID) } }, { projection: { SAN_PHAM_ID: 1, TEN_SAN_PHAM: 1 } }).toArray();
    const productNames = new Map(products.map(p => [p.SAN_PHAM_ID, p.TEN_SAN_PHAM]));
    const customerNames = new Map(customers.map(customer => [customer.KHACH_HANG_ID, customer.TEN]));
    const detailsByOrder = new Map<string, any[]>();
    for (const detail of details) {
      const rows = detailsByOrder.get(detail.DON_HANG_ID) || [];
      rows.push(detail);
      detailsByOrder.set(detail.DON_HANG_ID, rows);
    }
    let orders = ordersRaw
      .sort((left, right) => (toDate(right.NGAY_TAO)?.getTime() || 0) - (toDate(left.NGAY_TAO)?.getTime() || 0))
      .map((row) => {
        const payment = paymentMap.get(row.DON_HANG_ID);
        const paymentSummary = summarizePayments(payment?.rows || [], Number(row.TONG_TIEN || 0), Number(row.TIEN_COC || 0));
        return {
          id: row.DON_HANG_ID,
          senderName: row.TEN_NGUOI_DAT || customerNames.get(row.KHACH_HANG_ID) || 'Khách vãng lai',
          receiverName: row.TEN_NGUOI_NHAN || '',
          products: (detailsByOrder.get(row.DON_HANG_ID) || []).map(i => ({ name: i.TEN_SAN_PHAM_SNAPSHOT || productNames.get(i.SAN_PHAM_ID) || i.SAN_PHAM_ID, qty: i.SO_LUONG })),
          deliveryDate: formatDate(row.NGAY_MUON_GIAO), deliverySlot: slot24h(row.KHUNG_GIO_MUON_GIAO),
          deposit: Number(row.TIEN_COC || 0), paid: paymentSummary.successfulReceiptsTotal, refunded:paymentSummary.actualRefundsTotal,
          remaining: paymentSummary.remainingAmount, paymentSummary,
          allowedStatuses: allowedOrderStatuses(row, paymentSummary.netCollected, res.locals?.adminEmployee?.VAI_TRO), adminNote: row.GHI_CHU_NOI_BO || '',
          customerId: row.KHACH_HANG_ID || '',
          createdAt: formatDate(row.NGAY_TAO),
          total: Number(row.TONG_TIEN || 0),
          paymentStatus: paymentSummary.paymentStatus === 'PAID' ? 'Đã thanh toán' : paymentSummary.paymentStatus === 'PARTIALLY_PAID' ? 'Đã cọc'
            : /thất bại|failed/i.test(String(payment?.latest?.TRANG_THAI_THANH_TOAN || '')) ? 'Thanh toán thất bại' : 'Chờ thanh toán',
          orderStatus: normalizeOrderStatus(row.TRANG_THAI),
          selected: false,
        };
      });
    const statistics = {
      total: orders.length,
      newOrders: orders.filter(order => order.orderStatus === 'Đã đặt hàng thành công').length,
      undelivered: orders.filter(order => ['Đã đặt hàng thành công','Đang chuẩn bị hàng','Chờ vận chuyển','Đang giao'].includes(order.orderStatus)).length,
      unpaid: orders.filter(order => order.remaining > 0 && order.orderStatus !== 'Đã hủy').length,
    };
    const keyword = normalizeText(req.query.search || '');
    const tab = String(req.query.tab || '').trim();
    const status = String(req.query.status || '').trim();
    const paymentStatus = String(req.query.paymentStatus || '').trim();
    const from = toDate(req.query.from);
    const to = toDate(req.query.to);
    if (keyword) orders = orders.filter(order => normalizeText([order.id, order.senderName, order.receiverName, order.customerId,
      ...(order.products || []).flatMap((product: any) => [product.name])].join(' ')).includes(keyword));
    if (status) orders = orders.filter(order => order.orderStatus === status);
    if (paymentStatus) orders = orders.filter(order => order.paymentStatus === paymentStatus);
    if (tab === 'new') orders = orders.filter(order => order.orderStatus === 'Đã đặt hàng thành công');
    if (tab === 'undelivered') orders = orders.filter(order => ['Đã đặt hàng thành công','Đang chuẩn bị hàng','Chờ vận chuyển','Đang giao'].includes(order.orderStatus));
    if (tab === 'unpaid') orders = orders.filter(order => order.remaining > 0 && order.orderStatus !== 'Đã hủy');
    if (from || to) orders = orders.filter(order => {
      const value = toDate(order.createdAt)?.getTime();
      return value !== undefined && value !== null && (!from || value >= from.getTime()) && (!to || value <= to.getTime() + 86_399_999);
    });
    const total = orders.length;
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const requestedLimit = Number.parseInt(String(req.query.limit || '0'), 10) || 0;
    const limit = requestedLimit ? Math.min(200, Math.max(1, requestedLimit)) : 0;
    if (limit) orders = orders.slice((page - 1) * limit, page * limit);
    return res.status(200).json({ total, page, limit: limit || total, totalPages: limit ? Math.max(1, Math.ceil(total / limit)) : 1, statistics, orders });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể lấy danh sách đơn hàng: ' + error.message });
  }
};

export const getAdminOrderDetail = async (req: Request, res: Response) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId) return res.status(400).json({ message: 'Thiếu mã đơn hàng.' });
    const order = await getAdminOrderDetailById(orderId, res.locals?.adminEmployee?.VAI_TRO);
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    return res.status(200).json({ order });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể lấy chi tiết đơn hàng: ' + error.message });
  }
};

/** Chuyển form tạo đơn của Admin sang đúng payload checkout của Khách (cùng giá, phí giao, voucher). */
function adminCheckoutBody(body: any) {
  return {
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
    giftCard: body.giftCard || null,
  };
}

export const createAdminOrder = async (req: Request, res: Response) => {
  // Admin uses exactly the same price validation, reservation and idempotency as Customer.
  // It never treats a user-entered paid/deposit field as a verified receipt.
  res.locals.adminCheckout = true;
  req.body = adminCheckoutBody(req.body || {});
  return createOrder(req, res);
};

/** Báo giá cho trang tạo đơn Admin: dùng chung priceCheckout với Khách, không giữ hàng, không ghi dữ liệu. */
export const quoteAdminOrder = async (req: Request, res: Response) => {
  try {
    const payload: any = adminCheckoutBody(req.body || {});
    if (!payload.payment.method) payload.payment.method = 'bank';
    // Chưa chọn lịch giao thì chỉ tính tiền: lấy tạm 10:00 ngày mai (không ảnh hưởng giá).
    if (!payload.delivery.date || !payload.delivery.time) {
      const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(Date.now() + 24 * 3600_000));
      payload.delivery = { ...payload.delivery, date: tomorrow, time: '10:00' };
    }
    const priced = await priceCheckout(payload);
    return res.json({ items: priced.items, summary: priced.summary });
  } catch (error: any) {
    return res.status(error instanceof InventoryError ? error.status : 500)
      .json({ message: error instanceof InventoryError ? error.message : 'Không thể báo giá lúc này.' });
  }
};

const balanceCollectionStatuses = ['Đang giao', 'Đã giao', 'Giao hàng thành công'];

export const getAdminTransactions = async (req: Request, res: Response) => {
  try {
    const paymentCollection = await getCollection<any>('THANH_TOAN');
    const rows = await paymentCollection.find({}).sort({ NGAY_THANH_TOAN: -1 }).toArray();
    const orders = await (await getCollection<any>('DON_HANG')).find({ DON_HANG_ID: { $in: rows.map(r => r.DON_HANG_ID) } }, { projection: {
      DON_HANG_ID: 1, TONG_TIEN: 1, TIEN_COC: 1, TRANG_THAI: 1, PHUONG_THUC_THANH_TOAN: 1,
    } }).toArray();
    const ordersById = new Map(orders.map(order => [order.DON_HANG_ID, order]));
    const paymentsByOrder = new Map<string, any[]>();
    for (const payment of rows) {
      const orderPayments = paymentsByOrder.get(payment.DON_HANG_ID) || [];
      orderPayments.push(payment);
      paymentsByOrder.set(payment.DON_HANG_ID, orderPayments);
    }
    const paidByOrder = new Map(Array.from(paymentsByOrder.entries()).map(([orderId, payments]) =>
      [orderId, Math.max(0, sumVerifiedPayments(payments))]));
    let transactions = rows.map((row, index) => {
      const order = ordersById.get(row.DON_HANG_ID);
      const paid = paidByOrder.get(row.DON_HANG_ID) || 0;
      const total = Number(order?.TONG_TIEN || 0);
      const deposit = Number(order?.TIEN_COC || 0);
      const gateway = row.CONG_THANH_TOAN || order?.PHUONG_THUC_THANH_TOAN || '';
      const kind = row.LOAI_GIAO_DICH === 'HOAN_TIEN' ? 'refund' : row.LOAI_GIAO_DICH === 'SO_DU' ? 'balance'
        : /\bcod\b|thanh toan khi nhan hang/.test(normalizeText(gateway)) ? 'deposit' : 'full';
      const status = kind === 'deposit' && paymentSucceeded(row.TRANG_THAI_THANH_TOAN) ? 'Đã thanh toán cọc'
        : kind === 'deposit' && normalizeTransactionStatus(row.TRANG_THAI_THANH_TOAN) === 'Thất bại' ? 'Thanh toán cọc thất bại'
        : row.TRANG_THAI_THANH_TOAN;
      return { ...row, id: index + 1, code: row.THANH_TOAN_ID, orderCode: row.DON_HANG_ID,
        orderId: row.DON_HANG_ID, gateway, referenceCode: row.MA_GIAO_DICH || '',
        amount: Number(row.SO_TIEN || 0), status, kind,
        transactionDate: row.NGAY_THANH_TOAN, paidAt: row.NGAY_THANH_TOAN,
        total, deposit, paid, remaining: Math.max(0, total - paid),
        canRecordBalance: kind === 'deposit' && paymentSucceeded(row.TRANG_THAI_THANH_TOAN) && paid >= deposit && paid < total
          && balanceCollectionStatuses.includes(order?.TRANG_THAI)
          && !paymentsByOrder.get(row.DON_HANG_ID)?.some(payment => payment.LOAI_GIAO_DICH === 'SO_DU' && payment.TRANG_THAI_THANH_TOAN === 'Chờ thanh toán'),
        editable: kind !== 'refund' && row.TRANG_THAI_THANH_TOAN === 'Chờ thanh toán' && !!order && !['Đã hủy','Đã hoàn tiền'].includes(order.TRANG_THAI),
        history: row.LICH_SU || [], confirmedAt: row.XAC_NHAN_LUC || null, confirmedBy: row.NGUOI_XAC_NHAN || '', selected: false };
    });
    const keyword = normalizeText(req.query.search || '');
    const status = String(req.query.status || '').trim();
    const gateway = String(req.query.gateway || '').trim();
    const from = toDate(req.query.from);
    const to = toDate(req.query.to);
    if (keyword) transactions = transactions.filter(row => normalizeText([row.code, row.orderCode, row.referenceCode, row.gateway].join(' ')).includes(keyword));
    if (status) {
      const statusFilterKey = (value: string) => ['Đã thanh toán cọc', 'Thanh toán cọc thất bại'].includes(value) ? value : normalizeTransactionStatus(value);
      transactions = transactions.filter(row => statusFilterKey(row.status) === statusFilterKey(status));
    }
    if (gateway) transactions = transactions.filter(row => normalizeText(row.gateway) === normalizeText(gateway));
    if (from || to) transactions = transactions.filter(row => {
      const value = toDate(row.transactionDate)?.getTime();
      return value !== undefined && value !== null && (!from || value >= from.getTime()) && (!to || value <= to.getTime() + 86_399_999);
    });
    const total = transactions.length;
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const requestedLimit = Number.parseInt(String(req.query.limit || '0'), 10) || 0;
    const limit = requestedLimit ? Math.min(200, Math.max(1, requestedLimit)) : 0;
    if (limit) transactions = transactions.slice((page - 1) * limit, page * limit);
    return res.status(200).json({ total, page, limit: limit || total, totalPages: limit ? Math.max(1, Math.ceil(total / limit)) : 1, transactions });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load transactions: ' + error.message });
  }
};

export const updateAdminTransaction = async (req: Request, res: Response) => {
  try {
    if (!String(req.body?.reason || '').trim()) throw new InventoryError(400, 'Cần nhập căn cứ đối soát giao dịch.');
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
      const balance = req.body.balance === true;
      const status = normalizeTransactionStatus(req.body.status);
      const reason = String(req.body.reason || '').trim();
      if (balance) {
        if (!balanceCollectionStatuses.includes(order.TRANG_THAI)) throw new InventoryError(409, 'Chỉ ghi nhận số dư khi đơn đang giao hoặc đã giao.');
        if (!['Thành công', 'Thất bại'].includes(status)) throw new InventoryError(400, 'Vui lòng chọn kết quả đối soát giao dịch.');
        if (!reference) throw new InventoryError(400, 'Cần nhập mã tham chiếu.');
        if (!reason) throw new InventoryError(400, 'Cần nhập căn cứ đối soát giao dịch.');
      }
      if (balance && prior && prior.LOAI_GIAO_DICH !== 'SO_DU') throw new InventoryError(409, 'Khoản số dư cần mã tham chiếu riêng.');
      let target = prior || rows.find(p => p.TRANG_THAI_THANH_TOAN === 'Chờ thanh toán' && (!balance || p.LOAI_GIAO_DICH === 'SO_DU'));
      if (!target) {
        const paid = sumVerifiedPayments(rows), remaining = Number(order.TONG_TIEN) - paid;
        if (balance) {
          if (!(remaining > 0)) throw new InventoryError(409, 'Đơn không còn khoản phải thu.');
          if (paid < Number(order.TIEN_COC || 0)) throw new InventoryError(409, 'Cần xác minh đủ tiền cọc trước khi ghi nhận số dư.');
          if (Number(req.body.amount) !== remaining) throw new InventoryError(409, 'Số tiền phải khớp khoản còn lại của đơn.');
        }
        if (!(paid > 0 || order.KHONG_YEU_CAU_COC) || !(remaining > 0) || Number(req.body.amount) !== remaining || !reference) throw new InventoryError(409, 'Cần khoản thu số dư chính xác và mã tham chiếu riêng.');
        if (['Đã hủy', 'Thanh toán thất bại'].includes(order.TRANG_THAI)) throw new InventoryError(409, 'Đơn không còn cho phép thu số dư.');
        // Use the same order-based prefix as the checkout transfer code.
        const prefix = `GD${orderId.replace(/^YEN/, '')}-SD`;
        const existingIds = new Set(rows.map(payment => payment.THANH_TOAN_ID));
        let sequence = rows.filter(payment => payment.LOAI_GIAO_DICH === 'SO_DU').length + 1;
        let id = `${prefix}${String(sequence).padStart(2, '0')}`;
        while (existingIds.has(id)) {
          sequence += 1;
          id = `${prefix}${String(sequence).padStart(2, '0')}`;
        }
        target = { _id: id, THANH_TOAN_ID: id, DON_HANG_ID: orderId, CONG_THANH_TOAN: order.PHUONG_THUC_THANH_TOAN,
          SO_TIEN: remaining, LOAI_GIAO_DICH: 'SO_DU', MA_GIAO_DICH: reference, TRANG_THAI_THANH_TOAN: 'Chờ thanh toán', NGAY_THANH_TOAN: new Date() };
        await orders.updateOne({ DON_HANG_ID: orderId }, { $inc: { PHIEN_BAN_THANH_TOAN: 1 } }, { session });
        await payments.insertOne(target, { session });
      }
      if (status === 'Chờ thanh toán') {
        if (target.TRANG_THAI_THANH_TOAN !== 'Chờ thanh toán' || Number(req.body.amount) !== Number(target.SO_TIEN)) throw new InventoryError(409, 'Không thể mở lại hoặc sửa tiền một giao dịch đã xử lý.');
        return target;
      }
      return changeCheckoutPayment(session, target.THANH_TOAN_ID, { status, amount: req.body.amount, referenceCode: reference || undefined, reason },
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
    const order = await getAdminOrderDetailById(orderId, res.locals?.adminEmployee?.VAI_TRO);
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

/**
 * Lưu "Công thức hoa" ở chi tiết sản phẩm vào BOM (công thức kho thật sự dùng):
 * nếu khác BOM hiệu lực thì tạo phiên bản BOM mới và kích hoạt, giữ nguyên phương án thay thế của từng NVL.
 */
const saveRecipeAsBom = async (productId: string, materials: any[], actorId: string | null) => {
  const materialCollection = await getCollection<any>('NGUYEN_VAT_LIEU');
  const wanted: Array<{ id: string; quantity: number; unit: string; note: string }> = [];
  for (const item of materials) {
    const value = String(item?.code || item?.name || '').trim();
    if (!value) continue;
    const material = await materialCollection.findOne({ $or: [
      { NGUYEN_VAT_LIEU_ID: value },
      { TEN_NGUYEN_VAT_LIEU: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } },
    ] });
    if (!material) throw new InventoryError(400, `Nguyên vật liệu "${value}" không tồn tại.`);
    const quantity = Number(item.quantity);
    if (!(quantity > 0)) throw new InventoryError(400, `Số lượng của "${material.TEN_NGUYEN_VAT_LIEU}" phải lớn hơn 0.`);
    if (wanted.some(w => w.id === material.NGUYEN_VAT_LIEU_ID)) throw new InventoryError(400, `"${material.TEN_NGUYEN_VAT_LIEU}" bị trùng trong công thức.`);
    wanted.push({ id: material.NGUYEN_VAT_LIEU_ID, quantity, unit: String(item.unit || material.DON_VI_TINH || '').trim(), note: String(item.note || '').trim() });
  }
  if (!wanted.length) throw new InventoryError(400, 'Công thức phải có ít nhất một nguyên vật liệu.');
  const active = await getActiveBom(productId);
  const current = active.legacy ? [] : active.lines;
  const same = current.length === wanted.length && wanted.every(w => {
    const line = current.find(l => l.NGUYEN_VAT_LIEU_ID === w.id);
    return line && Number(line.DINH_LUONG) === w.quantity && String(line.DON_VI_TINH || '') === w.unit && String(line.GHI_CHU || '') === w.note;
  });
  if (same) return null;
  const lines = wanted.map(w => {
    const old: any = current.find(l => l.NGUYEN_VAT_LIEU_ID === w.id) || {};
    return {
      materialId: w.id, quantity: w.quantity, unit: w.unit, note: w.note,
      role: old.VAI_TRO, substitutes: old.DS_THAY_THE || [], required: old.BAT_BUOC ?? true,
      // Dữ liệu cũ có danh sách thay thế nhưng cờ cho phép đang tắt: bật cờ để giữ nguyên phương án thay thế.
      allowSubstitution: Boolean(old.CHO_PHEP_THAY_THE) || (old.DS_THAY_THE || []).length > 0 || (old.QUY_TAC_THAY_THE || []).length > 0,
      substitutionRules: old.QUY_TAC_THAY_THE || [],
    };
  });
  return createBomVersion(productId, {
    lines, allowSubstitution: active.bom?.CHO_THAY_THE_NVL ?? true,
    note: 'Cập nhật từ trang chi tiết sản phẩm', activate: true,
  }, { id: actorId, role: 'admin' });
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
  // Phương án thay thế lấy từ BOM hiệu lực (quy tắc có tỷ lệ quy đổi + danh sách thay thế).
  const activeBom = await getActiveBom(productId);
  const nameOf = (id: string) => materialMap.get(id)?.TEN_NGUYEN_VAT_LIEU || id;
  const substitutesByMaterial = new Map<string, string[]>();
  for (const line of activeBom.lines || []) {
    const fromRules = (line.QUY_TAC_THAY_THE || []).map(rule => {
      const ratio = Number(rule.TY_LE_QUY_DOI || 1);
      const extra = [ratio !== 1 ? `×${ratio}` : '', rule.SO_LUONG_TOI_DA ? `tối đa ${rule.SO_LUONG_TOI_DA}` : '', rule.DIEU_KIEN || ''].filter(Boolean).join(', ');
      return `${nameOf(rule.NGUYEN_VAT_LIEU_ID)}${extra ? ` (${extra})` : ''}`;
    });
    const ruleIds = new Set((line.QUY_TAC_THAY_THE || []).map(rule => rule.NGUYEN_VAT_LIEU_ID));
    const plain = (line.DS_THAY_THE || []).filter(id => !ruleIds.has(id)).map(nameOf);
    substitutesByMaterial.set(line.NGUYEN_VAT_LIEU_ID, [...fromRules, ...plain]);
  }
  // BOM hiệu lực là công thức thật kho đang dùng; chỉ đọc công thức cũ khi sản phẩm chưa có BOM.
  const sourceRows: any[] = !activeBom.legacy && activeBom.lines.length
    ? activeBom.lines.map(line => ({ NGUYEN_VAT_LIEU_ID: line.NGUYEN_VAT_LIEU_ID, SO_LUONG_CAN: line.DINH_LUONG, DON_VI_TINH: line.DON_VI_TINH, GHI_CHU: line.GHI_CHU }))
    : recipeRows;
  const mappedRecipe = sourceRows.map((item, index) => ({
    substitutes: substitutesByMaterial.get(item.NGUYEN_VAT_LIEU_ID) || [],
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
      finishedAvailable: summary.finishedAvailable, buildable: summary.buildable,
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
    // Công thức hoa → BOM (phiên bản mới khi có thay đổi).
    const bom = Array.isArray(body.materials) ? await saveRecipeAsBom(productId, body.materials, String(res.locals.adminEmployee?.NHAN_VIEN_ID || '') || null) : null;
    const product = await getAdminProduct(productId);
    return res.status(200).json({ message: bom ? `Cập nhật sản phẩm thành công. Công thức đã lưu thành BOM phiên bản ${bom.PHIEN_BAN}.` : 'Cập nhật sản phẩm thành công.', product });
  } catch (error: any) {
    return res.status(error instanceof InventoryError ? error.status : 500).json({ message: error.message || 'Không thể cập nhật sản phẩm.', ...(error instanceof InventoryError && error.details ? { details: error.details } : {}) });
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
    const actorId = String(res.locals?.adminEmployee?.NHAN_VIEN_ID || '');
    const actorRole = res.locals?.adminEmployee?.VAI_TRO;
    // Phân quyền theo vai trò: kho chỉ "Chờ vận chuyển", giao hàng chỉ các bước giao.
    if (req.body.action) assertRoleCanDoOrderAction(actorRole, String(req.body.action));
    else {
      if (status === 'Giao thành công') status = 'Đã giao';
      if (status) assertRoleCanSetOrderStatus(actorRole, status);
    }
    if (req.body.action === 'start-preparation') {
      const actor = { id: actorId, role: 'Admin' };
      const details = await suggestExportLines({ type: 'Làm hoa theo đơn', orderId });
      const alreadyStarted = await withTransaction(async session => {
        const orders = await getCollection<any>('DON_HANG');
        const current = await orders.findOne({ DON_HANG_ID: orderId }, { session });
        if (!current) throw new InventoryError(404, 'Không tìm thấy đơn hàng.');
        if (current.TRANG_THAI === 'Đang chuẩn bị hàng' && current.THOI_DIEM_BAT_DAU_THUC_TE) return true;
        if (!['Đã đặt hàng thành công', 'Chờ xử lý'].includes(String(current.TRANG_THAI))) throw new InventoryError(409, 'Chỉ bắt đầu chuẩn bị với đơn đã đặt hàng thành công.');
        if (!current.THOI_DIEM_CHUAN_BI_DU_KIEN) throw new InventoryError(409, 'Cần nhập thời điểm chuẩn bị dự kiến T trước.');
        // Cùng điều kiện và cùng quy trình với phiếu xuất ở màn NVL.
        await assertOrderReadyForMaterialExport(current, session);
        // Có NVL cần xuất: ghi nhận phiếu xuất, phiếu xuất tự chuyển đơn sang "Đang chuẩn bị hàng".
        if (!current.DA_XUAT_NVL && details.length) await createExport(
          { type: 'Làm hoa theo đơn', orderId, details, post: true, note: 'Xuất NVL khi bắt đầu chuẩn bị đơn' }, actor, { session },
        );
        // Đơn chỉ dùng bó sẵn hoặc đã xuất trước đó: chuyển trạng thái trực tiếp.
        await markOrderPreparationStarted(orderId, actor, session, 'Bắt đầu chuẩn bị');
        const after = await orders.findOne({ DON_HANG_ID: orderId }, { session });
        if (after?.TRANG_THAI !== 'Đang chuẩn bị hàng') throw new InventoryError(409, 'Trạng thái đơn vừa thay đổi. Vui lòng tải lại.');
        return false;
      });
      const order = await getAdminOrderDetailById(orderId, res.locals?.adminEmployee?.VAI_TRO);
      return res.status(200).json({ message: alreadyStarted ? 'Đơn đã bắt đầu chuẩn bị.' : 'Đã bắt đầu chuẩn bị đơn.', order });
    }
    await withTransaction(async session => {
    const orders = await getCollection<any>('DON_HANG');
    const current = await orders.findOne({ DON_HANG_ID: orderId }, { session });
    if (!current) throw new InventoryError(404, 'Không tìm thấy đơn hàng.');
    const actor = actorId;
    if (req.body.action === 'note' || req.body.action === 'preparation' || req.body.action === 'handover-media' || req.body.action === 'delivery' || req.body.action === 'assign-shipper' || req.body.action === 'support-exception') {
      const changes: any = {};
      if (req.body.action === 'support-exception') {
        // Quá 1 giờ sau giao: nhân viên mở thêm 1 giờ cho khách gửi yêu cầu hỗ trợ, bắt buộc ghi lý do.
        if (!['Đã giao', 'Giao thành công', 'Giao hàng thành công', 'Hoàn thành'].includes(String(current.TRANG_THAI))) throw new InventoryError(409, 'Chỉ mở ngoại lệ cho đơn đã giao thành công.');
        const reason = String(req.body.reason || '').trim();
        if (reason.length < 10 || reason.length > 1000) throw new InventoryError(400, 'Cần lý do mở ngoại lệ, 10–1.000 ký tự.');
        const at = new Date();
        changes.HO_TRO_NGOAI_LE = { until: new Date(at.getTime() + 60 * 60 * 1000), reason, actor, at };
        changes.LICH_SU_NGOAI_LE_HO_TRO = [...(Array.isArray(current.LICH_SU_NGOAI_LE_HO_TRO) ? current.LICH_SU_NGOAI_LE_HO_TRO : []), { reason, actor, at }];
      } else if (req.body.action === 'note') {
        if (typeof req.body.adminNote !== 'string' || req.body.adminNote.length > 2000) throw new InventoryError(400, 'Ghi chú nội bộ tối đa 2.000 ký tự.');
        changes.GHI_CHU_NOI_BO = req.body.adminNote.trim();
      } else if (req.body.action === 'preparation') {
        const at = toDate(req.body.preparationAt);
        if (!at || current.THOI_DIEM_BAT_DAU_THUC_TE) throw new InventoryError(409, 'Chỉ nhập hoặc đổi T trước khi thực tế bắt đầu chuẩn bị.');
        // Cùng điều kiện với trang Kho: T hợp lệ, trước giờ giao, đơn chưa hủy/chưa xuất NVL.
        await assertPrepTimeChangeAllowed(current, at, session);
        const oldAt = current.THOI_DIEM_CHUAN_BI_DU_KIEN || null;
        const reason = String(req.body.reason || '').trim();
        if (!reason || reason.length > 500) throw new InventoryError(400, 'Cần lý do nhập hoặc điều chỉnh T, tối đa 500 ký tự.');
        await syncOrderPrepTime(String(current.DON_HANG_ID), at, session);
        changes.THOI_DIEM_CHUAN_BI_DU_KIEN = at; changes.NGUOI_NHAP_T = actor; changes.THOI_DIEM_NHAP_T = new Date();
        changes.LICH_SU_T = [...(Array.isArray(current.LICH_SU_T) ? current.LICH_SU_T : []), { oldAt, newAt: at, reason, actor, at: new Date() }];
      } else if (req.body.action === 'handover-media') {
        const urls = Array.isArray(req.body.media) ? req.body.media.map((value: unknown) => String(value || '').trim()).filter(Boolean) : [];
        if (urls.length > 10 || urls.some((url: string) => url.length > 2000 || (!/^https?:\/\//i.test(url) && !/^\/uploads\/[\w./-]+$/.test(url)))) throw new InventoryError(400, 'Tối đa 10 liên kết ảnh/video bàn giao hợp lệ.');
        changes.MEDIA_BAN_GIAO = urls;
      } else if (req.body.action === 'assign-shipper') {
        if (['Hoàn thành','Đã hủy'].includes(String(current.TRANG_THAI))) throw new InventoryError(409, 'Đơn đã kết thúc, không thể phân công giao hàng.');
        const employeeId = String(req.body.shipperId || '').trim();
        const employee = await (await getCollection<any>('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: employeeId }, { session });
        if (!employee) throw new InventoryError(404, 'Không tìm thấy nhân viên giao hàng.');
        if (/khóa|nghỉ|ngung|inactive/i.test(String(employee.TRANG_THAI || ''))) throw new InventoryError(409, 'Nhân viên hiện không hoạt động.');
        if (!/giao|shipper|van chuyen|vận chuyển/i.test(String(employee.VAI_TRO || employee.CHUC_VU || ''))) throw new InventoryError(409, 'Nhân viên không có vai trò giao hàng.');
        changes.NHAN_VIEN_GIAO_HANG_ID = employeeId;
        changes.NHAN_VIEN_GIAO_HANG = { id:employeeId, name:String(employee.HO_TEN || employee.TEN || employeeId), phone:String(employee.SDT || ''), avatar:String(employee.AVATAR || '') };
        changes.PHAN_CONG_GIAO_LUC = new Date(); changes.NGUOI_PHAN_CONG_GIAO = actor;
      } else {
        if (!['Chờ thanh toán', 'Đã xác nhận đơn hàng', 'Chờ xử lý', 'Đã đặt hàng thành công'].includes(String(current.TRANG_THAI)) || current.THOI_DIEM_BAT_DAU_THUC_TE) {
          throw new InventoryError(409, 'Chỉ được sửa thông tin giao trước khi bắt đầu chuẩn bị đơn.');
        }
        const receiverName = String(req.body.receiverName || '').trim();
        const receiverPhone = String(req.body.receiverPhone || '').replace(/\s+/g, '');
        const deliveryAddress = String(req.body.deliveryAddress || '').trim();
        const deliverySlot = String(req.body.deliverySlot || '').trim();
        const deliveryDate = toDate(req.body.deliveryDate);
        if (!receiverName || receiverName.length > 120) throw new InventoryError(400, 'Tên người nhận không hợp lệ.');
        if (!/^0\d{9}$/.test(receiverPhone)) throw new InventoryError(400, 'Số điện thoại người nhận phải gồm 10 chữ số và bắt đầu bằng 0.');
        if (!deliveryAddress || deliveryAddress.length > 500) throw new InventoryError(400, 'Địa chỉ giao hàng không hợp lệ.');
        if (!deliveryDate || !deliverySlot || deliveryDate.getTime() < new Date(new Date().toISOString().slice(0, 10)).getTime()) {
          throw new InventoryError(400, 'Ngày và giờ giao hàng không hợp lệ.');
        }
        changes.TEN_NGUOI_NHAN = receiverName;
        changes.SDT_NGUOI_NHAN = receiverPhone;
        changes.DIA_CHI_GIAO_HANG = deliveryAddress;
        changes.NGAY_MUON_GIAO = deliveryDate;
        changes.KHUNG_GIO_MUON_GIAO = slot24h(deliverySlot);
        changes.DA_CHINH_SUA_GIAO_HANG = true;
      }
      const expectedVersion = req.body.expectedVersion ? toDate(req.body.expectedVersion) : null;
      const write = await orders.updateOne({ DON_HANG_ID: orderId, ...(expectedVersion ? { NGAY_CAP_NHAT: expectedVersion } : {}) }, { $set: { ...changes, NGAY_CAP_NHAT: new Date() },
        ...(req.body.action !== 'assign-shipper' ? {
          $push: { LICH_SU_TRANG_THAI: { from: current.TRANG_THAI, to: current.TRANG_THAI, action: req.body.action, at: new Date(), actor } },
        } : {}) } as any, { session });
      if (!write.modifiedCount) throw new InventoryError(409, 'Đơn vừa được nhân viên khác cập nhật. Vui lòng tải lại trước khi lưu.');
      if (req.body.action === 'preparation') await orderEvent(session, `${orderId}:prep:${new Date(changes.THOI_DIEM_CHUAN_BI_DU_KIEN).toISOString()}`, current.KHACH_HANG_ID || null, orderId, 'Cập nhật lịch chuẩn bị', `Shop đã cập nhật lịch chuẩn bị dự kiến cho đơn ${orderId}.`);
      if (req.body.action === 'support-exception') await orderEvent(session, `${orderId}:support-exception:${changes.HO_TRO_NGOAI_LE.at.toISOString()}`, current.KHACH_HANG_ID || null, orderId, 'Shop mở lại hỗ trợ cho đơn', 'Bạn có thêm 1 giờ để gửi yêu cầu hỗ trợ cho đơn này.', `/order-detail/${orderId}`);
      if (req.body.action === 'handover-media') await orderEvent(session, `${orderId}:handover-media:${changes.MEDIA_BAN_GIAO.join('|')}`, current.KHACH_HANG_ID || null, orderId, 'Hình ảnh hoa đã sẵn sàng', 'Shop đã cập nhật hình ảnh hoặc video hoa của đơn hàng.', `/order-detail/${orderId}`);
      if (req.body.action === 'assign-shipper') await orderEvent(session, `${orderId}:shipper:${changes.NHAN_VIEN_GIAO_HANG_ID}:${changes.PHAN_CONG_GIAO_LUC.toISOString()}`, current.KHACH_HANG_ID || null, orderId, 'Đã phân công giao hàng', 'Shop đã phân công nhân viên giao đơn của bạn.', `/order-detail/${orderId}`);
      return;
    }
    if (!status) throw new InventoryError(400, 'Thiếu trạng thái đơn.');
    if (status === 'Giao thành công') status = 'Đã giao';
    if (status === 'Đang chuẩn bị' || status === 'Đang chuẩn bị hàng') throw new InventoryError(409, 'Hãy dùng thao tác Bắt đầu chuẩn bị để hệ thống kiểm tra và xuất kho đúng một lần.');
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
    // Hủy trước khi chuẩn bị (assertOrderTransition đã chặn hủy sau khi xuất kho): trả lại điểm đã dùng, giống khi khách tự hủy.
    if (status === 'Đã hủy') await restoreOrderPoints(session, current);
    if (current?.KIEM_TRA_TON_KHO && status === 'Đang giao') {
      await shipFinishedGoodsForOrder(orderId, { id: actor, role: 'Admin' }, session);
    }
    await (await getCollection<any>('DON_HANG')).updateOne(
      { DON_HANG_ID: orderId },
      {
        $set: {
          TRANG_THAI: status,
          ...(status === 'Từ chối hoàn tiền/trả hàng' ? { LY_DO_TU_CHOI: String(req.body.rejectReason).trim() } : {}),
          // Mốc thời gian cho Dashboard/Báo cáo (D05): doanh thu tính theo ngày hoàn thành, tỷ lệ hủy theo ngày hủy
          ...(status === 'Hoàn thành' && !current?.NGAY_HOAN_THANH ? { NGAY_HOAN_THANH: new Date() } : {}),
          // Mốc giao thành công: bắt đầu tính 1 giờ khách được gửi yêu cầu hỗ trợ.
          ...(['Đã giao', 'Giao hàng thành công'].includes(status) && !current?.NGAY_GIAO_THUC_TE ? { NGAY_GIAO_THUC_TE: new Date() } : {}),
          ...(status === 'Đã hủy' && !current?.NGAY_HUY ? { NGAY_HUY: new Date() } : {}),
          NGAY_CAP_NHAT: new Date(),
        },
        $push: { LICH_SU_TRANG_THAI: { from: current.TRANG_THAI, to: status, at: new Date(), actor, ...(status === 'Từ chối hoàn tiền/trả hàng' ? { reason: req.body.rejectReason.trim() } : {}) } },
      } as any,
      { session },
    );
    });
    invalidateAnalyticsCache(); // Dashboard lấy số mới ở lần xem tiếp theo
    const order = await getAdminOrderDetailById(orderId, res.locals?.adminEmployee?.VAI_TRO);
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
      const paymentSummary = summarizePayments(payment?.rows || [], Number(order.TONG_TIEN || 0), Number(order.TIEN_COC || 0));
      return {
        id: order.DON_HANG_ID,
        customer: order.KHACH_HANG_ID || '',
        date: formatDate(order.NGAY_TAO),
        total: `${Number(order.TONG_TIEN || 0).toLocaleString('vi-VN')}đ`,
        payment: paymentSummary.paymentStatus === 'PAID' ? 'Đã thanh toán' : paymentSummary.paymentStatus === 'PARTIALLY_PAID' ? 'Đã cọc' : 'Chờ thanh toán',
        status: normalizeOrderStatus(order.TRANG_THAI),
      };
    });
    return res.status(200).json({
      summary: {
        totalOrders: orders.length,
        newOrders: orders.filter((order) => ['Đã đặt hàng thành công', 'Chờ xử lý', 'Chờ thanh toán', 'Đã xác nhận đơn hàng'].includes(String(order.TRANG_THAI))).length,
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
    const campaigns = await (await getCollection<any>('CHIEN_DICH')).find({ DA_XOA: { $ne: true } }).sort({ CHIEN_DICH_ID: 1 }).toArray();
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
      { $set: { DA_XOA: true, KICH_HOAT: false, TRANG_THAI: 'Đã xóa', NGAY_CAP_NHAT: new Date() } },
    );
    if (!result.matchedCount) return res.status(404).json({ message: 'Không tìm thấy chiến dịch.' });
    return res.status(200).json({ message: 'Đã tạm dừng chiến dịch; dữ liệu voucher và đơn cũ được bảo toàn.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete campaign: ' + error.message });
  }
};

export const getAdminVouchers = async (_req: Request, res: Response) => {
  try {
    const vouchers = await (await getCollection<any>('VOUCHER')).find({ DA_XOA: { $ne: true } }).sort({ VOUCHER_ID: 1 }).toArray();
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
    const requestedCustomerIds: unknown[] = Array.isArray(body.customerIds)
      ? body.customerIds : body.customerId ? [body.customerId] : [];
    const customerIds = [...new Set<string>(requestedCustomerIds
      .map(value => String(value || '').trim()).filter(value => value.length > 0))];
    if (customerIds.length) {
      const existingCustomers = await (await getCollection<any>('KHACH_HANG')).find(
        { KHACH_HANG_ID: { $in: customerIds }, DA_XOA: { $nin: [true, 1] } },
        { projection: { KHACH_HANG_ID: 1 } },
      ).toArray();
      const existingIds = new Set(existingCustomers.map((customer: any) => String(customer.KHACH_HANG_ID)));
      const missingIds = customerIds.filter(customerId => !existingIds.has(customerId));
      if (missingIds.length) return res.status(400).json({ message: `Khách hàng nhận voucher không hợp lệ: ${missingIds.join(', ')}.` });
    }
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
    // Các voucher sinh cùng một lần có chung mã nhóm để Marketing tự lấy
    // đúng voucher cá nhân của từng khách khi gửi hàng loạt.
    const issuanceGroupId = `VGRP_${randomUUID()}`;
    const vouchers = recipients.map((customerId, index) => {
      const voucherId = `VC${String(firstNumber + index).padStart(4, '0')}`;
      return {
        _id: voucherId, VOUCHER_ID: voucherId, NHAN_VIEN_ID: employeeId,
        NHOM_PHAT_HANH_ID: issuanceGroupId, MA_VOUCHER_GOC: code,
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
    const personalVouchers = vouchers.filter(voucher => Boolean(voucher.KHACH_HANG_ID));
    if (personalVouchers.length) {
      const notificationCollection = await getCollection<any>('THONG_BAO');
      const createdAt = new Date();
      await notificationCollection.bulkWrite(personalVouchers.map(voucher => {
        const notificationId = `TB_VOUCHER_${voucher.VOUCHER_ID}`;
        const voucherName = String(voucher.MA_VOUCHER || '').trim();
        return {
          updateOne: {
            filter: { _id: notificationId },
            update: {
              $setOnInsert: {
                _id: notificationId,
                THONG_BAO_ID: notificationId,
                KHACH_HANG_ID: voucher.KHACH_HANG_ID,
                DON_HANG_ID: null,
                LOAI_THONG_BAO: 'promotion',
                TIEU_DE: `Bạn nhận được voucher ${voucherName}`,
                NOI_DUNG: `Voucher ${voucherName} đã được thêm vào Voucher của tôi. Bấm để xem voucher.`,
                HINH_ANH: null,
                DUONG_DAN: '/account/vouchers',
                KENH_THONG_BAO: 'CUSTOMER',
                DA_DOC: false,
                DA_XEM: false,
                NGAY_TAO: createdAt,
              },
            },
            upsert: true,
          },
        };
      }), { ordered: true });
    }
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
      { $set: { DA_XOA: true, KICH_HOAT: false, TRANG_THAI: 'Đã xóa', NGAY_CAP_NHAT: new Date() } },
    );
    if (!result.matchedCount) return res.status(404).json({ message: 'Không tìm thấy voucher.' });
    return res.status(200).json({ message: 'Đã tạm dừng voucher; lịch sử sử dụng được bảo toàn.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete voucher: ' + error.message });
  }
};

export const getAdminAfterSales = async (req: Request,res: Response) => {try{
  const orderId=String(req.query.orderId||'').trim(), status=String(req.query.status||'').trim(), type=String(req.query.type||'').trim();
  const assignedTo=String(req.query.assignedTo||'').trim(), search=String(req.query.search||'').trim().slice(0,100);
  const filter:any={}; if(orderId)filter.orderId=orderId;if(status)filter.status=status;if(type)filter.type=type;if(assignedTo)filter.assignedTo=assignedTo;
  if(search){const safe=escapeAfterSalesSearch(search);filter.$or=[{requestId:{$regex:safe,$options:'i'}},{orderId:{$regex:safe,$options:'i'}},{'requester.name':{$regex:safe,$options:'i'}}];}
  if(req.query.from||req.query.to){filter.requestedAt={};if(req.query.from)filter.requestedAt.$gte=new Date(String(req.query.from));if(req.query.to)filter.requestedAt.$lte=new Date(String(req.query.to));}
  const page=Math.max(1,Number(req.query.page)||1),limit=Math.max(1,Math.min(50,Number(req.query.limit)||20));const collection=await getCollection<any>(AFTER_SALES);
  const [rows,total,allForSummary]=await Promise.all([
    collection.find(filter).sort({updatedAt:-1}).skip((page-1)*limit).limit(orderId?50:limit).toArray(),
    collection.countDocuments(filter),
    collection.find(filter,{projection:{orderId:1,'decision.maxRefund':1,'refund.amount':1}}).toArray(),
  ]);
  // Số tiền theo từng hồ sơ: Đã thu (của đơn), Hạn mức duyệt, Đã hoàn, % đã hoàn / đã thu. Gom THANH_TOAN bằng 1 truy vấn.
  const orderIds=[...new Set(allForSummary.map((r:any)=>String(r.orderId||'')).filter(Boolean))];
  const receipts=orderIds.length?await (await getCollection<any>('THANH_TOAN')).find({DON_HANG_ID:{$in:orderIds}}).toArray():[];
  const paidByOrder=new Map<string,number>();
  for(const id of orderIds)paidByOrder.set(id,summarizePayments(receipts.filter((p:any)=>p.DON_HANG_ID===id)).successfulReceiptsTotal);
  const money=(r:any)=>{const paidAmount=paidByOrder.get(String(r.orderId))||0,approvedRefund=Number(r.decision?.maxRefund||0),refundedAmount=Number(r.refund?.amount||0);
    return {paidAmount,approvedRefund,refundedAmount,refundPercent:paidAmount>0?Math.round(refundedAmount/paidAmount*1000)/10:0};};
  const requests=rows.map((r:any)=>({...r,...money(r)}));
  const summary=allForSummary.reduce((acc:any,r:any)=>{const m=money(r);acc.totalApproved+=m.approvedRefund;acc.totalRefunded+=m.refundedAmount;return acc;},{count:allForSummary.length,totalApproved:0,totalRefunded:0});
  return res.json({requests,total,page,limit,summary});
}catch{return res.status(500).json({message:'Chưa đọc được danh sách hậu mãi.'});}};
export const changeAdminAfterSales = async (req: Request,res: Response) => {try{return res.json({request:await afterSalesChange(String(req.params.requestId),req.body,String(res.locals.adminEmployee?.NHAN_VIEN_ID||''),res.locals.adminEmployee?.VAI_TRO)});}catch(e:any){return res.status(e instanceof InventoryError?e.status:e.code===11000?409:500).json({message:e instanceof InventoryError?e.message:'Chưa xử lý được. Hãy tải lại hồ sơ.'});}};
