import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService, AdminTransaction } from '../../services/admin-api.service';

interface TransactionItem {
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
export class TransactionListComponent implements OnInit {
    searchKeyword = '';
    selectedGateway = 'Tất cả';
    selectedStatus = 'Tất cả';

    isFilterMenuOpen = false;
    isSortMenuOpen = false;
    isExportMenuOpen = false;
    isAddModalOpen = false;

    newTransaction: TransactionItem | null = null;
    newTransactionDateText = '';

    gatewayOptions = [
        'VNPay',
        'Momo',
        'Chuyển khoản ngân hàng',
        'Thanh toán khi nhận hàng (COD)'
    ];

    statusOptions = [
        'Đã thanh toán',
        'Chờ thanh toán',
        'Thanh toán thất bại'
    ];

    editableStatusOptions = [
        'Đã thanh toán',
        'Thanh toán thất bại'
    ];

    currentPage = 1;
    pageSize = 10;

    editingTransactionIds = new Set<number>();

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
        }
    }

    private loadTransactions(): void {
        this.adminApi.getTransactions().subscribe({
            next: (response) => {
                this.transactions = response.transactions.map((transaction) => this.mapTransaction(transaction));
                this.filteredTransactions = [...this.transactions];
                this.currentPage = 1;
                this.editingTransactionIds.clear();
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load admin transactions', error);
                this.transactions = [];
                this.filteredTransactions = [];
                this.currentPage = 1;
                this.editingTransactionIds.clear();
                this.cdr.detectChanges();
            }
        });
    }

    private mapTransaction(transaction: AdminTransaction): TransactionItem {
        return {
            ...transaction,
            gateway: this.normalizeGateway(transaction.gateway),
            status: this.normalizeTransactionStatus(transaction.status),
            transactionDate: transaction.transactionDate ? new Date(transaction.transactionDate) : new Date(),
            selected: false
        };
    }

    private normalizeGateway(gateway: string): string {
        const raw = String(gateway || '').trim();
        const key = this.statusKey(raw);

        if (!raw) {
            return '';
        }

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
        const normalized = this.statusKey(raw);

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

    applyFilters(): void {
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

            return matchesKeyword && matchesGateway && matchesStatus;
        });

        this.currentPage = 1;
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

    toggleEditTransaction(transaction: TransactionItem): void {
        if (!this.canEditTransaction(transaction)) {
            return;
        }

        if (this.editingTransactionIds.has(transaction.id)) {
            this.editingTransactionIds.delete(transaction.id);
            const amount = this.parseMoneyAmount(transaction.amount);

            if (!Number.isFinite(amount) || amount < 0) {
                alert('Vui long nhap so tien hop le.');
                this.loadTransactions();
                return;
            }

            transaction.amount = amount;
            this.adminApi.updateTransaction(transaction.code, {
                gateway: transaction.gateway,
                status: transaction.status,
                amount: transaction.amount
            }).subscribe({
                next: (response) => {
                    const updatedTransaction = this.mapTransaction(response.transaction);
                    this.transactions = this.transactions.map((item) => {
                        return item.code === updatedTransaction.code ? updatedTransaction : item;
                    });
                    this.applyFilters();
                },
                error: (error) => {
                    console.error('Cannot update transaction', error);
                    alert('Không thể lưu giao dịch. Vui lòng thử lại.');
                    this.loadTransactions();
                }
            });
            return;
        }

        this.editingTransactionIds.add(transaction.id);
    }

    onRowSelectionChange(transaction: TransactionItem): void {
        if (!transaction.selected && this.hasSelectedTransactions) {
            this.editingTransactionIds.delete(transaction.id);
        }

        this.cleanEditingRows();
    }

    deleteSelectedTransactions(): void {
        if (!this.hasSelectedTransactions) {
            return;
        }

        if (!confirm(`Bạn có chắc muốn xóa ${this.selectedCount} giao dịch đã chọn?`)) {
            return;
        }

        const selectedIds = this.transactions
            .filter((item) => item.selected)
            .map((item) => item.id);

        this.transactions = this.transactions.filter((item) => {
            return !selectedIds.includes(item.id);
        });

        this.editingTransactionIds.clear();
        this.applyFilters();
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

    openAddModal(): void {
        this.isFilterMenuOpen = false;
        this.isSortMenuOpen = false;
        this.isExportMenuOpen = false;

        this.newTransaction = {
            id: 0,
            code: 'Tự động',
            orderCode: '',
            gateway: 'VNPay',
            status: 'Chờ thanh toán',
            amount: 0,
            referenceCode: '',
            transactionDate: new Date(),
            selected: false
        };

        this.newTransactionDateText = this.formatShortDate(new Date());
        this.isAddModalOpen = true;
    }

    closeAddModal(): void {
        this.isAddModalOpen = false;
        this.newTransaction = null;
        this.newTransactionDateText = '';
    }

    saveNewTransaction(): void {
        if (!this.newTransaction) {
            return;
        }

        if (!this.newTransaction.orderCode.trim()) {
            alert('Vui lòng nhập mã đơn hàng.');
            return;
        }

        if (!this.newTransaction.referenceCode.trim()) {
            alert('Vui lòng nhập mã giao dịch.');
            return;
        }

        const amount = this.parseMoneyAmount(this.newTransaction.amount);

        if (!Number.isFinite(amount) || amount <= 0) {
            alert('Vui lòng nhập số tiền hợp lệ.');
            return;
        }

        const parsedDate = this.parseShortDate(this.newTransactionDateText);

        if (!parsedDate) {
            alert('Ngày giao dịch phải có định dạng DD/MM/YYYY.');
            return;
        }

        this.adminApi.createTransaction({
            orderCode: this.newTransaction.orderCode.trim(),
            gateway: this.newTransaction.gateway,
            status: this.newTransaction.status,
            amount,
            referenceCode: this.newTransaction.referenceCode.trim(),
            transactionDate: parsedDate.toISOString()
        }).subscribe({
            next: () => {
                this.searchKeyword = '';
                this.selectedGateway = 'Tất cả';
                this.selectedStatus = 'Tất cả';
                this.currentPage = 1;
                this.closeAddModal();
                this.loadTransactions();
            },
            error: (error) => {
                console.error('Cannot create transaction', error);
                alert('Không thể thêm giao dịch. Vui lòng kiểm tra mã đơn hàng rồi thử lại.');
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
