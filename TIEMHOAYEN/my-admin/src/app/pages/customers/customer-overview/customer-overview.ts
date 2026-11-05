import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AdminApiService, AdminCustomer, AdminCustomerSummary, AdminLastLogin } from '../../../services/admin-api.service';

type SortField = 'name' | 'code' | 'point' | 'totalSpent' | 'debt' | 'totalOrders' | 'latestOrder';
type StatusFilter = 'all' | 'active' | 'locked' | 'pending' | 'debt';

interface Customer {
    id: string;
    code: string;
    name: string;
    avatarText: string;
    phone: string;
    email: string;
    point: number;
    membershipTier?: string;
    status: string;
    locked: boolean;
    lockReason: string;
    totalOrders: number;
    totalSpent: number;
    debt: number;
    latestOrderDate: string;
    lastLogin?: AdminLastLogin | null;
    createdAt: string;
    selected: boolean;
}

interface LockDialogState {
    customer: Customer;
    locking: boolean;
    reason: string;
    error: string;
    saving: boolean;
}

/** Server trả về cả `point` lẫn `points`, `id` là mã KH dạng chuỗi. */
type RawCustomer = AdminCustomer & { points?: number; id?: unknown };

const EMPTY_SUMMARY: AdminCustomerSummary = {
    total: 0,
    active: 0,
    locked: 0,
    pendingVerification: 0,
    newThisMonth: 0,
    withDebt: 0,
    totalDebt: 0,
    totalSpent: 0
};

@Component({
    selector: 'app-customer',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule
    ],
    templateUrl: './customer-overview.html',
    styleUrls: ['./customer-overview.css']
})
export class CustomerComponent implements OnInit, OnDestroy {
    searchKeyword = '';

    isFilterMenuOpen = false;
    isSortMenuOpen = false;
    isExportMenuOpen = false;

    isLoading = false;
    loadError = '';

    editingCustomerCode: string | null = null;
    editName = '';
    editError = '';
    isEditSaving = false;

    lockDialog: LockDialogState | null = null;

    toastMessage = '';
    toastType: 'success' | 'error' = 'success';
    private toastTimer: ReturnType<typeof setTimeout> | null = null;

    selectedRank = 'Tất cả';
    selectedStatus: StatusFilter = 'all';

    readonly statusOptions: Array<{ value: StatusFilter; label: string }> = [
        { value: 'all', label: 'Tất cả' },
        { value: 'active', label: 'Hoạt động' },
        { value: 'locked', label: 'Bị khóa' },
        { value: 'pending', label: 'Chờ xác minh' },
        { value: 'debt', label: 'Đang có nợ' }
    ];

    currentPage = 1;
    pageSize = 10;

    summary: AdminCustomerSummary = { ...EMPTY_SUMMARY };
    customers: Customer[] = [];
    filteredCustomers: Customer[] = [];

    constructor(
        private router: Router,
        private adminApi: AdminApiService,
        private cdr: ChangeDetectorRef,
        @Inject(PLATFORM_ID) private platformId: object
    ) {}

    ngOnInit(): void {
        if (isPlatformBrowser(this.platformId)) {
            this.loadCustomers();
        }
    }

    ngOnDestroy(): void {
        if (this.toastTimer) {
            clearTimeout(this.toastTimer);
        }
    }

    loadCustomers(): void {
        this.isLoading = true;
        this.loadError = '';

        this.adminApi.getCustomers()
            .pipe(finalize(() => {
                this.isLoading = false;
                this.cdr.detectChanges();
            }))
            .subscribe({
                next: (response) => {
                    this.customers = (response.customers || []).map((customer) => this.mapCustomer(customer));
                    this.summary = response.summary ? { ...EMPTY_SUMMARY, ...response.summary } : this.computeSummary();
                    this.applyFilters();
                },
                error: (error) => {
                    this.customers = [];
                    this.filteredCustomers = [];
                    this.currentPage = 1;
                    this.loadError = error?.error?.message || 'Không thể tải danh sách khách hàng.';
                }
            });
    }

