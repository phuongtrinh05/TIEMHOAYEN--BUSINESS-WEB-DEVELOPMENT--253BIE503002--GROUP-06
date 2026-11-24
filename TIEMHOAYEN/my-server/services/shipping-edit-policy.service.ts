import { InventoryError } from './inventory/helpers.js';
import { isWithinShopHours, URGENT_CONTACT_PHONE, workingMinutesBetween } from './delivery-policy.service.js';
import { slot24h } from './time-format.js';

/**
 * Quy tắc khách tự sửa lịch giao (ngày/khung giờ) trên trang chi tiết đơn:
 * - Lịch mới còn từ 24 giờ trở lên: cập nhật trực tiếp.
 * - Lịch mới còn từ 4 đến dưới 24 giờ: không cập nhật trực tiếp, khách liên hệ shop.
 * - Lịch hiện tại còn dưới 4 giờ làm việc (06:30–22:00): khóa sửa ngày/giờ, khách gọi shop.
 * - Không nhận giờ đã qua hoặc ngoài 06:30–22:00.
 * Mỗi đơn chỉ được sửa thông tin giao hàng một lần (kiểm tra ở controller).
 */
export const DIRECT_RESCHEDULE_MINUTES = 24 * 60;
export const LOCK_RESCHEDULE_MINUTES = 4 * 60;
export const RESCHEDULE_CONTACT_CODE = 'RESCHEDULE_CONTACT_SHOP';
export const RESCHEDULE_LOCKED_CODE = 'RESCHEDULE_LOCKED';
export const RESCHEDULE_CONTACT_MESSAGE = `Lịch giao mới cách hiện tại dưới 24 giờ nên shop cần kiểm tra hoa và người giao trước. Vui lòng liên hệ shop qua hotline ${URGENT_CONTACT_PHONE} hoặc chat để đổi lịch.`;
export const RESCHEDULE_LOCKED_MESSAGE = `Đơn sắp đến giờ giao (dưới 4 giờ làm việc) nên không đổi ngày/giờ trên website. Vui lòng gọi shop ${URGENT_CONTACT_PHONE}.`;

const dateKeyOf = (value: unknown): string => {
  if (!value) return '';
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const vn = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (vn) return `${vn[3]}-${vn[2]}-${vn[1]}`;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
};

/** Đầu và cuối khung giao theo giờ Việt Nam. Khung một mốc giờ thì đầu = cuối. */
export function deliveryWindow(dateValue: unknown, slotValue: unknown): { start: Date; end: Date } | null {
  const day = dateKeyOf(dateValue);
  const times = [...slot24h(slotValue).matchAll(/([01]\d|2[0-3]):[0-5]\d/g)].map(match => match[0]);
  if (!day || !times.length) return null;
  const start = new Date(`${day}T${times[0]}:00+07:00`);
  const end = new Date(`${day}T${(times[1] || times[0])}:00+07:00`);
  return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) ? { start, end } : null;
}

export type RescheduleMode = 'direct' | 'contact' | 'locked';

/** Cho giao diện biết khách còn tự đổi lịch được không, dựa trên lịch đang chốt. */
export function rescheduleModeForOrder(order: any, now = new Date()): RescheduleMode {
  const current = deliveryWindow(order?.NGAY_MUON_GIAO, order?.KHUNG_GIO_MUON_GIAO);
  if (!current) return 'direct';
  if (current.start.getTime() <= now.getTime() || workingMinutesBetween(now, current.start) < LOCK_RESCHEDULE_MINUTES) return 'locked';
  return 'direct';
}

/**
 * Kiểm tra lịch mới khi khách gửi sửa thông tin giao hàng.
 * Trả về `changed` để controller biết có đổi ngày/giờ hay chỉ đổi người nhận/địa chỉ.
 */
export function assertCustomerReschedule(order: any, deliveryDate: unknown, deliveryTime: unknown, now = new Date()) {
  const currentDay = dateKeyOf(order?.NGAY_MUON_GIAO);
  const currentSlot = slot24h(order?.KHUNG_GIO_MUON_GIAO);
  const nextDay = deliveryDate ? dateKeyOf(deliveryDate) : currentDay;
  const nextSlot = deliveryTime ? slot24h(deliveryTime) : currentSlot;
  const changed = nextDay !== currentDay || nextSlot !== currentSlot;
  if (!changed) return { changed: false as const };

  if (rescheduleModeForOrder(order, now) === 'locked') {
    throw new InventoryError(409, RESCHEDULE_LOCKED_MESSAGE, { code: RESCHEDULE_LOCKED_CODE, phone: URGENT_CONTACT_PHONE });
  }
  const next = deliveryWindow(nextDay, nextSlot);
  if (!next) throw new InventoryError(400, 'Ngày hoặc khung giờ giao không hợp lệ.');
  if (next.start.getTime() <= now.getTime()) throw new InventoryError(400, 'Thời gian giao mới đã qua. Vui lòng chọn lại.');
  if (!isWithinShopHours(next.start, next.end)) throw new InventoryError(400, 'Shop chỉ giao hàng từ 06:30 đến 22:00. Vui lòng chọn lại giờ giao.');
  const minutes = (next.start.getTime() - now.getTime()) / 60_000;
  if (workingMinutesBetween(now, next.start) < LOCK_RESCHEDULE_MINUTES) {
    throw new InventoryError(409, `Lịch giao mới còn dưới 4 giờ làm việc. Vui lòng gọi shop ${URGENT_CONTACT_PHONE}.`, { code: RESCHEDULE_LOCKED_CODE, phone: URGENT_CONTACT_PHONE });
  }
  if (minutes < DIRECT_RESCHEDULE_MINUTES) {
    throw new InventoryError(409, RESCHEDULE_CONTACT_MESSAGE, { code: RESCHEDULE_CONTACT_CODE, phone: URGENT_CONTACT_PHONE });
  }
  return { changed: true as const, day: nextDay, slot: nextSlot };
}
