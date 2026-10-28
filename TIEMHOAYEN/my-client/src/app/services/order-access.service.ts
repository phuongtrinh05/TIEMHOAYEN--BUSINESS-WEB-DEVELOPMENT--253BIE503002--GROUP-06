import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { apiBaseUrl, orderAccessSession } from './api-config';
import { tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class OrderAccessService {
  private http = inject(HttpClient);
  constructor() {
    if (typeof localStorage === 'undefined') return;
    for (const key of Object.keys(localStorage)) if (key === 'tiemHoaYenSalesRequest' || key.startsWith('tiemHoaYenSalesRequest:')) localStorage.removeItem(key);
  }
  get session() { return orderAccessSession(); }
  requestOtp(phone: string) { return this.http.post<any>(`${apiBaseUrl()}/orders/lookup/otp`, { phone }); }
  verify(challengeId: string, code: string) {
    return this.http.post<any>(`${apiBaseUrl()}/orders/lookup/verify`, { challengeId, code }).pipe(tap(data => {
      sessionStorage.setItem('orderLookupAccess', JSON.stringify({ ...data, accountKey: localStorage.getItem('khachHang') || '' }));
    }));
  }
  history(page = 1) { return this.http.get<any>(`${apiBaseUrl()}/orders/lookup`, { params: { page } }); }
  logout() {
    const token = this.session?.accessToken;
    sessionStorage.removeItem('orderLookupAccess');
    sessionStorage.removeItem('tiemHoaYenActiveSalesChat');
    if (token) this.http.post(`${apiBaseUrl()}/orders/lookup/logout`, {}, { headers: { 'x-order-access': token } }).subscribe({ error: () => {} });
  }
}
