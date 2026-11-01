import { apiBaseUrl, currentOrderAccountKey, orderAccessSession } from './api-config';

/**
 * Phiên đăng nhập thành viên dùng chung một token với main (oa_..., trả về khi đăng nhập):
 * - lưu ở localStorage 'token' (bền qua tab) và sessionStorage 'orderLookupAccess'.
 * Backend nhận token này qua header x-order-access để xác định khách hàng.
 */
export function memberAccessToken(): string {
  if (typeof localStorage === 'undefined') return '';
  const session = orderAccessSession();
  if (session?.authType === 'member' && session.customerId === currentOrderAccountKey()) return session.accessToken;
  const token = localStorage.getItem('token') || '';
  return currentOrderAccountKey() && /^oa_[a-f0-9]{64}$/.test(token) ? token : '';
}

/** Thu hồi phiên hiện tại trên server và xoá dữ liệu phiên cũ ở trình duyệt. */
export function endSession(): void {
  if (typeof localStorage === 'undefined') return;
  const token = localStorage.getItem('token');
  if (token && /^oa_[a-f0-9]{64}$/.test(token)) {
    void fetch(`${apiBaseUrl()}/orders/lookup/logout`, { method: 'POST', headers: { 'x-order-access': token }, keepalive: true }).catch(() => {});
  }
  localStorage.removeItem('token');
  localStorage.removeItem('khachHang');
  [
    'tiemHoaYenRegistrantOrder', 'tiemHoaYenGuestOrder', 'tiemHoaYenCreatedOrder',
    'tiemHoaYenCheckoutItems', 'tiemHoaYenSessionAuth', 'forgotPhone',
    'tiemHoaYenCart', 'tiemHoaYenGuestConversationId', 'tiemHoaYenProductChatContext',
    'tiemHoaYenRecentViewed'
  ].forEach(key => {
    localStorage.removeItem(key); sessionStorage.removeItem(key);
  });
  Object.keys(localStorage)
    .filter(key => key.startsWith('tiemHoaYenChatHistory:') || key.startsWith('tiemHoaYenGuestOrder:') || key.startsWith('guestOrder:'))
    .forEach(key => localStorage.removeItem(key));
  sessionStorage.removeItem('passwordResetToken');
  Object.keys(sessionStorage)
    .filter(key => key.startsWith('guestOrder:') || key.startsWith('tiemHoaYenGuestOrder:'))
    .forEach(key => sessionStorage.removeItem(key));
  window.dispatchEvent(new Event('auth-changed'));
}
