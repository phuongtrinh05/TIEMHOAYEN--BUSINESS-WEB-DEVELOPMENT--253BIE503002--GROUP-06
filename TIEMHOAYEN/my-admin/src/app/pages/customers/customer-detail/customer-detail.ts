import { CommonModule, isPlatformBrowser, Location } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, Subscription } from 'rxjs';
import {
    AdminApiService,
    AdminCustomer,
    AdminCustomerAddress,
    AdminCustomerAddressPayload,
    AdminCustomerDetailResponse,
    AdminCustomerNote,
    AdminCustomerReview,
    AdminLastLogin
} from '../../../services/admin-api.service';

type DetailTab = 'overview' | 'orders' | 'favorites' | 'reviews';
type OrderFilter = 'all' | 'completed' | 'pending' | 'cancelled';
type AddressField = 'name' | 'phone' | 'province' | 'district' | 'ward' | 'detailAddress';

type Rank = 'Đồng' | 'Bạc' | 'Vàng' | 'Kim cương';

const PHONE_PATTERN = /^0\d{9}$/;

interface CustomerDetail {
    id: string | number;
    code: string;
    name: string;
    avatarText: string;
    phone: string;
    email: string;
    point: number;
    membershipTier?: string;
    createdAt: Date;
    birthDate?: string;
    gender?: string;
    status: string;
    locked: boolean;
    lockReason: string;
    totalOrders: number;
    completedOrders: number;
    totalSpent: number;
    debt: number;
    averageRating: number;
    reviewCount: number;
    latestOrderDate?: string;
    lastLogin: AdminLastLogin | null;
    internalNote: string;
}

/** AD40: chỉ họ tên, ngày sinh, giới tính được sửa; SĐT/email do khách tự đổi. */
interface CustomerEditForm {
    name: string;
    birthDate: string;
    gender: string;
}

interface ReviewItem extends AdminCustomerReview {
    replyOpen: boolean;
    replyDraft: string;
    replySaving: boolean;
    replyError: string;
    hideOpen: boolean;
    hideReason: string;
    visibilitySaving: boolean;
    visibilityError: string;
}

interface LockDialogState {
    locking: boolean;
    reason: string;
    error: string;
    saving: boolean;
}

type RawCustomer = AdminCustomer & {
    points?: number;
    id?: unknown;
    averageRating?: number;
    reviewCount?: number;
    internalNote?: string;
};

interface AddressItem {
    id: string;
    name: string;
    phone: string;
    address: string;
    province: string;
    district: string;
    ward: string;
    detailAddress: string;
    isDefault: boolean;
}

interface WardOption {
    name: string;
}

interface DistrictOption {
    name: string;
    wards: Array<WardOption | string>;
}

interface ProvinceOption {
    name: string;
    districts: DistrictOption[];
}

interface CustomerOrderItem {
    id: string | number;
    code: string;
    createdAt: string;
    total: number;
    paid: number;
    remaining: number;
    paymentStatus: string;
    status: string;
}

interface FavoriteProductItem {
    id: string | number;
    code: string;
    name: string;
    image: string;
    price: number;
    originalPrice: number;
    salePrice: number;
    likedAt: string;
    availability: string;
    canOpen: boolean;
}

interface RankConfig {
    name: Rank;
    minAmount: number;
    targetAmount: number;
    nextRank: Rank;
}

@Component({
    selector: 'app-customer-detail',
    standalone: true,
    imports: [
        CommonModule,
    ],
    templateUrl: './customer-detail.html',
    styleUrls: ['./customer-detail.css']
})
export class CustomerDetailComponent implements OnInit, OnDestroy {
    openedAddressMenuId: string | null = null;
    activeTab: DetailTab = 'overview';
    orderFilter: OrderFilter = 'all';
    orderSearchTerm = '';
    isCustomerEditing = false;
    isCustomerSaving = false;
    customerFormError = '';
    customerFieldErrors: Partial<Record<keyof CustomerEditForm, string>> = {};
    customerForm: CustomerEditForm = {
        name: '',
        birthDate: '',
        gender: ''
    };
    readonly todayInputValue = this.toLocalDateInput(new Date());

    isLoading = false;
    loadError = '';

    lockDialog: LockDialogState | null = null;

    notes: AdminCustomerNote[] = [];
    noteDraft = '';
    isNoteSaving = false;
    noteError = '';

    reviews: ReviewItem[] = [];

    toastMessage = '';
    toastType: 'success' | 'error' = 'success';
    private toastTimer: ReturnType<typeof setTimeout> | null = null;

    isAddressModalOpen = false;
    addressModalMode: 'create' | 'edit' = 'create';
    addressFormError = '';
    addressFieldErrors: Partial<Record<AddressField, string>> = {};
    isAddressSaving = false;
    editingAddressId: string | null = null;
    addressForm: AdminCustomerAddressPayload = {
        name: '',
        phone: '',
        address: '',
        province: '',
        district: '',
        ward: '',
        detailAddress: '',
        isDefault: false
    };

    customer: CustomerDetail = {
        id: 0,
        code: '',
        name: '',
        avatarText: '',
        phone: '',
        email: '',
        point: 0,
        membershipTier: '',
        createdAt: new Date(),
        status: '',
        locked: false,
        lockReason: '',
        totalOrders: 0,
        completedOrders: 0,
        totalSpent: 0,
        debt: 0,
        averageRating: 0,
        reviewCount: 0,
        latestOrderDate: '',
        lastLogin: null,
        internalNote: ''
    };

