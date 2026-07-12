import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { PageHeader } from '../../components/page-header/page-header';
import { PageFooter } from '../../components/page-footer/page-footer';
import { CustomerService, Customer, CustomerAddress, CustomerOrder, CustomerVoucher, CustomerWishlistItem } from '../../services/customer.service';
import { CartService } from '../../services/cart.service';
import { Subscription } from 'rxjs';


// ===== INTERFACES =====
interface UserInfo {
  fullName: string;
  gender: string;
  email: string;
  birthDate: string;
  phone: string;
  avatar: string;
}

interface Order {
  id: string;
  date: string;
  createdAt: string;
  subtotal: number;
  total: number;
  status: string;
}

interface WishlistItem {
  id: string;
  name: string;
  price: number;
  oldPrice: number | null;
  discountPercent: number | null;
  image: string;
  isFavorite: boolean;
}

interface Address {
  id: string;
  label: string;
  isDefault: boolean;
  name: string;
  phone: string;
  detail: string;
  detailLine: string;
  provinceCode: string;
  provinceName: string;
  districtCode: string;
  districtName: string;
  wardCode: string;
  wardName: string;
}

interface Voucher {
  code: string;
  description: string;
  condition: string;
  expiry: string;
}

type MemberRank = 'Đồng' | 'Bạc' | 'Vàng' | 'Kim cương';

interface MemberRankConfig {
  name: MemberRank;
  minAmount: number;
  targetAmount: number;
  nextRank: MemberRank;
}

interface Province {
  code: string;
  name: string;
  districts: District[];
}

interface District {
  code: string;
  name: string;
  wards: Ward[];
}

interface Ward {
  code: string;
  name: string;
}

