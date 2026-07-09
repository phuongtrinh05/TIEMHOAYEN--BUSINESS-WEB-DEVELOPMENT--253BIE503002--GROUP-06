import { Request, Response } from 'express';
import { sql } from '../db.js';

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

const normalizeReason = (value: unknown): string => {
  return String(value || '').trim();
};

const isCompletedOrderStatus = (status: string): boolean => {
  return normalizeOrderStatusText(status).includes('hoàn thành');
};

const PAYMENT_WINDOW_MINUTES = 5;
const REWARD_POINTS_PER_UNIT = 2;
const REWARD_UNIT_VALUE = 1000;

// TEST: 1 phút. Khi làm thật đổi thành: 4 * 60 * 60 * 1000
const AUTO_COMPLETE_AFTER_MS = 60 * 1000;

// Backend tự quét DB mỗi 5 giây để phát hiện đơn "Giao hàng thành công".
// Khi làm thật có thể đổi thành: 60 * 1000
const AUTO_COMPLETE_CHECK_INTERVAL_MS = 5 * 1000;

// Không đổi database: lưu tạm thời điểm đơn được nhìn thấy ở trạng thái giao thành công.
// Lưu ý: dữ liệu này nằm trong RAM, nếu restart server thì bộ đếm sẽ bắt đầu lại.
const deliveredOrderSeenAt = new Map<string, number>();

const normalizeOrderStatusText = (status: string): string => {
  return String(status || '').trim().toLowerCase();
};

const normalizeRewardPoints = (value: unknown): number => {
  const rawPoints = Number(value || 0);

  if (!Number.isFinite(rawPoints)) {
    return 0;
  }

  const points = Math.floor(Math.max(0, rawPoints));
  return Math.floor(points / REWARD_POINTS_PER_UNIT) * REWARD_POINTS_PER_UNIT;
};

const normalizeMoney = (value: unknown): number => {
  const amount = Number(value || 0);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.max(0, Math.floor(amount));
};

const convertRewardPointsToMoney = (points: number): number => {
  return Math.floor(normalizeRewardPoints(points) / REWARD_POINTS_PER_UNIT) * REWARD_UNIT_VALUE;
};

const convertRewardMoneyToPoints = (amount: number): number => {
  return normalizeRewardPoints(Math.floor(normalizeMoney(amount) / REWARD_UNIT_VALUE) * REWARD_POINTS_PER_UNIT);
};

const isDeliveredOrderStatus = (status: string): boolean => {
  const value = normalizeOrderStatusText(status);
  return value.includes('giao hàng thành công') || value.includes('giao thành công');
};

const isRejectedReturnRefundOrderStatus = (status: string): boolean => {
  const value = normalizeOrderStatusText(status);
  return value.includes('từ chối hoàn tiền') || value.includes('từ chối trả hàng');
};

const isAutoCompletableOrderStatus = (status: string): boolean => {
  return isDeliveredOrderStatus(status) || isRejectedReturnRefundOrderStatus(status);
};

const isReturnOrFinalOrderStatus = (status: string): boolean => {
  const value = normalizeOrderStatusText(status);

  return (
    value.includes('hoàn thành') ||
    value.includes('đã hủy') ||
    value.includes('hủy') ||
    value.includes('giao hàng không thành công') ||
    value.includes('giao thất bại') ||
    value.includes('yêu cầu hoàn tiền') ||
    value.includes('yêu cầu trả hàng') ||
    value.includes('trả hàng') ||
    value.includes('hoàn tiền') ||
    value.includes('từ chối hoàn tiền') ||
    value.includes('từ chối trả hàng')
  );
};

const deductRewardPointsForCompletedOrder = async (orderId: string): Promise<void> => {
  const request = new sql.Request();
  request.input('DON_HANG_ID', sql.NVarChar(20), orderId);

  await request.query(`
    SET XACT_ABORT ON;

    BEGIN TRY
      BEGIN TRANSACTION;

      DECLARE @KHACH_HANG_ID NVARCHAR(10);
      DECLARE @DIEM_THUONG_SU_DUNG INT;

      SELECT
        @KHACH_HANG_ID = KHACH_HANG_ID,
        @DIEM_THUONG_SU_DUNG = ISNULL(DIEM_THUONG_SU_DUNG, 0)
      FROM DON_HANG WITH (UPDLOCK, HOLDLOCK)
      WHERE DON_HANG_ID = @DON_HANG_ID
        AND ISNULL(DA_TRU_DIEM_THUONG, 0) = 0;

      IF @KHACH_HANG_ID IS NOT NULL AND @DIEM_THUONG_SU_DUNG > 0
      BEGIN
        UPDATE KHACH_HANG
        SET DIEM_TICH_LUY =
          CASE
            WHEN ISNULL(DIEM_TICH_LUY, 0) > @DIEM_THUONG_SU_DUNG
              THEN ISNULL(DIEM_TICH_LUY, 0) - @DIEM_THUONG_SU_DUNG
            ELSE 0
          END
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID;

        UPDATE DON_HANG
        SET DA_TRU_DIEM_THUONG = 1
        WHERE DON_HANG_ID = @DON_HANG_ID;
      END

      COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;

      THROW;
    END CATCH
  `);
};

const deductRewardPointsForCompletedOrders = async (): Promise<void> => {
  const request = new sql.Request();

  const result = await request.query(`
    SELECT DON_HANG_ID
    FROM DON_HANG
    WHERE LOWER(ISNULL(TRANG_THAI, N'')) LIKE N'%hoàn thành%'
      AND ISNULL(DIEM_THUONG_SU_DUNG, 0) > 0
      AND ISNULL(DA_TRU_DIEM_THUONG, 0) = 0
  `);

  for (const row of result.recordset || []) {
    const orderId = String(row.DON_HANG_ID || '');

    if (orderId) {
      await deductRewardPointsForCompletedOrder(orderId);
    }
  }
};

