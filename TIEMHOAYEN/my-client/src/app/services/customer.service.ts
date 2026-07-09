import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Customer {
  KHACH_HANG_ID: string;
  TEN: string;
  EMAIL: string | null;
  SDT: string;
  MAT_KHAU: string;
  DOB: string | null;
  GIOI_TINH: string;
  NGAY_DANG_KY: string;
  LOAI_THANH_VIEN: string;
  DIEM_TICH_LUY: number;
  DIEM_THANH_VIEN?: number;
  AVATAR: string | null;
}

export interface CustomerAddress {
  DIA_CHI_ID: string;
  KHACH_HANG_ID: string;
  TEN_NGUOI_NHAN: string;
  SDT_NGUOI_NHAN: string;
  TINH_THANH: string;
  QUAN_HUYEN: string;
  PHUONG_XA: string;
  DIA_CHI_CHI_TIET: string;
  LA_MAC_DINH: boolean;
  DA_XOA?: boolean;
}

export interface CreateAddress {
  TEN_NGUOI_NHAN: string;
  SDT_NGUOI_NHAN: string;
  TINH_THANH: string;
  QUAN_HUYEN: string;
  PHUONG_XA: string;
  DIA_CHI_CHI_TIET: string;
  LA_MAC_DINH: boolean;
}

export interface CustomerOrder {
  DON_HANG_ID: string;
  NGAY_TAO: string;
  TAM_TINH: number;
  TONG_TIEN: number;
  TRANG_THAI: string;
}

export interface CustomerVoucher {
  VOUCHER_ID: string;
  KHACH_HANG_ID?: string | null;
  MA_VOUCHER: string;
  LOAI_GIAM_GIA: 'Phần trăm' | 'Tiền mặt' | string;
  GIA_TRI_GIAM: number | string;
  NGAY_BAT_DAU?: string | null;
  NGAY_KET_THUC?: string | null;
  DA_DUNG?: boolean | number;
}

export interface CustomerWishlistItem {
  SAN_PHAM_ID: string;
  TEN_SAN_PHAM: string;
  GIA: number;
  GIA_KHUYEN_MAI: number | null;
  HINH_ANH: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class CustomerService {
  private readonly apiUrl = 'http://localhost:3000/api/customers';

  constructor(private http: HttpClient) {}

  getById(id: string): Observable<Customer> {
    return this.http.get<Customer>(`${this.apiUrl}/${id}`);
  }

  updateById(
    id: string,
    data: Partial<Customer>
  ): Observable<{ message: string; customer: Customer }> {
    return this.http.put<{ message: string; customer: Customer }>(
      `${this.apiUrl}/${id}`,
      data
    );
  }

  getAddresses(id: string): Observable<CustomerAddress[]> {
    return this.http.get<CustomerAddress[]>(`${this.apiUrl}/${id}/addresses`);
  }

  addAddress(
    customerId: string,
    address: CreateAddress
  ): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiUrl}/${customerId}/addresses`,
      address
    );
  }

  deleteAddress(addressId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/addresses/${addressId}`
    );
  }

  updateAddress(
    addressId: string,
    address: CreateAddress
  ): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      `${this.apiUrl}/addresses/${addressId}`,
      address
    );
  }

  setDefaultAddress(addressId: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      `${this.apiUrl}/addresses/${addressId}/default`,
      {}
    );
  }

  getOrders(id: string): Observable<CustomerOrder[]> {
    return this.http.get<CustomerOrder[]>(`${this.apiUrl}/${id}/orders`);
  }

  getVouchers(customerId: string) {
    return this.http.get<CustomerVoucher[]>(
      `${this.apiUrl}/${customerId}/vouchers`
    );
  }

  getWishlist(id: string): Observable<CustomerWishlistItem[]> {
    return this.http.get<CustomerWishlistItem[]>(
      `${this.apiUrl}/${id}/wishlist`
    );
  }

  updateAvatar(
    id: string,
    file: File
  ): Observable<{ message: string; customer: Customer }> {
    const formData = new FormData();
    formData.append('avatar', file);

    return this.http.put<{ message: string; customer: Customer }>(
      `${this.apiUrl}/${id}/avatar`,
      formData
    );
  }

  removeAvatar(id: string): Observable<{ message: string; customer: Customer }> {
    return this.http.put<{ message: string; customer: Customer }>(
      `${this.apiUrl}/${id}/avatar/remove`,
      {}
    );
  }

  addWishlistItem(
    customerId: string,
    productId: string
  ): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiUrl}/${customerId}/wishlist/${productId}`,
      {}
    );
  }

  removeWishlistItem(
    customerId: string,
    productId: string
  ): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/${customerId}/wishlist/${productId}`
    );
  }
}
