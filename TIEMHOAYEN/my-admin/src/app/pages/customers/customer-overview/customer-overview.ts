import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminApiService, AdminCustomer } from '../../../services/admin-api.service';

type SortField = 'name' | 'code' | 'point' | 'createdAt';

interface Customer {
    id: number;
    code: string;
    name: string;
    avatarText: string;
    phone: string;
    email: string;
    point: number;
    membershipTier?: string;
    createdAt: Date;
    selected: boolean;
}

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
export class CustomerComponent implements OnInit {
    searchKeyword = '';

    isFilterMenuOpen = false;
    isSortMenuOpen = false;
    isExportMenuOpen = false;

    editingCustomerId: number | null = null;

    selectedRank = 'Tất cả';
    selectedDateFilter = 'Tất cả';

    currentPage = 1;
    pageSize = 10;

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

    private loadCustomers(): void {
        this.adminApi.getCustomers().subscribe({
            next: (response) => {
                this.customers = response.customers.map((customer) => this.mapCustomer(customer));
                this.applyFilters();
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load admin customers', error);
                this.customers = [];
                this.filteredCustomers = [];
                this.currentPage = 1;
                this.cdr.detectChanges();
            }
        });
    }

    private mapCustomer(customer: AdminCustomer): Customer {
        return {
            ...customer,
            createdAt: customer.createdAt ? new Date(customer.createdAt) : new Date(),
            selected: false
        };
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

    get selectedCount(): number {
        return this.customers.filter((customer) => customer.selected).length;
    }

    get pagedCustomers(): Customer[] {
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;

        return this.filteredCustomers.slice(startIndex, endIndex);
    }

    goToCustomerDetail(customer: Customer): void {
        this.router.navigate(['/customers', customer.code], {
            state: { customer }
        });
    }

    getRankByPoint(point: number): string {
        if (point >= 600) {
            return 'Kim cương';
        }

        if (point >= 300) {
            return 'Vàng';
        }

        if (point >= 100) {
            return 'Bạc';
        }

        return 'Đồng';
    }

    getCustomerRank(customer: Customer): string {
        const tier = this.normalizeRankName(customer.membershipTier || '');

        return tier || this.getRankByPoint(customer.point);
    }

    getRankImage(customerOrPoint: Customer | number): string {
        const rank = typeof customerOrPoint === 'number'
            ? this.getRankByPoint(customerOrPoint)
            : this.getCustomerRank(customerOrPoint);
        const rankKey = this.normalize(rank);

        if (rankKey.includes('kim') || rankKey.includes('cuong')) {
            return 'assets/images/diamond_tags.png';
        }

        if (rankKey.includes('vang')) {
            return 'assets/images/gold_tags.png';
        }

        if (rankKey.includes('bac')) {
            return 'assets/images/silver_tags.png';
        }

        switch (rank) {
            case 'Đồng':
                return 'assets/images/bronze_tags.png';

            case 'Bạc':
                return 'assets/images/silver_tags.png';

            case 'Vàng':
                return 'assets/images/gold_tags.png';

            case 'Kim cương':
                return 'assets/images/diamond_tags.png';

            default:
                return '';
        }
    }

    private normalizeRankName(rank: string): string {
        const rankKey = this.normalize(rank);

        if (rankKey.includes('kim') || rankKey.includes('cuong')) {
            return 'Kim cương';
        }

        if (rankKey.includes('vang')) {
            return 'Vàng';
        }

        if (rankKey.includes('bac')) {
            return 'Bạc';
        }

        if (rankKey.includes('dong')) {
            return 'Đồng';
        }

        return '';
    }

    applyFilters(): void {
        const keyword = this.normalize(this.searchKeyword.trim());
        const selectedRank = this.normalize(this.selectedRank);

        this.filteredCustomers = this.customers.filter((customer) => {
            const customerRank = this.getCustomerRank(customer);
            const normalizedRank = this.normalize(customerRank);

            const matchesKeyword = !keyword
                || this.normalize(customer.code).includes(keyword)
                || this.normalize(customer.name).includes(keyword)
                || this.normalize(customer.phone).includes(keyword)
                || this.normalize(customer.email).includes(keyword)
                || normalizedRank.includes(keyword);

            const matchesRank = this.isAllOption(this.selectedRank)
                || normalizedRank === selectedRank;

            const matchesDate = this.matchesDateFilter(customer.createdAt);

            return matchesKeyword && matchesRank && matchesDate;
        });

        this.currentPage = 1;
    }

    deleteSelectedCustomers(): void {
        if (this.selectedCount === 0) {
            return;
        }

        if (!confirm(`Bạn có chắc muốn xóa ${this.selectedCount} khách hàng đã chọn?`)) {
            return;
        }

        this.customers = this.customers.filter((customer) => !customer.selected);
        this.applyFilters();
    }

    toggleInlineEdit(customer: Customer): void {
        if (this.isEditButtonDisabled(customer)) {
            return;
        }

        if (this.editingCustomerId === customer.id) {
            customer.name = customer.name.trim();
            customer.phone = customer.phone.trim();
            customer.email = customer.email.trim();

            this.editingCustomerId = null;
            this.applyFilters();
            this.adminApi.updateCustomer(customer.code, {
                name: customer.name,
                phone: customer.phone,
                email: customer.email
            }).subscribe({
                next: (response) => {
                    const updatedCustomer = this.mapCustomer(response.customer);
                    this.customers = this.customers.map((item) => {
                        return item.code === updatedCustomer.code ? updatedCustomer : item;
                    });
                    this.applyFilters();
                },
                error: (error) => {
                    console.error('Cannot update customer', error);
                    alert('Không thể lưu khách hàng. Vui lòng thử lại.');
                    this.loadCustomers();
                }
            });
            return;
        }

        this.editingCustomerId = customer.id;
    }

    getAvatarText(name: string): string {
        return name
            .trim()
            .split(' ')
            .filter((word) => word.length > 0)
            .slice(-2)
            .map((word) => word.charAt(0).toUpperCase())
            .join('');
    }

    onCustomerSelectionChange(customer: Customer): void {
        if (!customer.selected && this.editingCustomerId === customer.id) {
            this.editingCustomerId = null;
        }
    }

    isEditButtonDisabled(customer: Customer): boolean {
        if (this.selectedCount === 0) {
            return false;
        }

        return !customer.selected;
    }

    matchesDateFilter(createdAt: Date): boolean {
        if (this.isAllOption(this.selectedDateFilter)) {
            return true;
        }

        const today = new Date();
        const targetDate = new Date(createdAt);
        const diffTime = today.getTime() - targetDate.getTime();
        const diffDays = diffTime / (1000 * 60 * 60 * 24);
        const dateFilter = this.normalize(this.selectedDateFilter);

        if (dateFilter.includes('7 ngay')) {
            return diffDays <= 7;
        }

        if (dateFilter.includes('30 ngay')) {
            return diffDays <= 30;
        }

        if (dateFilter.includes('1 nam')) {
            return diffDays <= 365;
        }

        return true;
    }

    sortCustomers(field: SortField): void {
        this.filteredCustomers.sort((a, b) => {
            if (field === 'name') {
                return a.name.localeCompare(b.name, 'vi');
            }

            if (field === 'code') {
                return a.code.localeCompare(b.code);
            }

            if (field === 'point') {
                return b.point - a.point;
            }

            if (field === 'createdAt') {
                return b.createdAt.getTime() - a.createdAt.getTime();
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

        this.pagedCustomers.forEach((customer) => {
            customer.selected = input.checked;
        });
    }

    isAllSelected(): boolean {
        return this.pagedCustomers.length > 0 &&
            this.pagedCustomers.every((customer) => customer.selected);
    }

    goToPage(page: number | string): void {
        if (typeof page !== 'number') {
            return;
        }

        this.currentPage = page;
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

    private isAllOption(value: string): boolean {
        const normalized = this.normalize(value);
        return normalized === 'tat ca' || normalized.includes('tao');
    }

    private normalize(value: string): string {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .trim();
    }
}