const completeDeliveredOrderById = async (orderId: string): Promise<boolean> => {
  const request = new sql.Request();
  request.input('DON_HANG_ID', sql.NVarChar(20), orderId);

  const result = await request.query(`
    UPDATE DON_HANG
    SET TRANG_THAI = N'Hoàn thành'
    WHERE DON_HANG_ID = @DON_HANG_ID
      AND (
        LOWER(ISNULL(TRANG_THAI, N'')) LIKE N'%giao hàng thành công%'
        OR LOWER(ISNULL(TRANG_THAI, N'')) LIKE N'%giao thành công%'
        OR LOWER(ISNULL(TRANG_THAI, N'')) LIKE N'%từ chối hoàn tiền%'
        OR LOWER(ISNULL(TRANG_THAI, N'')) LIKE N'%từ chối trả hàng%'
      )
  `);

  const completed = Number(result.rowsAffected?.[0] || 0) > 0;

  if (completed) {
    await deductRewardPointsForCompletedOrder(orderId);
  }

  return completed;
};

const autoCompleteDeliveredOrderIfNeeded = async (order: any): Promise<any> => {
  const orderId = String(order?.DON_HANG_ID || '');
  const currentStatus = String(order?.TRANG_THAI || '');

  if (!orderId) {
    return order;
  }

  if (!isAutoCompletableOrderStatus(currentStatus)) {
    if (isReturnOrFinalOrderStatus(currentStatus)) {
      deliveredOrderSeenAt.delete(orderId);
    }

    return order;
  }

  const now = Date.now();
  const firstSeenAt = deliveredOrderSeenAt.get(orderId) ?? now;

  if (!deliveredOrderSeenAt.has(orderId)) {
    deliveredOrderSeenAt.set(orderId, firstSeenAt);
  }

  if (now - firstSeenAt < AUTO_COMPLETE_AFTER_MS) {
    return order;
  }

  const completed = await completeDeliveredOrderById(orderId);
  deliveredOrderSeenAt.delete(orderId);

  if (completed) {
    return {
      ...order,
      TRANG_THAI: 'Hoàn thành',
    };
  }

  return order;
};

// Quan trọng: hàm này chạy nền ở backend.
// Nhờ vậy khách không cần mở trang order-detail, hệ thống vẫn tự chuyển trạng thái.
const scanDeliveredOrdersForAutoComplete = async (): Promise<void> => {
  try {
    const request = new sql.Request();

    const result = await request.query(`
      SELECT DON_HANG_ID, TRANG_THAI
      FROM DON_HANG
      WHERE
        LOWER(ISNULL(TRANG_THAI, N'')) LIKE N'%giao hàng thành công%'
        OR LOWER(ISNULL(TRANG_THAI, N'')) LIKE N'%giao thành công%'
        OR LOWER(ISNULL(TRANG_THAI, N'')) LIKE N'%từ chối hoàn tiền%'
        OR LOWER(ISNULL(TRANG_THAI, N'')) LIKE N'%từ chối trả hàng%'
    `);

    const now = Date.now();
    const autoCompletableIds = new Set<string>();

    for (const row of result.recordset || []) {
      const orderId = String(row.DON_HANG_ID || '');
      const status = String(row.TRANG_THAI || '');

      if (!orderId || !isAutoCompletableOrderStatus(status)) {
        continue;
      }

      autoCompletableIds.add(orderId);

      const firstSeenAt = deliveredOrderSeenAt.get(orderId) ?? now;

      if (!deliveredOrderSeenAt.has(orderId)) {
        deliveredOrderSeenAt.set(orderId, firstSeenAt);
        console.log(`Bắt đầu đếm tự động hoàn thành đơn ${orderId}.`);
        continue;
      }

      if (now - firstSeenAt >= AUTO_COMPLETE_AFTER_MS) {
        const completed = await completeDeliveredOrderById(orderId);
        deliveredOrderSeenAt.delete(orderId);

        if (completed) {
          console.log(`Đơn ${orderId} đã tự động chuyển sang Hoàn thành.`);
        }
      }
    }

    // Nếu đơn đã rời trạng thái tự hoàn thành, bỏ khỏi bộ đếm RAM.
    for (const orderId of Array.from(deliveredOrderSeenAt.keys())) {
      if (!autoCompletableIds.has(orderId)) {
        deliveredOrderSeenAt.delete(orderId);
      }
    }

    await deductRewardPointsForCompletedOrders();
  } catch (error) {
    console.error('Lỗi quét tự động hoàn thành đơn hàng:', error);
  }
};

let autoCompleteWatcherStarted = false;

const startAutoCompleteDeliveredOrderWatcher = (): void => {
  if (autoCompleteWatcherStarted) {
    return;
  }

  autoCompleteWatcherStarted = true;

  setTimeout(() => {
    scanDeliveredOrdersForAutoComplete();
  }, 1000);

  setInterval(() => {
    scanDeliveredOrdersForAutoComplete();
  }, AUTO_COMPLETE_CHECK_INTERVAL_MS);

  console.log('Đã bật watcher tự động chuyển Giao hàng thành công/Từ chối hoàn tiền -> Hoàn thành.');
};

startAutoCompleteDeliveredOrderWatcher();


const createNextOrderId = async (): Promise<string> => {
  const result = await sql.query(`
    SELECT MAX(TRY_CONVERT(INT, SUBSTRING(DON_HANG_ID, 4, 20))) AS MAX_NUM
    FROM DON_HANG
    WHERE DON_HANG_ID LIKE N'YEN%'
  `);

  const maxNumber = Number(result.recordset?.[0]?.MAX_NUM || 16000);
  const nextNumber = maxNumber + 1;

  return `YEN${nextNumber.toString().padStart(5, '0')}`;
};

