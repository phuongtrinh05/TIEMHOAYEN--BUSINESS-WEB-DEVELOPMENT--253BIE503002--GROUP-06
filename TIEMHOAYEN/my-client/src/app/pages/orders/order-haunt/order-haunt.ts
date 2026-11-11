import {
  Component,
  OnInit,
  inject,
  PLATFORM_ID,
  HostListener,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { CreateOrderPayload, CreateOrderResponse, OrderService } from '../../../services/order.service';
import { apiBaseUrl } from '../../../services/api-config';
import { SalesRequestResultComponent } from '../sales-request-result/sales-request-result';
import { PricingService, ServerQuote, SHOP_PHONE, deliveryTimeSlots, isUrgentDelivery } from '../../../services/pricing.service';

export interface OrderItem {
  requiresReview?: boolean;
  id: string;
  lineKey: string;
  variantId?: string | null;
  designId?: string | null;
  configuration?: Record<string, unknown>;
  name: string;
  image: string;
  qty: number;
  price: number;
  maxQuantity?: number;
}

interface CartStorageItem {
  requiresReview?: boolean; CAN_SHOP_DUYET?: boolean;
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
  lineKey?: string;
  variantId?: string | null;
  designId?: string | null;
  configuration?: Record<string, unknown>;
}

export interface Voucher {
  id: string;
  code: string;
  title: string;
  desc: string;
  type: string;
  value: number;
  discountAmount?: number;
  endDate?: string | null;
  eligible?: boolean;
  reason?: string;
  estimatedDiscount?: number;
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
  imports: [CommonModule, FormsModule, SalesRequestResultComponent],
  templateUrl: './order-haunt.html',
  styleUrl: './order-haunt.css',
})
export class OrderHauntComponent implements OnInit {
  private readonly pricingService = inject(PricingService);
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  private orderService = inject(OrderService);
  private cdr = inject(ChangeDetectorRef);
  cardTemplates: any[] = [];
  selectedCardTemplateId = '';
  cardWritingMode: '' | 'customer' | 'shop' = '';

  private static publicVouchersCache: Voucher[] | null = null;
  private static provincesCache: Province[] | null = null;

