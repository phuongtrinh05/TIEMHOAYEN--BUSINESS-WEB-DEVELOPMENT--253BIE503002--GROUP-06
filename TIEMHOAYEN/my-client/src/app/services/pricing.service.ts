import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { apiBaseUrl } from './api-config';

export interface ServerQuote {
  items: Array<{ id: string; lineKey: string; unitPrice: number; regularPrice: number; priceChanged: boolean; availableQty?: number | null; availability?: { decision?: string; sellable?: number; reasons?: string[] } }>;
  subtotal: number;
  shippingFee: number;
  productDiscount: number;
  shippingDiscount: number;
  total: number;
  voucherResult: any | null;
  /** Xem trước luồng đặt: thanh toán thẳng, cần Yêu cầu đặt hàng, hoặc bị chặn (giao gấp/ngoài giờ). */
  fulfillment?: QuoteFulfillment | null;
}

export interface AvailableVoucher {
  kind: 'voucher' | 'lucky';
  id: string;
  code: string;
  type?: string;
  value?: number;
  title?: string;
  prizeKind?: string;
  maxDiscount?: number;
  minimumOrder: number;
  personal?: boolean;
  endDate?: string | null;
  eligible: boolean;
  reason: string;
  estimatedDiscount: number;
}

export interface QuoteFulfillment {
  mode: 'direct' | 'request' | 'blocked';
  reasons?: string[];
  code?: string;
  message?: string;
  phone?: string | null;
}

/* ===== Quy tắc giờ giao phía khách (backend kiểm tra lại) ===== */
export const SHOP_PHONE = '0909477488';
export const URGENT_DELIVERY_MESSAGE = 'Đơn hàng của bạn giao gấp. Vui lòng liên hệ với số điện thoại';
const URGENT_LEAD_MINUTES = 4 * 60;
/** Giờ làm việc của shop (06:30–22:00): mốc 4 giờ trước giờ giao chỉ đếm thời gian trong khung này. */
export const WORK_OPEN_MINUTES = 6 * 60 + 30;
export const WORK_CLOSE_MINUTES = 22 * 60;
const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/** Số phút nằm trong giờ làm việc giữa hai thời điểm (giờ Việt Nam); giống backend workingMinutesBetween. */
export function workingMinutesBetween(from: Date | number, to: Date | number): number {
  const a = new Date(from).getTime(), b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  let total = 0;
  for (let day = Math.floor((a + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS; day < b; day += DAY_MS) {
    total += Math.max(0, Math.min(day + WORK_CLOSE_MINUTES * 60_000, b) - Math.max(day + WORK_OPEN_MINUTES * 60_000, a));
  }
  return Math.floor(total / 60_000);
}

/** Ngày hiện tại theo giờ Việt Nam, dạng YYYY-MM-DD. */
export function vnTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Thời điểm giao (giờ Việt Nam) từ ngày YYYY-MM-DD và giờ HH:MM. */
export function vnDeliveryDate(isoDate: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const value = new Date(`${isoDate}T${time}:00+07:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

/** Nhãn khung giờ giao: "08:00" → "08:00 - 08:30"; dữ liệu đã là khoảng thì giữ khoảng. */
export function deliverySlotLabel(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text || /(AM|PM)/i.test(text)) return text;
  const times = [...text.matchAll(/(\d{1,2}):([0-5]\d)/g)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
  if (!times.length) return text;
  if (times.length > 1) return `${times[0]} - ${times[1]}`;
  const end = Math.min(Number(times[0].slice(0, 2)) * 60 + Number(times[0].slice(3)) + 30, 24 * 60 - 1);
  return `${times[0]} - ${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

/** Khung 30 phút trong 06:30–22:00 (giá trị là giờ bắt đầu, khung cuối 21:30–22:00); hôm nay chỉ còn khung chưa bắt đầu. */
export function deliveryTimeSlots(isoDate: string, now = new Date()): string[] {
  const slots: string[] = [];
  for (let minutes = 6 * 60 + 30; minutes <= 22 * 60 - 30; minutes += 30) {
    slots.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  if (!isoDate) return slots;
  return slots.filter(slot => {
    const at = vnDeliveryDate(isoDate, slot);
    return !!at && at.getTime() > now.getTime();
  });
}

/** Giao trong 24 giờ kể từ bây giờ: Giao nhanh, số lượng giới hạn theo tồn khả thi. */
export function isWithin24h(isoDate: string, time: string, now = new Date()): boolean {
  const at = vnDeliveryDate(isoDate, time);
  return !!at && at.getTime() - now.getTime() < 24 * 60 * 60 * 1000;
}

/** Lịch giao còn dưới 4 giờ làm việc (06:30–22:00): không nhận online, khách gọi shop. */
export function isUrgentDelivery(isoDate: string, time: string, now = new Date()): boolean {
  const at = vnDeliveryDate(isoDate, time);
  return !!at && at.getTime() > now.getTime() && workingMinutesBetween(now, at) < URGENT_LEAD_MINUTES;
}

@Injectable({ providedIn: 'root' })
export class PricingService {
  constructor(private http: HttpClient) {}
  /** "Voucher có sẵn": mọi voucher khách thấy + ưu đãi vòng quay, kèm cờ dùng được và lý do (cùng luật với lúc đặt). */
  availableVouchers(payload: { items: Array<{ id: string; quantity: number }>; shippingFee: number; customerId?: string | null }): Observable<{ subtotal: number; vouchers: AvailableVoucher[] }> {
    return this.http.post<{ subtotal: number; vouchers: AvailableVoucher[] }>(`${apiBaseUrl()}/orders/vouchers/available`, payload);
  }
  quote(payload: { items: Array<{ id: string; quantity: number; lineKey?: string; variantId?: string | null; designId?: string | null; configuration?: Record<string, unknown>; displayedUnitPrice?: number }>; shippingFee: number; voucher?: any; customerId?: string | null; delivery?: { date: string; time: string }; receiver?: { address: string; districtName?: string; provinceName?: string }; payment?: { method: string } }): Observable<ServerQuote> {
    return this.http.post<{ items: ServerQuote['items']; summary: Omit<ServerQuote, 'items' | 'voucherResult' | 'fulfillment'>; voucherResult?: any; fulfillment?: QuoteFulfillment }>(`${apiBaseUrl()}/orders/quote`, payload).pipe(
      map(response => ({
        items: response.items,
        ...response.summary,
        voucherResult: response.voucherResult || null,
        fulfillment: response.fulfillment || null,
      })),
    );
  }
}