    private mapCustomer(raw: AdminCustomer): Customer {
        const customer = raw as RawCustomer;
        const code = String(customer.code || customer.id || '');
        const status = customer.status || (customer.locked ? 'Bị khóa' : 'Hoạt động');

        return {
            id: String(customer.id ?? code),
            code,
            name: customer.name || '',
            avatarText: customer.avatarText || '',
            phone: customer.phone || '',
            email: customer.email || '',
            point: Number(customer.points ?? customer.point ?? 0) || 0,
            membershipTier: customer.membershipTier || '',
            status,
            locked: Boolean(customer.locked) || this.normalize(status) === 'bi khoa',
            lockReason: customer.lockReason || '',
            totalOrders: Number(customer.totalOrders || 0),
            totalSpent: Number(customer.totalSpent || 0),
            debt: Number(customer.debt || 0),
            latestOrderDate: customer.latestOrderDate || '',
            lastLogin: customer.lastLogin || null,
            createdAt: customer.createdAt || '',
            selected: false
        };
    }

    /** Dự phòng khi server chưa gửi summary. */
    private computeSummary(): AdminCustomerSummary {
        const now = new Date();
        return this.customers.reduce((acc, customer) => {
            const key = this.statusKey(customer);
            const created = customer.createdAt ? new Date(customer.createdAt) : null;
            acc.total++;
            if (key === 'active') acc.active++;
            if (key === 'locked') acc.locked++;
            if (key === 'pending') acc.pendingVerification++;
            if (created && created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth()) acc.newThisMonth++;
            if (customer.debt > 0) {
                acc.withDebt++;
                acc.totalDebt += customer.debt;
            }
            acc.totalSpent += customer.totalSpent;
            return acc;
        }, { ...EMPTY_SUMMARY });
    }

    get totalPages(): number {
        return Math.ceil(this.filteredCustomers.length / this.pageSize) || 1;
    }

    get pages(): (number | string)[] {
        const total = this.totalPages;
        const current = this.currentPage;

        if (total <= 7) {
            return Array.from({ length: total }, (_, index) => index + 1);
        }

        if (current <= 4) {
            return [1, 2, 3, 4, 5, '...', total];
        }

        if (current >= total - 3) {
            return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
        }

        return [1, '...', current - 1, current, current + 1, '...', total];
    }

    get pagedCustomers(): Customer[] {
        const startIndex = (this.currentPage - 1) * this.pageSize;
        return this.filteredCustomers.slice(startIndex, startIndex + this.pageSize);
    }

    goToCustomerDetail(customer: Customer): void {
        if (this.editingCustomerCode === customer.code) {
            return;
        }

        this.router.navigate(['/customers', customer.code], {
            state: { customer }
        });
    }

    getRankByPoint(point: number): string {
        if (point >= 600) return 'Kim cương';
        if (point >= 300) return 'Vàng';
        if (point >= 100) return 'Bạc';
        return 'Đồng';
    }

    getCustomerRank(customer: Customer): string {
        const tier = this.normalizeRankName(customer.membershipTier || '');
        return tier || this.getRankByPoint(customer.point);
    }

    getRankImage(customer: Customer): string {
        switch (this.getCustomerRank(customer)) {
            case 'Kim cương': return 'assets/images/diamond_tags.png';
            case 'Vàng': return 'assets/images/gold_tags.png';
            case 'Bạc': return 'assets/images/silver_tags.png';
            case 'Đồng': return 'assets/images/bronze_tags.png';
            default: return '';
        }
    }

    private normalizeRankName(rank: string): string {
        const rankKey = this.normalize(rank);

        if (rankKey.includes('kim') || rankKey.includes('cuong')) return 'Kim cương';
        if (rankKey.includes('vang')) return 'Vàng';
        if (rankKey.includes('bac')) return 'Bạc';
        if (rankKey.includes('dong')) return 'Đồng';
        return '';
    }

    statusKey(customer: Customer): StatusFilter {
        if (customer.locked) return 'locked';
        const key = this.normalize(customer.status);
        if (key.includes('khoa')) return 'locked';
        if (key.includes('xac minh')) return 'pending';
        return 'active';
    }

    getStatusClass(customer: Customer): string {
        return `status-badge status-${this.statusKey(customer)}`;
    }

    formatMoney(value: number): string {
        return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
    }

