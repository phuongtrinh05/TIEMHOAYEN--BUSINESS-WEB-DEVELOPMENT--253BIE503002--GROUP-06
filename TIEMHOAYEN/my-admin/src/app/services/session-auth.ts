import { endAdminSession } from './api-config';

/** Kết thúc phiên Admin (thu hồi adminSessionToken trên server) và xoá dữ liệu đăng nhập cũ. */
export function endSession(): void {
  if (typeof localStorage === 'undefined') return;
  endAdminSession();
  localStorage.removeItem('adminToken');
  ['adminLoggedIn', 'adminEmployeeId', 'adminEmail', 'adminRole', 'adminPermissions', 'adminUser', 'adminName', 'adminLastLogin'].forEach(k => localStorage.removeItem(k));
  sessionStorage.removeItem('passwordResetToken');
  window.dispatchEvent(new Event('auth-changed'));
}
