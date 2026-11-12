import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { interval, Subscription } from 'rxjs';
import { AdminApiService, AdminTransaction } from '../../services/admin-api.service';

type TransactionField = 'orderCode' | 'status' | 'amount' | 'referenceCode' | 'reason' | 'date' | 'general';
type TransactionErrors = Partial<Record<TransactionField, string>>;

interface TransactionItem {
    kind?: AdminTransaction['kind'];
    canRecordBalance?: boolean;
    collection?: AdminTransaction['collection'];
    total?: number; deposit?: number; paid?: number; remaining?: number; editable?: boolean; confirmedAt?: string; confirmedBy?: string; history?: any[];
    id: number;
    code: string;
    orderCode: string;
    gateway: string;
    status: string;
    amount: number;
    referenceCode: string;
    transactionDate: Date;
    selected: boolean;
}

@Component({
    selector: 'app-transaction-list',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule
    ],
    templateUrl: './transaction-list.html',
    styleUrls: ['./transaction-list.css']
})
export class TransactionListComponent implements OnInit, OnDestroy {
    errorMessage = '';
    fromDate = ''; toDate = '';
    get canCreate(): boolean { return this.adminApi.can('payments','create'); }
    searchKeyword = '';
    selectedGateway = 'Tất cả';
    selectedStatus = 'Tất cả';

    isFilterMenuOpen = false;
    isSortMenuOpen = false;
    isExportMenuOpen = false;
    isAddModalOpen = false;

    newTransaction: TransactionItem | null = null;
    newTransactionDateText = '';
    balanceReason = '';
    savingBalance = false;
    balanceErrors: TransactionErrors = {};

    gatewayOptions = [
        'VNPay',
        'Momo',
        'Chuyển khoản ngân hàng',
        'Thanh toán khi nhận hàng (COD)'
    ];

    statusOptions = [
        'Đã thanh toán',
        'Đã thanh toán cọc',
        'Chờ thanh toán',
        'Chờ đối soát',
        'Thanh toán thất bại',
        'Thanh toán cọc thất bại',
        'Hết hạn'
    ];

    /** Khoản nhân viên giao hàng đã thu khi giao, chờ Nhân viên bán hàng đối chiếu tiền nộp. */
    get pendingCashCount(): number { return this.transactions.filter(t => t.status === 'Chờ đối soát').length; }
    togglePendingCashFilter(): void {
        this.selectedStatus = this.selectedStatus === 'Chờ đối soát' ? 'Tất cả' : 'Chờ đối soát';
        this.applyFilters();
    }

    readonly balanceStatuses = ['Đã thanh toán', 'Thanh toán thất bại'];
    private readonly fullStatuses = [
        'Đã thanh toán',
        'Thanh toán thất bại',
        'Hết hạn'
    ];
    private readonly depositStatuses = ['Đã thanh toán cọc', 'Thanh toán cọc thất bại', 'Hết hạn'];

    editableStatusOptions(item: TransactionItem): readonly string[] {
        if (item.kind === 'balance') return this.balanceStatuses;
        if (item.kind === 'deposit') return this.depositStatuses;
        return this.fullStatuses;
    }

    currentPage = 1;
    pageSize = 10;

    editingTransactionIds = new Set<number>();
    expandedHistoryIds = new Set<number>();
    editReasons: Record<string, string> = {};
    editErrors: Record<string, TransactionErrors> = {};
    private savingTransactions = new Set<string>();
    private readonly liveRefreshMs = 30000;
    private liveRefreshSub?: Subscription;
    private isLiveRefreshInFlight = false;

    constructor(
        private adminApi: AdminApiService,
        private cdr: ChangeDetectorRef,
        @Inject(PLATFORM_ID) private platformId: object
    ) {}

    transactions: TransactionItem[] = [];

    filteredTransactions: TransactionItem[] = [];