    applyFilters(): void {
        const keyword = this.normalize(this.searchKeyword.trim());
        const selectedRank = this.normalize(this.selectedRank);

        this.filteredCustomers = this.customers.filter((customer) => {
            const normalizedRank = this.normalize(this.getCustomerRank(customer));

            const matchesKeyword = !keyword
                || this.normalize(customer.code).includes(keyword)
                || this.normalize(customer.name).includes(keyword)
                || this.normalize(customer.phone).includes(keyword)
                || this.normalize(customer.email).includes(keyword)
                || normalizedRank.includes(keyword);

            const matchesRank = this.normalize(this.selectedRank) === 'tat ca'
                || normalizedRank === selectedRank;

            return matchesKeyword && matchesRank && this.matchesStatus(customer);
        });

        this.currentPage = 1;
    }

    private matchesStatus(customer: Customer): boolean {
        switch (this.selectedStatus) {
            case 'all': return true;
            case 'debt': return customer.debt > 0;
            default: return this.statusKey(customer) === this.selectedStatus;
        }
    }

    setStatusFilter(status: StatusFilter): void {
        this.selectedStatus = status;
        this.applyFilters();
    }

    // ---------- AD34: inline edit (chỉ họ tên) ----------
    startInlineEdit(customer: Customer): void {
        if (this.isEditSaving) {
            return;
        }

        this.editingCustomerCode = customer.code;
        this.editName = customer.name;
        this.editError = '';
    }

    cancelInlineEdit(): void {
        if (this.isEditSaving) {
            return;
        }

        this.editingCustomerCode = null;
        this.editError = '';
    }

    saveInlineEdit(customer: Customer): void {
        if (this.isEditSaving) {
            return;
        }

        const name = this.editName.trim();

        if (!name) {
            this.editError = 'Vui lòng nhập họ tên.';
            return;
        }

        if (name.length > 100) {
            this.editError = 'Họ tên tối đa 100 ký tự.';
            return;
        }

        if (name === customer.name) {
            this.editingCustomerCode = null;
            this.editError = '';
            return;
        }

        this.isEditSaving = true;
        this.editError = '';

        this.adminApi.updateCustomer(customer.code, { name })
            .pipe(finalize(() => {
                this.isEditSaving = false;
                this.cdr.detectChanges();
            }))
            .subscribe({
                next: (response) => {
                    this.replaceCustomer(customer.code, response.customer);
                    this.editingCustomerCode = null;
                    this.showToast(response.message || 'Đã cập nhật khách hàng.', 'success');
                },
                error: (error) => {
                    this.editError = error?.name === 'TimeoutError'
                        ? 'Lưu quá lâu, vui lòng thử lại.'
                        : (error?.error?.message || 'Không thể lưu khách hàng.');
                }
            });
    }

    private replaceCustomer(code: string, updated: AdminCustomer): void {
        const current = this.customers.find((item) => item.code === code);
        const mapped = this.mapCustomer({ ...(current || {}), ...updated } as AdminCustomer);
        mapped.selected = current?.selected || false;

        const swap = (list: Customer[]) => list.map((item) => item.code === code ? mapped : item);
        this.customers = swap(this.customers);
        // Giữ nguyên vị trí/trang hiện tại thay vì lọc lại toàn bộ.
        this.filteredCustomers = swap(this.filteredCustomers);
        this.summary = this.computeSummaryWithServerTotals();
    }

    /** Cập nhật đếm trạng thái sau khi khóa/mở khóa, giữ các số liệu khác của server. */
    private computeSummaryWithServerTotals(): AdminCustomerSummary {
        const local = this.computeSummary();
        return {
            ...this.summary,
            active: local.active,
            locked: local.locked,
            pendingVerification: local.pendingVerification
        };
    }

    // ---------- AD33: khóa / mở khóa ----------
    openLockDialog(customer: Customer): void {
        this.lockDialog = {
            customer,
            locking: !customer.locked,
            reason: '',
            error: '',
            saving: false
        };
    }

    closeLockDialog(): void {
        if (this.lockDialog?.saving) {
            return;
        }

        this.lockDialog = null;
    }

