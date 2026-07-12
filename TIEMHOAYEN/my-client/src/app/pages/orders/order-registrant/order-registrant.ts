import { Component, OnInit, inject, PLATFORM_ID, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PageHeader } from '../../../components/page-header/page-header';
import { PageFooter } from '../../../components/page-footer/page-footer';
import {
  CustomerService,
  CustomerAddress,
  CustomerVoucher,
} from '../../../services/customer.service';
import {
  OrderService,
  CreateOrderPayload,
  CreateOrderResponse,
} from '../../../services/order.service';

export interface OrderItem {
  id: string;
  name: string;
  image: string;
  qty: number;
  price: number;
}

export interface CartStorageItem {
  id?: string;
  SAN_PHAM_ID?: string;
  name?: string;
  TEN_SAN_PHAM?: string;
  image?: string;
  HINH_ANH?: string;
  quantity?: number;
  qty?: number;
  SO_LUONG?: number;
  price?: number;
  GIA?: number;
  GIA_KHUYEN_MAI?: number | null;
  selected?: boolean;
}

export interface SavedAddress {
  id: string;
  name: string;
  phone: string;
  fullAddress: string;
  isDefault: boolean;
  provinceName?: string;
  districtName?: string;
  wardName?: string;
}

export interface Voucher {
  id: string;
  code: string;
  title: string;
  desc: string;
  type: 'Phần trăm' | 'Tiền mặt' | string;
  value: number;
  startDate?: string | null;
  endDate?: string | null;
  used?: boolean | number;
}

export interface PaymentMethod {
  value: string;
  label: string;
  icon?: string;
  logo?: string;
}

export interface ShippingMethod {
  value: 'standard' | 'fast';
  label: string;
  desc: string;
}

export interface PaymentPolicy {
  minTotal: number;
  maxTotal: number | null;
  depositType: 'none' | 'percent' | 'fixed';
  depositValue: number;
  note: string;
}

export interface Province {
  code: string;
  name: string;
  districts: District[];
}

export interface District {
  code: string;
  name: string;
  wards: Ward[];
}

export interface Ward {
  code: string;
  name: string;
}

export interface WardOption extends Ward {
  districtName: string;
}

