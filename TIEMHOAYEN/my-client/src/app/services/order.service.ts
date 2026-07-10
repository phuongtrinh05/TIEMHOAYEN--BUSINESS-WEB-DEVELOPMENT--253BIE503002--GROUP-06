import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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
  private readonly apiUrl = 'https://tiem-hoa-yen-api.onrender.com/api/orders';

  constructor(private http: HttpClient) {}

  createOrder(payload: CreateOrderPayload): Observable<CreateOrderResponse> {
    return this.http.post<CreateOrderResponse>(this.apiUrl, payload);
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
