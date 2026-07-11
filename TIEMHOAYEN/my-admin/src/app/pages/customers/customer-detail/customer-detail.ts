import { CommonModule, isPlatformBrowser, Location } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, Subscription } from 'rxjs';
import {
    AdminApiService,
    AdminCustomerAddress,
    AdminCustomerAddressPayload,
    AdminCustomerDetailResponse
} from '../../../services/admin-api.service';

type DetailTab = 'overview' | 'orders' | 'favorites' | 'reviews';
type OrderFilter = 'all' | 'completed' | 'pending' | 'cancelled';

type Rank = 'Đồng' | 'Bạc' | 'Vàng' | 'Kim cương';

interface CustomerDetail {
    id: number;
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
    totalOrders: number;
    totalSpent: number;
    averageRating: number;
    reviewCount: number;
    latestOrderDate?: string;
}

interface CustomerEditForm {
    name: string;
    birthDate: string;
    gender: string;
    email: string;
    phone: string;
}

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
    id: number;
    code: string;
    createdAt: string;
    total: number;
    paymentStatus: string;
    status: string;
}

interface FavoriteProductItem {
    id: number;
    code: string;
    name: string;
    image: string;
    price: number;
    originalPrice: number;
    salePrice: number;
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
    customerForm: CustomerEditForm = {
        name: '',
        birthDate: '',
        gender: '',
        email: '',
        phone: ''
    };
    isAddressModalOpen = false;
    addressModalMode: 'create' | 'edit' = 'create';
    addressFormError = '';
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
        totalOrders: 0,
        totalSpent: 0,
        averageRating: 0,
        reviewCount: 0,
        latestOrderDate: ''
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

