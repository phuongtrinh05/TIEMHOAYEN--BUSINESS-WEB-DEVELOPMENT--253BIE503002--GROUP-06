import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminApiService, AdminStaffAccount } from '../../services/admin-api.service';

type EmployeeStatusClass = 'active' | 'locked' | 'inactive';

type EmployeeView = AdminStaffAccount & {
  statusClass: EmployeeStatusClass;
  searchIndex: string;
};

type ConfirmKind = 'lock' | 'unlock' | 'resign' | 'reset';

interface StaffForm {
  name: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  reason: string;
}

type StaffFormErrors = Partial<Record<keyof StaffForm, string>>;

/** Danh sách nhóm quyền hợp lệ phía server (AD52). */
export const STAFF_ROLES = [
  'Admin',
  'Nhân viên bán hàng',
  'Nhân viên giao hàng',
  'Nhân viên Marketing',
  'Nhân viên CSKH',
  'Nhân viên kho',
];

export const STAFF_STATUSES = ['Hoạt động', 'Bị khóa', 'Nghỉ việc'];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^0\d{9}$/;

@Component({
  selector: 'app-admin-account',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-account.html',
  styleUrl: './admin-account.css'
})
export class AdminAccount implements OnInit {
  readonly statuses = STAFF_STATUSES;
  readonly currentEmployeeId = this.readStorage('adminEmployeeId');
  readonly currentRole = this.readStorage('adminRole');

  isLoading = false;
  loadError = '';
  successMessage = '';
  busy = false;

  searchKeyword = '';
  selectedRole = '';
  selectedStatus = '';
  activeSort = 'default';
  showSortMenu = false;

  currentPage = 1;
  itemsPerPage = 10;

  employees: EmployeeView[] = [];
  filteredEmployees: EmployeeView[] = [];

  // Form thêm / sửa
  formOpen = false;
  editingCode: string | null = null;
  form: StaffForm = this.emptyForm();
  formErrors: StaffFormErrors = {};
  formError = '';

  // Hộp xác nhận khóa / mở khóa / nghỉ việc / đặt lại mật khẩu
  confirmKind: ConfirmKind | null = null;
  confirmTarget: EmployeeView | null = null;
  confirmReason = '';
  confirmError = '';

  constructor(
    private readonly adminApi: AdminApiService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadEmployees();
  }

  /** Chỉ Admin mới được tạo / gán nhóm quyền Admin. */
  get roleOptions(): string[] {
    return this.currentRole === 'Admin' ? STAFF_ROLES : STAFF_ROLES.filter((role) => role !== 'Admin');
  }

  /** Bộ lọc hiển thị mọi nhóm quyền (kể cả nhóm lạ còn tồn tại trong dữ liệu cũ). */
  get filterRoleOptions(): string[] {
    const extra = this.employees.map((e) => e.role).filter((r) => r && !STAFF_ROLES.includes(r));
    return [...STAFF_ROLES, ...Array.from(new Set(extra))];
  }

  loadEmployees(): void {
    this.isLoading = true;
    this.loadError = '';

    this.adminApi.getStaffAccounts().subscribe({
      next: (response) => {
        this.employees = (response?.accounts || []).map((employee) => this.toEmployeeView(employee));
        this.applyCurrentView();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.employees = [];
        this.filteredEmployees = [];
        this.isLoading = false;
        this.loadError = err?.error?.message || 'Không thể tải danh sách tài khoản quản trị.';
        this.cdr.detectChanges();
      }
    });
  }

  // ---------- Danh sách / bộ lọc ----------

  onFilterChange(): void {
    this.currentPage = 1;
    this.applyCurrentView();
  }

  resetFilter(): void {
    this.searchKeyword = '';
    this.selectedRole = '';
    this.selectedStatus = '';
    this.activeSort = 'default';
    this.onFilterChange();
  }

  get hasFilter(): boolean {
    return Boolean(this.searchKeyword.trim() || this.selectedRole || this.selectedStatus);
  }

  toggleSortMenu(): void {
    this.showSortMenu = !this.showSortMenu;
  }

  sortBy(type: string): void {
    this.activeSort = type;
    this.showSortMenu = false;
    this.onFilterChange();
  }

  isSelf(employee: EmployeeView): boolean {
    return Boolean(this.currentEmployeeId) && employee.code === this.currentEmployeeId;
  }

