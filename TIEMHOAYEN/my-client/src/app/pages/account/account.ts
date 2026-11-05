import { MarketingPreferences } from '../../components/marketing-preferences/marketing-preferences';
import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { PageHeader } from '../../components/page-header/page-header';
import { PageFooter } from '../../components/page-footer/page-footer';
import { CustomerService, Customer, CustomerAddress, CustomerOrder, CustomerVoucher, CustomerWishlistItem } from '../../services/customer.service';
import { CartService } from '../../services/cart.service';
import { endSession } from '../../services/session-auth';
import { Subscription } from 'rxjs';
import { AccountChangePassword } from './change-password/change-password';
import { ACCOUNT_SECTIONS, AccountSection, DEFAULT_ACCOUNT_SECTION, resolveAccountSection } from './account-sections';


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
  reviewLabel: string;
}

interface WishlistItem {
  id: string;
  name: string;
  price: number;
  oldPrice: number | null;
  discountPercent: number | null;
  image: string;
  isFavorite: boolean;
  status: string;
  canPurchase: boolean;
  linkAvailable: boolean;
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
  imports: [CommonModule, FormsModule, RouterLink, PageFooter, PageHeader, MarketingPreferences, AccountChangePassword],
  templateUrl: './account.html',
  styleUrls: ['./account.css', './account-sections.css'],
})
export class AccountComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cartStorageKey = 'tiemHoaYenCart';
  private readonly wishlistChangedHandler = (event: Event) => {
    const detail = (event as CustomEvent<{ favorite?: boolean }>).detail;
    if (detail?.favorite !== false) this.loadCustomerWishlist(1);
  };
  private sectionSubscription: Subscription | null = null;

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

    if (value.includes('giao hàng thành công') || value.includes('hoàn thành') || value.includes('đã giao')) {
      return 'delivered';
    }

    if (value.includes('hủy')) {
      return 'cancelled';
    }

    if (value.includes('trả hàng') || value.includes('hoàn tiền')) {
      return 'returned';
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

  /** Đơn chưa thanh toán xong / thanh toán thất bại: cho khách thanh toán lại thay vì tạo đơn mới. */
  needsPayment(order: Order): boolean {
    const status = this.normalizeOrderStatus(order.status);

    return status === 'payment' || status === 'payment_failed';
  }

  canViewOrderDetail(order: Order): boolean {
    return !this.needsPayment(order);
  }

  /** Trang chi tiết đơn đã có nút thanh toán lại (PUT /orders/:id/payment-retry). */
  goToOrderDetail(order: Order): void {
    if (!order?.id) {
      return;
    }

    this.router.navigate(['/order-detail', order.id]);
  }

  // ===== ACTIVE SECTION (KH19: mỗi mục là một URL /account/<mục>) =====
  readonly accountSections = ACCOUNT_SECTIONS;
  activeSection: AccountSection = DEFAULT_ACCOUNT_SECTION;
  private loadedAccountSections = new Set<string>();
  ordersLoaded = false;
  ordersLoadError = '';

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
  readonly ordersPreviewSize = 10;

  /** Lịch sử = đơn đã kết thúc (đã giao/hoàn thành, đã hủy, trả hàng/hoàn tiền). */
  private isFinishedOrder(order: Order): boolean {
    return ['delivered', 'cancelled', 'returned'].includes(this.normalizeOrderStatus(order.status));
  }

  /** "Đơn hàng của tôi": đơn đang xử lý hoặc chờ thanh toán. */
  get activeOrders(): Order[] {
    return this.orders.filter(order => !this.isFinishedOrder(order));
  }

  get historyOrders(): Order[] {
    return this.orders.filter(order => this.isFinishedOrder(order));
  }

  get currentOrderList(): Order[] {
    return this.activeSection === 'order-history' ? this.historyOrders : this.activeOrders;
  }

  get displayedOrders(): Order[] {
    const list = this.currentOrderList;
    return this.showAllOrders ? list : list.slice(0, this.ordersPreviewSize);
  }

  get hasMoreOrders(): boolean {
    return this.currentOrderList.length > this.ordersPreviewSize;
  }

  // ===== TODO: replace with API call GET /api/user/membership =====
  membershipTier = 'Đồng';
  rewardPoints = 0;
  rewardValue = 0;
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
  showAllWishlist = true;
  wishlistPage = 1;
  wishlistTotalPages = 1;
  wishlistTotal = 0;
  readonly wishlistPageSize = 12;

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
    return this.wishlistItems;
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

  readonly genderOptions = ['Nam', 'Nữ', 'Khác'];
  savingProfile = false;
  profileError = '';
  profileFieldErrors: { fullName?: string; birthDate?: string; gender?: string } = {};

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
        window.addEventListener('wishlist-changed', this.wishlistChangedHandler);
        this.restoreAccountSnapshot();
        this.loadVietnamAddressData();
        this.loadAccountData();
        this.listenAccountSectionFromRoute();
      }
    }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('wishlist-changed', this.wishlistChangedHandler);
    }

    if (this.sectionSubscription) {
      this.sectionSubscription.unsubscribe();
      this.sectionSubscription = null;
    }

  }

  private restoreAccountSnapshot(): void {
    const saved = localStorage.getItem('khachHang');
    if (!saved || saved === 'null' || saved === 'undefined') return;

    try {
      const customer = JSON.parse(saved);
      this.userInfo = {
        fullName: customer.TEN || '',
        gender: customer.GIOI_TINH || '',
        email: customer.EMAIL || '',
        birthDate: customer.DOB ? this.toDisplayDate(String(customer.DOB).split('T')[0]) : '',
        phone: customer.SDT || '',
        avatar: customer.AVATAR || 'assets/images/account/default-avatar.png',
      };
      this.membershipTier = customer.LOAI_THANH_VIEN || '';
      this.rewardPoints = Number(customer.DIEM_TICH_LUY || 0);
      this.rewardValue = this.calculateRewardValue(this.rewardPoints);
    } catch {
      // Dữ liệu cũ không hợp lệ sẽ được API cập nhật lại.
    }
  }

  private loadAccountData(): void {
    // Hồ sơ luôn cần (tên, hạng, điểm); các mục khác tải khi được mở.
    this.loadCustomerInfo();
  }

  /** Tải dữ liệu của mục đang mở (mỗi nhóm dữ liệu chỉ tải một lần). */
  private loadAccountSection(section: AccountSection): void {
    const dataKey =
      section === 'orders' || section === 'order-history' || section === 'points' ? 'orders'
      : section === 'vouchers' ? 'vouchers'
      : section === 'wishlist' ? 'wishlist'
      : section === 'addresses' ? 'addresses'
      : '';
    if (!dataKey || this.loadedAccountSections.has(dataKey)) return;
    this.loadedAccountSections.add(dataKey);
    if (dataKey === 'orders') this.loadCustomerOrders();
    if (dataKey === 'vouchers') this.loadCustomerVouchers();
    if (dataKey === 'wishlist') this.loadCustomerWishlist();
    if (dataKey === 'addresses') this.loadCustomerAddresses();
  }

  /** /account/:section → mục đang mở. Tên mục cũ (diem, hang, donhang…) được đổi sang URL mới. */
  private listenAccountSectionFromRoute(): void {
    this.sectionSubscription = this.route.paramMap.subscribe(params => {
      const raw = String(params.get('section') || '');
      const section = resolveAccountSection(raw) ?? DEFAULT_ACCOUNT_SECTION;

      if (raw !== section) {
        this.router.navigate(['/account', section], { replaceUrl: true });
        return;
      }

      if (this.activeSection !== section) this.showAllOrders = false;
      this.activeSection = section;
      this.loadAccountSection(section);
      this.cdr.detectChanges();
    });
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

          localStorage.setItem('khachHang', JSON.stringify({ ...khachHang, ...data }));

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
        this.loadedAccountSections.delete('addresses');
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
        this.ordersLoaded = true;
        this.ordersLoadError = '';
        this.orders = data
          .map(item => ({
            id: item.DON_HANG_ID,
            date: item.NGAY_TAO ? this.toDisplayDate(item.NGAY_TAO.split('T')[0]) : '',
            createdAt: item.NGAY_TAO || '',
            subtotal: Number(item.TAM_TINH || 0),
            total: item.TONG_TIEN || 0,
            status: item.TRANG_THAI as Order['status'],
            reviewLabel: this.reviewProgressLabel(Number(item.DANH_GIA_DA_GUI || 0), Number(item.DANH_GIA_TONG_SAN_PHAM || 0)),
          }))
          .filter(order => !this.isExpiredPaymentOrder(order));

        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi load đơn hàng:', err);
        this.ordersLoaded = true;
        this.ordersLoadError = 'Chưa tải được danh sách đơn hàng. Vui lòng thử lại.';
        this.loadedAccountSections.delete('orders');
        this.cdr.detectChanges();
      }
    });
  }
  private reviewProgressLabel(reviewed: number, total: number): string {
    if (!total || reviewed <= 0) return 'Chưa đánh giá';
    if (reviewed >= total) return 'Đã đánh giá';
    return `Đã đánh giá ${reviewed}/${total} sản phẩm`;
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
        this.loadedAccountSections.delete('vouchers');
        if (err?.status === 401) {
          this.router.navigate(['/login']);
          return;
        }
      }
    });
  }
  loadCustomerWishlist(page = this.wishlistPage): void {
    const saved = localStorage.getItem('khachHang');

    if (!saved) {
      this.router.navigate(['/login']);
      return;
    }

    const khachHang = JSON.parse(saved);

    this.customerService.getWishlist(khachHang.KHACH_HANG_ID, page, this.wishlistPageSize).subscribe({
      next: (response) => {
        this.wishlistPage = response.page;
        this.wishlistTotalPages = response.totalPages;
        this.wishlistTotal = response.total;
        this.wishlistItems = response.items.map((item: CustomerWishlistItem) => {
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
            status: item.TRANG_THAI_HIEN_THI,
            canPurchase: item.CO_THE_MUA,
            linkAvailable: item.LIEN_KET_CON_HIEU_LUC,
          };
        });

        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi load wishlist:', err);
        this.loadedAccountSections.delete('wishlist');
        if (err?.status === 401) {
          this.router.navigate(['/login']);
          return;
        }
      }
    });
  }

  changeWishlistPage(page: number): void {
    if (page < 1 || page > this.wishlistTotalPages || page === this.wishlistPage) return;
    this.loadCustomerWishlist(page);
  }

  openWishlistProduct(item: WishlistItem): void {
    if (!item?.id || item.linkAvailable === false) return;
    this.router.navigate(['/product-detail', item.id]);
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
        if (err?.status === 401) {
          this.router.navigate(['/login']);
          return;
        }
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
      this.editData.fullName.trim() !== this.userInfo.fullName ||
      this.toDisplayDate(this.editData.birthDate) !== this.toDisplayDate(this.userInfo.birthDate) ||
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
    this.profileError = '';
    this.profileFieldErrors = {};
    this.savingProfile = false;

    this.showEditModal = true;
  }

  closeModal(): void {
    if (this.savingProfile) return;
    this.showEditModal = false;
  }

  closeEditModal(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    if (target.classList.contains('modal-overlay')) {
      this.closeModal();
    }
  }

  /** Ngày sinh dd/mm/yyyy hợp lệ (có thật) và không ở tương lai. Rỗng = hợp lệ. */
  birthDateError(value: string): string {
    const text = String(value || '').trim();
    if (!text) return '';
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (!match) return 'Ngày sinh không hợp lệ (định dạng DD/MM/YYYY).';
    const [, dd, mm, yyyy] = match;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (date.getFullYear() !== Number(yyyy) || date.getMonth() !== Number(mm) - 1 || date.getDate() !== Number(dd)) {
      return 'Ngày sinh không hợp lệ.';
    }
    if (Number(yyyy) < 1900) return 'Ngày sinh không hợp lệ.';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date.getTime() > today.getTime()) return 'Ngày sinh không được ở tương lai.';
    return '';
  }

  get todayIso(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  clearProfileError(field: 'fullName' | 'birthDate' | 'gender'): void {
    delete this.profileFieldErrors[field];
    this.profileError = '';
  }

  saveProfile(form: NgForm): void {
    if (this.savingProfile) return;
    this.profileError = '';
    this.profileFieldErrors = {};

    const fullName = this.editData.fullName.trim().replace(/\s+/g, ' ');
    if (!fullName) this.profileFieldErrors.fullName = 'Vui lòng nhập họ và tên.';
    else if (fullName.length > 100) this.profileFieldErrors.fullName = 'Họ và tên tối đa 100 ký tự.';

    const birthDateError = this.birthDateError(this.editData.birthDate);
    if (birthDateError) this.profileFieldErrors.birthDate = birthDateError;

    if (this.editData.gender && !this.genderOptions.includes(this.editData.gender)) {
      this.profileFieldErrors.gender = 'Vui lòng chọn giới tính hợp lệ.';
    }

    if (form.invalid || Object.keys(this.profileFieldErrors).length) {
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

    // Email/SĐT không gửi lên: đổi các trường này cần xác minh riêng (KH20).
    const payload: Partial<Customer> = {
      TEN: fullName,
      DOB: this.toIsoDate(this.toDisplayDate(this.editData.birthDate)) || null,
      ...(this.editData.gender ? { GIOI_TINH: this.editData.gender } : {}),
    };

    this.savingProfile = true;
    this.customerService.updateById(khachHang.KHACH_HANG_ID, payload).subscribe({
      next: (res) => {
        const updated = res?.customer || ({} as Customer);
        const merged = { ...khachHang, ...updated };

        this.userInfo = {
          fullName: merged.TEN || '',
          gender: merged.GIOI_TINH || '',
          email: merged.EMAIL || '',
          birthDate: merged.DOB ? this.toDisplayDate(String(merged.DOB).split('T')[0]) : '',
          phone: merged.SDT || '',
          avatar: merged.AVATAR || 'assets/images/account/default-avatar.png',
        };

        localStorage.setItem('khachHang', JSON.stringify(merged));
        window.dispatchEvent(new Event('auth-changed'));

        this.savingProfile = false;
        this.showEditModal = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.savingProfile = false;
        const message = typeof err?.error?.message === 'string' && err.error.message
          ? err.error.message
          : err?.status === 0 || err?.status >= 500
            ? 'Chưa lưu được thông tin do lỗi kết nối hoặc hệ thống. Vui lòng thử lại.'
            : err?.status === 401
              ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
              : 'Chưa lưu được thông tin. Vui lòng thử lại.';
        const field = String(err?.error?.field || '').toUpperCase();
        if (field === 'TEN' || field === 'FULLNAME' || field === 'NAME') this.profileFieldErrors.fullName = message;
        else if (field === 'DOB' || field === 'BIRTHDATE') this.profileFieldErrors.birthDate = message;
        else if (field === 'GIOI_TINH' || field === 'GENDER') this.profileFieldErrors.gender = message;
        else this.profileError = message;
        this.cdr.detectChanges();
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
  /** Sidebar: đổi URL /account/<mục>; chỉ phần nội dung bên phải thay đổi. */
  setActiveSection(section: AccountSection): void {
    if (section === this.activeSection) return;
    this.router.navigate(['/account', section]).then(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const content = document.getElementById('account-content');
      if (content && content.getBoundingClientRect().top < 0) {
        window.scrollTo({ top: Math.max(window.scrollY + content.getBoundingClientRect().top - 120, 0), behavior: 'smooth' });
      }
    });
  }

  onMobileSectionChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === '__logout') {
      this.logout();
      return;
    }
    const section = resolveAccountSection(value);
    if (section) this.setActiveSection(section);
  }

  get activeSectionLabel(): string {
    return this.accountSections.find(item => item.key === this.activeSection)?.label || 'Tài khoản';
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
          const targetPage = this.wishlistItems.length === 1 && this.wishlistPage > 1
            ? this.wishlistPage - 1
            : this.wishlistPage;
          this.loadCustomerWishlist(targetPage);
        },

        error: (err) => {
          console.error(err);
        }
      });
  }

  buyWishlistItem(item: WishlistItem): void {
    if (!item.canPurchase) return;
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
    if (!item.canPurchase) return;

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

  /** Thu hồi token trên server + xoá phiên ở trình duyệt (endSession), rồi về /login. */
  logout(): void {
    if (isPlatformBrowser(this.platformId)) {
      endSession();
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
