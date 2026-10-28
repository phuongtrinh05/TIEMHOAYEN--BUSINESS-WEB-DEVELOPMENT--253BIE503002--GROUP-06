import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { apiBaseUrl } from './api-config';
import { OrderAccessService } from './order-access.service';
import { SalesChatService } from './sales-chat.service';
import { Router } from '@angular/router';

export interface CreateOrderItemPayload {
  id: string;
  name?: string;
  qty: number;
  price: number;
}

export interface CreateOrderPayload {
  customerId: string | null;
  receiver: {
    name: string;
    phone: string;
    address: string;
  };
  sender: {
    name: string;
    phone: string;
    email?: string;
  };
  delivery: {
    date: string;
    time: string;
    message?: string;
    noteShop?: string;
  };
  items: CreateOrderItemPayload[];
  voucher?: {
    id?: string;
    code?: string;
    type?: string;
    value?: number;
  } | null;
  summary: {
    subtotal: number;
    shippingFee: number;
    depositAmount: number;
    loyaltyPoints?: number;
    loyaltyDiscount?: number;
    total: number;
  };
  payment: {
    method: string;
    methodName: string;
    amountToPay: number;
  };
  flags: {
    hideSender: boolean;
    requestVAT: boolean;
    sendZaloPhoto: boolean;
  };
}

export interface CreateOrderResponse {
  checkoutAccessToken?: string;
  kind?: 'order' | 'sales_request';
  requestId?: string;
  accessToken?: string;
  message: string;
  orderId: string;
  paymentId: string;
  transactionCode: string;
  paymentAmount: number;
  paymentDeadline: string;
  paymentStatus: string;
  orderStatus: string;
  paymentWindowSeconds: number;
}

export interface OrderPaymentStatusResponse {
  orderId: string;
  paymentId: string;
  transactionCode: string;
  paymentAmount: number;
  paymentStatus: string;
  orderStatus: string;
  remainingSeconds: number;
}



export interface OrderDetailProductResponse {
  SAN_PHAM_ID: string;
  SO_LUONG: number;
  GIA: number;
  TEN_SAN_PHAM?: string | null;
  KIEU_DANG?: string | null;
  TRANG_THAI_SAN_PHAM?: string | null;
  HINH_ANH?: string | null;
}

export interface OrderDetailVoucherResponse {
  VOUCHER_ID: string;
  MA_VOUCHER?: string | null;
  LOAI_GIAM_GIA?: string | null;
  GIA_TRI_GIAM?: number | null;
  MO_TA?: string | null;
}

export interface OrderDetailResponse {
  order: any;
  products: OrderDetailProductResponse[];
  vouchers: OrderDetailVoucherResponse[];
  payment: any;
  summary: any;
}
export interface UpdateShippingPayload {
  receiver: string;
  phone: string;
  address: string;
  deliveryDate: string;
  deliveryTime: string;
}
@Injectable({
  providedIn: 'root',
})
export class OrderService {
  private get apiUrl(): string {
    return `${apiBaseUrl()}/orders`;
  }

  constructor(private http: HttpClient, private salesChat: SalesChatService, private access: OrderAccessService, private router: Router) {}

