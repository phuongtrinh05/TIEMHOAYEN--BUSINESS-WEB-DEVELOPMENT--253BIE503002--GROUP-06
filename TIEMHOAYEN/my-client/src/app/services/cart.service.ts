import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CartApiItem {
  THIET_KE_3D_ID?: string; CAN_SHOP_DUYET?: boolean; BADGES?: string[];
  SAN_PHAM_ID: string;
  TEN_SAN_PHAM: string;
  KIEU_DANG?: string | null;
  TRANG_THAI?: string | null;
  GIA: number;
  GIA_KHUYEN_MAI?: number | null;
  HINH_ANH?: string | null;
  CHU_DE_ID?: string | null;
  TEN_CHU_DE?: string | null;
  SO_LUONG: number;
  SO_LUONG_TON?: number | null;
  TON_KHA_DUNG?: number | null;
  TON_THANH_PHAM_KHA_DUNG?: number | null;
  SO_BO_CO_THE_LAM?: number | null;
}

export interface CartResponse {
  cartId: string;
  items: CartApiItem[];
}

@Injectable({
  providedIn: 'root',
})
export class CartService {
  private readonly apiUrl = 'https://tiem-hoa-yen-api.onrender.com/api/cart';

  constructor(private http: HttpClient) {}

  getCart(customerId: string): Observable<CartResponse> {
    return this.http.get<CartResponse>(
      `${this.apiUrl}/customer/${customerId}`
    );
  }

  addItem(customerId: string, productId: string, quantity: number, line?: { lineKey?: string; variantId?: string | null; designId?: string | null; configuration?: Record<string, unknown> }): Observable<any> {
    return this.http.post(`${this.apiUrl}/add`, {
      customerId,
      productId,
      quantity,
      ...line,
    });
  }

  updateItem(customerId: string, productId: string, quantity: number, lineKey?: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/update`, {
      customerId,
      productId,
      quantity,
      lineKey,
    });
  }

  removeItem(customerId: string, productId: string, lineKey?: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/remove`, {
      body: {
        customerId,
        productId,
        lineKey,
      },
    });
  }
}
