import { inject } from '@angular/core';
import { RedirectFunction, Router } from '@angular/router';

/** Các mục trong trang tài khoản (KH19): mỗi mục là một URL /account/<mục>. */
export type AccountSection =
  | 'profile'
  | 'orders'
  | 'order-history'
  | 'addresses'
  | 'wishlist'
  | 'vouchers'
  | 'points'
  | 'change-password';

export const DEFAULT_ACCOUNT_SECTION: AccountSection = 'profile';

export const ACCOUNT_SECTIONS: readonly { key: AccountSection; label: string; icon: string }[] = [
  { key: 'profile', label: 'Hồ sơ', icon: 'bi-person' },
  { key: 'orders', label: 'Đơn hàng của tôi', icon: 'bi-bag' },
  { key: 'order-history', label: 'Lịch sử đơn hàng', icon: 'bi-clock-history' },
  { key: 'addresses', label: 'Địa chỉ', icon: 'bi-geo-alt' },
  { key: 'wishlist', label: 'Wishlist', icon: 'bi-heart' },
  { key: 'vouchers', label: 'Voucher', icon: 'bi-ticket-perforated' },
  { key: 'points', label: 'Điểm & hạng thành viên', icon: 'bi-gift' },
  { key: 'change-password', label: 'Đổi mật khẩu', icon: 'bi-shield-lock' },
];

/** Tên mục cũ (?section=… hoặc #fragment) → mục mới, để các link cũ vẫn chạy. */
const LEGACY_ALIASES: Record<string, AccountSection> = {
  thongtin: 'profile',
  'ho-so': 'profile',
  donhang: 'orders',
  'lich-su': 'order-history',
  history: 'order-history',
  diachi: 'addresses',
  voucher: 'vouchers',
  diem: 'points',
  hang: 'points',
  'member-reward': 'points',
  'doi-mat-khau': 'change-password',
};

export function resolveAccountSection(value: unknown): AccountSection | null {
  const key = String(value ?? '').trim().replace(/^#/, '');
  if (!key) return null;
  if (ACCOUNT_SECTIONS.some(section => section.key === key)) return key as AccountSection;
  return LEGACY_ALIASES[key] ?? null;
}

/** /account?section=diem hoặc /account#hang → /account/points. */
export const accountLegacyRedirect: RedirectFunction = ({ queryParams, fragment }) =>
  inject(Router).createUrlTree([
    '/account',
    resolveAccountSection(queryParams['section']) ?? resolveAccountSection(fragment) ?? DEFAULT_ACCOUNT_SECTION,
  ]);