const getOrderNumericPart = (orderId: string): string => {
  return orderId.replace(/\D/g, '') || Date.now().toString().slice(-8);
};

const createPaymentId = (orderId: string, attempt = 1): string => {
  const numericPart = getOrderNumericPart(orderId);

  if (attempt <= 1) {
    return `TT${numericPart}`.slice(0, 20);
  }

  return `TT${numericPart}${attempt.toString().padStart(2, '0')}`.slice(0, 20);
};

const createTransactionCode = (orderId: string, attempt = 1): string => {
  const numericPart = getOrderNumericPart(orderId);

  if (attempt <= 1) {
    return `GD${numericPart}`.slice(0, 100);
  }

  return `GD${numericPart}${attempt.toString().padStart(2, '0')}`.slice(0, 100);
};

const getNextPaymentAttempt = async (orderId: string): Promise<number> => {
  const request = new sql.Request();
  request.input('DON_HANG_ID', sql.NVarChar(20), orderId);

  const result = await request.query(`
    SELECT COUNT(*) AS PAYMENT_COUNT
    FROM THANH_TOAN
    WHERE DON_HANG_ID = @DON_HANG_ID
  `);

  return Number(result.recordset?.[0]?.PAYMENT_COUNT || 0) + 1;
};

const createPaymentDeadline = (): string => {
  return new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60 * 1000).toISOString();
};

const toSqlDate = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const raw = String(value).trim();

  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
};

const toBit = (value: unknown): boolean => {
  return value === true || value === 1 || value === '1' || value === 'true';
};

const isSuccessStatus = (status: string): boolean => {
  const normalized = status.trim().toLowerCase();

  return [
    'thành công',
    'thanh toán thành công',
    'đã thanh toán',
    'da thanh toan',
    'success',
    'paid',
  ].includes(normalized);
};

const isFailedStatus = (status: string): boolean => {
  const normalized = status.trim().toLowerCase();

  return [
    'thất bại',
    'thanh toán thất bại',
    'that bai',
    'failed',
    'expired',
    'hết hạn',
    'het han',
  ].includes(normalized);
};

const markVoucherUsed = async (orderId: string): Promise<void> => {
  const request = new sql.Request();
  request.input('DON_HANG_ID', sql.NVarChar(20), orderId);

  await request.query(`
    UPDATE VOUCHER
    SET DA_DUNG = 1
    WHERE VOUCHER_ID IN (
      SELECT VOUCHER_ID
      FROM DON_HANG_VOUCHER
      WHERE DON_HANG_ID = @DON_HANG_ID
    )
  `);
};

const removePaidItemsFromCart = async (orderId: string, customerId: string): Promise<void> => {
  if (!customerId) {
    return;
  }

  const request = new sql.Request();
  request.input('DON_HANG_ID', sql.NVarChar(20), orderId);
  request.input('KHACH_HANG_ID', sql.NVarChar(10), customerId);

  await request.query(`
    DELETE ct
    FROM GIO_HANG_CHI_TIET ct
    INNER JOIN GIO_HANG gh
      ON gh.GIO_HANG_ID = ct.GIO_HANG_ID
    INNER JOIN DON_HANG_CHI_TIET dhct
      ON dhct.SAN_PHAM_ID = ct.SAN_PHAM_ID
    WHERE gh.KHACH_HANG_ID = @KHACH_HANG_ID
      AND dhct.DON_HANG_ID = @DON_HANG_ID
  `);
};

const finalizeSuccessfulPayment = async (orderId: string): Promise<void> => {
  const orderRequest = new sql.Request();
  orderRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);

  const orderResult = await orderRequest.query(`
    SELECT TOP 1 KHACH_HANG_ID
    FROM DON_HANG
    WHERE DON_HANG_ID = @DON_HANG_ID
  `);

  if (orderResult.recordset.length === 0) {
    return;
  }

  const customerId = String(orderResult.recordset[0].KHACH_HANG_ID || '');

  const updateRequest = new sql.Request();
  updateRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);

  await updateRequest.query(`
    UPDATE DON_HANG
    SET TRANG_THAI = N'Chờ xử lý'
    WHERE DON_HANG_ID = @DON_HANG_ID
      AND ISNULL(TRANG_THAI, N'') <> N'Chờ xử lý';

    UPDATE THANH_TOAN
    SET
      TRANG_THAI_THANH_TOAN = N'Thành công',
      NGAY_THANH_TOAN = GETDATE()
    WHERE DON_HANG_ID = @DON_HANG_ID;
  `);

  await markVoucherUsed(orderId);
  await removePaidItemsFromCart(orderId, customerId);
};

const markPaymentFailed = async (orderId: string): Promise<void> => {
  const request = new sql.Request();
  request.input('DON_HANG_ID', sql.NVarChar(20), orderId);

  await request.query(`
    UPDATE THANH_TOAN
    SET TRANG_THAI_THANH_TOAN = N'Thất bại'
    WHERE DON_HANG_ID = @DON_HANG_ID
      AND ISNULL(TRANG_THAI_THANH_TOAN, N'Chờ thanh toán') NOT IN (N'Thành công', N'Thanh toán thành công', N'Đã thanh toán');

    UPDATE DON_HANG
    SET TRANG_THAI = N'Thanh toán thất bại'
    WHERE DON_HANG_ID = @DON_HANG_ID
      AND ISNULL(TRANG_THAI, N'') <> N'Chờ xử lý';
  `);
};