interface WardOption extends Ward {
  districtName: string;
}

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageFooter, PageHeader],
  templateUrl: './account.html',
  styleUrl: './account.css',
})
export class AccountComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cartStorageKey = 'tiemHoaYenCart';
  private sectionSubscription: Subscription | null = null;
  private accountRefreshIntervalId: number | null = null;
  private readonly refreshAccountData = (): void => {
    this.loadAccountData();
  };
  private readonly refreshAccountDataWhenVisible = (): void => {
    if (document.visibilityState === 'visible') {
      this.loadAccountData();
    }
  };

  constructor(
    private customerService: CustomerService,
    private cartService: CartService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}
  autoResizeTextarea(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  private normalizeOrderStatus(status: string): string {
    const value = String(status || '').trim().toLowerCase();

    if (value.includes('chờ thanh toán')) {
      return 'payment';
    }

    if (value.includes('thanh toán thất bại')) {
      return 'payment_failed';
    }

    if (value.includes('chờ xử lý')) {
      return 'created';
    }

    if (value.includes('đang chuẩn bị') || value.includes('chuẩn bị')) {
      return 'preparing';
    }

    if (value.includes('đang giao')) {
      return 'delivering';
    }

    if (value.includes('giao hàng thành công') || value.includes('hoàn thành')) {
      return 'delivered';
    }

    if (value.includes('hủy')) {
      return 'cancelled';
    }

    return value;
  }

  private isExpiredPaymentOrder(order: Order): boolean {
    const status = this.normalizeOrderStatus(order.status);

    if (status !== 'payment' && status !== 'payment_failed') {
      return false;
    }

    const createdTime = new Date(order.createdAt).getTime();

    if (Number.isNaN(createdTime)) {
      return false;
    }

    return Date.now() - createdTime >= 24 * 60 * 60 * 1000;
  }

  private calculateRewardValue(points: number): number {
    return Math.floor(Number(points || 0) / 2) * 1000;
  }

  getMemberRankByPoint(point: number): MemberRank {
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

  private getMemberRankByTier(tier: string): MemberRank {
    const value = String(tier || '').trim().toLowerCase();

    if (value.includes('kim')) {
      return 'Kim cương';
    }

    if (value.includes('vàng') || value.includes('vang')) {
      return 'Vàng';
    }

    if (value.includes('bạc') || value.includes('bac')) {
      return 'Bạc';
    }

    return 'Đồng';
  }

  canViewOrderDetail(order: Order): boolean {
    const status = this.normalizeOrderStatus(order.status);

    return status !== 'payment' && status !== 'payment_failed';
  }

  goToOrderDetail(order: Order): void {
    if (!this.canViewOrderDetail(order)) {
      return;
    }

    this.router.navigate(['/order-detail', order.id]);
  }
  // ===== ACTIVE SECTION =====
  activeSection = 'thongtin';

  // ===== TODO: replace with API call GET /api/user/profile =====
  userInfo: UserInfo = {
      fullName: '',
      gender: '',
      email: '',
      birthDate: '',
      phone: '',
      avatar: 'assets/images/account/default-avatar.png',
    };

  // ===== TODO: replace with API call GET /api/orders =====
  orders: Order[] = [];

  showAllOrders = false;

  get displayedOrders(): Order[] {
    return this.showAllOrders ? this.orders : this.orders.slice(0, 4);
  }

  get hasMoreOrders(): boolean {
    return this.orders.length > 4;
  }

  // ===== TODO: replace with API call GET /api/user/membership =====
  membershipTier = 'Kim cương';
  rewardPoints = 1250;
  rewardValue = this.calculateRewardValue(this.rewardPoints);
  readonly moneyPerPoint = 10000;
  readonly rankConfigs: MemberRankConfig[] = [
    { name: 'Đồng', minAmount: 0, targetAmount: 1000000, nextRank: 'Bạc' },
    { name: 'Bạc', minAmount: 1000000, targetAmount: 3000000, nextRank: 'Vàng' },
    { name: 'Vàng', minAmount: 3000000, targetAmount: 6000000, nextRank: 'Kim cương' },
    { name: 'Kim cương', minAmount: 6000000, targetAmount: 6000000, nextRank: 'Kim cương' },
  ];

  get memberRank(): MemberRank {
    return this.getMemberRankByTier(this.membershipTier);
  }

  get currentRankConfig(): MemberRankConfig {
    return this.rankConfigs.find(config => config.name === this.memberRank) ?? this.rankConfigs[0];
  }

  get memberTotalSpent(): number {
    return this.orders
      .filter(order => this.normalizeOrderStatus(order.status) === 'delivered')
      .reduce((sum, order) => sum + Number(order.subtotal || 0), 0);
  }

  get memberRankTargetAmount(): number {
    return this.currentRankConfig.targetAmount;
  }

  get memberProgressPercent(): number {
    if (this.memberRank === 'Kim cương') {
      return 100;
    }

    const percent = (this.memberTotalSpent / this.memberRankTargetAmount) * 100;

    return Math.min(Math.round(percent), 100);
  }

  get memberNextRankName(): MemberRank {
    return this.currentRankConfig.nextRank;
  }

  get memberNextRankAmount(): number {
    if (this.memberRank === 'Kim cương') {
      return 0;
    }

    return Math.max(this.memberRankTargetAmount - this.memberTotalSpent, 0);
  }

  get memberProgressTitle(): string {
    return `Tiến độ nâng hạng ${this.memberNextRankName}`;
  }

  get memberProgressAmountText(): string {
    if (this.memberRank === 'Kim cương') {
      return `${this.formatPrice(this.memberTotalSpent)} / ${this.formatPrice(this.currentRankConfig.targetAmount)}`;
    }

    return `${this.formatPrice(this.memberTotalSpent)} / ${this.formatPrice(this.memberRankTargetAmount)}`;
  }

  get memberRankFrame(): string {
    switch (this.memberRank) {
      case 'Đồng':
        return 'assets/images/bronze_frame.png';
      case 'Bạc':
        return 'assets/images/silver_frame.png';
      case 'Vàng':
        return 'assets/images/gold_frame.png';
      case 'Kim cương':
        return 'assets/images/diamond_frame.png';
      default:
        return 'assets/images/bronze_frame.png';
    }
  }

  // ===== TODO: replace with API call GET /api/user/wishlist =====
  wishlistItems: WishlistItem[] = [];
  showAllWishlist = false;

  // ===== TODO: replace with API call GET /api/user/addresses =====
  addresses: Address[] = [];

  currentAddressIndex = 0;

  get maxAddressStartIndex(): number {
    return Math.max(this.addresses.length - 3, 0);
  }

  get displayedAddresses(): Address[] {
    return this.addresses.slice(this.currentAddressIndex, this.currentAddressIndex + 3);
  }

  get canPrevAddress(): boolean {
    return this.currentAddressIndex > 0;
  }

  get canNextAddress(): boolean {
    return this.currentAddressIndex < this.maxAddressStartIndex;
  }
  get displayedWishlistItems(): WishlistItem[] {
    return this.showAllWishlist
      ? this.wishlistItems
      : this.wishlistItems.slice(0, 4);
  }

  // ===== TODO: replace with API call GET /api/user/vouchers =====
  vouchers: Voucher[] = [];

  showAllVouchers = false;

  get displayedVouchers(): Voucher[] {
    return this.showAllVouchers ? this.vouchers : this.vouchers.slice(0, 2);
  }

  get hasMoreVouchers(): boolean {
    return this.vouchers.length > 2;
  }

  // ===== MODAL SỬA HỒ SƠ =====
  showEditModal = false;

  editData = {
    fullName: '',
    phone: '',
    email: '',
    birthDate: '',
    gender: '',
  };

  // ===== MODAL THÊM/SỬA ĐỊA CHỈ =====
  showAddAddressModal = false;
  editingAddressId: string | null = null;

  provinces: Province[] = [];
  availableDistricts: District[] = [];
  availableWards: WardOption[] = [];

  newAddress = {
    fullName: '',
    phone: '',
    provinceCode: '',
    districtCode: '',
    wardCode: '',
    detail: '',
    isDefault: false,
  };

  // ===== DROPDOWN PROVINCE / DISTRICT / WARD =====
  selectedProvinceName = '';
  selectedDistrictName = '';
  selectedWardName = '';
  openAddressDropdown = '';
  addressDuplicateError = '';

  ngOnInit(): void {
      if (isPlatformBrowser(this.platformId)) {
        this.loadVietnamAddressData();
        this.loadAccountData();
        this.listenAccountSectionFromRoute();
        window.addEventListener('focus', this.refreshAccountData);
        window.addEventListener('cart-changed', this.refreshAccountData);
        document.addEventListener('visibilitychange', this.refreshAccountDataWhenVisible);
        this.accountRefreshIntervalId = window.setInterval(this.refreshAccountData, 30000);
      }
    }

  ngOnDestroy(): void {
    if (this.sectionSubscription) {
      this.sectionSubscription.unsubscribe();
      this.sectionSubscription = null;
    }

    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('focus', this.refreshAccountData);
      window.removeEventListener('cart-changed', this.refreshAccountData);
      document.removeEventListener('visibilitychange', this.refreshAccountDataWhenVisible);

      if (this.accountRefreshIntervalId !== null) {
        window.clearInterval(this.accountRefreshIntervalId);
        this.accountRefreshIntervalId = null;
      }
    }
  }

  private loadAccountData(): void {
    this.loadCustomerInfo();
    this.loadCustomerAddresses();
    this.loadCustomerOrders();
    this.loadCustomerVouchers();
    this.loadCustomerWishlist();
  }

  private listenAccountSectionFromRoute(): void {
    this.sectionSubscription = this.route.queryParamMap.subscribe(params => {
      const section = String(params.get('section') || '').trim();

      if (this.isValidAccountSection(section)) {
        this.setActiveSection(section);
        return;
      }

      const fragment = String(this.route.snapshot.fragment || '').trim();

      if (this.isValidAccountSection(fragment)) {
        this.setActiveSection(fragment);
      }
    });
  }

  private isValidAccountSection(section: string): boolean {
    return [
      'thongtin',
      'donhang',
      'wishlist',
      'diachi',
      'voucher',
      'diem',
      'hang',
    ].includes(section);
  }

    loadCustomerInfo(): void {
      const saved = localStorage.getItem('khachHang');
      if (!saved) {
        // Chưa đăng nhập -> quay về trang login
        this.router.navigate(['/login']);
        return;
      }

      const khachHang = JSON.parse(saved);

      this.customerService.getById(khachHang.KHACH_HANG_ID).subscribe({
        next: (data: Customer) => {
          this.userInfo = {
            fullName: data.TEN || '',
            gender: data.GIOI_TINH || '',
            email: data.EMAIL || '',
            birthDate: data.DOB ? this.toDisplayDate(data.DOB.split('T')[0]) : '',
            phone: data.SDT || '',
            avatar: data.AVATAR ||  'assets/images/account/default-avatar.png',
          };

          this.membershipTier = data.LOAI_THANH_VIEN || '';
          this.rewardPoints = data.DIEM_TICH_LUY || 0;
          this.rewardValue = this.calculateRewardValue(this.rewardPoints);

          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error('Lỗi load thông tin khách hàng:', err);
        }
      });
    }
  loadCustomerAddresses(): void {
    const saved = localStorage.getItem('khachHang');

    if (!saved) {
      this.router.navigate(['/login']);
      return;
    }

    const khachHang = JSON.parse(saved);

    this.customerService.getAddresses(khachHang.KHACH_HANG_ID).subscribe({
      next: (data: CustomerAddress[]) => {
        this.addresses = data.map((item, index) => ({
          id: item.DIA_CHI_ID,
          label: `Địa chỉ ${index + 1}`,
          isDefault: item.LA_MAC_DINH,
          name: item.TEN_NGUOI_NHAN || '',
          phone: item.SDT_NGUOI_NHAN || '',
          detail: `${item.DIA_CHI_CHI_TIET}, ${item.PHUONG_XA}, ${item.QUAN_HUYEN}, ${item.TINH_THANH}`,
          detailLine: item.DIA_CHI_CHI_TIET || '',
          provinceCode: '',
          provinceName: item.TINH_THANH || '',
          districtCode: '',
          districtName: item.QUAN_HUYEN || '',
          wardCode: '',
          wardName: item.PHUONG_XA || '',
        }));

        this.currentAddressIndex = 0;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi load địa chỉ:', err);
      }
    });
  }
  loadCustomerOrders(): void {
    const saved = localStorage.getItem('khachHang');

    if (!saved) {
      this.router.navigate(['/login']);
      return;
    }

    const khachHang = JSON.parse(saved);

    this.customerService.getOrders(khachHang.KHACH_HANG_ID).subscribe({
      next: (data: CustomerOrder[]) => {
        this.orders = data
          .map(item => ({
            id: item.DON_HANG_ID,
            date: item.NGAY_TAO ? this.toDisplayDate(item.NGAY_TAO.split('T')[0]) : '',
            createdAt: item.NGAY_TAO || '',
            subtotal: Number(item.TAM_TINH || 0),
            total: item.TONG_TIEN || 0,
            status: item.TRANG_THAI as Order['status'],
          }))
          .filter(order => !this.isExpiredPaymentOrder(order));

        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi load đơn hàng:', err);
      }
    });
  }
  loadCustomerVouchers(): void {
    const saved = localStorage.getItem('khachHang');

    if (!saved) {
      this.router.navigate(['/login']);
      return;
    }

    const khachHang = JSON.parse(saved);

    this.customerService.getVouchers(khachHang.KHACH_HANG_ID).subscribe({
      next: (data: CustomerVoucher[]) => {
        this.vouchers = data.map(item => {
          const value = Number(item.GIA_TRI_GIAM || 0);

          return {
            code: item.MA_VOUCHER,
            description:
              item.LOAI_GIAM_GIA === 'Phần trăm'
                ? `Giảm ${value}% đơn hàng`
                : `Giảm ${value.toLocaleString('vi-VN')}đ đơn hàng`,
            condition: 'Áp dụng cho tài khoản của bạn',
            expiry: item.NGAY_KET_THUC
              ? this.toDisplayDate(item.NGAY_KET_THUC.split('T')[0])
              : '',
          };
        });

        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi load voucher:', err);
      }
    });
  }
  loadCustomerWishlist(): void {
    const saved = localStorage.getItem('khachHang');

    if (!saved) {
      this.router.navigate(['/login']);
      return;
    }

    const khachHang = JSON.parse(saved);

    this.customerService.getWishlist(khachHang.KHACH_HANG_ID).subscribe({
      next: (data: CustomerWishlistItem[]) => {
        this.wishlistItems = data.map(item => {
          const originalPrice = Number(item.GIA || 0);
          const salePrice = Number(item.GIA_KHUYEN_MAI || 0);
          const hasSalePrice = salePrice > 0 && salePrice < originalPrice;
          const finalPrice = hasSalePrice ? salePrice : originalPrice;
          const discountPercent =
            hasSalePrice && originalPrice > 0
              ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
              : null;

          return {
            id: item.SAN_PHAM_ID,
            name: item.TEN_SAN_PHAM || '',
            price: finalPrice,
            oldPrice: hasSalePrice ? originalPrice : null,
            discountPercent,
            image: String(item.TEN_SAN_PHAM || '').trim().toLocaleLowerCase('vi-VN') === 'túi quà cao cấp'
              ? 'assets/images/tui-qua-cao-cap.png'
              : item.HINH_ANH || 'assets/images/product-default.png',
            isFavorite: true,
          };
        });

        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi load wishlist:', err);
      }
    });
  }
  onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];

    const saved = localStorage.getItem('khachHang');
    if (!saved) {
      this.router.navigate(['/login']);
      return;
    }

    const khachHang = JSON.parse(saved);

    this.customerService.updateAvatar(khachHang.KHACH_HANG_ID, file).subscribe({
      next: (res) => {
        const updated = res.customer;

        this.userInfo.avatar = updated.AVATAR || '';
        localStorage.setItem('khachHang', JSON.stringify(updated));

        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi upload avatar:', err);
      }
    });
  }
  removeAvatar(): void {
    const saved = localStorage.getItem('khachHang');

    if (!saved) {
      this.router.navigate(['/login']);
      return;
    }

    const khachHang = JSON.parse(saved);

    this.customerService.removeAvatar(khachHang.KHACH_HANG_ID).subscribe({
      next: (res) => {
        const updated = res.customer;

        this.userInfo.avatar = 'assets/images/account/default-avatar.png';
        localStorage.setItem('khachHang', JSON.stringify(updated));

        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi gỡ avatar:', err);
      }
    });
  }
  get hasProfileChanged(): boolean {
    return (
      this.editData.fullName !== this.userInfo.fullName ||
      this.normalizePhone(this.editData.phone) !== this.normalizePhone(this.userInfo.phone) ||
      this.editData.email !== this.userInfo.email ||
      this.editData.birthDate !== this.userInfo.birthDate ||
      this.editData.gender !== this.userInfo.gender
    );
  }

  openEditModal(): void {
    this.editData = {
      fullName: this.userInfo.fullName,
      phone: this.formatPhoneInput(this.userInfo.phone),
      email: this.userInfo.email,
      birthDate: this.toDisplayDate(this.userInfo.birthDate),
      gender: this.userInfo.gender,
    };

    this.showEditModal = true;
  }

  closeModal(): void {
    this.showEditModal = false;
  }

  closeEditModal(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    if (target.classList.contains('modal-overlay')) {
      this.showEditModal = false;
    }
  }

  saveProfile(form: NgForm): void {
    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }

    if (!this.hasProfileChanged) {
      this.showEditModal = false;
      return;
    }

    const saved = localStorage.getItem('khachHang');

    if (!saved) {
      this.router.navigate(['/login']);
      return;
    }

    const khachHang = JSON.parse(saved);

    const payload = {
      TEN: this.editData.fullName,
      EMAIL: this.editData.email,
      SDT: this.normalizePhone(this.editData.phone),
      DOB: this.toIsoDate(this.editData.birthDate) || null,
      GIOI_TINH: this.editData.gender,
    };

    this.customerService.updateById(khachHang.KHACH_HANG_ID, payload).subscribe({
      next: (res) => {
        const updated = res.customer;

        this.userInfo = {
          fullName: updated.TEN || '',
          gender: updated.GIOI_TINH || '',
          email: updated.EMAIL || '',
          birthDate: updated.DOB ? this.toDisplayDate(updated.DOB.split('T')[0]) : '',
          phone: updated.SDT || '',
          avatar: updated.AVATAR || 'assets/images/account/default-avatar.png',
        };

        localStorage.setItem('khachHang', JSON.stringify(updated));

        this.showEditModal = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi cập nhật thông tin:', err);
      }
    });
  }
  // ===== ADD ADDRESS MODAL METHODS =====
  loadVietnamAddressData(): void {
    fetch('/assets/address/vietnam-address-old.json')
      .then(response => {
        if (!response.ok) {
          throw new Error(`Không tìm thấy file JSON: ${response.status}`);
        }

        return response.json();
      })
      .then((data: Province[]) => {
        this.provinces = data;
        console.log('Dữ liệu tỉnh:', this.provinces);
      })
      .catch(error => {
        console.error('Không tải được dữ liệu địa chỉ:', error);
      });
  }

  get addressModalTitle(): string {
    return this.editingAddressId !== null ? 'Sửa địa chỉ' : 'Địa chỉ nhận hàng';
  }

  openAddAddressModal(): void {
    this.editingAddressId = null;
    this.resetNewAddressForm();
    this.showAddAddressModal = true;
  }

  openEditAddressModal(address: Address): void {
    this.editingAddressId = address.id;
    this.addressDuplicateError = '';

    this.newAddress = {
      fullName: address.name,
      phone: this.formatPhoneInput(address.phone),
      provinceCode: address.provinceCode || address.provinceName,
      districtCode: address.districtCode || address.districtName,
      wardCode: address.wardCode || address.wardName,
      detail: address.detailLine,
      isDefault: address.isDefault,
    };

    this.selectedProvinceName = address.provinceName;
    this.selectedDistrictName = address.districtName;
    this.selectedWardName = address.wardName;
    this.openAddressDropdown = '';

    const selectedProvince = this.provinces.find(
      province =>
        province.code === address.provinceCode ||
        province.name === address.provinceName
    );
    this.availableDistricts = selectedProvince ? selectedProvince.districts : [];

    const selectedDistrict = this.availableDistricts.find(
      district =>
        district.code === address.districtCode ||
        district.name === address.districtName
    );
    this.availableWards = selectedDistrict
      ? selectedDistrict.wards.map(ward => ({ ...ward, districtName: selectedDistrict.name }))
      : [];

    this.showAddAddressModal = true;
  }

  closeAddAddressModal(): void {
    this.showAddAddressModal = false;
    this.editingAddressId = null;
    this.openAddressDropdown = '';
    this.addressDuplicateError = '';
  }

  closeAddAddressModalByOverlay(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    if (target.classList.contains('modal-overlay')) {
      this.showAddAddressModal = false;
      this.editingAddressId = null;
      this.openAddressDropdown = '';
      this.addressDuplicateError = '';
    }
  }

  resetNewAddressForm(): void {
    this.newAddress = {
      fullName: '',
      phone: '',
      provinceCode: '',
      districtCode: '',
      wardCode: '',
      detail: '',
      isDefault: false,
    };

    this.selectedProvinceName = '';
    this.selectedDistrictName = '';
    this.selectedWardName = '';
    this.openAddressDropdown = '';
    this.addressDuplicateError = '';

    this.availableDistricts = [];
    this.availableWards = [];
  }

  onNewAddressPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.newAddress.phone = this.formatPhoneInput(input.value);
    this.clearAddressDuplicateError();
  }

  selectProvince(province: Province): void {
    this.selectedProvinceName = province.name;
    this.newAddress.provinceCode = province.code;
    this.openAddressDropdown = '';
    this.clearAddressDuplicateError();

    // Reset district + ward khi đổi tỉnh
    this.selectedDistrictName = '';
    this.selectedWardName = '';
    this.newAddress.districtCode = '';
    this.newAddress.wardCode = '';
    this.availableDistricts = province.districts;
    this.availableWards = [];
  }

  toggleAddressDropdown(type: string, disabled: boolean): void {
    if (disabled) {
      return;
    }
    this.openAddressDropdown = this.openAddressDropdown === type ? '' : type;
  }

  selectDistrict(district: District): void {
    this.selectedDistrictName = district.name;
    this.newAddress.districtCode = district.code;
    this.openAddressDropdown = '';
    this.clearAddressDuplicateError();
    // Reset ward khi đổi district
    this.selectedWardName = '';
    this.newAddress.wardCode = '';
    this.availableWards = district.wards.map(ward => ({
      ...ward,
      districtName: district.name,
    }));
  }

  selectWard(ward: WardOption): void {
    this.selectedWardName = ward.name;
    this.newAddress.wardCode = ward.code;
    this.openAddressDropdown = '';
    this.clearAddressDuplicateError();
  }

  clearAddressDuplicateError(): void {
    this.addressDuplicateError = '';
  }

  private normalizeAddressValue(value: string): string {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private isDuplicateAddress(provinceName: string, districtName: string, wardName: string): boolean {
    const submittedName = this.normalizeAddressValue(this.newAddress.fullName);
    const submittedPhone = this.normalizePhone(this.newAddress.phone);
    const submittedProvince = this.normalizeAddressValue(provinceName);
    const submittedDistrict = this.normalizeAddressValue(districtName);
    const submittedWard = this.normalizeAddressValue(wardName);
    const submittedDetail = this.normalizeAddressValue(this.newAddress.detail);

    return this.addresses.some(address => {
      if (this.editingAddressId !== null && address.id === this.editingAddressId) {
        return false;
      }

      return (
        this.normalizeAddressValue(address.name) === submittedName &&
        this.normalizePhone(address.phone) === submittedPhone &&
        this.normalizeAddressValue(address.provinceName) === submittedProvince &&
        this.normalizeAddressValue(address.districtName) === submittedDistrict &&
        this.normalizeAddressValue(address.wardName) === submittedWard &&
        this.normalizeAddressValue(address.detailLine) === submittedDetail
      );
    });
  }

  saveNewAddress(form: NgForm): void {
    this.addressDuplicateError = '';

    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }

    const selectedProvince = this.provinces.find(
      province => province.code === this.newAddress.provinceCode
    );

    const selectedDistrict = this.availableDistricts.find(
      district => district.code === this.newAddress.districtCode
    );

    const selectedWard = this.availableWards.find(
      ward => ward.code === this.newAddress.wardCode
    );

    const provinceName = selectedProvince?.name || this.selectedProvinceName;
    const districtName = selectedDistrict?.name || this.selectedDistrictName;
    const wardName = selectedWard?.name || this.selectedWardName;

    if (!provinceName || !districtName || !wardName) {
      return;
    }

    if (this.isDuplicateAddress(provinceName, districtName, wardName)) {
      this.addressDuplicateError = 'Địa chỉ này đã tồn tại.';
      return;
    }

    if (this.newAddress.isDefault) {
      this.addresses = this.addresses.map(address => ({
        ...address,
        isDefault: false,
      }));
    }

    if (this.editingAddressId !== null) {
      this.customerService.updateAddress(
        this.editingAddressId,
        {
          TEN_NGUOI_NHAN: this.newAddress.fullName,
          SDT_NGUOI_NHAN: this.normalizePhone(this.newAddress.phone),
          TINH_THANH: provinceName,
          QUAN_HUYEN: districtName,
          PHUONG_XA: wardName,
          DIA_CHI_CHI_TIET: this.newAddress.detail,
          LA_MAC_DINH: this.newAddress.isDefault
        }
      ).subscribe({
        next: () => {
          this.loadCustomerAddresses();
          this.editingAddressId = null;
          this.showAddAddressModal = false;
        },
        error: (err) => {
          console.error('Lỗi sửa địa chỉ:', err);
          if (err?.status === 409) {
            this.addressDuplicateError = err?.error?.message || 'Địa chỉ này đã tồn tại.';
          }
        }
      });

      return;
    } else {
      // ===== CHẾ ĐỘ THÊM ĐỊA CHỈ MỚI XUỐNG SQL =====
      const saved = localStorage.getItem('khachHang');

      if (!saved) {
        this.router.navigate(['/login']);
        return;
      }

      const khachHang = JSON.parse(saved);

      this.customerService.addAddress(
        khachHang.KHACH_HANG_ID,
        {
          TEN_NGUOI_NHAN: this.newAddress.fullName,
          SDT_NGUOI_NHAN: this.normalizePhone(this.newAddress.phone),
          TINH_THANH: provinceName,
          QUAN_HUYEN: districtName,
          PHUONG_XA: wardName,
          DIA_CHI_CHI_TIET: this.newAddress.detail,
          LA_MAC_DINH: this.newAddress.isDefault
        }
      ).subscribe({
        next: () => {
          this.loadCustomerAddresses();
          this.editingAddressId = null;
          this.showAddAddressModal = false;
        },
        error: (err) => {
          console.error('Lỗi thêm địa chỉ:', err);
          if (err?.status === 409) {
            this.addressDuplicateError = err?.error?.message || 'Địa chỉ này đã tồn tại.';
          }
        }
      });

      return;
    }

    this.editingAddressId = null;
    this.showAddAddressModal = false;
  }

  // ===== DATE HELPERS =====
  toDisplayDate(date: string): string {
    if (!date) return '';

    if (date.includes('/')) {
      return date;
    }

    const [year, month, day] = date.split('-');

    if (!year || !month || !day) {
      return date;
    }

    return `${day}/${month}/${year}`;
  }

  toIsoDate(date: string): string {
    if (!date) return '';

    if (date.includes('-')) {
      return date;
    }

    const [day, month, year] = date.split('/');

    if (!day || !month || !year) {
      return '';
    }

    return `${year}-${month}-${day}`;
  }

  onBirthDatePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.editData.birthDate = this.toDisplayDate(input.value);
  }

  formatBirthDate(date: string): string {
    return this.toDisplayDate(date);
  }

  // ===== METHODS =====
  private getStickyHeaderOffset(): number {
    const selectors = ['.header', '.menu', '.mobile-header'];
    const fixedBottom = selectors.reduce((bottom, selector) => {
      const element = document.querySelector(selector) as HTMLElement | null;

      if (!element) {
        return bottom;
      }

      const styles = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const isPinned =
        (styles.position === 'fixed' || styles.position === 'sticky') &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top <= rect.height + 1;

      return isPinned ? Math.max(bottom, rect.bottom) : bottom;
    }, 0);

    return fixedBottom + 44;
  }

  setActiveSection(section: string): void {
    this.activeSection = section;

    const sectionMap: Record<string, string> = {
      thongtin: 'thongtin',
      donhang: 'donhang',
      wishlist: 'wishlist',
      diachi: 'diachi',
      voucher: 'voucher',
      diem: 'member-reward',
      hang: 'member-reward',
    };

    setTimeout(() => {
      const targetId = sectionMap[section];
      const target = document.getElementById(targetId);

      if (target) {
        const headerOffset = this.getStickyHeaderOffset();
        const targetPosition = target.getBoundingClientRect().top + window.scrollY;
        const scrollPosition = targetPosition - headerOffset;

        window.scrollTo({
          top: scrollPosition,
          behavior: 'smooth',
        });
      }
    }, 0);
  }

  getStatusClass(status: string): string {
    const value = String(status || '').trim().toLowerCase();
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd');

    if (normalized.includes('huy')) {
      return 'status-cancelled';
    }

    if (normalized.includes('hoan thanh') || normalized.includes('thanh cong')) {
      return 'status-done';
    }

    if (normalized.includes('dang chuan bi') || normalized.includes('chuan bi')) {
      return 'status-preparing';
    }

    if (normalized.includes('dang giao')) {
      return 'status-shipping';
    }

    if (normalized.includes('xu ly') || normalized.includes('cho')) {
      return 'status-processing';
    }

    return 'status-default';
  }

  formatPrice(price: number): string {
    return price.toLocaleString('vi-VN') + 'đ';
  }

  formatPhoneInput(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 10);

    if (digits.length <= 4) {
      return digits;
    }

    if (digits.length <= 7) {
      return `${digits.slice(0, 4)} ${digits.slice(4)}`;
    }

    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }

  onPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.editData.phone = this.formatPhoneInput(input.value);
  }

  normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  toggleFavorite(item: WishlistItem): void {

    const saved = localStorage.getItem('khachHang');

    if (!saved) {
      this.router.navigate(['/login']);
      return;
    }

    const khachHang = JSON.parse(saved);

    this.customerService
      .removeWishlistItem(
        khachHang.KHACH_HANG_ID,
        item.id
      )
      .subscribe({
        next: () => {

          this.wishlistItems =
            this.wishlistItems.filter(
              p => p.id !== item.id
            );

          this.cdr.detectChanges();
        },

        error: (err) => {
          console.error(err);
        }
      });
  }

  buyWishlistItem(item: WishlistItem): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(
        'tiemHoaYenCheckoutItems',
        JSON.stringify([
          {
            id: item.id,
            name: item.name,
            style: 'Wishlist',
            occasion: 'Sản phẩm yêu thích',
            price: item.price,
            originalPrice: item.oldPrice,
            quantity: 1,
            image: item.image,
            selected: true,
          },
        ])
      );
    }

    this.router.navigate(['/order-registrant']).then(() => {
      if (isPlatformBrowser(this.platformId)) {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
    });
  }

  addToCart(item: WishlistItem, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();

    if (!this.isBrowser()) {
      return;
    }

    this.playFlyToCartEffect(event);

    const customerId = this.getCustomerId();

    if (customerId && String(item.id).startsWith('SP')) {
      this.cartService.addItem(customerId, item.id, 1).subscribe({
        next: () => {
          this.dispatchCartChanged();
        },
        error: (err) => {
          console.error('Lỗi thêm sản phẩm wishlist vào giỏ hàng:', err);
        }
      });

      return;
    }

    this.saveWishlistItemToGuestCart(item);
  }

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId) && typeof window !== 'undefined';
  }

  private getLoggedInCustomer(): any | null {
    if (!this.isBrowser()) {
      return null;
    }

    const rawCustomer = localStorage.getItem('khachHang');

    if (!rawCustomer || rawCustomer === 'null' || rawCustomer === 'undefined') {
      return null;
    }

    try {
      const customer = JSON.parse(rawCustomer);
      return customer?.KHACH_HANG_ID ? customer : null;
    } catch {
      return null;
    }
  }

  private getCustomerId(): string {
    const customer = this.getLoggedInCustomer();
    return customer?.KHACH_HANG_ID ? String(customer.KHACH_HANG_ID) : '';
  }

  private createWishlistCartItem(item: WishlistItem) {
    return {
      id: item.id,
      name: item.name,
      style: 'Wishlist',
      occasion: 'Sản phẩm yêu thích',
      price: item.price,
      originalPrice: item.oldPrice,
      quantity: 1,
      image: item.image,
      selected: true
    };
  }

  private getCartFromStorage(): any[] {
    const rawCart = localStorage.getItem(this.cartStorageKey);

    if (!rawCart) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawCart);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveWishlistItemToGuestCart(item: WishlistItem): void {
    const cart = this.getCartFromStorage();
    const cartItem = this.createWishlistCartItem(item);
    const existingItem = cart.find((cartEntry: any) => String(cartEntry?.id || '') === item.id);

    if (existingItem) {
      existingItem.quantity = Number(existingItem.quantity || 1) + 1;
      existingItem.name = cartItem.name;
      existingItem.style = cartItem.style;
      existingItem.occasion = cartItem.occasion;
      existingItem.price = cartItem.price;
      existingItem.originalPrice = cartItem.originalPrice;
      existingItem.image = cartItem.image;
      existingItem.selected = true;
    } else {
      cart.push(cartItem);
    }

    localStorage.setItem(this.cartStorageKey, JSON.stringify(cart));
    this.dispatchCartChanged();
  }

  private dispatchCartChanged(): void {
    if (!this.isBrowser()) {
      return;
    }

    window.dispatchEvent(new Event('cart-changed'));
  }

  private playFlyToCartEffect(event?: Event): void {
    if (!this.isBrowser() || !event) {
      return;
    }

    const targetEl = event.target as HTMLElement | null;
    const button = targetEl?.closest<HTMLButtonElement>('.btn-cart');
    const card = targetEl?.closest('.product-card');
    const sourceImg = card?.querySelector('.product-card-media img') as HTMLImageElement | null;

    button?.classList.add('is-cart-added');
    window.setTimeout(() => button?.classList.remove('is-cart-added'), 520);

    if (!sourceImg) {
      return;
    }

    const cartIcon = document.querySelector<HTMLElement>(
      '.navbar-cart-icon, #navbar-cart-icon, .cart-icon, [data-cart-icon], a[routerLink*="cart"] i, a[routerLink*="gio-hang"] i'
    );

    const startRect = sourceImg.getBoundingClientRect();
    const endRect = cartIcon?.getBoundingClientRect();

    const endX = endRect ? endRect.left + endRect.width / 2 : window.innerWidth - 32;
    const endY = endRect ? endRect.top + endRect.height / 2 : 28;

    const flyer = sourceImg.cloneNode(true) as HTMLImageElement;
    flyer.style.position = 'fixed';
    flyer.style.left = `${startRect.left}px`;
    flyer.style.top = `${startRect.top}px`;
    flyer.style.width = `${startRect.width}px`;
    flyer.style.height = `${startRect.height}px`;
    flyer.style.margin = '0';
    flyer.style.borderRadius = '12px';
    flyer.style.objectFit = 'cover';
    flyer.style.zIndex = '9999';
    flyer.style.pointerEvents = 'none';
    flyer.style.boxShadow = '0 10px 24px rgba(115, 25, 25, .35)';
    flyer.style.willChange = 'transform, opacity';

    document.body.appendChild(flyer);

    const startCenterX = startRect.left + startRect.width / 2;
    const startCenterY = startRect.top + startRect.height / 2;
    const deltaX = endX - startCenterX;
    const deltaY = endY - startCenterY;

    const animation = flyer.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
        {
          transform: `translate(${deltaX * 0.5}px, ${deltaY * 0.5 - 70}px) scale(.65)`,
          opacity: 1,
          offset: 0.55
        },
        { transform: `translate(${deltaX}px, ${deltaY}px) scale(.08)`, opacity: .3, offset: 1 }
      ],
      { duration: 700, easing: 'cubic-bezier(.4,.1,.25,1)' }
    );

    animation.onfinish = () => {
      flyer.remove();

      if (cartIcon) {
        cartIcon.animate(
          [
            { transform: 'scale(1)' },
            { transform: 'scale(1.35)' },
            { transform: 'scale(.92)' },
            { transform: 'scale(1)' }
          ],
          { duration: 420, easing: 'ease-out' }
        );
      }
    };
  }

  prevAddress(): void {
    if (!this.canPrevAddress) return;

    this.currentAddressIndex--;
  }

  nextAddress(): void {
    if (!this.canNextAddress) return;

    this.currentAddressIndex++;
  }

  setDefaultAddress(id: string): void {
    this.customerService.setDefaultAddress(id).subscribe({
      next: () => {
        this.loadCustomerAddresses();
      },
      error: (err) => {
        console.error('Lỗi đặt mặc định:', err);
      }
    });
  }

  deleteAddress(id: string): void {
    this.customerService.deleteAddress(id).subscribe({
      next: () => {
        this.loadCustomerAddresses();
      },
      error: (err) => {
        console.error('Lỗi xóa địa chỉ:', err);
      }
    });
  }

  useVoucher(_code: string): void {
    this.router.navigate(['/cart']).then(() => {
      if (isPlatformBrowser(this.platformId)) {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
    });
  }

  logout(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('khachHang');
      localStorage.removeItem('token');

      localStorage.removeItem('tiemHoaYenRegistrantOrder');
      localStorage.removeItem('tiemHoaYenGuestOrder');
      localStorage.removeItem('tiemHoaYenCreatedOrder');
      localStorage.removeItem('tiemHoaYenCheckoutItems');

      window.dispatchEvent(new Event('auth-changed'));
      window.dispatchEvent(new Event('cart-changed'));
    }

    this.router.navigate(['/login']);
  }

  redeemPoints(): void {
    this.router.navigate(['/cart']).then(() => {
      if (isPlatformBrowser(this.platformId)) {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
    });
  }
  toggleWishlistView(): void {
    this.showAllWishlist = !this.showAllWishlist;
  }
}
