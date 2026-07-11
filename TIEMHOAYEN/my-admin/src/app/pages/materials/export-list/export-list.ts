import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
    AdminApiService,
    AdminExportDetail,
    AdminExportReceipt,
    AdminMaterial
} from '../../../services/admin-api.service';

interface ExportDetail extends AdminExportDetail {}

interface ExportReceipt extends Omit<AdminExportReceipt, 'exportDate' | 'details'> {
    exportDate: Date;
    details: ExportDetail[];
}

interface MaterialOption {
    code: string;
    name: string;
    image: string;
}

@Component({
    selector: 'app-export-list',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterLink,
        RouterLinkActive
    ],
    templateUrl: './export-list.html',
    styleUrls: ['./export-list.css']
})
export class ExportListComponent implements OnInit {
    searchKeyword = '';
    selectedStaff = 'Tất cả';

    isFilterMenuOpen = false;
    isSortMenuOpen = false;
    isExportMenuOpen = false;
    isEditModalOpen = false;
    isAddModalOpen = false;

    currentPage = 1;
    pageSize = 10;

    editingExport: ExportReceipt | null = null;
    newExport: ExportReceipt | null = null;

    editingExportDateText = '';
    newExportDateText = '';

    editingMaterialSearch = '';
    newMaterialSearch = '';

    isEditingMaterialDropdownOpen = false;
    isNewMaterialDropdownOpen = false;

    materialOptions: MaterialOption[] = [];
    exportReceipts: ExportReceipt[] = [];
    filteredExports: ExportReceipt[] = [];

    constructor(
        private readonly adminApi: AdminApiService,
        private readonly cdr: ChangeDetectorRef,
        @Inject(PLATFORM_ID) private readonly platformId: object
    ) {}

    ngOnInit(): void {
        if (isPlatformBrowser(this.platformId)) {
            this.loadMaterials();
            this.loadExports();
        }
    }

