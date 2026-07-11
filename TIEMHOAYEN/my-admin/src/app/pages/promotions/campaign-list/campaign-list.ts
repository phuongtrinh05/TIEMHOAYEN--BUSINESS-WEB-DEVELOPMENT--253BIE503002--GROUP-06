import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AdminApiService, AdminCampaign } from '../../../services/admin-api.service';

interface CampaignItem {
    id: number;
    code: string;
    name: string;
    description: string;
    startDate: Date;
    endDate: Date;
    status: string;
    selected: boolean;
}

@Component({
    selector: 'app-campaign-list',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterLink,
        RouterLinkActive
    ],
    templateUrl: './campaign-list.html',
    styleUrls: ['./campaign-list.css']
})
export class CampaignListComponent implements OnInit {
    searchKeyword = '';
    selectedStatus = 'Tất cả';

    isFilterMenuOpen = false;
    isSortMenuOpen = false;
    isExportMenuOpen = false;
    isEditModalOpen = false;
    isAddModalOpen = false;

    currentPage = 1;
    pageSize = 10;

    editingCampaign: CampaignItem | null = null;
    newCampaign: CampaignItem | null = null;

    editingStartDateText = '';
    editingEndDateText = '';
    newStartDateText = '';
    newEndDateText = '';

    statusOptions = [
        'Chưa bắt đầu',
        'Đang diễn ra',
        'Sắp diễn ra',
        'Tạm dừng',
        'Đã kết thúc'
    ];

    campaigns: CampaignItem[] = [];
    filteredCampaigns: CampaignItem[] = [];

    constructor(
        private readonly adminApi: AdminApiService,
        private readonly cdr: ChangeDetectorRef,
        @Inject(PLATFORM_ID) private readonly platformId: object
    ) {}

    ngOnInit(): void {
        if (!isPlatformBrowser(this.platformId)) {
            return;
        }

        this.loadCampaigns();
    }

