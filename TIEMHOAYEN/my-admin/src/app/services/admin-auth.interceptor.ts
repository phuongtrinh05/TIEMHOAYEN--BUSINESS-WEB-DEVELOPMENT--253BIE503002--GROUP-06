import { HttpInterceptorFn } from '@angular/common/http';

export const adminAuthInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.includes('/api/admin')) {
    return next(req);
  }

  const employeeId = typeof localStorage !== 'undefined' ? localStorage.getItem('adminEmployeeId') : '';
  const role = typeof localStorage !== 'undefined' ? localStorage.getItem('adminRole') : '';

  const headers: Record<string, string> = {};
  if (employeeId) headers['x-admin-id'] = employeeId;
  if (role) headers['x-admin-role'] = role;

  return next(Object.keys(headers).length ? req.clone({ setHeaders: headers }) : req);
};
