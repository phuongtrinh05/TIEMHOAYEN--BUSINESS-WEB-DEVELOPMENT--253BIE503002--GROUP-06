import { InventoryError } from './inventory/helpers.js';

/**
 * Quy tắc thời gian giao dùng chung cho Customer, Sales và Backend.
 * - Shop chỉ giao trong 06:30–22:00 (giờ Việt Nam).
 * - Giờ làm việc (nhân viên có mặt) 06:30–22:00. Mốc 4 giờ chỉ đếm thời gian trong giờ làm việc.
 * - Lịch giao còn dưới 4 giờ làm việc: không nhận online, khách gọi shop.
 * - Còn dưới 24 giờ: kiểm tra NVL thực tế ngay (giữ tạm khi tạo QR).
 * - Từ 24 giờ: thanh toán thẳng, NVL được lập nhu cầu theo T sau khi thanh toán.
 */
export const SHOP_OPEN_TIME = '06:30';
export const SHOP_CLOSE_TIME = '22:00';
/** Giờ làm việc của shop: nhân viên nhận đơn, chuẩn bị hoa. Khung giao hàng cũng là 06:30–22:00. */
export const WORK_OPEN_TIME = '06:30';
export const WORK_CLOSE_TIME = '22:00';
/** Số phút làm việc tối thiểu từ lúc đặt tới đầu khung giao. */
export const URGENT_LEAD_MINUTES = 4 * 60;
export const MATERIAL_CHECK_WINDOW_MINUTES = 24 * 60;
export const URGENT_CONTACT_PHONE = '0909477488';
export const URGENT_DELIVERY_CODE = 'URGENT_DELIVERY';
export const URGENT_DELIVERY_MESSAGE = `Đơn hàng của bạn giao gấp. Vui lòng liên hệ với số điện thoại ${URGENT_CONTACT_PHONE}.`;
export const OUTSIDE_HOURS_CODE = 'OUTSIDE_SHOP_HOURS';
export const OUTSIDE_HOURS_MESSAGE = 'Shop chỉ giao hàng từ 06:30 đến 22:00. Vui lòng chọn lại giờ giao.';

export type DeliveryScheduleClass = 'UNDER_24H' | 'FROM_24H';

export type DeliveryRouting = {
  scheduleClass: DeliveryScheduleClass;
  priority: 'NORMAL' | 'HIGH';
  requiresSales: false;
  reasonCodes: string[];
  reasons: string[];
  deliveryAt: string;
  evaluatedAt: string;
  timezone: 'Asia/Ho_Chi_Minh';
  minutesUntilDelivery: number;
  hoursUntilDelivery: number;
  /** Số phút nằm trong giờ làm việc 06:30–22:00 từ lúc đặt tới đầu khung giao. */
  workingMinutesUntilDelivery: number;
  sameDay: boolean;
};

const VN_TZ = 'Asia/Ho_Chi_Minh' as const;

const vnParts = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value || 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
};