    get totalPages(): number {
        return Math.ceil(this.filteredCampaigns.length / this.pageSize) || 1;
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

    get pagedCampaigns(): CampaignItem[] {
        const start = (this.currentPage - 1) * this.pageSize;
        return this.filteredCampaigns.slice(start, start + this.pageSize);
    }

    loadCampaigns(): void {
        this.adminApi.getCampaigns().subscribe({
            next: (response) => {
                this.campaigns = response.campaigns.map((item) => this.mapCampaign(item));
                this.applyFilters();
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load campaigns:', error);
                alert('Không tải được danh sách chiến dịch.');
                this.cdr.detectChanges();
            }
        });
    }

    applyFilters(): void {
        const keyword = this.removeVietnameseTones(this.searchKeyword.trim().toLowerCase());

        this.filteredCampaigns = this.campaigns.filter((item) => {
            const name = this.removeVietnameseTones(item.name.toLowerCase());
            const code = this.removeVietnameseTones(item.code.toLowerCase());
            const description = this.removeVietnameseTones(item.description.toLowerCase());
            const status = this.removeVietnameseTones(item.status.toLowerCase());

            const matchesKeyword =
                name.includes(keyword) ||
                code.includes(keyword) ||
                description.includes(keyword) ||
                status.includes(keyword) ||
                this.formatDate(item.startDate).includes(keyword) ||
                this.formatDate(item.endDate).includes(keyword);

            const matchesStatus =
                this.isAllOption(this.selectedStatus) ||
                item.status === this.selectedStatus;

            return matchesKeyword && matchesStatus;
        });

        this.currentPage = 1;
    }

    sortCampaigns(field: string): void {
        this.filteredCampaigns.sort((a, b) => {
            if (field === 'code') return a.code.localeCompare(b.code, 'vi');
            if (field === 'name') return a.name.localeCompare(b.name, 'vi');
            if (field === 'status') return a.status.localeCompare(b.status, 'vi');
            if (field === 'startDate') return b.startDate.getTime() - a.startDate.getTime();
            if (field === 'endDate') return b.endDate.getTime() - a.endDate.getTime();

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

        this.pagedCampaigns.forEach((item) => {
            item.selected = input.checked;
        });
    }

    isAllSelected(): boolean {
        return this.pagedCampaigns.length > 0 &&
            this.pagedCampaigns.every((item) => item.selected);
    }

    editCampaign(campaign: CampaignItem): void {
        this.editingCampaign = {
            ...campaign,
            startDate: new Date(campaign.startDate),
            endDate: new Date(campaign.endDate)
        };

        this.editingStartDateText = this.toPayloadDate(this.editingCampaign.startDate);
        this.editingEndDateText = this.toPayloadDate(this.editingCampaign.endDate);

        this.isEditModalOpen = true;
    }

    saveCampaign(): void {
        if (!this.editingCampaign) {
            return;
        }

        const payload = this.buildPayload(this.editingCampaign, this.editingStartDateText, this.editingEndDateText);
        if (!payload) {
            return;
        }

        this.adminApi.updateCampaign(this.editingCampaign.code, payload).subscribe({
            next: () => {
                this.closeEditModal();
                this.loadCampaigns();
            },
            error: (error) => {
                console.error('Cannot update campaign:', error);
                alert(error?.error?.message || 'Không lưu được chiến dịch.');
            }
        });
    }

    deleteCampaign(campaign: CampaignItem): void {
        if (!confirm('Bạn có chắc muốn xóa chiến dịch này?')) {
            return;
        }

        this.adminApi.deleteCampaign(campaign.code).subscribe({
            next: () => this.loadCampaigns(),
            error: (error) => {
                console.error('Cannot delete campaign:', error);
                alert(error?.error?.message || 'Không xóa được chiến dịch.');
            }
        });
    }

    openAddModal(): void {
        const nextId = this.campaigns.length > 0
            ? Math.max(...this.campaigns.map((item) => item.id)) + 1
            : 1;

        const today = new Date();
        const endDate = new Date();
        endDate.setDate(today.getDate() + 7);

        this.isFilterMenuOpen = false;
        this.isSortMenuOpen = false;
        this.isExportMenuOpen = false;
        this.isEditModalOpen = false;
        this.editingCampaign = null;

        this.newCampaign = {
            id: nextId,
            code: 'Tự tạo',
            name: '',
            description: '',
            startDate: today,
            endDate: endDate,
            status: 'Chưa bắt đầu',
            selected: false
        };

        this.newStartDateText = this.toPayloadDate(today);
        this.newEndDateText = this.toPayloadDate(endDate);

        this.isAddModalOpen = true;
    }

    saveNewCampaign(): void {
        if (!this.newCampaign) {
            return;
        }

        const payload = this.buildPayload(this.newCampaign, this.newStartDateText, this.newEndDateText);
        if (!payload) {
            return;
        }

        this.adminApi.createCampaign(payload).subscribe({
            next: () => {
                this.searchKeyword = '';
                this.selectedStatus = 'Tất cả';
                this.closeAddModal();
                this.loadCampaigns();
            },
            error: (error) => {
                console.error('Cannot create campaign:', error);
                alert(error?.error?.message || 'Không thêm được chiến dịch.');
            }
        });
    }

    closeAddModal(): void {
        this.isAddModalOpen = false;
        this.newCampaign = null;
        this.newStartDateText = '';
        this.newEndDateText = '';
    }

    closeAddModalFromBackdrop(event: MouseEvent): void {
        if (event.target === event.currentTarget) {
            this.closeAddModal();
        }
    }

    closeEditModal(): void {
        this.isEditModalOpen = false;
        this.editingCampaign = null;
    }

    closeEditModalFromBackdrop(event: MouseEvent): void {
        if (event.target === event.currentTarget) {
            this.closeEditModal();
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

    goToPage(page: number | string): void {
        if (typeof page !== 'number') {
            return;
        }

        this.currentPage = page;
    }

    formatDate(date: Date): string {
        return new Date(date).toLocaleDateString('vi-VN');
    }

    toDateInput(date: Date): string {
        return this.toPayloadDate(date);
    }

    removeVietnameseTones(value: string): string {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D');
    }

    formatInputDate(date: Date): string {
        const value = new Date(date);
        const day = value.getDate().toString().padStart(2, '0');
        const month = (value.getMonth() + 1).toString().padStart(2, '0');
        const year = value.getFullYear();

        return `${day}/${month}/${year}`;
    }

    parseInputDate(value: string): Date | null {
        const normalizedValue = value.trim();
        const isoMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);

        if (isoMatch) {
            const year = Number(isoMatch[1]);
            const month = Number(isoMatch[2]);
            const day = Number(isoMatch[3]);
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

        const match = normalizedValue.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

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

    private mapCampaign(item: AdminCampaign): CampaignItem {
        return {
            ...item,
            startDate: this.toDate(item.startDate),
            endDate: this.toDate(item.endDate),
            selected: false
        };
    }

    private buildPayload(campaign: CampaignItem, startText: string, endText: string) {
        if (!campaign.name.trim()) {
            alert('Vui lòng nhập tên chiến dịch.');
            return null;
        }

        const startDate = this.parseInputDate(startText);
        const endDate = this.parseInputDate(endText);

        if (!startDate || !endDate) {
            alert('Vui lòng chọn ngày bắt đầu và ngày kết thúc.');
            return null;
        }

        if (endDate < startDate) {
            alert('Ngày kết thúc phải sau ngày bắt đầu.');
            return null;
        }

        return {
            name: campaign.name.trim(),
            description: campaign.description.trim(),
            startDate: this.toPayloadDate(startDate),
            endDate: this.toPayloadDate(endDate),
            status: campaign.status
        };
    }

    private toDate(value: string): Date {
        const date = value ? new Date(value) : new Date();
        return Number.isNaN(date.getTime()) ? new Date() : date;
    }

    private toPayloadDate(date: Date): string {
        const value = new Date(date);
        const year = value.getFullYear();
        const month = (value.getMonth() + 1).toString().padStart(2, '0');
        const day = value.getDate().toString().padStart(2, '0');

        return `${year}-${month}-${day}`;
    }

    private isAllOption(value: string): boolean {
        return this.removeVietnameseTones(value.toLowerCase()) === 'tat ca';
    }
}