export const getAllOrders = async (req: Request, res: Response) => {
  try {
    const result = await sql.query('SELECT * FROM DON_HANG ORDER BY NGAY_TAO DESC');
    res.status(200).json(result.recordset);
  } catch (error: any) {
    res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

export const getPublicVouchers = async (_req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      SELECT
        VOUCHER_ID,
        MA_VOUCHER,
        LOAI_GIAM_GIA,
        GIA_TRI_GIAM,
        NGAY_BAT_DAU,
        NGAY_KET_THUC,
        DA_DUNG
      FROM VOUCHER
      WHERE KHACH_HANG_ID IS NULL
        AND ISNULL(DA_DUNG, 0) = 0
        AND CAST(GETDATE() AS DATE) >= CAST(NGAY_BAT_DAU AS DATE)
        AND CAST(GETDATE() AS DATE) <= CAST(NGAY_KET_THUC AS DATE)
      ORDER BY MA_VOUCHER
    `);

    return res.status(200).json({
      total: result.recordset.length,
      vouchers: result.recordset,
    });
  } catch (error: any) {
    console.error('Lỗi lấy voucher công khai:', error);
    return res.status(500).json({
      message: 'Không thể lấy voucher công khai: ' + error.message,
    });
  }
};

export const createOrder = async (req: Request, res: Response) => {
  try {
    const {
      customerId,
      receiver,
      sender,
      delivery,
      items,
      voucher,
      summary,
      payment,
      flags,
    } = req.body;

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

    const productItems: CreateOrderItem[] = items
      .map((item: any) => ({
        id: String(item.id || item.SAN_PHAM_ID || ''),
        qty: Math.max(1, Number(item.qty || item.quantity || item.SO_LUONG || 1)),
        price: Math.max(0, Number(item.price || item.GIA || 0)),
      }))
      .filter((item: CreateOrderItem) => item.id.startsWith('SP'));

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
      const customerPointRequest = new sql.Request();
      customerPointRequest.input('KHACH_HANG_ID', sql.NVarChar(10), normalizedCustomerId);

      const customerPointResult = await customerPointRequest.query(`
        SELECT TOP 1 DIEM_TICH_LUY
        FROM KHACH_HANG
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
      `);

      if (customerPointResult.recordset.length === 0) {
        return res.status(400).json({
          message: 'Không tìm thấy khách hàng để sử dụng điểm thưởng.',
        });
      }

      const availablePoints = normalizeRewardPoints(customerPointResult.recordset[0].DIEM_TICH_LUY);

      if (loyaltyPointsToUse > availablePoints) {
        return res.status(400).json({
          message: 'Số điểm thưởng sử dụng vượt quá điểm hiện có.',
        });
      }
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

    const deliveryDate = toSqlDate(delivery?.date);
    const deliveryTime = String(delivery?.time || '');
    const receiverMessage = String(delivery?.message || '');
    const shopNote = String(delivery?.noteShop || '');
    const paymentMethodName = String(payment?.methodName || paymentMethod || '');

    const insertOrderRequest = new sql.Request();
    insertOrderRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    insertOrderRequest.input('KHACH_HANG_ID', sql.NVarChar(10), normalizedCustomerId);
    insertOrderRequest.input('TRANG_THAI', sql.NVarChar(50), initialOrderStatus);
    insertOrderRequest.input('TAM_TINH', sql.BigInt, subtotal);
    insertOrderRequest.input('PHI_VAN_CHUYEN', sql.BigInt, shippingFee);
    insertOrderRequest.input('TIEN_COC', sql.BigInt, depositAmount);
    insertOrderRequest.input('TONG_TIEN', sql.BigInt, total);
    insertOrderRequest.input('PHUONG_THUC_THANH_TOAN', sql.NVarChar(100), paymentMethodName);
    insertOrderRequest.input('VAT', sql.Decimal(5, 2), 0);
    insertOrderRequest.input('NGAY_MUON_GIAO', sql.Date, deliveryDate);
    insertOrderRequest.input('KHUNG_GIO_MUON_GIAO', sql.NVarChar(50), deliveryTime);
    insertOrderRequest.input('LOI_NHAN_THIEP', sql.NVarChar(500), receiverMessage);
    insertOrderRequest.input('AN_THONG_TIN', sql.Bit, toBit(flags?.hideSender));
    insertOrderRequest.input('GHI_CHU', sql.NVarChar(500), shopNote);
    insertOrderRequest.input('TEN_NGUOI_NHAN', sql.NVarChar(100), receiver.name);
    insertOrderRequest.input('SDT_NGUOI_NHAN', sql.VarChar(20), receiver.phone);
    insertOrderRequest.input('DIA_CHI_GIAO_HANG', sql.NVarChar(500), receiver.address);
    insertOrderRequest.input('YEU_CAU_VAT', sql.Bit, toBit(flags?.requestVAT));
    insertOrderRequest.input('GUI_ANH_QUA_ZALO', sql.Bit, toBit(flags?.sendZaloPhoto));
    insertOrderRequest.input('DIEM_THUONG_SU_DUNG', sql.Int, loyaltyPointsToUse > 0 ? loyaltyPointsToUse : null);
    insertOrderRequest.input('DA_TRU_DIEM_THUONG', sql.Bit, false);

    await insertOrderRequest.query(`
      INSERT INTO DON_HANG (
        DON_HANG_ID,
        KHACH_HANG_ID,
        NGAY_TAO,
        TRANG_THAI,
        TAM_TINH,
        PHI_VAN_CHUYEN,
        TIEN_COC,
        TONG_TIEN,
        PHUONG_THUC_THANH_TOAN,
        VAT,
        NGAY_MUON_GIAO,
        KHUNG_GIO_MUON_GIAO,
        LOI_NHAN_THIEP,
        AN_THONG_TIN,
        GHI_CHU,
        TEN_NGUOI_NHAN,
        SDT_NGUOI_NHAN,
        DIA_CHI_GIAO_HANG,
        YEU_CAU_VAT,
        GUI_ANH_QUA_ZALO,
        DIEM_THUONG_SU_DUNG,
        DA_TRU_DIEM_THUONG
      )
      VALUES (
        @DON_HANG_ID,
        @KHACH_HANG_ID,
        GETDATE(),
        @TRANG_THAI,
        @TAM_TINH,
        @PHI_VAN_CHUYEN,
        @TIEN_COC,
        @TONG_TIEN,
        @PHUONG_THUC_THANH_TOAN,
        @VAT,
        @NGAY_MUON_GIAO,
        @KHUNG_GIO_MUON_GIAO,
        @LOI_NHAN_THIEP,
        @AN_THONG_TIN,
        @GHI_CHU,
        @TEN_NGUOI_NHAN,
        @SDT_NGUOI_NHAN,
        @DIA_CHI_GIAO_HANG,
        @YEU_CAU_VAT,
        @GUI_ANH_QUA_ZALO,
        @DIEM_THUONG_SU_DUNG,
        @DA_TRU_DIEM_THUONG
      )
    `);

    for (const item of productItems) {
      const detailRequest = new sql.Request();
      detailRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
      detailRequest.input('SAN_PHAM_ID', sql.NVarChar(10), item.id);
      detailRequest.input('SO_LUONG', sql.Int, item.qty);
      detailRequest.input('GIA', sql.BigInt, item.price);

      await detailRequest.query(`
        INSERT INTO DON_HANG_CHI_TIET (DON_HANG_ID, SAN_PHAM_ID, SO_LUONG, GIA)
        VALUES (@DON_HANG_ID, @SAN_PHAM_ID, @SO_LUONG, @GIA)
      `);
    }

    if (voucher?.id || voucher?.code) {
      const voucherId = String(voucher?.id || '').trim();
      const voucherCode = String(voucher?.code || '').trim().toUpperCase();
      const voucherCheckRequest = new sql.Request();
      voucherCheckRequest.input('VOUCHER_ID', sql.NVarChar(10), voucherId);
      voucherCheckRequest.input('MA_VOUCHER', sql.NVarChar(50), voucherCode);

      if (normalizedCustomerId) {
        voucherCheckRequest.input('KHACH_HANG_ID', sql.NVarChar(10), normalizedCustomerId);
      }

      const customerCondition = normalizedCustomerId
        ? 'AND KHACH_HANG_ID = @KHACH_HANG_ID'
        : 'AND KHACH_HANG_ID IS NULL';

      const voucherCheck = await voucherCheckRequest.query(`
        SELECT TOP 1 VOUCHER_ID, MA_VOUCHER
        FROM VOUCHER
        WHERE ISNULL(DA_DUNG, 0) = 0
          ${customerCondition}
          AND CAST(GETDATE() AS DATE) >= CAST(NGAY_BAT_DAU AS DATE)
          AND CAST(GETDATE() AS DATE) <= CAST(NGAY_KET_THUC AS DATE)
          AND (
            (@VOUCHER_ID <> N'' AND VOUCHER_ID = @VOUCHER_ID)
            OR (@MA_VOUCHER <> N'' AND UPPER(MA_VOUCHER) = @MA_VOUCHER)
          )
      `);

      if (voucherCheck.recordset.length === 0) {
        return res.status(400).json({
          message: normalizedCustomerId
            ? 'Voucher không hợp lệ, đã hết hạn hoặc không thuộc tài khoản này.'
            : 'Voucher không hợp lệ, đã hết hạn, đã được sử dụng hoặc không dành cho khách vãng lai.',
        });
      }

      const checkedVoucher = voucherCheck.recordset[0];
      const orderVoucherRequest = new sql.Request();
      orderVoucherRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
      orderVoucherRequest.input('VOUCHER_ID', sql.NVarChar(10), checkedVoucher.VOUCHER_ID);
      orderVoucherRequest.input('MO_TA', sql.NVarChar(255), `Áp dụng voucher ${checkedVoucher.MA_VOUCHER}`);

      await orderVoucherRequest.query(`
        INSERT INTO DON_HANG_VOUCHER (DON_HANG_ID, VOUCHER_ID, MO_TA)
        VALUES (@DON_HANG_ID, @VOUCHER_ID, @MO_TA)
      `);
    }

    const paymentRequest = new sql.Request();
    paymentRequest.input('THANH_TOAN_ID', sql.NVarChar(20), paymentId);
    paymentRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    paymentRequest.input('CONG_THANH_TOAN', sql.NVarChar(100), paymentMethodName);
    paymentRequest.input('MA_GIAO_DICH', sql.NVarChar(100), transactionCode);
    paymentRequest.input('SO_TIEN', sql.BigInt, paymentAmount);
    paymentRequest.input('TRANG_THAI_THANH_TOAN', sql.NVarChar(50), initialPaymentStatus);
    paymentRequest.input('NGAY_THANH_TOAN', sql.DateTime, new Date());

    await paymentRequest.query(`
      INSERT INTO THANH_TOAN (
        THANH_TOAN_ID,
        DON_HANG_ID,
        CONG_THANH_TOAN,
        MA_GIAO_DICH,
        SO_TIEN,
        TRANG_THAI_THANH_TOAN,
        NGAY_THANH_TOAN
      )
      VALUES (
        @THANH_TOAN_ID,
        @DON_HANG_ID,
        @CONG_THANH_TOAN,
        @MA_GIAO_DICH,
        @SO_TIEN,
        @TRANG_THAI_THANH_TOAN,
        @NGAY_THANH_TOAN
      )
    `);

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
    return res.status(500).json({
      message: 'Không thể tạo đơn hàng: ' + error.message,
    });
  }
};

export const getOrderPaymentStatus = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;

    const request = new sql.Request();
    request.input('DON_HANG_ID', sql.NVarChar(20), orderId);

    const result = await request.query(`
      SELECT TOP 1
        dh.DON_HANG_ID,
        dh.KHACH_HANG_ID,
        dh.NGAY_TAO,
        dh.TRANG_THAI,
        tt.THANH_TOAN_ID,
        tt.MA_GIAO_DICH,
        tt.SO_TIEN,
        tt.TRANG_THAI_THANH_TOAN,
        tt.NGAY_THANH_TOAN,
        DATEDIFF(SECOND, GETDATE(), DATEADD(MINUTE, ${PAYMENT_WINDOW_MINUTES}, ISNULL(tt.NGAY_THANH_TOAN, dh.NGAY_TAO))) AS REMAINING_SECONDS
      FROM DON_HANG dh
      LEFT JOIN THANH_TOAN tt
        ON tt.DON_HANG_ID = dh.DON_HANG_ID
      WHERE dh.DON_HANG_ID = @DON_HANG_ID
      ORDER BY tt.NGAY_THANH_TOAN DESC, tt.THANH_TOAN_ID DESC
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const row = result.recordset[0];
    const paymentStatus = String(row.TRANG_THAI_THANH_TOAN || 'Chờ thanh toán');
    let orderStatus = String(row.TRANG_THAI || 'Chờ thanh toán');
    let remainingSeconds = Math.max(0, Number(row.REMAINING_SECONDS || 0));

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
      paymentId: row.THANH_TOAN_ID,
      transactionCode: row.MA_GIAO_DICH,
      paymentAmount: Number(row.SO_TIEN || 0),
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

    const orderRequest = new sql.Request();
    orderRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);

    const orderResult = await orderRequest.query(`
      SELECT TOP 1
        DON_HANG_ID,
        KHACH_HANG_ID,
        TRANG_THAI,
        TIEN_COC,
        TONG_TIEN,
        PHUONG_THUC_THANH_TOAN
      FROM DON_HANG
      WHERE DON_HANG_ID = @DON_HANG_ID
    `);

    if (orderResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng để thanh toán lại.' });
    }

    const order = orderResult.recordset[0];
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

    const failOldRequest = new sql.Request();
    failOldRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);

    await failOldRequest.query(`
      UPDATE THANH_TOAN
      SET TRANG_THAI_THANH_TOAN = N'Thất bại'
      WHERE DON_HANG_ID = @DON_HANG_ID
        AND ISNULL(TRANG_THAI_THANH_TOAN, N'Chờ thanh toán') NOT IN (N'Thành công', N'Thanh toán thành công', N'Đã thanh toán');
    `);

    const insertPaymentRequest = new sql.Request();
    insertPaymentRequest.input('THANH_TOAN_ID', sql.NVarChar(20), paymentId);
    insertPaymentRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    insertPaymentRequest.input('CONG_THANH_TOAN', sql.NVarChar(100), paymentMethodName);
    insertPaymentRequest.input('MA_GIAO_DICH', sql.NVarChar(100), transactionCode);
    insertPaymentRequest.input('SO_TIEN', sql.BigInt, paymentAmount);
    insertPaymentRequest.input('TRANG_THAI_THANH_TOAN', sql.NVarChar(50), paymentAmount <= 0 ? 'Thành công' : 'Chờ thanh toán');
    insertPaymentRequest.input('NGAY_THANH_TOAN', sql.DateTime, new Date());

    await insertPaymentRequest.query(`
      INSERT INTO THANH_TOAN (
        THANH_TOAN_ID,
        DON_HANG_ID,
        CONG_THANH_TOAN,
        MA_GIAO_DICH,
        SO_TIEN,
        TRANG_THAI_THANH_TOAN,
        NGAY_THANH_TOAN
      )
      VALUES (
        @THANH_TOAN_ID,
        @DON_HANG_ID,
        @CONG_THANH_TOAN,
        @MA_GIAO_DICH,
        @SO_TIEN,
        @TRANG_THAI_THANH_TOAN,
        @NGAY_THANH_TOAN
      )
    `);

    const updateOrderRequest = new sql.Request();
    updateOrderRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    updateOrderRequest.input('TRANG_THAI', sql.NVarChar(50), paymentAmount <= 0 ? 'Chờ xử lý' : 'Chờ thanh toán');

    await updateOrderRequest.query(`
      UPDATE DON_HANG
      SET TRANG_THAI = @TRANG_THAI
      WHERE DON_HANG_ID = @DON_HANG_ID;
    `);

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
      orderStatus: paymentAmount <= 0 ? 'Chờ xử lý' : 'Chờ thanh toán',
      paymentStatus: paymentAmount <= 0 ? 'Thành công' : 'Chờ thanh toán',
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

    const request = new sql.Request();
    request.input('DON_HANG_ID', sql.NVarChar(20), orderId);

    await request.query(`
      UPDATE THANH_TOAN
      SET
        TRANG_THAI_THANH_TOAN = N'Thành công',
        NGAY_THANH_TOAN = GETDATE()
      WHERE DON_HANG_ID = @DON_HANG_ID
    `);

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

    const orderRequest = new sql.Request();
    orderRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    orderRequest.input('PHONE', sql.NVarChar(20), phone);

    const orderResult = await orderRequest.query(`
      SELECT TOP 1
        dh.DON_HANG_ID,
        dh.KHACH_HANG_ID,
        dh.NGAY_TAO,
        dh.TRANG_THAI,
        dh.TAM_TINH,
        dh.PHI_VAN_CHUYEN,
        dh.TIEN_COC,
        dh.TONG_TIEN,
        dh.PHUONG_THUC_THANH_TOAN,
        dh.VAT,
        dh.NGAY_MUON_GIAO,
        dh.KHUNG_GIO_MUON_GIAO,
        dh.LOI_NHAN_THIEP,
        dh.AN_THONG_TIN,
        dh.GHI_CHU,
        dh.TEN_NGUOI_NHAN,
        dh.SDT_NGUOI_NHAN,
        dh.DIA_CHI_GIAO_HANG,
        dh.YEU_CAU_VAT,
        dh.GUI_ANH_QUA_ZALO,
        dh.DIEM_THUONG_SU_DUNG,
        dh.DA_TRU_DIEM_THUONG,
        dh.DA_CHINH_SUA_GIAO_HANG,
        dh.LY_DO_HUY,
        dh.NGAY_HUY,
        dh.LY_DO_HOAN_TIEN_TRA_HANG,
        dh.NGAY_YEU_CAU_HOAN_TIEN_TRA_HANG,
        kh.TEN AS TEN_KHACH_HANG,
        kh.SDT AS SDT_KHACH_HANG,
        kh.EMAIL,
        tt.THANH_TOAN_ID,
        tt.CONG_THANH_TOAN,
        tt.MA_GIAO_DICH,
        tt.SO_TIEN AS SO_TIEN_THANH_TOAN,
        tt.TRANG_THAI_THANH_TOAN,
        tt.NGAY_THANH_TOAN
      FROM DON_HANG dh
      LEFT JOIN KHACH_HANG kh
        ON kh.KHACH_HANG_ID = dh.KHACH_HANG_ID
      OUTER APPLY (
        SELECT TOP 1 *
        FROM THANH_TOAN t
        WHERE t.DON_HANG_ID = dh.DON_HANG_ID
        ORDER BY
          CASE WHEN t.TRANG_THAI_THANH_TOAN = N'Chờ thanh toán' THEN 0 ELSE 1 END,
          t.NGAY_THANH_TOAN DESC,
          t.THANH_TOAN_ID DESC
      ) tt
      WHERE dh.DON_HANG_ID = @DON_HANG_ID
        AND (
          @PHONE = N''
          OR REPLACE(ISNULL(dh.SDT_NGUOI_NHAN, ''), ' ', '') = @PHONE
          OR REPLACE(ISNULL(kh.SDT, ''), ' ', '') = @PHONE
        )
    `);

    if (orderResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng hoặc số điện thoại không khớp.' });
    }

    const order = await autoCompleteDeliveredOrderIfNeeded(orderResult.recordset[0]);

    const detailRequest = new sql.Request();
    detailRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);

    const detailResult = await detailRequest.query(`
      SELECT
        ct.SAN_PHAM_ID,
        ct.SO_LUONG,
        ct.GIA,
        sp.TEN_SAN_PHAM,
        sp.KIEU_DANG,
        sp.TRANG_THAI AS TRANG_THAI_SAN_PHAM,
        img.URL AS HINH_ANH
      FROM DON_HANG_CHI_TIET ct
      LEFT JOIN SAN_PHAM sp
        ON sp.SAN_PHAM_ID = ct.SAN_PHAM_ID
      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = ct.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC, HINH_ANH_ID ASC
      ) img
      WHERE ct.DON_HANG_ID = @DON_HANG_ID
      ORDER BY ct.SAN_PHAM_ID
    `);

    const voucherRequest = new sql.Request();
    voucherRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);

    const voucherResult = await voucherRequest.query(`
      SELECT
        dhv.VOUCHER_ID,
        dhv.MO_TA,
        v.MA_VOUCHER,
        v.LOAI_GIAM_GIA,
        v.GIA_TRI_GIAM
      FROM DON_HANG_VOUCHER dhv
      LEFT JOIN VOUCHER v
        ON v.VOUCHER_ID = dhv.VOUCHER_ID
      WHERE dhv.DON_HANG_ID = @DON_HANG_ID
    `);

    return res.status(200).json({
      order,
      products: detailResult.recordset,
      vouchers: voucherResult.recordset,
      payment: {
        THANH_TOAN_ID: order.THANH_TOAN_ID,
        CONG_THANH_TOAN: order.CONG_THANH_TOAN,
        MA_GIAO_DICH: order.MA_GIAO_DICH,
        SO_TIEN: order.SO_TIEN_THANH_TOAN,
        TRANG_THAI_THANH_TOAN: order.TRANG_THAI_THANH_TOAN,
        NGAY_THANH_TOAN: order.NGAY_THANH_TOAN,
      },
      summary: {
        TAM_TINH: order.TAM_TINH,
        PHI_VAN_CHUYEN: order.PHI_VAN_CHUYEN,
        TIEN_COC: order.TIEN_COC,
        TONG_TIEN: order.TONG_TIEN,
        GIAM_GIA: Math.max(
          0,
          Number(order.TAM_TINH || 0) + Number(order.PHI_VAN_CHUYEN || 0) - Number(order.TONG_TIEN || 0)
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
      return res.status(400).json({
        message: 'Vui lòng chọn lý do hủy đơn hàng.',
      });
    }

    if (!CANCEL_REASONS.includes(reason)) {
      return res.status(400).json({
        message: 'Lý do hủy đơn hàng không hợp lệ.',
      });
    }

    const checkRequest = new sql.Request();
    checkRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);

    const checkResult = await checkRequest.query(`
      SELECT TOP 1 DON_HANG_ID, TRANG_THAI
      FROM DON_HANG
      WHERE DON_HANG_ID = @DON_HANG_ID
    `);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy đơn hàng.',
      });
    }

    const currentStatus = String(checkResult.recordset[0].TRANG_THAI || '');

    if (currentStatus !== 'Chờ xử lý') {
      return res.status(400).json({
        message: 'Chỉ có đơn hàng ở trạng thái Chờ xử lý mới được hủy.',
      });
    }

    const updateRequest = new sql.Request();
    updateRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    updateRequest.input('LY_DO_HUY', sql.NVarChar(255), reason);

    await updateRequest.query(`
      UPDATE DON_HANG
      SET
        TRANG_THAI = N'Đã hủy',
        LY_DO_HUY = @LY_DO_HUY,
        NGAY_HUY = GETDATE()
      WHERE DON_HANG_ID = @DON_HANG_ID
    `);

    return res.status(200).json({
      message: 'Hủy đơn hàng thành công.',
      orderStatus: 'Đã hủy',
      reason,
    });
  } catch (error: any) {
    console.error('Lỗi hủy đơn hàng:', error);

    return res.status(500).json({
      message: 'Không thể hủy đơn hàng: ' + error.message,
    });
  }
};