    addresses: AddressItem[] = [];
    orders: CustomerOrderItem[] = [];
    favoriteProducts: FavoriteProductItem[] = [];
    visibleFavoriteCount = 8;
    readonly fallbackProductImage = 'assets/images/product-list-chungthuy.png';
    provinceOptions: ProvinceOption[] = [
        {
            name: 'Thành phố Hồ Chí Minh',
            districts: [
                { name: 'Quận 1', wards: ['Phường Bến Nghé', 'Phường Bến Thành', 'Phường Đa Kao', 'Phường Nguyễn Thái Bình'] },
                { name: 'Quận 3', wards: ['Phường 1', 'Phường 2', 'Phường 3', 'Phường 4'] },
                { name: 'Quận 10', wards: ['Phường 1', 'Phường 2', 'Phường 10', 'Phường 15'] },
                { name: 'Quận Bình Thạnh', wards: ['Phường 1', 'Phường 2', 'Phường 15', 'Phường 25'] },
                { name: 'Thành phố Thủ Đức', wards: ['Phường Thảo Điền', 'Phường Linh Trung', 'Phường Hiệp Bình Chánh', 'Phường An Phú'] }
            ]
        },
        {
            name: 'Hà Nội',
            districts: [
                { name: 'Quận Ba Đình', wards: ['Phường Cống Vị', 'Phường Điện Biên', 'Phường Kim Mã'] },
                { name: 'Quận Hoàn Kiếm', wards: ['Phường Hàng Bạc', 'Phường Hàng Bài', 'Phường Tràng Tiền'] },
                { name: 'Quận Cầu Giấy', wards: ['Phường Dịch Vọng', 'Phường Nghĩa Đô', 'Phường Yên Hòa'] }
            ]
        },
        {
            name: 'Đà Nẵng',
            districts: [
                { name: 'Quận Hải Châu', wards: ['Phường Hải Châu I', 'Phường Hải Châu II', 'Phường Thạch Thang'] },
                { name: 'Quận Sơn Trà', wards: ['Phường An Hải Bắc', 'Phường An Hải Đông', 'Phường Nại Hiên Đông'] }
            ]
        },
        {
            name: 'Bình Dương',
            districts: [
                { name: 'Thành phố Dĩ An', wards: ['Phường Dĩ An', 'Phường Đông Hòa', 'Phường Tân Đông Hiệp'] },
                { name: 'Thành phố Thủ Dầu Một', wards: ['Phường Phú Cường', 'Phường Hiệp Thành', 'Phường Chánh Nghĩa'] }
            ]
        },
        {
            name: 'Lâm Đồng',
            districts: [
                { name: 'Thành phố Đà Lạt', wards: ['Phường 1', 'Phường 2', 'Phường 10', 'Phường 11'] },
                { name: 'Huyện Đức Trọng', wards: ['Thị trấn Liên Nghĩa', 'Xã Hiệp An', 'Xã Liên Hiệp'] }
            ]
        }
    ];

    rankConfigs: RankConfig[] = [
        {
            name: 'Đồng',
            minAmount: 0,
            targetAmount: 1000000,
            nextRank: 'Bạc'
        },
        {
            name: 'Bạc',
            minAmount: 1000000,
            targetAmount: 3000000,
            nextRank: 'Vàng'
        },
        {
            name: 'Vàng',
            minAmount: 3000000,
            targetAmount: 6000000,
            nextRank: 'Kim cương'
        },
        {
            name: 'Kim cương',
            minAmount: 6000000,
            targetAmount: 6000000,
            nextRank: 'Kim cương'
        }
    ];

    private platformId = inject(PLATFORM_ID);
    private routeSub?: Subscription;

    constructor(
        private location: Location,
        private route: ActivatedRoute,
        private router: Router,
        private adminApi: AdminApiService,
        private cdr: ChangeDetectorRef
    ) {
        if (isPlatformBrowser(this.platformId)) {
            const navigationState = window.history.state;

            if (navigationState && navigationState.customer) {
                this.customer = {
                    ...this.customer,
                    ...navigationState.customer,
                    createdAt: new Date(navigationState.customer.createdAt)
                };
            }
        }
    }

    ngOnInit(): void {
        this.provinceOptions = [];
        this.loadAddressOptions();

        this.routeSub = this.route.paramMap.subscribe((params) => {
            const customerId = params.get('id') || this.customer.code;

            if (customerId) {
                this.loadCustomerDetail(customerId);
            }
        });
    }

    ngOnDestroy(): void {
        this.routeSub?.unsubscribe();
        if (this.toastTimer) {
            clearTimeout(this.toastTimer);
        }
    }

    retryLoad(): void {
        const customerId = this.route.snapshot.paramMap.get('id') || this.customer.code;
        if (customerId) {
            this.loadCustomerDetail(customerId);
        }
    }

