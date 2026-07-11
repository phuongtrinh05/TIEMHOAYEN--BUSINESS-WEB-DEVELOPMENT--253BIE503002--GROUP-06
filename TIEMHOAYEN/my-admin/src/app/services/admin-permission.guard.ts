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

  if (localStorage.getItem('adminLoggedIn') !== 'true') {
    return router.parseUrl('/login');
  }

  const moduleKey = String(route.data?.['module'] || '');
  if (!moduleKey) return true;

  const permissions = getPermissions();
  if (permissions[moduleKey]?.view) return true;

  return router.parseUrl('/dashboard');
};
