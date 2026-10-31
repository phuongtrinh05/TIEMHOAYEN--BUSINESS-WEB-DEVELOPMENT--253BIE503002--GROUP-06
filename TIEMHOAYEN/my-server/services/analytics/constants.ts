/**
 * D05 — KPI DICTIONARY & cấu hình Dashboard / Báo cáo / Thông báo (AD02–AD07, AD09, AD60).
 * Mọi màn hình (Dashboard, Báo cáo, Xuất file) đọc định nghĩa ở đây — không tự tính khác.
 */

const envNumber = (key: string, fallback: number) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const ANALYTICS_CONFIG = {
  timezoneOffsetMinutes: 7 * 60, // Asia/Ho_Chi_Minh, không có giờ mùa hè
  /** AD05 — mốc màu lịch giao (phút) [ĐỀ XUẤT, cần chốt] */
  deliveryRedMinutes: envNumber('DASHBOARD_DELIVERY_RED_MINUTES', 30),
  deliveryOrangeMinutes: envNumber('DASHBOARD_DELIVERY_ORANGE_MINUTES', 60),
  deliveryWindowMinutes: envNumber('DASHBOARD_DELIVERY_WINDOW_MINUTES', 120),
  /** AD06 — "Chờ xử lý quá X phút" [ĐỀ XUẤT, cần chốt] */
  pendingTooLongMinutes: envNumber('DASHBOARD_PENDING_MINUTES', 30),
  /** AD06 — đơn giao trong N giờ tới mà chưa có lịch chuẩn bị T */
  missingPrepHours: envNumber('DASHBOARD_MISSING_PREP_HOURS', 24),
  /** AD09 — chu kỳ quét sinh thông báo (giây) — polling thay realtime */
  notificationSyncSeconds: envNumber('NOTIFICATION_SYNC_SECONDS', 60),
  /** AD09 — chỉ sinh thông báo cho dữ liệu phát sinh trong N ngày gần nhất */
  notificationLookbackDays: envNumber('NOTIFICATION_LOOKBACK_DAYS', 7),
};

/* ---------- Trạng thái đơn (chuẩn hóa từ dữ liệu hiện có) ---------- */
export const ORDER_STATUS = {
  waitingPayment: 'Chờ thanh toán',
  pending: 'Chờ xử lý',
  confirmed: 'Đã xác nhận',
  preparing: 'Đang chuẩn bị hàng',
  waitingShip: 'Chờ vận chuyển',
  shipping: 'Đang giao',
  delivered: 'Đã giao',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
  paymentFailed: 'Thanh toán thất bại',
  refundRequested: 'Yêu cầu hoàn tiền/trả hàng',
  refundAccepted: 'Chấp nhận hoàn tiền',
  refunded: 'Đã hoàn tiền',
} as const;

/** Đơn đã xác nhận, cần giao — dùng cho Lịch giao (AD05). */
export const DELIVERY_ACTIVE_STATUSES = [ORDER_STATUS.confirmed, ORDER_STATUS.preparing, ORDER_STATUS.waitingShip, ORDER_STATUS.shipping];
/** Đơn đã kết thúc vòng đời. */
export const ORDER_FINAL_STATUSES = [ORDER_STATUS.completed, ORDER_STATUS.cancelled, ORDER_STATUS.refunded, ORDER_STATUS.paymentFailed];
/** Đơn không còn hiệu lực bán hàng. */
export const ORDER_VOID_STATUSES = [ORDER_STATUS.cancelled, ORDER_STATUS.refunded, ORDER_STATUS.refundAccepted, ORDER_STATUS.paymentFailed];

export const PAYMENT_SUCCESS_STATUSES = ['Thành công', 'Thanh toán thành công', 'Đã thanh toán'];

