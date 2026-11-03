import { afterSalesRead, afterSalesCreate, afterSalesSupplement, orderEvent } from '../services/admin-order.service.js';
import { Request, Response } from 'express';
import { getCollection } from '../mongo.js';
import { writeCheckoutOrder, claimCheckoutBenefits } from '../services/checkout-order-writer.service.js';
import { routeCheckout, assertReservedStockUsable } from '../services/order-request.service.js';
import { InventoryError, withTransaction } from '../services/inventory/helpers.js';
import { INVENTORY_CONFIG, RESERVATION_STATUS } from '../services/inventory/constants.js';
import { syncCheckoutInventory, changeCheckoutPayment } from '../services/checkout-payment.service.js';
import { confirmReservations, releaseReservations, reserveProducts } from '../services/inventory/stock.service.js';
import { randomUUID } from 'node:crypto';
import { reserveOrderLines } from '../services/order-stock.service.js';
import { lookupAccess } from '../services/order-access.service.js';
import { priceCheckout, sumVerifiedPayments, validateCheckoutDelivery } from '../services/admin-order.service.js';
import { getActiveBom } from '../services/inventory/bom.service.js';
import { checkProductAvailability } from '../services/inventory/availability.service.js';

interface CreateOrderItem {
  id: string;
  qty: number;
  price: number;
  design?: any;
  lineKey?: string;
  variantId?: string | null;
  designId?: string | null;
  configuration?: any;
}

const CANCEL_REASONS = [
  'Tôi muốn thay đổi địa chỉ/thông tin người nhận hàng',
  'Tôi muốn thay đổi hình thức thanh toán',
  'Tôi muốn thay đổi sản phẩm (số lượng, mẫu mã,...)',
  'Tôi muốn thêm/thay đổi mã giảm giá',
  'Tôi không còn muốn mua sản phẩm nữa',
];

const RETURN_REFUND_REASONS = [
  'Hoa bị héo/dập/không còn tươi',
  'Hoa không đúng mẫu/thông điệp đã đặt',
  'Thiếu sản phẩm hoặc phụ kiện đi kèm',
  'Giao hàng trễ so với thời gian yêu cầu',
];

const PAYMENT_WINDOW_MINUTES = INVENTORY_CONFIG.holdMinutes;
const REWARD_POINTS_PER_UNIT = 1;
const REWARD_UNIT_VALUE = 500;

const normalizeReason = (value: unknown): string => String(value || '').trim();

const normalizeOrderStatusText = (status: unknown): string => String(status || '').trim().toLowerCase();

const normalizeRewardPoints = (value: unknown): number => {
  const rawPoints = Number(value || 0);
  if (!Number.isFinite(rawPoints)) return 0;
  const points = Math.floor(Math.max(0, rawPoints));
  return Math.floor(points / REWARD_POINTS_PER_UNIT) * REWARD_POINTS_PER_UNIT;
};

const normalizeMoney = (value: unknown): number => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.floor(amount));
};

const convertRewardPointsToMoney = (points: number): number => {
  return Math.floor(normalizeRewardPoints(points) / REWARD_POINTS_PER_UNIT) * REWARD_UNIT_VALUE;
};

const convertRewardMoneyToPoints = (amount: number): number => {
  return normalizeRewardPoints(Math.floor(normalizeMoney(amount) / REWARD_UNIT_VALUE) * REWARD_POINTS_PER_UNIT);
};

const isCompletedOrderStatus = (status: unknown): boolean => normalizeOrderStatusText(status).includes('hoàn thành');

const isDeliveredOrderStatus = (status: unknown): boolean => {
  const value = normalizeOrderStatusText(status);
  return value.includes('giao hàng thành công') || value.includes('giao thành công');
};