const dayKey = (value: Date) => {
  const p = vnParts(value);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

const minuteOfDay = (value: Date) => { const p = vnParts(value); return p.hour * 60 + p.minute; };
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Cả khoảng giao [start, end] phải nằm gọn trong 06:30–22:00 của cùng một ngày Việt Nam. */
export function isWithinShopHours(startInput: Date | string, endInput?: Date | string) {
  const start = new Date(startInput);
  const end = new Date(endInput ?? startInput);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return false;
  if (dayKey(start) !== dayKey(end)) return false;
  return minuteOfDay(start) >= toMinutes(SHOP_OPEN_TIME) && minuteOfDay(end) <= toMinutes(SHOP_CLOSE_TIME);
}

const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
/** Mốc 00:00 giờ Việt Nam của ngày chứa `ms` (Việt Nam không đổi giờ mùa hè). */
const vnDayStart = (ms: number) => Math.floor((ms + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
const workWindow = (dayStart: number): [number, number] =>
  [dayStart + toMinutes(WORK_OPEN_TIME) * 60_000, dayStart + toMinutes(WORK_CLOSE_TIME) * 60_000];

/** Số phút nằm trong giờ làm việc (06:30–22:00 giờ Việt Nam) giữa hai thời điểm; đêm không được tính. */
export function workingMinutesBetween(fromInput: Date | string | number, toInput: Date | string | number): number {
  const from = new Date(fromInput).getTime();
  const to = new Date(toInput).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  let total = 0;
  for (let day = vnDayStart(from); day < to; day += DAY_MS) {
    const [open, close] = workWindow(day);
    total += Math.max(0, Math.min(close, to) - Math.max(open, from));
  }
  return Math.floor(total / 60_000);
}

/**
 * Lùi `minutes` phút làm việc từ `toInput`, bỏ qua giờ shop nghỉ.
 * Vd giao 12:00 → 08:00 cùng ngày; giao 10:00 → 21:30 hôm trước (06:30–10:00 mới được 3 giờ 30 phút).
 */
export function subtractWorkingMinutes(toInput: Date | string | number, minutes: number): Date {
  const to = new Date(toInput).getTime();
  let remaining = Math.max(0, minutes) * 60_000;
  if (!Number.isFinite(to) || remaining === 0) return new Date(to);
  for (let day = vnDayStart(to), i = 0; i < 400; day -= DAY_MS, i++) {
    const [open, close] = workWindow(day);
    const end = Math.min(close, to);
    if (end <= open) continue;
    if (end - open >= remaining) return new Date(end - remaining);
    remaining -= end - open;
  }
  return new Date(to - minutes * 60_000);
}

export function assertWithinShopHours(start: Date | string, end?: Date | string) {
  if (!isWithinShopHours(start, end)) throw new InventoryError(400, OUTSIDE_HOURS_MESSAGE, { code: OUTSIDE_HOURS_CODE });
}

/** Khách/Sales chọn khung giao 30 phút; chỉ lưu giờ bắt đầu nên giờ bắt đầu từ 06:30 đến 21:30 (khung cuối 21:30–22:00). */
export const DELIVERY_SLOT_MINUTES = 30;
export function assertDeliverySlotStart(start: Date | string) {
  const startAt = new Date(start);
  assertWithinShopHours(startAt, new Date(startAt.getTime() + DELIVERY_SLOT_MINUTES * 60_000));
}

/**
 * Phân loại lịch giao. Không giữ tồn, không cam kết vận chuyển.
 * `deliveryStartAt` là đầu khung giờ (nếu khách chọn một khoảng); thời gian còn lại tính từ đầu khung.
 */
export function classifyDeliverySchedule(deliveryAtInput: Date | string, nowInput: Date = new Date(), deliveryStartAtInput?: Date | string): DeliveryRouting {
  const deliveryAt = new Date(deliveryAtInput);
  const startAt = new Date(deliveryStartAtInput ?? deliveryAtInput);
  const now = new Date(nowInput);
  if (!Number.isFinite(deliveryAt.getTime()) || !Number.isFinite(startAt.getTime()) || startAt.getTime() <= now.getTime()) {
    throw new InventoryError(400, 'Ngày giờ giao không hợp lệ hoặc đã qua. Vui lòng chọn lại.', { code: 'DELIVERY_IN_PAST' });
  }
  assertWithinShopHours(startAt, deliveryAt);
  const minutesUntilDelivery = Math.floor((startAt.getTime() - now.getTime()) / 60_000);
  const workingMinutesUntilDelivery = workingMinutesBetween(now, startAt);
  if (workingMinutesUntilDelivery < URGENT_LEAD_MINUTES) {
    throw new InventoryError(400, URGENT_DELIVERY_MESSAGE, { code: URGENT_DELIVERY_CODE, phone: URGENT_CONTACT_PHONE });
  }
  const under24h = minutesUntilDelivery < MATERIAL_CHECK_WINDOW_MINUTES;
  return {
    scheduleClass: under24h ? 'UNDER_24H' : 'FROM_24H',
    priority: under24h ? 'HIGH' : 'NORMAL',
    requiresSales: false,
    reasonCodes: [],
    reasons: [],
    deliveryAt: deliveryAt.toISOString(),
    evaluatedAt: now.toISOString(),
    timezone: VN_TZ,
    minutesUntilDelivery,
    hoursUntilDelivery: Math.round(minutesUntilDelivery / 6) / 10,
    workingMinutesUntilDelivery,
    sameDay: dayKey(startAt) === dayKey(now),
  };
}
