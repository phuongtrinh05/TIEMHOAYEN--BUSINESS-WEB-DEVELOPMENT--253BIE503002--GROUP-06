import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { filter, tap } from 'rxjs';

const tokenKey = 'token';
const remote = 'https://tiem-hoa-yen-api.onrender.com';
export function apiOrigin(): string {
  return typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname)
    ? 'http://localhost:3000' : remote;
}
export function endSession(): void {
  const token = localStorage.getItem(tokenKey);
  if (token) void fetch(apiOrigin() + '/api/auth/logout', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, keepalive: true,
  }).catch(() => {});
  localStorage.removeItem(tokenKey);
  localStorage.removeItem('khachHang');
  [
    'tiemHoaYenRegistrantOrder', 'tiemHoaYenGuestOrder', 'tiemHoaYenCreatedOrder',
    'tiemHoaYenCheckoutItems', 'tiemHoaYenSessionAuth', 'forgotPhone',
    'tiemHoaYenCart', 'tiemHoaYenGuestConversationId', 'tiemHoaYenProductChatContext',
    'tiemHoaYenRecentViewed'
  ].forEach(key => {
    localStorage.removeItem(key); sessionStorage.removeItem(key);
  });
  if (typeof localStorage !== 'undefined') {
    Object.keys(localStorage)
      .filter(key => key.startsWith('tiemHoaYenChatHistory:') || key.startsWith('tiemHoaYenGuestOrder:') || key.startsWith('guestOrder:'))
      .forEach(key => localStorage.removeItem(key));
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('passwordResetToken');
    Object.keys(sessionStorage)
      .filter(key => key.startsWith('guestOrder:') || key.startsWith('tiemHoaYenGuestOrder:'))
      .forEach(key => sessionStorage.removeItem(key));
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('auth-changed'));
  }
}
export const sessionAuthInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(remote + '/api/')) return next(req);
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(tokenKey) : null;
  const orderId = req.url.match(/\/api\/orders\/([^/?]+)/)?.[1];
  const guestToken = typeof sessionStorage !== 'undefined' && orderId ? sessionStorage.getItem('guestOrder:' + orderId) : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (guestToken) headers['x-guest-token'] = guestToken;
  const request = req.clone({
    url: apiOrigin() + req.url.slice(remote.length),
    setHeaders: headers,
  });
  // Responses from an old account must never populate the new account's screen.
  return next(request).pipe(
    filter(() => typeof localStorage === 'undefined' || localStorage.getItem(tokenKey) === token),
    tap(event => {
      if (event instanceof HttpResponse && req.method === 'POST' && req.url.endsWith('/api/orders')) {
        const body = event.body as any;
        if (body?.guestToken && body?.orderId) sessionStorage.setItem('guestOrder:' + body.orderId, body.guestToken);
      }
    })
  );
};