  createOrder(payload: CreateOrderPayload): Observable<CreateOrderResponse> {
    if (!payload.customerId && this.access.session?.authType === 'member') payload = { ...payload, customerId: this.access.session.customerId! };
    const fingerprint = JSON.stringify(payload);
    let pending: { fingerprint: string; key: string } | null = null;
    try { pending = JSON.parse(sessionStorage.getItem('pendingOrderSession') || 'null'); } catch {}
    if (pending?.fingerprint !== fingerprint) {
      pending = { fingerprint, key: crypto.randomUUID() };
      sessionStorage.setItem('pendingOrderSession', JSON.stringify(pending));
    }
    return this.http.post<CreateOrderResponse>(this.apiUrl, { ...payload, checkoutSessionId: pending!.key }).pipe(tap(result => {
      if (result.checkoutAccessToken) sessionStorage.setItem(`checkoutOrderAccess:${result.orderId}`, result.checkoutAccessToken);
      if (result.kind !== 'sales_request') sessionStorage.removeItem('pendingOrderSession');
      if (result.kind === 'sales_request') {
        const phone = String(payload.sender.phone || '').replace(/\D/g, '').replace(/^84/, '0');
        const member = payload.customerId && this.access.session?.authType === 'member' && this.access.session.customerId === payload.customerId;
        if (!member && this.access.session?.phone !== phone) {
          this.access.logout();
          sessionStorage.setItem('pendingSalesLookup', JSON.stringify({ requestId: result.requestId, phone }));
          this.salesChat.assistant();
          this.router.navigate(['/order-requests']);
        } else this.salesChat.open(result.requestId!);
      }
    }));
  }

  getSalesRequest(requestId: string, token: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/requests/${encodeURIComponent(requestId)}`, { headers: { 'x-request-token': token } });
  }
  openSalesChat(requestId: string): void {
    if (!this.access.session) { this.salesChat.assistant(); this.router.navigate(['/order-requests']); return; }
    this.salesChat.open(requestId);
  }
  updateSalesRequest(id: string, token: string, body: any): Observable<any> {
    return this.http.patch(`${this.apiUrl}/requests/${encodeURIComponent(id)}`, body, { headers: { 'x-request-token': token } });
  }
  closeSalesChat(): void { this.salesChat.assistant(); }
  respondSalesRequest(id: string, token: string, quoteId: string, action: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/requests/${encodeURIComponent(id)}/respond`, { quoteId, action }, { headers: { 'x-request-token': token } });
  }
  getRequestMessages(id: string, token: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/requests/${encodeURIComponent(id)}/messages`, { headers: { 'x-request-token': token } });
  }
  sendRequestMessage(id: string, token: string, text: string, messageId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/requests/${encodeURIComponent(id)}/messages`, { text, messageId }, { headers: { 'x-request-token': token } });
  }
  assetUrl(url: string): string {
    if (!url) return 'assets/images/hoa.jpg';
    return url.startsWith('/uploads/') ? `${this.apiUrl.split('/api/')[0]}${url}` : url;
  }

  getPaymentStatus(orderId: string): Observable<OrderPaymentStatusResponse> {
    return this.http.get<OrderPaymentStatusResponse>(`${this.apiUrl}/${orderId}/payment-status`);
  }

  expirePayment(orderId: string): Observable<OrderPaymentStatusResponse> {
    return this.http.put<OrderPaymentStatusResponse>(`${this.apiUrl}/${orderId}/payment-expired`, {});
  }

  markPaymentSuccess(orderId: string): Observable<OrderPaymentStatusResponse> {
    return this.http.put<OrderPaymentStatusResponse>(`${this.apiUrl}/${orderId}/payment-success`, {});
  }

  retryPayment(orderId: string): Observable<CreateOrderResponse> {
    return this.http.put<CreateOrderResponse>(`${this.apiUrl}/${orderId}/payment-retry`, {});
  }

  getOrderDetail(orderId: string, phone = ''): Observable<OrderDetailResponse> {
    const query = phone ? `?phone=${encodeURIComponent(phone)}` : '';
    return this.http.get<OrderDetailResponse>(`${this.apiUrl}/${orderId}/detail${query}`);
  }

  cancelOrder(orderId: string): Observable<{ message: string; orderStatus: string }> {
    return this.http.put<{ message: string; orderStatus: string }>(
      `${this.apiUrl}/${orderId}/cancel`,
      {}
    );
  }
  updateShippingInfo(orderId: string, payload: UpdateShippingPayload): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      `${this.apiUrl}/${orderId}/shipping`,
      payload
    );
  }
}
