import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CartApiItem {
  SAN_PHAM_ID: string;
  TEN_SAN_PHAM: string;
  KIEU_DANG?: string | null;
  TRANG_THAI?: string | null;
  GIA: number;
  GIA_KHUYEN_MAI?: number | null;
  HINH_ANH?: string | null;
  SO_LUONG: number;
  SO_LUONG_TON?: number | null;
}

export interface CartResponse {
  cartId: string;
  items: CartApiItem[];
}

@Injectable({
  providedIn: 'root',
})
export class CartService {
  private readonly apiUrl = 'http://localhost:3000/api/cart';

  constructor(private http: HttpClient) {}

  getCart(customerId: string): Observable<CartResponse> {
    return this.http.get<CartResponse>(
      `${this.apiUrl}/customer/${customerId}`
    );
  }

  addItem(customerId: string, productId: string, quantity: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/add`, {
      customerId,
      productId,
      quantity,
    });
  }

  updateItem(customerId: string, productId: string, quantity: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/update`, {
      customerId,
      productId,
      quantity,
    });
  }

  removeItem(customerId: string, productId: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/remove`, {
      body: {
        customerId,
        productId,
      },
    });
  }
}