const toBit = (value: unknown): boolean => {
  return value === true || value === 1 || value === '1' || value === 'true';
};

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const toSqlDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00.000Z`);
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
};

const isSuccessStatus = (status: string): boolean => {
  const normalized = status.trim().toLowerCase();
  return ['thành công', 'thanh toán thành công', 'đã thanh toán', 'da thanh toan', 'đã cọc', 'da coc', 'success', 'paid']
    .includes(normalized);
};

const isFailedStatus = (status: string): boolean => {
  const normalized = status.trim().toLowerCase();
  return ['thất bại', 'thanh toán thất bại', 'that bai', 'failed', 'expired', 'hết hạn', 'het han']
    .includes(normalized);
};

const getOrderNumericPart = (orderId: string): string => {
  return orderId.replace(/^YEN/, '') || Date.now().toString().slice(-8);
};

const createPaymentId = (orderId: string, attempt = 1): string => {
  const numericPart = getOrderNumericPart(orderId);
  if (attempt <= 1) return `TT${numericPart}`.slice(0, 20);
  return `TT${numericPart}${attempt.toString().padStart(2, '0')}`.slice(0, 20);
};

const createTransactionCode = (orderId: string, attempt = 1): string => {
  const numericPart = getOrderNumericPart(orderId);
  if (attempt <= 1) return `GD${numericPart}`.slice(0, 100);
  return `GD${numericPart}${attempt.toString().padStart(2, '0')}`.slice(0, 100);
};

const createPaymentDeadline = (): string => {
  return new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60 * 1000).toISOString();
};

const getNextPaymentAttempt = async (orderId: string): Promise<number> => {
  const paymentCollection = await getCollection<any>('THANH_TOAN');
  return await paymentCollection.countDocuments({ DON_HANG_ID: orderId }) + 1;
};

const getLatestPayment = async (orderId: string) => {
  const paymentCollection = await getCollection<any>('THANH_TOAN');
  const payments = await paymentCollection.find({ DON_HANG_ID: orderId }).toArray();
  return payments.sort((left, right) => {
    const leftPending = String(left.TRANG_THAI_THANH_TOAN || '') === 'Chờ thanh toán' ? 0 : 1;
    const rightPending = String(right.TRANG_THAI_THANH_TOAN || '') === 'Chờ thanh toán' ? 0 : 1;
    if (leftPending !== rightPending) return leftPending - rightPending;
    const dateDiff = (toDate(right.NGAY_THANH_TOAN)?.getTime() || 0) - (toDate(left.NGAY_THANH_TOAN)?.getTime() || 0);
    if (dateDiff !== 0) return dateDiff;
    return String(right.THANH_TOAN_ID || '').localeCompare(String(left.THANH_TOAN_ID || ''), 'vi');
  })[0] || null;
};

const getRemainingSeconds = (order: any, payment: any): number => {
  const start = toDate(payment?.NGAY_THANH_TOAN) || toDate(order?.NGAY_TAO) || new Date();
  const deadline = start.getTime() + PAYMENT_WINDOW_MINUTES * 60 * 1000;
  return Math.max(0, Math.floor((deadline - Date.now()) / 1000));
};

const isVoucherDateActive = (voucher: any): boolean => {
  const today = new Date();
  const start = toDate(voucher.NGAY_BAT_DAU);
  const end = toDate(voucher.NGAY_KET_THUC);
  return (!start || today >= start) && (!end || today <= end);
};

const resolveVoucherForOrder = async (voucher: any, customerId: string | null) => {
  if (!voucher?.id && !voucher?.code) {
    return null;
  }

  const voucherCollection = await getCollection<any>('VOUCHER');
  const voucherId = String(voucher?.id || '').trim();
  const voucherCode = String(voucher?.code || '').trim().toUpperCase();
  const candidates = await voucherCollection.find({
    DA_DUNG: { $ne: true },
    $or: [
      ...(voucherId ? [{ VOUCHER_ID: voucherId }] : []),
      ...(voucherCode ? [{ MA_VOUCHER: { $regex: `^${voucherCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }] : []),
    ],
  }).toArray();

  const available = candidates
    .filter((item) => {
      const belongsToCustomer = customerId
        ? item.KHACH_HANG_ID === customerId || item.KHACH_HANG_ID == null
        : item.KHACH_HANG_ID == null;
      return belongsToCustomer && isVoucherDateActive(item);
    })
    .sort((left, right) => {
      const leftSpecific = customerId && left.KHACH_HANG_ID === customerId ? 0 : 1;
      const rightSpecific = customerId && right.KHACH_HANG_ID === customerId ? 0 : 1;
      if (leftSpecific !== rightSpecific) return leftSpecific - rightSpecific;
      return (toDate(left.NGAY_KET_THUC)?.getTime() || 0) - (toDate(right.NGAY_KET_THUC)?.getTime() || 0);
    });

  return available[0] || null;
};

const removePaidItemsFromCart = async (orderId: string, customerId: string): Promise<void> => {
  if (!customerId) return;

  const [cartCollection, cartDetailCollection, orderDetailCollection] = await Promise.all([
    getCollection<any>('GIO_HANG'),
    getCollection<any>('GIO_HANG_CHI_TIET'),
    getCollection<any>('DON_HANG_CHI_TIET'),
  ]);
  const carts = await cartCollection.find({ KHACH_HANG_ID: customerId }).toArray();
  const cartIds = carts.map((cart) => cart.GIO_HANG_ID).filter(Boolean);
  const orderDetails = await orderDetailCollection.find({ DON_HANG_ID: orderId }).toArray();
  const productIds = orderDetails.map((item) => item.SAN_PHAM_ID).filter(Boolean);

  if (cartIds.length > 0 && productIds.length > 0) {
    await cartDetailCollection.deleteMany({ GIO_HANG_ID: { $in: cartIds }, SAN_PHAM_ID: { $in: productIds } });
  }
};

const finalizeSuccessfulPayment = async (orderId: string): Promise<void> => {
  const orderCollection = await getCollection<any>('DON_HANG');
  const current = await orderCollection.findOne({ DON_HANG_ID: orderId });
  if (current?.KIEM_TRA_TON_KHO && !current.KHONG_GIU_TAM_NVL && ['Chờ thanh toán', 'Thanh toán thất bại', 'Chờ xử lý'].includes(current.TRANG_THAI)) {
    await confirmReservations(current.MA_PHIEN_THANH_TOAN ? { paymentSessionId: current.MA_PHIEN_THANH_TOAN } : { orderId }, orderId, { id: 'PAYMENT', role: 'system' });
  }
  const order = await orderCollection.findOneAndUpdate(
    { DON_HANG_ID: orderId, TRANG_THAI: { $in: ['Chờ thanh toán', 'Thanh toán thất bại', 'Chờ xử lý', 'Đã đặt hàng thành công'] } },
    { $set: { TRANG_THAI: 'Đã đặt hàng thành công', NGAY_CAP_NHAT: new Date() } },
    { returnDocument: 'after' },
  );

  if (order) {
    await synchronizeLuckyOrder(orderId);
    await removePaidItemsFromCart(orderId, String(order.KHACH_HANG_ID || ''));
  }
};

const markPaymentFailed = async (orderId: string): Promise<void> => {
  await withTransaction(async session => {
  const [orderCollection, paymentCollection] = await Promise.all([
    getCollection<any>('DON_HANG'),
    getCollection<any>('THANH_TOAN'),
  ]);
  const paid = await paymentCollection.findOne({ DON_HANG_ID: orderId, TRANG_THAI_THANH_TOAN: { $in: ['Thành công', 'Thanh toán thành công', 'Đã thanh toán', 'Đã cọc'] } }, { session });
  if (paid) return;
  await syncCheckoutInventory(session, orderId, false);
  await paymentCollection.updateMany(
    {
      DON_HANG_ID: orderId,
      TRANG_THAI_THANH_TOAN: { $nin: ['Thành công', 'Thanh toán thành công', 'Đã thanh toán', 'Đã cọc'] },
    },
    { $set: { TRANG_THAI_THANH_TOAN: 'Thất bại' } },
    { session },
  );
  await orderCollection.updateOne(
    { DON_HANG_ID: orderId, TRANG_THAI: { $in: ['Chờ thanh toán', 'Thanh toán thất bại'] } },
    { $set: { TRANG_THAI: 'Thanh toán thất bại' } },
    { session },
  );
  await syncLuckyOrder(session,orderId);
  });
};

