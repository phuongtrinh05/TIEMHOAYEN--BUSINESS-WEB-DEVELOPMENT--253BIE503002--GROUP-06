import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { apiBaseUrl } from './api-config';

export interface ServerQuote {
  items: Array<{ id: string; lineKey: string; unitPrice: number; regularPrice: number; priceChanged: boolean; availability?: { decision?: string; sellable?: number; reasons?: string[] } }>;
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
const URGENT_LEAD_MS = 4 * 60 * 60 * 1000;

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

/** Khung 30 phút trong 08:00–22:00; ngày hôm nay chỉ còn các giờ chưa qua. */
export function deliveryTimeSlots(isoDate: string, now = new Date()): string[] {
  const slots: string[] = [];
  for (let minutes = 8 * 60; minutes <= 22 * 60; minutes += 30) {
    slots.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  if (!isoDate) return slots;
  return slots.filter(slot => {
    const at = vnDeliveryDate(isoDate, slot);
    return !!at && at.getTime() > now.getTime();
  });
}

/** Lịch giao còn dưới 4 giờ: không nhận online, khách gọi shop. */
export function isUrgentDelivery(isoDate: string, time: string, now = new Date()): boolean {
  const at = vnDeliveryDate(isoDate, time);
  return !!at && at.getTime() > now.getTime() && at.getTime() - now.getTime() < URGENT_LEAD_MS;
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
