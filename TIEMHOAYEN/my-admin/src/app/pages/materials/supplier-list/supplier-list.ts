import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AdminApiService, AdminSupplier } from '../../../services/admin-api.service';

interface Supplier extends AdminSupplier {}

@Component({
    selector: 'app-supplier-list',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterLink,
        RouterLinkActive
    ],
    templateUrl: './supplier-list.html',
    styleUrls: ['./supplier-list.css']
})
export class SupplierListComponent implements OnInit {
    searchKeyword = '';
    selectedStatus = 'Tất cả';

    isFilterMenuOpen = false;
    isSortMenuOpen = false;
    isExportMenuOpen = false;
    isEditModalOpen = false;
    isAddModalOpen = false;

    currentPage = 1;
    pageSize = 10;

    editingSupplier: Supplier | null = null;
    newSupplier: Supplier | null = null;

    statusOptions = [
        'Đang hợp tác',
        'Tạm ngưng'
    ];

    suppliers: Supplier[] = [];
    filteredSuppliers: Supplier[] = [];

    constructor(
        private readonly adminApi: AdminApiService,
        private readonly cdr: ChangeDetectorRef,
        @Inject(PLATFORM_ID) private readonly platformId: object
    ) {}

    ngOnInit(): void {
        if (isPlatformBrowser(this.platformId)) {
            this.loadSuppliers();
        }
    }

    loadSuppliers(): void {
        this.adminApi.getSuppliers({
            search: this.searchKeyword,
            status: this.isAllStatus(this.selectedStatus) ? '' : this.selectedStatus
        }).subscribe({
            next: (data) => {
                this.suppliers = data.suppliers || [];
                this.filteredSuppliers = [...this.suppliers];
                this.currentPage = 1;
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load suppliers', error);
                this.suppliers = [];
                this.filteredSuppliers = [];
                this.cdr.detectChanges();
            }
        });
    }

    get totalPages(): number {
        return Math.ceil(this.filteredSuppliers.length / this.pageSize) || 1;
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

    get pagedSuppliers(): Supplier[] {
        const start = (this.currentPage - 1) * this.pageSize;
        return this.filteredSuppliers.slice(start, start + this.pageSize);
    }

    applyFilters(): void {
        this.currentPage = 1;
        this.loadSuppliers();
    }

    private isAllStatus(status: string): boolean {
        const normalized = this.removeVietnameseTones(status || '').toLowerCase();
        return !status ||
            normalized === 'all' ||
            normalized.includes('tat') ||
            (normalized.includes('ta') && normalized.includes('ca'));
    }

    sortSuppliers(field: string): void {
        this.filteredSuppliers.sort((a, b) => {
            if (field === 'code') return a.code.localeCompare(b.code, 'vi');
            if (field === 'name') return a.name.localeCompare(b.name, 'vi');
            if (field === 'representative') return a.representative.localeCompare(b.representative, 'vi');
            if (field === 'status') return a.status.localeCompare(b.status, 'vi');
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
        this.pagedSuppliers.forEach((item) => item.selected = input.checked);
    }

    isAllSelected(): boolean {
        return this.pagedSuppliers.length > 0 &&
            this.pagedSuppliers.every((item) => item.selected);
    }

    openAddModal(): void {
        const nextId = this.suppliers.length > 0
            ? Math.max(...this.suppliers.map((item) => item.id)) + 1
            : 1;

        this.isFilterMenuOpen = false;
        this.isSortMenuOpen = false;
        this.isExportMenuOpen = false;
        this.isEditModalOpen = false;
        this.editingSupplier = null;

        this.newSupplier = {
            id: nextId,
            code: '',
            name: '',
            representative: '',
            phone: '',
            email: '',
            address: '',
            taxCode: '',
            status: 'Đang hợp tác',
            selected: false,
            image: ''
        };

        this.isAddModalOpen = true;
    }

    saveNewSupplier(): void {
        if (!this.newSupplier) return;

        if (!this.newSupplier.name.trim()) {
            alert('Vui lòng nhập tên nhà cung cấp.');
            return;
        }

        this.adminApi.createSupplier({
            name: this.newSupplier.name.trim(),
            representative: this.newSupplier.representative.trim(),
            phone: this.newSupplier.phone.trim(),
            email: this.newSupplier.email.trim(),
            address: this.newSupplier.address.trim(),
            taxCode: this.newSupplier.taxCode.trim(),
            status: this.newSupplier.status
        }).subscribe({
            next: () => {
                this.closeAddModal();
                this.loadSuppliers();
            },
            error: (error) => {
                console.error('Cannot create supplier', error);
                alert('Không thể thêm nhà cung cấp. Vui lòng thử lại.');
            }
        });
    }

    closeAddModal(): void {
        this.isAddModalOpen = false;
        this.newSupplier = null;
    }

    editSupplier(supplier: Supplier): void {
        this.editingSupplier = { ...supplier };
        this.isEditModalOpen = true;
    }

    saveSupplier(): void {
        if (!this.editingSupplier) return;

        if (!this.editingSupplier.name.trim()) {
            alert('Vui lòng nhập tên nhà cung cấp.');
            return;
        }

        this.adminApi.updateSupplier(this.editingSupplier.code, {
            name: this.editingSupplier.name.trim(),
            representative: this.editingSupplier.representative.trim(),
            phone: this.editingSupplier.phone.trim(),
            email: this.editingSupplier.email.trim(),
            address: this.editingSupplier.address.trim(),
            taxCode: this.editingSupplier.taxCode.trim(),
            status: this.editingSupplier.status
        }).subscribe({
            next: () => {
                this.closeEditModal();
                this.loadSuppliers();
            },
            error: (error) => {
                console.error('Cannot update supplier', error);
                alert('Không thể lưu nhà cung cấp. Vui lòng thử lại.');
            }
        });
    }

    deleteSupplier(supplier: Supplier): void {
        if (!confirm('Bạn có chắc muốn xóa nhà cung cấp này?')) return;

        this.adminApi.deleteSupplier(supplier.code).subscribe({
            next: () => this.loadSuppliers(),
            error: (error) => {
                console.error('Cannot delete supplier', error);
                alert('Không thể xóa nhà cung cấp vì có thể đang được phiếu nhập sử dụng.');
            }
        });
    }

    closeEditModal(): void {
        this.isEditModalOpen = false;
        this.editingSupplier = null;
    }

    previousPage(): void {
        if (this.currentPage > 1) this.currentPage--;
    }

    nextPage(): void {
        if (this.currentPage < this.totalPages) this.currentPage++;
    }

    goToPage(page: number | string): void {
        if (typeof page === 'number') this.currentPage = page;
    }

    uploadSupplierImage(target: Supplier): void {
        target.image = 'assets/images/supplier-avatar.png';
    }

    removeSupplierImage(target: Supplier): void {
        target.image = '';
    }

    removeVietnameseTones(value: string): string {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D');
    }
}