export const getPublicVouchers = async (_req: Request, res: Response) => {
  try {
    const voucherCollection = await getCollection<any>('VOUCHER');
    const vouchers = (await voucherCollection.find({
      $or: [{ KHACH_HANG_ID: null }, { KHACH_HANG_ID: { $exists: false } }],
    }).toArray())
      .filter(item => derivePromotionStatus(item) === 'Đang diễn ra')
      .filter(item => /guest|tất cả|tat ca/i.test(String(item.DOI_TUONG || 'Tất cả')))
      .sort((left, right) => String(left.MA_VOUCHER || '').localeCompare(String(right.MA_VOUCHER || ''), 'vi'));

    return res.status(200).json({
      total: vouchers.length,
      vouchers,
    });
  } catch (error: any) {
    console.error('Lỗi lấy voucher công khai:', error);
    return res.status(500).json({ message: 'Không thể lấy voucher công khai: ' + error.message });
  }
};

export const quoteOrder = async (req: Request, res: Response) => {
  try {
    const customerId = req.body.customerId ? String(req.body.customerId) : null;
    if (customerId) {
      const access = await lookupAccess(req.headers?.['x-order-access']);
      if (access.authType !== 'member' || access.customerId !== customerId) throw new InventoryError(403, 'Bạn chỉ được báo giá cho tài khoản đang đăng nhập.');
    }
    const priced = await priceCheckout({ ...req.body, customerId, adminNote: '' });
    const availability = await Promise.all(priced.items.map((item: any) =>
      checkProductAvailability(item.id, item.qty, priced.delivery.deliveryAt)));
    const requiresSales = availability.some((item: any) => item.decision !== 'available');
    return res.json({ items: priced.items, summary: priced.summary, payment: priced.payment,
      availability, requiresSales,
      routing: availability.find((item: any) => item.routing?.requiresSales)?.routing || availability[0]?.routing || null,
      message: requiresSales
        ? 'Shop cần kiểm tra khả năng đáp ứng trước khi xác nhận. Bạn chưa cần thanh toán.'
        : 'Báo giá chưa giữ hàng. Hệ thống kiểm tra và giữ tồn khi bạn đặt hàng.' });
  } catch (error: any) {
    return res.status(error instanceof InventoryError ? error.status : 500).json({ message: error instanceof InventoryError ? error.message : 'Không thể báo giá lúc này.' });
  }
};

export const createOrder = async (req: Request, res: Response) => {
  try {
    const { customerId, receiver, sender, delivery, items, voucher, summary, payment, flags } = req.body;
    const normalizedCustomerId = customerId ? String(customerId) : null;
    if (normalizedCustomerId && !res.locals.adminCheckout) {
      const access = await lookupAccess(req.headers?.['x-order-access']);
      if (access.authType !== 'member' || access.customerId !== normalizedCustomerId) throw new InventoryError(403, 'Bạn chỉ được đặt hàng cho tài khoản đang đăng nhập.');
    }

    if (!String(receiver?.name || '').trim() || !/^\+?\d[\d\s.-]{7,19}$/.test(String(receiver?.phone || '')) || !String(receiver?.address || '').trim()) {
      return res.status(400).json({ message: 'Thiếu thông tin người nhận.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Đơn hàng chưa có sản phẩm.' });
    }
    if (!String(sender?.name || '').trim() || !/^\+?\d[\d\s.-]{7,19}$/.test(String(sender?.phone || ''))) {
      return res.status(400).json({ message: 'Cần tên và số điện thoại người đặt để Sales liên hệ khi thiếu hàng.' });
    }

    const paymentMethod = String(payment?.method || '').trim();
    if (paymentMethod === 'card') {
      return res.status(400).json({
        message: 'Hiện tại shop chưa hỗ trợ hình thức thanh toán thẻ ngân hàng.',
      });
    }

    const productItems: CreateOrderItem[] = [];
    for (const rawItem of items) {
      const quantity = Number(rawItem.qty ?? rawItem.quantity ?? rawItem.SO_LUONG ?? 1);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) {
        return res.status(400).json({ message: 'Số lượng sản phẩm phải là số nguyên từ 1–1000.' });
      }
      const item: CreateOrderItem = {
        id: String(rawItem.id || rawItem.SAN_PHAM_ID || ''),
        qty: quantity,
        price: Math.max(0, Number(rawItem.price || rawItem.GIA || 0)),
        lineKey: String(rawItem.lineKey || rawItem.LINE_KEY || ''),
        variantId: rawItem.variantId || rawItem.BIEN_THE_ID || null,
        designId: rawItem.designId || rawItem.THIET_KE_ID || null,
        configuration: rawItem.configuration || rawItem.CAU_HINH || {},
      };
      if(isDesignProduct(item.id)) {
        item.design=await getDesign(item.id);
        if(!item.design.requiresReview && item.price!==item.design.price)throw new InventoryError(409,'Giá thiết kế đã thay đổi. Tải lại giỏ hàng để xem giá mới.');
        item.price=item.design.price;
      }
      if (!item.id.startsWith('SP')) return res.status(400).json({ message: 'Mã sản phẩm không hợp lệ.' });

      productItems.push(item);
    }

    if (productItems.length === 0) {
      return res.status(400).json({
        message: 'DON_HANG_CHI_TIET chỉ lưu được sản phẩm có SAN_PHAM_ID.',
      });
    }

    const outcome = await routeCheckout(String(req.body.checkoutSessionId || ''), req.body,
      productItems.map(item => ({ productId: item.id, quantity: item.qty })), async (session, orderId, priced) => {
      return writeCheckoutOrder(session, orderId, priced, { voucher: priced.validatedVoucher, loyaltyPoints: priced.summary.loyaltyPoints });
    }, async session => {
      const priced = await priceCheckout({ ...req.body, items: productItems, adminNote: res.locals.adminCheckout ? String(req.body.adminNote || '') : '' }, session);
      // The browser summary is informational only. Backend pricing above is the
      // sole source of truth and is returned with the outcome, so checkout does
      // not need a second confirmation/request merely because cached cart data
      // differs from the current catalog.
      return priced;
    });
    return res.status(201).json(outcome);
  } catch (error: any) {
    console.error('Lỗi tạo đơn hàng:', error);
    if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message });
    return res.status(500).json({ message: 'Không thể tạo đơn hàng: ' + error.message });
  }
};

