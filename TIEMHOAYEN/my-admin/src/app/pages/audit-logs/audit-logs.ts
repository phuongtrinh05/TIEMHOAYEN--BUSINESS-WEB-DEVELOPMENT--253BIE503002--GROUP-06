import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService, AdminAuditLog, AdminAuditLogQuery } from '../../services/admin-api.service';

/** Nhãn tiếng Việt cho các mã hành động đã biết; mã lạ hiển thị nguyên văn. */
const ACTION_LABELS: Record<string, string> = {
  DANG_NHAP: 'Đăng nhập (khách hàng)',
  DANG_NHAP_ADMIN: 'Đăng nhập quản trị',
  DANG_XUAT: 'Đăng xuất',
  DANG_XUAT_ADMIN: 'Đăng xuất quản trị',
  DANG_KY: 'Đăng ký',
  GUI_OTP: 'Gửi mã OTP',
  XAC_MINH_OTP: 'Xác minh OTP',
  XAC_MINH_DANG_KY: 'Xác minh đăng ký',
  DAT_LAI_MAT_KHAU: 'Đặt lại mật khẩu',
  DOI_MAT_KHAU: 'Đổi mật khẩu',
  CAP_NHAT_KHACH_HANG: 'Cập nhật khách hàng',
  KHOA_KHACH_HANG: 'Khóa khách hàng',
  MO_KHOA_KHACH_HANG: 'Mở khóa khách hàng',
  DOI_TRANG_THAI_KHACH_HANG: 'Đổi trạng thái khách hàng',
  THEM_GHI_CHU_KHACH_HANG: 'Thêm ghi chú khách hàng',
  THEM_DIA_CHI_KHACH_HANG: 'Thêm địa chỉ khách hàng',
  SUA_DIA_CHI_KHACH_HANG: 'Sửa địa chỉ khách hàng',
  XOA_DIA_CHI_KHACH_HANG: 'Xóa địa chỉ khách hàng',
  AN_DANH_GIA: 'Ẩn đánh giá',
  HIEN_DANH_GIA: 'Hiện đánh giá',
  TAO_NHAN_VIEN: 'Tạo nhân viên',
  CAP_NHAT_NHAN_VIEN: 'Cập nhật nhân viên',
  DOI_TRANG_THAI_NHAN_VIEN: 'Đổi trạng thái nhân viên',
  DOI_NHOM_QUYEN_NHAN_VIEN: 'Đổi nhóm quyền nhân viên',
  YEU_CAU_DAT_LAI_MAT_KHAU: 'Yêu cầu đặt lại mật khẩu',
  CAP_NHAT_NHOM_QUYEN: 'Cập nhật nhóm quyền',
  CAP_NHAT_HO_SO: 'Cập nhật hồ sơ',
};

const ACTOR_TYPE_LABELS: Record<string, string> = {
  NHAN_VIEN: 'Nhân viên',
  KHACH_HANG: 'Khách hàng',
  KHACH: 'Khách vãng lai',
};

const BEFORE_KEYS = ['truoc', 'before', 'old', 'cu'];
const AFTER_KEYS = ['sau', 'after', 'new', 'moi'];

export interface ChangeRow {
  field: string;
  before?: string;
  after?: string;
  value?: string;
  isPair: boolean;
}

@Component({
  selector: 'app-audit-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './audit-logs.html',
  styleUrl: './audit-logs.css',
})
export class AuditLogsComponent implements OnInit {
  logs: AdminAuditLog[] = [];
  total = 0;
  page = 1;
  limit = 15;
  totalPages = 1;
  isLoading = false;
  loadError = '';

  searchKeyword = '';
  selectedAction = '';
  selectedResult: '' | 'success' | 'fail' = '';
  fromDate = '';
  toDate = '';
  dateError = '';
  expandedLogId: string | null = null;

  /** Mã hành động có trong nhật ký (server trả về), dùng cho dropdown. */
  actionCodes: string[] = [];

