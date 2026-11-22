/**
 * NGUỒN DUY NHẤT cho cách hiển thị "Yêu cầu đặt hàng" phía khách.
 * Database giữ nguyên 10 trạng thái nội bộ; ở đây gom lại thành 5 bước + 3 kiểu kết thúc.
 * Mọi màn hình (chi tiết yêu cầu, danh sách, lịch sử, chatbot) chỉ đọc nhãn/lời nhắn/quyền thao tác từ đây,
 * không tự viết `if (status === ...)` riêng nữa.
 */
export type RequestStageKey =
  | 'submitted' | 'consulting' | 'confirm' | 'creating' | 'payment' | 'converted'
  | 'rejected' | 'consulted' | 'cancelled' | 'expired' | 'unknown';

export type RequestTone = 'new' | 'processing' | 'waiting' | 'success' | 'danger' | 'neutral';

export interface RequestStage {
  key: RequestStageKey;
  /** 1–5 trên thanh tiến trình; 0 = yêu cầu đã dừng (không hiện thanh tiến trình). */
  step: number;
  label: string;
  tone: RequestTone;
  /** Một câu nói rõ chuyện gì đang xảy ra và khách cần làm gì. */
  hint: string;
  terminal: boolean;
  canCancel: boolean;
  /** Đổi lịch giao / đề nghị thay đổi. */
  canChange: boolean;
  /** Trường cũ để tương thích giao diện; quy trình hiện tại không yêu cầu khách xác nhận phương án. */
  awaitingConfirmation: boolean;
  canChat: boolean;
}

/** 5 bước hiển thị trên thanh tiến trình. */
export const REQUEST_STEPS = ['Đã gửi', 'Shop tư vấn', 'Chốt phương án', 'Xác minh thanh toán', 'Thành đơn'] as const;

const STAGES: Record<Exclude<RequestStageKey, 'unknown'>, Omit<RequestStage, 'key' | 'canCancel' | 'canChange' | 'canChat' | 'awaitingConfirmation'>> = {
  submitted: { step: 1, label: 'Đã gửi yêu cầu', tone: 'new', terminal: false,
    hint: 'Shop đã nhận yêu cầu và sẽ liên hệ tư vấn. Bạn chưa cần thanh toán.' },
  consulting: { step: 2, label: 'Shop đang tư vấn', tone: 'processing', terminal: false,
    hint: 'Shop đang kiểm tra hoa và lịch giao, phương án sẽ được gửi tại đây. Bạn chưa cần thanh toán.' },
  confirm: { step: 2, label: 'Shop đang chốt phương án', tone: 'processing', terminal: false,
    hint: 'Sales đang hoàn tất phương án và xác minh khoản thanh toán. Bạn có thể nhắn shop nếu cần điều chỉnh.' },
  creating: { step: 4, label: 'Shop đang tạo đơn', tone: 'processing', terminal: false,
    hint: 'Bạn đã đồng ý phương án. Shop kiểm tra hàng lần cuối và tạo đơn, sau đó bạn thanh toán.' },
  payment: { step: 4, label: 'Chờ bạn thanh toán', tone: 'waiting', terminal: false,
    hint: 'Đơn đã được tạo. Bạn thanh toán trong thời hạn để giữ đơn; quá hạn đơn sẽ tự hủy.' },
  converted: { step: 5, label: 'Đã thành đơn hàng', tone: 'success', terminal: false,
    hint: 'Yêu cầu đã thành đơn hàng. Theo dõi thanh toán và giao hàng trong trang đơn.' },
  rejected: { step: 0, label: 'Shop đã từ chối', tone: 'danger', terminal: true,
    hint: 'Shop chưa thể nhận yêu cầu này. Bạn có thể chọn mẫu khác và gửi yêu cầu mới.' },
  consulted: { step: 0, label: 'Đã tư vấn xong', tone: 'neutral', terminal: true,
    hint: 'Shop đã tư vấn và kết thúc yêu cầu này. Bạn có thể gửi yêu cầu mới khi cần.' },
  cancelled: { step: 0, label: 'Đã hủy yêu cầu', tone: 'danger', terminal: true,
    hint: 'Bạn đã dừng yêu cầu này, không có đơn nào được tạo.' },
  expired: { step: 0, label: 'Hết hạn thanh toán', tone: 'danger', terminal: true,
    hint: 'Đơn tạo từ yêu cầu đã tự hủy vì quá hạn thanh toán. Bạn có thể gửi yêu cầu mới.' },
};

/** Trạng thái trong database → bước hiển thị. Gồm cả tên cũ còn trên dữ liệu Atlas. */
const STATUS_TO_STAGE: Record<string, Exclude<RequestStageKey, 'unknown'>> = {
  'Chờ xử lý': 'submitted',
  'Chờ Sales tiếp nhận': 'submitted',
  'Sales đang xử lý': 'consulting',
  'Chờ khách xác nhận': 'confirm',
  'Khách đã đồng ý': 'creating',
  'Chờ khách thanh toán': 'payment',
  'Chờ thanh toán': 'payment',
  'Đã lên đơn': 'converted',
  'Đã từ chối': 'rejected',
  'Đã tư vấn': 'consulted',
  'Khách đã hủy': 'cancelled',
  'Hết hạn thanh toán': 'expired',
};

export function requestStage(request: any): RequestStage {
  const status = String((typeof request === 'string' ? request : request?.status) || '');
  const mapped: Exclude<RequestStageKey, 'unknown'> | undefined = STATUS_TO_STAGE[status];
  const key: RequestStageKey = mapped || 'unknown';
  const base = mapped
    ? STAGES[mapped]
    : { step: 1, label: status || 'Đang xử lý', tone: 'processing' as RequestTone, terminal: false, hint: 'Shop đang xử lý yêu cầu của bạn.' };
  const stage: RequestStage = {
    key, ...base,
    canCancel: !base.terminal && key !== 'converted',
    canChange: !base.terminal && !['payment', 'converted'].includes(key),
    awaitingConfirmation: false,
    canChat: !base.terminal,
  };
  if (typeof request !== 'string') {
    // Lời nhắn riêng của shop khi kết thúc (vd. lý do từ chối) rõ hơn câu mặc định.
    if (base.terminal && request?.customerMessage) stage.hint = String(request.customerMessage);
    // Lịch giao mong muốn đã qua khi chưa chốt đơn → khách cần chọn lịch mới.
    if (request?.workflow?.scheduleExpired && ['submitted', 'consulting', 'confirm'].includes(key)) {
      stage.label = 'Cần chọn lại lịch giao';
      stage.tone = 'waiting';
      stage.hint = 'Lịch giao mong muốn đã qua. Hãy đề nghị lịch mới hoặc nhắn shop; shop chưa nhận đơn cho lịch cũ.';
    }
  }
  return stage;
}