@Component({
  selector: 'app-order-registrant',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeader, PageFooter],
  templateUrl: './order-registrant.html',
  styleUrl: './order-registrant.css',
})
export class OrderRegistrantComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly customerService = inject(CustomerService);
  private readonly orderService = inject(OrderService);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly checkoutItemsStorageKey = 'tiemHoaYenCheckoutItems';
  private readonly legacyCartStorageKey = 'tiemHoaYenCart';
  private readonly registrantOrderStorageKey = 'tiemHoaYenRegistrantOrder';
  private readonly recentRegistrantAddressStorageKey = 'tiemHoaYenRecentRegistrantAddress';
  private readonly createdOrderStorageKey = 'tiemHoaYenCreatedOrder';
  private readonly defaultImage = 'assets/images/hoa.jpg';

  currentCustomer: any = null;

  // ===== TRẠNG THÁI UI =====
  showAddressDropdown = false;
  showVoucherDropdown = false;
  selectedAddress: SavedAddress | null = null;
  selectedVoucher: Voucher | null = null;
  paymentCardError = '';
  submitOrderError = '';
  voucherError = '';
  isSubmittingOrder = false;

  // ===== ĐIỂM THƯỞNG =====
  maxLoyaltyPoints = 0;
  useLoyaltyPoints = false;

  /**
   * Quy đổi điểm thưởng:
   * 2 điểm = 1.000đ
   * Chỉ dùng theo từng cặp 2 điểm, điểm lẻ sẽ không được tính.
   */
  private readonly pointsPerRewardUnit = 2;
  private readonly rewardUnitValue = 1000;
  private readonly largeOrderQuantityThreshold = 10;

  private readonly specialDepositKeywords = [
    'hoa cuoi',
    'cuoi',
    'hoa su kien',
    'su kien',
    'wedding',
    'event',
  ];

  private readonly peakHolidayDates = [
    { day: 1, month: 1 },
    { day: 14, month: 2 },
    { day: 8, month: 3 },
    { day: 20, month: 10 },
    { day: 20, month: 11 },
    { day: 24, month: 12 },
    { day: 25, month: 12 },
    { day: 31, month: 12 },
  ];


  private readonly innerDistrictNames = [
    'Quận 1',
    'Quận 3',
    'Quận 4',
    'Quận 5',
    'Quận 6',
    'Quận 7',
    'Quận 8',
    'Quận 10',
    'Quận 11',
    'Quận Bình Thạnh',
    'Quận Phú Nhuận',
    'Quận Tân Bình',
    'Quận Tân Phú',
    'Quận Gò Vấp',
  ];

  private readonly outerDistrictNames = [
    'Quận 12',
    'Quận Bình Tân',
    'Huyện Hóc Môn',
    'Huyện Bình Chánh',
    'Huyện Nhà Bè',
    'Huyện Củ Chi',
    'Huyện Cần Giờ',
    'Thành phố Thủ Đức',
  ];

  shippingMethods: ShippingMethod[] = [
    {
      value: 'standard',
      label: 'Giao tiêu chuẩn',
      desc: 'Phù hợp đơn không cần giao gấp',
    },
    {
      value: 'fast',
      label: 'Giao nhanh',
      desc: 'Ưu tiên xử lý và giao sớm hơn',
    },
  ];

  paymentPolicies: PaymentPolicy[] = [
    {
      minTotal: 0,
      maxTotal: 299999,
      depositType: 'fixed',
      depositValue: 50000,
      note: 'Đơn dưới 300.000đ cần đặt cọc 50.000đ',
    },
    {
      minTotal: 300000,
      maxTotal: 499999,
      depositType: 'fixed',
      depositValue: 100000,
      note: 'Đơn từ 300.000đ đến dưới 500.000đ cần đặt cọc 100.000đ',
    },
    {
      minTotal: 500000,
      maxTotal: 999999,
      depositType: 'percent',
      depositValue: 30,
      note: 'Đơn từ 500.000đ đến dưới 1.000.000đ cần đặt cọc 30%',
    },
    {
      minTotal: 1000000,
      maxTotal: 1999999,
      depositType: 'percent',
      depositValue: 40,
      note: 'Đơn từ 1.000.000đ đến dưới 2.000.000đ cần đặt cọc 40%',
    },
    {
      minTotal: 2000000,
      maxTotal: null,
      depositType: 'percent',
      depositValue: 50,
      note: 'Đơn từ 2.000.000đ trở lên cần đặt cọc 50%',
    },
  ];

  // ===== DỮ LIỆU FORM =====
  formData = {
    fullName: '',
    phone: '',
    address: '',
    deliveryDate: '',
    deliveryTime: '',
    noteReceiver: '',
    noteShop: '',
    hideSender: false,
    requestVAT: false,
    sendZaloPhoto: false,
    voucherCode: '',
    loyaltyPoints: 0,
    paymentMethod: 'cod',
    shippingMethod: 'standard' as 'standard' | 'fast',
  };

  deliveryScheduleError = '';

  // ===== ĐỊA CHỈ CỦA TÀI KHOẢN =====
  savedAddresses: SavedAddress[] = [];

  // ===== VOUCHER CỦA KHÁCH HÀNG ĐĂNG NHẬP =====
  availableVouchers: Voucher[] = [];

  // ===== SẢN PHẨM ĐƯỢC CHỌN TỪ GIỎ HÀNG =====
  orderItems: OrderItem[] = [];

  paymentMethods: PaymentMethod[] = [
    { value: 'cod', label: 'Thanh toán khi\nnhận hàng (COD)', icon: 'bi-cash-coin' },
    { value: 'momo', label: 'Momo', logo: 'assets/images/momo.png' },
    { value: 'vnpay', label: 'VNPay', logo: 'assets/images/vnpay.jpg' },
    { value: 'bank', label: 'Chuyển khoản\nngân hàng', icon: 'bi-bank' },
    { value: 'card', label: 'Thẻ ngân hàng', icon: 'bi-credit-card' },
  ];

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.loadVietnamAddressData();

    const hasCustomer = this.loadLoggedInCustomer();

    if (!hasCustomer) {
      this.router.navigate(['/order-haunt']);
      return;
    }

    this.loadOrderItemsFromSelectedCart();
    this.prefillRecentOrderAddress();
    this.loadCustomerAddresses();
    this.loadCustomerDetail();
    this.loadCustomerVouchers();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    if (this.showAddressDropdown && !target.closest('.form-group--address')) {
      this.showAddressDropdown = false;
    }

    if (this.showVoucherDropdown && !target.closest('.voucher-select-wrapper')) {
      this.showVoucherDropdown = false;
    }

    if (this.openAddressDropdown && !target.closest('.address-custom-select-wrap')) {
      this.openAddressDropdown = '';
    }
  }

  private loadLoggedInCustomer(): boolean {
    const rawCustomer = localStorage.getItem('khachHang');

    if (!rawCustomer) {
      this.currentCustomer = null;
      return false;
    }

    try {
      this.currentCustomer = JSON.parse(rawCustomer);

      this.formData.fullName =
        this.currentCustomer?.TEN ||
        this.currentCustomer?.TEN_KHACH_HANG ||
        this.currentCustomer?.HO_TEN ||
        this.currentCustomer?.name ||
        '';

      this.formData.phone = this.formatPhoneInput(
        this.currentCustomer?.SDT ||
        this.currentCustomer?.phone ||
        ''
      );

      this.maxLoyaltyPoints = Math.max(
        0,
        Number(this.currentCustomer?.DIEM_TICH_LUY || 0)
      );

      this.formData.loyaltyPoints = 0;
      this.useLoyaltyPoints = false;

      return !!this.getCustomerId();
    } catch (error) {
      console.error('Lỗi đọc khách hàng đang đăng nhập:', error);
      this.currentCustomer = null;
      return false;
    }
  }

  private getCustomerId(): string {
    return String(
      this.currentCustomer?.KHACH_HANG_ID ||
      this.currentCustomer?.khachHangId ||
      this.currentCustomer?.id ||
      ''
    );
  }

  // ====================================================================
  // ===== LẤY THÔNG TIN KHÁCH HÀNG & VOUCHER =====
  // ====================================================================

  private loadCustomerDetail(): void {
    const customerId = this.getCustomerId();

    if (!customerId) {
      this.maxLoyaltyPoints = 0;
      this.useLoyaltyPoints = false;
      this.formData.loyaltyPoints = 0;
      return;
    }

    this.customerService.getById(customerId).subscribe({
      next: (customer) => {
        this.currentCustomer = {
          ...this.currentCustomer,
          ...customer,
        };

        this.maxLoyaltyPoints = Math.max(
          0,
          Number(customer?.DIEM_TICH_LUY || 0)
        );

        if (this.maxLoyaltyPoints <= 0) {
          this.useLoyaltyPoints = false;
          this.formData.loyaltyPoints = 0;
        }
      },
      error: (err: unknown) => {
        console.error('Lỗi lấy điểm tích lũy của khách hàng:', err);
        this.maxLoyaltyPoints = Math.max(
          0,
          Number(this.currentCustomer?.DIEM_TICH_LUY || 0)
        );
      },
    });
  }

  private loadCustomerVouchers(): void {
    const customerId = this.getCustomerId();

    if (!customerId) {
      this.availableVouchers = [];
      this.selectedVoucher = null;
      this.formData.voucherCode = '';
      return;
    }

    this.customerService.getVouchers(customerId).subscribe({
      next: (vouchers: CustomerVoucher[]) => {
        const items = Array.isArray(vouchers) ? vouchers : [];

        this.availableVouchers = items
          .filter((item: CustomerVoucher) => !this.isVoucherUsed(item))
          .filter((item: CustomerVoucher) => this.isVoucherValidDate(item))
          .map((item: CustomerVoucher) => this.mapCustomerVoucher(item));

        if (
          this.selectedVoucher &&
          !this.availableVouchers.some(v => v.id === this.selectedVoucher?.id)
        ) {
          this.selectedVoucher = null;
          this.formData.voucherCode = '';
        }
      },
      error: (err: unknown) => {
        console.error('Lỗi load voucher của khách hàng:', err);
        this.availableVouchers = [];
      },
    });
  }

  private isVoucherUsed(voucher: CustomerVoucher): boolean {
    return voucher.DA_DUNG === true || voucher.DA_DUNG === 1;
  }

  private isVoucherValidDate(voucher: CustomerVoucher): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (voucher.NGAY_BAT_DAU) {
      const startDate = new Date(voucher.NGAY_BAT_DAU);
      startDate.setHours(0, 0, 0, 0);

      if (today < startDate) {
        return false;
      }
    }

    if (voucher.NGAY_KET_THUC) {
      const endDate = new Date(voucher.NGAY_KET_THUC);
      endDate.setHours(23, 59, 59, 999);

      if (today > endDate) {
        return false;
      }
    }

    return true;
  }

  private mapCustomerVoucher(item: CustomerVoucher): Voucher {
    const type = String(item.LOAI_GIAM_GIA || '').trim();
    const value = Number(item.GIA_TRI_GIAM || 0);
    const code = String(item.MA_VOUCHER || '').trim();

    return {
      id: String(item.VOUCHER_ID || ''),
      code,
      title: this.getVoucherTitle(type, value),
      desc: this.getVoucherDescription(type, value),
      type,
      value,
      startDate: item.NGAY_BAT_DAU || null,
      endDate: item.NGAY_KET_THUC || null,
      used: item.DA_DUNG,
    };
  }

  private getVoucherTitle(type: string, value: number): string {
    if (this.normalizeText(type) === this.normalizeText('Phần trăm')) {
      return `Giảm ${value}% đơn hàng`;
    }

    if (this.normalizeText(type) === this.normalizeText('Tiền mặt')) {
      return `Giảm ${this.formatMoney(value)} phí vận chuyển`;
    }

    return 'Voucher ưu đãi';
  }

  private getVoucherDescription(type: string, value: number): string {
    if (this.normalizeText(type) === this.normalizeText('Phần trăm')) {
      return `Giảm ${value}% trên tạm tính sản phẩm`;
    }

    if (this.normalizeText(type) === this.normalizeText('Tiền mặt')) {
      return `Giảm tối đa ${this.formatMoney(value)} vào phí vận chuyển`;
    }

    return 'Áp dụng cho tài khoản của bạn';
  }

  private formatMoney(value: number): string {
    return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
  }

  // ====================================================================
  // ===== LẤY SẢN PHẨM ĐƯỢC CHỌN TỪ GIỎ HÀNG =====
  // ====================================================================

  private loadOrderItemsFromSelectedCart(): void {
    /**
     * Ưu tiên 1:
     * Lấy đúng các sản phẩm đã tick chọn ở trang cart.
     * Key này được cart.ts lưu trước khi chuyển sang /order-registrant.
     */
    const checkoutItems = this.readOrderItemsFromStorage(this.checkoutItemsStorageKey);

    if (checkoutItems.length > 0) {
      this.orderItems = checkoutItems;
      return;
    }

    /**
     * Ưu tiên 2:
     * Fallback cho code cũ nếu trước đó vẫn còn lưu ở tiemHoaYenCart.
     */
    const legacyItems = this.readOrderItemsFromStorage(this.legacyCartStorageKey);

    if (legacyItems.length > 0) {
      this.orderItems = legacyItems;
      return;
    }

    /**
     * Ưu tiên 3:
     * Fallback database chỉ dùng khi user mở thẳng /order-registrant
     * mà không đi từ nút Đặt hàng ở trang cart.
     * Lưu ý: database không biết sản phẩm nào được tick chọn, nên sẽ lấy toàn bộ giỏ.
     */
    this.loadCartItemsFromDatabaseFallback();
  }

  private readOrderItemsFromStorage(storageKey: string): OrderItem[] {
    const rawCart = localStorage.getItem(storageKey);

    if (!rawCart) {
      return [];
    }

    try {
      const parsedCart = JSON.parse(rawCart);

      if (!Array.isArray(parsedCart)) {
        return [];
      }

      return parsedCart
        .filter((item: CartStorageItem) => item.selected !== false)
        .map((item: CartStorageItem) => this.mapCartItemToOrderItem(item))
        .filter((item: OrderItem) => !!item.id && item.qty > 0);
    } catch (error) {
      console.error(`Lỗi đọc sản phẩm từ ${storageKey}:`, error);
      return [];
    }
  }

  private loadCartItemsFromDatabaseFallback(): void {
    const customerId = this.getCustomerId();

    if (!customerId) {
      this.orderItems = [];
      return;
    }

    fetch(`https://tiem-hoa-yen-api.onrender.com/api/cart/customer/${customerId}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Không lấy được giỏ hàng: ${response.status}`);
        }

        return response.json();
      })
      .then((res: { items?: CartStorageItem[] }) => {
        const items = Array.isArray(res.items) ? res.items : [];

        /**
         * Database chỉ lưu sản phẩm trong giỏ, không lưu trạng thái checkbox.
         * Vì vậy chỉ dùng fallback này khi không tìm thấy checkoutItemsStorageKey.
         */
        this.orderItems = items
          .map((item: CartStorageItem) => this.mapCartItemToOrderItem(item))
          .filter((item: OrderItem) => !!item.id && item.qty > 0);
      })
      .catch(error => {
        console.error('Lỗi lấy giỏ hàng database:', error);
        this.orderItems = [];
      });
  }

  private mapCartItemToOrderItem(item: CartStorageItem): OrderItem {
    const id = String(item.id || item.SAN_PHAM_ID || '');
    const name = String(item.name || item.TEN_SAN_PHAM || '');
    const image = name.trim().toLocaleLowerCase('vi-VN') === 'túi quà cao cấp'
      ? 'assets/images/tui-qua-cao-cap.png'
      : String(item.image || item.HINH_ANH || this.defaultImage);

    const qty = Math.max(
      1,
      Number(item.qty ?? item.quantity ?? item.SO_LUONG ?? 1)
    );

    const price = Number(
      item.price ??
      item.GIA_KHUYEN_MAI ??
      item.GIA ??
      0
    );

    return {
      id,
      name,
      image,
      qty,
      price,
    };
  }

  // ====================================================================
  // ===== LẤY ĐỊA CHỈ CỦA TÀI KHOẢN =====
  // ====================================================================

  private loadCustomerAddresses(): void {
    const customerId = this.getCustomerId();

    if (!customerId) {
      this.savedAddresses = [];
      this.selectedAddress = null;
      return;
    }

    this.customerService.getAddresses(customerId).subscribe({
      next: (data: CustomerAddress[]) => {
        const addresses = Array.isArray(data) ? data : [];

        this.savedAddresses = this.sortAddressesByDefault(
          this.getUniqueAddresses(
            addresses.map((item: CustomerAddress) => this.mapCustomerAddress(item))
          )
        );

        const defaultAddress =
          this.savedAddresses.find(address => address.isDefault) ||
          null;

        const initialAddress =
          defaultAddress ||
          this.findRecentOrderAddress(this.savedAddresses) ||
          this.savedAddresses[0] ||
          null;

        this.applySelectedAddress(initialAddress);
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi load địa chỉ của tài khoản:', err);
        this.savedAddresses = [];
        this.selectedAddress = null;
        this.formData.address = '';
        this.cdr.detectChanges();
      },
    });
  }

  private mapCustomerAddress(item: CustomerAddress): SavedAddress {
    const fullAddress = [
      item.DIA_CHI_CHI_TIET,
      item.PHUONG_XA,
      item.QUAN_HUYEN,
      item.TINH_THANH,
    ]
      .filter(value => !!value)
      .join(', ');

    return {
      id: String(item.DIA_CHI_ID || ''),
      name: item.TEN_NGUOI_NHAN || this.formData.fullName || '',
      phone: this.formatPhoneInput(item.SDT_NGUOI_NHAN || this.formData.phone || ''),
      fullAddress,
      provinceName: item.TINH_THANH || '',
      districtName: item.QUAN_HUYEN || '',
      wardName: item.PHUONG_XA || '',
      isDefault: this.isDefaultAddressFlag(item.LA_MAC_DINH),
    };
  }

  private isDefaultAddressFlag(value: unknown): boolean {
    if (typeof value === 'string') {
      return ['1', 'true'].includes(value.trim().toLowerCase());
    }

    return value === true || value === 1;
  }

  private getUniqueAddresses(addresses: SavedAddress[]): SavedAddress[] {
    const seen = new Set<string>();

    return addresses.filter(address => {
      const key = this.getAddressIdentityKey(address);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private sortAddressesByDefault(addresses: SavedAddress[]): SavedAddress[] {
    return [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  // ===== TÍNH TIỀN =====
  private prefillRecentOrderAddress(): void {
    const recentAddress = this.readRecentOrderAddress();

    if (recentAddress) {
      this.applySelectedAddress(recentAddress);
    }
  }

  private findRecentOrderAddress(addresses: SavedAddress[]): SavedAddress | null {
    const recentAddress = this.readRecentOrderAddress();

    if (!recentAddress) {
      return null;
    }

    return addresses.find(address => this.getAddressIdentityKey(address) === this.getAddressIdentityKey(recentAddress)) ||
      recentAddress;
  }

  private readRecentOrderAddress(): SavedAddress | null {
    return this.readAddressFromStorage(this.recentRegistrantAddressStorageKey) ||
      this.readAddressFromStorage(this.registrantOrderStorageKey);
  }

  private readAddressFromStorage(storageKey: string): SavedAddress | null {
    try {
      const raw = localStorage.getItem(storageKey);

      if (!raw) {
        return null;
      }

      const data = JSON.parse(raw);
      const source = data?.selectedAddress || data?.receiver || data;
      const customerId = data?.customerId ? String(data.customerId) : '';

      if (customerId && customerId !== this.getCustomerId()) {
        return null;
      }

      const fullAddress = String(source?.fullAddress || source?.address || '').trim();

      if (!fullAddress) {
        return null;
      }

      return {
        id: String(source?.id || 'recent-order-address'),
        name: String(source?.name || this.formData.fullName || ''),
        phone: this.formatPhoneInput(String(source?.phone || this.formData.phone || '')),
        fullAddress,
        provinceName: String(source?.provinceName || ''),
        districtName: String(source?.districtName || ''),
        wardName: String(source?.wardName || ''),
        isDefault: false,
      };
    } catch {
      return null;
    }
  }

  private saveRecentOrderAddress(address: SavedAddress): void {
    localStorage.setItem(
      this.recentRegistrantAddressStorageKey,
      JSON.stringify({
        customerId: this.getCustomerId(),
        ...address,
      })
    );
  }

  private getAddressIdentityKey(address: SavedAddress): string {
    return [
      address.name,
      address.phone,
      address.fullAddress,
    ].map(value => this.normalizeText(value || '')).join('|');
  }

  get subtotal(): number {
    return this.orderItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  }

  get selectedShippingDistrictName(): string {
    if (this.selectedAddress?.districtName) {
      return this.selectedAddress.districtName;
    }

    const fullAddress = this.selectedAddress?.fullAddress || this.formData.address;

    if (!fullAddress) {
      return '';
    }

    const allDistricts = [
      ...this.innerDistrictNames,
      ...this.outerDistrictNames,
    ];

    const normalizedAddress = this.normalizeText(fullAddress);

    const found = allDistricts.find(district =>
      normalizedAddress.includes(this.normalizeText(district))
    );

    return found || '';
  }

  get isInnerDistrict(): boolean {
    if (!this.selectedShippingDistrictName) {
      return false;
    }

    return this.innerDistrictNames.some(
      districtName =>
        this.normalizeText(districtName) === this.normalizeText(this.selectedShippingDistrictName)
    );
  }

  get shippingMethodName(): string {
    const found = this.shippingMethods.find(
      method => method.value === this.formData.shippingMethod
    );

    return found ? found.label : 'Giao tiêu chuẩn';
  }

  get shippingTimeEstimate(): string {
    if (!this.selectedAddress) {
      return 'Vui lòng chọn địa chỉ giao hàng';
    }

    const isInner = this.isInnerDistrict;
    const isFast = this.formData.shippingMethod === 'fast';

    if (isInner && isFast) {
      return '2-4 giờ, áp dụng trong giờ làm việc';
    }

    if (isInner && !isFast) {
      return 'Trong ngày làm việc';
    }

    if (!isInner && isFast) {
      return '8-10 giờ, áp dụng trong giờ làm việc';
    }

    return '1-2 ngày làm việc';
  }

  get baseShippingFee(): number {
    if (this.orderItems.length === 0 || !this.selectedAddress) {
      return 0;
    }

    const isInner = this.isInnerDistrict;
    const isFast = this.formData.shippingMethod === 'fast';

    if (isInner && isFast) {
      if (this.subtotal < 300000) return 60000;
      if (this.subtotal <= 500000) return 30000;
      return 0;
    }

    if (isInner && !isFast) {
      if (this.subtotal < 300000) return 30000;
      return 0;
    }

    if (!isInner && isFast) {
      if (this.subtotal < 300000) return 80000;
      if (this.subtotal <= 500000) return 40000;
      return 30000;
    }

    if (this.subtotal < 300000) return 40000;
    if (this.subtotal <= 500000) return 20000;

    return 0;
  }

  get productVoucherDiscount(): number {
    if (!this.selectedVoucher || !this.isPercentVoucher(this.selectedVoucher)) {
      return 0;
    }

    return Math.round((this.subtotal * this.selectedVoucher.value) / 100);
  }

  get shippingVoucherDiscount(): number {
    if (!this.selectedVoucher || !this.isCashVoucher(this.selectedVoucher)) {
      return 0;
    }

    return Math.min(this.baseShippingFee, Math.max(0, this.selectedVoucher.value));
  }

  get shippingFee(): number {
    return Math.max(0, this.baseShippingFee - this.shippingVoucherDiscount);
  }

  get discount(): number {
    return this.productVoucherDiscount;
  }

  private getMaxRedeemablePointsByBalance(): number {
    return Math.floor(Math.max(0, this.maxLoyaltyPoints) / this.pointsPerRewardUnit) * this.pointsPerRewardUnit;
  }

  private convertPointsToMoney(points: number): number {
    return Math.floor(Math.max(0, points) / this.pointsPerRewardUnit) * this.rewardUnitValue;
  }

  private getMaxLoyaltyDiscountBase(): number {
    return Math.max(0, this.subtotal - this.productVoucherDiscount);
  }

  get loyaltyPointsToUse(): number {
    if (!this.useLoyaltyPoints) {
      return 0;
    }

    const maxPointsByBalance = this.getMaxRedeemablePointsByBalance();
    const maxPointsByOrder =
      Math.floor(this.getMaxLoyaltyDiscountBase() / this.rewardUnitValue) * this.pointsPerRewardUnit;

    return Math.min(maxPointsByBalance, maxPointsByOrder);
  }

  get loyaltyDiscount(): number {
    return this.convertPointsToMoney(this.loyaltyPointsToUse);
  }

  get total(): number {
    return Math.max(
      0,
      this.subtotal + this.shippingFee - this.productVoucherDiscount - this.loyaltyDiscount
    );
  }

  private get depositPolicyBaseAmount(): number {
    return Math.max(0, this.subtotal);
  }

  get totalOrderQuantity(): number {
    return this.orderItems.reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0);
  }

  get isLargeQuantityOrder(): boolean {
    return this.totalOrderQuantity >= this.largeOrderQuantityThreshold;
  }

  get isWeddingOrEventOrder(): boolean {
    const productText = this.normalizeText(
      this.orderItems.map(item => item.name || '').join(' ')
    );

    return this.specialDepositKeywords.some(keyword =>
      productText.includes(this.normalizeText(keyword))
    );
  }

  get isSpecialDepositOrder(): boolean {
    return this.isWeddingOrEventOrder || this.isLargeQuantityOrder;
  }

  get isPeakHolidayDeliveryDate(): boolean {
    const dateValue = String(this.formData.deliveryDate || '').trim();

    if (!dateValue) {
      return false;
    }

    let day = 0;
    let month = 0;

    if (dateValue.includes('/')) {
      const parts = dateValue.split('/');
      day = Number(parts[0]);
      month = Number(parts[1]);
    } else if (dateValue.includes('-')) {
      const parts = dateValue.split('-');
      day = Number(parts[2]);
      month = Number(parts[1]);
    }

    if (!day || !month) {
      return false;
    }

    return this.peakHolidayDates.some(item => item.day === day && item.month === month);
  }

  get isCashPaymentBlocked(): boolean {
    // Giao nhanh chỉ thay đổi phí ship / thời gian giao.
    // Không khóa COD, MoMo, VNPay hoặc chuyển khoản.
    return false;
  }

  isPaymentMethodDisabled(methodValue: string): boolean {
    // Hiện tại chỉ khóa thẻ ngân hàng vì shop chưa hỗ trợ trực tiếp.
    return methodValue === 'card';
  }

  private getCashPaymentBlockedMessage(): string {
    return '';
  }

  onShippingMethodChange(): void {
    // Không tự đổi phương thức thanh toán khi khách đổi giao tiêu chuẩn / giao nhanh.
    if (this.formData.paymentMethod !== 'card') {
      this.paymentCardError = '';
    }
  }

  get currentPaymentPolicy(): PaymentPolicy | null {
    if (this.isSpecialDepositOrder) {
      return {
        minTotal: 0,
        maxTotal: null,
        depositType: 'percent',
        depositValue: 70,
        note: 'Hoa cưới, hoa sự kiện hoặc đơn số lượng lớn cần đặt cọc 70%',
      };
    }

    const baseAmount = this.depositPolicyBaseAmount;

    return this.paymentPolicies.find(policy => {
      const matchMin = baseAmount >= policy.minTotal;
      const matchMax = policy.maxTotal === null || baseAmount <= policy.maxTotal;

      return matchMin && matchMax;
    }) || null;
  }

  get isCodPayment(): boolean {
    return this.formData.paymentMethod === 'cod';
  }

  get showDepositPolicy(): boolean {
    return this.isCodPayment && !this.isCashPaymentBlocked && !!this.currentPaymentPolicy;
  }

  get depositAmount(): number {
    if (!this.isCodPayment || this.isCashPaymentBlocked) {
      return 0;
    }

    const policy = this.currentPaymentPolicy;

    if (!policy || policy.depositType === 'none') {
      return 0;
    }

    if (policy.depositType === 'fixed') {
      return Math.min(policy.depositValue, this.total);
    }

    if (policy.depositType === 'percent') {
      return Math.round((this.depositPolicyBaseAmount * policy.depositValue) / 100);
    }

    return 0;
  }

  get remainingAmount(): number {
    if (!this.isCodPayment || this.isCashPaymentBlocked) {
      return 0;
    }

    return Math.max(0, this.total - this.depositAmount);
  }

  private isPercentVoucher(voucher: Voucher): boolean {
    return this.normalizeText(voucher.type) === this.normalizeText('Phần trăm');
  }

  private isCashVoucher(voucher: Voucher): boolean {
    return this.normalizeText(voucher.type) === this.normalizeText('Tiền mặt');
  }

  private normalizeText(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/\s+/g, ' ');
  }


  get paymentMethodName(): string {
    const found = this.paymentMethods.find(method => method.value === this.formData.paymentMethod);
    return found ? found.label.replace(/\n/g, ' ') : this.formData.paymentMethod;
  }

  selectPaymentMethod(methodValue: string): void {
    if (this.isPaymentMethodDisabled(methodValue)) {
      this.formData.paymentMethod = 'card';
      this.paymentCardError = 'Hiện tại shop chưa hỗ trợ hình thức thanh toán này.';
      return;
    }

    this.formData.paymentMethod = methodValue;
    this.paymentCardError = '';
  }

  onPaymentMethodChange(methodValue?: string): void {
    if (methodValue) {
      this.formData.paymentMethod = methodValue;
    }

    if (this.formData.paymentMethod === 'card') {
      this.paymentCardError = 'Hiện tại shop chưa hỗ trợ hình thức thanh toán này.';
      return;
    }

    this.paymentCardError = '';
  }

  // ===== XỬ LÝ ĐỊA CHỈ CÓ SẴN =====
  toggleAddressDropdown(): void {
    this.showAddressDropdown = !this.showAddressDropdown;

    if (this.showAddressDropdown) {
      this.showVoucherDropdown = false;
    }
  }

  selectAddress(addr: SavedAddress): void {
    this.applySelectedAddress(addr);
    this.showAddressDropdown = false;
  }

  private applySelectedAddress(addr: SavedAddress | null): void {
    this.selectedAddress = addr;

    if (!addr) {
      this.formData.address = '';
      return;
    }

    this.formData.fullName = addr.name;
    this.formData.phone = this.formatPhoneInput(addr.phone);
    this.formData.address = addr.fullAddress;
  }

  editAddress(addr: SavedAddress, event: Event): void {
    event.stopPropagation();
    this.openEditAddressModal(addr);
  }

  deleteAddress(addr: SavedAddress, event: Event): void {
    event.stopPropagation();

    this.customerService.deleteAddress(addr.id).subscribe({
      next: () => {
        this.loadCustomerAddresses();
      },
      error: (err) => {
        console.error('Lỗi xóa địa chỉ:', err);
      },
    });
  }

  // ===== XỬ LÝ VOUCHER =====
  toggleVoucherDropdown(): void {
    this.showVoucherDropdown = !this.showVoucherDropdown;

    if (this.showVoucherDropdown) {
      this.showAddressDropdown = false;
    }
  }

  selectVoucher(v: Voucher): void {
    this.selectedVoucher = this.selectedVoucher?.id === v.id ? null : v;

    this.formData.voucherCode = this.selectedVoucher ? v.code : '';
    this.voucherError = '';
    this.showVoucherDropdown = false;
  }

  onVoucherCodeChange(): void {
    this.voucherError = '';
  }

  applyVoucher(): void {
    const code = this.formData.voucherCode.trim().toUpperCase();
    this.voucherError = '';

    if (!code) {
      this.selectedVoucher = null;
      return;
    }

    const found = this.availableVouchers.find(
      v => v.code.trim().toUpperCase() === code
    );

    this.selectedVoucher = found ?? null;

    if (!found) {
      this.voucherError = 'Voucher không hợp lệ.';
    }
  }

  // ====================================================================
  // ===== MODAL THÊM/SỬA ĐỊA CHỈ =====
  // ====================================================================
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

  selectedProvinceName = '';
  selectedDistrictName = '';
  selectedWardName = '';
  openAddressDropdown = '';

  get addressModalTitle(): string {
    return this.editingAddressId !== null ? 'Sửa địa chỉ' : 'Địa chỉ nhận hàng';
  }

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
      })
      .catch(error => {
        console.error('Không tải được dữ liệu địa chỉ:', error);
      });
  }

  openAddAddressModal(): void {
    this.editingAddressId = null;
    this.resetNewAddressForm();
    this.showAddAddressModal = true;
    this.showAddressDropdown = false;
  }

  openEditAddressModal(addr: SavedAddress): void {
    this.editingAddressId = addr.id;

    this.newAddress = {
      fullName: addr.name,
      phone: this.formatPhoneInput(addr.phone),
      provinceCode: '',
      districtCode: '',
      wardCode: '',
      detail: this.getAddressDetailLine(addr),
      isDefault: addr.isDefault,
    };

    this.selectedProvinceName = addr.provinceName || '';
    this.selectedDistrictName = addr.districtName || '';
    this.selectedWardName = addr.wardName || '';

    this.openAddressDropdown = '';
    this.availableDistricts = [];
    this.availableWards = [];

    this.prefillAddressDropdownCodes(addr);

    this.showAddAddressModal = true;
  }

  private getAddressDetailLine(addr: SavedAddress): string {
    const partsToRemove = [
      addr.wardName,
      addr.districtName,
      addr.provinceName,
    ].filter(Boolean) as string[];

    let detail = addr.fullAddress;

    partsToRemove.forEach(part => {
      detail = detail.replace(`, ${part}`, '').replace(part, '');
    });

    return detail.replace(/,\s*$/, '').trim();
  }

  private prefillAddressDropdownCodes(addr: SavedAddress): void {
    if (!this.provinces.length) {
      return;
    }

    const province = this.provinces.find(item =>
      this.normalizeText(item.name) === this.normalizeText(addr.provinceName || '')
    );

    if (!province) {
      return;
    }

    this.newAddress.provinceCode = province.code;
    this.availableDistricts = province.districts;

    const district = province.districts.find(item =>
      this.normalizeText(item.name) === this.normalizeText(addr.districtName || '')
    );

    if (!district) {
      return;
    }

    this.newAddress.districtCode = district.code;
    this.availableWards = district.wards.map(ward => ({
      ...ward,
      districtName: district.name,
    }));

    const ward = district.wards.find(item =>
      this.normalizeText(item.name) === this.normalizeText(addr.wardName || '')
    );

    if (ward) {
      this.newAddress.wardCode = ward.code;
    }
  }

  closeAddAddressModal(): void {
    this.showAddAddressModal = false;
    this.editingAddressId = null;
    this.openAddressDropdown = '';
  }

  closeAddAddressModalByOverlay(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    if (target.classList.contains('modal-overlay')) {
      this.closeAddAddressModal();
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

    this.availableDistricts = [];
    this.availableWards = [];
  }

  onNewAddressPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.newAddress.phone = this.formatPhoneInput(input.value);
  }

  toggleAddressFieldDropdown(type: string, disabled: boolean): void {
    if (disabled) {
      return;
    }

    this.openAddressDropdown = this.openAddressDropdown === type ? '' : type;
  }

  selectProvince(province: Province): void {
    this.selectedProvinceName = province.name;
    this.newAddress.provinceCode = province.code;
    this.openAddressDropdown = '';

    this.selectedDistrictName = '';
    this.selectedWardName = '';
    this.newAddress.districtCode = '';
    this.newAddress.wardCode = '';
    this.availableDistricts = province.districts;
    this.availableWards = [];
  }

  selectDistrict(district: District): void {
    this.selectedDistrictName = district.name;
    this.newAddress.districtCode = district.code;
    this.openAddressDropdown = '';

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
  }

  saveNewAddress(form: NgForm): void {
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

    if (!selectedProvince || !selectedDistrict || !selectedWard) {
      return;
    }

    const customerId = this.getCustomerId();

    if (!customerId) {
      this.router.navigate(['/order-haunt']);
      return;
    }

    const payload = {
      TEN_NGUOI_NHAN: this.newAddress.fullName,
      SDT_NGUOI_NHAN: this.normalizePhone(this.newAddress.phone),
      TINH_THANH: selectedProvince.name,
      QUAN_HUYEN: selectedDistrict.name,
      PHUONG_XA: selectedWard.name,
      DIA_CHI_CHI_TIET: this.newAddress.detail,
      LA_MAC_DINH: this.newAddress.isDefault,
    };

    if (this.editingAddressId !== null) {
      const editedAddressId = this.editingAddressId;
      const updatedAddress: SavedAddress = {
        id: editedAddressId,
        name: payload.TEN_NGUOI_NHAN,
        phone: this.formatPhoneInput(payload.SDT_NGUOI_NHAN),
        fullAddress: [
          payload.DIA_CHI_CHI_TIET,
          payload.PHUONG_XA,
          payload.QUAN_HUYEN,
          payload.TINH_THANH,
        ].filter(Boolean).join(', '),
        provinceName: payload.TINH_THANH,
        districtName: payload.QUAN_HUYEN,
        wardName: payload.PHUONG_XA,
        isDefault: payload.LA_MAC_DINH,
      };

      this.closeAddAddressModal();

      this.customerService.updateAddress(editedAddressId, payload).subscribe({
        next: () => {
          const updatedList = this.savedAddresses.map(address => {
            if (address.id === editedAddressId) {
              return updatedAddress;
            }

            if (updatedAddress.isDefault) {
              return {
                ...address,
                isDefault: false,
              };
            }

            return address;
          });

          this.savedAddresses = this.sortAddressesByDefault(
            this.getUniqueAddresses([
              updatedAddress,
              ...updatedList.filter(address => address.id !== editedAddressId),
            ])
          );

          this.applySelectedAddress(updatedAddress);
        },
        error: (err) => {
          console.error('Lỗi sửa địa chỉ:', err);
        },
      });

      return;
    }

    this.customerService.addAddress(customerId, payload).subscribe({
      next: () => {
        this.loadCustomerAddresses();
        this.closeAddAddressModal();
      },
      error: (err) => {
        console.error('Lỗi thêm địa chỉ:', err);
      },
    });
  }

  // ===== DATE HELPERS =====
  toDisplayDate(date: string): string {
    if (!date) return '';
    if (date.includes('/')) return date;

    const [year, month, day] = date.split('-');

    if (!year || !month || !day) {
      return date;
    }

    return `${day}/${month}/${year}`;
  }

  toIsoDate(date: string): string {
    if (!date) return '';
    if (date.includes('-')) return date;

    const [day, month, year] = date.split('/');

    if (!day || !month || !year) {
      return '';
    }

    return `${year}-${month}-${day}`;
  }

  get minDeliveryIsoDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private parseDeliveryDateTime(): Date | null {
    const isoDate = this.toIsoDate(this.formData.deliveryDate);
    const time = String(this.formData.deliveryTime || '').trim();

    if (!isoDate || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
      return null;
    }

    const [year, month, day] = isoDate.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const deliveryDateTime = new Date(year, month - 1, day, hour, minute, 0, 0);

    return Number.isNaN(deliveryDateTime.getTime()) ? null : deliveryDateTime;
  }

  validateDeliverySchedule(): boolean {
    this.deliveryScheduleError = '';

    if (!this.formData.deliveryDate || !this.formData.deliveryTime) {
      return true;
    }

    const deliveryDateTime = this.parseDeliveryDateTime();

    if (!deliveryDateTime) {
      return true;
    }

    const minimumDeliveryTime = new Date(Date.now() + 3 * 60 * 60 * 1000);

    if (deliveryDateTime.getTime() < minimumDeliveryTime.getTime()) {
      this.deliveryScheduleError = 'Thời gian giao hàng phải sau thời điểm hiện tại ít nhất 3 giờ.';
      return false;
    }

    return true;
  }

  onDeliveryDatePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.deliveryDate = this.toDisplayDate(input.value);
    this.onDeliveryDateChange();
  }

  onDeliveryDateChange(): void {
    this.validateDeliverySchedule();
    this.onShippingMethodChange();
  }

  onDeliveryTimePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.deliveryTime = input.value;
    this.validateDeliverySchedule();
  }

  // ===== PHONE HELPERS =====
  formatPhoneInput(value: string): string {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 10);

    if (digits.length <= 4) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;

    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }

  normalizePhone(phone: string): string {
    return String(phone || '').replace(/\D/g, '');
  }

  onPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.phone = this.formatPhoneInput(input.value);
  }

  toggleLoyaltyPoints(): void {
    if (this.getMaxRedeemablePointsByBalance() <= 0) {
      this.useLoyaltyPoints = false;
      this.formData.loyaltyPoints = 0;
      return;
    }

    this.useLoyaltyPoints = !this.useLoyaltyPoints;

    if (this.useLoyaltyPoints && this.loyaltyPointsToUse <= 0) {
      this.useLoyaltyPoints = false;
      this.formData.loyaltyPoints = 0;
      return;
    }

    this.formData.loyaltyPoints = this.useLoyaltyPoints ? this.loyaltyPointsToUse : 0;
  }

  // ===== SUBMIT =====
  onSubmit(form?: NgForm): void {
    if (!isPlatformBrowser(this.platformId) || this.isSubmittingOrder) {
      return;
    }

    if (form?.invalid) {
      form.control.markAllAsTouched();
      return;
    }

    if (!this.validateDeliverySchedule()) {
      return;
    }

    if (!this.selectedAddress) {
      this.submitOrderError = 'Vui lòng chọn địa chỉ giao hàng.';
      return;
    }

    if (this.orderItems.length === 0) {
      this.router.navigate(['/cart']);
      return;
    }

    if (this.formData.paymentMethod === 'card') {
      this.paymentCardError = 'Hiện tại shop chưa hỗ trợ hình thức thanh toán này.';
      return;
    }

    this.paymentCardError = '';
    this.submitOrderError = '';

    const safeLoyaltyPoints = this.loyaltyPointsToUse;

    const senderName =
      this.currentCustomer?.TEN ||
      this.currentCustomer?.TEN_KHACH_HANG ||
      this.currentCustomer?.HO_TEN ||
      this.currentCustomer?.name ||
      '';

    const senderPhone = this.currentCustomer?.SDT || this.currentCustomer?.phone || '';
    const senderEmail = this.currentCustomer?.EMAIL || this.currentCustomer?.email || '';

    const receiverName = this.selectedAddress.name;
    const receiverPhone = this.normalizePhone(this.selectedAddress.phone);
    const receiverAddress = this.selectedAddress.fullAddress;

    const amountToPay = this.formData.paymentMethod === 'cod' && !this.isCashPaymentBlocked
      ? this.depositAmount
      : this.total;

    const registrantOrder = {
      orderType: 'registrant',
      status: 'pending',
      createdAt: new Date().toISOString(),
      customerId: this.getCustomerId(),

      sender: {
        name: senderName,
        phone: this.normalizePhone(senderPhone),
        email: senderEmail,
      },

      receiver: {
        name: receiverName,
        phone: receiverPhone,
        address: receiverAddress,
      },

      delivery: {
        date: this.formData.deliveryDate,
        time: this.formData.deliveryTime,
        message: this.formData.noteReceiver,
        noteShop: this.formData.noteShop,
      },

      form: {
        ...this.formData,
        phone: receiverPhone,
        loyaltyPoints: safeLoyaltyPoints,
      },

      selectedAddress: this.selectedAddress,
      shippingMethod: this.formData.shippingMethod,
      shippingMethodName: this.shippingMethodName,
      baseShippingFee: this.baseShippingFee,
      shippingVoucherDiscount: this.shippingVoucherDiscount,
      shippingFee: this.shippingFee,
      shippingTimeEstimate: this.shippingTimeEstimate,
      items: this.orderItems,
      voucher: this.selectedVoucher,
      subtotal: this.subtotal,
      productVoucherDiscount: this.productVoucherDiscount,
      discount: this.discount,
      loyaltyDiscount: this.loyaltyDiscount,
      total: this.total,
      paymentMethod: this.formData.paymentMethod,
      paymentMethodName: this.paymentMethodName,
      paymentPolicy: this.currentPaymentPolicy,
      depositAmount: this.depositAmount,
      remainingAmount: this.remainingAmount,
      amountToPay,
      flags: {
        hideSender: this.formData.hideSender,
        requestVAT: this.formData.requestVAT,
        sendZaloPhoto: this.formData.sendZaloPhoto,
      },
    };

    const payload: CreateOrderPayload = {
      customerId: this.getCustomerId(),
      receiver: {
        name: receiverName,
        phone: receiverPhone,
        address: receiverAddress,
      },
      sender: {
        name: senderName,
        phone: this.normalizePhone(senderPhone),
        email: senderEmail,
      },
      delivery: {
        date: this.formData.deliveryDate,
        time: this.formData.deliveryTime,
        message: this.formData.noteReceiver,
        noteShop: this.formData.noteShop,
      },
      items: this.orderItems.map(item => ({
        id: item.id,
        name: item.name,
        qty: item.qty,
        price: item.price,
      })),
      voucher: this.selectedVoucher
        ? {
            id: this.selectedVoucher.id,
            code: this.selectedVoucher.code,
            type: this.selectedVoucher.type,
            value: this.selectedVoucher.value,
          }
        : null,
      summary: {
        subtotal: this.subtotal,
        shippingFee: this.shippingFee,
        depositAmount: this.depositAmount,
        loyaltyPoints: safeLoyaltyPoints,
        loyaltyDiscount: this.loyaltyDiscount,
        total: this.total,
      },
      payment: {
        method: this.formData.paymentMethod,
        methodName: this.paymentMethodName,
        amountToPay,
      },
      flags: {
        hideSender: this.formData.hideSender,
        requestVAT: this.formData.requestVAT,
        sendZaloPhoto: this.formData.sendZaloPhoto,
      },
    };

    this.isSubmittingOrder = true;

    this.orderService.createOrder(payload).subscribe({
      next: (createdOrder: CreateOrderResponse) => {
        const registrantOrderWithPayment = {
          ...registrantOrder,
          createdOrder,
          orderId: createdOrder.orderId,
          paymentId: createdOrder.paymentId,
          transactionCode: createdOrder.transactionCode,
          paymentAmount: createdOrder.paymentAmount,
          paymentDeadline: createdOrder.paymentDeadline,
          paymentStatus: createdOrder.paymentStatus,
          orderStatus: createdOrder.orderStatus,
        };

        localStorage.setItem(
          this.registrantOrderStorageKey,
          JSON.stringify(registrantOrderWithPayment)
        );

        localStorage.setItem(
          this.createdOrderStorageKey,
          JSON.stringify(createdOrder)
        );

        if (this.selectedAddress) {
          this.saveRecentOrderAddress(this.selectedAddress);
        }

        localStorage.removeItem(this.checkoutItemsStorageKey);

        this.isSubmittingOrder = false;
        this.router.navigate(['/checkout']);
      },
      error: (err: unknown) => {
        console.error('Lỗi tạo đơn hàng:', err);
        this.submitOrderError = 'Không thể tạo đơn hàng. Vui lòng kiểm tra backend và thử lại.';
        this.isSubmittingOrder = false;
      },
    });
  }
}
