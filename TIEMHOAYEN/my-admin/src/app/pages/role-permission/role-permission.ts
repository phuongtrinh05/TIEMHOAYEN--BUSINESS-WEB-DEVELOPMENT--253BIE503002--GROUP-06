import { Component, ChangeDetectorRef, OnInit } from '@angular/core';
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

const ACTION_LABELS: Record<string, string> = {
  view: 'Xem',
  create: 'Thêm',
  update: 'Sửa',
  delete: 'Xóa',
  grant: 'Phân quyền',
};

const DEFAULT_ACTIONS: AdminPermissionAction[] = ['view', 'create', 'update', 'delete', 'grant'];

const CACHE_KEY = 'adminRolePermissionsCache';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * AD53: Server là nguồn dữ liệu duy nhất cho ma trận quyền. Bộ nhớ đệm (localStorage)
 * chỉ dùng để hiển thị tạm trong lúc tải, và luôn ở chế độ chỉ đọc cho tới khi server trả về.
 */
@Component({
  selector: 'app-role-permission',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './role-permission.html',
  styleUrl: './role-permission.css',
})
export class RolePermission implements OnInit {
  searchKeyword = '';
  readonly currentRole = this.readStorage('adminRole');
  selectedRole = this.currentRole || 'Admin';

  loading = false;
  saving = false;
  /** true khi dữ liệu đang hiển thị lấy từ server (không phải bộ nhớ đệm). */
  loadedFromServer = false;
  canEdit = false;

  errorMessage = '';
  successMessage = '';

  actions: { key: AdminPermissionAction; label: string }[] = DEFAULT_ACTIONS.map((key) => ({ key, label: ACTION_LABELS[key] }));
  modules: AdminPermissionModule[] = [];
  roles: AdminRolePermission[] = [];
  filteredRoles: AdminRolePermission[] = [];

  /** Ma trận đã lưu trên server cho từng vai trò, dùng để phát hiện thay đổi chưa lưu và hoàn tác. */
  private savedPermissions: Record<string, AdminRolePermissionSet> = {};

  constructor(private readonly adminApi: AdminApiService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadCachedRolePermissions();
    this.refreshRolePermissions();
  }

  get selected(): AdminRolePermission | undefined {
    return this.roles.find((role) => role.name === this.selectedRole);
  }

  /** Có được sửa vai trò đang chọn hay không. */
  get editable(): boolean {
    return this.canEdit && this.loadedFromServer && this.selectedRole !== 'Admin' && !this.saving && !this.loading;
  }

  get readOnlyReason(): string {
    if (!this.loadedFromServer) return '';
    if (!this.canEdit) return 'Chỉ quản trị viên cao nhất được thay đổi phân quyền.';
    if (this.selectedRole === 'Admin') return 'Nhóm Admin luôn có toàn quyền và không thể chỉnh sửa.';
    return '';
  }

  get hasAnyDirty(): boolean {
    return this.roles.some((role) => this.isDirty(role.name));
  }

  isDirty(roleName: string): boolean {
    const role = this.roles.find((item) => item.name === roleName);
    const saved = this.savedPermissions[roleName];
    if (!role || !saved) return false;
    return JSON.stringify(this.normalize(role.permissions)) !== JSON.stringify(this.normalize(saved));
  }

  loadCachedRolePermissions(): void {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;

    try {
      const cached = JSON.parse(raw) as { modules?: AdminPermissionModule[]; roles?: AdminRolePermission[] };
      if (cached.modules?.length && cached.roles?.length) {
        this.modules = cached.modules;
        this.roles = cached.roles;
        this.searchRole();
      }
    } catch {
      localStorage.removeItem(CACHE_KEY);
    }
  }

  refreshRolePermissions(): void {
    if (this.loading || this.saving || this.hasAnyDirty) return;
    this.loading = true;
    this.errorMessage = '';

    this.adminApi.getRolePermissions().pipe(
      timeout({ first: 8000 })
    ).subscribe({
      next: (response) => {
        this.loading = false;
        this.loadedFromServer = true;
        this.canEdit = response.canEdit === true;
        if (response.actions?.length) {
          this.actions = response.actions.map((key) => ({ key, label: ACTION_LABELS[key] || key }));
        }
        this.modules = response.modules || [];
        this.roles = (response.roles || []).map((role) => ({
          ...role,
          permissions: this.normalize(role.permissions),
        }));
        this.savedPermissions = Object.fromEntries(this.roles.map((role) => [role.name, clone(role.permissions)]));
        this.searchRole();

        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ modules: this.modules, roles: this.roles }));
        }

