import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { apiBaseUrl, currentOrderAccountKey, orderAccessSession, setTransientGuestLookupSession } from './api-config';
import { tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class OrderAccessService {
  private http = inject(HttpClient);
  constructor() {
    if (typeof localStorage === 'undefined') return;
    for (const key of Object.keys(localStorage)) if (key === 'tiemHoaYenSalesRequest' || key.startsWith('tiemHoaYenSalesRequest:')) localStorage.removeItem(key);
  }
  get session() { return orderAccessSession(); }
  useRequestLink(accessToken: string, requestId: string, expiresAt?: string) {
    if (currentOrderAccountKey() || !/^ra_[a-f0-9]{64}$/.test(accessToken)) return false;
    sessionStorage.setItem('orderLookupAccess', JSON.stringify({ accessToken, authType: 'guest_request', accountKey: '', requestId,
      phone: '', expiresAt: expiresAt || new Date(Date.now() + 86400000).toISOString() }));
    sessionStorage.setItem(`guestRequestLink:${requestId}`, accessToken);
    return true;
  }
  requestOtp(phone: string, orderId?: string, requestId?: string) { return this.http.post<any>(`${apiBaseUrl()}/orders/lookup/otp`, { phone, orderId, requestId }); }
  verify(challengeId: string, code: string) {
    return this.http.post<any>(`${apiBaseUrl()}/orders/lookup/verify`, { challengeId, code }).pipe(tap(data => {
      const value = { ...data, accountKey: currentOrderAccountKey() };
      if (data.authType === 'guest_lookup') setTransientGuestLookupSession(value);
      else sessionStorage.setItem('orderLookupAccess', JSON.stringify(value));
    }));
  }
  history(page = 1, filters: { search?: string; status?: string; date?: string; pageSize?: number; scope?: string; group?: string } = {}) {
    const params: any = { page, pageSize: filters.pageSize || 20 };
    if (filters.search?.trim()) params.search = filters.search.trim();
    if (filters.status) params.status = filters.status;
    if (filters.date) params.date = filters.date;
    if (filters.scope) params.scope = filters.scope;
    if (filters.group) params.group = filters.group;
    return this.http.get<any>(`${apiBaseUrl()}/orders/lookup`, { params });
  }
  logout() {
    const token = this.session?.accessToken;
    setTransientGuestLookupSession(null);
    sessionStorage.removeItem('orderLookupAccess');
    sessionStorage.removeItem('tiemHoaYenActiveSalesChat');
    if (token) this.http.post(`${apiBaseUrl()}/orders/lookup/logout`, {}, { headers: { 'x-order-access': token } }).subscribe({ error: () => {} });
  }
}
