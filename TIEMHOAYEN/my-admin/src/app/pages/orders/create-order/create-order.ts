import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService, AdminCustomer, AdminOrderQuoteSummary, AdminProduct, AdminVoucher } from '../../../services/admin-api.service';

/* ===== Quy tắc giao hàng dùng chung với trang Khách (backend kiểm tra lại) ===== */
export const SHOP_PHONE = '0909477488';
const URGENT_LEAD_MS = 4 * 60 * 60 * 1000;
/** Nội thành theo bảng phí giao của Khách và backend priceCheckout. */
export const INNER_DISTRICTS = ['Quận 1', 'Quận 3', 'Quận 4', 'Quận 5', 'Quận 6', 'Quận 7', 'Quận 8', 'Quận 10', 'Quận 11',
  'Quận Bình Thạnh', 'Quận Phú Nhuận', 'Quận Tân Bình', 'Quận Tân Phú', 'Quận Gò Vấp'];

/** Ngày hiện tại theo giờ Việt Nam, dạng YYYY-MM-DD. */
export function vnTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function vnDeliveryDate(isoDate: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const value = new Date(`${isoDate}T${time}:00+07:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

/** Giống trang Khách: mốc 30 phút trong 08:00–22:00; hôm nay chỉ còn các giờ chưa qua. */
export function deliveryTimeSlots(isoDate: string, now = new Date()): string[] {
  const slots: string[] = [];
  for (let minutes = 8 * 60; minutes <= 22 * 60; minutes += 30) {
    slots.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  if (!isoDate) return slots;
  return slots.filter(slot => (vnDeliveryDate(isoDate, slot)?.getTime() ?? 0) > now.getTime());
}

/** Lịch giao còn dưới 4 giờ: giống Khách, không nhận online. */
export function isUrgentDelivery(isoDate: string, time: string, now = new Date()): boolean {
  const at = vnDeliveryDate(isoDate, time);
  return !!at && at.getTime() > now.getTime() && at.getTime() - now.getTime() < URGENT_LEAD_MS;
}

/** Bảng phí giao giống hệt trang Khách / backend (chỉ để hiển thị tức thời, backend tính lại). */
export function estimateShippingFee(districtName: string, subtotal: number, method: 'standard' | 'fast'): number {
  if (!districtName) return 0;
  const fast = method === 'fast';
  if (INNER_DISTRICTS.includes(districtName)) {
    return fast ? (subtotal < 300000 ? 60000 : subtotal <= 500000 ? 30000 : 0) : (subtotal < 300000 ? 30000 : 0);
  }
  return fast ? (subtotal < 300000 ? 80000 : subtotal <= 500000 ? 40000 : 30000) : (subtotal < 300000 ? 40000 : subtotal <= 500000 ? 20000 : 0);
}

interface AddressWard { code: string; name: string }
interface AddressDistrict { code: string; name: string; wards: AddressWard[] }
interface AddressProvince { code: string; name: string; districts: AddressDistrict[] }

// ===== TYPES =====
export type OrderStatus =
  | 'Đã đặt hàng thành công'
  | 'Chờ xử lý'
  | 'Đang chuẩn bị hàng'
  | 'Chờ vận chuyển'
  | 'Đang giao'
  | 'Giao thành công'
  | 'Hoàn thành'
  | 'Đã hủy';

export interface CreateOrderProduct {
  id: string;
  name: string;
  image: string;
  qty: number;
  price: number;
}

export interface Shipper {
  name: string;
  phone: string;
  avatar: string;
}

export interface CustomerVoucher {
  id: string;
  code: string;
  customerId: string;
  discountType: string;
  discountValue: number;
  startDate: string;
  endDate: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  loyaltyPoints: number;
  loyaltyDiscount: number;
  vouchers: CustomerVoucher[];
}

export interface CreateOrderForm {
  senderName: string;
  senderPhone: string;
  senderEmail: string;
  senderCustomerId: string;
  receiverName: string;
  receiverPhone: string;
  receiverEmail: string;
  deliveryDate: string;
  deliverySlot: string;
  /** Số nhà, tên đường — phần còn lại chọn theo Tỉnh/Quận/Phường như trang Khách. */
  street: string;
  provinceCode: string;
  districtCode: string;
  wardCode: string;
  shippingMethod: 'standard' | 'fast';
  products: CreateOrderProduct[];
  customerNote: string;
  cardTemplate: string;
  cardWritingMode: 'customer' | 'shop';
  cardMessage: string;
  voucher: string | null;
  adminNote: string;
  paymentMethod: string;
  orderStatus: OrderStatus;
}

@Component({
  selector: 'app-create-order',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule
  ],
  templateUrl: './create-order.html',
  styleUrl: './create-order.css',
})
export class CreateOrder implements OnInit {

  constructor(private readonly adminApi: AdminApiService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadCustomers();
    this.loadVouchers();
    this.loadProducts();
    this.loadCardTemplates();
    this.loadAddressData();
  }

  // ===== ĐỊA CHỈ (cùng dữ liệu & định dạng với trang Khách) =====
  provinces: AddressProvince[] = [];

  private loadAddressData(): void {
    fetch('/assets/address/vietnam-address-old.json')
      .then(response => response.json())
      .then((data: AddressProvince[]) => {
        this.provinces = Array.isArray(data) ? data : [];
        if (this.provinces.length === 1) this.form.provinceCode = this.provinces[0].code;
        this.cdr.markForCheck();
      })
      .catch(() => { this.provinces = []; this.cdr.markForCheck(); });
  }

  get availableDistricts(): AddressDistrict[] {
    return this.provinces.find(p => p.code === this.form.provinceCode)?.districts || [];
  }

  get availableWards(): AddressWard[] {
    return this.availableDistricts.find(d => d.code === this.form.districtCode)?.wards || [];
  }

  get selectedProvinceName(): string { return this.provinces.find(p => p.code === this.form.provinceCode)?.name || ''; }
  get selectedDistrictName(): string { return this.availableDistricts.find(d => d.code === this.form.districtCode)?.name || ''; }
  get selectedWardName(): string { return this.availableWards.find(w => w.code === this.form.wardCode)?.name || ''; }

  get isInnerDistrict(): boolean { return INNER_DISTRICTS.includes(this.selectedDistrictName); }

  /** Định dạng thống nhất với Khách: "Số nhà đường, Phường, Quận, Tỉnh/Thành phố". */
  get fullDeliveryAddress(): string {
    return [this.form.street, this.selectedWardName, this.selectedDistrictName, this.selectedProvinceName]
      .map(value => String(value || '').trim()).filter(Boolean).join(', ');
  }

  onProvinceChange(): void {
    this.form.districtCode = '';
    this.form.wardCode = '';
    this.requestQuote();
  }

  onDistrictChange(): void {
    this.form.wardCode = '';
    delete this.errors.districtCode;
    this.requestQuote();
  }

  onShippingMethodChange(): void { this.requestQuote(); }
  /** Không cho chọn hình thức giao: lịch giao trong 24 giờ là Giao nhanh, từ 24 giờ trở lên là Giao tiêu chuẩn. */
  syncShippingMethod(): void {
    const at = this.form.deliveryDate && this.form.deliverySlot ? vnDeliveryDate(this.form.deliveryDate, this.form.deliverySlot) : null;
    const method: 'standard' | 'fast' = at && at.getTime() - Date.now() < 24 * 60 * 60 * 1000 ? 'fast' : 'standard';
    if (this.form.shippingMethod !== method) { this.form.shippingMethod = method; this.onShippingMethodChange(); }
  }

  // ===== LỊCH GIAO (cùng quy tắc với trang Khách) =====
  readonly shopPhone = SHOP_PHONE;
  get minDeliveryDate(): string { return vnTodayIso(); }

  get deliverySlots(): string[] {
    return deliveryTimeSlots(this.form.deliveryDate);
  }

  isUrgentSlot(slot: string): boolean {
    return !!this.form.deliveryDate && isUrgentDelivery(this.form.deliveryDate, slot);
  }

  get urgentDeliverySelected(): boolean {
    return !!this.form.deliverySlot && this.isUrgentSlot(this.form.deliverySlot);
  }

  // ===== BÁO GIÁ BACKEND (nguồn sự thật, dùng chung priceCheckout với Khách) =====
  quote: AdminOrderQuoteSummary | null = null;
  quoteLoading = false;
  quoteError = '';
  private quoteTimer: ReturnType<typeof setTimeout> | null = null;
  private quoteSeq = 0;

  private quotePayload(): Record<string, unknown> | null {
    if (!this.form.products.length || !this.selectedDistrictName) return null;
    return {
      senderCustomerId: this.form.senderCustomerId || null,
      deliveryAddress: this.fullDeliveryAddress,
      districtName: this.selectedDistrictName,
      provinceName: this.selectedProvinceName,
      shippingMethod: this.form.shippingMethod,
      deliveryDate: this.form.deliveryDate,
      deliverySlot: this.form.deliverySlot,
      paymentMethod: this.form.paymentMethod,
      products: this.form.products.map(p => ({ id: p.id, qty: Number(p.qty || 0) })),
      voucher: this.form.voucher ? { id: this.selectedVoucherId, code: this.form.voucher } : null,
      giftCard: this.form.cardTemplate === 'Không có thiệp' ? null : {
        templateId: this.form.cardTemplate, writingMode: this.form.cardWritingMode,
        message: this.form.cardWritingMode === 'shop' ? (this.form.cardMessage || '-') : '',
      },
    };
  }

  requestQuote(): void {
    if (this.quoteTimer) clearTimeout(this.quoteTimer);
    const payload = this.quotePayload();
    const seq = ++this.quoteSeq;
    if (!payload) { this.quote = null; this.quoteError = ''; this.quoteLoading = false; return; }
    this.quoteLoading = true;
    this.quoteTimer = setTimeout(() => {
      this.adminApi.quoteOrder(payload).subscribe({
        next: ({ summary }) => {
          if (seq !== this.quoteSeq) return;
          this.quote = summary; this.quoteError = ''; this.quoteLoading = false;
          this.cdr.markForCheck();
        },
        error: error => {
          if (seq !== this.quoteSeq) return;
          this.quote = null; this.quoteLoading = false;
          this.quoteError = error?.error?.message || 'Chưa báo giá được, backend sẽ tính lại khi tạo đơn.';
          this.cdr.markForCheck();
        },
      });
    }, 300);
  }

  // ===== FORM STATE =====
  form: CreateOrderForm = {
    senderName: '',
    senderPhone: '',
    senderEmail: '',
    senderCustomerId: '',
    receiverName: '',
    receiverPhone: '',
    receiverEmail: '',
    deliveryDate: '',
    deliverySlot: '',
    street: '',
    provinceCode: '',
    districtCode: '',
    wardCode: '',
    shippingMethod: 'standard',
    products: [],
    customerNote: '',
    cardTemplate: 'Không có thiệp',
    cardWritingMode: 'customer',
    cardMessage: '',
    voucher: null,
    adminNote: '',
    paymentMethod: 'Chuyển khoản full',
    orderStatus: 'Đã đặt hàng thành công',
  };

  errors: Partial<Record<keyof CreateOrderForm, string>> = {};

  customers: Customer[] = [];
  shopProducts: CreateOrderProduct[] = [];
  private allVouchers: CustomerVoucher[] = [];

  private loadCustomers(): void {
    this.adminApi.getCustomers().subscribe({
      next: (data) => {
        this.cdr.markForCheck();
        this.customers = (data.customers || []).map((customer: AdminCustomer) => ({
          id: customer.code,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          loyaltyPoints: Number(customer.point || 0),
          loyaltyDiscount: Math.floor(Number(customer.point || 0) / 2) * 1000,
          vouchers: []
        }));
        this.attachVouchersToCustomers();
      },
      error: (error) => {
        console.error('Cannot load customers for order form', error);
        this.customers = [];
      }
    });
  }

  private loadVouchers(): void {
    this.adminApi.getVouchers().subscribe({
      next: (data) => {
        this.cdr.markForCheck();
        this.allVouchers = (data.vouchers || [])
          .filter((voucher: AdminVoucher) => this.isVoucherAvailable(voucher))
          .map((voucher: AdminVoucher) => ({
            id: voucher.code,
            code: voucher.voucherCode,
            customerId: voucher.customerId || '',
            discountType: voucher.discountType,
            discountValue: Number(voucher.discountValue || 0),
            startDate: voucher.startDate,
            endDate: voucher.endDate
          }));
        this.attachVouchersToCustomers();
      },
      error: (error) => {
        console.error('Cannot load vouchers for order form', error);
        this.allVouchers = [];
        this.attachVouchersToCustomers();
      }
    });
  }

  private loadProducts(): void {
    this.adminApi.getProducts().subscribe({
      next: (data) => {
        this.cdr.markForCheck();
        this.shopProducts = (data.products || []).map((product: AdminProduct) => ({
          id: product.sku,
          name: product.name,
          image: product.image,
          qty: 1,
          price: Number(String(product.price || '').replace(/\D/g, '')) || 0
        }));
      },
      error: (error) => {
        console.error('Cannot load products for order form', error);
        this.shopProducts = [];
      }
    });
  }

  // ===== TOAST THÔNG BÁO =====
  toastMessage = '';
  toastVisible = false;
  private toastTimeoutId?: ReturnType<typeof setTimeout>;

  // ===== STATIC DATA =====
  statusOptions: OrderStatus[] = [
    'Đã đặt hàng thành công',
    'Đang chuẩn bị hàng',
    'Chờ vận chuyển',
    'Đang giao',
    'Giao thành công',
    'Hoàn thành',
    'Đã hủy',
  ];

  cardTemplates: Array<{ id: string; code: string; name: string; image?: string; fee: number }> = [];

  private loadCardTemplates(): void {
    this.adminApi.getCardTemplates().subscribe({
      next: response => { this.cardTemplates = response.templates || []; this.cdr.markForCheck(); },
      error: () => { this.cardTemplates = []; this.cdr.markForCheck(); },
    });
  }

  onCardTemplateChange(): void {
    delete this.errors.cardMessage;
    if (this.form.cardTemplate === 'Không có thiệp') {
      this.form.cardWritingMode = 'customer';
      this.form.cardMessage = '';
    }
    this.requestQuote();
  }

  onCardWritingModeChange(): void {
    delete this.errors.cardMessage;
    if (this.form.cardWritingMode === 'customer') this.form.cardMessage = '';
    this.requestQuote();
  }

  paymentMethods: string[] = [
    'Chuyển khoản full',
    'Tiền mặt',
    'COD',
  ];

  shippers: Shipper[] = [];

  // ===== PAYMENT =====
  shippingMethods: Array<{ value: 'standard' | 'fast'; label: string }> = [
    { value: 'standard', label: 'Giao tiêu chuẩn' },
    { value: 'fast', label: 'Giao nhanh' },
  ];
  voucherInput = '';
  voucherError = '';
  voucherDiscount = 0;
  paidInput = '';
  useLoyalty = false;

  // ===== CUSTOMER SEARCH =====
  customerSearchQuery = '';
  customerSearchResults: Customer[] = [];
  showCustomerSearch = false;
  customerSearchFocused = false;
  selectedCustomerLoyalty = 0;
  loyaltyDiscount = 0;
  customerVouchers: CustomerVoucher[] = [];
  selectedVoucherId = '';
  private activeVoucher: CustomerVoucher | null = null;

  // ===== PRODUCT SEARCH =====
  productSearchQuery = '';
  productSearchResults: CreateOrderProduct[] = [];
  showProductSearch = false;

  // ===== STATUS =====
  showStatusDropdown = false;
  showShipperDropdown = false;
  selectedShipper: Shipper | null = null;
  deliveryDateDisplay = '';
  statusSelected = false;

  // ===== POPUP =====
  showAddCustomerPopup = false;
  newCustomer = { name: '', phone: '', email: '', address: '' };
  newCustomerErrors: Partial<{ name: string; phone: string }> = {};

  // ===== COMPUTED =====
  get totalQty(): number {
    return this.form.products.reduce((sum, p) => sum + p.qty, 0);
  }

  get computedSubtotal(): number {
    return this.form.products.reduce((sum, p) => sum + p.qty * p.price, 0);
  }

  get selectedCardFee(): number {
    if (this.form.cardTemplate === 'Không có thiệp') return 0;
    return Number(this.cardTemplates.find(card => card.id === this.form.cardTemplate)?.fee || 0);
  }

  /** Phí giao gốc theo bảng phí của Khách; ưu tiên số backend trả về. */
  get shippingFee(): number {
    return this.quote ? this.quote.baseShippingFee
      : estimateShippingFee(this.selectedDistrictName, this.computedSubtotal, this.form.shippingMethod);
  }

  /** Giảm giá voucher (giảm tiền hàng + giảm phí ship), ưu tiên số backend. */
  get displayedVoucherDiscount(): number {
    if (!this.form.voucher) return 0;
    return this.quote ? this.quote.productDiscount + this.quote.shippingDiscount : this.voucherDiscount;
  }

  /** Tổng thanh toán, đã bao gồm VAT như trang Khách (không cộng thêm thuế). */
  get computedGrandTotal(): number {
    if (this.quote) return this.quote.total;
    return Math.max(0, this.computedSubtotal + this.shippingFee + this.selectedCardFee - this.displayedVoucherDiscount
      - (this.useLoyalty ? this.loyaltyDiscount : 0));
  }

  get computedRemaining(): number { return Math.max(this.computedGrandTotal, 0); }

  // ===== CUSTOMER SEARCH =====
  onCustomerSearch(): void {
    const q = this.customerSearchQuery.trim().toLowerCase();
    if (!q) {
      this.customerSearchResults = [];
      this.showCustomerSearch = false;
      return;
    }
    this.customerSearchResults = this.customers.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
    this.showCustomerSearch = true;
  }

  onCustomerSearchBlur(): void {
    setTimeout(() => {
      this.showCustomerSearch = false;
      this.customerSearchFocused = false;
    }, 180);
  }

  selectCustomer(c: Customer): void {
    this.form.senderName = c.name;
    this.form.senderPhone = c.phone;
    this.form.senderEmail = c.email;
    this.form.senderCustomerId = c.id;
    this.selectedCustomerLoyalty = c.loyaltyPoints;
    this.loyaltyDiscount = Math.floor(c.loyaltyPoints / 2) * 1000;
    this.useLoyalty = false;
    this.customerVouchers = c.vouchers;
    // Reset voucher khi đổi khách
    this.form.voucher = null;
    this.activeVoucher = null;
    this.selectedVoucherId = '';
    this.voucherDiscount = 0;
    this.voucherInput = '';
    this.voucherError = '';
    this.customerSearchQuery = c.name;
    this.showCustomerSearch = false;
    this.requestQuote();
  }

  // ===== PRODUCT SEARCH =====
  openProductSearch(): void {
    // Hiện toàn bộ khi focus, lọc nếu đang có query
    const q = this.productSearchQuery.trim().toLowerCase();
    this.productSearchResults = q
      ? this.shopProducts.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      : [...this.shopProducts];
    this.showProductSearch = true;
  }

  onProductSearch(): void {
    const q = this.productSearchQuery.trim().toLowerCase();
    this.productSearchResults = q
      ? this.shopProducts.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      : [...this.shopProducts];
    this.showProductSearch = true;
  }

  onProductSearchBlur(): void {
    // dùng timeout để mousedown trên item kịp fire trước khi blur đóng dropdown
    setTimeout(() => {
      this.showProductSearch = false;
    }, 200);
  }

  addProduct(p: CreateOrderProduct): void {
    const existing = this.form.products.find(op => op.id === p.id);
    if (existing) {
      existing.qty += 1;
    } else {
      this.form.products.push({ ...p, qty: 1 });
    }
    this.productSearchQuery = '';
    this.productSearchResults = [];
    this.showProductSearch = false;
    this.refreshVoucherDiscount();
  }

  removeProduct(index: number): void {
    this.form.products.splice(index, 1);
    this.refreshVoucherDiscount();
  }

  updateQty(index: number, delta: number): void {
    const p = this.form.products[index];
    const newQty = p.qty + delta;
    if (newQty < 1) return;
    p.qty = newQty;
    this.refreshVoucherDiscount();
  }

  lineTotal(p: CreateOrderProduct): number {
    return p.qty * p.price;
  }

  // ===== VOUCHER =====
  applyVoucher(): void {
    const code = this.voucherInput.trim().toUpperCase();
    if (!code) {
      this.form.voucher = null;
      this.activeVoucher = null;
      this.selectedVoucherId = '';
      this.voucherDiscount = 0;
      this.voucherError = '';
      this.requestQuote();
      return;
    }

    const matchedVoucher = this.findVoucherByCode(code);
    if (matchedVoucher) {
      this.applyVoucherRecord(matchedVoucher);
      return;
    }

    this.voucherError = 'Voucher không hợp lệ hoặc đã hết hạn';
  }

  selectCustomerVoucher(v: CustomerVoucher): void {
    this.applyVoucherRecord(v);
  }

  formatVoucherValue(voucher: CustomerVoucher): string {
    if (this.isPercentageDiscount(voucher.discountType)) {
      return `${voucher.discountValue}%`;
    }

    return this.formatVND(voucher.discountValue);
  }

  private attachVouchersToCustomers(): void {
    this.customers = this.customers.map((customer) => ({
      ...customer,
      vouchers: this.allVouchers.filter((voucher) => voucher.customerId === customer.id)
    }));

    if (this.form.senderCustomerId) {
      const selectedCustomer = this.customers.find((customer) => customer.id === this.form.senderCustomerId);
      this.customerVouchers = selectedCustomer?.vouchers || [];
    }
  }

  private isVoucherAvailable(voucher: AdminVoucher): boolean {
    if (voucher.used) {
      return false;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = voucher.startDate ? new Date(voucher.startDate) : null;
    const endDate = voucher.endDate ? new Date(voucher.endDate) : null;

    if (startDate) {
      startDate.setHours(0, 0, 0, 0);
    }

    if (endDate) {
      endDate.setHours(0, 0, 0, 0);
    }

    return (!startDate || today >= startDate) && (!endDate || today <= endDate);
  }

  private findVoucherByCode(code: string): CustomerVoucher | undefined {
    const normalizedCode = code.toUpperCase();
    const customerId = this.form.senderCustomerId;
    const customerVoucher = customerId
      ? this.allVouchers.find((voucher) =>
          voucher.customerId === customerId &&
          voucher.code.toUpperCase() === normalizedCode
        )
      : undefined;

    return customerVoucher || this.allVouchers.find((voucher) =>
      !voucher.customerId &&
      voucher.code.toUpperCase() === normalizedCode
    );
  }

  private applyVoucherRecord(voucher: CustomerVoucher): void {
    this.activeVoucher = voucher;
    this.selectedVoucherId = voucher.id;
    this.form.voucher = voucher.code;
    this.voucherInput = voucher.code;
    this.voucherDiscount = this.calculateVoucherDiscount(voucher);
    this.voucherError = '';
    this.requestQuote();
  }

  private refreshVoucherDiscount(): void {
    if (this.activeVoucher && this.form.voucher) {
      this.voucherDiscount = this.calculateVoucherDiscount(this.activeVoucher);
    }
    this.requestQuote();
  }

  private calculateVoucherDiscount(voucher: CustomerVoucher): number {
    const value = Math.max(0, Number(voucher.discountValue || 0));

    if (this.isPercentageDiscount(voucher.discountType)) {
      return Math.round(this.computedSubtotal * value / 100);
    }

    return value;
  }

  private isPercentageDiscount(discountType: string): boolean {
    return this.removeVietnameseTones(discountType.toLowerCase()).includes('phan tram');
  }

  // ===== LOYALTY =====
  onLoyaltyToggle(): void {
    // computed tự cập nhật qua getter
  }

  // ===== PAID INPUT =====
  onPaidInputChange(): void {
    const raw = parseInt(this.paidInput.replace(/\D/g, ''), 10) || 0;
    this.paidInput = raw ? raw.toLocaleString('vi-VN') + 'đ' : '';
  }


  // ===== DATE PICKER =====
  openDatePicker(input: HTMLInputElement): void {
    const dateInput = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof dateInput.showPicker === 'function') {
      dateInput.showPicker();
      return;
    }
    dateInput.focus();
    dateInput.click();
  }

  onDatePickerChange(value: string): void {
    // Chỉ nhận từ hôm nay trở đi (giờ Việt Nam).
    if (value && value < vnTodayIso()) {
      this.errors.deliveryDate = 'Ngày giao phải từ hôm nay trở đi';
      value = '';
    } else {
      delete this.errors.deliveryDate;
    }
    this.form.deliveryDate = value; // yyyy-mm-dd
    if (value) {
      const [yyyy, mm, dd] = value.split('-');
      this.deliveryDateDisplay = `${dd}/${mm}/${yyyy}`;
    } else {
      this.deliveryDateDisplay = '';
    }
    if (this.form.deliverySlot && !this.deliverySlots.includes(this.form.deliverySlot)) this.form.deliverySlot = '';
    this.syncShippingMethod();
  }

  // ===== SHIPPER =====
  toggleShipperDropdown(): void {
    this.showShipperDropdown = !this.showShipperDropdown;
  }

  selectShipper(shipper: Shipper): void {
    this.selectedShipper = shipper;
    this.showShipperDropdown = false;
  }

  // ===== STATUS =====
  toggleStatusDropdown(): void {
    this.showStatusDropdown = !this.showStatusDropdown;
  }

  selectStatus(status: OrderStatus): void {
    this.form.orderStatus = status;
    this.statusSelected = true;
    this.showStatusDropdown = false;
  }

  orderStatusBadgeClass(status: OrderStatus): string {
    const map: Record<OrderStatus, string> = {
      'Chờ xử lý': 'order-status-badge--pending',
      'Đã đặt hàng thành công': 'order-status-badge--pending',
      'Đang chuẩn bị hàng': 'order-status-badge--preparing',
      'Chờ vận chuyển': 'order-status-badge--waiting-ship',
      'Đang giao': 'order-status-badge--shipping',
      'Giao thành công': 'order-status-badge--delivered',
      'Hoàn thành': 'order-status-badge--completed',
      'Đã hủy': 'order-status-badge--cancelled',
    };
    return map[status] ?? '';
  }

  orderStatusIcon(status: OrderStatus): string {
    const map: Record<OrderStatus, string> = {
      'Chờ xử lý': 'bi-gift-fill',
      'Đã đặt hàng thành công': 'bi-check-circle-fill',
      'Đang chuẩn bị hàng': 'bi-box-seam',
      'Chờ vận chuyển': 'bi-boxes',
      'Đang giao': 'bi-truck',
      'Giao thành công': 'icon-delivered-box',
      'Hoàn thành': 'bi-flag-fill',
      'Đã hủy': 'icon-cancelled-square',
    };
    return map[status] ?? '';
  }

  // ===== POPUP =====
  openAddCustomerPopup(): void {
    this.newCustomer = { name: '', phone: '', email: '', address: '' };
    this.newCustomerErrors = {};
    this.showAddCustomerPopup = true;
  }

  closeAddCustomerPopup(): void {
    this.showAddCustomerPopup = false;
  }

  confirmAddCustomer(): void {
    this.newCustomerErrors = {};

    if (!this.newCustomer.name.trim()) {
      this.newCustomerErrors.name = 'Vui lòng nhập họ và tên';
    } else if (this.newCustomer.name.trim().length < 2) {
      this.newCustomerErrors.name = 'Họ và tên tối thiểu 2 ký tự';
    }

    if (!this.newCustomer.phone.trim()) {
      this.newCustomerErrors.phone = 'Vui lòng nhập số điện thoại';
    } else if (!this.PHONE_REGEX.test(this.newCustomer.phone.trim())) {
      this.newCustomerErrors.phone = 'Số điện thoại không hợp lệ (VD: 0912345678)';
    }

    if (Object.keys(this.newCustomerErrors).length > 0) return;

    const newId = '#CUST' + String(Math.floor(Math.random() * 9000) + 1000);
    this.form.senderName = this.newCustomer.name;
    this.form.senderPhone = this.newCustomer.phone;
    this.form.senderEmail = this.newCustomer.email;
    this.form.senderCustomerId = newId;
    this.selectedCustomerLoyalty = 0;
    this.loyaltyDiscount = 0;
    this.closeAddCustomerPopup();
  }

  // ===== VALIDATE & SUBMIT =====
  private readonly PHONE_REGEX = /^0\d{9}$/;
  private readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  validate(): boolean {
    this.errors = {};

    // Họ và tên người gửi — tối thiểu 2 ký tự
    if (!this.form.senderName.trim()) {
      this.errors.senderName = 'Vui lòng nhập họ và tên người gửi';
    } else if (this.form.senderName.trim().length < 2) {
      this.errors.senderName = 'Họ và tên tối thiểu 2 ký tự';
    }

    // SĐT người gửi — đúng định dạng Việt Nam, 10 số
    if (!this.form.senderPhone.trim()) {
      this.errors.senderPhone = 'Vui lòng nhập số điện thoại người gửi';
    } else if (!this.PHONE_REGEX.test(this.form.senderPhone.trim())) {
      this.errors.senderPhone = 'Số điện thoại không hợp lệ (VD: 0912345678)';
    }

    // Email người gửi — không bắt buộc, nhưng nếu nhập phải đúng định dạng
    if (this.form.senderEmail?.trim() && !this.EMAIL_REGEX.test(this.form.senderEmail.trim())) {
      this.errors.senderEmail = 'Email không hợp lệ';
    }

    // Tên người nhận — tối thiểu 2 ký tự
    if (!this.form.receiverName.trim()) {
      this.errors.receiverName = 'Vui lòng nhập tên người nhận';
    } else if (this.form.receiverName.trim().length < 2) {
      this.errors.receiverName = 'Tên người nhận tối thiểu 2 ký tự';
    }

    // SĐT người nhận — đúng định dạng Việt Nam, 10 số
    if (!this.form.receiverPhone.trim()) {
      this.errors.receiverPhone = 'Vui lòng nhập số điện thoại người nhận';
    } else if (!this.PHONE_REGEX.test(this.form.receiverPhone.trim())) {
      this.errors.receiverPhone = 'Số điện thoại không hợp lệ (VD: 0912345678)';
    }

    // Email người nhận — không bắt buộc, nhưng nếu nhập phải đúng định dạng
    if (this.form.receiverEmail?.trim() && !this.EMAIL_REGEX.test(this.form.receiverEmail.trim())) {
      this.errors.receiverEmail = 'Email không hợp lệ';
    }

    if (!this.form.deliveryDate) this.errors.deliveryDate = 'Vui lòng chọn ngày giao hàng';
    else if (this.form.deliveryDate < vnTodayIso()) this.errors.deliveryDate = 'Ngày giao phải từ hôm nay trở đi';
    if (!this.form.deliverySlot) this.errors.deliverySlot = 'Vui lòng chọn giờ giao';
    else if (!this.deliverySlots.includes(this.form.deliverySlot)) this.errors.deliverySlot = 'Giờ giao đã qua, vui lòng chọn lại (08:00–22:00)';
    else if (this.urgentDeliverySelected) this.errors.deliverySlot = `Lịch giao dưới 4 giờ là đơn gấp, vui lòng xử lý qua số ${SHOP_PHONE}`;
    if (!this.form.provinceCode) this.errors.provinceCode = 'Vui lòng chọn Tỉnh/Thành phố';
    if (!this.form.districtCode) this.errors.districtCode = 'Vui lòng chọn Quận/Huyện';
    if (!this.form.wardCode) this.errors.wardCode = 'Vui lòng chọn Phường/Xã';
    if (!this.form.street.trim()) this.errors.street = 'Vui lòng nhập số nhà, tên đường';

    if (this.form.cardTemplate !== 'Không có thiệp' && this.form.cardWritingMode === 'shop') {
      const message = this.form.cardMessage.trim();
      if (!message) this.errors.cardMessage = 'Vui lòng nhập nội dung để shop viết lên thiệp';
      else if (message.length > 500) this.errors.cardMessage = 'Nội dung thiệp tối đa 500 ký tự';
    }

    // Danh sách sản phẩm — phải có ít nhất 1 sản phẩm mới được tạo đơn
    if (this.form.products.length === 0) {
      this.errors.products = 'Vui lòng thêm ít nhất 1 sản phẩm vào đơn hàng';
    }

    return Object.keys(this.errors).length === 0;
  }

  creationResult: any = null;
  get canCreateOrder(): boolean { return this.adminApi.can('orders','create'); }
  isSubmitting = false;
  submitOrder(): void {
    if (this.isSubmitting || !this.adminApi.can('orders','create')) return;
    if (!this.validate()) return;
    this.isSubmitting = true;
    this.adminApi.createOrder({
      senderName: this.form.senderName,
      senderPhone: this.form.senderPhone,
      senderEmail: this.form.senderEmail,
      senderCustomerId: this.form.senderCustomerId,
      receiverName: this.form.receiverName,
      receiverPhone: this.form.receiverPhone,
      receiverEmail: this.form.receiverEmail,
      deliveryDate: this.form.deliveryDate,
      deliverySlot: this.form.deliverySlot,
      deliveryAddress: this.fullDeliveryAddress,
      districtName: this.selectedDistrictName,
      provinceName: this.selectedProvinceName,
      shippingMethod: this.form.shippingMethod,
      products: this.form.products.map((product) => ({
        id: product.id,
        qty: Number(product.qty || 0),
        price: Number(product.price || 0)
      })),
      customerNote: this.form.customerNote,
      cardMessage: this.form.cardMessage,
      giftCard: this.form.cardTemplate === 'Không có thiệp' ? null : {
        templateId: this.form.cardTemplate,
        writingMode: this.form.cardWritingMode,
        message: this.form.cardWritingMode === 'shop' ? this.form.cardMessage : '',
      },
      adminNote: this.form.adminNote,
      paymentMethod: this.form.paymentMethod,
      orderStatus: this.form.orderStatus,
      voucher: this.form.voucher
        ? {
            id: this.selectedVoucherId,
            code: this.form.voucher
          }
        : null,
      loyaltyPoints: this.useLoyalty ? Math.min(Math.floor(this.selectedCustomerLoyalty / 2) * 2, Math.floor(Math.max(0, this.computedSubtotal - (this.form.voucher ? this.voucherDiscount : 0)) / 1000) * 2) : 0,
    }).subscribe({
      next: (result) => {
        this.isSubmitting = false; this.creationResult = result;
        this.showToast(result.kind === 'sales_request'
          ? `Đã tiếp nhận yêu cầu ${result.requestId}. Sales cần tư vấn trước khi thu tiền.`
          : `Đơn hàng ${result.orderId} đã được tạo, chờ xác minh thanh toán.`);
      },
      error: (error) => {
        this.isSubmitting = false;
        this.cdr.markForCheck();
        console.error('Cannot create order', error);
        alert(error?.error?.message || 'Không thể tạo đơn hàng. Vui lòng kiểm tra sản phẩm/khách hàng rồi thử lại.');
      }
    });
    return;
    console.log('Tạo đơn hàng:', this.form);
    this.showToast('Đơn hàng đã được tạo!');
  }

  // ===== TOAST THÔNG BÁO =====
  showToast(message: string): void {
    this.toastMessage = message;
    this.toastVisible = true;
    this.cdr.markForCheck();

    if (this.toastTimeoutId) clearTimeout(this.toastTimeoutId);
    this.toastTimeoutId = setTimeout(() => {
      this.toastVisible = false;
      this.cdr.markForCheck();
    }, 2500);
  }

  // ===== HELPERS =====
  formatVND(value: number): string {
    return value.toLocaleString('vi-VN') + 'đ';
  }

  removeVietnameseTones(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

}