  /** Không phải Admin thì không được thao tác trên tài khoản Admin (server cũng chặn). */
  canManage(employee: EmployeeView): boolean {
    if (this.isSelf(employee)) return false;
    if (employee.role === 'Admin' && this.currentRole !== 'Admin') return false;
    return true;
  }

  manageHint(employee: EmployeeView): string {
    if (this.isSelf(employee)) return 'Không thể tự thay đổi tài khoản của chính mình';
    if (!this.canManage(employee)) return 'Chỉ Admin được thay đổi tài khoản Admin';
    return '';
  }

  formatLastLoginTime(value: string | undefined | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  // ---------- Phân trang ----------

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredEmployees.length / this.itemsPerPage));
  }

  get pagedEmployees(): EmployeeView[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredEmployees.slice(start, start + this.itemsPerPage);
  }

  get pages(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  goToPage(page: number): void {
    this.currentPage = page;
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) this.currentPage++;
  }

  previousPage(): void {
    if (this.currentPage > 1) this.currentPage--;
  }

  trackByEmployeeCode(_index: number, employee: EmployeeView): string {
    return employee.code;
  }

  // ---------- Form thêm / sửa ----------

  openCreate(): void {
    this.clearMessages();
    this.editingCode = null;
    this.form = this.emptyForm();
    this.formErrors = {};
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(employee: EmployeeView): void {
    if (!this.canManage(employee)) return;
    this.clearMessages();
    this.editingCode = employee.code;
    this.form = {
      name: employee.name || '',
      email: employee.email || '',
      phone: employee.phone || '',
      role: employee.role || '',
      status: STAFF_STATUSES.includes(employee.status) ? employee.status : 'Hoạt động',
      reason: ''
    };
    this.formErrors = {};
    this.formError = '';
    this.formOpen = true;
  }

  closeForm(): void {
    if (this.busy) return;
    this.formOpen = false;
    this.editingCode = null;
  }

  /** Nhóm quyền hiện tại có thể không nằm trong danh sách được chọn (ví dụ Admin khi người sửa không phải Admin). */
  get formRoleOptions(): string[] {
    const options = this.roleOptions;
    return this.form.role && !options.includes(this.form.role) ? [this.form.role, ...options] : options;
  }

  validateForm(): boolean {
    const errors: StaffFormErrors = {};
    const name = this.form.name.trim();
    const email = this.form.email.trim();
    const phone = this.form.phone.trim();

    if (!name) errors.name = 'Vui lòng nhập họ tên.';
    else if (name.length > 100) errors.name = 'Họ tên tối đa 100 ký tự.';

    if (!email) errors.email = 'Vui lòng nhập email.';
    else if (!EMAIL_PATTERN.test(email)) errors.email = 'Email không đúng định dạng.';

    if (!phone) errors.phone = 'Vui lòng nhập số điện thoại.';
    else if (!PHONE_PATTERN.test(phone)) errors.phone = 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0.';

    if (!this.form.role) errors.role = 'Vui lòng chọn nhóm quyền.';
    else if (!STAFF_ROLES.includes(this.form.role)) errors.role = 'Nhóm quyền không hợp lệ.';
    else if (this.form.role === 'Admin' && this.currentRole !== 'Admin' && !this.isUnchangedAdmin()) {
      errors.role = 'Chỉ Admin được gán nhóm quyền Admin.';
    }

    if (this.editingCode && !STAFF_STATUSES.includes(this.form.status)) errors.status = 'Trạng thái không hợp lệ.';
    if (this.form.reason.trim().length > 300) errors.reason = 'Lý do tối đa 300 ký tự.';

    this.formErrors = errors;
    return Object.keys(errors).length === 0;
  }

  saveForm(event?: Event): void {
    event?.preventDefault();
    if (this.busy) return;
    this.formError = '';
    if (!this.validateForm()) return;

    const name = this.form.name.trim();
    const email = this.form.email.trim();
    const phone = this.form.phone.trim();
    let payload: Record<string, string>;

    if (!this.editingCode) {
      payload = { HO_TEN: name, EMAIL: email, SDT: phone, VAI_TRO: this.form.role };
    } else {
      const original = this.employees.find((e) => e.code === this.editingCode);
      payload = {};
      if (!original || original.name !== name) payload['HO_TEN'] = name;
      if (!original || original.email !== email) payload['EMAIL'] = email;
      if (!original || original.phone !== phone) payload['SDT'] = phone;
      if (!original || original.role !== this.form.role) payload['VAI_TRO'] = this.form.role;
      if (!original || original.status !== this.form.status) {
        payload['TRANG_THAI'] = this.form.status;
        if (this.form.status !== 'Hoạt động' && this.form.reason.trim()) payload['LY_DO'] = this.form.reason.trim();
      }
      if (!Object.keys(payload).length) {
        this.formError = 'Không có thay đổi nào để lưu.';
        return;
      }
    }

    this.busy = true;
    const isCreate = !this.editingCode;
    this.adminApi.saveStaff(this.editingCode, payload).subscribe({
      next: (res: any) => {
        this.busy = false;
        this.formOpen = false;
        this.editingCode = null;
        this.successMessage = res?.message || (isCreate
          ? 'Đã tạo tài khoản. Nhân viên đặt mật khẩu bằng "Gửi mã xác thực" ở trang đăng nhập.'
          : 'Đã cập nhật tài khoản.');
        this.loadEmployees();
      },
      error: (err) => {
        this.busy = false;
        this.formError = err?.error?.message || 'Không lưu được tài khoản.';
        const field = this.mapServerField(err?.error?.field);
        if (field) this.formErrors = { ...this.formErrors, [field]: this.formError };
        this.cdr.detectChanges();
      }
    });
  }

  // ---------- Khóa / mở khóa / nghỉ việc / đặt lại mật khẩu ----------

  openConfirm(kind: ConfirmKind, employee: EmployeeView): void {
    if (!this.canManage(employee)) return;
    this.clearMessages();
    this.confirmKind = kind;
    this.confirmTarget = employee;
    this.confirmReason = '';
    this.confirmError = '';
  }

  closeConfirm(): void {
    if (this.busy) return;
    this.confirmKind = null;
    this.confirmTarget = null;
  }

  get confirmTitle(): string {
    switch (this.confirmKind) {
      case 'lock': return 'Khóa tài khoản';
      case 'unlock': return 'Mở khóa tài khoản';
      case 'resign': return 'Đánh dấu nghỉ việc';
      case 'reset': return 'Đặt lại mật khẩu';
      default: return '';
    }
  }

  get confirmDescription(): string {
    const who = this.confirmTarget ? `${this.confirmTarget.name || this.confirmTarget.code} (${this.confirmTarget.code})` : '';
    switch (this.confirmKind) {
      case 'lock':
        return `Tài khoản ${who} sẽ không thể đăng nhập và bị đăng xuất ngay. Lịch sử thao tác vẫn được giữ lại.`;
      case 'unlock':
        return `Tài khoản ${who} sẽ được phép đăng nhập trở lại.`;
      case 'resign':
        return `Tài khoản ${who} sẽ chuyển sang "Nghỉ việc", không thể đăng nhập. Hồ sơ và lịch sử vẫn được lưu.`;
      case 'reset':
        return `Mật khẩu hiện tại của ${who} sẽ bị vô hiệu và nhân viên bị đăng xuất. Nhân viên tự đặt mật khẩu mới bằng "Gửi mã xác thực" ở trang đăng nhập.`;
      default:
        return '';
    }
  }

  get confirmNeedsReason(): boolean {
    return this.confirmKind === 'lock' || this.confirmKind === 'resign';
  }

  submitConfirm(): void {
    const target = this.confirmTarget;
    const kind = this.confirmKind;
    if (!target || !kind || this.busy) return;

    const reason = this.confirmReason.trim();
    if (reason.length > 300) {
      this.confirmError = 'Lý do tối đa 300 ký tự.';
      return;
    }

    this.busy = true;
    this.confirmError = '';

    const request$ = kind === 'reset'
      ? this.adminApi.resetStaffPassword(target.code)
      : this.adminApi.saveStaff(target.code, {
          TRANG_THAI: kind === 'lock' ? 'Bị khóa' : kind === 'resign' ? 'Nghỉ việc' : 'Hoạt động',
          ...(this.confirmNeedsReason && reason ? { LY_DO: reason } : {})
        });

    request$.subscribe({
      next: (res: any) => {
        this.busy = false;
        this.confirmKind = null;
        this.confirmTarget = null;
        this.successMessage = res?.message || this.defaultSuccess(kind);
        this.loadEmployees();
      },
      error: (err) => {
        this.busy = false;
        this.confirmError = err?.error?.message || 'Không thực hiện được thao tác.';
        this.cdr.detectChanges();
      }
    });
  }

  // ---------- Xuất CSV ----------

  exportCsv(): void {
    const header = ['Mã', 'Họ tên', 'Email', 'SĐT', 'Nhóm quyền', 'Trạng thái', 'Ngày tạo', 'Lần đăng nhập gần nhất', 'IP', 'Thiết bị'];
    const rows = this.filteredEmployees.map((e) => [
      e.code, e.name, e.email, e.phone, e.role, e.status, e.createdAt,
      this.formatLastLoginTime(e.lastLogin?.time) || 'Chưa đăng nhập',
      e.lastLogin?.ip || '', e.lastLogin?.device || ''
    ]);
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tai-khoan-quan-tri-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  dismissSuccess(): void {
    this.successMessage = '';
  }

  // ---------- Nội bộ ----------

  private applyCurrentView(): void {
    const keyword = this.normalizeText(this.searchKeyword);

    const list = this.employees.filter((employee) => {
      const matchKeyword = !keyword || employee.searchIndex.includes(keyword);
      const matchRole = !this.selectedRole || employee.role === this.selectedRole;
      const matchStatus = !this.selectedStatus || employee.status === this.selectedStatus;
      return matchKeyword && matchRole && matchStatus;
    });

    switch (this.activeSort) {
      case 'newest': list.sort((a, b) => this.getEmployeeTime(b) - this.getEmployeeTime(a)); break;
      case 'oldest': list.sort((a, b) => this.getEmployeeTime(a) - this.getEmployeeTime(b)); break;
      case 'nameAZ': list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi')); break;
      case 'roleAZ': list.sort((a, b) => (a.role || '').localeCompare(b.role || '', 'vi')); break;
      case 'lastLogin':
        list.sort((a, b) => this.toTime(b.lastLogin?.time) - this.toTime(a.lastLogin?.time));
        break;
    }

    this.filteredEmployees = list;
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
  }

  private toEmployeeView(employee: AdminStaffAccount): EmployeeView {
    const view: EmployeeView = {
      ...employee,
      code: employee.code || '',
      name: employee.name || '',
      email: employee.email || '',
      phone: employee.phone ? String(employee.phone) : '',
      role: employee.role || '',
      status: employee.status || '',
      createdAt: employee.createdAt || '',
      createdDate: employee.createdDate || '',
      lastLogin: employee.lastLogin || null,
      selected: false,
      statusClass: this.getStatusClass(employee.status || ''),
      searchIndex: ''
    };
    view.searchIndex = this.normalizeText([view.code, view.name, view.email, view.phone].join(' '));
    return view;
  }

  private getStatusClass(status: string): EmployeeStatusClass {
    if (status === 'Hoạt động') return 'active';
    if (status === 'Bị khóa') return 'locked';
    return 'inactive';
  }

  private getEmployeeTime(employee: EmployeeView): number {
    const iso = this.toTime(employee.createdDate);
    if (iso) return iso;
    const [day, month, year] = (employee.createdAt || '').split('/');
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  private toTime(value: string | undefined | null): number {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  private isUnchangedAdmin(): boolean {
    const original = this.employees.find((e) => e.code === this.editingCode);
    return Boolean(original && original.role === 'Admin');
  }

  private mapServerField(field: unknown): keyof StaffForm | null {
    switch (String(field || '').toUpperCase()) {
      case 'HO_TEN': return 'name';
      case 'EMAIL': return 'email';
      case 'SDT': return 'phone';
      case 'VAI_TRO': return 'role';
      case 'TRANG_THAI': return 'status';
      case 'LY_DO': return 'reason';
      default: return null;
    }
  }

  private defaultSuccess(kind: ConfirmKind): string {
    switch (kind) {
      case 'lock': return 'Đã khóa tài khoản.';
      case 'unlock': return 'Đã mở khóa tài khoản.';
      case 'resign': return 'Đã đánh dấu nghỉ việc.';
      case 'reset': return 'Đã đặt lại mật khẩu. Nhân viên cần dùng "Gửi mã xác thực" để tạo mật khẩu mới.';
    }
  }

  private clearMessages(): void {
    this.successMessage = '';
  }

  private emptyForm(): StaffForm {
    return { name: '', email: '', phone: '', role: 'Nhân viên bán hàng', status: 'Hoạt động', reason: '' };
  }

  private readStorage(key: string): string {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(key) || '' : '';
    } catch {
      return '';
    }
  }

  private normalizeText(value: string): string {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .trim();
  }
}
