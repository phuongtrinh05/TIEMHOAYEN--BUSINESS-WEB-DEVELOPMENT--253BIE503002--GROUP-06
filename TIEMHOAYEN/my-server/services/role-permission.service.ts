export type PermissionAction = 'view' | 'create' | 'update' | 'delete' | 'grant';

export interface PermissionModule {
  key: string;
  name: string;
}

export type ModulePermission = Record<PermissionAction, boolean>;
export type RolePermissionSet = Record<string, ModulePermission>;

export const permissionActions: PermissionAction[] = ['view', 'create', 'update', 'delete', 'grant'];

export const permissionModules: PermissionModule[] = [
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

const emptyPermission = (): ModulePermission => ({
  view: false,
  create: false,
  update: false,
  delete: false,
  grant: false,
});

const allow = (...actions: PermissionAction[]): ModulePermission => ({
  ...emptyPermission(),
  ...Object.fromEntries(actions.map((action) => [action, true])),
}) as ModulePermission;

const allowAll = (): ModulePermission => allow('view', 'create', 'update', 'delete', 'grant');

const makePermissions = (rules: Partial<RolePermissionSet>): RolePermissionSet => {
  return Object.fromEntries(
    permissionModules.map((module) => [module.key, rules[module.key] || emptyPermission()])
  ) as RolePermissionSet;
};

export const defaultRolePermissions: Record<string, RolePermissionSet> = {
  Admin: makePermissions(
    Object.fromEntries(permissionModules.map((module) => [module.key, allowAll()])) as RolePermissionSet
  ),
  'Nhân viên bán hàng': makePermissions({
    dashboard: allow('view'),
    orders: allow('view', 'create', 'update'),
    payments: allow('view', 'create', 'update'),
    products: allow('view'),
    customers: allow('view', 'create', 'update'),
    promotions: allow('view'),
    customerService: allow('view'),
  }),
  'Nhân viên giao hàng': makePermissions({
    dashboard: allow('view'),
    orders: allow('view', 'update'),
    customers: allow('view'),
  }),
  'Nhân viên Marketing': makePermissions({
    dashboard: allow('view'),
    products: allow('view'),
    customers: allow('view'),
    promotions: allow('view', 'create', 'update', 'delete'),
    customerService: allow('view'),
    content: allow('view', 'create', 'update', 'delete'),
  }),
  'Nhân viên CSKH': makePermissions({
    dashboard: allow('view'),
    orders: allow('view'),
    customers: allow('view', 'update'),
    promotions: allow('view'),
    customerService: allow('view', 'create', 'update'),
    content: allow('view'),
  }),
  'Nhân viên kho': makePermissions({
    dashboard: allow('view'),
    products: allow('view', 'update'),
    materials: allow('view', 'create', 'update', 'delete'),
  }),
};

const normalizeText = (value: unknown): string => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

export const resolveRoleName = (role: unknown): string => {
  const normalized = normalizeText(role);
  const found = Object.keys(defaultRolePermissions).find((roleName) => normalizeText(roleName) === normalized);
  return found || String(role || '').trim();
};

export const getRolePermissions = (role: unknown): RolePermissionSet => {
  const roleName = resolveRoleName(role);
  return defaultRolePermissions[roleName] || makePermissions({});
};

export const hasPermission = (role: unknown, moduleKey: string, action: PermissionAction): boolean => {
  const roleName = resolveRoleName(role);
  if (roleName === 'Admin') return true;
  return Boolean(getRolePermissions(roleName)[moduleKey]?.[action]);
};
