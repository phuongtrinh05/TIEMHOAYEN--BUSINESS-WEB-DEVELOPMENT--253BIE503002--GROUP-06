import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AdminApiService, AdminCategory, AdminCustomer, AdminVoucher } from '../../../services/admin-api.service';

interface VoucherItem {
    id: number;
    code: string;
    voucherCode: string;
    campaignCode: string;
    customerId: string;
    customerName: string;
    discountType: string;
    discountValue: number;
    maxDiscount: number;
    minimumOrder: number;
    productScopeText: string;
    categoryIds: string[];
    audience: string;
    membershipTierText: string;
    totalLimit: number;
    perUserLimit: number;
    firstOrderOnly: boolean;
    active: boolean;
    startDate: Date;
    endDate: Date;
    used: boolean;
    selected: boolean;
}

interface CampaignOption {
    code: string;
    name: string;
}

interface CustomerOption {
    code: string;
    name: string;
    phone: string;
    email: string;
}

@Component({
    selector: 'app-voucher-list',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterLink,
        RouterLinkActive
    ],
    templateUrl: './voucher-list.html',
    styleUrls: ['./voucher-list.css']
})
export class VoucherListComponent implements OnInit {
    searchKeyword = '';
    selectedDiscountType = 'Tất cả';

    isFilterMenuOpen = false;
    isSortMenuOpen = false;
    isExportMenuOpen = false;
    isEditModalOpen = false;
    isAddModalOpen = false;

    currentPage = 1;
    pageSize = 10;

    editingVoucher: VoucherItem | null = null;
    newVoucher: VoucherItem | null = null;

    editingStartDateText = '';
    editingEndDateText = '';
    newStartDateText = '';
    newEndDateText = '';
    newVoucherQuantity = 1;

    campaignOptions: CampaignOption[] = [];
    categoryOptions: AdminCategory[] = [];
    categoryOptionsError = false;
    isCategoryMenuOpen = false;
    customerOptions: CustomerOption[] = [];
    selectedCustomerIds: string[] = [];
    customerSearchKeyword = '';

    discountTypes = [
        'Phần trăm',
        'Tiền',
        'Phí vận chuyển'
    ];
    audienceOptions = ['Tất cả', 'Guest', 'Member', 'Hạng thành viên', 'Tài khoản được cấp'];

    vouchers: VoucherItem[] = [];
    filteredVouchers: VoucherItem[] = [];

    get filteredCustomerOptions(): CustomerOption[] {
        const keyword = this.removeVietnameseTones(this.customerSearchKeyword.trim().toLowerCase());

        if (!keyword) {
            return this.customerOptions;
        }

        return this.customerOptions.filter((customer) => {
            const haystack = this.removeVietnameseTones([
                customer.code,
                customer.name,
                customer.phone,
                customer.email
            ].join(' ').toLowerCase());

            return haystack.includes(keyword);
        });
    }

    get selectedCustomers(): CustomerOption[] {
        const selected = new Set(this.selectedCustomerIds);
        return this.customerOptions.filter((customer) => selected.has(customer.code));
    }

    constructor(
        private readonly adminApi: AdminApiService,
        private readonly cdr: ChangeDetectorRef,
        @Inject(PLATFORM_ID) private readonly platformId: object
    ) {}

    ngOnInit(): void {
        if (!isPlatformBrowser(this.platformId)) {
            return;
        }

        this.loadCampaignOptions();
        this.loadCategoryOptions();
        this.loadCustomerOptions();
        this.loadVouchers();
    }

