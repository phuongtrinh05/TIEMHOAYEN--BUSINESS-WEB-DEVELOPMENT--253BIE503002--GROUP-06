import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { finalize, forkJoin, timeout } from 'rxjs';
import { AdminApiService, AdminFAQPayload, AdminFAQRow } from '../../../services/admin-api.service';

interface ChatbotItem {
    id: string;
    code: string;
    question: string;
    answer: string;
    category: string;
    status: string;
    selected: boolean;
}

@Component({
    selector: 'app-chatbot-management',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
    templateUrl: './chatbot-management.html',
    styleUrls: ['./chatbot-management.css']
})
export class ChatbotManagementComponent implements OnInit {

    searchKeyword = '';
    selectedStatus = '';
    selectedCategory = '';

    isFilterOpen = false;
    isSortOpen = false;
    isMoreOpen = false;
    isExportOpen = false;
    isAddModalOpen = false;
    isEditModalOpen = false;
    isLoading = false;
    isSaving = false;

    currentPage = 1;
    pageSize = 8;

    editingItem: ChatbotItem | null = null;
    newItem: ChatbotItem = this.createEmptyItem();

    readonly activeStatus = 'Hoạt động';
    readonly lockedStatus = 'Bị khóa';
    categories = [
        'Đặt hàng',
        'Giao hàng',
        'Vận chuyển',
        'Thanh toán',
        'Đổi trả & Hủy đơn',
        'Đổi trả',
        'Tích điểm & Thành viên',
        'Tài khoản',
        'Bảo mật thông tin',
        'Chăm sóc khách hàng',
        'Sản phẩm',
        'Khác'
    ];

    items: ChatbotItem[] = [];
    filteredItems: ChatbotItem[] = [];

    constructor(
        private readonly adminApi: AdminApiService,
        private readonly cdr: ChangeDetectorRef
    ) {}

    ngOnInit(): void {
        this.loadFAQs();
    }

    loadFAQs(): void {
        this.isLoading = true;
        this.adminApi.getFAQs().subscribe({
            next: rows => {
                this.items = rows.map(row => this.mapFAQRow(row));
                this.currentPage = 1;
                this.applyFilters(false);
                this.isLoading = false;
                this.cdr.detectChanges();
            },
            error: error => {
                console.error('Cannot load FAQ list', error);
                this.items = [];
                this.filteredItems = [];
                this.isLoading = false;
                this.cdr.detectChanges();
                alert('Không tải được danh sách câu hỏi từ database.');
            }
        });
    }

    get totalPages(): number {
        return Math.ceil(this.filteredItems.length / this.pageSize) || 1;
    }

    get pages(): (number | string)[] {
        const total = this.totalPages;
        const cur = this.currentPage;

        if (total <= 7) {
            return Array.from({ length: total }, (_, i) => i + 1);
        }
        if (cur <= 4) {
            return [1, 2, 3, 4, 5, '...', total];
        }
        if (cur >= total - 3) {
            return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
        }
        return [1, '...', cur - 1, cur, cur + 1, '...', total];
    }

    get pagedItems(): ChatbotItem[] {
        const start = (this.currentPage - 1) * this.pageSize;
        return this.filteredItems.slice(start, start + this.pageSize);
    }

    get categoryOptions(): string[] {
        const values = [
            ...this.categories,
            ...this.items.map(item => item.category),
            ...(this.editingItem?.category ? [this.editingItem.category] : [])
        ];

        return Array.from(new Set(values.filter(category => category.trim())));
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

    applyFilters(closeDropdowns = true): void {
        const keyword = this.searchKeyword.trim().toLowerCase();

        this.filteredItems = this.items.filter(item => {
            const matchKeyword =
                !keyword ||
                item.question.toLowerCase().includes(keyword) ||
                item.answer.toLowerCase().includes(keyword) ||
                item.code.toLowerCase().includes(keyword);

            const matchStatus =
                !this.selectedStatus || item.status === this.selectedStatus;

            const matchCategory =
                !this.selectedCategory || item.category === this.selectedCategory;

            return matchKeyword && matchStatus && matchCategory;
        });

        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }

        if (closeDropdowns) {
            this.closeAllDropdowns();
        }
    }

    sortBy(field: string): void {
        this.filteredItems.sort((a, b) => {
            if (field === 'code') return a.code.localeCompare(b.code, 'vi');
            if (field === 'question') return a.question.localeCompare(b.question, 'vi');
            if (field === 'category') return a.category.localeCompare(b.category, 'vi');
            if (field === 'status') return a.status.localeCompare(b.status, 'vi');
            return 0;
        });
        this.isSortOpen = false;
    }

