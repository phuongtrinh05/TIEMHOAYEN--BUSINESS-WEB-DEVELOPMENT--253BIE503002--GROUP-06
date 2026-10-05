import { Request, Response } from 'express';
import { getCollection } from '../mongo.js';

interface CreateOrderItem {
  id: string;
  qty: number;
  price: number;
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

const PAYMENT_WINDOW_MINUTES = 5;
const REWARD_POINTS_PER_UNIT = 2;
const REWARD_UNIT_VALUE = 1000;

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
  return ['thành công', 'thanh toán thành công', 'đã thanh toán', 'da thanh toan', 'success', 'paid']
    .includes(normalized);
};

const isFailedStatus = (status: string): boolean => {
  const normalized = status.trim().toLowerCase();
  return ['thất bại', 'thanh toán thất bại', 'that bai', 'failed', 'expired', 'hết hạn', 'het han']
    .includes(normalized);
};

const getOrderNumericPart = (orderId: string): string => {
  return orderId.replace(/\D/g, '') || Date.now().toString().slice(-8);
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

const createNextOrderId = async (): Promise<string> => {
  const orderCollection = await getCollection<any>('DON_HANG');
  const orders = await orderCollection
    .find({ DON_HANG_ID: { $regex: '^YEN\\d+$' } })
    .project({ DON_HANG_ID: 1 })
    .toArray();
  const maxNumber = orders.reduce((max, order) => {
    const value = Number(String(order.DON_HANG_ID || '').replace('YEN', ''));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 16000);

  return `YEN${String(maxNumber + 1).padStart(5, '0')}`;
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

const markVoucherUsed = async (orderId: string): Promise<void> => {
  const orderVoucherCollection = await getCollection<any>('DON_HANG_VOUCHER');
  const voucherCollection = await getCollection<any>('VOUCHER');
  const orderVouchers = await orderVoucherCollection.find({ DON_HANG_ID: orderId }).toArray();
  const voucherIds = orderVouchers.map((item) => item.VOUCHER_ID).filter(Boolean);

  if (voucherIds.length > 0) {
    await voucherCollection.updateMany({ VOUCHER_ID: { $in: voucherIds } }, { $set: { DA_DUNG: true } });
  }
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
  const order = await orderCollection.findOneAndUpdate(
    { DON_HANG_ID: orderId },
    { $set: { TRANG_THAI: 'Chờ xử lý' } },
    { returnDocument: 'after' },
  );

  if (order) {
    await markVoucherUsed(orderId);
    await removePaidItemsFromCart(orderId, String(order.KHACH_HANG_ID || ''));
  }
};

const markPaymentFailed = async (orderId: string): Promise<void> => {
  const [orderCollection, paymentCollection] = await Promise.all([
    getCollection<any>('DON_HANG'),
    getCollection<any>('THANH_TOAN'),
  ]);
  await paymentCollection.updateMany(
    {
      DON_HANG_ID: orderId,
      TRANG_THAI_THANH_TOAN: { $nin: ['Thành công', 'Thanh toán thành công', 'Đã thanh toán'] },
    },
    { $set: { TRANG_THAI_THANH_TOAN: 'Thất bại' } },
  );
  await orderCollection.updateOne(
    { DON_HANG_ID: orderId, TRANG_THAI: { $ne: 'Chờ xử lý' } },
    { $set: { TRANG_THAI: 'Thanh toán thất bại' } },
  );
};

export const getAllOrders = async (_req: Request, res: Response) => {
  try {
    const orderCollection = await getCollection<any>('DON_HANG');
    const orders = await orderCollection.find({}).toArray();
    orders.sort((left, right) => (toDate(right.NGAY_TAO)?.getTime() || 0) - (toDate(left.NGAY_TAO)?.getTime() || 0));
    return res.status(200).json(orders);
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

export const getPublicVouchers = async (_req: Request, res: Response) => {
  try {
    const voucherCollection = await getCollection<any>('VOUCHER');
    const vouchers = (await voucherCollection.find({
      $or: [{ KHACH_HANG_ID: null }, { KHACH_HANG_ID: { $exists: false } }],
      DA_DUNG: { $ne: true },
    }).toArray())
      .filter(isVoucherDateActive)
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

export const createOrder = async (req: Request, res: Response) => {
  try {
    const { customerId, receiver, delivery, items, voucher, summary, payment, flags } = req.body;
    const normalizedCustomerId = customerId ? String(customerId) : null;

    if (!receiver?.name || !receiver?.phone || !receiver?.address) {
      return res.status(400).json({ message: 'Thiếu thông tin người nhận.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Đơn hàng chưa có sản phẩm.' });
    }

    const paymentMethod = String(payment?.method || '').trim();
    if (paymentMethod === 'card') {
      return res.status(400).json({
        message: 'Hiện tại shop chưa hỗ trợ hình thức thanh toán thẻ ngân hàng.',
      });
    }

    const productItemsById = new Map<string, CreateOrderItem>();
    for (const rawItem of items) {
      const item = {
        id: String(rawItem.id || rawItem.SAN_PHAM_ID || ''),
        qty: Math.max(1, Number(rawItem.qty || rawItem.quantity || rawItem.SO_LUONG || 1)),
        price: Math.max(0, Number(rawItem.price || rawItem.GIA || 0)),
      };
      if (!item.id.startsWith('SP')) continue;

      const current = productItemsById.get(item.id);
      productItemsById.set(item.id, current ? { ...current, qty: current.qty + item.qty, price: item.price } : item);
    }
    const productItems = Array.from(productItemsById.values());

    if (productItems.length === 0) {
      return res.status(400).json({
        message: 'DON_HANG_CHI_TIET chỉ lưu được sản phẩm có SAN_PHAM_ID.',
      });
    }

    const loyaltyDiscount = normalizeMoney(summary?.loyaltyDiscount);
    const inferredLoyaltyPoints = convertRewardMoneyToPoints(loyaltyDiscount);
    const loyaltyPointsToUse = normalizeRewardPoints(summary?.loyaltyPoints ?? inferredLoyaltyPoints);
    const expectedLoyaltyDiscount = convertRewardPointsToMoney(loyaltyPointsToUse);

    if (loyaltyDiscount !== expectedLoyaltyDiscount) {
      return res.status(400).json({
        message: 'Số điểm thưởng và số tiền giảm từ điểm thưởng không khớp.',
      });
    }

    if (loyaltyPointsToUse > 0 && !normalizedCustomerId) {
      return res.status(400).json({
        message: 'Chỉ khách hàng đăng nhập mới có thể sử dụng điểm thưởng.',
      });
    }

    if (loyaltyPointsToUse > 0) {
      const customerCollection = await getCollection<any>('KHACH_HANG');
      const customer = await customerCollection.findOne({ KHACH_HANG_ID: normalizedCustomerId });

      if (!customer) {
        return res.status(400).json({ message: 'Không tìm thấy khách hàng để sử dụng điểm thưởng.' });
      }

      const availablePoints = normalizeRewardPoints(customer.DIEM_TICH_LUY);
      if (loyaltyPointsToUse > availablePoints) {
        return res.status(400).json({ message: 'Số điểm thưởng sử dụng vượt quá điểm hiện có.' });
      }
    }

    const checkedVoucher = await resolveVoucherForOrder(voucher, normalizedCustomerId);
    if ((voucher?.id || voucher?.code) && !checkedVoucher) {
      return res.status(400).json({
        message: normalizedCustomerId
          ? 'Voucher không hợp lệ, đã hết hạn hoặc không thuộc tài khoản này.'
          : 'Voucher không hợp lệ, đã hết hạn, đã được sử dụng hoặc không dành cho khách vãng lai.',
      });
    }

    const orderId = await createNextOrderId();
    const paymentId = createPaymentId(orderId, 1);
    const transactionCode = createTransactionCode(orderId, 1);
    const paymentDeadline = createPaymentDeadline();
    const subtotal = Math.max(0, Number(summary?.subtotal || 0));
    const shippingFee = Math.max(0, Number(summary?.shippingFee || 0));
    const clientDepositAmount = Math.max(0, Number(summary?.depositAmount || 0));
    const depositAmount = paymentMethod === 'cod' ? clientDepositAmount : 0;
    const total = Math.max(0, Number(summary?.total || 0));
    const paymentAmount = paymentMethod === 'cod' ? depositAmount : total;
    const initialPaymentStatus = paymentAmount <= 0 ? 'Thành công' : 'Chờ thanh toán';
    const initialOrderStatus = paymentAmount <= 0 ? 'Chờ xử lý' : 'Chờ thanh toán';
    const paymentMethodName = String(payment?.methodName || paymentMethod || '');

    const [orderCollection, detailCollection, paymentCollection, orderVoucherCollection] = await Promise.all([
      getCollection<any>('DON_HANG'),
      getCollection<any>('DON_HANG_CHI_TIET'),
      getCollection<any>('THANH_TOAN'),
      getCollection<any>('DON_HANG_VOUCHER'),
    ]);

    await orderCollection.insertOne({
      _id: orderId,
      DON_HANG_ID: orderId,
      KHACH_HANG_ID: normalizedCustomerId,
      NGAY_TAO: new Date(),
      TRANG_THAI: initialOrderStatus,
      TAM_TINH: subtotal,
      PHI_VAN_CHUYEN: shippingFee,
      TIEN_COC: depositAmount,
      TONG_TIEN: total,
      PHUONG_THUC_THANH_TOAN: paymentMethodName,
      VAT: 0,
      NGAY_MUON_GIAO: toSqlDate(delivery?.date),
      KHUNG_GIO_MUON_GIAO: String(delivery?.time || ''),
      LOI_NHAN_THIEP: String(delivery?.message || ''),
      AN_THONG_TIN: toBit(flags?.hideSender),
      GHI_CHU: String(delivery?.noteShop || ''),
      TEN_NGUOI_NHAN: receiver.name,
      SDT_NGUOI_NHAN: receiver.phone,
      DIA_CHI_GIAO_HANG: receiver.address,
      YEU_CAU_VAT: toBit(flags?.requestVAT),
      GUI_ANH_QUA_ZALO: toBit(flags?.sendZaloPhoto),
      DA_CHINH_SUA_GIAO_HANG: false,
      LY_DO_HUY: null,
      NGAY_HUY: null,
      LY_DO_HOAN_TIEN_TRA_HANG: null,
      NGAY_YEU_CAU_HOAN_TIEN_TRA_HANG: null,
      DIEM_THUONG_SU_DUNG: loyaltyPointsToUse > 0 ? loyaltyPointsToUse : null,
      DA_TRU_DIEM_THUONG: false,
      LY_DO_TU_CHOI: null,
    });

    await detailCollection.insertMany(productItems.map((item) => ({
      _id: { DON_HANG_ID: orderId, SAN_PHAM_ID: item.id },
      DON_HANG_ID: orderId,
      SAN_PHAM_ID: item.id,
      SO_LUONG: item.qty,
      GIA: item.price,
    })));

    if (checkedVoucher) {
      await orderVoucherCollection.insertOne({
        _id: { DON_HANG_ID: orderId, VOUCHER_ID: checkedVoucher.VOUCHER_ID },
        DON_HANG_ID: orderId,
        VOUCHER_ID: checkedVoucher.VOUCHER_ID,
        MO_TA: `Áp dụng voucher ${checkedVoucher.MA_VOUCHER}`,
      });
    }

    await paymentCollection.insertOne({
      _id: paymentId,
      THANH_TOAN_ID: paymentId,
      DON_HANG_ID: orderId,
      CONG_THANH_TOAN: paymentMethodName,
      MA_GIAO_DICH: transactionCode,
      SO_TIEN: paymentAmount,
      TRANG_THAI_THANH_TOAN: initialPaymentStatus,
      NGAY_THANH_TOAN: new Date(),
    });

    if (paymentAmount <= 0) {
      await finalizeSuccessfulPayment(orderId);
    }

    return res.status(201).json({
      message: 'Tạo đơn hàng và mã thanh toán thành công.',
      orderId,
      paymentId,
      transactionCode,
      paymentAmount,
      paymentDeadline,
      orderStatus: initialOrderStatus,
      paymentStatus: initialPaymentStatus,
      paymentWindowSeconds: PAYMENT_WINDOW_MINUTES * 60,
    });
  } catch (error: any) {
    console.error('Lỗi tạo đơn hàng:', error);
    return res.status(500).json({ message: 'Không thể tạo đơn hàng: ' + error.message });
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
    let orderStatus = String(order.TRANG_THAI || 'Chờ thanh toán');
    let remainingSeconds = getRemainingSeconds(order, payment);

    if (isSuccessStatus(paymentStatus)) {
      await finalizeSuccessfulPayment(orderId);
      orderStatus = 'Chờ xử lý';
      remainingSeconds = 0;
    } else if (isFailedStatus(paymentStatus) || remainingSeconds <= 0) {
      await markPaymentFailed(orderId);
      orderStatus = 'Thanh toán thất bại';
      remainingSeconds = 0;
    }

    return res.status(200).json({
      orderId,
      paymentId: payment?.THANH_TOAN_ID,
      transactionCode: payment?.MA_GIAO_DICH,
      paymentAmount: Number(payment?.SO_TIEN || 0),
      paymentStatus: isSuccessStatus(paymentStatus)
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
    const { orderId } = req.params;
    await markPaymentFailed(orderId);

    return res.status(200).json({
      message: 'Đơn hàng đã chuyển sang trạng thái thanh toán thất bại.',
      orderId,
      orderStatus: 'Thanh toán thất bại',
      paymentStatus: 'Thất bại',
      remainingSeconds: 0,
    });
  } catch (error: any) {
    console.error('Lỗi hết hạn thanh toán:', error);
    return res.status(500).json({ message: 'Không thể cập nhật thanh toán thất bại: ' + error.message });
  }
};

export const retryOrderPayment = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const [orderCollection, paymentCollection] = await Promise.all([
      getCollection<any>('DON_HANG'),
      getCollection<any>('THANH_TOAN'),
    ]);
    const order = await orderCollection.findOne({ DON_HANG_ID: orderId });

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng để thanh toán lại.' });
    }

    const currentOrderStatus = String(order.TRANG_THAI || '');
    if (currentOrderStatus === 'Chờ xử lý' || currentOrderStatus === 'Hoàn thành') {
      return res.status(400).json({ message: 'Đơn hàng đã thanh toán hoặc đã xử lý, không thể thanh toán lại.' });
    }

    const paymentMethodName = String(order.PHUONG_THUC_THANH_TOAN || '');
    const normalizedMethod = paymentMethodName.trim().toLowerCase();
    const isCod = normalizedMethod.includes('cod') || normalizedMethod.includes('nhận hàng') || normalizedMethod.includes('nhan hang');
    const depositAmount = Math.max(0, Number(order.TIEN_COC || 0));
    const total = Math.max(0, Number(order.TONG_TIEN || 0));
    const paymentAmount = isCod ? depositAmount : total;
    const attempt = await getNextPaymentAttempt(orderId);
    const paymentId = createPaymentId(orderId, attempt);
    const transactionCode = createTransactionCode(orderId, attempt);
    const paymentDeadline = createPaymentDeadline();
    const nextPaymentStatus = paymentAmount <= 0 ? 'Thành công' : 'Chờ thanh toán';
    const nextOrderStatus = paymentAmount <= 0 ? 'Chờ xử lý' : 'Chờ thanh toán';

    await paymentCollection.updateMany(
      {
        DON_HANG_ID: orderId,
        TRANG_THAI_THANH_TOAN: { $nin: ['Thành công', 'Thanh toán thành công', 'Đã thanh toán'] },
      },
      { $set: { TRANG_THAI_THANH_TOAN: 'Thất bại' } },
    );
    await paymentCollection.insertOne({
      _id: paymentId,
      THANH_TOAN_ID: paymentId,
      DON_HANG_ID: orderId,
      CONG_THANH_TOAN: paymentMethodName,
      MA_GIAO_DICH: transactionCode,
      SO_TIEN: paymentAmount,
      TRANG_THAI_THANH_TOAN: nextPaymentStatus,
      NGAY_THANH_TOAN: new Date(),
    });
    await orderCollection.updateOne({ DON_HANG_ID: orderId }, { $set: { TRANG_THAI: nextOrderStatus } });

    if (paymentAmount <= 0) {
      await finalizeSuccessfulPayment(orderId);
    }

    return res.status(200).json({
      message: 'Đã tạo mã thanh toán mới để thanh toán lại.',
      orderId,
      paymentId,
      transactionCode,
      paymentAmount,
      paymentDeadline,
      orderStatus: nextOrderStatus,
      paymentStatus: nextPaymentStatus,
      paymentWindowSeconds: PAYMENT_WINDOW_MINUTES * 60,
    });
  } catch (error: any) {
    console.error('Lỗi tạo lại mã thanh toán:', error);
    return res.status(500).json({ message: 'Không thể tạo lại mã thanh toán: ' + error.message });
  }
};

export const markOrderPaymentSuccess = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const paymentCollection = await getCollection<any>('THANH_TOAN');
    const payment = await getLatestPayment(orderId);

    if (!payment) {
      return res.status(404).json({ message: 'Không tìm thấy thanh toán.' });
    }

    await paymentCollection.updateOne(
      { THANH_TOAN_ID: payment.THANH_TOAN_ID },
      { $set: { TRANG_THAI_THANH_TOAN: 'Thành công', NGAY_THANH_TOAN: new Date() } },
    );
    await finalizeSuccessfulPayment(orderId);

    return res.status(200).json({
      message: 'Thanh toán thành công, đơn hàng đã chuyển sang chờ xử lý.',
      orderId,
      orderStatus: 'Chờ xử lý',
      paymentStatus: 'Thành công',
      remainingSeconds: 0,
    });
  } catch (error: any) {
    console.error('Lỗi xác nhận thanh toán thành công:', error);
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
    const hasReview = await reviewCollection.findOne({ DON_HANG_ID: orderId }, { projection: { DANH_GIA_ID: 1 } });
    const enrichedOrder = {
      ...order,
      DA_DANH_GIA: hasReview ? 1 : 0,
      TEN_KHACH_HANG: customer?.TEN || null,
      SDT_KHACH_HANG: customer?.SDT || null,
      EMAIL: customer?.EMAIL || null,
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
        TEN_SAN_PHAM: product?.TEN_SAN_PHAM || null,
        KIEU_DANG: product?.KIEU_DANG || null,
        TRANG_THAI_SAN_PHAM: product?.TRANG_THAI || null,
        HINH_ANH: image?.URL || null,
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
      const voucherItem = voucherMap.get(item.VOUCHER_ID);
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

    if (String(order.TRANG_THAI || '') !== 'Chờ xử lý') {
      return res.status(400).json({ message: 'Chỉ có đơn hàng ở trạng thái Chờ xử lý mới được hủy.' });
    }

    await orderCollection.updateOne(
      { DON_HANG_ID: orderId },
      { $set: { TRANG_THAI: 'Đã hủy', LY_DO_HUY: reason, NGAY_HUY: new Date() } },
    );

    return res.status(200).json({
      message: 'Hủy đơn hàng thành công.',
      orderStatus: 'Đã hủy',
      reason,
    });
  } catch (error: any) {
    console.error('Lỗi hủy đơn hàng:', error);
    return res.status(500).json({ message: 'Không thể hủy đơn hàng: ' + error.message });
  }
};

export const requestReturnRefund = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const reason = normalizeReason(req.body?.reason);

    if (!reason) {
      return res.status(400).json({ message: 'Vui lòng chọn lý do hoàn tiền/trả hàng.' });
    }

    if (!RETURN_REFUND_REASONS.includes(reason)) {
      return res.status(400).json({ message: 'Lý do hoàn tiền/trả hàng không hợp lệ.' });
    }

    const [orderCollection, reviewCollection] = await Promise.all([
      getCollection<any>('DON_HANG'),
      getCollection<any>('DANH_GIA'),
    ]);
    const order = await orderCollection.findOne({ DON_HANG_ID: orderId });

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const currentStatus = String(order.TRANG_THAI || '');
    if (isCompletedOrderStatus(currentStatus)) {
      return res.status(400).json({ message: 'Đơn hàng đã Hoàn thành nên không thể yêu cầu hoàn tiền/trả hàng.' });
    }

    if (!isDeliveredOrderStatus(currentStatus)) {
      return res.status(400).json({
        message: 'Chỉ có thể yêu cầu hoàn tiền/trả hàng khi đơn hàng ở trạng thái Giao hàng thành công.',
      });
    }

    if (await reviewCollection.findOne({ DON_HANG_ID: orderId }, { projection: { DANH_GIA_ID: 1 } })) {
      return res.status(409).json({
        message: 'Đơn hàng đã được đánh giá nên không thể yêu cầu hoàn tiền/trả hàng.',
      });
    }

    await orderCollection.updateOne(
      { DON_HANG_ID: orderId },
      {
        $set: {
          TRANG_THAI: 'Yêu cầu hoàn tiền/trả hàng',
          LY_DO_HOAN_TIEN_TRA_HANG: reason,
          NGAY_YEU_CAU_HOAN_TIEN_TRA_HANG: new Date(),
        },
      },
    );

    return res.status(200).json({
      message: 'Đã gửi yêu cầu hoàn tiền/trả hàng.',
      orderStatus: 'Yêu cầu hoàn tiền/trả hàng',
      reason,
    });
  } catch (error: any) {
    console.error('Lỗi yêu cầu hoàn tiền/trả hàng:', error);
    return res.status(500).json({ message: 'Không thể gửi yêu cầu hoàn tiền/trả hàng: ' + error.message });
  }
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
    const allowedStatuses = ['Chờ xử lý', 'Đang chuẩn bị'];
    const isAllowed = allowedStatuses.some((allowedStatus) => status.toLowerCase().includes(allowedStatus.toLowerCase()));

    if (!isAllowed) {
      return res.status(403).json({
        message: 'Chỉ có thể chỉnh sửa khi đơn hàng ở trạng thái Chờ xử lý hoặc Đang chuẩn bị.',
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
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};