export const requestReturnRefund = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const reason = normalizeReason(req.body?.reason);

    if (!reason) {
      return res.status(400).json({
        message: 'Vui lòng chọn lý do hoàn tiền/trả hàng.',
      });
    }

    if (!RETURN_REFUND_REASONS.includes(reason)) {
      return res.status(400).json({
        message: 'Lý do hoàn tiền/trả hàng không hợp lệ.',
      });
    }

    const checkRequest = new sql.Request();
    checkRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);

    const checkResult = await checkRequest.query(`
      SELECT TOP 1 DON_HANG_ID, TRANG_THAI
      FROM DON_HANG
      WHERE DON_HANG_ID = @DON_HANG_ID
    `);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy đơn hàng.',
      });
    }

    const currentStatus = String(checkResult.recordset[0].TRANG_THAI || '');

    if (isCompletedOrderStatus(currentStatus)) {
      return res.status(400).json({
        message: 'Đơn hàng đã Hoàn thành nên không thể yêu cầu hoàn tiền/trả hàng.',
      });
    }

    if (!isDeliveredOrderStatus(currentStatus)) {
      return res.status(400).json({
        message: 'Chỉ có thể yêu cầu hoàn tiền/trả hàng khi đơn hàng ở trạng thái Giao hàng thành công.',
      });
    }

    const updateRequest = new sql.Request();
    updateRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    updateRequest.input('LY_DO_HOAN_TIEN_TRA_HANG', sql.NVarChar(255), reason);

    await updateRequest.query(`
      UPDATE DON_HANG
      SET
        TRANG_THAI = N'Yêu cầu hoàn tiền/trả hàng',
        LY_DO_HOAN_TIEN_TRA_HANG = @LY_DO_HOAN_TIEN_TRA_HANG,
        NGAY_YEU_CAU_HOAN_TIEN_TRA_HANG = GETDATE()
      WHERE DON_HANG_ID = @DON_HANG_ID
    `);

    deliveredOrderSeenAt.delete(String(orderId || ''));

    return res.status(200).json({
      message: 'Đã gửi yêu cầu hoàn tiền/trả hàng.',
      orderStatus: 'Yêu cầu hoàn tiền/trả hàng',
      reason,
    });
  } catch (error: any) {
    console.error('Lỗi yêu cầu hoàn tiền/trả hàng:', error);

    return res.status(500).json({
      message: 'Không thể gửi yêu cầu hoàn tiền/trả hàng: ' + error.message,
    });
  }
};
export const updateShippingInfo = async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { receiver, phone, address, deliveryDate, deliveryTime } = req.body;

  if (!orderId) {
    return res.status(400).json({ message: 'Thiếu mã đơn hàng.' });
  }

  try {
    const checkRequest = new sql.Request();
    checkRequest.input('orderId', sql.NVarChar(20), orderId);

    const checkResult = await checkRequest.query(
      `SELECT TRANG_THAI, DA_CHINH_SUA_GIAO_HANG FROM DON_HANG WHERE DON_HANG_ID = @orderId`
    );

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const status: string = checkResult.recordset[0].TRANG_THAI || '';
    const allowedStatuses = ['Chờ xử lý', 'Đang chuẩn bị'];
    const isAllowed = allowedStatuses.some(s =>
      status.toLowerCase().includes(s.toLowerCase())
    );

    if (!isAllowed) {
      return res.status(403).json({
        message: 'Chỉ có thể chỉnh sửa khi đơn hàng ở trạng thái Chờ xử lý hoặc Đang chuẩn bị.',
      });
    }

    const alreadyEdited = toBit(checkResult.recordset[0].DA_CHINH_SUA_GIAO_HANG);

    if (alreadyEdited) {
      return res.status(403).json({
        message: 'Đơn hàng này đã được chỉnh sửa thông tin giao hàng trước đó, không thể sửa thêm.',
      });
    }

    const request = new sql.Request();
    request.input('receiver', sql.NVarChar(100), receiver || null);
    request.input('phone', sql.VarChar(20), phone || null);
    request.input('address', sql.NVarChar(500), address || null);
    request.input('deliveryDate', sql.Date, deliveryDate || null);
    request.input('deliveryTime', sql.NVarChar(50), deliveryTime || null);
    request.input('orderId', sql.NVarChar(20), orderId);

    await request.query(`
      UPDATE DON_HANG
      SET
        TEN_NGUOI_NHAN         = @receiver,
        SDT_NGUOI_NHAN         = @phone,
        DIA_CHI_GIAO_HANG      = @address,
        NGAY_MUON_GIAO         = @deliveryDate,
        KHUNG_GIO_MUON_GIAO    = @deliveryTime,
        DA_CHINH_SUA_GIAO_HANG = 1
      WHERE DON_HANG_ID = @orderId
    `);

    return res.status(200).json({ message: 'Cập nhật thông tin giao hàng thành công.' });
  } catch (error: any) {
    console.error('Lỗi updateShippingInfo:', error);
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};
