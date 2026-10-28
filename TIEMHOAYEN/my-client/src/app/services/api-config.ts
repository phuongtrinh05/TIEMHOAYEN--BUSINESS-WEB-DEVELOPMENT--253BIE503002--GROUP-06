import { HttpInterceptorFn } from '@angular/common/http';

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
  if ((target.url.startsWith(`${apiBaseUrl()}/orders`) || target.url.startsWith(`${apiBaseUrl()}/customers/`) && /\/orders(?:\?|$)/.test(target.url)) && typeof sessionStorage !== 'undefined') {
    const session = orderAccessSession();
    if (session) target = target.clone({ setHeaders: { 'x-order-access': session.accessToken } });
    const payment = target.url.match(/\/orders\/([^/?]+)\/payment-(status|expired|retry)(?:\?|$)/);
    const checkout = payment ? sessionStorage.getItem(`checkoutOrderAccess:${decodeURIComponent(payment[1])}`) : null;
    if (checkout) target = target.clone({ setHeaders: { 'x-checkout-access': checkout } });
  }
  return next(target);
};

export function orderAccessSession(): { accessToken: string; phone: string; expiresAt: string; accountKey: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem('orderLookupAccess') || 'null');
    if (value && /^oa_[a-f0-9]{64}$/.test(value.accessToken) && new Date(value.expiresAt).getTime() > Date.now() && value.accountKey === (localStorage.getItem('khachHang') || '')) return value;
    sessionStorage.removeItem('orderLookupAccess');
  } catch {}
  return null;
}