  private readonly cartStorageKey = 'tiemHoaYenCart';

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
      desc: 'Ưu tiên xử lý; thời gian thực tế theo khung giao đã chọn',
    },
  ];

  showVoucherDropdown = false;
  selectedVoucher: Voucher | null = null;
  paymentError = '';
  submitOrderError = '';
  salesRequestId = '';
  salesRequestMessage = '';
  voucherError = '';
  private voucherSelectionTouched = false;
  isSubmitting = false;

  availableVouchers: Voucher[] = [];
  isLoadingPublicVouchers = false;

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

  get hasDesignReview(): boolean { return this.orderItems.some(i=>!!i.requiresReview); }
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
    this.orderService.getCardTemplates().subscribe({ next: value => this.cardTemplates = value.templates || [], error: () => this.cardTemplates = [] });
  }

  private loadOrderItemsFromCart(): void {
    const checkoutItems = this.readCartArray(this.checkoutItemsStorageKey);
    const sourceItems = checkoutItems.length > 0
      ? checkoutItems
      : this.readCartArray(this.cartStorageKey).filter(item => item.selected !== false);

    this.orderItems = sourceItems.map((item: CartStorageItem) => ({
      id: String(item.id || ''),
      lineKey: String(item.lineKey || item.id || ''),
      variantId: item.variantId || null,
      designId: item.designId || null,
      configuration: item.configuration || {},
      name: String(item.name || ''),
      image: String(item.image || this.defaultImage),
      qty: Math.max(1, Number(item.quantity || 1)),
      price: Number(item.price || 0),
      maxQuantity: Number(item.maxQuantity) > 0 ? Number(item.maxQuantity) : undefined,
    }));
    this.refreshServerQuote();

    if (this.orderItems.length === 0) {
      this.router.navigate(['/cart']);
    }
  }

  /** Giới hạn tăng: tồn kho từ giỏ (nếu có), tối đa 99. Máy chủ vẫn kiểm tra lại khi báo giá/đặt hàng. */
  itemMaxQty(item: OrderItem): number {
    return Math.min(99, item.maxQuantity && item.maxQuantity > 0 ? item.maxQuantity : 99);
  }

  changeItemQty(item: OrderItem, delta: number): void {
    if (this.salesRequestId || this.isSubmitting) return;
    const next = Math.min(this.itemMaxQty(item), Math.max(1, item.qty + delta));
    if (next === item.qty) return;
    item.qty = next;
    this.submitOrderError = '';
    this.syncQtyToStorage(item);
    this.refreshServerQuote();
  }

  /** Giữ số lượng trong giỏ và danh sách thanh toán khớp với khung đơn hàng. */
  private syncQtyToStorage(item: OrderItem): void {
    for (const key of [this.checkoutItemsStorageKey, this.cartStorageKey]) {
      const rows = this.readCartArray(key);
      let changed = false;
      for (const row of rows) {
        if (String(row.lineKey || row.id || '') === item.lineKey) {
          row.quantity = item.qty;
          changed = true;
        }
      }
      if (changed) {
        try { localStorage.setItem(key, JSON.stringify(rows)); } catch { /* bộ nhớ trình duyệt bị chặn: vẫn đặt hàng theo số lượng trên trang */ }
      }
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

  private voucherListVersion = 0;
  /** Voucher công khai cho khách vãng lai, đánh giá theo giỏ hàng bằng cùng bộ luật với lúc đặt (mục 1.2, 6). */
  private loadPublicVouchers(): void {
    this.isLoadingPublicVouchers = true;
    const version = ++this.voucherListVersion;
    this.pricingService.availableVouchers({
      items: this.orderItems.map(item => ({ id: item.id, quantity: item.qty })),
      shippingFee: this.shippingFee,
    }).subscribe({
      next: ({ vouchers }) => {
        if (version !== this.voucherListVersion) return;
        this.availableVouchers = (vouchers || []).filter(v => v.kind === 'voucher').map(v => ({
          id: v.id, code: String(v.code || '').toUpperCase(),
          title: this.buildVoucherTitle(String(v.type || ''), Number(v.value || 0)),
          desc: this.buildVoucherDesc(String(v.type || ''), Number(v.value || 0)),
          type: String(v.type || ''), value: Number(v.value || 0), endDate: v.endDate || null,
          eligible: v.eligible, reason: v.reason, estimatedDiscount: v.estimatedDiscount,
        }));
        if (this.selectedVoucher?.id) {
          const current = this.availableVouchers.find(v => v.id === this.selectedVoucher!.id);
          if (!current || current.eligible === false) {
            this.clearVoucher(undefined, false);
            this.voucherError = current?.reason || 'Voucher không còn áp dụng được cho đơn này.';
          }
        }
        if (!this.voucherSelectionTouched) {
          const best = this.availableVouchers.find(v => v.eligible !== false) || null;
          if (best && this.selectedVoucher?.id !== best.id) {
            this.selectedVoucher = best;
            this.formData.voucherCode = best.code;
            this.refreshServerQuote(false);
          }
        }
        this.isLoadingPublicVouchers = false;
        this.cdr.detectChanges();
      },
      error: () => {
        if (version !== this.voucherListVersion) return;
        this.availableVouchers = [];
        this.isLoadingPublicVouchers = false;
        this.cdr.detectChanges();
      },
    });
  }

  private buildVoucherTitle(type: string, value: number): string {
    if (this.isPercentVoucherType(type)) {
      return `Giảm ${value}% đơn hàng`;
    }

    return `Giảm ${value.toLocaleString('vi-VN')}đ ${this.isCashVoucherType(type) ? 'phí ship' : 'tiền hàng'}`;
  }

  private buildVoucherDesc(type: string, value: number): string {
    if (this.isPercentVoucherType(type)) {
      return 'Áp dụng cho khách vãng lai';
    }

    return this.isCashVoucherType(type) ? 'Áp dụng cho phí vận chuyển' : 'Áp dụng cho tiền hàng';
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
    // Phí giao và khả năng đáp ứng phụ thuộc quận/huyện: báo giá lại.
    this.refreshServerQuote();
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

  // ===== GIỜ GIAO: 08:00–22:00, khung 30 phút; dưới 4 giờ phải gọi shop =====
  urgentDeliveryPopup = false;
  readonly shopPhone = SHOP_PHONE;

  get deliveryTimeOptions(): string[] {
    const isoDate = this.toIsoDate(this.formData.deliveryDate);
    return deliveryTimeSlots(/^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : '');
  }

  isUrgentSlot(slot: string): boolean {
    const isoDate = this.toIsoDate(this.formData.deliveryDate);
    return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) && isUrgentDelivery(isoDate, slot);
  }

  get quoteNeedsRequest(): boolean {
    return this.serverQuote?.fulfillment?.mode === 'request';
  }

  get quoteRequestReasons(): string[] {
    return this.serverQuote?.fulfillment?.reasons || [];
  }

  validateDeliverySchedule(): boolean {
    this.deliveryScheduleError = '';
    if (!this.formData.deliveryDate || !this.formData.deliveryTime) return true;
    const isoDate = this.toIsoDate(this.formData.deliveryDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return true;
    if (!this.deliveryTimeOptions.includes(this.formData.deliveryTime)) {
      this.deliveryScheduleError = 'Vui lòng chọn giờ giao trong khung 08:00–22:00 và chưa qua.';
      return false;
    }
    if (isUrgentDelivery(isoDate, this.formData.deliveryTime)) {
      this.urgentDeliveryPopup = true;
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
    // Giờ đã chọn không còn trong danh sách của ngày mới (đã qua) thì bỏ chọn.
    const isoDate = this.toIsoDate(this.formData.deliveryDate);
    if (this.formData.deliveryTime && /^\d{4}-\d{2}-\d{2}$/.test(isoDate) && !this.deliveryTimeOptions.includes(this.formData.deliveryTime)) {
      this.formData.deliveryTime = '';
    }
    this.onDeliveryScheduleChanged();
    this.onShippingMethodChange();
  }

  onDeliveryTimeChange(): void {
    this.onDeliveryScheduleChanged();
  }

  private onDeliveryScheduleChanged(): void {
    // Giao gấp dưới 4 giờ: hiện popup và bỏ giờ đã chọn để không đặt được.
    if (!this.validateDeliverySchedule() && this.urgentDeliveryPopup) this.formData.deliveryTime = '';
    this.refreshServerQuote();
  }

  closeUrgentDeliveryPopup(): void {
    this.urgentDeliveryPopup = false;
  }

  /** Lỗi lịch giao từ backend: giao gấp → popup; ngoài giờ/đã qua → báo ngay dưới ô giờ. */
  private handleDeliveryErrorCode(body: any): boolean {
    const code = body?.code;
    if (code === 'URGENT_DELIVERY') {
      this.urgentDeliveryPopup = true;
      this.formData.deliveryTime = '';
      return true;
    }
    if (code === 'OUTSIDE_SHOP_HOURS' || code === 'DELIVERY_IN_PAST') {
      this.deliveryScheduleError = String(body?.message || 'Vui lòng chọn lại giờ giao.');
      return true;
    }
    return false;
  }

  private quoteDelivery(): { date: string; time: string } | null {
    const isoDate = this.toIsoDate(this.formData.deliveryDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !this.formData.deliveryTime || this.deliveryScheduleError) return null;
    return { date: this.formData.deliveryDate, time: this.formData.deliveryTime };
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

  selectVoucher(voucher: Voucher): void {
    if (voucher.eligible === false) return; // Không đạt điều kiện: làm mờ, không cho chọn.
    this.voucherSelectionTouched = true;
    this.selectedVoucher = this.selectedVoucher?.id === voucher.id ? null : voucher;
    this.formData.voucherCode = this.selectedVoucher?.code || '';
    this.voucherError = '';
    this.showVoucherDropdown = false;
    // Báo giá lại để phần giảm giá trong khung đơn hàng khớp voucher vừa chọn/bỏ.
    this.refreshServerQuote(false);
  }

  /** Nút X: bỏ voucher đã chọn. */
  clearVoucher(event?: Event, markTouched = true): void {
    event?.stopPropagation();
    if (markTouched) this.voucherSelectionTouched = true;
    this.selectedVoucher = null;
    this.formData.voucherCode = '';
    this.voucherError = '';
    this.showVoucherDropdown = false;
    this.refreshServerQuote(false);
  }

  voucherEstimatedText(voucher: Voucher): string {
    if (voucher.eligible === false) return voucher.reason || 'Chưa đạt điều kiện';
    const value = voucher.estimatedDiscount ?? this.estimateVoucherDiscount(voucher);
    return value > 0 ? `Ước giảm ${value.toLocaleString('vi-VN')}đ` : voucher.desc;
  }

  private estimateVoucherDiscount(voucher: Voucher): number {
    if (this.isPercentVoucherType(voucher.type)) return Math.min(this.subtotal, Math.round(this.subtotal * voucher.value / 100));
    if (this.isCashVoucherType(voucher.type)) return Math.min(this.shippingFee, Math.max(0, voucher.value));
    return Math.min(this.subtotal, Math.max(0, voucher.value));
  }

  private voucherExpiry(voucher: Voucher): number {
    const value = voucher.endDate ? new Date(voucher.endDate).getTime() : Number.MAX_SAFE_INTEGER;
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  applyVoucher(): void {
    const voucherCode = this.formData.voucherCode.trim().toUpperCase();
    this.voucherError = '';
    this.voucherSelectionTouched = true;

    if (!voucherCode) {
      this.selectedVoucher = null;
      this.refreshServerQuote();
      return;
    }

    const found = this.availableVouchers.find(
      (voucher) => voucher.code.toUpperCase() === voucherCode
    );

    if (!found) {
      // Mã không có trong danh sách: để backend kiểm tra theo đúng quy định.
      this.selectedVoucher = { id: '', code: voucherCode, title: voucherCode, desc: '', type: '', value: 0 };
      this.refreshServerQuote(false);
      return;
    }
    if (found.eligible === false) {
      this.selectedVoucher = null;
      this.voucherError = found.reason || 'Voucher chưa đạt điều kiện.';
      return;
    }

    this.selectedVoucher = found;
    this.formData.voucherCode = found.code;
    this.refreshServerQuote(false);
  }

  private quoteReceiver(): { address: string; districtName?: string; provinceName?: string } | null {
    const districtName = this.availableDistricts.find(d => d.code === this.formData.districtCode)?.name;
    if (!districtName) return null;
    return { address: this.fullReceiverAddress, districtName, provinceName: this.provinces.find(p => p.code === this.formData.provinceCode)?.name };
  }

  /** Gọi khi người dùng rời ô địa chỉ cụ thể. */
  onReceiverAddressChanged(): void { this.refreshServerQuote(); }

  serverQuote: ServerQuote | null = null;
  private quoteVersion = 0;
  private refreshServerQuote(reloadVouchers = true): void {
    if (!this.orderItems.length) return;
    if (reloadVouchers) this.loadPublicVouchers();
    // Báo giá cần lịch giao hợp lệ; chưa chọn đủ thì dùng tạm tính phía trình duyệt.
    const delivery = this.quoteDelivery();
    const receiver = this.quoteReceiver();
    // Máy chủ cần lịch giao và quận/huyện để tính phí giao; thiếu thì dùng tạm tính phía trình duyệt.
    if (!delivery || !receiver) { this.serverQuote = null; ++this.quoteVersion; return; }
    const version = ++this.quoteVersion;
    this.pricingService.quote({
      items: this.orderItems.map(item => ({ id: item.id, quantity: item.qty, lineKey: item.lineKey, variantId: item.variantId, designId: item.designId, configuration: item.configuration, displayedUnitPrice: item.price })),
      shippingFee: this.shippingFee,
      voucher: this.selectedVoucher ? { id: this.selectedVoucher.id, code: this.selectedVoucher.code } : null,
      customerId: null,
      delivery,
      receiver,
      // Xem trước: chưa chọn được phương thức hợp lệ thì tạm tính như chuyển khoản.
      payment: { method: ['cod', 'bank', 'momo', 'vnpay'].includes(this.formData.paymentMethod) ? this.formData.paymentMethod : 'bank' },
    }).subscribe({
      next: quote => {
        if (version !== this.quoteVersion) return;
        this.serverQuote = quote;
        if (quote.fulfillment?.mode === 'blocked') this.handleDeliveryErrorCode(quote.fulfillment);
        this.cdr.detectChanges();
      },
      error: error => {
        if (version !== this.quoteVersion) return;
        this.serverQuote = null;
        // Lỗi lịch giao không phải lỗi voucher.
        if (!this.handleDeliveryErrorCode(error?.error)) this.voucherError = error?.error?.message;
        this.cdr.detectChanges();
      },
    });
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
    return value.includes('freeship') || value.includes('ship') || value.includes('van chuyen');
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
    if (this.serverQuote) return this.serverQuote.subtotal;
    return this.orderItems.reduce(
      (sum, item) => sum + item.price * item.qty,
      0
    );
  }

  get selectedCardTemplate(): any | null {
    return this.cardTemplates.find(card => card.id === this.selectedCardTemplateId) || null;
  }

  get selectedCardFee(): number {
    return Math.max(0, Number(this.selectedCardTemplate?.fee || 0));
  }

  onCardTemplateChange(templateId: string): void {
    this.selectedCardTemplateId = templateId;
    this.cardWritingMode = '';
    this.formData.noteReceiver = '';
    this.submitOrderError = '';
  }

  chooseCardWritingMode(mode: 'customer' | 'shop'): void {
    this.cardWritingMode = mode;
    if (mode === 'customer') this.formData.noteReceiver = '';
    this.submitOrderError = '';
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
    if (!this.selectedVoucher || this.isCashVoucherType(this.selectedVoucher.type)) return 0;
    if (this.serverQuote) return this.serverQuote.productDiscount;
    if (this.isPercentVoucherType(this.selectedVoucher.type)) return Math.min(this.subtotal, Math.round(this.subtotal * this.selectedVoucher.value / 100));
    return Math.min(this.subtotal, Math.max(0, this.selectedVoucher.value));
  }

  get shippingVoucherDiscount(): number {
    if (this.serverQuote) return this.serverQuote.shippingDiscount;
    if (!this.selectedVoucher || !this.isCashVoucherType(this.selectedVoucher.type)) {
      return 0;
    }

    return Math.min(this.shippingFee, Math.max(0, this.selectedVoucher.value));
  }

  get discount(): number {
    return this.productVoucherDiscount + this.shippingVoucherDiscount;
  }

  get total(): number {
    return Math.max(0, this.subtotal + this.shippingFee + this.selectedCardFee - this.discount);
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
    return false;
  }

  isPaymentMethodDisabled(methodValue: string): boolean {
    return methodValue === 'card';
  }

  private getCashPaymentBlockedMessage(): string {
    return '';
  }

  onShippingMethodChange(): void {
    if (this.formData.paymentMethod !== 'card') {
      this.paymentError = '';
    }
  }

  get isCodPayment(): boolean {
    return this.formData.paymentMethod === 'cod';
  }

  get showDepositPolicy(): boolean {
    return this.subtotal >= 50000 && this.isCodPayment && !this.isCashPaymentBlocked && !!this.currentPaymentPolicy;
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
    if (this.subtotal < 50000) return 0;
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
    if (this.salesRequestId) return;
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

    if (this.selectedCardTemplateId && !this.cardWritingMode) {
      this.submitOrderError = 'Vui lòng chọn tự viết thiệp hoặc nhờ shop viết.';
      return;
    }

    if (this.selectedCardTemplateId && this.cardWritingMode === 'shop' && !this.formData.noteReceiver.trim()) {
      this.submitOrderError = 'Vui lòng nhập nội dung thiệp.';
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
        if (createdOrder.kind === 'sales_request') {
          this.salesRequestId = createdOrder.requestId || '';
          this.salesRequestMessage = createdOrder.message || '';
          this.isSubmitting = false;
          this.cdr.detectChanges();
          return;
        }
        const finalOrderForCheckout = {
          ...orderForCheckout,
          ...(createdOrder.summary ? { subtotal: createdOrder.summary.subtotal, shippingFee: createdOrder.summary.shippingFee,
            baseShippingFee: createdOrder.summary.baseShippingFee, shippingVoucherDiscount: createdOrder.summary.shippingDiscount,
            productVoucherDiscount: createdOrder.summary.productDiscount, loyaltyDiscount: createdOrder.summary.loyaltyDiscount,
            discount: createdOrder.summary.productDiscount + createdOrder.summary.shippingDiscount,
            total: createdOrder.summary.total, depositAmount: createdOrder.summary.depositAmount,
            remainingAmount: createdOrder.summary.total - createdOrder.paymentAmount, items: createdOrder.items } : {}),
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

        this.isSubmitting = false;
        void this.router.navigate(['/checkout']);
      },
      error: (err: any) => {
        console.error('Lỗi tạo đơn khách vãng lai:', err);
        this.isSubmitting = false;
        this.submitOrderError = this.handleDeliveryErrorCode(err?.error) ? '' : err?.error?.message ;
        this.cdr.detectChanges();
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
        message: this.cardWritingMode === 'shop' ? this.formData.noteReceiver.trim() : '',
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
      shippingMethod: this.formData.shippingMethod,
      receiver: {
        name: this.formData.receiverName,
        phone: receiverPhone,
        address: receiverAddress,
        districtName: this.availableDistricts.find(d => d.code === this.formData.districtCode)?.name,
        provinceName: this.provinces.find(p => p.code === this.formData.provinceCode)?.name,
      },
      sender: {
        name: this.formData.senderName,
        phone: senderPhone,
        email: this.formData.senderEmail,
      },
      delivery: {
        date: this.formData.deliveryDate,
        time: this.formData.deliveryTime,
        message: this.cardWritingMode === 'shop' ? this.formData.noteReceiver.trim() : '',
        noteShop: this.formData.noteShop,
      },
      giftCard: this.selectedCardTemplateId ? {
        templateId: this.selectedCardTemplateId,
        writingMode: this.cardWritingMode as 'customer' | 'shop',
        message: this.cardWritingMode === 'shop' ? this.formData.noteReceiver.trim() : '',
      } : null,
      items: this.orderItems.map(item => ({
        id: item.id,
        lineKey: item.lineKey,
        variantId: item.variantId,
        designId: item.designId,
        configuration: item.configuration,
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