export const getCardTemplates = async (_req: Request, res: Response) => {
  try {
    const rows = await (await getCollection<any>('CARD_TEMPLATE')).find({ TRANG_THAI: { $in: ['active', 'Đang dùng', 'Hoạt động'] } }, { projection: { _id: 0 } }).sort({ THU_TU: 1, TEN_THIEP: 1 }).toArray();
    return res.json({ templates: rows.map((row: any) => ({ id: row.CARD_TEMPLATE_ID, code: row.MA_THIEP, name: row.TEN_THIEP, theme: row.CHU_DE, type: row.LOAI, image: row.HINH_ANH, fee: Number(row.PHU_PHI || 0) })) });
  } catch {
    return res.status(500).json({ message: 'Chưa tải được danh sách thiệp.' });
  }
};

export const getOrderPaymentStatus = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const orderCollection = await getCollection<any>('DON_HANG');
    const order = await orderCollection.findOne({ DON_HANG_ID: orderId });

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const payment = await getLatestPayment(orderId);
    const paymentStatus = String(payment?.TRANG_THAI_THANH_TOAN || 'Chờ thanh toán');
    const receipts = await (await getCollection<any>('THANH_TOAN')).find({ DON_HANG_ID: orderId }).toArray();
    const paidAmount = Math.max(0, sumVerifiedPayments(receipts));
    if (order.KHONG_YEU_CAU_COC || Number(order.TONG_TIEN) === 0) {
      return res.json({ orderId, requiresPayment: false, paymentStatus: paidAmount >= Number(order.TONG_TIEN) && paidAmount > 0 ? 'Thành công' : Number(order.TONG_TIEN) === 0 ? 'Không phát sinh thu tiền' : 'Chưa thanh toán',
        orderStatus: order.TRANG_THAI, paymentAmount: 0, paidAmount, remainingBalance: Math.max(0, Number(order.TONG_TIEN) - paidAmount), remainingSeconds: 0,
        summary: order.TINH_TIEN_SNAPSHOT });
    }
    const required = /cod/i.test(String(order.PHUONG_THUC_THANH_TOAN)) ? Number(order.TIEN_COC || 0) : Number(order.TONG_TIEN || 0);
    const obligationPaid = required > 0 ? paidAmount >= required : isSuccessStatus(paymentStatus);
    let orderStatus = String(order.TRANG_THAI || 'Chờ thanh toán');
    let remainingSeconds = getRemainingSeconds(order, payment);

    if (obligationPaid) {
      await finalizeSuccessfulPayment(orderId);
      orderStatus = String((await orderCollection.findOne({ DON_HANG_ID: orderId }))?.TRANG_THAI || order.TRANG_THAI);
      remainingSeconds = 0;
    } else if (isFailedStatus(paymentStatus) || remainingSeconds <= 0) {
      await markPaymentFailed(orderId);
      orderStatus = 'Thanh toán thất bại';
      remainingSeconds = 0;
    }

    return res.status(200).json({
      orderId,
      requiresPayment: true,
      summary: order.TINH_TIEN_SNAPSHOT,
      paymentId: payment?.THANH_TOAN_ID,
      transactionCode: payment?.MA_GIAO_DICH,
      paymentAmount: Number(payment?.SO_TIEN || 0),
      paidAmount,
      remainingBalance: Math.max(0, Number(order.TONG_TIEN || 0) - paidAmount),
      paymentStatus: obligationPaid
        ? 'Thành công'
        : orderStatus === 'Thanh toán thất bại'
          ? 'Thất bại'
          : paymentStatus,
      orderStatus,
      remainingSeconds,
    });
  } catch (error: any) {
    console.error('Lỗi kiểm tra thanh toán:', error);
    return res.status(500).json({ message: 'Không thể kiểm tra thanh toán: ' + error.message });
  }
};

export const expireOrderPayment = async (req: Request, res: Response) => {
  try {
    const order = await (await getCollection<any>('DON_HANG')).findOne({ DON_HANG_ID: req.params.orderId });
    if (!order) throw new InventoryError(404, 'Không tìm thấy đơn hàng.');
    const payment = await getLatestPayment(String(req.params.orderId));
    if (order.KHONG_YEU_CAU_COC || isSuccessStatus(String(payment?.TRANG_THAI_THANH_TOAN || ''))) return getOrderPaymentStatus(req, res);
    if (getRemainingSeconds(order, payment) > 0) throw new InventoryError(409, 'Phiên chưa hết hạn; hãy kiểm tra lại trạng thái thanh toán.');
    await markPaymentFailed(String(req.params.orderId));
    return getOrderPaymentStatus(req, res);
  } catch (e: any) { return res.status(e instanceof InventoryError ? e.status : 500).json({ message: e instanceof InventoryError ? e.message : 'Chưa xác định được trạng thái. Vui lòng kiểm tra lại.' }); }
};