    get totalPages(): number {
        return Math.ceil(this.filteredVouchers.length / this.pageSize) || 1;
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

    get pagedVouchers(): VoucherItem[] {
        const start = (this.currentPage - 1) * this.pageSize;
        return this.filteredVouchers.slice(start, start + this.pageSize);
    }

    loadVouchers(): void {
        this.adminApi.getVouchers().subscribe({
            next: (response) => {
                this.vouchers = response.vouchers.map((item) => this.mapVoucher(item));
                this.applyFilters();
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load vouchers:', error);
                alert(error?.error?.message || 'Không tải được danh sách voucher.');
                this.cdr.detectChanges();
            }
        });
    }

    loadCampaignOptions(): void {
        this.adminApi.getCampaigns().subscribe({
            next: (response) => {
                this.campaignOptions = response.campaigns.map((item) => ({
                    code: item.code,
                    name: item.name || item.code
                }));
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load campaign options:', error);
                this.campaignOptions = [];
                this.cdr.detectChanges();
            }
        });
    }

    loadCategoryOptions(): void {
        this.adminApi.getCategories('topic').subscribe({
            next: (response) => {
                this.categoryOptions = response.categories;
                this.categoryOptionsError = false;
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load category options:', error);
                this.categoryOptions = [];
                this.categoryOptionsError = true;
                this.cdr.detectChanges();
            }
        });
    }

    loadCustomerOptions(): void {
        this.adminApi.getCustomers().subscribe({
            next: (response) => {
                this.customerOptions = (response.customers || []).map((customer: AdminCustomer) => ({
                    code: customer.code,
                    name: customer.name,
                    phone: customer.phone,
                    email: customer.email
                }));
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load customer options:', error);
                this.customerOptions = [];
                this.cdr.detectChanges();
            }
        });
    }

    applyFilters(): void {
        const keyword = this.removeVietnameseTones(this.searchKeyword.trim().toLowerCase());

        this.filteredVouchers = this.vouchers.filter((item) => {
            const voucherCode = this.removeVietnameseTones(item.voucherCode.toLowerCase());
            const code = this.removeVietnameseTones(item.code.toLowerCase());
            const campaignCode = this.removeVietnameseTones(item.campaignCode.toLowerCase());
            const customerId = this.removeVietnameseTones(item.customerId.toLowerCase());
            const customerName = this.removeVietnameseTones(item.customerName.toLowerCase());
            const discountType = this.removeVietnameseTones(item.discountType.toLowerCase());

            const matchesKeyword =
                voucherCode.includes(keyword) ||
                code.includes(keyword) ||
                campaignCode.includes(keyword) ||
                customerId.includes(keyword) ||
                customerName.includes(keyword) ||
                discountType.includes(keyword) ||
                item.discountValue.toString().includes(keyword) ||
                this.formatDate(item.startDate).includes(keyword) ||
                this.formatDate(item.endDate).includes(keyword);

            const matchesDiscountType =
                this.isAllOption(this.selectedDiscountType) ||
                this.matchesDiscountType(item.discountType, this.selectedDiscountType);

            return matchesKeyword && matchesDiscountType;
        });

        this.currentPage = 1;
    }

    sortVouchers(field: string): void {
        this.filteredVouchers.sort((a, b) => {
            if (field === 'voucherCode') return a.voucherCode.localeCompare(b.voucherCode, 'vi');
            if (field === 'campaignCode') return a.campaignCode.localeCompare(b.campaignCode, 'vi');
            if (field === 'customer') return (a.customerName || a.customerId).localeCompare(b.customerName || b.customerId, 'vi');
            if (field === 'discountType') return a.discountType.localeCompare(b.discountType, 'vi');
            if (field === 'discountValue') return b.discountValue - a.discountValue;
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

        this.pagedVouchers.forEach((item) => {
            item.selected = input.checked;
        });
    }

    isAllSelected(): boolean {
        return this.pagedVouchers.length > 0 &&
            this.pagedVouchers.every((item) => item.selected);
    }

    editVoucher(voucher: VoucherItem): void {
        this.isCategoryMenuOpen = false;
        this.editingVoucher = {
            ...voucher,
            startDate: new Date(voucher.startDate),
            endDate: new Date(voucher.endDate)
        };

        this.ensureCampaignOption(this.editingVoucher.campaignCode);
        this.editingStartDateText = this.toPayloadDate(this.editingVoucher.startDate);
        this.editingEndDateText = this.toPayloadDate(this.editingVoucher.endDate);

        this.isEditModalOpen = true;
    }

    saveVoucher(): void {
        if (!this.editingVoucher) {
            return;
        }

        const payload = this.buildPayload(this.editingVoucher, this.editingStartDateText, this.editingEndDateText);
        if (!payload) {
            return;
        }

        this.adminApi.updateVoucher(this.editingVoucher.code, payload).subscribe({
            next: () => {
                this.closeEditModal();
                this.loadVouchers();
            },
            error: (error) => {
                console.error('Cannot update voucher:', error);
                alert(error?.error?.message || 'Không lưu được voucher.');
            }
        });
    }

    deleteVoucher(voucher: VoucherItem): void {
        if (!confirm('Bạn có chắc muốn xóa voucher này?')) {
            return;
        }

        this.adminApi.deleteVoucher(voucher.code).subscribe({
            next: () => this.loadVouchers(),
            error: (error) => {
                console.error('Cannot delete voucher:', error);
                alert(error?.error?.message || 'Không xóa được voucher.');
            }
        });
    }

    openAddModal(): void {
        const nextId = this.vouchers.length > 0
            ? Math.max(...this.vouchers.map((item) => item.id)) + 1
            : 1;

        const today = new Date();
        const endDate = new Date();
        endDate.setDate(today.getDate() + 7);

        this.isFilterMenuOpen = false;
        this.isSortMenuOpen = false;
        this.isExportMenuOpen = false;
        this.isEditModalOpen = false;
        this.isCategoryMenuOpen = false;
        this.editingVoucher = null;

        const nextVoucherId = this.calculateNextVoucherId();
        this.newVoucher = {
            id: nextId,
            code: nextVoucherId,
            voucherCode: '',
            campaignCode: this.campaignOptions[0]?.code || '',
            customerId: '',
            customerName: '',
            discountType: 'Phần trăm',
            discountValue: 0,
            maxDiscount: 0,
            minimumOrder: 0,
            productScopeText: '',
            categoryIds: [],
            audience: 'Tất cả',
            membershipTierText: '',
            totalLimit: 0,
            perUserLimit: 0,
            firstOrderOnly: false,
            active: false,
            startDate: today,
            endDate: endDate,
            used: false,
            selected: false
        };

        this.newStartDateText = this.toPayloadDate(today);
        this.newEndDateText = this.toPayloadDate(endDate);
        this.newVoucherQuantity = 1;
        this.selectedCustomerIds = [];
        this.customerSearchKeyword = '';

        this.isAddModalOpen = true;

        // Xác nhận lại bằng dữ liệu mới nhất trên server để không lệch khi có người khác vừa tạo voucher.
        this.adminApi.getNextVoucherId().subscribe({
            next: ({ voucherId }) => {
                if (this.newVoucher && this.isAddModalOpen) {
                    this.newVoucher.code = voucherId;
                    this.cdr.detectChanges();
                }
            },
            error: (error) => {
                console.error('Cannot load next voucher ID:', error);
            }
        });
    }

    saveNewVoucher(): void {
        if (!this.newVoucher) {
            return;
        }

        const payload = this.buildPayload(this.newVoucher, this.newStartDateText, this.newEndDateText);
        if (!payload) {
            return;
        }

        const quantity = this.normalizeNewVoucherQuantity();
        if (quantity === null) {
            return;
        }

        this.adminApi.createVoucher({
            ...payload,
            customerIds: this.selectedCustomerIds,
            quantity,
            expectedVoucherId: this.newVoucher.code
        }).subscribe({
            next: () => {
                this.searchKeyword = '';
                this.selectedDiscountType = 'Tất cả';
                this.closeAddModal();
                this.loadVouchers();
            },
            error: (error) => {
                console.error('Cannot create voucher:', error);
                if (error?.status === 409 && error?.error?.voucherId && this.newVoucher) {
                    this.newVoucher.code = String(error.error.voucherId);
                    this.cdr.detectChanges();
                }
                alert(error?.error?.message || 'Không thêm được voucher.');
            }
        });
    }

    private calculateNextVoucherId(): string {
        const maxNumber = this.vouchers.reduce((max, voucher) => {
            const match = String(voucher.code || '').match(/^VC(\d+)$/i);
            return match ? Math.max(max, Number(match[1])) : max;
        }, 0);

        return `VC${String(maxNumber + 1).padStart(4, '0')}`;
    }

    closeAddModal(): void {
        this.isAddModalOpen = false;
        this.isCategoryMenuOpen = false;
        this.newVoucher = null;
        this.newStartDateText = '';
        this.newEndDateText = '';
        this.newVoucherQuantity = 1;
        this.selectedCustomerIds = [];
        this.customerSearchKeyword = '';
    }

    closeEditModal(): void {
        this.isEditModalOpen = false;
        this.isCategoryMenuOpen = false;
        this.editingVoucher = null;
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

    isCustomerSelected(customerCode: string): boolean {
        return this.selectedCustomerIds.includes(customerCode);
    }

    toggleCustomerSelection(customerCode: string, event?: Event): void {
        event?.stopPropagation();
        const normalizedCode = String(customerCode || '').trim();

        if (!normalizedCode) {
            return;
        }

        if (this.isCustomerSelected(normalizedCode)) {
            this.selectedCustomerIds = this.selectedCustomerIds.filter((code) => code !== normalizedCode);
            return;
        }

        this.selectedCustomerIds = [...this.selectedCustomerIds, normalizedCode];
    }

    selectAllFilteredCustomers(): void {
        const merged = new Set(this.selectedCustomerIds);
        this.filteredCustomerOptions.forEach((customer) => merged.add(customer.code));
        this.selectedCustomerIds = Array.from(merged);
    }

    clearSelectedCustomers(): void {
        this.selectedCustomerIds = [];
    }

    removeSelectedCustomer(customerCode: string): void {
        this.selectedCustomerIds = this.selectedCustomerIds.filter((code) => code !== customerCode);
    }

    customerDisplayName(voucher: VoucherItem): string {
        if (voucher.customerId) {
            return voucher.customerName
                ? `${voucher.customerName} (${voucher.customerId})`
                : voucher.customerId;
        }

        return 'Dùng chung';
    }

    private mapVoucher(item: AdminVoucher): VoucherItem {
        this.ensureCampaignOption(item.campaignCode);

        return {
            ...item,
            customerId: item.customerId || '',
            customerName: item.customerName || '',
            discountType: this.toDisplayDiscountType(item.discountType),
            maxDiscount: Number(item.maxDiscount || 0),
            minimumOrder: Number(item.minimumOrder || 0),
            productScopeText: (item.productIds || []).join(', '),
            categoryIds: [...(item.categoryIds || [])],
            audience: item.audience || 'Tất cả',
            membershipTierText: (item.membershipTiers || []).join(', '),
            totalLimit: Number(item.totalLimit || 0),
            perUserLimit: Number(item.perUserLimit || 0),
            firstOrderOnly: Boolean(item.firstOrderOnly),
            active: Boolean(item.active),
            startDate: this.toDate(item.startDate),
            endDate: this.toDate(item.endDate),
            used: Boolean(item.used),
            selected: false
        };
    }

    private buildPayload(voucher: VoucherItem, startText: string, endText: string) {
        if (!voucher.voucherCode.trim()) {
            alert('Vui lòng nhập tên voucher.');
            return null;
        }

        const startDate = this.parseInputDate(startText);
        const endDate = this.parseInputDate(endText);

        if (!startDate || !endDate) {
            alert('Vui lòng chọn ngày bắt đầu và ngày kết thúc.');
            return null;
        }

        if (endDate <= startDate) {
            alert('Ngày kết thúc phải sau ngày bắt đầu.');
            return null;
        }

        const discountValue = Number(voucher.discountValue || 0);
        if (discountValue <= 0 || (voucher.discountType === 'Phần trăm' && discountValue > 100)) {
            alert('Giá trị giảm không hợp lệ.');
            return null;
        }

        return {
            voucherCode: voucher.voucherCode.trim(),
            campaignCode: voucher.campaignCode,
            discountType: voucher.discountType,
            discountValue,
            maxDiscount: Number(voucher.maxDiscount || 0),
            minimumOrder: Number(voucher.minimumOrder || 0),
            productIds: this.parseList(voucher.productScopeText),
            categoryIds: [...voucher.categoryIds],
            audience: voucher.audience,
            membershipTiers: this.parseList(voucher.membershipTierText),
            totalLimit: Number(voucher.totalLimit || 0),
            perUserLimit: Number(voucher.perUserLimit || 0),
            firstOrderOnly: voucher.firstOrderOnly,
            active: voucher.active,
            startDate: this.toPayloadDate(startDate),
            endDate: this.toPayloadDate(endDate)
        };
    }

    private parseList(value: string): string[] {
        return [...new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean))];
    }

    toggleCategoryMenu(): void {
        this.isCategoryMenuOpen = !this.isCategoryMenuOpen;
    }

    isCategorySelected(voucher: VoucherItem, categoryId: string): boolean {
        return voucher.categoryIds.includes(categoryId);
    }

    toggleCategorySelection(voucher: VoucherItem, categoryId: string, event: Event): void {
        const checked = (event.target as HTMLInputElement).checked;
        voucher.categoryIds = checked
            ? [...new Set([...voucher.categoryIds, categoryId])]
            : voucher.categoryIds.filter((id) => id !== categoryId);
    }

    clearCategorySelection(voucher: VoucherItem): void {
        voucher.categoryIds = [];
    }

    getCategorySelectionLabel(voucher: VoucherItem): string {
        if (voucher.categoryIds.length === 0) {
            return 'Tất cả danh mục';
        }

        const names = voucher.categoryIds.map((id) =>
            this.categoryOptions.find((category) => category.code === id)?.name || id
        );
        return names.join(', ');
    }

    private normalizeNewVoucherQuantity(): number | null {
        const quantity = Number(this.newVoucherQuantity);

        if (!Number.isInteger(quantity) || quantity < 1) {
            alert('Vui lòng nhập số lượng voucher hợp lệ.');
            return null;
        }

        const totalVoucherCount = quantity * Math.max(1, this.selectedCustomerIds.length);

        if (totalVoucherCount > 500) {
            alert('Số lượng voucher tạo mới không được vượt quá 500.');
            return null;
        }

        return quantity;
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

    private matchesDiscountType(itemType: string, selectedType: string): boolean {
        const item = this.removeVietnameseTones(itemType.toLowerCase());
        const selected = this.removeVietnameseTones(selectedType.toLowerCase());

        if (selected === 'tien') {
            return item.includes('tien');
        }

        return item === selected;
    }

    private toDisplayDiscountType(value: string): string {
        const normalized = this.removeVietnameseTones(String(value || '').toLowerCase());

        if (normalized.includes('phi van chuyen') || normalized.includes('ship')) {
            return 'Phí vận chuyển';
        }

        if (normalized.includes('tien') || normalized.includes('so tien')) {
            return 'Tiền';
        }

        if (normalized.includes('phan tram')) {
            return 'Phần trăm';
        }

        return value || this.discountTypes[0];
    }

    private ensureCampaignOption(code: string): void {
        if (code && !this.campaignOptions.some((item) => item.code === code)) {
            this.campaignOptions = [
                ...this.campaignOptions,
                { code, name: code }
            ];
        }
    }
}
