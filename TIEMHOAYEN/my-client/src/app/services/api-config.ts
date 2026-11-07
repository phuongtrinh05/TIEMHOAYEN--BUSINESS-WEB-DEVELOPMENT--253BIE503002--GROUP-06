import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { endSession, memberAccessToken } from './session-auth';
import { AppErrorService } from './app-error.service';

/** Trang chỉ dành cho thành viên: khi phiên hết hạn (401) mới chuyển về /login. */
const MEMBER_ONLY_ROUTES = /^\/account(?:[/?#]|$)/;

export type OrderAccessSession = { accessToken: string; phone: string; expiresAt: string; accountKey: string; authType?: string; customerId?: string; readOnly?: boolean; orderId?: string; requestId?: string };

// Phiên tra cứu OTP của khách vãng lai lưu trong sessionStorage: giữ được khi tải lại trang,
// tự mất khi đóng tab, khi hết hạn (expiresAt do server cấp) hoặc khi đăng nhập thành viên.
// Khách dùng máy chung nên bấm "Thoát tra cứu" (logout) để xóa ngay.
let transientGuestLookup: OrderAccessSession | null = null;

export function setTransientGuestLookupSession(value: OrderAccessSession | null) {
  transientGuestLookup = value;
  if (typeof sessionStorage === 'undefined') return;
  if (value && value.authType === 'guest_lookup') { sessionStorage.setItem('orderLookupAccess', JSON.stringify(value)); sessionStorage.setItem('orderLookupAliveAt', String(Date.now())); }
  else if (safeStoredOrderAccess()?.authType === 'guest_lookup') sessionStorage.removeItem('orderLookupAccess');
}

function safeStoredOrderAccess(): OrderAccessSession | null {
  try { return JSON.parse(sessionStorage.getItem('orderLookupAccess') || 'null'); } catch { return null; }
}

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
  const router = inject(Router, { optional: true });
  const appErrors = inject(AppErrorService, { optional: true });
  const prefix = /^https?:\/\/(?:tiem-hoa-yen-api\.onrender\.com|localhost:3000)\/api(?=\/|$)/;
  let target = prefix.test(request.url) ? request.clone({ url: request.url.replace(prefix, apiBaseUrl()) }) : request;
  if ((/^\/cart(?:s)?(?:\/|$)/.test(target.url.slice(apiBaseUrl().length)) || target.url.startsWith(`${apiBaseUrl()}/orders`) || target.url.startsWith(`${apiBaseUrl()}/support`) || target.url.startsWith(`${apiBaseUrl()}/lucky/`) || target.url.startsWith(`${apiBaseUrl()}/customers/`) || target.url.startsWith(`${apiBaseUrl()}/notifications`)) && target.url.startsWith(`${apiBaseUrl()}/`) && typeof sessionStorage !== 'undefined') {
    const session = orderAccessSession();
    if (session) target = target.clone({ setHeaders: { 'x-order-access': session.accessToken } });
    else {
      const memberToken = memberAccessToken();
      if (memberToken) target = target.clone({ setHeaders: { 'x-order-access': memberToken } });
    }
    const payment = target.url.match(/\/orders\/([^/?]+)\/payment-(status|expired|retry)(?:\?|$)/);
    const checkout = payment ? sessionStorage.getItem(`checkoutOrderAccess:${decodeURIComponent(payment[1])}`) : null;
    if (checkout) target = target.clone({ setHeaders: { 'x-checkout-access': checkout } });
  }
  // /api/auth/* (me, logout, change-password…) xác thực bằng Bearer token của thành viên.
  if (target.url.startsWith(`${apiBaseUrl()}/auth/`) && !target.url.startsWith(`${apiBaseUrl()}/auth/admin/`) && !target.headers.has('Authorization')) {
    const memberToken = memberAccessToken();
    if (memberToken) target = target.clone({ setHeaders: { Authorization: `Bearer ${memberToken}` } });
  }
  const isApiRequest = target.url.startsWith(`${apiBaseUrl()}/`);
  return next(target).pipe(tap({
    error: (error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) return;
      // Phiên thành viên hết hạn/bị thu hồi: đăng xuất để người dùng đăng nhập lại.
      const sentToken = target.headers.get('x-order-access') || target.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
      if (error.status === 401 && sentToken && sentToken === memberAccessToken() && currentOrderAccountKey() && !target.url.includes('/customers/login')) {
        endSession();
        // Chỉ rời trang khi đang ở trang dành riêng cho thành viên; trang công khai giữ nguyên.
        if (router && MEMBER_ONLY_ROUTES.test(router.url)) void router.navigate(['/login']);
        return;
      }
      if (!isApiRequest || !appErrors) return;
      // KH33: lỗi mạng / máy chủ / không có quyền → banner có thể đóng, không điều hướng.
      // 404 của API do từng component tự xử lý ("không tìm thấy dữ liệu").
      if (error.status === 0) { appErrors.show('network'); return; }
      // Lỗi nghiệp vụ có thông báo cụ thể từ server (vd. chưa gửi được mã) đã được trang hiển thị tại chỗ,
      // không bật thêm banner chung. Chỉ dùng banner khi server không giải thích được lỗi.
      const body: any = (error as any).error;
      const explained = body && typeof body === 'object' && typeof body.message === 'string' && body.message && body.code !== 'SERVER_ERROR';
      if (explained) return;
      if (error.status >= 500) appErrors.show('server');
      else if (error.status === 403) appErrors.show('forbidden');
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
  setTransientGuestLookupSession(null);
  sessionStorage.removeItem('orderLookupAccess');
  sessionStorage.removeItem('tiemHoaYenActiveSalesChat');
  sessionStorage.removeItem('pendingSalesLookup');
  sessionStorage.removeItem('pendingOrderSession');
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith('checkoutOrderAccess:') || key.startsWith('guestRequestLink:')) sessionStorage.removeItem(key);
  }
  for (const key of ['tiemHoaYenRegistrantOrder', 'tiemHoaYenGuestOrder', 'tiemHoaYenCreatedOrder', 'tiemHoaYenCompletedOrder', 'tiemHoaYenFailedOrder']) localStorage.removeItem(key);
  if (token) void fetch(`${apiBaseUrl()}/orders/lookup/logout`, { method: 'POST', headers: { 'x-order-access': token } }).catch(() => {});
}
/* ===== Chặn mở lại tra cứu sau khi đã đóng tab =====
 * sessionStorage mất khi đóng tab, NHƯNG Chrome "Mở lại tab đã đóng" (Ctrl+Shift+T) và khôi phục
 * phiên trình duyệt sẽ trả lại nó. Tab đang mở ghi nhịp 10 giây/lần; mở lại mà nhịp cũ hơn
 * 45 giây (tab đã đóng) thì xoá phiên tra cứu và thu hồi token. Tải lại trang (F5) vẫn giữ.
 */
const LOOKUP_ALIVE_KEY = 'orderLookupAliveAt';
const LOOKUP_STALE_MS = 45_000;
let lookupHeartbeat: ReturnType<typeof setInterval> | null = null;

export function guardGuestLookupTab(now = Date.now()): void {
  if (typeof sessionStorage === 'undefined' || typeof window === 'undefined') return;
  const stored = safeStoredOrderAccess();
  if (stored?.authType === 'guest_lookup') {
    const aliveAt = Number(sessionStorage.getItem(LOOKUP_ALIVE_KEY) || 0);
    if (!aliveAt || now - aliveAt > LOOKUP_STALE_MS) {
      transientGuestLookup = null;
      sessionStorage.removeItem('orderLookupAccess');
      sessionStorage.removeItem(LOOKUP_ALIVE_KEY);
      if (/^oa_[a-f0-9]{64}$/.test(stored.accessToken)) {
        void fetch(`${apiBaseUrl()}/orders/lookup/logout`, { method: 'POST', headers: { 'x-order-access': stored.accessToken }, keepalive: true }).catch(() => {});
      }
    }
  }
  const beat = () => {
    if (safeStoredOrderAccess()?.authType === 'guest_lookup') sessionStorage.setItem(LOOKUP_ALIVE_KEY, String(Date.now()));
    else sessionStorage.removeItem(LOOKUP_ALIVE_KEY);
  };
  beat();
  if (!lookupHeartbeat) {
    lookupHeartbeat = setInterval(beat, 10_000);
    // Ghi nhịp ngay trước khi tải lại / rời trang để F5 không bị coi là tab cũ.
    window.addEventListener('pagehide', beat);
  }
}

export function orderAccessSession(): OrderAccessSession | null {
  try {
    const accountKey = currentOrderAccountKey();
    if (transientGuestLookup && transientGuestLookup.authType === 'guest_lookup' && !accountKey
      && /^(?:oa)_[a-f0-9]{64}$/.test(transientGuestLookup.accessToken)
      && new Date(transientGuestLookup.expiresAt).getTime() > Date.now()) return transientGuestLookup;
    if (transientGuestLookup) transientGuestLookup = null;
    const value = safeStoredOrderAccess();
    // Khôi phục phiên tra cứu OTP sau khi tải lại trang (chỉ khi chưa đăng nhập thành viên và còn hạn).
    if (value?.authType === 'guest_lookup') {
      if (!accountKey && /^oa_[a-f0-9]{64}$/.test(value.accessToken) && new Date(value.expiresAt).getTime() > Date.now()) {
        transientGuestLookup = value;
        return value;
      }
      sessionStorage.removeItem('orderLookupAccess');
      return null;
    }
    if (value && /^(?:oa|ra)_[a-f0-9]{64}$/.test(value.accessToken) && new Date(value.expiresAt).getTime() > Date.now() && value.accountKey === accountKey && (!accountKey || value.authType === 'member' && value.customerId === accountKey)) return value;
    sessionStorage.removeItem('orderLookupAccess');
  } catch {}
  return null;
}