    ngOnInit(): void {
        if (isPlatformBrowser(this.platformId)) {
            this.loadTransactions();
            this.startLiveDatabaseRefresh();
        }
    }

    ngOnDestroy(): void {
        this.liveRefreshSub?.unsubscribe();
    }

    private loadTransactions(preservePage = false): void {
        if (preservePage && this.isLiveRefreshInFlight) {
            return;
        }

        const previousPage = this.currentPage;
        const selectedCodes = preservePage
            ? new Set(this.transactions.filter((item) => item.selected).map((item) => item.code))
            : new Set<string>();

        if (preservePage) {
            this.isLiveRefreshInFlight = true;
        }

        this.adminApi.refreshTransactionsFromDatabase().subscribe({
            next: (response) => {
                this.transactions = response.transactions.map((transaction) => {
                    const item = this.mapTransaction(transaction);
                    return {
                        ...item,
                        selected: selectedCodes.has(item.code)
                    };
                });

                if (preservePage) {
                    this.applyFilters(false);
                    this.currentPage = previousPage;
                    this.ensureValidPage();
                } else {
                    this.applyFilters();
                    this.currentPage = 1;
                    this.editingTransactionIds.clear();
                }

                this.isLiveRefreshInFlight = false;
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load admin transactions', error);
                if (!preservePage) {
                    this.transactions = [];
                    this.filteredTransactions = [];
                    this.currentPage = 1;
                    this.editingTransactionIds.clear();
                }
                this.isLiveRefreshInFlight = false;
                this.cdr.detectChanges();
            }
        });
    }

    private startLiveDatabaseRefresh(): void {
        this.liveRefreshSub?.unsubscribe();
        this.liveRefreshSub = interval(this.liveRefreshMs).subscribe(() => {
            if (this.shouldPauseLiveRefresh()) {
                return;
            }

            this.loadTransactions(true);
        });
    }

    private shouldPauseLiveRefresh(): boolean {
        return (
            (typeof document !== 'undefined' && document.hidden) ||
            this.isAddModalOpen ||
            this.editingTransactionIds.size > 0 ||
            this.hasSelectedTransactions ||
            this.isFilterMenuOpen ||
            this.isSortMenuOpen ||
            this.isExportMenuOpen
        );
    }

    private mapTransaction(transaction: AdminTransaction): TransactionItem {
        const row = transaction as any;
        return {
            ...transaction,
            id: row.id ?? row.THANH_TOAN_ID,
            code: row.code ?? row.THANH_TOAN_ID ?? String(row.id || ''),
            orderCode: row.orderCode ?? row.orderId ?? row.DON_HANG_ID ?? '',
            referenceCode: row.referenceCode ?? row.MA_GIAO_DICH ?? '',
            gateway: this.normalizeGateway(transaction.gateway),
            status: this.normalizeTransactionStatus(transaction.status),
            transactionDate: (row.transactionDate || row.paidAt || row.NGAY_THANH_TOAN) ? new Date(row.transactionDate || row.paidAt || row.NGAY_THANH_TOAN) : new Date(),
            selected: false
        };
    }

    private normalizeGateway(gateway: string): string {
        const raw = String(gateway || '').trim();
        const key = this.statusKey(raw);

        if (!raw) {
            return '';
        }

        if (key === 'momo') return 'Momo';
        if (key === 'vnpay') return 'VNPay';
        if (raw === 'COD' || key.includes('cod') || key.includes('nhan hang')) {
            return 'Thanh toán khi nhận hàng (COD)';
        }

        if (key.includes('chuyen khoan') || key.includes('ngan hang')) {
            return 'Chuyển khoản ngân hàng';
        }

        return raw;
    }

    private statusKey(status: string): string {
        return String(status || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[đĐ]/g, 'd')
            .replace(/[�?]/g, '')
            .toLowerCase();
    }

