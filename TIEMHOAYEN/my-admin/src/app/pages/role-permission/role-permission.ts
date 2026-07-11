import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { timeout } from 'rxjs';
import {
  AdminApiService,
  AdminModulePermission,
  AdminPermissionAction,
  AdminPermissionModule,
  AdminRolePermission,
  AdminRolePermissionSet,
} from '../../services/admin-api.service';

const ACTIONS: { key: AdminPermissionAction; label: string }[] = [
  { key: 'view', label: 'Xem' },
  { key: 'create', label: 'Thêm' },
  { key: 'update', label: 'Sửa' },
  { key: 'delete', label: 'Xóa' },
  { key: 'grant', label: 'Phân quyền' },
];

const MODULES: AdminPermissionModule[] = [
  { key: 'dashboard', name: 'Dashboard' },
  { key: 'orders', name: 'Đơn hàng' },
  { key: 'payments', name: 'Thanh toán' },
  { key: 'products', name: 'Sản phẩm' },
  { key: 'materials', name: 'Nguyên vật liệu' },
  { key: 'customers', name: 'Khách hàng' },
  { key: 'promotions', name: 'Khuyến mãi' },
  { key: 'customerService', name: 'Chăm sóc khách hàng' },
  { key: 'content', name: 'Nội dung' },
  { key: 'system', name: 'Cài đặt hệ thống' },
  { key: 'permissions', name: 'Phân quyền' },
];

const emptyPermission = (): AdminModulePermission => ({
  view: false,
  create: false,
  update: false,
  delete: false,
  grant: false,
});

const allow = (...actions: AdminPermissionAction[]): AdminModulePermission => ({
  ...emptyPermission(),
  ...Object.fromEntries(actions.map((action) => [action, true])),
}) as AdminModulePermission;

const allowAll = (): AdminModulePermission => allow('view', 'create', 'update', 'delete', 'grant');

const makePermissions = (rules: Partial<AdminRolePermissionSet>): AdminRolePermissionSet => {
  return Object.fromEntries(
    MODULES.map((module) => [module.key, rules[module.key] || emptyPermission()])
  ) as AdminRolePermissionSet;
};

const DEFAULT_ROLES: AdminRolePermission[] = [
  {
    name: 'Admin',
    total: 0,
    permissions: makePermissions(
      Object.fromEntries(MODULES.map((module) => [module.key, allowAll()])) as AdminRolePermissionSet
    ),
  },
  {
    name: 'Nhân viên bán hàng',
    total: 0,
    permissions: makePermissions({
      dashboard: allow('view'),
      orders: allow('view', 'create', 'update'),
      payments: allow('view', 'create', 'update'),
      products: allow('view'),
      customers: allow('view', 'create', 'update'),
      promotions: allow('view'),
      customerService: allow('view'),
    }),
  },
  {
    name: 'Nhân viên giao hàng',
    total: 0,
    permissions: makePermissions({
      dashboard: allow('view'),
      orders: allow('view', 'update'),
      customers: allow('view'),
    }),
  },
  {
    name: 'Nhân viên Marketing',
    total: 0,
    permissions: makePermissions({
      dashboard: allow('view'),
      products: allow('view'),
      customers: allow('view'),
      promotions: allow('view', 'create', 'update', 'delete'),
      customerService: allow('view'),
      content: allow('view', 'create', 'update', 'delete'),
    }),
  },
  {
    name: 'Nhân viên CSKH',
    total: 0,
    permissions: makePermissions({
      dashboard: allow('view'),
      orders: allow('view'),
      customers: allow('view', 'update'),
      promotions: allow('view'),
      customerService: allow('view', 'create', 'update'),
      content: allow('view'),
    }),
  },
  {
    name: 'Nhân viên kho',
    total: 0,
    permissions: makePermissions({
      dashboard: allow('view'),
      products: allow('view', 'update'),
      materials: allow('view', 'create', 'update', 'delete'),
    }),
  },
];

@Component({
  selector: 'app-role-permission',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './role-permission.html',
  styleUrl: './role-permission.css',
})
export class RolePermission {
  searchKeyword = '';
  selectedRole = typeof localStorage !== 'undefined' ? localStorage.getItem('adminRole') || 'Admin' : 'Admin';
  loading = false;
  errorMessage = '';

  actions = ACTIONS;
  modules = MODULES;
  roles: AdminRolePermission[] = DEFAULT_ROLES;
  filteredRoles: AdminRolePermission[] = [...DEFAULT_ROLES];

  constructor(private readonly adminApi: AdminApiService) {
    this.loadCachedRolePermissions();
    this.refreshRolePermissions();
  }

  loadCachedRolePermissions(): void {
    if (typeof localStorage === 'undefined') return;

    const raw = localStorage.getItem('adminRolePermissionsCache');
    if (!raw) return;

    try {
      const cached = JSON.parse(raw) as { modules?: AdminPermissionModule[]; roles?: AdminRolePermission[] };
      this.modules = cached.modules?.length ? cached.modules : MODULES;
      this.roles = cached.roles?.length ? cached.roles : DEFAULT_ROLES;
      this.searchRole();
    } catch {
      localStorage.removeItem('adminRolePermissionsCache');
    }
  }

  refreshRolePermissions(): void {
    this.loading = false;
    this.errorMessage = '';

    this.adminApi.getRolePermissions().pipe(
      timeout({ first: 4000 })
    ).subscribe({
      next: (response) => {
        this.modules = response.modules.length ? response.modules : MODULES;
        this.roles = response.roles.length ? response.roles : DEFAULT_ROLES;
        this.searchRole();

        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('adminRolePermissionsCache', JSON.stringify({
            modules: this.modules,
            roles: this.roles,
          }));
        }

        if (!this.roles.some((role) => role.name === this.selectedRole)) {
          this.selectedRole = this.roles[0]?.name || 'Admin';
        }
      },
      error: () => {
        this.errorMessage = 'Không tải được số tài khoản mới nhất, đang hiển thị phân quyền mặc định.';
      },
    });
  }

  searchRole(): void {
    const keyword = this.searchKeyword.trim().toLowerCase();
    this.filteredRoles = this.roles.filter((role) =>
      role.name.toLowerCase().includes(keyword)
    );
  }

  selectRole(role: string): void {
    this.selectedRole = role;
  }

  hasPermission(moduleKey: string, action: AdminPermissionAction): boolean {
    const role = this.roles.find((item) => item.name === this.selectedRole);
    return Boolean(role?.permissions?.[moduleKey]?.[action]);
  }
}
