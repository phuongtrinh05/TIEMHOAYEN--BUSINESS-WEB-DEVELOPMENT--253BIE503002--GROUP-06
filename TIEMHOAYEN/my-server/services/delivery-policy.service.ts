import { InventoryError } from './inventory/helpers.js';

export type DeliveryScheduleClass =
  | 'NORMAL'
  | 'URGENT_UNDER_1H'
  | 'EXCEPTION_UNDER_3H'
  | 'OUTSIDE_HOURS'
  | 'FUTURE_UNCERTAIN';

export type DeliveryRouting = {
  scheduleClass: DeliveryScheduleClass;
  priority: 'NORMAL' | 'HIGH';
  requiresSales: boolean;
  reasonCodes: string[];
  reasons: string[];
  deliveryAt: string;
  evaluatedAt: string;
  timezone: 'Asia/Ho_Chi_Minh';
  minutesUntilDelivery: number;
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

/**
 * Quyết định lịch giao dùng chung cho Customer/Admin/Sales.
 * Hàm chỉ phân loại, không giữ tồn và không tự cam kết khả năng vận chuyển.
 */
export function classifyDeliverySchedule(deliveryAtInput: Date | string, nowInput: Date = new Date()): DeliveryRouting {
  const deliveryAt = deliveryAtInput instanceof Date ? deliveryAtInput : new Date(deliveryAtInput);
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  if (!Number.isFinite(deliveryAt.getTime()) || deliveryAt.getTime() <= now.getTime()) {
    throw new InventoryError(400, 'Ngày giờ giao không hợp lệ hoặc đã qua.');
  }

  const minutesUntilDelivery = Math.floor((deliveryAt.getTime() - now.getTime()) / 60_000);
  if (minutesUntilDelivery < 60) {
    throw new InventoryError(400, 'Đơn giao gấp cần chọn thời gian sau hiện tại ít nhất 1 giờ.');
  }
  const local = vnParts(deliveryAt);
  const outsideHours = local.hour < 8 || local.hour >= 22;
  const sameDay = dayKey(deliveryAt) === dayKey(now);
  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  let scheduleClass: DeliveryScheduleClass = 'NORMAL';
  let priority: 'NORMAL' | 'HIGH' = 'NORMAL';

  if (outsideHours) {
    scheduleClass = 'OUTSIDE_HOURS';
    priority = minutesUntilDelivery < 180 ? 'HIGH' : 'NORMAL';
    reasonCodes.push('OUTSIDE_SHOP_HOURS');
    reasons.push('Lịch giao nằm ngoài giờ hoạt động 08:00–22:00 và cần Sales xác nhận phương án vận chuyển.');
  } else if (minutesUntilDelivery < 180) {
    scheduleClass = 'EXCEPTION_UNDER_3H';
    priority = 'HIGH';
    reasonCodes.push('LEAD_TIME_UNDER_3H');
    reasons.push('Đơn giao gấp từ 1 đến dưới 3 giờ cần Sales kiểm tra khả năng chuẩn bị và vận chuyển.');
  } else if (!sameDay) {
    scheduleClass = 'FUTURE_UNCERTAIN';
    reasonCodes.push('FUTURE_SUPPLY_UNVERIFIED');
    reasons.push('Lịch giao ở ngày tương lai cần xác minh nguồn hoa, chất lượng và lịch chuẩn bị.');
  }

  return {
    scheduleClass,
    priority,
    requiresSales: scheduleClass !== 'NORMAL',
    reasonCodes,
    reasons,
    deliveryAt: deliveryAt.toISOString(),
    evaluatedAt: now.toISOString(),
    timezone: VN_TZ,
    minutesUntilDelivery,
  };
}
