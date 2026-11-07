/**
 * Lưu vết của khách vãng lai trên web (giỏ hàng, đơn đang thanh toán dở…):
 * giữ trong localStorage và hết hạn sau 30 ngày kể từ lần truy cập cuối.
 * Phiên tra cứu đơn hàng KHÔNG nằm ở đây: lưu trong sessionStorage nên đóng tab là mất.
 */
const LAST_VISIT_KEY = 'tiemHoaYenLastVisit';
export const GUEST_TRACE_TTL_MS = 30 * 24 * 3600 * 1000;
const GUEST_TRACE_KEYS = [
  'tiemHoaYenCart',
  'tiemHoaYenCheckoutItems',
  'tiemHoaYenGuestOrder',
  'tiemHoaYenCreatedOrder',
  'tiemHoaYenRegistrantOrder',
  'tiemHoaYenCompletedOrder',
  'tiemHoaYenFailedOrder',
];

export function touchGuestTrace(now = Date.now()): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const last = Number(localStorage.getItem(LAST_VISIT_KEY) || 0);
    const isMember = !!localStorage.getItem('khachHang');
    if (!isMember && last > 0 && now - last > GUEST_TRACE_TTL_MS) {
      for (const key of GUEST_TRACE_KEYS) localStorage.removeItem(key);
    }
    localStorage.setItem(LAST_VISIT_KEY, String(now));
  } catch {
    /* Bộ nhớ trình duyệt bị chặn: bỏ qua, web vẫn hoạt động. */
  }
}
