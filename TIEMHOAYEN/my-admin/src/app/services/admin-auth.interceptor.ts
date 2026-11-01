import { HttpInterceptorFn } from '@angular/common/http';
import { apiBaseUrl } from './api-config';

export const adminAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const prefix = /^https?:\/\/(?:tiem-hoa-yen-api\.onrender\.com|localhost:3000)\/api(?=\/|$)/;
  if (prefix.test(req.url)) req = req.clone({ url: req.url.replace(prefix, apiBaseUrl()) });
  const path = req.url.startsWith(`${apiBaseUrl()}/`) ? req.url.slice(apiBaseUrl().length) : '';
  if (!/^\/(?:admin(?:\/|$)|support\/admin(?:\/|$)|lucky\/admin(?:\/|$)|chats(?:\/|$)|faqs(?:\/|$)|contacts(?:\/|$)|blogs(?:\/|$)|content(?:\/|$))/.test(path)) {
    return next(req);
  }

  const employeeId = typeof localStorage !== 'undefined' ? localStorage.getItem('adminEmployeeId') : '';
  const role = typeof localStorage !== 'undefined' ? localStorage.getItem('adminRole') : '';

  const headers: Record<string, string> = {};
  if (employeeId) headers['x-admin-id'] = employeeId;
  const adminSession=typeof localStorage!=='undefined'?localStorage.getItem('adminSessionToken'):null;
  if(adminSession)headers['x-admin-session']=adminSession;
  if (role) headers['x-admin-role'] = role;

  return next(Object.keys(headers).length ? req.clone({ setHeaders: headers }) : req);
};