export const retryOrderPayment = async (req: Request, res: Response) => {
  try {
    const orderId = String(req.params.orderId);
    const result = await withTransaction(async session => {
      const orders = await getCollection<any>('DON_HANG'), payments = await getCollection<any>('THANH_TOAN');
      const order = await orders.findOne({ DON_HANG_ID: orderId }, { session });
      if (!order) throw new InventoryError(404, 'Không tìm thấy đơn hàng.');
      if (order.KHONG_YEU_CAU_COC) throw new InventoryError(409, 'Đơn không cần thanh toán trước. Vui lòng theo dõi đơn.');
      const rows = await payments.find({ DON_HANG_ID: orderId }, { session }).sort({ NGAY_THANH_TOAN: -1, THANH_TOAN_ID: -1 }).toArray();
      const cod = /cod/i.test(String(order.PHUONG_THUC_THANH_TOAN));
      const amount = cod ? Number(order.TIEN_COC) : Number(order.TONG_TIEN);
      const paid = sumVerifiedPayments(rows);
      const response = (p: any) => ({ orderId, paymentId: p.THANH_TOAN_ID, transactionCode: p.MA_GIAO_DICH, paymentAmount: p.SO_TIEN,
        paymentStatus: p.TRANG_THAI_THANH_TOAN, orderStatus: paid >= amount ? order.TRANG_THAI : 'Chờ thanh toán', requiresPayment: paid < amount,
        paymentDeadline: new Date(new Date(p.NGAY_THANH_TOAN).getTime() + PAYMENT_WINDOW_MINUTES * 60000).toISOString(), paymentWindowSeconds: PAYMENT_WINDOW_MINUTES * 60 });
      if (paid >= amount && rows.some(p => isSuccessStatus(p.TRANG_THAI_THANH_TOAN))) return response(rows.find(p => isSuccessStatus(p.TRANG_THAI_THANH_TOAN)));
      if (!['Chờ thanh toán', 'Thanh toán thất bại'].includes(order.TRANG_THAI)) throw new InventoryError(409, 'Trạng thái đơn không cho phép thanh toán lại.');
      const pending = rows.find(p => p.TRANG_THAI_THANH_TOAN === 'Chờ thanh toán');
      const holds = await (await getCollection<any>('GIU_TON')).find({ DON_HANG_ID: orderId, MA_PHIEN_THANH_TOAN: order.MA_PHIEN_THANH_TOAN }, { session }).toArray();
      if (pending && getRemainingSeconds(order, pending) > 0 && holds.length && holds.every(h => h.TRANG_THAI === RESERVATION_STATUS.official || h.TRANG_THAI === RESERVATION_STATUS.temporary && new Date(h.HET_HAN_LUC).getTime() > Date.now())) return response(pending);
      const date = order.NGAY_MUON_GIAO instanceof Date ? order.NGAY_MUON_GIAO.toISOString().slice(0, 10) : String(order.NGAY_MUON_GIAO || '').slice(0, 10);
      validateCheckoutDelivery({ date, time: order.KHUNG_GIO_MUON_GIAO });
      await orders.updateOne({ DON_HANG_ID: orderId }, { $inc: { PHIEN_BAN_THANH_TOAN: 1 } }, { session });
      const links = await (await getCollection<any>('DON_HANG_VOUCHER')).find({ DON_HANG_ID: orderId }, { session }).toArray();
      const voucher = links.length ? await (await getCollection<any>('VOUCHER')).findOne({ VOUCHER_ID: links[0].VOUCHER_ID }, { session }) : null;
      if (links.length && (!voucher || !isVoucherDateActive(voucher))) throw new InventoryError(409, 'Voucher không còn hợp lệ; cần shop tư vấn lại.');
      await claimCheckoutBenefits(session, orderId, { customerId: order.KHACH_HANG_ID }, { voucher, loyaltyPoints: order.DIEM_THUONG_SU_DUNG || 0 });
      const sessionId = randomUUID();
      await releaseReservations({ orderId }, { id: 'PAYMENT', role: 'system' }, 'Tạo lại phiên đã hết hạn', session);
      const details = await (await getCollection<any>('DON_HANG_CHI_TIET')).find({ DON_HANG_ID: orderId }, { session }).toArray();
      for (const line of details) {
        if (!line.SAN_PHAM_TUY_CHINH && line.BOM_SNAPSHOT?.lines) {
          const current = await getActiveBom(line.SAN_PHAM_ID, session);
          const normalize = (lines: any[]) => JSON.stringify([...lines].sort((a, b) => String(a.NGUYEN_VAT_LIEU_ID).localeCompare(String(b.NGUYEN_VAT_LIEU_ID))));
          if (normalize(current.lines) !== normalize(line.BOM_SNAPSHOT.lines) || (current.bom?.PHIEN_BAN || null) !== line.BOM_SNAPSHOT.version) {
            throw new InventoryError(409, 'Công thức mẫu đã thay đổi. Cần shop tư vấn và khách xác nhận lại trước khi thanh toán.');
          }
        }
      }
      await reserveOrderLines(session, details.map(i => ({ id: i.SAN_PHAM_ID, qty: i.SO_LUONG, custom: i.SAN_PHAM_TUY_CHINH, bom: i.BOM_SNAPSHOT })), {
        orderId, paymentSessionId: sessionId, status: RESERVATION_STATUS.temporary, actor: { id: order.KHACH_HANG_ID || null, role: 'customer' },
      });
      await assertReservedStockUsable(session, orderId, validateCheckoutDelivery({ date, time: order.KHUNG_GIO_MUON_GIAO }).deliveryAt, !!order.YEU_CAU_DAT_HANG_ID);
      await payments.updateMany({ DON_HANG_ID: orderId, TRANG_THAI_THANH_TOAN: 'Chờ thanh toán' }, { $set: { TRANG_THAI_THANH_TOAN: 'Thất bại' } }, { session });
      const p = { _id: `TT${randomUUID().replaceAll('-', '').slice(0, 18)}`, THANH_TOAN_ID: '', DON_HANG_ID: orderId,
        MA_GIAO_DICH: `GD${randomUUID().replaceAll('-', '')}`, SO_TIEN: amount, CONG_THANH_TOAN: order.PHUONG_THUC_THANH_TOAN, TRANG_THAI_THANH_TOAN: 'Chờ thanh toán', NGAY_THANH_TOAN: new Date() };
      p.THANH_TOAN_ID = p._id;
      await payments.insertOne(p, { session });
      await orders.updateOne({ DON_HANG_ID: orderId }, { $set: { MA_PHIEN_THANH_TOAN: sessionId, TRANG_THAI: 'Chờ thanh toán' } }, { session });
      return response(p);
    });
    return res.json({ ...result, message: 'Đã kiểm tra và trả về phiên thanh toán hiện hành.' });
  } catch (e: any) { return res.status(e instanceof InventoryError ? e.status : 500).json({ message: e instanceof InventoryError ? e.message : 'Chưa tạo được phiên. Hãy kiểm tra lại trạng thái trước khi thử tiếp.' }); }
};