    loadMaterials(): void {
        this.adminApi.getMaterials().subscribe({
            next: (data) => {
                this.materialOptions = (data.materials || []).map((material: AdminMaterial) => ({
                    code: material.code,
                    name: material.name,
                    image: material.image || 'assets/images/hoahong.png'
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

    loadExports(): void {
        this.adminApi.getExports().subscribe({
            next: (data) => {
                this.exportReceipts = (data.exports || []).map((item) => ({
                    ...item,
                    exportDate: item.exportDate ? new Date(item.exportDate) : new Date(),
                    details: (item.details || []).map((detail) => ({ ...detail }))
                }));
                this.applyFilters();
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load export receipts', error);
                this.exportReceipts = [];
                this.filteredExports = [];
                this.cdr.detectChanges();
            }
        });
    }

    get totalPages(): number {
        return Math.ceil(this.filteredExports.length / this.pageSize) || 1;
    }

    get pages(): (number | string)[] {
        const total = this.totalPages;
        const current = this.currentPage;

        if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
        if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
        if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
        return [1, '...', current - 1, current, current + 1, '...', total];
    }

    get pagedExports(): ExportReceipt[] {
        const start = (this.currentPage - 1) * this.pageSize;
        return this.filteredExports.slice(start, start + this.pageSize);
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

        this.filteredExports = this.exportReceipts.filter((item) => {
            const haystack = this.removeVietnameseTones([
                item.code,
                item.staff,
                item.staffName || '',
                this.formatDate(item.exportDate),
                item.reason,
                item.note
            ].join(' ').toLowerCase());

            const matchesKeyword = !keyword || haystack.includes(keyword);
            const matchesStaff = this.isAllValue(this.selectedStaff) || item.staff === this.selectedStaff;

            return matchesKeyword && matchesStaff;
        });

        this.currentPage = 1;
    }

    sortExports(field: string): void {
        this.filteredExports.sort((a, b) => {
            if (field === 'code') return a.code.localeCompare(b.code, 'vi');
            if (field === 'staff') return a.staff.localeCompare(b.staff, 'vi');
            if (field === 'exportDate') return b.exportDate.getTime() - a.exportDate.getTime();
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
        this.pagedExports.forEach((item) => item.selected = input.checked);
    }

    isAllSelected(): boolean {
        return this.pagedExports.length > 0 &&
            this.pagedExports.every((item) => item.selected);
    }

    openAddModal(): void {
        const today = new Date();

        this.isFilterMenuOpen = false;
        this.isSortMenuOpen = false;
        this.isExportMenuOpen = false;
        this.isEditModalOpen = false;
        this.editingExport = null;

        this.newExport = {
            id: 0,
            code: 'Tự động',
            staff: '',
            staffName: '',
            exportDate: today,
            selected: false,
            reason: '',
            note: '',
            details: []
        };

        this.newExportDateText = this.formatInputDate(today);
        this.isAddModalOpen = true;
    }

    saveNewExport(): void {
        if (!this.newExport) return;

        const parsedDate = this.parseInputDate(this.newExportDateText);
        if (!parsedDate) {
            alert('Ngày xuất phải có định dạng DD/MM/YYYY.');
            return;
        }

        const details = this.validDetails(this.newExport.details);
        if (details.length === 0) {
            alert('Vui lòng thêm ít nhất một nguyên vật liệu.');
            return;
        }

        this.adminApi.createExport({
            staff: this.newExport.staff,
            exportDate: parsedDate.toISOString(),
            reason: this.newExport.reason.trim(),
            note: this.newExport.note.trim(),
            details
        }).subscribe({
            next: () => {
                this.closeAddModal();
                this.loadMaterials();
                this.loadExports();
            },
            error: (error) => {
                console.error('Cannot create export receipt', error);
                alert('Không thể tạo phiếu xuất. Có thể số lượng tồn không đủ.');
            }
        });
    }

    closeAddModal(): void {
        this.isAddModalOpen = false;
        this.newExport = null;
    }

    editExport(exportReceipt: ExportReceipt): void {
        this.editingExport = {
            ...exportReceipt,
            exportDate: new Date(exportReceipt.exportDate),
            reason: exportReceipt.reason || '',
            note: exportReceipt.note || '',
            details: exportReceipt.details.map((detail) => ({ ...detail }))
        };

        this.editingExportDateText = this.formatInputDate(this.editingExport.exportDate);
        this.isEditModalOpen = true;
    }

    saveExport(): void {
        if (!this.editingExport) return;

        const parsedDate = this.parseInputDate(this.editingExportDateText);
        if (!parsedDate) {
            alert('Ngày xuất phải có định dạng DD/MM/YYYY.');
            return;
        }

        const details = this.validDetails(this.editingExport.details);
        if (details.length === 0) {
            alert('Vui lòng thêm ít nhất một nguyên vật liệu.');
            return;
        }

        this.adminApi.updateExport(this.editingExport.code, {
            staff: this.editingExport.staff,
            exportDate: parsedDate.toISOString(),
            reason: this.editingExport.reason.trim(),
            note: this.editingExport.note.trim(),
            details
        }).subscribe({
            next: () => {
                this.closeEditModal();
                this.loadMaterials();
                this.loadExports();
            },
            error: (error) => {
                console.error('Cannot update export receipt', error);
                alert('Không thể lưu phiếu xuất. Có thể số lượng tồn không đủ.');
            }
        });
    }

    deleteExport(exportReceipt: ExportReceipt): void {
        if (!confirm('Bạn có chắc muốn xóa phiếu xuất này?')) return;

        this.adminApi.deleteExport(exportReceipt.code).subscribe({
            next: () => {
                this.loadMaterials();
                this.loadExports();
            },
            error: (error) => {
                console.error('Cannot delete export receipt', error);
                alert('Không thể xóa phiếu xuất. Vui lòng thử lại.');
            }
        });
    }

    closeEditModal(): void {
        this.isEditModalOpen = false;
        this.editingExport = null;
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

    formatDate(date: Date): string {
        return new Date(date).toLocaleDateString('vi-VN');
    }

    toDateInput(date: Date): string {
        return new Date(date).toISOString().split('T')[0];
    }

    addExportDetail(type: 'edit' | 'new'): void {
        if (type === 'edit') {
            this.isEditingMaterialDropdownOpen = true;
            return;
        }

        this.isNewMaterialDropdownOpen = true;
    }

    removeExportDetail(target: ExportReceipt, detailId: number): void {
        target.details = target.details.filter((detail) => detail.id !== detailId);
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

    selectMaterialForExport(target: ExportReceipt, material: MaterialOption, type: 'edit' | 'new'): void {
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
                quantity: 1
            });
        }

        if (type === 'edit') {
            this.editingMaterialSearch = '';
            this.isEditingMaterialDropdownOpen = false;
        } else {
            this.newMaterialSearch = '';
            this.isNewMaterialDropdownOpen = false;
        }
    }

    onMaterialCodeInput(detail: ExportDetail): void {
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

    private validDetails(details: ExportDetail[]): Array<{ materialCode: string; quantity: number }> {
        return details
            .filter((detail) => detail.materialCode.trim() && Number(detail.quantity || 0) > 0)
            .map((detail) => ({
                materialCode: detail.materialCode.trim(),
                quantity: Number(detail.quantity || 0)
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
