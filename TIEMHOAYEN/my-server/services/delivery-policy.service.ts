import { InventoryError } from './inventory/helpers.js';

/**
 * Quy tắc thời gian giao dùng chung cho Customer, Sales và Backend.
 * - Shop chỉ giao trong 08:00–22:00 (giờ Việt Nam).
 * - Lịch giao còn dưới 4 giờ: không nhận online, khách gọi shop.
 * - Còn dưới 24 giờ: kiểm tra NVL thực tế ngay (giữ tạm khi tạo QR).
 * - Từ 24 giờ: thanh toán thẳng, NVL được lập nhu cầu theo T sau khi thanh toán.
 */
export const SHOP_OPEN_TIME = '08:00';
export const SHOP_CLOSE_TIME = '22:00';
export const URGENT_LEAD_MINUTES = 4 * 60;
export const MATERIAL_CHECK_WINDOW_MINUTES = 24 * 60;
export const URGENT_CONTACT_PHONE = '0909477488';
export const URGENT_DELIVERY_CODE = 'URGENT_DELIVERY';
export const URGENT_DELIVERY_MESSAGE = `Đơn hàng của bạn giao gấp. Vui lòng liên hệ với số điện thoại ${URGENT_CONTACT_PHONE}.`;
export const OUTSIDE_HOURS_CODE = 'OUTSIDE_SHOP_HOURS';
export const OUTSIDE_HOURS_MESSAGE = 'Shop chỉ giao hàng từ 08:00 đến 22:00. Vui lòng chọn lại giờ giao.';

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

/** Cả khoảng giao [start, end] phải nằm gọn trong 08:00–22:00 của cùng một ngày Việt Nam. */
export function isWithinShopHours(startInput: Date | string, endInput?: Date | string) {
  const start = new Date(startInput);
  const end = new Date(endInput ?? startInput);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return false;
  if (dayKey(start) !== dayKey(end)) return false;
  return minuteOfDay(start) >= toMinutes(SHOP_OPEN_TIME) && minuteOfDay(end) <= toMinutes(SHOP_CLOSE_TIME);
}

export function assertWithinShopHours(start: Date | string, end?: Date | string) {
  if (!isWithinShopHours(start, end)) throw new InventoryError(400, OUTSIDE_HOURS_MESSAGE, { code: OUTSIDE_HOURS_CODE });
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
  if (minutesUntilDelivery < URGENT_LEAD_MINUTES) {
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
    sameDay: dayKey(startAt) === dayKey(now),
  };
}
