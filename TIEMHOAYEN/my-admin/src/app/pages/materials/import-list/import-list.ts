import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
    AdminApiService,
    AdminImportDetail,
    AdminImportReceipt,
    AdminMaterial
} from '../../../services/admin-api.service';

interface ImportDetail extends AdminImportDetail {}

interface ImportReceipt extends Omit<AdminImportReceipt, 'importDate' | 'details'> {
    importDate: Date;
    details: ImportDetail[];
}

interface MaterialOption {
    code: string;
    name: string;
    image: string;
    importPrice: number;
}

@Component({
    selector: 'app-import-list',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterLink,
        RouterLinkActive
    ],
    templateUrl: './import-list.html',
    styleUrls: ['./import-list.css']
})
export class ImportListComponent implements OnInit {
    searchKeyword = '';
    selectedSupplier = 'Tất cả';

    isFilterMenuOpen = false;
    isSortMenuOpen = false;
    isExportMenuOpen = false;
    isEditModalOpen = false;
    isAddModalOpen = false;

    currentPage = 1;
    pageSize = 10;

    editingImport: ImportReceipt | null = null;
    newImport: ImportReceipt | null = null;

    editingImportDateText = '';
    newImportDateText = '';
    editingMaterialSearch = '';
    newMaterialSearch = '';

    isEditingMaterialDropdownOpen = false;
    isNewMaterialDropdownOpen = false;

    materialOptions: MaterialOption[] = [];
    importReceipts: ImportReceipt[] = [];
    filteredImports: ImportReceipt[] = [];

    constructor(
        private readonly adminApi: AdminApiService,
        private readonly cdr: ChangeDetectorRef,
        @Inject(PLATFORM_ID) private readonly platformId: object
    ) {}

    ngOnInit(): void {
        if (isPlatformBrowser(this.platformId)) {
            this.loadMaterials();
            this.loadImports();
        }
    }

    loadMaterials(): void {
        this.adminApi.getMaterials().subscribe({
            next: (data) => {
                this.materialOptions = (data.materials || []).map((material: AdminMaterial) => ({
                    code: material.code,
                    name: material.name,
                    image: material.image || 'assets/images/hoahong.png',
                    importPrice: Number(material.importPrice || 0)
                }));
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load material options', error);
                this.materialOptions = [];
                this.cdr.detectChanges();
            }
        });
    }

    loadImports(): void {
        this.adminApi.getImports().subscribe({
            next: (data) => {
                this.importReceipts = (data.imports || []).map((item) => ({
                    ...item,
                    importDate: item.importDate ? new Date(item.importDate) : new Date(),
                    details: (item.details || []).map((detail) => ({ ...detail }))
                }));
                this.applyFilters();
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load import receipts', error);
                this.importReceipts = [];
                this.filteredImports = [];
                this.cdr.detectChanges();
            }
        });
    }

    get totalPages(): number {
        return Math.ceil(this.filteredImports.length / this.pageSize) || 1;
    }

    get pages(): (number | string)[] {
        const total = this.totalPages;
        const current = this.currentPage;

        if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
        if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
        if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
        return [1, '...', current - 1, current, current + 1, '...', total];
    }

    get pagedImports(): ImportReceipt[] {
        const start = (this.currentPage - 1) * this.pageSize;
        return this.filteredImports.slice(start, start + this.pageSize);
    }

    get filteredEditingMaterials(): MaterialOption[] {
        return this.getFilteredMaterials(this.editingMaterialSearch);
    }

    get filteredNewMaterials(): MaterialOption[] {
        return this.getFilteredMaterials(this.newMaterialSearch);
    }

    private isAllValue(value: string): boolean {
        const normalized = this.removeVietnameseTones(value || '').toLowerCase();
        return normalized.includes('tat') ||
            normalized.includes('taº') ||
            (normalized.includes('ta') && normalized.includes('ca')) ||
            normalized.includes('all');
    }

    applyFilters(): void {
        const keyword = this.removeVietnameseTones(this.searchKeyword.trim().toLowerCase());

        this.filteredImports = this.importReceipts.filter((item) => {
            const haystack = this.removeVietnameseTones([
                item.code,
                item.supplier,
                item.supplierName || '',
                this.formatDate(item.importDate),
                this.formatPrice(item.totalAmount)
            ].join(' ').toLowerCase());

            const matchesKeyword = !keyword || haystack.includes(keyword);
            const matchesSupplier = this.isAllValue(this.selectedSupplier) || item.supplier === this.selectedSupplier;

            return matchesKeyword && matchesSupplier;
        });

        this.currentPage = 1;
    }