export const markOrderPaymentSuccess = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const paymentCollection = await getCollection<any>('THANH_TOAN');
    const payment = await getLatestPayment(orderId);

    if (!payment) {
      return res.status(404).json({ message: 'Không tìm thấy thanh toán.' });
    }

    await withTransaction(session => changeCheckoutPayment(session, payment.THANH_TOAN_ID,
      { status: 'Thành công', amount: req.body?.amount, referenceCode: req.body?.referenceCode },
      String(res.locals?.adminEmployee?.NHAN_VIEN_ID || '')));
    await finalizeSuccessfulPayment(orderId);

    return res.status(200).json({
      message: 'Thanh toán thành công, đơn hàng đã được đặt thành công.',
      orderId,
      orderStatus: 'Đã đặt hàng thành công',
      paymentStatus: 'Thành công',
      remainingSeconds: 0,
    });
  } catch (error: any) {
    console.error('Lỗi xác nhận thanh toán thành công:', error);
    if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message });
    return res.status(500).json({ message: 'Không thể xác nhận thanh toán: ' + error.message });
  }
};

export const getOrderDetail = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const phone = String(req.query.phone || '').replace(/\D/g, '');

    if (!orderId) {
      return res.status(400).json({ message: 'Thiếu mã đơn hàng.' });
    }

    const [orderCollection, customerCollection, detailCollection, productCollection, imageCollection, reviewCollection] = await Promise.all([
      getCollection<any>('DON_HANG'),
      getCollection<any>('KHACH_HANG'),
      getCollection<any>('DON_HANG_CHI_TIET'),
      getCollection<any>('SAN_PHAM'),
      getCollection<any>('HINH_ANH_SAN_PHAM'),
      getCollection<any>('DANH_GIA'),
    ]);
    const order = await orderCollection.findOne({ DON_HANG_ID: orderId });

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng hoặc số điện thoại không khớp.' });
    }

    const customer = order.KHACH_HANG_ID ? await customerCollection.findOne({ KHACH_HANG_ID: order.KHACH_HANG_ID }) : null;
    const receiverPhone = String(order.SDT_NGUOI_NHAN || '').replace(/\D/g, '');
    const customerPhone = String(customer?.SDT || '').replace(/\D/g, '');

    if (phone && phone !== receiverPhone && phone !== customerPhone) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng hoặc số điện thoại không khớp.' });
    }

    const payment = await getLatestPayment(orderId);
    const receipts = await (await getCollection<any>('THANH_TOAN')).find({DON_HANG_ID:orderId}).toArray();
    const paid = Math.max(0,sumVerifiedPayments(receipts));
    const hasReview = await reviewCollection.findOne({ DON_HANG_ID: orderId }, { projection: { DANH_GIA_ID: 1 } });
    const publicOrder = Object.fromEntries(Object.entries(order).filter(([key]) => [
      'DON_HANG_ID','KHACH_HANG_ID','NGAY_TAO','TRANG_THAI','TAM_TINH','PHI_VAN_CHUYEN','TIEN_COC','TONG_TIEN','PHUONG_THUC_THANH_TOAN',
      'NGAY_MUON_GIAO','KHUNG_GIO_MUON_GIAO','LOI_NHAN_THIEP','AN_THONG_TIN','YEU_CAU_VAT','GUI_ANH_QUA_ZALO','TEN_NGUOI_NHAN',
      'TEN_NGUOI_DAT','SDT_NGUOI_DAT','EMAIL_NGUOI_DAT','TINH_TIEN_SNAPSHOT','LICH_SU_TRANG_THAI','THOI_DIEM_BAT_DAU_CHUAN_BI','KHONG_YEU_CAU_COC','SDT_NGUOI_NHAN','DIA_CHI_GIAO_HANG','DA_CHINH_SUA_GIAO_HANG','LY_DO_HUY','LY_DO_HOAN_TIEN_TRA_HANG','LY_DO_TU_CHOI',
      'THIEP_TANG','MEDIA_BAN_GIAO','YEU_CAU_DAT_HANG_ID','THOI_DIEM_BAT_DAU_THUC_TE','NHAN_VIEN_GIAO_HANG',
    ].includes(key)));
    if(order.AN_THONG_TIN){delete publicOrder.TEN_NGUOI_DAT;delete publicOrder.SDT_NGUOI_DAT;delete publicOrder.EMAIL_NGUOI_DAT;}
    const enrichedOrder: Record<string, any> = {
      ...publicOrder,
      GHI_CHU: String(order.GHI_CHU || '').split(' | ')[0],
      DA_DANH_GIA: hasReview ? 1 : 0,
      TEN_KHACH_HANG: order.AN_THONG_TIN ? null : order.TEN_NGUOI_DAT || customer?.TEN || null,
      SDT_KHACH_HANG: order.AN_THONG_TIN ? null : order.SDT_NGUOI_DAT || customer?.SDT || null,
      EMAIL: order.AN_THONG_TIN ? null : order.EMAIL_NGUOI_DAT || customer?.EMAIL || null,
      THANH_TOAN_ID: payment?.THANH_TOAN_ID || null,
      CONG_THANH_TOAN: payment?.CONG_THANH_TOAN || null,
      MA_GIAO_DICH: payment?.MA_GIAO_DICH || null,
      SO_TIEN_THANH_TOAN: payment?.SO_TIEN || null,
      TRANG_THAI_THANH_TOAN: payment?.TRANG_THAI_THANH_TOAN || null,
      NGAY_THANH_TOAN: payment?.NGAY_THANH_TOAN || null,
    };
    const details = await detailCollection.find({ DON_HANG_ID: orderId }).sort({ SAN_PHAM_ID: 1 }).toArray();
    const productIds = details.map((item) => item.SAN_PHAM_ID).filter(Boolean);
    const [products, images] = await Promise.all([
      productCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
      imageCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
    ]);
    const productMap = new Map(products.map((product) => [product.SAN_PHAM_ID, product]));
    const imageMap = new Map<string, any>();

    for (const image of images.sort((left, right) => {
      if (Boolean(left.LA_ANH_CHINH) !== Boolean(right.LA_ANH_CHINH)) {
        return Boolean(left.LA_ANH_CHINH) ? -1 : 1;
      }
      return String(left.HINH_ANH_ID || '').localeCompare(String(right.HINH_ANH_ID || ''), 'vi');
    })) {
      if (!imageMap.has(image.SAN_PHAM_ID)) {
        imageMap.set(image.SAN_PHAM_ID, image);
      }
    }

    const productsResponse = details.map((detail) => {
      const product = productMap.get(detail.SAN_PHAM_ID);
      const image = imageMap.get(detail.SAN_PHAM_ID);
      return {
        SAN_PHAM_ID: detail.SAN_PHAM_ID,
        SO_LUONG: detail.SO_LUONG,
        GIA: detail.GIA,
        TEN_SAN_PHAM: detail.TEN_SAN_PHAM_SNAPSHOT || product?.TEN_SAN_PHAM || null,
        KIEU_DANG: product?.KIEU_DANG || null,
        TRANG_THAI_SAN_PHAM: product?.TRANG_THAI || null,
        HINH_ANH: detail.HINH_ANH_SNAPSHOT || image?.URL || null,
      };
    });

    const [orderVoucherCollection, voucherCollection] = await Promise.all([
      getCollection<any>('DON_HANG_VOUCHER'),
      getCollection<any>('VOUCHER'),
    ]);
    const orderVouchers = await orderVoucherCollection.find({ DON_HANG_ID: orderId }).toArray();
    const voucherIds = orderVouchers.map((item) => item.VOUCHER_ID).filter(Boolean);
    const vouchers = await voucherCollection.find({ VOUCHER_ID: { $in: voucherIds } }).toArray();
    const voucherMap = new Map(vouchers.map((item) => [item.VOUCHER_ID, item]));
    const vouchersResponse = orderVouchers.map((item) => {
      const voucherItem = item.UU_DAI_SNAPSHOT || voucherMap.get(item.VOUCHER_ID);
      return {
        VOUCHER_ID: item.VOUCHER_ID,
        MO_TA: item.MO_TA,
        MA_VOUCHER: voucherItem?.MA_VOUCHER || null,
        LOAI_GIAM_GIA: voucherItem?.LOAI_GIAM_GIA || null,
        GIA_TRI_GIAM: voucherItem?.GIA_TRI_GIAM || null,
      };
    });

    return res.status(200).json({
      order: enrichedOrder,
      products: productsResponse,
      vouchers: vouchersResponse,
      payment: {
        THANH_TOAN_ID: enrichedOrder.THANH_TOAN_ID,
        CONG_THANH_TOAN: enrichedOrder.CONG_THANH_TOAN,
        MA_GIAO_DICH: enrichedOrder.MA_GIAO_DICH,
        SO_TIEN: enrichedOrder.SO_TIEN_THANH_TOAN,
        TRANG_THAI_THANH_TOAN: enrichedOrder.TRANG_THAI_THANH_TOAN,
        NGAY_THANH_TOAN: enrichedOrder.NGAY_THANH_TOAN,
      },
      summary: {
        TAM_TINH: enrichedOrder.TAM_TINH,
        PHI_VAN_CHUYEN: enrichedOrder.PHI_VAN_CHUYEN,
        TIEN_COC: enrichedOrder.TIEN_COC,
        DA_THU: paid,
        DA_HOAN: receipts.filter(item => isSuccessStatus(String(item.TRANG_THAI_THANH_TOAN || '')) && item.LOAI_GIAO_DICH === 'HOAN_TIEN').reduce((sum, item) => sum + Math.max(0, Number(item.SO_TIEN || 0)), 0),
        CON_LAI: Math.max(0,Number(order.TONG_TIEN)-paid),
        TONG_TIEN: enrichedOrder.TONG_TIEN,
        GIAM_GIA: Math.max(
          0,
          Number(enrichedOrder.TAM_TINH || 0) + Number(enrichedOrder.PHI_VAN_CHUYEN || 0) - Number(enrichedOrder.TONG_TIEN || 0),
        ),
      },
    });
  } catch (error: any) {
    console.error('Lỗi lấy chi tiết đơn hàng:', error);
    return res.status(500).json({ message: 'Không thể lấy chi tiết đơn hàng: ' + error.message });
  }
};

