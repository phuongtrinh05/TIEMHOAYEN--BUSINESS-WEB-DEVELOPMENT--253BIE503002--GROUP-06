import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService, AdminAuditLog } from '../../services/admin-api.service';

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
  expandedLogId: string | null = null;

  actionList: { value: string; label: string }[] = [
    { value: '', label: 'Tất cả hành động' },
    { value: 'DANG_NHAP', label: 'Đăng nhập' },
    { value: 'DANG_XUAT', label: 'Đăng xuất' },
    { value: 'TAO_NHAN_VIEN', label: 'Tạo nhân viên' },
    { value: 'CAP_NHAT_NHAN_VIEN', label: 'Cập nhật nhân viên' },
    { value: 'CAP_NHAT_NHOM_QUYEN', label: 'Cập nhật nhóm quyền' },
    { value: 'CAP_NHAT_KHACH_HANG', label: 'Cập nhật khách hàng' },
    { value: 'DOI_TRANG_THAI_KHACH_HANG', label: 'Đổi trạng thái khách hàng' },
    { value: 'CAP_NHAT_HO_SO', label: 'Cập nhật hồ sơ KH' },
    { value: 'DOI_MAT_KHAU', label: 'Đổi mật khẩu' },
    { value: 'DAT_LAI_MAT_KHAU', label: 'Đặt lại mật khẩu' },
    { value: 'XAC_MINH_DANG_KY', label: 'Xác minh đăng ký' },
  ];

  constructor(
    private adminApi: AdminApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.fetchLogs();
  }

  fetchLogs(): void {
    this.isLoading = true;
    this.loadError = '';
    this.adminApi.getAuditLogs({
      page: this.page,
      limit: this.limit,
      action: this.selectedAction || undefined,
      search: this.searchKeyword.trim() || undefined,
    }).subscribe({
      next: (res) => {
        this.logs = res.logs || [];
        this.total = res.total || 0;
        this.page = res.page || 1;
        this.limit = res.limit || 15;
        this.totalPages = Math.max(1, Math.ceil(this.total / this.limit));
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

  onSearch(): void {
    this.page = 1;
    this.fetchLogs();
  }

  onFilterAction(): void {
    this.page = 1;
    this.fetchLogs();
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

  formatJson(val: any): string {
    if (!val || Object.keys(val).length === 0) return '—';
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }

  getActionLabel(action: string): string {
    const item = this.actionList.find(a => a.value === action);
    return item ? item.label : action;
  }

  getActionBadgeClass(action: string): string {
    switch (action) {
      case 'DANG_NHAP':
      case 'DANG_XUAT':
        return 'badge-info';
      case 'TAO_NHAN_VIEN':
      case 'XAC_MINH_DANG_KY':
        return 'badge-success';
      case 'CAP_NHAT_NHAN_VIEN':
      case 'CAP_NHAT_NHOM_QUYEN':
      case 'CAP_NHAT_KHACH_HANG':
      case 'CAP_NHAT_HO_SO':
        return 'badge-warning';
      case 'DOI_TRANG_THAI_KHACH_HANG':
      case 'DOI_MAT_KHAU':
      case 'DAT_LAI_MAT_KHAU':
        return 'badge-primary';
      default:
        return 'badge-secondary';
    }
  }
}