    private normalizeTransactionStatus(status: string): string {
        const raw = String(status || '').trim();
        if (this.depositStatuses.includes(raw)) return raw;
        const normalized = this.statusKey(raw);
        if (normalized.includes('doi soat')) return 'Chờ đối soát';

        if (!raw) {
            return 'Chờ thanh toán';
        }

        if (
            normalized.includes('that bai') ||
            normalized.includes('thanh ton tht b') ||
            normalized.includes('thanh toan tht b') ||
            normalized.includes('thanh ton that b') ||
            normalized.includes('failed') ||
            normalized.includes('fail')
        ) {
            return 'Thanh toán thất bại';
        }

        if (
            normalized.includes('thanh cong') ||
            normalized.includes('da thanh toan') ||
            normalized.includes('da thanh ton') ||
            normalized.includes('success')
        ) {
            return 'Đã thanh toán';
        }

        if (normalized.includes('coc')) {
            return 'Đã thanh toán';
        }

        if (
            normalized.includes('dang thanh toan') ||
            normalized.includes('dang thanh ton') ||
            normalized.includes('ang thanh ton') ||
            normalized.includes('pending')
        ) {
            return 'Chờ thanh toán';
        }

        if (
            normalized.includes('cho thanh toan') ||
            normalized.includes('cho thanh ton') ||
            normalized.includes('chua thanh toan') ||
            normalized.includes('chua thanh ton') ||
            normalized.includes('ch thanh ton') ||
            normalized.includes('thanh toan') ||
            normalized.includes('thanh ton')
        ) {
            return 'Chờ thanh toán';
        }

        return raw;
    }

    get selectedCount(): number {
        return this.filteredTransactions.filter((item) => item.selected).length;
    }

    get hasSelectedTransactions(): boolean {
        return this.selectedCount > 0;
    }

