import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { tap } from 'rxjs';
import { endSession } from './session-auth';
import { apiBaseUrl } from './api-config';

export const adminAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const prefix = /^https?:\/\/(?:tiem-hoa-yen-api\.onrender\.com|localhost:3000)\/api(?=\/|$)/;
  if (prefix.test(req.url)) req = req.clone({ url: req.url.replace(prefix, apiBaseUrl()) });
  // Mọi API của backend đều nhận phiên Admin để kiểm tra quyền (kể cả /orders, /payments, /employees...).
  if (!req.url.startsWith(`${apiBaseUrl()}/`)) {
    return next(req);
  }

  const employeeId = typeof localStorage !== 'undefined' ? localStorage.getItem('adminEmployeeId') : '';
  const role = typeof localStorage !== 'undefined' ? localStorage.getItem('adminRole') : '';

  const headers: Record<string, string> = {};
  if (employeeId) headers['x-admin-id'] = employeeId;
  const adminSession=typeof localStorage!=='undefined'?localStorage.getItem('adminSessionToken'):null;
  if(adminSession)headers['x-admin-session']=adminSession;
  if (role) headers['x-admin-role'] = role;

  return next(Object.keys(headers).length ? req.clone({ setHeaders: headers }) : req).pipe(tap({
    error: (error: unknown) => {
      // Phiên Admin hết hạn hoặc bị thu hồi: đăng xuất và quay về trang đăng nhập.
      if (adminSession && error instanceof HttpErrorResponse && error.status === 401 && !req.url.includes('/admin/auth/login')) {
        endSession();
        if (typeof location !== 'undefined' && !location.pathname.startsWith('/login')) location.assign('/login');
      }
    },
  }));
};