    private showToast(message: string, type: 'success' | 'error' = 'success'): void {
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

    private errorMessage(error: any, fallback: string): string {
        if (error?.name === 'TimeoutError') {
            return 'Yêu cầu quá lâu, vui lòng thử lại.';
        }

        return error?.error?.message || fallback;
    }

    // ---------- Trạng thái tài khoản (AD35) ----------
    get statusKey(): 'active' | 'locked' | 'pending' {
        if (this.customer.locked) return 'locked';
        const key = this.normalizeText(this.customer.status);
        if (key.includes('khoa')) return 'locked';
        if (key.includes('xac minh')) return 'pending';
        return 'active';
    }

    get statusLabel(): string {
        return this.customer.status || (this.customer.locked ? 'Bị khóa' : 'Hoạt động');
    }

    openLockDialog(): void {
        if (!this.customer.code) {
            return;
        }

        this.lockDialog = {
            locking: !this.customer.locked,
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

    updateLockReason(event: Event): void {
        if (this.lockDialog) {
            this.lockDialog.reason = (event.target as HTMLTextAreaElement).value;
            this.lockDialog.error = '';
        }
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

        this.adminApi.setCustomerLock(this.customer.code, dialog.locking, reason)
            .pipe(finalize(() => {
                dialog.saving = false;
                this.cdr.detectChanges();
            }))
            .subscribe({
                next: (response) => {
                    this.mergeCustomer(response.customer);
                    this.lockDialog = null;
                    this.showToast(response.message || (dialog.locking ? 'Đã khóa tài khoản.' : 'Đã mở khóa tài khoản.'));
                },
                error: (error) => {
                    dialog.error = this.errorMessage(error, 'Không thể cập nhật trạng thái tài khoản.');
                }
            });
    }

    // ---------- Ghi chú nội bộ (AD35) ----------
    updateNoteDraft(event: Event): void {
        this.noteDraft = (event.target as HTMLTextAreaElement).value;
        this.noteError = '';
    }

    addNote(): void {
        if (this.isNoteSaving) {
            return;
        }

        const content = this.noteDraft.trim();

        if (!content) {
            this.noteError = 'Vui lòng nhập nội dung ghi chú.';
            return;
        }

        if (content.length > 1000) {
            this.noteError = 'Ghi chú tối đa 1000 ký tự.';
            return;
        }

        this.isNoteSaving = true;
        this.noteError = '';

        this.adminApi.addCustomerNote(this.customer.code, content)
            .pipe(finalize(() => {
                this.isNoteSaving = false;
                this.cdr.detectChanges();
            }))
            .subscribe({
                next: (response) => {
                    if (response.note) {
                        this.notes = [response.note, ...this.notes];
                    }
                    this.noteDraft = '';
                    this.showToast(response.message || 'Đã thêm ghi chú.');
                },
                error: (error) => {
                    this.noteError = this.errorMessage(error, 'Không thể thêm ghi chú.');
                }
            });
    }

    // ---------- Đánh giá (AD38) ----------
    get visibleReviewCount(): number {
        return this.reviews.filter((review) => !review.hidden).length;
    }

    starList(rating: number): boolean[] {
        const value = Math.round(Number(rating || 0));
        return [1, 2, 3, 4, 5].map((star) => star <= value);
    }

    toggleReplyForm(review: ReviewItem): void {
        if (review.replySaving) {
            return;
        }

        review.replyOpen = !review.replyOpen;
        review.replyDraft = review.replyOpen ? (review.reply || '') : '';
        review.replyError = '';
        review.hideOpen = false;
    }

    updateReplyDraft(review: ReviewItem, event: Event): void {
        review.replyDraft = (event.target as HTMLTextAreaElement).value;
        review.replyError = '';
    }

    submitReply(review: ReviewItem): void {
        if (review.replySaving) {
            return;
        }

        const reply = review.replyDraft.trim();

        if (!reply) {
            review.replyError = 'Vui lòng nhập nội dung trả lời.';
            return;
        }

        review.replySaving = true;
        review.replyError = '';

        this.adminApi.replyToReview(review.id, reply)
            .pipe(finalize(() => {
                review.replySaving = false;
                this.cdr.detectChanges();
            }))
            .subscribe({
                next: (response) => {
                    review.reply = response.review?.shopReply || reply;
                    review.replyDate = response.review?.shopReplyDate || new Date().toISOString();
                    review.replyOpen = false;
                    review.replyDraft = '';
                    this.showToast(response.message || 'Đã gửi trả lời.');
                },
                error: (error) => {
                    review.replyError = this.errorMessage(error, 'Không thể gửi trả lời.');
                }
            });
    }

    toggleHideForm(review: ReviewItem): void {
        if (review.visibilitySaving) {
            return;
        }

        review.hideOpen = !review.hideOpen;
        review.hideReason = '';
        review.visibilityError = '';
        review.replyOpen = false;
    }

    updateHideReason(review: ReviewItem, event: Event): void {
        review.hideReason = (event.target as HTMLTextAreaElement).value;
        review.visibilityError = '';
    }

    setReviewHidden(review: ReviewItem, hidden: boolean): void {
        if (review.visibilitySaving) {
            return;
        }

        const reason = hidden ? review.hideReason.trim() : '';

        if (hidden && !reason) {
            review.visibilityError = 'Vui lòng nhập lý do ẩn đánh giá.';
            return;
        }

        review.visibilitySaving = true;
        review.visibilityError = '';

        this.adminApi.setReviewVisibility(review.id, hidden, reason)
            .pipe(finalize(() => {
                review.visibilitySaving = false;
                this.cdr.detectChanges();
            }))
            .subscribe({
                next: (response) => {
                    review.hidden = typeof response.hidden === 'boolean' ? response.hidden : hidden;
                    review.hiddenReason = review.hidden ? reason : '';
                    review.hideOpen = false;
                    review.hideReason = '';
                    this.showToast(response.message || (hidden ? 'Đã ẩn đánh giá.' : 'Đã hiện lại đánh giá.'));
                },
                error: (error) => {
                    review.visibilityError = this.errorMessage(error, 'Không thể cập nhật hiển thị đánh giá.');
                }
            });
    }

    openReviewOrder(review: AdminCustomerReview): void {
        if (review.orderId) {
            this.router.navigate(['/orders/order-detail', review.orderId]);
        }
    }

    // ---------- Yêu thích (AD37) ----------
    getAvailabilityClass(product: FavoriteProductItem): string {
        const key = this.normalizeText(product.availability);
        if (key.includes('dang ban')) return 'availability-selling';
        if (key.includes('het hang')) return 'availability-out';
        if (key.includes('xoa')) return 'availability-deleted';
        return 'availability-stopped';
    }

    isFavoriteUnavailable(product: FavoriteProductItem): boolean {
        return this.normalizeText(product.availability) !== 'dang ban';
    }

    get districtOptions(): DistrictOption[] {
        return this.provinceOptions.find((province) => province.name === this.addressForm.province)?.districts || [];
    }

    get wardOptions(): string[] {
        return (this.districtOptions.find((district) => district.name === this.addressForm.district)?.wards || [])
            .map((ward) => typeof ward === 'string' ? ward : ward.name)
            .filter(Boolean);
    }

    get provinceSelectOptions(): ProvinceOption[] {
        return this.withSelectedProvinceOption(this.provinceOptions, String(this.addressForm.province || ''));
    }

    get districtSelectOptions(): DistrictOption[] {
        return this.withSelectedDistrictOption(this.districtOptions, String(this.addressForm.district || ''));
    }

    get wardSelectOptions(): string[] {
        return this.withSelectedTextOption(this.wardOptions, String(this.addressForm.ward || ''));
    }

    private loadAddressOptions(): void {
        this.adminApi.getAddressOptions().subscribe({
            next: (response) => {
                if (Array.isArray(response.provinces) && response.provinces.length > 0) {
                    this.provinceOptions = this.normalizeProvinceOptions(response.provinces);
                    if (this.isAddressModalOpen && this.addressModalMode === 'edit' && this.editingAddressId) {
                        const editingAddress = this.addresses.find((address) => address.id === this.editingAddressId);
                        if (editingAddress) {
                            this.addressForm = this.resolveAddressFormValues(editingAddress);
                        }
                    }
                }
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load address options', error);
                this.cdr.detectChanges();
            }
        });
    }

    get rank(): Rank {
        return this.getRankByTier(this.customer.membershipTier || '');
    }

    get currentRankConfig(): RankConfig {
        return this.rankConfigs.find((config) => config.name === this.rank) || this.rankConfigs[0];
    }

    /** Số đơn không tính đơn đã hủy (khớp số liệu server). */
    get totalOrders(): number {
        return this.customer.totalOrders || this.orders.filter((order) => !this.isCancelledOrder(order)).length;
    }

    get debt(): number {
        return this.customer.debt || 0;
    }

    get filteredOrders(): CustomerOrderItem[] {
        const keyword = this.normalizeText(this.orderSearchTerm);

        return this.orders.filter((order) => {
            const matchesSearch = !keyword || [
                order.code,
                order.status,
                order.paymentStatus,
                this.formatPrice(order.total),
                this.formatDate(order.createdAt),
            ].some((value) => this.normalizeText(value).includes(keyword));

            return matchesSearch && this.matchesOrderFilter(order);
        });
    }

    get completedOrderCount(): number {
        return this.orders.filter((order) => this.isCompletedOrder(order)).length;
    }

    get pendingOrderCount(): number {
        return this.orders.filter((order) => this.isPendingOrder(order)).length;
    }

    get cancelledOrderCount(): number {
        return this.orders.filter((order) => this.isCancelledOrder(order)).length;
    }

    get visibleFavoriteProducts(): FavoriteProductItem[] {
        return this.favoriteProducts.slice(0, this.visibleFavoriteCount);
    }

    get hasMoreFavoriteProducts(): boolean {
        return this.visibleFavoriteCount < this.favoriteProducts.length;
    }

    get averageRating(): string {
        return `${this.customer.averageRating || 0} / 5`;
    }

    get latestOrderDate(): Date | null {
        return this.parseDate(this.customer.latestOrderDate || '');
    }

    get latestOrderAgoText(): string {
        const date = this.latestOrderDate;
        return this.customer.code && date ? this.relativeDateText(date) : 'Chưa có đơn';
    }

    get totalSpent(): number {
        return this.customer.totalSpent || 0;
    }

    get rankTargetAmount(): number {
        return this.currentRankConfig.targetAmount;
    }

    get progressPercent(): number {
        if (this.rank === 'Kim cương') {
            return 100;
        }

        const percent = (this.totalSpent / this.rankTargetAmount) * 100;

        return Math.min(Math.round(percent), 100);
    }

    get nextRankName(): Rank {
        return this.currentRankConfig.nextRank;
    }

    get nextRankAmount(): number {
        if (this.rank === 'Kim cương') {
            return 0;
        }

        return Math.max(this.rankTargetAmount - this.totalSpent, 0);
    }

    get upgradeText(): string {
        if (this.rank === 'Kim cương') {
            return 'Hạng cao nhất';
        }

        return `Còn ${this.formatPrice(this.nextRankAmount)} để nâng hạng`;
    }

    get progressTitle(): string {
        return `Tiến độ nâng hạng ${this.nextRankName}`;
    }

    get progressAmountText(): string {
        return `${this.formatPrice(this.totalSpent)} / ${this.formatPrice(this.rankTargetAmount)}`;
    }

    getRankImage(_point?: number): string {
        const rank = this.rank;

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

    getRankFrame(_point?: number): string {
        const rank = this.rank;

        switch (rank) {
            case 'Đồng':
                return 'assets/images/bronze_frame.png';

            case 'Bạc':
                return 'assets/images/silver_frame.png';

            case 'Vàng':
                return 'assets/images/gold_frame.png';

            case 'Kim cương':
                return 'assets/images/diamond_frame.png';

            default:
                return '';
        }
    }

    private getRankByTier(tier: string): Rank {
        const value = this.normalizeText(tier);

        if (value.includes('kim')) {
            return 'Kim cương';
        }

        if (value.includes('vang')) {
            return 'Vàng';
        }

        if (value.includes('bac')) {
            return 'Bạc';
        }

        return 'Đồng';
    }

    formatPrice(price: number): string {
        return Number(price || 0).toLocaleString('vi-VN') + 'đ';
    }

    toggleAddressMenu(addressId: string): void {
        if (this.openedAddressMenuId === addressId) {
            this.openedAddressMenuId = null;
            return;
        }

        this.openedAddressMenuId = addressId;
    }

    private parseAddressParts(address: string): Pick<AddressItem, 'province' | 'district' | 'ward' | 'detailAddress'> {
        const parts = String(address || '').split(',').map((part) => part.trim()).filter(Boolean);

        return {
            province: parts[parts.length - 1] || '',
            district: parts[parts.length - 2] || '',
            ward: parts[parts.length - 3] || '',
            detailAddress: parts.length > 3 ? parts.slice(0, -3).join(', ') : (parts[0] || '')
        };
    }

    private composeAddress(form: AdminCustomerAddressPayload): string {
        return [
            form.detailAddress,
            form.ward,
            form.district,
            form.province
        ]
            .map((part) => String(part || '').trim())
            .filter(Boolean)
            .join(', ');
    }

    private mapAddress(address: AdminCustomerAddress): AddressItem {
        const parsedAddress = this.parseAddressParts(address.address);
        const addressItem: AddressItem = {
            id: address.id,
            name: address.name,
            phone: address.phone,
            province: this.repairAddressText(address.province || parsedAddress.province),
            district: this.repairAddressText(address.district || parsedAddress.district),
            ward: this.repairAddressText(address.ward || parsedAddress.ward),
            detailAddress: this.repairAddressText(address.detailAddress || parsedAddress.detailAddress),
            address: address.address,
            isDefault: address.isDefault
        };

        return {
            ...addressItem,
            address: addressItem.address || this.composeAddress(addressItem)
        };
    }

    private resolveAddressFormValues(address: AddressItem): AdminCustomerAddressPayload {
        const parsedAddress = this.parseAddressParts(address.address);
        const detailAddress = this.repairAddressText(address.detailAddress || parsedAddress.detailAddress);
        const databaseProvince = this.repairAddressText(address.province);
        const databaseDistrict = this.repairAddressText(address.district);
        const databaseWard = this.repairAddressText(address.ward);
        const rawProvince = databaseProvince || this.repairAddressText(parsedAddress.province);
        const rawDistrict = databaseDistrict || this.repairAddressText(parsedAddress.district);
        const rawWard = databaseWard || this.repairAddressText(parsedAddress.ward);

        this.ensureDatabaseAddressOptions(
            rawProvince,
            rawDistrict,
            rawWard
        );

        const province = this.findProvinceName(rawProvince, address.address) || rawProvince;
        const districts = this.provinceOptions.find((item) => item.name === province)?.districts || [];
        const district = this.findDistrictName(districts, rawDistrict, address.address) || rawDistrict;
        const wards = districts.find((item) => item.name === district)?.wards || [];
        const ward = this.findWardName(wards, rawWard, address.address) || rawWard;

        return {
            name: address.name,
            phone: address.phone,
            address: address.address,
            province,
            district,
            ward,
            detailAddress,
            isDefault: address.isDefault
        };
    }

    private findProvinceName(...candidates: string[]): string {
        return this.findOptionName(this.provinceOptions, candidates);
    }

    private findDistrictName(options: DistrictOption[], ...candidates: string[]): string {
        return this.findOptionName(options, candidates);
    }

    private findWardName(options: Array<WardOption | string>, ...candidates: string[]): string {
        const normalizedOptions = options.map((option) => ({
            name: typeof option === 'string' ? option : option.name
        }));

        return this.findOptionName(normalizedOptions, candidates);
    }

    private withSelectedProvinceOption(options: ProvinceOption[], selectedName: string): ProvinceOption[] {
        const selected = this.repairAddressText(selectedName).trim();
        if (!selected || options.some((option) => this.normalizeAddressText(option.name) === this.normalizeAddressText(selected))) {
            return options;
        }

        return [{ name: selected, districts: [] }, ...options];
    }

    private withSelectedDistrictOption(options: DistrictOption[], selectedName: string): DistrictOption[] {
        const selected = this.repairAddressText(selectedName).trim();
        if (!selected || options.some((option) => this.normalizeAddressText(option.name) === this.normalizeAddressText(selected))) {
            return options;
        }

        return [{ name: selected, wards: [] }, ...options];
    }

    private withSelectedTextOption(options: string[], selectedName: string): string[] {
        const selected = this.repairAddressText(selectedName).trim();
        if (!selected || options.some((option) => this.normalizeAddressText(option) === this.normalizeAddressText(selected))) {
            return options;
        }

        return [selected, ...options];
    }

    private ensureDatabaseAddressOptions(provinceName: string, districtName: string, wardName: string): void {
        if (!provinceName) {
            return;
        }

        const provinceIndex = this.provinceOptions.findIndex(
            (province) => this.normalizeAddressText(province.name) === this.normalizeAddressText(provinceName)
        );

        let province = provinceIndex >= 0 ? this.provinceOptions[provinceIndex] : undefined;

        if (!province) {
            province = {
                name: provinceName,
                districts: []
            };
            this.provinceOptions = [province, ...this.provinceOptions];
        }

        if (!districtName) {
            return;
        }

        let district = province.districts.find(
            (item) => this.normalizeAddressText(item.name) === this.normalizeAddressText(districtName)
        );

        if (!district) {
            district = {
                name: districtName,
                wards: []
            };
            province.districts = [district, ...province.districts];
        }

        if (!wardName) {
            return;
        }

        const hasWard = district.wards.some((ward) => {
            const name = typeof ward === 'string' ? ward : ward.name;
            return this.normalizeAddressText(name) === this.normalizeAddressText(wardName);
        });

        if (!hasWard) {
            district.wards = [{ name: wardName }, ...district.wards];
        }
    }

    private findOptionName(options: Array<{ name: string }>, candidates: string[]): string {
        const cleanedCandidates = candidates
            .map((candidate) => String(candidate || '').trim())
            .filter(Boolean);

        for (const candidate of cleanedCandidates) {
            const normalizedCandidate = this.normalizeAddressText(candidate);
            const exactMatch = options.find((option) => this.normalizeAddressText(option.name) === normalizedCandidate);
            if (exactMatch) {
                return exactMatch.name;
            }
        }

        const addressText = this.normalizeAddressText(cleanedCandidates.join(', '));
        const containsMatch = options.find((option) => addressText.includes(this.normalizeAddressText(option.name)));

        return containsMatch?.name || cleanedCandidates[0] || '';
    }

    private normalizeProvinceOptions(options: ProvinceOption[]): ProvinceOption[] {
        return options.map((province) => ({
            ...province,
            name: this.repairAddressText(province.name),
            districts: (province.districts || []).map((district) => ({
                ...district,
                name: this.repairAddressText(district.name),
                wards: (district.wards || []).map((ward) => {
                    if (typeof ward === 'string') {
                        return this.repairAddressText(ward);
                    }

                    return {
                        ...ward,
                        name: this.repairAddressText(ward.name)
                    };
                })
            }))
        }));
    }

    private normalizeAddressText(value: string): string {
        return this.repairAddressText(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .toLowerCase()
            .trim();
    }

    private repairAddressText(value: string): string {
        const text = String(value || '');

        if (!/[ÃÂÄÆ]/.test(text) || typeof TextDecoder === 'undefined') {
            return text;
        }

        try {
            const bytes = new Uint8Array(Array.from(text, (char) => char.charCodeAt(0) & 0xff));
            return new TextDecoder('utf-8').decode(bytes);
        } catch {
            return text;
        }
    }

    private sortAddresses(addresses: AddressItem[]): AddressItem[] {
        return addresses
            .map((address, index) => ({ address, index }))
            .sort((left, right) => (
                Number(right.address.isDefault) - Number(left.address.isDefault)
                || left.index - right.index
            ))
            .map(({ address }) => address);
    }

    setDefaultAddress(address: AddressItem): void {
        this.openedAddressMenuId = null;

        if (address.isDefault || !this.customer.code) {
            return;
        }

        this.adminApi.setDefaultCustomerAddress(this.customer.code, address.id).subscribe({
            next: (response) => {
                const saved = response?.address ? this.mapAddress(response.address) : null;
                this.addresses = this.sortAddresses(this.addresses.map((item) => {
                    if (item.id === address.id) {
                        return { ...(saved || item), isDefault: true };
                    }
                    return { ...item, isDefault: false };
                }));
                this.showToast(response?.message || 'Đã đặt địa chỉ mặc định.');
                this.cdr.detectChanges();
            },
            error: (error) => {
                this.showToast(this.errorMessage(error, 'Không thể đặt địa chỉ mặc định.'), 'error');
                this.cdr.detectChanges();
            }
        });
    }

    editAddress(address: AddressItem): void {
        this.openedAddressMenuId = null;
        this.addressModalMode = 'edit';
        this.editingAddressId = address.id;
        this.addressForm = this.resolveAddressFormValues(address);
        this.addressFormError = '';
        this.addressFieldErrors = {};
        this.isAddressModalOpen = true;
    }

    deleteAddress(address: AddressItem): void {
        const confirmed = confirm(`Bạn có chắc muốn xóa địa chỉ của ${address.name}?`);

        if (!confirmed) {
            return;
        }

        this.openedAddressMenuId = null;
        this.adminApi.deleteCustomerAddress(this.customer.code, address.id).subscribe({
            next: (response) => {
                const newDefaultId = (response as { newDefaultId?: string | null })?.newDefaultId || null;
                this.addresses = this.addresses.filter((item) => item.id !== address.id);

                if (newDefaultId) {
                    this.addresses = this.sortAddresses(this.addresses.map((item) => ({
                        ...item,
                        isDefault: item.id === newDefaultId
                    })));
                } else if (address.isDefault && this.addresses.length > 0) {
                    // Server tự chuyển mặc định nhưng không báo id: tải lại để đồng bộ.
                    this.retryLoad();
                }

                this.showToast(response?.message || 'Đã xóa địa chỉ.');
                this.cdr.detectChanges();
            },
            error: (error) => {
                this.showToast(this.errorMessage(error, 'Không thể xóa địa chỉ.'), 'error');
                this.cdr.detectChanges();
            }
        });
    }

    copyText(value: string, label: string): void {
        if (!isPlatformBrowser(this.platformId) || !value) {
            return;
        }

        navigator.clipboard.writeText(value)
            .then(() => {
                this.showToast(`Đã sao chép ${label}.`);
                this.cdr.detectChanges();
            })
            .catch(() => {
                this.showToast(`Không thể sao chép ${label}.`, 'error');
                this.cdr.detectChanges();
            });
    }

    createOrder(): void {
        this.router.navigate(['/orders/create-order']);
    }

    openOrderDetail(order: CustomerOrderItem): void {
        const orderCode = String(order.code || order.id || '').trim();

        if (!orderCode) {
            return;
        }

        this.router.navigate(['/orders/order-detail', orderCode], {
            state: {
                order: {
                    id: orderCode,
                    customerId: this.customer.code,
                    createdAt: order.createdAt,
                    total: order.total,
                    paymentStatus: order.paymentStatus,
                    orderStatus: order.status
                }
            }
        });
    }

    openChat(): void {
        this.router.navigate(['/customer-service/customer-chat'], {
            queryParams: { customerId: this.customer.code || null }
        });
    }

    startCustomerEdit(): void {
        this.customerForm = {
            name: this.customer.name || '',
            birthDate: this.toDateInputValue(this.customer.birthDate || ''),
            gender: this.customer.gender || ''
        };
        this.customerFormError = '';
        this.customerFieldErrors = {};
        this.isCustomerEditing = true;
        this.activeTab = 'overview';
    }

    cancelCustomerEdit(): void {
        if (this.isCustomerSaving) {
            return;
        }

        this.isCustomerEditing = false;
        this.customerFormError = '';
        this.customerFieldErrors = {};
    }

    updateCustomerForm(field: keyof CustomerEditForm, event: Event): void {
        const target = event.target as HTMLInputElement | HTMLSelectElement;
        this.customerForm = {
            ...this.customerForm,
            [field]: target.value
        };

        this.customerFieldErrors = { ...this.customerFieldErrors, [field]: '' };
        this.customerFormError = '';
    }

    private validateCustomerForm(): boolean {
        const errors: Partial<Record<keyof CustomerEditForm, string>> = {};
        const name = this.customerForm.name.trim();

        if (!name) {
            errors.name = 'Vui lòng nhập họ tên.';
        } else if (name.length > 100) {
            errors.name = 'Họ tên tối đa 100 ký tự.';
        }

        if (this.customerForm.birthDate) {
            const birth = this.parseDate(this.customerForm.birthDate);
            if (!birth) {
                errors.birthDate = 'Ngày sinh không hợp lệ.';
            } else if (this.customerForm.birthDate > this.todayInputValue) {
                errors.birthDate = 'Ngày sinh không được ở tương lai.';
            }
        }

        if (this.customerForm.gender && !['Nam', 'Nữ', 'Khác'].includes(this.customerForm.gender)) {
            errors.gender = 'Giới tính không hợp lệ.';
        }

        this.customerFieldErrors = errors;
        return Object.values(errors).every((message) => !message);
    }

    saveCustomerInfo(): void {
        if (this.isCustomerSaving) {
            return;
        }

        if (!this.customer.code) {
            this.customerFormError = 'Không tìm thấy mã khách hàng.';
            return;
        }

        if (!this.validateCustomerForm()) {
            return;
        }

        const payload = {
            name: this.customerForm.name.trim(),
            birthDate: this.customerForm.birthDate,
            gender: this.customerForm.gender.trim()
        };

        this.isCustomerSaving = true;
        this.customerFormError = '';

        this.adminApi.updateCustomer(this.customer.code, payload)
            .pipe(finalize(() => {
                this.isCustomerSaving = false;
                this.cdr.detectChanges();
            }))
            .subscribe({
                next: (response) => {
                    this.mergeCustomer(response.customer);
                    this.isCustomerEditing = false;
                    this.showToast(response.message || 'Đã lưu thông tin khách hàng.');
                },
                error: (error) => {
                    const field = error?.error?.field as keyof CustomerEditForm | undefined;
                    const message = this.errorMessage(error, 'Không thể lưu thông tin khách hàng.');

                    if (field && field in this.customerForm) {
                        this.customerFieldErrors = { ...this.customerFieldErrors, [field]: message };
                    } else {
                        this.customerFormError = message;
                    }
                }
            });
    }

    /** Gộp customer đã map từ server vào state hiện tại. */
    private mergeCustomer(updated: AdminCustomer | null | undefined): void {
        if (!updated) {
            return;
        }

        const raw = updated as RawCustomer & Record<string, unknown>;
        const mapped = this.mapCustomer(raw) as unknown as Record<string, unknown>;
        const merged = { ...this.customer } as unknown as Record<string, unknown>;
        const isPresent = (key: string): boolean => {
            if (key === 'point') return raw.point !== undefined || raw.points !== undefined;
            if (key === 'locked') return raw.locked !== undefined || raw.status !== undefined;
            return raw[key] !== undefined && raw[key] !== null || (key === 'lastLogin' && raw[key] === null);
        };

        Object.keys(mapped).forEach((key) => {
            if (isPresent(key)) {
                merged[key] = mapped[key];
            }
        });

        this.customer = merged as unknown as CustomerDetail;
    }

    private mapCustomer(customer: RawCustomer): CustomerDetail {
        const status = customer.status || (customer.locked ? 'Bị khóa' : 'Hoạt động');

        return {
            id: (customer.id as string | number) ?? customer.code,
            code: String(customer.code || customer.id || ''),
            name: customer.name || '',
            avatarText: customer.avatarText || this.getCustomerAvatarText(customer.name || ''),
            phone: customer.phone || '',
            email: customer.email || '',
            point: Number(customer.points ?? customer.point ?? 0) || 0,
            membershipTier: customer.membershipTier || '',
            createdAt: customer.createdAt ? new Date(customer.createdAt) : new Date(),
            birthDate: customer.birthDate || '',
            gender: customer.gender || '',
            status,
            locked: Boolean(customer.locked) || this.normalizeText(status) === 'bi khoa',
            lockReason: customer.lockReason || '',
            totalOrders: Number(customer.totalOrders || 0),
            completedOrders: Number(customer.completedOrders || 0),
            totalSpent: Number(customer.totalSpent || 0),
            debt: Number(customer.debt || 0),
            averageRating: Number(customer.averageRating || 0),
            reviewCount: Number(customer.reviewCount || 0),
            latestOrderDate: customer.latestOrderDate || '',
            lastLogin: customer.lastLogin || null,
            internalNote: customer.internalNote || ''
        };
    }

    addAddress(): void {
        this.openedAddressMenuId = null;
        this.addressModalMode = 'create';
        this.editingAddressId = null;
        this.addressForm = {
            name: this.customer.name || '',
            phone: this.customer.phone || '',
            address: '',
            province: '',
            district: '',
            ward: '',
            detailAddress: '',
            isDefault: this.addresses.length === 0
        };
        this.addressFormError = '';
        this.addressFieldErrors = {};
        this.isAddressModalOpen = true;
    }

    setActiveTab(tab: DetailTab): void {
        this.activeTab = tab;
    }

    updateAddressForm(field: keyof AdminCustomerAddressPayload, event: Event): void {
        const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const value = field === 'isDefault'
            ? (target as HTMLInputElement).checked
            : target.value;

        this.addressForm = {
            ...this.addressForm,
            [field]: value
        };

        this.clearAddressError(field);
    }

    private clearAddressError(...fields: Array<keyof AdminCustomerAddressPayload>): void {
        const next = { ...this.addressFieldErrors } as Record<string, string>;
        fields.forEach((field) => delete next[field]);
        this.addressFieldErrors = next;
        this.addressFormError = '';
    }

    onProvinceChange(event: Event): void {
        this.addressForm = {
            ...this.addressForm,
            province: (event.target as HTMLSelectElement).value,
            district: '',
            ward: ''
        };

        this.clearAddressError('province', 'district', 'ward');
    }

    onDistrictChange(event: Event): void {
        this.addressForm = {
            ...this.addressForm,
            district: (event.target as HTMLSelectElement).value,
            ward: ''
        };

        this.clearAddressError('district', 'ward');
    }

    closeAddressModal(): void {
        if (this.isAddressSaving) {
            return;
        }

        this.isAddressModalOpen = false;
        this.editingAddressId = null;
        this.addressFormError = '';
        this.addressFieldErrors = {};
    }

    saveAddress(): void {
        const payload: AdminCustomerAddressPayload = {
            name: this.addressForm.name.trim(),
            phone: this.addressForm.phone.trim(),
            province: String(this.addressForm.province || '').trim(),
            district: String(this.addressForm.district || '').trim(),
            ward: String(this.addressForm.ward || '').trim(),
            detailAddress: String(this.addressForm.detailAddress || '').trim(),
            address: this.composeAddress(this.addressForm),
            isDefault: this.addressForm.isDefault
        };

        const errors: Partial<Record<AddressField, string>> = {};
        if (!payload.name) errors.name = 'Vui lòng nhập tên người nhận.';
        else if (payload.name.length > 100) errors.name = 'Tên người nhận tối đa 100 ký tự.';
        if (!payload.phone) errors.phone = 'Vui lòng nhập số điện thoại.';
        else if (!PHONE_PATTERN.test(payload.phone)) errors.phone = 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0.';
        if (!payload.province) errors.province = 'Vui lòng chọn Tỉnh/Thành phố.';
        if (!payload.district) errors.district = 'Vui lòng chọn Quận/Huyện.';
        if (!payload.ward) errors.ward = 'Vui lòng chọn Phường/Xã.';
        if (!payload.detailAddress) errors.detailAddress = 'Vui lòng nhập địa chỉ cụ thể.';

        this.addressFieldErrors = errors;
        if (Object.keys(errors).length > 0) {
            this.addressFormError = '';
            return;
        }

        if (!this.customer.code) {
            this.addressFormError = 'Không tìm thấy mã khách hàng.';
            return;
        }

        this.isAddressSaving = true;
        this.addressFormError = '';
        const request = this.addressModalMode === 'edit' && this.editingAddressId
            ? this.adminApi.updateCustomerAddress(this.customer.code, this.editingAddressId, payload)
            : this.adminApi.createCustomerAddress(this.customer.code, payload);

        request.subscribe({
            next: (response) => {
                const savedAddress = this.mapAddress(response.address);

                if (savedAddress.isDefault) {
                    this.addresses = this.addresses.map((item) => ({
                        ...item,
                        isDefault: false
                    }));
                }

                if (this.addressModalMode === 'edit') {
                    this.addresses = this.addresses.map((item) => (
                        item.id === savedAddress.id ? savedAddress : item
                    ));
                } else {
                    this.addresses = [savedAddress, ...this.addresses];
                }

                this.addresses = this.sortAddresses(this.addresses);
                this.isAddressSaving = false;
                this.closeAddressModal();
                this.showToast(response.message || 'Đã lưu địa chỉ.');
                this.cdr.detectChanges();
            },
            error: (error) => {
                this.isAddressSaving = false;
                const message = this.errorMessage(error, 'Không thể lưu địa chỉ.');
                const field = error?.error?.field as AddressField | undefined;

                if (field && ['name', 'phone', 'province', 'district', 'ward', 'detailAddress'].includes(field)) {
                    this.addressFieldErrors = { ...this.addressFieldErrors, [field]: message };
                } else {
                    this.addressFormError = message;
                }
                this.cdr.detectChanges();
            }
        });
    }

    setOrderFilter(filter: OrderFilter): void {
        this.orderFilter = filter;
    }

    showMoreFavorites(): void {
        this.visibleFavoriteCount += 8;
    }

    /** AD37: mở trang chi tiết sản phẩm thật (theo mã), chỉ khi sản phẩm còn tồn tại. */
    openFavoriteProduct(product: FavoriteProductItem): void {
        if (!product.canOpen || !product.code) {
            return;
        }

        this.router.navigate(['/products/product-detail'], {
            queryParams: { id: product.code }
        });
    }

    onFavoriteImageError(event: Event): void {
        const image = event.target as HTMLImageElement;
        if (image.src.includes(this.fallbackProductImage)) {
            return;
        }

        image.src = this.fallbackProductImage;
    }

    updateOrderSearch(event: Event): void {
        const input = event.target as HTMLInputElement;
        this.orderSearchTerm = input.value;
    }

    getPaymentStatusClass(status: string): string {
        const key = this.normalizeText(status);

        if (key.includes('that bai') || key.includes('chua thanh toan')) {
            return 'payment-unpaid';
        }

        if (key.includes('coc')) {
            return 'payment-deposit';
        }

        if (key.includes('da thanh toan')) {
            return 'payment-paid';
        }

        return 'payment-waiting';
    }

    getOrderStatusClass(status: string): string {
        const key = this.normalizeText(status);

        if (key.includes('huy')) return 'status-cancelled';
        if (key.includes('hoan thanh') || key.includes('giao thanh cong') || key === 'da giao') return 'status-completed';
        if (key.includes('van chuyen')) return 'status-shipping';
        if (key.includes('chuan bi')) return 'status-preparing';
        if (key.includes('dang giao')) return 'status-delivering';

        return 'status-pending';
    }

    /** Nhận 'dd/mm/yyyy', 'yyyy-mm-dd' hoặc ISO. */
    parseDate(value: string): Date | null {
        const text = String(value || '').trim();
        if (!text) return null;

        const vi = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
        if (vi) {
            return new Date(Number(vi[3]), Number(vi[2]) - 1, Number(vi[1]));
        }

        const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (ymd) {
            return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
        }

        const date = new Date(text);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    formatDate(value: string): string {
        const date = this.parseDate(value);
        if (!date) return '--';

        return new Intl.DateTimeFormat('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).format(date);
    }

    formatDateTime(value: string): string {
        const text = String(value || '').trim();
        if (!text) return '--';
        if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(text)) return text;

        const date = new Date(text);
        if (Number.isNaN(date.getTime())) return text;

        return new Intl.DateTimeFormat('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).format(date);
    }

    private toDateInputValue(value: string): string {
        const date = this.parseDate(value);
        return date ? this.toLocalDateInput(date) : '';
    }

    private toLocalDateInput(date: Date): string {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${date.getFullYear()}-${month}-${day}`;
    }

    private getCustomerAvatarText(name: string): string {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);

        if (parts.length === 0) {
            return 'KH';
        }

        return parts
            .slice(-2)
            .map((part) => part.charAt(0).toUpperCase())
            .join('');
    }

    goBack(): void {
        this.location.back();
    }

    private loadCustomerDetail(customerId: string): void {
        this.isLoading = true;
        this.loadError = '';

        this.adminApi.getCustomerDetail(customerId)
            .pipe(finalize(() => {
                this.isLoading = false;
                this.cdr.detectChanges();
            }))
            .subscribe({
                next: (response) => {
                    this.applyCustomerDetail(response);
                },
                error: (error) => {
                    this.loadError = this.errorMessage(error, 'Không thể tải thông tin khách hàng.');
                }
            });
    }

    private applyCustomerDetail(response: AdminCustomerDetailResponse): void {
        this.customer = this.mapCustomer(response.customer as RawCustomer);

        this.addresses = this.sortAddresses((response.addresses || []).map((address) => this.mapAddress(address)));

        this.orders = (response.orders || []).map((order) => {
            const total = Number(order.total || 0);
            const paid = Number(order.paid ?? 0);
            return {
                id: order.id,
                code: String(order.code || order.id || ''),
                createdAt: order.createdAt,
                total,
                paid,
                remaining: Number(order.remaining ?? Math.max(total - paid, 0)),
                paymentStatus: order.paymentStatus || 'Chờ thanh toán',
                status: order.status || 'Chờ xử lý'
            };
        });

        this.favoriteProducts = (response.favorites || []).map((product) => {
            const availability = product.availability || 'Đang bán';
            return {
                id: product.id,
                code: product.code,
                name: product.name,
                image: product.image || this.fallbackProductImage,
                price: Number(product.salePrice || product.price || 0),
                originalPrice: Number(product.originalPrice || product.price || 0),
                salePrice: Number(product.salePrice || 0),
                likedAt: product.likedAt || '',
                availability,
                canOpen: product.canOpen ?? (this.normalizeText(availability) !== 'da xoa' && !!product.code)
            };
        });
        this.visibleFavoriteCount = 8;

        this.reviews = (response.reviews || []).map((review) => ({
            ...review,
            rating: Number(review.rating || 0),
            hidden: Boolean(review.hidden),
            hiddenReason: review.hiddenReason || '',
            reply: review.reply || '',
            replyDate: review.replyDate || '',
            replyOpen: false,
            replyDraft: '',
            replySaving: false,
            replyError: '',
            hideOpen: false,
            hideReason: '',
            visibilitySaving: false,
            visibilityError: ''
        }));

        this.notes = [...(response.notes || [])].sort((left, right) => (
            new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        ));
    }

    private matchesOrderFilter(order: CustomerOrderItem): boolean {
        if (this.orderFilter === 'completed') return this.isCompletedOrder(order);
        if (this.orderFilter === 'pending') return this.isPendingOrder(order);
        if (this.orderFilter === 'cancelled') return this.isCancelledOrder(order);

        return true;
    }

    private isCompletedOrder(order: CustomerOrderItem): boolean {
        const key = this.normalizeText(order.status);
        return key === 'da giao' || key.includes('hoan thanh') || key.includes('giao thanh cong');
    }

    /** Đang xử lý: mọi trạng thái chuẩn hóa còn lại (Đã đặt hàng thành công, Chờ thanh toán, Đang chuẩn bị hàng, Chờ vận chuyển, Đang giao). */
    private isPendingOrder(order: CustomerOrderItem): boolean {
        return !this.isCompletedOrder(order) && !this.isCancelledOrder(order);
    }

    showPaymentBreakdown(order: CustomerOrderItem): boolean {
        return !this.isCancelledOrder(order) && order.remaining > 0;
    }

    private isCancelledOrder(order: CustomerOrderItem): boolean {
        return this.normalizeText(order.status).includes('huy');
    }

    private normalizeText(value: unknown): string {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .toLowerCase()
            .trim();
    }

    private relativeDateText(value: Date): string {
        const today = new Date();
        const latestDate = new Date(value);

        today.setHours(0, 0, 0, 0);
        latestDate.setHours(0, 0, 0, 0);

        const diffTime = today.getTime() - latestDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= 0) {
            return 'Hôm nay';
        }

        if (diffDays === 1) {
            return '1 ngày trước';
        }

        if (diffDays < 30) {
            return `${diffDays} ngày trước`;
        }

        const diffMonths = Math.floor(diffDays / 30);

        if (diffMonths === 1) {
            return '1 tháng trước';
        }

        if (diffMonths < 12) {
            return `${diffMonths} tháng trước`;
        }

        const diffYears = Math.floor(diffDays / 365);

        if (diffYears === 1) {
            return '1 năm trước';
        }

        return `${diffYears} năm trước`;
    }
}
