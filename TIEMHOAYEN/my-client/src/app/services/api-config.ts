import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { tap } from 'rxjs';
import { endSession, memberAccessToken } from './session-auth';

export function apiBaseUrl(): string {
  try {
    const override = typeof localStorage !== 'undefined' ? localStorage.getItem('API_BASE_URL') : null;
    if (override && /^https?:\/\//.test(override)) return override.replace(/\/$/, '');
  } catch {}
  if (typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname)) return 'http://localhost:3000/api';
  return 'https://tiem-hoa-yen-api.onrender.com/api';
}

/** Keep catalog, login, cart and checkout on the same backend during local testing. */
export const apiEndpointInterceptor: HttpInterceptorFn = (request, next) => {
  const prefix = /^https?:\/\/(?:tiem-hoa-yen-api\.onrender\.com|localhost:3000)\/api(?=\/|$)/;
  let target = prefix.test(request.url) ? request.clone({ url: request.url.replace(prefix, apiBaseUrl()) }) : request;
  // Thành viên đã đăng nhập: gắn phiên cho mọi API để backend kiểm tra quyền sở hữu dữ liệu.
  const member = target.url.startsWith(`${apiBaseUrl()}/`) ? memberAccessToken() : '';
  if (member) target = target.clone({ setHeaders: { 'x-order-access': member } });
  if ((target.url.startsWith(`${apiBaseUrl()}/orders`) || target.url.startsWith(`${apiBaseUrl()}/support`) || target.url.startsWith(`${apiBaseUrl()}/lucky`) || target.url.startsWith(`${apiBaseUrl()}/customers/`) && /\/(?:orders|wishlist)(?:\/|\?|$)/.test(target.url)) && typeof sessionStorage !== 'undefined') {
    const storedAccessToken = getCustomerOrderAccessToken();
    if (storedAccessToken) target = target.clone({ setHeaders: { 'x-order-access': storedAccessToken } });
    const payment = target.url.match(/\/orders\/([^/?]+)\/payment-(status|expired|retry)(?:\?|$)/);
    const checkout = payment ? sessionStorage.getItem(`checkoutOrderAccess:${decodeURIComponent(payment[1])}`) : null;
    if (checkout) target = target.clone({ setHeaders: { 'x-checkout-access': checkout } });
  }
  return next(target).pipe(tap({
    error: (error: unknown) => {
      // Phiên thành viên hết hạn/bị thu hồi: đăng xuất để người dùng đăng nhập lại.
      if (member && error instanceof HttpErrorResponse && error.status === 401 && !target.url.includes('/customers/login')) endSession();
    },
  }));
};

export function getCustomerOrderAccessToken(): string | null {
  const sessionToken = orderAccessSession()?.accessToken;
  if (sessionToken) return sessionToken;
  if (typeof localStorage === 'undefined') return null;

  const token = localStorage.getItem('token');
  return token && /^oa_[a-f0-9]{64}$/.test(token) ? token : null;
}

export function currentOrderAccountKey(): string {
  try { return JSON.parse(localStorage.getItem('khachHang') || 'null')?.KHACH_HANG_ID || ''; } catch { return ''; }
}
export function endCustomerOrderSession() {
  const token = orderAccessSession()?.accessToken;
  sessionStorage.removeItem('orderLookupAccess');
  sessionStorage.removeItem('tiemHoaYenActiveSalesChat');
  sessionStorage.removeItem('pendingSalesLookup');
  if (token) void fetch(`${apiBaseUrl()}/orders/lookup/logout`, { method: 'POST', headers: { 'x-order-access': token } }).catch(() => {});
}
export function orderAccessSession(): { accessToken: string; phone: string; expiresAt: string; accountKey: string; authType?: string; customerId?: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem('orderLookupAccess') || 'null');
    const accountKey = currentOrderAccountKey();
    if (value && /^oa_[a-f0-9]{64}$/.test(value.accessToken) && new Date(value.expiresAt).getTime() > Date.now() && value.accountKey === accountKey && (!accountKey || value.authType === 'member' && value.customerId === accountKey)) return value;
    sessionStorage.removeItem('orderLookupAccess');
  } catch {}
  return null;
}