/** D05 — Định nghĩa KPI hiển thị ở tooltip ⓘ và trang Từ điển KPI. */
export const KPI_DICTIONARY = [
  { key: 'netRevenue', code: 'K01', label: 'Doanh thu thuần', unit: 'đ', snapshot: false,
    formula: 'Σ (TONG_TIEN − PHI_VAN_CHUYEN) của đơn "Hoàn thành"',
    dateField: 'Ngày hoàn thành (NGAY_HOAN_THANH; đơn cũ chưa có → dùng ngày muốn giao, rồi ngày tạo)',
    notes: 'Không gồm tiền cọc của đơn chưa hoàn thành; loại đơn hủy / hoàn tiền / thanh toán thất bại.' },
  { key: 'cashCollected', code: 'K06', label: 'Tiền đã thu', unit: 'đ', snapshot: false,
    formula: 'Σ SO_TIEN giao dịch THANH_TOAN trạng thái thành công',
    dateField: 'NGAY_THANH_TOAN',
    notes: 'Gồm cả tiền cọc và COD đã thu. Giao dịch trùng MA_GIAO_DICH chỉ tính 1 lần.' },
  { key: 'depositHeld', code: 'K05', label: 'Tiền cọc đang giữ', unit: 'đ', snapshot: true,
    formula: 'Σ tiền đã thu thành công của các đơn CHƯA hoàn thành và chưa hủy/hoàn',
    dateField: 'Tại thời điểm xem (không theo bộ lọc)',
    notes: 'Ví dụ: đơn 1.000.000đ đã cọc 300.000đ chưa giao → K05 = 300.000đ, K01 = 0.' },
  { key: 'newOrders', code: 'K02', label: 'Đơn mới', unit: 'đơn', snapshot: false,
    formula: 'Số đơn tạo trong kỳ (mọi trạng thái)', dateField: 'NGAY_TAO', notes: '' },
  { key: 'completedOrders', code: 'K03', label: 'Đơn hoàn thành', unit: 'đơn', snapshot: false,
    formula: 'Số đơn "Hoàn thành"', dateField: 'Ngày hoàn thành', notes: '' },
  { key: 'avgOrderValue', code: 'K04', label: 'Giá trị đơn TB', unit: 'đ', snapshot: false,
    formula: 'K01 / K03', dateField: 'Ngày hoàn thành', notes: 'K03 = 0 → hiển thị "—".' },
  { key: 'cancelRate', code: 'K12', label: 'Tỷ lệ hủy', unit: '%', snapshot: false,
    formula: 'Đơn tạo trong kỳ đã hủy / đơn tạo trong kỳ', dateField: 'NGAY_TAO (cohort)', notes: 'Mẫu số 0 → "—".' },
  { key: 'refundRequestRate', code: 'K13', label: 'Tỷ lệ yêu cầu trả/hoàn', unit: '%', snapshot: false,
    formula: 'Đơn tạo trong kỳ có yêu cầu trả/hoàn / đơn tạo trong kỳ', dateField: 'NGAY_TAO (cohort)',
    notes: 'Là số YÊU CẦU, chưa phải số tiền đã hoàn.' },
  { key: 'newCustomers', code: 'K09', label: 'Khách hàng mới', unit: 'khách', snapshot: false,
    formula: 'Số tài khoản đăng ký trong kỳ', dateField: 'KHACH_HANG.NGAY_DANG_KY', notes: '' },
  { key: 'itemsSold', code: 'K10', label: 'Sản phẩm đã bán', unit: 'sp', snapshot: false,
    formula: 'Σ SO_LUONG dòng đơn của đơn "Hoàn thành"', dateField: 'Ngày hoàn thành', notes: '' },
  { key: 'grossProfit', code: 'K14', label: 'Lợi nhuận gộp', unit: 'đ', snapshot: false,
    formula: 'Doanh thu hàng − giá vốn (thực tế từ phiếu xuất của đơn; nếu chưa có → định mức BOM × giá vốn hiện hành)',
    dateField: 'Ngày hoàn thành', notes: 'Dòng không đủ dữ liệu giá vốn không tính vào lợi nhuận; hiển thị tỷ lệ phủ dữ liệu.' },
];

/** AD06 — K20: tiêu chí "Đơn cần chú ý" (đơn thỏa ≥ 1). */
export const ATTENTION_RULES = {
  pendingTooLong: 'Chờ xử lý quá lâu',
  paymentFailed: 'Thanh toán thất bại',
  deliveryAtRisk: 'Sắp/quá giờ giao nhưng chưa giao',
  refundRequest: 'Có yêu cầu trả/hoàn',
  stockRisk: 'Thiếu NVL / chưa có lịch chuẩn bị T',
} as const;

/** D07 — nhóm & mức ưu tiên thông báo Admin */
export const NOTIFICATION_GROUPS = ['Đơn hàng', 'Tồn kho', 'Khiếu nại', 'Hệ thống'] as const;
export type NotificationGroup = typeof NOTIFICATION_GROUPS[number];
export const NOTIFICATION_PRIORITY = { high: 'Cao', medium: 'Trung bình', low: 'Thấp' } as const;
