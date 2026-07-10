import {
  Component,
  OnInit,
  inject,
  PLATFORM_ID,
  HostListener,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { CreateOrderPayload, CreateOrderResponse, OrderService } from '../../../services/order.service';

export interface OrderItem {
  id: string;
  name: string;
  image: string;
  qty: number;
  price: number;
}

interface CartStorageItem {
  id: string;
  name: string;
  style?: string;
  occasion?: string;
  price: number;
  originalPrice?: number | null;
  quantity: number;
  image: string;
  selected?: boolean;
  maxQuantity?: number;
}

export interface Voucher {
  id: string;
  code: string;
  title: string;
  desc: string;
  type: string;
  value: number;
  discountAmount?: number;
}

export interface PaymentMethod {
  value: string;
  label: string;
  icon?: string;
  logo?: string;
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

export interface ShippingMethod {
  value: 'standard' | 'fast';
  label: string;
  desc: string;
}

type AddrDropdownType = 'province' | 'district' | 'ward' | null;

@Component({
  selector: 'app-order',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './order-haunt.html',
  styleUrl: './order-haunt.css',
})
export class OrderHauntComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  private orderService = inject(OrderService);

  private static publicVouchersCache: Voucher[] | null = null;
  private static provincesCache: Province[] | null = null;

  /**
   * Giỏ hàng khách chưa đăng nhập.
   * Trang order-haunt tuyệt đối không đọc database.
   */
  private readonly cartStorageKey = 'tiemHoaYenCart';

  /**
   * CartComponent sẽ lưu các sản phẩm đã chọn vào key này trước khi qua order-haunt.
   * Nhờ vậy order-haunt chỉ đặt những sản phẩm đã chọn, không lấy toàn bộ giỏ hàng.
   */
  private readonly checkoutItemsStorageKey = 'tiemHoaYenCheckoutItems';

  private readonly guestOrderStorageKey = 'tiemHoaYenGuestOrder';
  private readonly defaultImage = 'assets/images/hoa.jpg';
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

  showVoucherDropdown = false;
  selectedVoucher: Voucher | null = null;
  paymentError = '';
  submitOrderError = '';
  voucherError = '';
  isSubmitting = false;

  availableVouchers: Voucher[] = [];
  isLoadingPublicVouchers = false;

  /**
   * Khách vãng lai chỉ áp dụng chính sách cọc khi chọn COD.
   * Momo / VNPay / Chuyển khoản sẽ thanh toán toàn bộ tổng đơn, tiền cọc = 0.
   * Tiền cọc tính theo TẠM TÍNH sản phẩm, không tính phí ship.
   */
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

  provinces: Province[] = [];
  availableDistricts: District[] = [];
  availableWards: Ward[] = [];
  openAddrDropdown: AddrDropdownType = null;

  orderItems: OrderItem[] = [];

  paymentMethods: PaymentMethod[] = [
    {
      value: 'cod',
      label: 'Thanh toán khi nhận hàng (COD)',
      icon: 'bi-cash-coin',
    },
    {
      value: 'momo',
      label: 'Momo',
      logo: 'assets/images/momo.png',
    },
    {
      value: 'vnpay',
      label: 'VNPay',
      logo: 'assets/images/vnpay.jpg',
    },
    {
      value: 'bank',
      label: 'Chuyển khoản ngân hàng',
      icon: 'bi-bank',
    },
    {
      value: 'card',
      label: 'Thẻ ngân hàng',
      icon: 'bi-credit-card',
    },
  ];

  formData = {
    senderName: '',
    senderPhone: '',
    senderEmail: '',
    deliverToSelf: false,
    deliverToOther: false,
    receiverName: '',
    receiverPhone: '',
    address: '',
    provinceCode: '',
    districtCode: '',
    wardCode: '',
    deliveryDate: '',
    deliveryTime: '',
    noteReceiver: '',
    noteShop: '',
    hideSender: false,
    requestVAT: false,
    sendZaloPhoto: false,
    voucherCode: '',
    paymentMethod: 'cod',
    shippingMethod: 'standard',
  };

  deliveryScheduleError = '';
  hasTriedSubmit = false;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.loadVietnamAddressData();
    this.loadOrderItemsFromCart();
    this.loadPublicVouchers();
  }

  private loadOrderItemsFromCart(): void {
    const checkoutItems = this.readCartArray(this.checkoutItemsStorageKey);
    const sourceItems = checkoutItems.length > 0
      ? checkoutItems
      : this.readCartArray(this.cartStorageKey).filter(item => item.selected !== false);

    this.orderItems = sourceItems.map((item: CartStorageItem) => ({
      id: String(item.id || ''),
      name: String(item.name || ''),
      image: String(item.image || this.defaultImage),
      qty: Math.max(1, Number(item.quantity || 1)),
      price: Number(item.price || 0),
    }));

    if (this.orderItems.length === 0) {
      this.router.navigate(['/cart']);
    }
  }

  private readCartArray(storageKey: string): CartStorageItem[] {
    if (!isPlatformBrowser(this.platformId)) {
      return [];
    }

    const rawCart = localStorage.getItem(storageKey);

    if (!rawCart) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawCart);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error(`Lỗi đọc ${storageKey}:`, error);
      return [];
    }
  }

  private loadPublicVouchers(): void {
    this.isLoadingPublicVouchers = true;

    if (OrderHauntComponent.publicVouchersCache) {
      this.availableVouchers = OrderHauntComponent.publicVouchersCache;
      this.isLoadingPublicVouchers = false;
      return;
    }

    fetch('https://tiem-hoa-yen-api.onrender.com/api/orders/public-vouchers')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Không thể lấy voucher công khai: ${response.status}`);
        }

        return response.json();
      })
      .then((res: { vouchers?: any[] }) => {
        const vouchers = Array.isArray(res?.vouchers) ? res.vouchers : [];

        this.availableVouchers = vouchers.map((item: any) => {
          const type = String(item.LOAI_GIAM_GIA || item.type || '').trim();
          const value = Number(item.GIA_TRI_GIAM ?? item.value ?? 0);
          const code = String(item.MA_VOUCHER || item.code || '').trim().toUpperCase();

          return {
            id: String(item.VOUCHER_ID || item.id || ''),
            code,
            title: this.buildVoucherTitle(type, value),
            desc: this.buildVoucherDesc(type, value),
            type,
            value,
          };
        });

        OrderHauntComponent.publicVouchersCache = this.availableVouchers;
        this.isLoadingPublicVouchers = false;
      })
      .catch((error) => {
        console.error('Lỗi load voucher công khai:', error);
        this.availableVouchers = [];
        this.isLoadingPublicVouchers = false;
      });
  }

  private buildVoucherTitle(type: string, value: number): string {
    if (this.isPercentVoucherType(type)) {
      return `Giảm ${value}% đơn hàng`;
    }

    return `Giảm ${value.toLocaleString('vi-VN')}đ phí ship`;
  }

  private buildVoucherDesc(type: string, value: number): string {
    if (this.isPercentVoucherType(type)) {
      return 'Áp dụng cho khách vãng lai';
    }

    return 'Áp dụng cho phí vận chuyển';
  }


  loadVietnamAddressData(): void {
    if (OrderHauntComponent.provincesCache) {
      this.provinces = OrderHauntComponent.provincesCache;

      if (this.provinces.length === 1) {
        const defaultProvince = this.provinces[0];

        this.formData.provinceCode = defaultProvince.code;
        this.availableDistricts = defaultProvince.districts || [];
        this.formData.districtCode = '';
        this.formData.wardCode = '';
        this.availableWards = [];
      }

      return;
    }

    fetch('/assets/address/vietnam-address-old.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Không tìm thấy file JSON: ${response.status}`);
        }

        return response.json();
      })
      .then((data: Province[]) => {
        this.provinces = data;
        OrderHauntComponent.provincesCache = data;

        if (this.provinces.length === 1) {
          const defaultProvince = this.provinces[0];

          this.formData.provinceCode = defaultProvince.code;
          this.availableDistricts = defaultProvince.districts || [];
          this.formData.districtCode = '';
          this.formData.wardCode = '';
          this.availableWards = [];
        }
      })
      .catch((error) => {
        console.error('Không tải được dữ liệu địa chỉ:', error);
      });
  }

  get selectedProvinceName(): string {
    const found = this.provinces.find(
      (province) => province.code === this.formData.provinceCode
    );

    return found ? found.name : 'Tỉnh/Thành phố';
  }

  get selectedDistrictName(): string {
    const found = this.availableDistricts.find(
      (district) => district.code === this.formData.districtCode
    );

    return found ? found.name : 'Quận/Huyện';
  }

  get selectedWardName(): string {
    const found = this.availableWards.find(
      (ward) => ward.code === this.formData.wardCode
    );

    return found ? found.name : 'Phường/Xã';
  }

  onProvinceChange(): void {
    const selectedProvince = this.provinces.find(
      (province) => province.code === this.formData.provinceCode
    );

    this.formData.districtCode = '';
    this.formData.wardCode = '';
    this.availableDistricts = [];
    this.availableWards = [];

    if (!selectedProvince) {
      return;
    }

    this.availableDistricts = selectedProvince.districts;
  }

  onDistrictChange(): void {
    const selectedDistrict = this.availableDistricts.find(
      (district) => district.code === this.formData.districtCode
    );

    this.formData.wardCode = '';
    this.availableWards = [];

    if (!selectedDistrict) {
      return;
    }

    this.availableWards = selectedDistrict.wards;
  }

  toggleAddrDropdown(type: 'province' | 'district' | 'ward', disabled: boolean): void {
    if (disabled) {
      return;
    }

    this.openAddrDropdown = this.openAddrDropdown === type ? null : type;
  }

  selectProvince(province: Province): void {
    this.formData.provinceCode = province.code;
    this.openAddrDropdown = null;
    this.onProvinceChange();
  }

  selectDistrict(district: District): void {
    this.formData.districtCode = district.code;
    this.openAddrDropdown = null;
    this.onDistrictChange();
  }

  selectWard(ward: Ward): void {
    this.formData.wardCode = ward.code;
    this.openAddrDropdown = null;
  }

  toDisplayDate(date: string): string {
    if (!date) {
      return '';
    }

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
    if (!date) {
      return '';
    }

    if (date.includes('-')) {
      return date;
    }

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

  normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  onSenderPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.senderPhone = this.formatPhoneInput(input.value);

    if (this.formData.deliverToSelf) {
      this.formData.receiverPhone = this.formData.senderPhone;
    }
  }

  onReceiverPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formData.receiverPhone = this.formatPhoneInput(input.value);
  }

  onDeliverToSelfChange(): void {
    if (this.formData.deliverToSelf) {
      this.formData.deliverToOther = false;
      this.formData.receiverName = this.formData.senderName;
      this.formData.receiverPhone = this.formData.senderPhone;
    }
  }

  onDeliverToOtherChange(): void {
    if (this.formData.deliverToOther) {
      this.formData.deliverToSelf = false;
      this.formData.receiverName = '';
      this.formData.receiverPhone = '';
    }
  }

  toggleVoucherDropdown(): void {
    this.showVoucherDropdown = !this.showVoucherDropdown;
  }

  goToLogin(): void {
    this.showVoucherDropdown = false;
    this.router.navigate(['/login']);
  }

  selectVoucher(_voucher: Voucher): void {
    // Khách vãng lai không chọn voucher từ dropdown.
    // Voucher công khai chỉ được nhập bằng mã ở ô bên trái.
    this.showVoucherDropdown = false;
  }

  applyVoucher(): void {
    const voucherCode = this.formData.voucherCode.trim().toUpperCase();
    this.voucherError = '';

    if (!voucherCode) {
      this.selectedVoucher = null;
      return;
    }

    const found = this.availableVouchers.find(
      (voucher) => voucher.code.toUpperCase() === voucherCode
    );

    if (!found) {
      this.selectedVoucher = null;
      this.voucherError = 'Voucher không hợp lệ.';
      return;
    }

    this.selectedVoucher = found;
    this.formData.voucherCode = found.code;
  }

  onVoucherCodeChange(): void {
    this.voucherError = '';
  }

  private isPercentVoucherType(type: string): boolean {
    const value = this.normalizeText(type);
    return value.includes('phan tram') || value.includes('percent') || value.includes('%');
  }

  private isCashVoucherType(type: string): boolean {
    const value = this.normalizeText(type);
    return value.includes('tien mat') || value.includes('cash') || value.includes('fixed');
  }

  private getSelectedVoucherPayload(): any | null {
    if (!this.selectedVoucher) {
      return null;
    }

    return {
      id: this.selectedVoucher.id,
      code: this.selectedVoucher.code,
      type: this.selectedVoucher.type,
      value: this.selectedVoucher.value,
      discountAmount: this.discount,
    };
  }


  selectPaymentMethod(methodValue: string): void {
    if (this.isPaymentMethodDisabled(methodValue)) {
      this.formData.paymentMethod = 'card';
      this.paymentError = 'Hiện tại shop chưa hỗ trợ hình thức thanh toán bằng thẻ ngân hàng.';
      return;
    }

    this.formData.paymentMethod = methodValue;
    this.paymentError = '';
  }

  onPaymentMethodChange(methodValue?: string): void {
    if (methodValue) {
      this.formData.paymentMethod = methodValue;
    }

    if (this.formData.paymentMethod === 'card') {
      this.paymentError = 'Hiện tại shop chưa hỗ trợ hình thức thanh toán bằng thẻ ngân hàng.';
      return;
    }

    this.paymentError = '';
  }

  get subtotal(): number {
    return this.orderItems.reduce(
      (sum, item) => sum + item.price * item.qty,
      0
    );
  }

  get shippingFee(): number {
    if (this.orderItems.length === 0) {
      return 0;
    }

    if (!this.formData.districtCode) {
      return 0;
    }

    const isInner = this.isInnerDistrict;
    const isFast = this.formData.shippingMethod === 'fast';

    if (isInner && isFast) {
      if (this.subtotal < 300000) {
        return 60000;
      }

      if (this.subtotal <= 500000) {
        return 30000;
      }

      return 0;
    }

    if (isInner && !isFast) {
      if (this.subtotal < 300000) {
        return 30000;
      }

      return 0;
    }

    if (!isInner && isFast) {
      if (this.subtotal < 300000) {
        return 80000;
      }

      if (this.subtotal <= 500000) {
        return 40000;
      }

      return 30000;
    }

    if (this.subtotal < 300000) {
      return 40000;
    }

    if (this.subtotal <= 500000) {
      return 20000;
    }

    return 0;
  }

  get shippingMethodName(): string {
    const found = this.shippingMethods.find(
      method => method.value === this.formData.shippingMethod
    );

    return found ? found.label : 'Giao tiêu chuẩn';
  }

  get shippingTimeEstimate(): string {
    const isInner = this.isInnerDistrict;
    const isFast = this.formData.shippingMethod === 'fast';

    if (!this.formData.districtCode) {
      return 'Vui lòng chọn quận/huyện';
    }

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

  get isInnerDistrict(): boolean {
    const selectedDistrict = this.availableDistricts.find(
      district => district.code === this.formData.districtCode
    );

    if (!selectedDistrict) {
      return false;
    }

    return this.innerDistrictNames.some(
      districtName => this.normalizeText(districtName) === this.normalizeText(selectedDistrict.name)
    );
  }

  get shippingAreaName(): string {
    if (!this.formData.districtCode) {
      return 'Chưa chọn khu vực';
    }

    return this.isInnerDistrict
      ? 'Nội thành Thành phố Hồ Chí Minh'
      : 'Ngoại thành Thành phố Hồ Chí Minh';
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

  get productVoucherDiscount(): number {
    if (!this.selectedVoucher || !this.isPercentVoucherType(this.selectedVoucher.type)) {
      return 0;
    }

    return Math.round((this.subtotal * this.selectedVoucher.value) / 100);
  }

  get shippingVoucherDiscount(): number {
    if (!this.selectedVoucher || !this.isCashVoucherType(this.selectedVoucher.type)) {
      return 0;
    }

    return Math.min(this.shippingFee, Math.max(0, this.selectedVoucher.value));
  }

  get discount(): number {
    return this.productVoucherDiscount + this.shippingVoucherDiscount;
  }

  get total(): number {
    return Math.max(0, this.subtotal + this.shippingFee - this.discount);
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
      this.paymentError = '';
    }
  }

  get isCodPayment(): boolean {
    return this.formData.paymentMethod === 'cod';
  }

  get showDepositPolicy(): boolean {
    return this.isCodPayment && !this.isCashPaymentBlocked && !!this.currentPaymentPolicy;
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

  get amountToPay(): number {
    if (this.isCodPayment && !this.isCashPaymentBlocked) {
      return this.depositAmount;
    }

    return this.total;
  }

  get paymentMethodName(): string {
    const method = this.paymentMethods.find(item => item.value === this.formData.paymentMethod);
    return method ? method.label : '';
  }

  get isUnsupportedCardPayment(): boolean {
    return this.formData.paymentMethod === 'card';
  }

  onSubmit(form?: NgForm): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (this.isSubmitting) {
      return;
    }

    this.submitOrderError = '';
    this.hasTriedSubmit = true;

    if (this.orderItems.length === 0) {
      this.router.navigate(['/cart']);
      return;
    }

    if (form?.invalid) {
      form.control.markAllAsTouched();
      return;
    }

    if (!this.validateDeliverySchedule()) {
      return;
    }

    if (this.isUnsupportedCardPayment) {
      this.paymentError = 'Hiện tại shop chưa hỗ trợ hình thức thanh toán bằng thẻ ngân hàng.';
      return;
    }

    if (!this.formData.provinceCode || !this.formData.districtCode || !this.formData.wardCode) {
      form?.control.markAllAsTouched();
      return;
    }

    if (this.formData.deliverToSelf) {
      this.formData.receiverName = this.formData.senderName;
      this.formData.receiverPhone = this.formData.senderPhone;
    }

    const receiverPhone = this.normalizePhone(this.formData.receiverPhone);
    const senderPhone = this.normalizePhone(this.formData.senderPhone);
    const receiverAddress = this.fullReceiverAddress;
    const orderForCheckout = this.buildGuestOrderForCheckout(receiverAddress, receiverPhone, senderPhone);
    const payload = this.buildCreateOrderPayload(orderForCheckout, receiverAddress, receiverPhone, senderPhone);

    this.isSubmitting = true;

    this.orderService.createOrder(payload).subscribe({
      next: (createdOrder: CreateOrderResponse) => {
        const finalOrderForCheckout = {
          ...orderForCheckout,
          orderCode: createdOrder.orderId,
          orderId: createdOrder.orderId,
          paymentId: createdOrder.paymentId,
          transactionCode: createdOrder.transactionCode,
          paymentDeadline: createdOrder.paymentDeadline,
          amountToPay: createdOrder.paymentAmount,
          status: createdOrder.orderStatus,
        };

        localStorage.setItem(this.guestOrderStorageKey, JSON.stringify(finalOrderForCheckout));
        localStorage.setItem('tiemHoaYenRegistrantOrder', JSON.stringify(finalOrderForCheckout));
        localStorage.setItem('tiemHoaYenCreatedOrder', JSON.stringify(createdOrder));

        // Không xóa giỏ hàng tại đây. Giỏ chỉ nên xóa sau khi thanh toán thành công.
        // Checkout sẽ dùng dữ liệu trong tiemHoaYenRegistrantOrder và tiemHoaYenCreatedOrder.
        this.isSubmitting = false;
        this.router.navigate(['/checkout']);
      },
      error: (err: any) => {
        console.error('Lỗi tạo đơn khách vãng lai:', err);
        this.isSubmitting = false;
        this.submitOrderError = err?.error?.message || 'Không thể tạo đơn hàng. Vui lòng thử lại.';
      },
    });
  }

  private get fullReceiverAddress(): string {
    return [
      this.formData.address,
      this.selectedWardName,
      this.selectedDistrictName,
      this.selectedProvinceName,
    ]
      .map(value => String(value || '').trim())
      .filter(value => !!value && !['Phường/Xã', 'Quận/Huyện', 'Tỉnh/Thành phố'].includes(value))
      .join(', ');
  }

  private buildGuestOrderForCheckout(
    receiverAddress: string,
    receiverPhone: string,
    senderPhone: string,
  ): any {
    return {
      orderCode: '',
      orderId: '',
      orderType: 'guest',
      customerId: null,
      status: 'Chờ thanh toán',
      createdAt: new Date().toISOString(),
      form: {
        ...this.formData,
        provinceName: this.selectedProvinceName,
        districtName: this.selectedDistrictName,
        wardName: this.selectedWardName,
        senderPhone,
        receiverPhone,
      },
      selectedAddress: {
        name: this.formData.receiverName,
        phone: receiverPhone,
        fullAddress: receiverAddress,
      },
      receiver: {
        name: this.formData.receiverName,
        phone: receiverPhone,
        address: receiverAddress,
      },
      sender: {
        name: this.formData.senderName,
        phone: senderPhone,
        email: this.formData.senderEmail,
      },
      delivery: {
        date: this.formData.deliveryDate,
        time: this.formData.deliveryTime,
        message: this.formData.noteReceiver,
        noteShop: this.formData.noteShop,
      },
      shippingAreaName: this.shippingAreaName,
      shippingMethod: this.formData.shippingMethod,
      shippingMethodName: this.shippingMethodName,
      shippingTimeEstimate: this.shippingTimeEstimate,
      items: this.orderItems,
      voucher: this.getSelectedVoucherPayload(),
      subtotal: this.subtotal,
      baseShippingFee: this.shippingFee,
      shippingVoucherDiscount: this.shippingVoucherDiscount,
      shippingFee: this.shippingFee,
      productVoucherDiscount: this.productVoucherDiscount,
      loyaltyDiscount: 0,
      discount: this.discount,
      total: this.total,
      paymentMethod: this.formData.paymentMethod,
      paymentMethodName: this.paymentMethodName,
      paymentPolicy: this.formData.paymentMethod === 'cod' ? this.currentPaymentPolicy : null,
      depositAmount: this.depositAmount,
      remainingAmount: this.remainingAmount,
      amountToPay: this.amountToPay,
      flags: {
        hideSender: this.formData.hideSender,
        requestVAT: this.formData.requestVAT,
        sendZaloPhoto: this.formData.sendZaloPhoto,
      },
      guestCartItemIds: this.orderItems.map(item => item.id),
    };
  }

  private buildCreateOrderPayload(
    orderForCheckout: any,
    receiverAddress: string,
    receiverPhone: string,
    senderPhone: string,
  ): CreateOrderPayload {
    return {
      customerId: null,
      receiver: {
        name: this.formData.receiverName,
        phone: receiverPhone,
        address: receiverAddress,
      },
      sender: {
        name: this.formData.senderName,
        phone: senderPhone,
        email: this.formData.senderEmail,
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
      voucher: this.getSelectedVoucherPayload(),
      summary: {
        subtotal: this.subtotal,
        shippingFee: this.shippingFee,
        depositAmount: this.depositAmount,
        loyaltyDiscount: 0,
        total: this.total,
      },
      payment: {
        method: this.formData.paymentMethod,
        methodName: this.paymentMethodName,
        amountToPay: this.amountToPay,
      },
      flags: orderForCheckout.flags,
    };
  }

  private removeOrderedItemsFromGuestCart(): void {
    const currentCart = this.readCartArray(this.cartStorageKey);

    if (currentCart.length === 0) {
      return;
    }

    const orderedIds = new Set(this.orderItems.map(item => item.id));
    const remainingCart = currentCart.filter(item => !orderedIds.has(String(item.id || '')));

    if (remainingCart.length > 0) {
      localStorage.setItem(this.cartStorageKey, JSON.stringify(remainingCart));
      return;
    }

    localStorage.removeItem(this.cartStorageKey);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    if (this.openAddrDropdown && !target.closest('.addr-custom-select-wrap')) {
      this.openAddrDropdown = null;
    }

    if (this.showVoucherDropdown && !target.closest('.voucher-select-wrapper')) {
      this.showVoucherDropdown = false;
    }
  }
}