export const cancelOrder = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const reason = normalizeReason(req.body?.reason);

    if (!reason) {
      return res.status(400).json({ message: 'Vui lòng chọn lý do hủy đơn hàng.' });
    }

    if (!CANCEL_REASONS.includes(reason)) {
      return res.status(400).json({ message: 'Lý do hủy đơn hàng không hợp lệ.' });
    }

    const orderCollection = await getCollection<any>('DON_HANG');
    const order = await orderCollection.findOne({ DON_HANG_ID: orderId });

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    if (!['Đã đặt hàng thành công', 'Chờ xử lý'].includes(String(order.TRANG_THAI || ''))) {
      return res.status(400).json({ message: 'Chỉ hủy trực tiếp trước khi shop bắt đầu chuẩn bị.' });
    }

    let refundRequired = false;
    await withTransaction(async session => {
    const fresh = await orderCollection.findOne({ DON_HANG_ID: orderId }, { session });
    if (fresh?.THOI_DIEM_BAT_DAU_THUC_TE) throw new InventoryError(409,'Đã bắt đầu chuẩn bị; cần liên hệ shop theo chính sách hủy.');
    const lines = await (await getCollection<any>('DON_HANG_CHI_TIET')).find({DON_HANG_ID:orderId},{session}).toArray();
    const payments = await (await getCollection<any>('THANH_TOAN')).find({ DON_HANG_ID: orderId }, { session }).toArray();
    const paidAmount = sumVerifiedPayments(payments);
    refundRequired = paidAmount > 0;
    if(fresh.PHUONG_AN_SNAPSHOT || lines.some(l=>l.SAN_PHAM_TUY_CHINH || /cưới|sự kiện/i.test(String(l.TEN_SAN_PHAM_SNAPSHOT||''))) || lines.reduce((n,l)=>n+Number(l.SO_LUONG||0),0)>=10) throw new InventoryError(409,'Đơn theo yêu cầu hoặc số lượng lớn cần shop kiểm tra chính sách hủy.');
    if (!['Đã đặt hàng thành công', 'Chờ xử lý'].includes(String(fresh?.TRANG_THAI))) throw new InventoryError(409, 'Đơn vừa thay đổi trạng thái.');
    await orderEvent(session,String(orderId)+':cancelled',fresh.KHACH_HANG_ID||null,String(orderId),'Đơn đã hủy','Đơn đã hủy; khoản đã thu cần đối soát theo hồ sơ hậu mãi riêng.');
    if (fresh.KIEM_TRA_TON_KHO) await releaseReservations({ orderId }, { id: 'CUSTOMER', role: 'customer' }, 'Khách hủy đơn', session);
    await restoreOrderPoints(session, fresh);
    await orderCollection.updateOne(
      { DON_HANG_ID: orderId, TRANG_THAI: { $in: ['Đã đặt hàng thành công', 'Chờ xử lý'] } },
      { $set: { TRANG_THAI: 'Đã hủy', LY_DO_HUY: reason, NGAY_HUY: new Date(), NGAY_CAP_NHAT:new Date() }, $push:{LICH_SU_TRANG_THAI:{from:fresh.TRANG_THAI,to:'Đã hủy',at:new Date(),actor:'customer',reason}} } as any,
      { session },
    );
    if (paidAmount > 0) {
      const afterSales = await getCollection<any>('YEU_CAU_HAU_MAI');
      const activeRequest = await afterSales.findOne({ orderId, active: true }, { session });
      if (!activeRequest) {
        const requestId = `HM_CANCEL_${orderId}`;
        const createdAt = new Date();
        await afterSales.updateOne(
          { _id: requestId },
          { $setOnInsert: {
            _id: requestId,
            requestId,
            orderId,
            customerId: fresh.KHACH_HANG_ID || null,
            type: 'refund',
            reason: `Đơn được khách hủy trước khi chuẩn bị: ${reason}`,
            items: lines.map(line => ({ productId: line.SAN_PHAM_ID, quantity: Number(line.SO_LUONG || 0) })).filter(item => item.productId && item.quantity > 0),
            evidence: [],
            status: 'Chờ tiếp nhận',
            active: true,
            version: 0,
            assignedTo: null,
            createdAt,
            updatedAt: createdAt,
            refundContext: { paidAmount, source: 'customer-cancellation' },
            history: [{ action: 'Tự tạo hồ sơ đối soát sau hủy đơn đã thu tiền', actor: 'SYSTEM', at: createdAt, reason }],
          } },
          { upsert: true, session },
        );
      }
    }
    });

    return res.status(200).json({
      message: 'Hủy đơn hàng thành công.' + (refundRequired ? ' Shop đã tạo hồ sơ đối soát khoản đã thu.' : ''),
      orderStatus: 'Đã hủy',
      reason,
    });
  } catch (error: any) {
    console.error('Lỗi hủy đơn hàng:', error);
    return res.status(error instanceof InventoryError?error.status:500).json({ message: error instanceof InventoryError ? error.message : 'Không thể hủy đơn lúc này.' });
  }
};