    confirmLockDialog(): void {
        const dialog = this.lockDialog;

        if (!dialog || dialog.saving) {
            return;
        }

        const reason = dialog.reason.trim();

        if (dialog.locking && !reason) {
            dialog.error = 'Vui lòng nhập lý do khóa tài khoản.';
            return;
        }

        if (reason.length > 300) {
            dialog.error = 'Lý do tối đa 300 ký tự.';
            return;
        }

        dialog.saving = true;
        dialog.error = '';

        this.adminApi.setCustomerLock(dialog.customer.code, dialog.locking, reason)
            .pipe(finalize(() => {
                dialog.saving = false;
                this.cdr.detectChanges();
            }))
            .subscribe({
                next: (response) => {
                    this.replaceCustomer(dialog.customer.code, response.customer);
                    this.lockDialog = null;
                    this.showToast(
                        response.message || (dialog.locking ? 'Đã khóa tài khoản.' : 'Đã mở khóa tài khoản.'),
                        'success'
                    );
                },
                error: (error) => {
                    dialog.error = error?.error?.message || 'Không thể cập nhật trạng thái tài khoản.';
                }
            });
    }

    // ---------- Xuất CSV ----------
    exportCsv(): void {
        this.isExportMenuOpen = false;

        if (!isPlatformBrowser(this.platformId) || this.filteredCustomers.length === 0) {
            this.showToast('Không có khách hàng để xuất.', 'error');
            return;
        }

        const header = ['Mã KH', 'Khách hàng', 'SĐT', 'Email', 'Số đơn', 'Đơn gần nhất', 'Nợ phải thu', 'Tổng chi tiêu', 'Hạng', 'Điểm', 'Trạng thái'];
        const rows = this.filteredCustomers.map((customer) => [
            customer.code,
            customer.name,
            customer.phone,
            customer.email,
            customer.totalOrders,
            customer.latestOrderDate,
            customer.debt,
            customer.totalSpent,
            this.getCustomerRank(customer),
            customer.point,
            customer.status
        ]);

        const escape = (value: unknown) => {
            const text = String(value ?? '');
            return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        };
        const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const today = new Date().toISOString().slice(0, 10);

        link.href = url;
        link.download = `khach-hang-${today}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    private showToast(message: string, type: 'success' | 'error'): void {
        this.toastMessage = message;
        this.toastType = type;

        if (this.toastTimer) {
            clearTimeout(this.toastTimer);
        }

        this.toastTimer = setTimeout(() => {
            this.toastMessage = '';
            this.cdr.detectChanges();
        }, 3500);
    }

    getAvatarText(name: string): string {
        return String(name || '')
            .trim()
            .split(' ')
            .filter((word) => word.length > 0)
            .slice(-2)
            .map((word) => word.charAt(0).toUpperCase())
            .join('');
    }

    private parseViDate(value: string): number {
        const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value || '').trim());
        if (match) {
            return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])).getTime();
        }

        const time = new Date(value).getTime();
        return Number.isNaN(time) ? 0 : time;
    }

    sortCustomers(field: SortField): void {
        this.filteredCustomers.sort((a, b) => {
            switch (field) {
                case 'name': return a.name.localeCompare(b.name, 'vi');
                case 'code': return a.code.localeCompare(b.code);
                case 'point': return b.point - a.point;
                case 'totalSpent': return b.totalSpent - a.totalSpent;
                case 'debt': return b.debt - a.debt;
                case 'totalOrders': return b.totalOrders - a.totalOrders;
                case 'latestOrder': return this.parseViDate(b.latestOrderDate) - this.parseViDate(a.latestOrderDate);
                default: return 0;
            }
        });

        this.currentPage = 1;
        this.isSortMenuOpen = false;
    }

    toggleFilterMenu(): void {
        this.isFilterMenuOpen = !this.isFilterMenuOpen;
        this.isSortMenuOpen = false;
        this.isExportMenuOpen = false;
    }

    toggleSortMenu(): void {
        this.isSortMenuOpen = !this.isSortMenuOpen;
        this.isFilterMenuOpen = false;
        this.isExportMenuOpen = false;
    }

    toggleExportMenu(): void {
        this.isExportMenuOpen = !this.isExportMenuOpen;
        this.isFilterMenuOpen = false;
        this.isSortMenuOpen = false;
    }

    goToPage(page: number | string): void {
        if (typeof page === 'number') {
            this.currentPage = page;
        }
    }

    previousPage(): void {
        if (this.currentPage > 1) {
            this.currentPage--;
        }
    }

    nextPage(): void {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
        }
    }

    private normalize(value: string): string {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .trim();
    }
}
