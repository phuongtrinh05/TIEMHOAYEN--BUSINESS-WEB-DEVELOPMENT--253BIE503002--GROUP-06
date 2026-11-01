import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AdminRolePermissionSet } from './admin-api.service';

const getPermissions = (): AdminRolePermissionSet => {
  const raw = localStorage.getItem('adminPermissions');
  if (!raw) return {};

  try {
    return JSON.parse(raw) as AdminRolePermissionSet;
  } catch {
    return {};
  }
};

export const adminPermissionGuard: CanActivateFn = (route) => {
  const router = inject(Router);

  // Phiên đăng nhập cũ (trước khi có adminSessionToken) không còn được backend chấp nhận.
  if (localStorage.getItem('adminLoggedIn') !== 'true' || !localStorage.getItem('adminSessionToken')) {
    return router.parseUrl('/login');
  }

  const role = localStorage.getItem('adminRole');
  if (role === 'Admin') return true;

  const moduleKey = String(route.data?.['module'] || '');
  if (!moduleKey) return true;

  const permissions = getPermissions();
  if (permissions[moduleKey]?.view) return true;

  return router.parseUrl('/dashboard');
};