    get totalPages(): number {
        return Math.ceil(this.filteredTransactions.length / this.pageSize) || 1;
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

    get pagedTransactions(): TransactionItem[] {
        const start = (this.currentPage - 1) * this.pageSize;
        return this.filteredTransactions.slice(start, start + this.pageSize);
    }

    applyFilters(resetPage = true): void {
        const keyword = this.searchKeyword.trim().toLowerCase();

        this.filteredTransactions = this.transactions.filter((item) => {
            const matchesKeyword =
                item.code.toLowerCase().includes(keyword) ||
                item.orderCode.toLowerCase().includes(keyword) ||
                item.gateway.toLowerCase().includes(keyword) ||
                item.status.toLowerCase().includes(keyword) ||
                item.referenceCode.toLowerCase().includes(keyword) ||
                this.formatPrice(item.amount).includes(keyword) ||
                this.formatDate(item.transactionDate).includes(keyword);

            const matchesGateway =
                this.selectedGateway === 'Tất cả' ||
                item.gateway === this.selectedGateway;

            const matchesStatus =
                this.selectedStatus === 'Tất cả' ||
                item.status === this.selectedStatus;

            const date = this.formatShortDate(item.transactionDate).split('/').reverse().join('-');
            return matchesKeyword && matchesGateway && matchesStatus && (!this.fromDate || date >= this.fromDate) && (!this.toDate || date <= this.toDate);
        });

        if (resetPage) {
            this.currentPage = 1;
        }
        this.ensureValidPage();
        this.cleanEditingRows();
    }

    sortTransactions(field: string): void {
        this.filteredTransactions.sort((a, b) => {
            if (field === 'code') {
                return a.code.localeCompare(b.code, 'vi');
            }

            if (field === 'orderCode') {
                return a.orderCode.localeCompare(b.orderCode, 'vi');
            }

            if (field === 'gateway') {
                return a.gateway.localeCompare(b.gateway, 'vi');
            }

            if (field === 'status') {
                return a.status.localeCompare(b.status, 'vi');
            }

            if (field === 'amount') {
                return b.amount - a.amount;
            }

            if (field === 'transactionDate') {
                return b.transactionDate.getTime() - a.transactionDate.getTime();
            }

            return 0;
        });

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

    toggleSelectAll(event: Event): void {
        const input = event.target as HTMLInputElement;

        this.pagedTransactions.forEach((item) => {
            item.selected = input.checked;
        });

        this.cleanEditingRows();
    }

    isAllSelected(): boolean {
        return this.pagedTransactions.length > 0 &&
            this.pagedTransactions.every((item) => item.selected);
    }

    canEditTransaction(transaction: TransactionItem): boolean {
        if (!this.adminApi.can('payments','update') || !transaction.editable || this.savingTransactions.has(transaction.code)) return false;
        if (!this.hasSelectedTransactions) {
            return true;
        }

        return transaction.selected;
    }

    isEditingTransaction(transaction: TransactionItem): boolean {
        return this.editingTransactionIds.has(transaction.id);
    }

    transactionStatusClass(status: string): string {
        const normalized = this.statusKey(status);

        if (normalized.includes('het han') || normalized.includes('expired')) {
            return 'status-badge--failed';
        }

        if (normalized.includes('that bai') || normalized.includes('fail')) {
            return 'status-badge--failed';
        }

        if (normalized.includes('thanh cong') || normalized.includes('da thanh toan')) {
            return 'status-badge--success';
        }

        if (normalized.includes('coc')) {
            return 'status-badge--deposit';
        }

        if (normalized.includes('dang')) {
            return 'status-badge--processing';
        }

        if (normalized.includes('cho') || normalized.includes('chua')) {
            return 'status-badge--waiting';
        }

        return 'status-badge--default';
    }

    reconciliationLabel(item: TransactionItem): string {
        const required = Number(item.deposit || item.total || 0);
        const paid = Number(item.paid || 0);
        if (paid <= 0) return 'Chưa ghi nhận thu';
        if (paid < required) return `Thiếu ${this.formatPrice(required - paid)}`;
        if (paid > Number(item.total || 0)) return `Thừa ${this.formatPrice(paid - Number(item.total || 0))}`;
        return Number(item.remaining || 0) > 0 ? 'Đã đủ cọc · còn số dư' : 'Đã thu đủ';
    }

    reconciliationClass(item: TransactionItem): string {
        const label = this.reconciliationLabel(item);
        if (label.startsWith('Thiếu') || label.startsWith('Chưa')) return 'reconciliation--warning';
        if (label.startsWith('Thừa')) return 'reconciliation--danger';
        return 'reconciliation--ok';
    }

    toggleHistory(item: TransactionItem): void {
        this.expandedHistoryIds.has(item.id) ? this.expandedHistoryIds.delete(item.id) : this.expandedHistoryIds.add(item.id);
    }

    toggleEditTransaction(transaction: TransactionItem): void {
        if (!this.canEditTransaction(transaction)) {
            return;
        }

        if (this.editingTransactionIds.has(transaction.id)) {
            const errors: TransactionErrors = {};
            if (!this.editableStatusOptions(transaction).includes(transaction.status)) {
                errors.status = 'Vui lòng chọn kết quả đối soát giao dịch.';
            }
            const reason = String(this.editReasons[transaction.code] || '').trim();
            if (!reason) errors.reason = 'Vui lòng nhập căn cứ đối soát giao dịch.';
            if (transaction.status.startsWith('Đã thanh toán') && !transaction.referenceCode.trim()) {
                errors.referenceCode = 'Vui lòng nhập mã giao dịch.';
            }
            const amount = this.parseMoneyAmount(transaction.amount);
            if (!Number.isSafeInteger(amount) || amount <= 0) errors.amount = 'Số tiền giao dịch không hợp lệ.';
            this.editErrors[transaction.code] = errors;
            if (Object.keys(errors).length) return;

            transaction.amount = amount;
            this.savingTransactions.add(transaction.code);
            this.adminApi.updateTransaction(transaction.code, {
                gateway: transaction.gateway,
                status: transaction.status,
                amount: transaction.amount,
                referenceCode: transaction.referenceCode,
                reason,
                source: 'ADMIN_MANUAL'
            }).subscribe({
                next: () => {
                    this.savingTransactions.delete(transaction.code);
                    delete this.editReasons[transaction.code];
                    delete this.editErrors[transaction.code];
                    this.loadTransactions();
                },
                error: (error) => {
                    this.savingTransactions.delete(transaction.code);
                    this.editErrors[transaction.code] = this.paymentErrors(error?.error?.message || 'Không thể lưu giao dịch. Vui lòng thử lại.');
                    this.cdr.markForCheck();
                }
            });
            return;
        }

        delete this.editErrors[transaction.code];
        this.editingTransactionIds.add(transaction.id);
    }

    private paymentErrors(message: string): TransactionErrors {
        if (/chọn kết quả đối soát/.test(message)) return { status: message };
        if (/mã tham chiếu/.test(message)) return { referenceCode: message };
        if (/căn cứ đối soát/.test(message)) return { reason: message };
        if (/không tìm thấy đơn hàng/.test(message.toLowerCase())) return { orderCode: message };
        if (/số tiền|khớp nghĩa vụ/.test(message.toLowerCase())) return { amount: message };
        return { general: message };
    }

    onRowSelectionChange(transaction: TransactionItem): void {
        if (!transaction.selected && this.hasSelectedTransactions) {
            this.editingTransactionIds.delete(transaction.id);
        }

        this.cleanEditingRows();
    }

    deleteSelectedTransactions(): void {
        this.errorMessage = 'Giao dịch được giữ để đối soát, không hỗ trợ xóa.';
    }

    exportTransactions(format: 'excel' | 'pdf'): void {
        const ids = new Set((this.selectedCount ? this.filteredTransactions.filter(t => t.selected) : this.filteredTransactions).map(t => t.code));
        this.adminApi.getTransactions().subscribe({ next: response => {
            const rows = response.transactions.filter(t => ids.has(t.code)).map(t => [t.code, t.orderCode, t.gateway, t.status, t.amount, t.referenceCode, t.transactionDate, t.total || 0, t.deposit || 0, t.paid || 0, t.remaining || 0]);
            const headers = ['Ma GD','Ma don','Phuong thuc','Trang thai','So tien GD','Tham chieu','Ngay GD','Tong don','Coc yeu cau','Da thu cua don','Con lai cua don'];
            if (format === 'excel') { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Giao dich'); XLSX.writeFile(book, 'TiemHoaYen-GiaoDich.xlsx'); }
            else { const pdf = new jsPDF({orientation:'landscape'}); autoTable(pdf,{head:[headers],body:rows.map(r => r.map(v => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D')))}); pdf.save('TiemHoaYen-GiaoDich.pdf'); }
            this.isExportMenuOpen = false;
        }, error: e => { this.errorMessage = e?.error?.message || 'Chưa xuất được dữ liệu.'; this.cdr.markForCheck(); } });
    }

    previousPage(): void {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.cleanEditingRows();
        }
    }

    nextPage(): void {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.cleanEditingRows();
        }
    }

    goToPage(page: number | string): void {
        if (typeof page !== 'number') {
            return;
        }

        this.currentPage = page;
        this.cleanEditingRows();
    }

    private ensureValidPage(): void {
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }

        if (this.currentPage < 1) {
            this.currentPage = 1;
        }
    }

    formatPrice(value: number): string {
        return Number(value).toLocaleString('vi-VN') + 'đ';
    }

    formatDate(date: Date): string {
        return new Date(date).toLocaleDateString('vi-VN');
    }

    private cleanEditingRows(): void {
        if (!this.hasSelectedTransactions) {
            return;
        }

        this.filteredTransactions.forEach((item) => {
            if (!item.selected) {
                this.editingTransactionIds.delete(item.id);
            }
        });
    }

    openAddModal(item?: TransactionItem): void {
        if (!this.canCreate) return;
        this.isFilterMenuOpen = false;
        this.isSortMenuOpen = false;
        this.isExportMenuOpen = false;

        this.newTransaction = {
            id: 0,
            code: 'Tự động',
            orderCode: item?.orderCode || '',
            gateway: item?.gateway || 'Thanh toán khi nhận hàng (COD)',
            status: 'Đã thanh toán',
            amount: item?.remaining || 0,
            referenceCode: '',
            transactionDate: new Date(),
            selected: false
        };

        this.newTransactionDateText = this.formatShortDate(new Date());
        this.balanceReason = '';
        this.balanceErrors = {};
        this.isAddModalOpen = true;
    }

    closeAddModal(): void {
        if (this.savingBalance) return;
        this.isAddModalOpen = false;
        this.newTransaction = null;
        this.newTransactionDateText = '';
    }

    saveNewTransaction(): void {
        if (!this.canCreate || this.savingBalance) return;
        if (!this.newTransaction) {
            return;
        }

        const errors: TransactionErrors = {};
        if (!this.newTransaction.orderCode.trim()) errors.orderCode = 'Vui lòng nhập mã đơn hàng.';
        if (!this.newTransaction.referenceCode.trim()) errors.referenceCode = 'Vui lòng nhập mã giao dịch.';
        const reason = this.balanceReason.trim();
        if (!reason) errors.reason = 'Vui lòng nhập căn cứ đối soát giao dịch.';
        const amount = this.parseMoneyAmount(this.newTransaction.amount);
        if (!Number.isSafeInteger(amount) || amount <= 0) errors.amount = 'Vui lòng nhập số tiền hợp lệ.';
        const parsedDate = this.parseShortDate(this.newTransactionDateText);
        if (!parsedDate) errors.date = 'Ngày giao dịch phải có định dạng DD/MM/YYYY.';
        this.balanceErrors = errors;
        if (!parsedDate || Object.keys(errors).length) return;

        this.savingBalance = true;
        this.adminApi.createTransaction({
            orderCode: this.newTransaction.orderCode.trim(),
            gateway: this.newTransaction.gateway,
            status: this.newTransaction.status,
            amount,
            referenceCode: this.newTransaction.referenceCode.trim(),
            transactionDate: parsedDate.toISOString(),
            balance: true,
            reason
        }).subscribe({
            next: () => {
                this.savingBalance = false;
                this.searchKeyword = this.newTransaction?.orderCode.trim() || '';
                this.selectedGateway = 'Tất cả';
                this.selectedStatus = 'Tất cả';
                this.currentPage = 1;
                this.closeAddModal();
                this.loadTransactions();
            },
            error: (error) => {
                this.savingBalance = false;
                this.balanceErrors = this.paymentErrors(error?.error?.message || 'Không thể lưu giao dịch. Vui lòng thử lại.');
                this.cdr.markForCheck();
            }
        });

    }

    private formatShortDate(date: Date): string {
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();

        return `${day}/${month}/${year}`;
    }

    private parseShortDate(value: string): Date | null {
        const datePattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
        const match = value.trim().match(datePattern);

        if (!match) {
            return null;
        }

        const day = Number(match[1]);
        const month = Number(match[2]);
        const year = Number(match[3]);

        const date = new Date(year, month - 1, day);

        if (
            date.getDate() !== day ||
            date.getMonth() !== month - 1 ||
            date.getFullYear() !== year
        ) {
            return null;
        }

        return date;
    }

    private parseMoneyAmount(value: unknown): number {
        if (typeof value === 'number') {
            return value;
        }

        const normalized = String(value ?? '')
            .replace(/[^\d,.-]/g, '')
            .replace(/\./g, '')
            .replace(',', '.');

        return Number(normalized);
    }
}