    getCategoryClass(category: string): string {
        const normalized = this.normalizeText(category);

        if (normalized.includes('dat hang')) return 'category-order';
        if (normalized.includes('giao hang') || normalized.includes('van chuyen')) return 'category-shipping';
        if (normalized.includes('thanh toan')) return 'category-payment';
        if (normalized.includes('doi tra') || normalized.includes('huy don')) return 'category-return';
        if (normalized.includes('san pham')) return 'category-product';
        if (normalized.includes('tich diem') || normalized.includes('thanh vien')) return 'category-loyalty';
        if (normalized.includes('tai khoan')) return 'category-account';
        if (normalized.includes('bao mat')) return 'category-security';
        if (normalized.includes('cham soc') || normalized.includes('khach hang')) return 'category-support';
        return 'category-other';
    }

    isAllSelected(): boolean {
        return this.pagedItems.length > 0 && this.pagedItems.every(i => i.selected);
    }

    toggleSelectAll(event: Event): void {
        const checked = (event.target as HTMLInputElement).checked;
        this.pagedItems.forEach(i => i.selected = checked);
    }

    lockSelected(): void {
        this.updateSelectedStatus(this.lockedStatus);
    }

    unlockSelected(): void {
        this.updateSelectedStatus(this.activeStatus);
    }

    deleteSelected(): void {
        const selectedItems = this.items.filter(i => i.selected);
        if (selectedItems.length === 0) return;
        if (!confirm('Bạn có chắc muốn xóa các câu hỏi đã chọn?')) return;

        this.isSaving = true;
        forkJoin(selectedItems.map(item => this.adminApi.deleteFAQ(item.code))).subscribe({
            next: () => {
                const selectedCodes = new Set(selectedItems.map(item => item.code));
                this.items = this.items.filter(item => !selectedCodes.has(item.code));
                this.applyFilters();
                this.isSaving = false;
                this.isMoreOpen = false;
            },
            error: error => {
                console.error('Cannot delete selected FAQs', error);
                this.isSaving = false;
                alert('Xóa câu hỏi đã chọn thất bại.');
            }
        });
    }

    deleteItem(item: ChatbotItem, event?: Event): void {
        event?.stopPropagation();
        if (!confirm('Bạn có chắc muốn xóa câu hỏi này?')) return;

        this.isSaving = true;
        this.adminApi.deleteFAQ(item.code).subscribe({
            next: () => {
                this.items = this.items.filter(i => i.code !== item.code);
                this.applyFilters();
                this.isSaving = false;
            },
            error: error => {
                console.error('Cannot delete FAQ', error);
                this.isSaving = false;
                alert('Xóa câu hỏi thất bại.');
            }
        });
    }

    openAddModal(): void {
        const nextNumber = this.items
            .map(item => Number(item.code.replace(/\D/g, '')))
            .filter(Number.isFinite)
            .reduce((max, value) => Math.max(max, value), 0) + 1;

        this.newItem = {
            ...this.createEmptyItem(),
            id: `CH${String(nextNumber).padStart(3, '0')}`,
            code: `CH${String(nextNumber).padStart(3, '0')}`
        };

        this.isAddModalOpen = true;
    }

    saveNewItem(): void {
        if (!this.validateItem(this.newItem)) return;

        this.isSaving = true;
        this.adminApi.createFAQ(this.toPayload(this.newItem)).subscribe({
            next: response => {
                this.items = [this.mapFAQRow(response.faq), ...this.items];
                this.searchKeyword = '';
                this.selectedStatus = '';
                this.selectedCategory = '';
                this.currentPage = 1;
                this.applyFilters();
                this.closeAddModal();
                this.isSaving = false;
            },
            error: error => {
                console.error('Cannot create FAQ', error);
                this.isSaving = false;
                alert('Thêm câu hỏi thất bại, vui lòng kiểm tra backend/database.');
            }
        });
    }

    closeAddModal(): void {
        this.isAddModalOpen = false;
    }

    openEditModal(item: ChatbotItem, event?: Event): void {
        event?.stopPropagation();
        this.editingItem = { ...item };
        this.isEditModalOpen = true;

        this.adminApi.getFAQ(item.code).subscribe({
            next: row => {
                this.editingItem = this.mapFAQRow(row);
                this.isEditModalOpen = true;
                this.cdr.detectChanges();
            },
            error: () => {
                this.editingItem = { ...item };
                this.isEditModalOpen = true;
                this.cdr.detectChanges();
            }
        });
    }

