import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { apiBaseUrl } from './api-config';

export interface ServerQuote {
  items: Array<{ id: string; lineKey: string; unitPrice: number; regularPrice: number; priceChanged: boolean; availability?: { decision?: string; sellable?: number; reasons?: string[] } }>;
  subtotal: number;
  shippingFee: number;
  productDiscount: number;
  shippingDiscount: number;
  total: number;
  voucherResult: any | null;
}

@Injectable({ providedIn: 'root' })
export class PricingService {
  constructor(private http: HttpClient) {}
  quote(payload: { items: Array<{ id: string; quantity: number; lineKey?: string; variantId?: string | null; designId?: string | null; configuration?: Record<string, unknown>; displayedUnitPrice?: number }>; shippingFee: number; voucher?: any; customerId?: string | null }): Observable<ServerQuote> {
    return this.http.post<ServerQuote>(`${apiBaseUrl()}/orders/quote`, payload);
  }
}
