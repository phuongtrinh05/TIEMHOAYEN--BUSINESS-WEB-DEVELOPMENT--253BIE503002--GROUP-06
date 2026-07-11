  import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService, AdminCustomer, AdminProduct, AdminVoucher } from '../../../services/admin-api.service';

// ===== TYPES =====
export type OrderStatus =
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
  deliveryAddress: string;
  products: CreateOrderProduct[];
  customerNote: string;
  cardTemplate: string;
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

  constructor(private readonly adminApi: AdminApiService) {}

  ngOnInit(): void {
    this.loadCustomers();
    this.loadVouchers();
    this.loadProducts();
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
    deliveryAddress: '',
    products: [],
    customerNote: '',
    cardTemplate: 'Không có thiệp',
    cardMessage: '',
    voucher: null,
    adminNote: '',
    paymentMethod: 'Chuyển khoản full',
    orderStatus: 'Chờ xử lý',
  };

  errors: Partial<Record<keyof CreateOrderForm, string>> = {};

  customers: Customer[] = [];
  shopProducts: CreateOrderProduct[] = [];
  private allVouchers: CustomerVoucher[] = [];

  private loadCustomers(): void {
    this.adminApi.getCustomers().subscribe({
      next: (data) => {
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
    'Chờ xử lý',
    'Đang chuẩn bị hàng',
    'Chờ vận chuyển',
    'Đang giao',
    'Giao thành công',
    'Hoàn thành',
    'Đã hủy',
  ];

  deliverySlots: string[] = [
    '07:00 AM–09:00 AM',
    '09:00 AM–11:00 AM',
    '11:00 AM–01:00 PM',
    '01:00 PM–03:00 PM',
    '03:00 PM–05:00 PM',
    '05:00 PM–07:00 PM',
    '07:00 PM–09:00 PM',
  ];

  cardTemplates: string[] = [
    'Thiệp Happy Birthday',
    'Thiệp Valentine',
    'Thiệp Chúc Mừng',
    'Thiệp Cảm Ơn',
    'Thiệp Xin Lỗi',
    'Thiệp Kỷ Niệm',
  ];

  paymentMethods: string[] = [
    'Chuyển khoản full',
    'Tiền mặt',
    'Cọc 50%',
    'COD',
  ];

  shippers: Shipper[] = [
    { name: 'Nguyễn Quang Huy', phone: '0553851470', avatar: 'assets/images/nguyen_quang_huy.jpg' },
    { name: 'Trần Minh Khang', phone: '0908123456', avatar: 'assets/images/logo-main.png' },
    { name: 'Lê Hoàng Nam', phone: '0934567890', avatar: 'assets/images/logo-main.png' },
  ];

  // ===== PAYMENT =====
  shippingFee = 40000;
  tax = 20000;
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
  selectedShipper: Shipper | null = this.shippers[0];
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

  get computedTotalBeforeTax(): number {
    return (
      this.computedSubtotal +
      this.shippingFee -
      (this.form.voucher ? this.voucherDiscount : 0) -
      (this.useLoyalty ? this.loyaltyDiscount : 0)
    );
  }

  get computedGrandTotal(): number {
    return this.computedTotalBeforeTax + this.tax;
  }

  get computedRemaining(): number {
    const paid = parseInt(this.paidInput.replace(/\D/g, ''), 10) || 0;
    return Math.max(this.computedGrandTotal - paid, 0);
  }

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
  }

  private refreshVoucherDiscount(): void {
    if (!this.activeVoucher || !this.form.voucher) {
      return;
    }

    this.voucherDiscount = this.calculateVoucherDiscount(this.activeVoucher);
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
    this.form.deliveryDate = value; // yyyy-mm-dd
    if (value) {
      const [yyyy, mm, dd] = value.split('-');
      this.deliveryDateDisplay = `${dd}/${mm}/${yyyy}`;
    } else {
      this.deliveryDateDisplay = '';
    }
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
    if (!this.form.deliverySlot) this.errors.deliverySlot = 'Vui lòng chọn khung giờ giao';
    if (!this.form.deliveryAddress.trim()) this.errors.deliveryAddress = 'Vui lòng nhập địa chỉ giao hàng';

    // Trạng thái đơn hàng — bắt buộc phải bấm "Cập nhật trạng thái" và chọn 1 mục
    if (!this.statusSelected) {
      this.errors.orderStatus = 'Vui lòng cập nhật trạng thái đơn hàng';
    }

    // Danh sách sản phẩm — phải có ít nhất 1 sản phẩm mới được tạo đơn
    if (this.form.products.length === 0) {
      this.errors.products = 'Vui lòng thêm ít nhất 1 sản phẩm vào đơn hàng';
    }

    return Object.keys(this.errors).length === 0;
  }

  submitOrder(): void {
    if (!this.validate()) return;
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
      deliveryAddress: this.form.deliveryAddress,
      products: this.form.products.map((product) => ({
        id: product.id,
        qty: Number(product.qty || 0),
        price: Number(product.price || 0)
      })),
      customerNote: this.form.customerNote,
      cardMessage: this.form.cardMessage,
      adminNote: this.form.adminNote,
      paymentMethod: this.form.paymentMethod,
      orderStatus: this.form.orderStatus,
      shippingFee: this.shippingFee,
      tax: this.tax,
      voucher: this.form.voucher
        ? {
            id: this.selectedVoucherId,
            code: this.form.voucher
          }
        : null,
      voucherDiscount: this.form.voucher ? this.voucherDiscount : 0,
      loyaltyDiscount: this.useLoyalty ? this.loyaltyDiscount : 0
    }).subscribe({
      next: (result) => {
        this.showToast(`Đơn hàng ${result.orderId} đã được tạo!`);
      },
      error: (error) => {
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

    if (this.toastTimeoutId) clearTimeout(this.toastTimeoutId);
    this.toastTimeoutId = setTimeout(() => {
      this.toastVisible = false;
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