export const requestReturnRefund = async (req: Request,res: Response) => {
  req.body={...req.body,type:req.body.type||'refund'};
  return createAfterSales(req,res);
};

export const updateShippingInfo = async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { receiver, phone, address, deliveryDate, deliveryTime } = req.body;

  if (!orderId) {
    return res.status(400).json({ message: 'Thiếu mã đơn hàng.' });
  }

  try {
    const orderCollection = await getCollection<any>('DON_HANG');
    const order = await orderCollection.findOne({ DON_HANG_ID: orderId });

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const status = String(order.TRANG_THAI || '');
    const allowedStatuses = ['Đã đặt hàng thành công', 'Chờ xử lý'];
    const isAllowed = allowedStatuses.some((allowedStatus) => status.toLowerCase().includes(allowedStatus.toLowerCase()));

    if (!isAllowed) {
      return res.status(403).json({
        message: 'Chỉ có thể chỉnh sửa trước khi shop bắt đầu chuẩn bị.',
      });
    }

    if (toBit(order.DA_CHINH_SUA_GIAO_HANG)) {
      return res.status(403).json({
        message: 'Đơn hàng này đã được chỉnh sửa thông tin giao hàng trước đó, không thể sửa thêm.',
      });
    }

    await orderCollection.updateOne(
      { DON_HANG_ID: orderId },
      {
        $set: {
          TEN_NGUOI_NHAN: receiver || null,
          SDT_NGUOI_NHAN: phone || null,
          DIA_CHI_GIAO_HANG: address || null,
          NGAY_MUON_GIAO: toSqlDate(deliveryDate) || deliveryDate || null,
          KHUNG_GIO_MUON_GIAO: deliveryTime || null,
          DA_CHINH_SUA_GIAO_HANG: true,
        },
      },
    );

    return res.status(200).json({ message: 'Cập nhật thông tin giao hàng thành công.' });
  } catch (error: any) {
    console.error('Lỗi updateShippingInfo:', error);
    return res.status(error instanceof InventoryError?error.status:500).json({message:error instanceof InventoryError?error.message:'Chưa cập nhật được thông tin.'});
  }
};

export const readAfterSales = async (req: Request,res: Response) => { try { return res.json({requests:await afterSalesRead(String(req.params.orderId))}); } catch(e:any){return res.status(e instanceof InventoryError?e.status:500).json({message:e instanceof InventoryError?e.message:'Chưa đọc được hồ sơ.'});} };
export const createAfterSales = async (req: Request,res: Response) => { try { return res.status(201).json({request:await afterSalesCreate(String(req.params.orderId),req.body)}); } catch(e:any){return res.status(e instanceof InventoryError?e.status:e.code===11000?409:500).json({message:e instanceof InventoryError?e.message:'Chưa gửi được hồ sơ. Vui lòng tải lại trạng thái.'});} };
export const supplementAfterSales = async (req: Request,res: Response) => { try { return res.json({request:await afterSalesSupplement(String(req.params.orderId),String(req.params.requestId),req.body)}); } catch(e:any){return res.status(e instanceof InventoryError?e.status:500).json({message:e instanceof InventoryError?e.message:'Chưa bổ sung được bằng chứng.'});} };