        if (!this.roles.some((role) => role.name === this.selectedRole)) {
          this.selectedRole = this.roles[0]?.name || '';
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.error?.message
          || (this.roles.length
            ? 'Không tải được phân quyền mới nhất từ máy chủ. Đang hiển thị bản lưu tạm (chỉ đọc).'
            : 'Không tải được phân quyền từ máy chủ.');
        this.cdr.detectChanges();
      },
    });
  }

  searchRole(): void {
    const keyword = this.searchKeyword.trim().toLowerCase();
    this.filteredRoles = this.roles.filter((role) => role.name.toLowerCase().includes(keyword));
  }

  selectRole(role: string): void {
    this.selectedRole = role;
    this.successMessage = '';
    this.errorMessage = '';
  }

  togglePermission(moduleKey: string, action: AdminPermissionAction): void {
    if (!this.editable) return;
    const role = this.selected;
    if (!role) return;

    const current: AdminModulePermission = { ...this.emptyPermission(), ...(role.permissions[moduleKey] || {}) };
    const next = !current[action];

    if (action === 'view') {
      if (next) {
        current.view = true;
      } else {
        // Tắt "Xem" thì các quyền khác cũng không còn ý nghĩa.
        this.actions.forEach((item) => (current[item.key] = false));
      }
    } else {
      current[action] = next;
      // Giống quy tắc phía server: bật bất kỳ quyền nào thì tự bật "Xem".
      if (next) current.view = true;
    }

    role.permissions = { ...role.permissions, [moduleKey]: current };
    this.successMessage = '';
    this.errorMessage = '';
  }

  undoChanges(): void {
    const role = this.selected;
    const saved = role ? this.savedPermissions[role.name] : undefined;
    if (!role || !saved || this.saving) return;
    role.permissions = clone(saved);
    this.successMessage = '';
    this.errorMessage = '';
  }

  savePermissions(): void {
    const role = this.selected;
    if (!role || !this.editable || !this.isDirty(role.name)) return;

    this.saving = true;
    this.successMessage = '';
    this.errorMessage = '';
    const roleName = role.name;
    const matrix = this.normalize(role.permissions);

    this.adminApi.saveRolePermissions(roleName, matrix).subscribe({
      next: (res: { message?: string; permissions?: AdminRolePermissionSet }) => {
        this.saving = false;
        const saved = this.normalize(res?.permissions || matrix);
        const target = this.roles.find((item) => item.name === roleName);
        if (target) target.permissions = clone(saved);
        this.savedPermissions[roleName] = clone(saved);

        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ modules: this.modules, roles: this.roles }));
          if (roleName === this.currentRole) {
            localStorage.setItem('adminPermissions', JSON.stringify(saved));
          }
        }

        this.successMessage = res?.message || `Đã lưu phân quyền cho nhóm "${roleName}".`;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.saving = false;
        this.errorMessage = err?.error?.message || 'Không lưu được phân quyền.';
        this.cdr.detectChanges();
      },
    });
  }

  hasPermission(moduleKey: string, action: AdminPermissionAction): boolean {
    return Boolean(this.selected?.permissions?.[moduleKey]?.[action]);
  }

  /** Ô khác với bản đã lưu (để tô sáng). */
  isCellChanged(moduleKey: string, action: AdminPermissionAction): boolean {
    const saved = this.savedPermissions[this.selectedRole];
    if (!saved) return false;
    return Boolean(saved[moduleKey]?.[action]) !== this.hasPermission(moduleKey, action);
  }

  private normalize(permissions: AdminRolePermissionSet | undefined): AdminRolePermissionSet {
    const keys = this.modules.length ? this.modules.map((m) => m.key) : Object.keys(permissions || {});
    return Object.fromEntries(
      keys.map((key) => {
        const source = permissions?.[key] || ({} as Partial<AdminModulePermission>);
        const value = this.emptyPermission();
        this.actions.forEach((action) => (value[action.key] = source[action.key] === true));
        return [key, value];
      })
    ) as AdminRolePermissionSet;
  }

  private emptyPermission(): AdminModulePermission {
    return { view: false, create: false, update: false, delete: false, grant: false };
  }

  private readStorage(key: string): string {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(key) || '' : '';
    } catch {
      return '';
    }
  }
}
