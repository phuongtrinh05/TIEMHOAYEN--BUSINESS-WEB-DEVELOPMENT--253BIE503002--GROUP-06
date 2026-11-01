import { HttpInterceptorFn } from '@angular/common/http';
import { filter } from 'rxjs';

const tokenKey = 'adminToken';
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
  ['adminLoggedIn', 'adminEmployeeId', 'adminEmail', 'adminRole', 'adminPermissions', 'adminUser'].forEach(k => localStorage.removeItem(k));
  sessionStorage.removeItem('passwordResetToken');
  window.dispatchEvent(new Event('auth-changed'));
}
export const sessionAuthInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(remote + '/api/')) return next(req);
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(tokenKey) : null;
  const request = req.clone({
    url: apiOrigin() + req.url.slice(remote.length),
    setHeaders: token ? { Authorization: 'Bearer ' + token } : {},
  });
  // Responses from an old account must never populate the new account's screen.
  return next(request).pipe(filter(() => typeof localStorage === 'undefined' || localStorage.getItem(tokenKey) === token));
};