    sortImports(field: string): void {
        this.filteredImports = [...this.filteredImports].sort((a, b) => {
            if (field === 'code') return a.code.localeCompare(b.code, 'vi');
            if (field === 'supplier') return a.supplier.localeCompare(b.supplier, 'vi');
            if (field === 'importDate') return b.importDate.getTime() - a.importDate.getTime();
            if (field === 'totalAmount') return b.totalAmount - a.totalAmount;
            return 0;
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

    toggleSelectAll(event: Event): void {
        const input = event.target as HTMLInputElement;
        this.pagedImports.forEach((item) => item.selected = input.checked);
    }

    isAllSelected(): boolean {
        return this.pagedImports.length > 0 &&
            this.pagedImports.every((item) => item.selected);
    }

    openAddModal(): void {
        const today = new Date();

        this.isFilterMenuOpen = false;
        this.isSortMenuOpen = false;
        this.isExportMenuOpen = false;
        this.isEditModalOpen = false;
        this.editingImport = null;

        this.newImport = {
            id: 0,
            code: 'Tự động',
            supplier: '',
            supplierName: '',
            importDate: today,
            totalAmount: 0,
            selected: false,
            note: '',
            details: []
        };

        this.newImportDateText = this.formatInputDate(today);
        this.isAddModalOpen = true;
    }

    saveNewImport(): void {
        if (!this.newImport) return;

        const parsedDate = this.parseInputDate(this.newImportDateText);
        if (!parsedDate) {
            alert('Ngày nhập phải có định dạng DD/MM/YYYY.');
            return;
        }

        this.updateImportTotal(this.newImport);
        const details = this.validDetails(this.newImport.details);
        if (details.length === 0) {
            alert('Vui lòng thêm ít nhất một nguyên vật liệu.');
            return;
        }

        this.adminApi.createImport({
            supplier: this.newImport.supplier,
            importDate: parsedDate.toISOString(),
            note: this.newImport.note.trim(),
            details
        }).subscribe({
            next: () => {
                this.closeAddModal();
                this.loadMaterials();
                this.loadImports();
            },
            error: (error) => {
                console.error('Cannot create import receipt', error);
                alert('Không thể tạo phiếu nhập. Vui lòng thử lại.');
            }
        });
    }

    closeAddModal(): void {
        this.isAddModalOpen = false;
        this.newImport = null;
    }

    editImport(importReceipt: ImportReceipt): void {
        this.editingImport = {
            ...importReceipt,
            importDate: new Date(importReceipt.importDate),
            note: importReceipt.note || '',
            details: importReceipt.details.map((detail) => ({ ...detail }))
        };

        this.editingImportDateText = this.formatInputDate(this.editingImport.importDate);
        this.updateImportTotal(this.editingImport);
        this.isEditModalOpen = true;
    }

    saveImport(): void {
        if (!this.editingImport) return;

        const parsedDate = this.parseInputDate(this.editingImportDateText);
        if (!parsedDate) {
            alert('Ngày nhập phải có định dạng DD/MM/YYYY.');
            return;
        }

        this.updateImportTotal(this.editingImport);
        const details = this.validDetails(this.editingImport.details);
        if (details.length === 0) {
            alert('Vui lòng thêm ít nhất một nguyên vật liệu.');
            return;
        }

        this.adminApi.updateImport(this.editingImport.code, {
            supplier: this.editingImport.supplier,
            importDate: parsedDate.toISOString(),
            note: this.editingImport.note.trim(),
            details
        }).subscribe({
            next: () => {
                this.closeEditModal();
                this.loadMaterials();
                this.loadImports();
            },
            error: (error) => {
                console.error('Cannot update import receipt', error);
                alert('Không thể lưu phiếu nhập. Vui lòng thử lại.');
            }
        });
    }

    deleteImport(importReceipt: ImportReceipt): void {
        if (!confirm('Bạn có chắc muốn xóa phiếu nhập này?')) return;

        this.adminApi.deleteImport(importReceipt.code).subscribe({
            next: () => {
                this.loadMaterials();
                this.loadImports();
            },
            error: (error) => {
                console.error('Cannot delete import receipt', error);
                alert('Không thể xóa phiếu nhập. Vui lòng thử lại.');
            }
        });
    }

    closeEditModal(): void {
        this.isEditModalOpen = false;
        this.editingImport = null;
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

    formatPrice(value: number): string {
        return Number(value || 0).toLocaleString('vi-VN') + 'đ';
    }

    formatDate(date: Date): string {
        return new Date(date).toLocaleDateString('vi-VN');
    }

    toDateInput(date: Date): string {
        return new Date(date).toISOString().split('T')[0];
    }

    addImportDetail(target: ImportReceipt): void {
        const nextId = target.details.length > 0
            ? Math.max(...target.details.map((detail) => detail.id)) + 1
            : 1;

        target.details.push({
            id: nextId,
            materialCode: '',
            materialName: '',
            image: '',
            quantity: 0,
            unitPrice: 0
        });

        this.updateImportTotal(target);
    }

    removeImportDetail(target: ImportReceipt, detailId: number): void {
        target.details = target.details.filter((detail) => detail.id !== detailId);
        this.updateImportTotal(target);
    }

    getFilteredMaterials(keyword: string): MaterialOption[] {
        const value = this.removeVietnameseTones(keyword.trim().toLowerCase());
        if (!value) return this.materialOptions;

        return this.materialOptions.filter((material) => {
            const code = material.code.toLowerCase();
            const name = this.removeVietnameseTones(material.name.toLowerCase());
            return code.includes(value) || name.includes(value);
        });
    }

    openEditingMaterialDropdown(): void {
        this.isEditingMaterialDropdownOpen = true;
    }

    openNewMaterialDropdown(): void {
        this.isNewMaterialDropdownOpen = true;
    }

    selectMaterialForImport(target: ImportReceipt, material: MaterialOption, type: 'edit' | 'new'): void {
        const existedDetail = target.details.find((detail) => detail.materialCode === material.code);

        if (existedDetail) {
            existedDetail.quantity += 1;
        } else {
            const nextId = target.details.length > 0
                ? Math.max(...target.details.map((detail) => detail.id)) + 1
                : 1;

            target.details.push({
                id: nextId,
                materialCode: material.code,
                materialName: material.name,
                image: material.image,
                quantity: 1,
                unitPrice: material.importPrice
            });
        }

        this.updateImportTotal(target);

        if (type === 'edit') {
            this.editingMaterialSearch = '';
            this.isEditingMaterialDropdownOpen = false;
        } else {
            this.newMaterialSearch = '';
            this.isNewMaterialDropdownOpen = false;
        }
    }

    onMaterialChange(detail: ImportDetail): void {
        const selectedMaterial = this.materialOptions.find((material) => material.code === detail.materialCode);
        if (!selectedMaterial) {
            detail.materialName = '';
            detail.image = '';
            return;
        }

        detail.materialName = selectedMaterial.name;
        detail.image = selectedMaterial.image;
        if (!detail.unitPrice) detail.unitPrice = selectedMaterial.importPrice;
    }

    getDetailAmount(detail: ImportDetail): number {
        return Number(detail.quantity || 0) * Number(detail.unitPrice || 0);
    }

    updateImportTotal(target: ImportReceipt): void {
        target.totalAmount = target.details.reduce((total, detail) => total + this.getDetailAmount(detail), 0);
    }

    formatInputDate(date: Date): string {
        const value = new Date(date);
        const day = value.getDate().toString().padStart(2, '0');
        const month = (value.getMonth() + 1).toString().padStart(2, '0');
        const year = value.getFullYear();
        return `${day}/${month}/${year}`;
    }

    parseInputDate(value: string): Date | null {
        const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!match) return null;

        const day = Number(match[1]);
        const month = Number(match[2]);
        const year = Number(match[3]);
        const date = new Date(year, month - 1, day);

        if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getFullYear() !== year) {
            return null;
        }

        return date;
    }

    onMaterialCodeInput(detail: ImportDetail): void {
        const code = detail.materialCode.trim().toUpperCase();
        detail.materialCode = code;

        const selectedMaterial = this.materialOptions.find((material) => material.code.toUpperCase() === code);
        if (!selectedMaterial) {
            detail.materialName = code;
            detail.image = '';
            return;
        }

        detail.materialName = selectedMaterial.name;
        detail.image = selectedMaterial.image;
        if (!detail.unitPrice) detail.unitPrice = selectedMaterial.importPrice;
    }

    private validDetails(details: ImportDetail[]): Array<{ materialCode: string; quantity: number; unitPrice: number }> {
        return details
            .filter((detail) => detail.materialCode.trim() && Number(detail.quantity || 0) > 0)
            .map((detail) => ({
                materialCode: detail.materialCode.trim(),
                quantity: Number(detail.quantity || 0),
                unitPrice: Number(detail.unitPrice || 0)
            }));
    }

    removeVietnameseTones(value: string): string {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D');
    }
}
