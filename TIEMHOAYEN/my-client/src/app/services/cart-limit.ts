/** Giỏ hàng chứa tối đa 99 sản phẩm (cộng số lượng mọi dòng). Backend kiểm tra lại với giỏ của thành viên. */
export const MAX_CART_ITEMS = 99;
export const GUEST_CART_KEY = 'tiemHoaYenCart';

/** Tổng số sản phẩm đang có trong giỏ khách vãng lai (localStorage). */
export function guestCartTotal(): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const rows = JSON.parse(localStorage.getItem(GUEST_CART_KEY) || '[]');
    return Array.isArray(rows)
      ? rows.reduce((sum: number, row: any) => sum + Math.max(0, Math.floor(Number(row?.quantity ?? row?.qty ?? 0))), 0)
      : 0;
  } catch {
    return 0;
  }
}

export function cartLimitMessage(current: number): string {
  const left = Math.max(0, MAX_CART_ITEMS - current);
  return left > 0
    ? `Giỏ hàng tối đa ${MAX_CART_ITEMS} sản phẩm. Hiện có ${current}, bạn chỉ thêm được ${left} sản phẩm nữa.`
    : `Giỏ hàng đã đủ ${MAX_CART_ITEMS} sản phẩm. Vui lòng đặt hàng hoặc bớt sản phẩm trước khi thêm.`;
}