  private changeCache = new WeakMap<object, ChangeRow[]>();

  constructor(
    private adminApi: AdminApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.fetchLogs();
  }

  get actionOptions(): { value: string; label: string }[] {
    const codes = new Set(this.actionCodes);
    if (this.selectedAction) codes.add(this.selectedAction);
    return Array.from(codes)
      .map((value) => ({ value, label: this.getActionLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
  }

  get hasFilter(): boolean {
    return Boolean(this.searchKeyword.trim() || this.selectedAction || this.selectedResult || this.fromDate || this.toDate);
  }

  fetchLogs(): void {
    if (this.fromDate && this.toDate && this.fromDate > this.toDate) {
      this.dateError = '"Từ ngày" phải trước hoặc bằng "Đến ngày".';
      return;
    }
    this.dateError = '';
    this.isLoading = true;
    this.loadError = '';

    const query: AdminAuditLogQuery = {
      page: this.page,
      limit: this.limit,
      action: this.selectedAction || undefined,
      search: this.searchKeyword.trim() || undefined,
      from: this.fromDate || undefined,
      to: this.toDate || undefined,
      result: this.selectedResult || undefined,
    };

    this.adminApi.getAuditLogs(query).subscribe({
      next: (res) => {
        this.logs = res.logs || [];
        this.total = res.total || 0;
        this.page = res.page || 1;
        this.limit = res.limit || 15;
        this.totalPages = Math.max(1, Math.ceil(this.total / this.limit));
        if (res.actions?.length) this.actionCodes = res.actions;
        this.expandedLogId = null;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.logs = [];
        this.total = 0;
        this.isLoading = false;
        this.loadError = err.error?.message || 'Không thể tải nhật ký hệ thống.';
        this.cdr.detectChanges();
      }
    });
  }

  /** Mọi thay đổi bộ lọc đều quay về trang 1. */
  onFilterChange(): void {
    this.page = 1;
    this.fetchLogs();
  }

  onSearch(): void {
    this.onFilterChange();
  }

  resetFilters(): void {
    this.searchKeyword = '';
    this.selectedAction = '';
    this.selectedResult = '';
    this.fromDate = '';
    this.toDate = '';
    this.onFilterChange();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages || p === this.page) return;
    this.page = p;
    this.fetchLogs();
  }

  prevPage(): void {
    if (this.page > 1) {
      this.page--;
      this.fetchLogs();
    }
  }

  nextPage(): void {
    if (this.page < this.totalPages) {
      this.page++;
      this.fetchLogs();
    }
  }

  toggleExpand(id: string): void {
    this.expandedLogId = this.expandedLogId === id ? null : id;
  }

  formatDate(val: string): string {
    if (!val) return '—';
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return val;
    return d.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  getActorName(log: AdminAuditLog): string {
    return log.TEN_NGUOI_THUC_HIEN || log.NGUOI_THUC_HIEN_ID || (log.LOAI_NGUOI_THUC_HIEN === 'KHACH' ? 'Khách vãng lai' : '—');
  }

  getActorRole(log: AdminAuditLog): string {
    return log.VAI_TRO_NGUOI_THUC_HIEN || ACTOR_TYPE_LABELS[log.LOAI_NGUOI_THUC_HIEN] || log.LOAI_NGUOI_THUC_HIEN || '';
  }

  /** Hiện thêm mã người thực hiện khi đã hiển thị tên. */
  getActorId(log: AdminAuditLog): string {
    return log.TEN_NGUOI_THUC_HIEN && log.NGUOI_THUC_HIEN_ID ? log.NGUOI_THUC_HIEN_ID : '';
  }

  isSuccess(log: AdminAuditLog): boolean {
    return log.KET_QUA === 'Thanh cong';
  }

  getActionLabel(action: string): string {
    return ACTION_LABELS[action] || action;
  }

  getActionBadgeClass(action: string): string {
    if (/^(DANG_NHAP|DANG_XUAT|GUI_OTP|XAC_MINH_OTP)/.test(action)) return 'badge-info';
    if (/^(TAO_|THEM_|DANG_KY|XAC_MINH_DANG_KY|MO_KHOA|HIEN_)/.test(action)) return 'badge-success';
    if (/^(KHOA_|XOA_|AN_)/.test(action)) return 'badge-danger';
    if (/MAT_KHAU|DOI_TRANG_THAI|DOI_NHOM_QUYEN/.test(action)) return 'badge-primary';
    if (/^(CAP_NHAT|SUA_)/.test(action)) return 'badge-warning';
    return 'badge-secondary';
  }

  hasChanges(log: AdminAuditLog): boolean {
    return this.getChangeRows(log).length > 0;
  }

  /** Tóm tắt một dòng cho ô thu gọn. */
  getChangeSummary(log: AdminAuditLog): string {
    const rows = this.getChangeRows(log);
    if (!rows.length) return '—';
    const fields = rows.map((row) => row.field);
    return fields.length > 3 ? `${fields.slice(0, 3).join(', ')} … (+${fields.length - 3})` : fields.join(', ');
  }

  /** Chuyển NOI_DUNG_THAY_DOI thành các dòng "trường: trước → sau" dễ đọc. */
  getChangeRows(log: AdminAuditLog): ChangeRow[] {
    const raw = log.NOI_DUNG_THAY_DOI;
    if (!raw || typeof raw !== 'object') {
      return raw === undefined || raw === null || raw === '' ? [] : [{ field: 'Nội dung', value: String(raw), isPair: false }];
    }
    const cached = this.changeCache.get(raw);
    if (cached) return cached;

    const rows: ChangeRow[] = [];
    const before = this.pick(raw, BEFORE_KEYS);
    const after = this.pick(raw, AFTER_KEYS);

    if (before.found || after.found) {
      // Dạng { truoc: {...}, sau: {...} }
      const b = this.isPlainObject(before.value) ? before.value : {};
      const a = this.isPlainObject(after.value) ? after.value : {};
      if (this.isPlainObject(before.value) || this.isPlainObject(after.value)) {
        const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
        keys.forEach((key) => rows.push({ field: key, before: this.display(b[key]), after: this.display(a[key]), isPair: true }));
      } else {
        rows.push({ field: 'Giá trị', before: this.display(before.value), after: this.display(after.value), isPair: true });
      }
      Object.keys(raw)
        .filter((key) => ![...BEFORE_KEYS, ...AFTER_KEYS].includes(key.toLowerCase()))
        .forEach((key) => this.pushEntry(rows, key, raw[key]));
    } else {
      Object.keys(raw).forEach((key) => this.pushEntry(rows, key, raw[key]));
    }

    this.changeCache.set(raw, rows);
    return rows;
  }

  private pushEntry(rows: ChangeRow[], key: string, value: any, depth = 0): void {
    if (this.isPlainObject(value)) {
      const before = this.pick(value, BEFORE_KEYS);
      const after = this.pick(value, AFTER_KEYS);
      if (before.found || after.found) {
        rows.push({ field: key, before: this.display(before.value), after: this.display(after.value), isPair: true });
        return;
      }
      // Ví dụ { thayDoi: { 'orders.view': { truoc, sau } } } → làm phẳng một cấp.
      if (depth === 0 && Object.values(value).some((v) => this.isPlainObject(v))) {
        Object.keys(value).forEach((child) => this.pushEntry(rows, child, value[child], depth + 1));
        return;
      }
    }
    rows.push({ field: key, value: this.display(value), isPair: false });
  }

  private pick(obj: any, keys: string[]): { found: boolean; value: any } {
    const match = Object.keys(obj).find((key) => keys.includes(key.toLowerCase()));
    return match ? { found: true, value: obj[match] } : { found: false, value: undefined };
  }

  private isPlainObject(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private display(value: unknown): string {
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Có' : 'Không';
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return this.formatDate(value);
      return value;
    }
    if (typeof value === 'number') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
