import { HttpInterceptorFn } from '@angular/common/http';
import { apiBaseUrl } from './api-config';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

export const adminAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const prefix = /^https?:\/\/(?:tiem-hoa-yen-api\.onrender\.com|localhost:3000)\/api(?=\/|$)/;
  if (prefix.test(req.url)) req = req.clone({ url: req.url.replace(prefix, apiBaseUrl()) });
  const path = req.url.startsWith(`${apiBaseUrl()}/`) ? req.url.slice(apiBaseUrl().length) : '';
  if (!/^\/(?:admin(?:\/|$)|support\/admin(?:\/|$)|chats(?:\/|$)|faqs(?:\/|$)|contacts(?:\/|$))/.test(path)) {
    return next(req);
  }

  const employeeId = typeof localStorage !== 'undefined' ? localStorage.getItem('adminEmployeeId') : '';
  const role = typeof localStorage !== 'undefined' ? localStorage.getItem('adminRole') : '';

  const headers: Record<string, string> = {};
  const token = typeof localStorage !== 'undefined' && localStorage.getItem('adminLoggedIn') === 'true' ? localStorage.getItem('adminToken') : '';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (employeeId) headers['x-admin-id'] = employeeId;
  if (role) headers['x-admin-role'] = role;

  return next(Object.keys(headers).length ? req.clone({ setHeaders: headers }) : req).pipe(catchError(error => {
    if (error.status === 401 && !path.endsWith('/auth/login') && typeof localStorage !== 'undefined') {
      for (const key of ['adminLoggedIn', 'adminToken', 'adminEmployeeId', 'adminRole', 'adminPermissions']) localStorage.removeItem(key);
      void router.navigate(['/login']);
    }
    return throwError(() => error);
  }));
};