    saveEdit(): void {
        if (this.isSaving) return;
        if (!this.editingItem || !this.validateItem(this.editingItem)) return;

        this.isSaving = true;
        this.cdr.detectChanges();
        this.adminApi.updateFAQ(this.editingItem.code, this.toPayload(this.editingItem)).pipe(
            timeout(12000),
            finalize(() => {
                this.isSaving = false;
                this.cdr.detectChanges();
            })
        ).subscribe({
            next: response => {
                const updatedItem = this.mapFAQRow(response.faq);
                this.items = this.items.map(item =>
                    item.code === updatedItem.code ? { ...updatedItem, selected: item.selected } : item
                );
                this.applyFilters();
                this.closeEditModal();
                this.isSaving = false;
            },
            error: error => {
                console.error('Cannot update FAQ', error);
                this.isSaving = false;
                alert('Lưu câu hỏi thất bại hoặc quá lâu. Vui lòng thử lại.');
            }
        });
    }

    closeEditModal(): void {
        this.isEditModalOpen = false;
        this.editingItem = null;
    }

    toggleFilter(): void {
        this.isFilterOpen = !this.isFilterOpen;
        this.isSortOpen = false;
        this.isMoreOpen = false;
        this.isExportOpen = false;
    }

    toggleSort(): void {
        this.isSortOpen = !this.isSortOpen;
        this.isFilterOpen = false;
        this.isMoreOpen = false;
        this.isExportOpen = false;
    }

    toggleMore(): void {
        this.isMoreOpen = !this.isMoreOpen;
        this.isFilterOpen = false;
        this.isSortOpen = false;
        this.isExportOpen = false;
    }

    toggleExport(): void {
        this.isExportOpen = !this.isExportOpen;
        this.isFilterOpen = false;
        this.isSortOpen = false;
        this.isMoreOpen = false;
    }

    closeAllDropdowns(): void {
        this.isFilterOpen = false;
        this.isSortOpen = false;
        this.isMoreOpen = false;
        this.isExportOpen = false;
    }

    private updateSelectedStatus(status: string): void {
        const selectedItems = this.items.filter(i => i.selected);
        if (selectedItems.length === 0) return;

        this.isSaving = true;
        forkJoin(
            selectedItems.map(item => this.adminApi.updateFAQ(item.code, this.toPayload({ ...item, status })))
        ).subscribe({
            next: responses => {
                const updatedMap = new Map(
                    responses.map(response => {
                        const item = this.mapFAQRow(response.faq);
                        return [item.code, item];
                    })
                );

                this.items = this.items.map(item => {
                    const updated = updatedMap.get(item.code);
                    return updated ? { ...updated, selected: item.selected } : item;
                });
                this.applyFilters();
                this.isSaving = false;
                this.isMoreOpen = false;
            },
            error: error => {
                console.error('Cannot update selected FAQ status', error);
                this.isSaving = false;
                alert('Cập nhật trạng thái thất bại.');
            }
        });
    }

    private mapFAQRow(row: AdminFAQRow): ChatbotItem {
        return {
            id: row.CAU_HOI_ID,
            code: row.CAU_HOI_ID,
            question: row.CAU_HOI || '',
            answer: row.CAU_TRA_LOI || '',
            category: row.DANH_MUC_CAU_HOI || this.categories[0],
            status: this.normalizeStatus(row.TRANG_THAI),
            selected: false
        };
    }

    private normalizeStatus(status?: string): string {
        const normalized = this.normalizeText(status || '');

        if (!normalized) return this.activeStatus;
        if (normalized.includes('tam ngung') || normalized.includes('bi khoa') || normalized.includes('khoa')) {
            return this.lockedStatus;
        }

        return this.activeStatus;
    }

    private normalizeText(value: string): string {
        return value
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .toLowerCase();
    }

    private toPayload(item: ChatbotItem): AdminFAQPayload {
        return {
            question: item.question.trim(),
            answer: item.answer.trim(),
            category: item.category.trim(),
            status: item.status.trim()
        };
    }

    private validateItem(item: ChatbotItem): boolean {
        if (!item.question.trim()) {
            alert('Vui lòng nhập câu hỏi.');
            return false;
        }
        if (!item.answer.trim()) {
            alert('Vui lòng nhập câu trả lời.');
            return false;
        }
        if (!item.category.trim()) {
            alert('Vui lòng chọn danh mục.');
            return false;
        }
        return true;
    }

    private createEmptyItem(): ChatbotItem {
        return {
            id: 'CH001',
            code: 'CH001',
            question: '',
            answer: '',
            category: 'Đặt hàng',
            status: 'Hoạt động',
            selected: false
        };
    }
}