    get totalOrders(): number {
        return this.orders.length || this.customer.totalOrders;
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

    get latestOrderDate(): Date {
        return this.customer.latestOrderDate ? new Date(this.customer.latestOrderDate) : this.customer.createdAt;
    }

    get latestOrderAgoText(): string {
        return this.customer.code ? this.relativeDateText(this.latestOrderDate) : '';
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
        return price.toLocaleString('vi-VN') + 'đ';
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
            next: () => {
                this.addresses = this.sortAddresses(this.addresses.map((item) => ({
                    ...item,
                    isDefault: item.id === address.id
                })));
            },
            error: (error) => {
                console.error('Cannot set default address', error);
                alert('Không thể đặt địa chỉ mặc định.');
            }
        });
    }

    editAddress(address: AddressItem): void {
        this.openedAddressMenuId = null;
        this.addressModalMode = 'edit';
        this.editingAddressId = address.id;
        this.addressForm = this.resolveAddressFormValues(address);
        this.addressFormError = '';
        this.isAddressModalOpen = true;
    }

    deleteAddress(address: AddressItem): void {
        const confirmed = confirm(`Bạn có chắc muốn xóa địa chỉ của ${address.name}?`);

        if (!confirmed) {
            return;
        }

        this.openedAddressMenuId = null;
        this.adminApi.deleteCustomerAddress(this.customer.code, address.id).subscribe({
            next: () => {
                this.addresses = this.addresses.filter((item) => item.id !== address.id);
            },
            error: (error) => {
                console.error('Cannot delete address', error);
                alert('Không thể xóa địa chỉ.');
            }
        });
    }

    copyText(value: string, label: string): void {
        if (!isPlatformBrowser(this.platformId)) {
            return;
        }

        navigator.clipboard.writeText(value)
            .then(() => {
                alert(`Đã sao chép ${label}!`);
            })
            .catch(() => {
                alert(`Không thể sao chép ${label}.`);
            });
    }

    createOrder(): void {
        this.router.navigate(['/orders/create-order']);
    }

    openOrderDetail(order: CustomerOrderItem): void {
        if (!order.code) {
            return;
        }

        this.router.navigate(['/orders/order-detail', order.code], {
            state: {
                order: {
                    id: order.code,
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
        alert('Mở khung chat với khách hàng');
    }

    startCustomerEdit(): void {
        this.customerForm = {
            name: this.customer.name || '',
            birthDate: this.toDateInputValue(this.customer.birthDate || ''),
            gender: this.customer.gender || '',
            email: this.customer.email || '',
            phone: this.customer.phone || ''
        };
        this.customerFormError = '';
        this.isCustomerEditing = true;
    }

    cancelCustomerEdit(): void {
        if (this.isCustomerSaving) {
            return;
        }

        this.isCustomerEditing = false;
        this.customerFormError = '';
    }

    updateCustomerForm(field: keyof CustomerEditForm, event: Event): void {
        const target = event.target as HTMLInputElement | HTMLSelectElement;
        this.customerForm = {
            ...this.customerForm,
            [field]: target.value
        };

        if (this.customerFormError) {
            this.customerFormError = '';
        }
    }

    saveCustomerInfo(): void {
        const payload = {
            name: this.customerForm.name.trim(),
            phone: this.customerForm.phone.trim(),
            email: this.customerForm.email.trim(),
            birthDate: this.customerForm.birthDate,
            gender: this.customerForm.gender.trim()
        };

        if (!payload.name || !payload.phone) {
            this.customerFormError = 'Vui lòng nhập họ tên và số điện thoại.';
            return;
        }

        if (!this.customer.code) {
            this.customerFormError = 'Không tìm thấy mã khách hàng.';
            return;
        }

        const previousCustomer = { ...this.customer };

        this.customer = {
            ...this.customer,
            name: payload.name,
            avatarText: this.getCustomerAvatarText(payload.name),
            phone: payload.phone,
            email: payload.email,
            birthDate: payload.birthDate,
            gender: payload.gender
        };
        this.isCustomerEditing = false;
        this.isCustomerSaving = true;

        this.adminApi.updateCustomer(this.customer.code, payload)
            .pipe(finalize(() => {
                this.isCustomerSaving = false;
            }))
            .subscribe({
            next: (response) => {
                const updated = response.customer;
                this.customer = {
                    ...this.customer,
                    name: updated.name,
                    avatarText: updated.avatarText,
                    phone: updated.phone,
                    email: updated.email,
                    birthDate: updated.birthDate,
                    gender: updated.gender,
                    point: Number(updated.point || this.customer.point),
                    createdAt: updated.createdAt ? new Date(updated.createdAt) : this.customer.createdAt
                };
            },
            error: (error) => {
                console.error('Cannot update customer', error);
                this.customer = previousCustomer;
                this.isCustomerEditing = true;
                this.customerFormError = error?.name === 'TimeoutError'
                    ? 'Lưu quá lâu, vui lòng thử lại.'
                    : (error?.error?.message || 'Không thể lưu thông tin khách hàng.');
            }
        });
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

        if (this.addressFormError) {
            this.addressFormError = '';
        }
    }

    onProvinceChange(event: Event): void {
        this.addressForm = {
            ...this.addressForm,
            province: (event.target as HTMLSelectElement).value,
            district: '',
            ward: ''
        };

        if (this.addressFormError) {
            this.addressFormError = '';
        }
    }

    onDistrictChange(event: Event): void {
        this.addressForm = {
            ...this.addressForm,
            district: (event.target as HTMLSelectElement).value,
            ward: ''
        };

        if (this.addressFormError) {
            this.addressFormError = '';
        }
    }

    closeAddressModal(): void {
        if (this.isAddressSaving) {
            return;
        }

        this.isAddressModalOpen = false;
        this.editingAddressId = null;
        this.addressFormError = '';
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

        if (!payload.name || !payload.phone || !payload.province || !payload.district || !payload.ward || !payload.detailAddress) {
            this.addressFormError = 'Vui lòng nhập đầy đủ tên, số điện thoại và địa chỉ.';
            return;
        }

        if (!this.customer.code) {
            this.addressFormError = 'Không tìm thấy mã khách hàng.';
            return;
        }

        this.isAddressSaving = true;
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
            },
            error: (error) => {
                console.error('Cannot save address', error);
                this.isAddressSaving = false;
                this.addressFormError = error?.error?.message || 'Không thể lưu địa chỉ.';
            }
        });
    }

    setOrderFilter(filter: OrderFilter): void {
        this.orderFilter = filter;
    }

    showMoreFavorites(): void {
        this.visibleFavoriteCount += 8;
    }

    openFavoriteProduct(product: FavoriteProductItem): void {
        if (!isPlatformBrowser(this.platformId)) {
            return;
        }

        localStorage.setItem('selectedProduct', JSON.stringify({
            image: product.image || this.fallbackProductImage,
            name: product.name,
            sku: product.code,
            price: this.formatPrice(product.price),
            rating: 0,
            quantity: 0,
            featured: false,
            sale: product.salePrice > 0 && product.salePrice < product.originalPrice,
            status: 'Đang bán',
            statusClass: 'selling',
            selected: false,
        }));

        this.router.navigate(['/products/product-detail']);
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

        if (key.includes('thanh toan')) {
            return 'payment-paid';
        }

        return 'payment-waiting';
    }

    getOrderStatusClass(status: string): string {
        const key = this.normalizeText(status);

        if (key.includes('huy')) return 'status-cancelled';
        if (key.includes('hoan thanh') || key.includes('giao thanh cong') || key.includes('da giao')) return 'status-completed';
        if (key.includes('van chuyen')) return 'status-shipping';
        if (key.includes('chuan bi')) return 'status-preparing';
        if (key.includes('dang giao')) return 'status-delivering';

        return 'status-pending';
    }

    formatDate(value: string): string {
        if (!value) return '--';

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '--';

        return new Intl.DateTimeFormat('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).format(date);
    }

    private toDateInputValue(value: string): string {
        if (!value) {
            return '';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return '';
        }

        return date.toISOString().slice(0, 10);
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
        this.adminApi.getCustomerDetail(customerId).subscribe({
            next: (response) => {
                this.applyCustomerDetail(response);
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Cannot load customer detail', error);
                alert('Không thể tải thông tin khách hàng.');
                this.cdr.detectChanges();
            }
        });
    }

    private applyCustomerDetail(response: AdminCustomerDetailResponse): void {
        const customer = response.customer;

        this.customer = {
            id: customer.id,
            code: customer.code,
            name: customer.name,
            avatarText: customer.avatarText,
            phone: customer.phone,
            email: customer.email,
            point: Number(customer.point || 0),
            membershipTier: customer.membershipTier || '',
            createdAt: customer.createdAt ? new Date(customer.createdAt) : new Date(),
            birthDate: customer.birthDate,
            gender: customer.gender,
            totalOrders: Number(customer.totalOrders || 0),
            totalSpent: Number(customer.totalSpent || 0),
            averageRating: Number(customer.averageRating || 0),
            reviewCount: Number(customer.reviewCount || 0),
            latestOrderDate: customer.latestOrderDate || customer.createdAt
        };

        this.addresses = this.sortAddresses((response.addresses || []).map((address) => this.mapAddress(address)));

        this.orders = (response.orders || []).map((order) => ({
            id: order.id,
            code: order.code,
            createdAt: order.createdAt,
            total: Number(order.total || 0),
            paymentStatus: order.paymentStatus || 'Chờ thanh toán',
            status: order.status || 'Chờ xử lý'
        }));

        this.favoriteProducts = (response.favorites || []).map((product) => ({
            id: product.id,
            code: product.code,
            name: product.name,
            image: product.image || this.fallbackProductImage,
            price: Number(product.salePrice || product.price || 0),
            originalPrice: Number(product.originalPrice || product.price || 0),
            salePrice: Number(product.salePrice || 0),
        }));
        this.visibleFavoriteCount = 8;

        this.customer = {
            ...this.customer,
            totalOrders: this.orders.length || this.customer.totalOrders,
        };
    }

    private matchesOrderFilter(order: CustomerOrderItem): boolean {
        if (this.orderFilter === 'completed') return this.isCompletedOrder(order);
        if (this.orderFilter === 'pending') return this.isPendingOrder(order);
        if (this.orderFilter === 'cancelled') return this.isCancelledOrder(order);

        return true;
    }

    private isCompletedOrder(order: CustomerOrderItem): boolean {
        const key = this.normalizeText(order.status);
        return key.includes('hoan thanh') || key.includes('giao thanh cong') || key.includes('da giao');
    }

    private isPendingOrder(order: CustomerOrderItem): boolean {
        const key = this.normalizeText(order.status);
        return !this.isCompletedOrder(order) && !this.isCancelledOrder(order) && (
            key.includes('cho') ||
            key.includes('chuan bi') ||
            key.includes('van chuyen') ||
            key.includes('dang giao') ||
            key.includes('dang')
        );
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
