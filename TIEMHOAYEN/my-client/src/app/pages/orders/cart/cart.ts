import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  Inject,
  OnInit,
  PLATFORM_ID,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { PageHeader } from '../../../components/page-header/page-header';
import { PageFooter } from '../../../components/page-footer/page-footer';

import { MaterialService } from '../../../services/material.service';
import { ProductDetailService } from '../../../services/product-detail.service';

import {
  CartService,
  CartApiItem,
  CartResponse,
} from '../../../services/cart.service';

import {
  CustomerService,
  CustomerVoucher,
} from '../../../services/customer.service';



interface CartItem {
  id: string;
  name: string;
  style: string;
  occasion: string;
  topicName: string;
  price: number;
  originalPrice?: number | null;
  quantity: number;
  image: string;
  selected: boolean;
  maxQuantity?: number;
}

interface SuggestedProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  style: string;
  status: string;
  originalPrice?: number | null;
  maxQuantity?: number;
}

interface SuggestedProductResponse {
  SAN_PHAM_ID?: string;
  TEN_SAN_PHAM?: string;
  GIA?: number | string | null;
  GIA_KHUYEN_MAI?: number | string | null;
  HINH_ANH?: string | null;
  SO_LUONG?: number | string | null;
  KIEU_DANG?: string | null;
  TRANG_THAI?: string | null;
  CHU_DE_ID?: string | null;
  TEN_CHU_DE?: string | null;

  // Giữ tương thích nếu backend cũ còn trả về format NGUYEN_VAT_LIEU.
  NGUYEN_VAT_LIEU_ID?: string;
  TEN_NGUYEN_VAT_LIEU?: string;
  GIA_BAN?: number | string | null;
  SO_LUONG_TON?: number | string | null;
}

interface CartVoucher {
  id: string;
  code: string;
  type: string;
  value: number;
  startDate?: string | null;
  endDate?: string | null;
  used?: boolean | number;
}

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    PageFooter,
    PageHeader,
  ],
  templateUrl: './cart.html',
  styleUrl: './cart.css',
})
export class CartComponent implements OnInit {
  /**
   * Key giỏ hàng của khách chưa đăng nhập.
   * Không đăng nhập thì chỉ đọc/ghi key này, không gọi database.
   */
  private readonly guestCartStorageKey = 'tiemHoaYenCart';

  /**
   * Key riêng để chuyển sản phẩm đã chọn sang trang đặt hàng.
   * Dùng key riêng để tránh làm giỏ khách bị lẫn với giỏ database.
   */
  private readonly checkoutItemsStorageKey = 'tiemHoaYenCheckoutItems';

  private readonly defaultImage = 'assets/images/hoa.jpg';
  private readonly estimatedShippingFee = 30000;
  private readonly cartCacheTtlMs = 10 * 60 * 1000;

  cartItems: CartItem[] = [];
  suggestedProducts: SuggestedProduct[] = [];
  availableVouchers: CartVoucher[] = [];
  selectedProductVoucher: CartVoucher | null = null;
  selectedShippingVoucher: CartVoucher | null = null;
  private cachedCustomerId = '';

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    private materialService: MaterialService,
    private productDetailService: ProductDetailService,
    private cartService: CartService,
    private customerService: CustomerService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.cachedCustomerId = this.resolveCustomerId();
    this.restoreCustomerCartCache();
    this.loadCartByLoginState();

    if (this.isBrowser) {
      window.setTimeout(() => {
        this.loadCustomerVouchers();
        this.loadSuggestedMaterials();
      }, 0);
    }
  }

  private get isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  private getLoggedInCustomer(): any | null {
    if (!this.isBrowser) {
      return null;
    }

    const rawCustomer = localStorage.getItem('khachHang');

    if (!rawCustomer || rawCustomer === 'null' || rawCustomer === 'undefined') {
      return null;
    }

    try {
      const customer = JSON.parse(rawCustomer);

      if (!customer?.KHACH_HANG_ID) {
        localStorage.removeItem('khachHang');
        localStorage.removeItem('token');
        return null;
      }

      return customer;
    } catch {
      localStorage.removeItem('khachHang');
      localStorage.removeItem('token');
      return null;
    }
  }

  private resolveCustomerId(): string {
    const customer = this.getLoggedInCustomer();
    return customer?.KHACH_HANG_ID ? String(customer.KHACH_HANG_ID) : '';
  }

  private getCustomerId(): string {
    return this.cachedCustomerId;
  }

  get isLoggedIn(): boolean {
    return !!this.cachedCustomerId;
  }

  /**
   * Đăng nhập: chỉ lấy database.
   * Không đăng nhập: chỉ lấy localStorage.
   */
  private loadCartByLoginState(): void {
    if (this.isLoggedIn) {
      this.loadCartFromDatabase();
      return;
    }

    this.loadGuestCartFromStorage();
  }

  private loadGuestCartFromStorage(): void {
    if (!this.isBrowser) {
      return;
    }

    const rawCart = localStorage.getItem(this.guestCartStorageKey);

    if (!rawCart) {
      this.cartItems = [];
      this.cdr.detectChanges();
      return;
    }

    try {
      const parsedCart = JSON.parse(rawCart);

      if (!Array.isArray(parsedCart)) {
        this.cartItems = [];
        this.cdr.detectChanges();
        return;
      }

      this.cartItems = parsedCart.map((item: unknown) =>
        this.mapStorageItemToCartItem(item)
      );

      this.hydrateMissingTopicNames();
      this.cdr.detectChanges();
    } catch (error: unknown) {
      console.error('Lỗi đọc giỏ hàng localStorage:', error);
      this.cartItems = [];
      this.cdr.detectChanges();
    }
  }

  private saveGuestCartToStorage(): void {
    if (!this.isBrowser) {
      return;
    }

    localStorage.setItem(this.guestCartStorageKey, JSON.stringify(this.cartItems));
    this.dispatchCartChanged();
  }

  private loadCartFromDatabase(): void {
    const customerId = this.getCustomerId();

    if (!customerId) {
      this.loadGuestCartFromStorage();
      return;
    }

    this.cartService.getCart(customerId).subscribe({
      next: (res: CartResponse) => {
        const items: CartApiItem[] = Array.isArray(res.items) ? res.items : [];

        this.cartItems = items.map((item: CartApiItem) =>
          this.mapApiItemToCartItem(item)
        );

        this.saveCustomerCartCache();
        this.cdr.detectChanges();
        this.dispatchCartChanged();
      },
      error: (err: unknown) => {
        console.error('Lỗi lấy giỏ hàng từ database:', err);
        if (this.cartItems.length === 0) this.cartItems = [];
        this.cdr.detectChanges();
      },
    });
  }

  private get customerCartCacheKey(): string {
    return `tiemHoaYen:cart:${this.cachedCustomerId}`;
  }

  private restoreCustomerCartCache(): void {
    if (!this.isBrowser || !this.isLoggedIn) return;

    try {
      const raw = localStorage.getItem(this.customerCartCacheKey);
      if (!raw) return;

      const cache = JSON.parse(raw) as { expiresAt?: number; items?: CartItem[] };
      if (!cache.expiresAt || cache.expiresAt <= Date.now() || !Array.isArray(cache.items)) {
        localStorage.removeItem(this.customerCartCacheKey);
        return;
      }

      this.cartItems = cache.items;
    } catch {
      localStorage.removeItem(this.customerCartCacheKey);
    }
  }

  private saveCustomerCartCache(): void {
    if (!this.isBrowser || !this.isLoggedIn) return;

    try {
      localStorage.setItem(this.customerCartCacheKey, JSON.stringify({
        expiresAt: Date.now() + this.cartCacheTtlMs,
        items: this.cartItems,
      }));
    } catch {
      // Cache chỉ dùng để tăng tốc, không làm gián đoạn giỏ hàng.
    }
  }

  private mapApiItemToCartItem(item: CartApiItem): CartItem {
    const topicName = this.getCartTopicName(item.TEN_CHU_DE);

    return {
      id: String(item.SAN_PHAM_ID || ''),
      name: String(item.TEN_SAN_PHAM || ''),
      style: String(item.KIEU_DANG || 'Sản phẩm'),
      occasion: topicName || 'Sản phẩm',
      topicName,
      price: Number(item.GIA_KHUYEN_MAI || item.GIA || 0),
      originalPrice: item.GIA_KHUYEN_MAI ? Number(item.GIA || 0) : null,
      quantity: Math.max(1, Number(item.SO_LUONG || 1)),
      image: this.getCartProductImage(item.TEN_SAN_PHAM, item.HINH_ANH),
      selected: true,
      maxQuantity:
        item.SO_LUONG_TON === null || item.SO_LUONG_TON === undefined
          ? undefined
          : Number(item.SO_LUONG_TON),
    };
  }

  private mapStorageItemToCartItem(item: unknown): CartItem {
    const data = item as Partial<CartItem> & {
      topicName?: string | null;
      TEN_CHU_DE?: string | null;
    };
    const topicName = this.getCartTopicName(data.TEN_CHU_DE || data.topicName || data.occasion);

    return {
      id: String(data.id || ''),
      name: String(data.name || ''),
      style: String(data.style || ''),
      occasion: topicName || 'Sản phẩm',
      topicName,
      price: Number(data.price || 0),
      originalPrice:
        data.originalPrice === null || data.originalPrice === undefined
          ? null
          : Number(data.originalPrice),
      quantity: Math.max(1, Number(data.quantity || 1)),
      image: String(data.image || this.defaultImage),
      selected: data.selected !== false,
      maxQuantity:
        data.maxQuantity === null || data.maxQuantity === undefined
          ? undefined
          : Number(data.maxQuantity),
    };
  }

  private getCartTopicName(value: unknown): string {
    const text = String(value || '').trim();
    const normalizedText = this.normalizeText(text);

    if (
      !text ||
      normalizedText === this.normalizeText('Đang bán') ||
      normalizedText === this.normalizeText('Sản phẩm')
    ) {
      return '';
    }

    return text;
  }

  getCartTopicLabel(item: CartItem): string {
    return item.topicName || 'Đang cập nhật';
  }

  private hydrateMissingTopicNames(): void {
    const itemsMissingTopic = this.cartItems.filter((item: CartItem) =>
      this.isProductItem(item) && !item.topicName
    );

    itemsMissingTopic.forEach((item: CartItem) => {
      this.productDetailService.getProductById(item.id).subscribe({
        next: (response) => {
          const topicName = this.getCartTopicName(response?.product?.TEN_CHU_DE);

          if (!topicName) {
            return;
          }

          item.topicName = topicName;
          item.occasion = topicName;

          if (!this.isLoggedIn) {
            this.saveGuestCartToStorage();
          }

          this.cdr.detectChanges();
        },
        error: (err: unknown) => {
          console.error('Lỗi lấy chủ đề sản phẩm trong giỏ hàng:', err);
        },
      });
    });
  }

  private loadCustomerVouchers(): void {
    const customerId = this.getCustomerId();

    if (!customerId) {
      this.availableVouchers = [];
      this.selectedProductVoucher = null;
      this.selectedShippingVoucher = null;
      return;
    }

    this.customerService.getVouchers(customerId).subscribe({
      next: (vouchers: CustomerVoucher[]) => {
        const items = Array.isArray(vouchers) ? vouchers : [];

        this.availableVouchers = items
          .filter((item: CustomerVoucher) => !this.isVoucherUsed(item))
          .filter((item: CustomerVoucher) => this.isVoucherValidDate(item))
          .map((item: CustomerVoucher) => this.mapCustomerVoucher(item));

        this.pickBestVouchersForSummary();
        this.cdr.detectChanges();
      },
      error: (err: unknown) => {
        console.error('Lỗi load voucher của khách hàng:', err);
        this.availableVouchers = [];
        this.selectedProductVoucher = null;
        this.selectedShippingVoucher = null;
        this.cdr.detectChanges();
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

  private mapCustomerVoucher(item: CustomerVoucher): CartVoucher {
    return {
      id: String(item.VOUCHER_ID || ''),
      code: String(item.MA_VOUCHER || '').trim(),
      type: String(item.LOAI_GIAM_GIA || '').trim(),
      value: Number(item.GIA_TRI_GIAM || 0),
      startDate: item.NGAY_BAT_DAU || null,
      endDate: item.NGAY_KET_THUC || null,
      used: item.DA_DUNG,
    };
  }

  private pickBestVouchersForSummary(): void {
    const productVouchers = this.availableVouchers
      .filter((voucher: CartVoucher) => this.isPercentVoucher(voucher))
      .sort((a: CartVoucher, b: CartVoucher) => b.value - a.value);

    const shippingVouchers = this.availableVouchers
      .filter((voucher: CartVoucher) => this.isCashVoucher(voucher))
      .sort((a: CartVoucher, b: CartVoucher) => b.value - a.value);

    this.selectedProductVoucher = productVouchers[0] || null;
    this.selectedShippingVoucher = shippingVouchers[0] || null;
  }

  private isPercentVoucher(voucher: CartVoucher): boolean {
    return this.normalizeText(voucher.type) === this.normalizeText('Phần trăm');
  }

  private isCashVoucher(voucher: CartVoucher): boolean {
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

  getSelectedCount(): number {
    return this.cartItems.filter((item: CartItem) => item.selected).length;
  }

  isAllSelected(): boolean {
    return this.cartItems.length > 0 &&
      this.cartItems.every((item: CartItem) => item.selected);
  }

  toggleSelectAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;

    this.cartItems.forEach((item: CartItem) => {
      item.selected = checked;
    });

    if (!this.isLoggedIn) {
      this.saveGuestCartToStorage();
    }

    this.cdr.detectChanges();
  }

  onItemSelectedChange(): void {
    if (!this.isLoggedIn) {
      this.saveGuestCartToStorage();
    }
  }

  increaseQty(item: CartItem): void {
    if (item.maxQuantity && item.quantity >= item.maxQuantity) {
      console.warn(`Số lượng "${item.name}" đã đạt tối đa`);
      return;
    }

    item.quantity++;
    this.saveCustomerCartCache();
    this.cdr.detectChanges();

    if (this.isLoggedIn && this.isProductItem(item)) {
      this.updateDatabaseQuantity(item);
      return;
    }

    this.saveGuestCartToStorage();
  }

  decreaseQty(item: CartItem): void {
    if (item.quantity <= 1) {
      return;
    }

    item.quantity--;
    this.saveCustomerCartCache();
    this.cdr.detectChanges();

    if (this.isLoggedIn && this.isProductItem(item)) {
      this.updateDatabaseQuantity(item);
      return;
    }

    this.saveGuestCartToStorage();
  }

  /**
   * Cập nhật số lượng lên database ở nền (background).
   * Giao diện đã cập nhật tức thì ở increaseQty/decreaseQty nên không cần
   * gọi lại loadCartFromDatabase() để tránh giật/tải lại giỏ hàng.
   */
  private updateDatabaseQuantity(item: CartItem): void {
    const customerId = this.getCustomerId();

    if (!customerId) {
      return;
    }

    const previousQuantity = item.quantity;

    this.cartService.updateItem(customerId, item.id, item.quantity).subscribe({
      next: () => {
        this.dispatchCartChanged();
      },
      error: (err: unknown) => {
        console.error('Lỗi cập nhật số lượng database:', err);
        // Hoàn tác số lượng nếu server từ chối cập nhật.
        item.quantity = previousQuantity;
        this.cdr.detectChanges();
      },
    });
  }

  removeItem(item: CartItem): void {
    // Cập nhật giao diện tức thì trước, không chờ phản hồi từ server.
    const removedItems = this.cartItems.filter(
      (cartItem: CartItem) => cartItem.id === item.id
    );

    this.cartItems = this.cartItems.filter(
      (cartItem: CartItem) => cartItem.id !== item.id
    );
    this.saveCustomerCartCache();
    this.cdr.detectChanges();

    if (this.isLoggedIn && this.isProductItem(item)) {
      const customerId = this.getCustomerId();

      this.cartService.removeItem(customerId, item.id).subscribe({
        next: () => {
          this.dispatchCartChanged();
        },
        error: (err: unknown) => {
          console.error('Lỗi xóa sản phẩm database:', err);
          // Hoàn tác nếu server từ chối xóa.
          this.cartItems = [...this.cartItems, ...removedItems];
          this.cdr.detectChanges();
        },
      });

      return;
    }

    this.saveGuestCartToStorage();
  }

  removeAllItems(): void {
    if (this.cartItems.length === 0) {
      return;
    }

    this.clearCheckoutItemsStorage();

    if (this.isLoggedIn) {
      const customerId = this.getCustomerId();
      const previousItems = this.cartItems;
      const productItems = previousItems.filter((item: CartItem) =>
        this.isProductItem(item)
      );

      // Xóa giao diện tức thì, không chờ server.
      this.cartItems = [];
      this.saveCustomerCartCache();
      this.cdr.detectChanges();

      if (productItems.length === 0) {
        this.dispatchCartChanged();
        return;
      }

      forkJoin(
        productItems.map((item: CartItem) =>
          this.cartService.removeItem(customerId, item.id)
        )
      ).subscribe({
        next: () => {
          this.dispatchCartChanged();
        },
        error: (err: unknown) => {
          console.error('Lỗi xóa toàn bộ giỏ hàng:', err);
          // Hoàn tác nếu server từ chối xóa.
          this.cartItems = previousItems;
          this.cdr.detectChanges();
        },
      });

      return;
    }

    this.cartItems = [];
    this.saveGuestCartToStorage();
  }

  private clearCheckoutItemsStorage(): void {
    if (!this.isBrowser) {
      return;
    }

    localStorage.removeItem(this.checkoutItemsStorageKey);
  }

  private isProductItem(item: CartItem): boolean {
    return String(item.id).startsWith('SP');
  }

  getSubtotal(): number {
    return this.cartItems
      .filter((item: CartItem) => item.selected)
      .reduce((sum: number, item: CartItem) => sum + item.price * item.quantity, 0);
  }

  getShippingFee(): number {
    return this.getSelectedCount() > 0 ? this.estimatedShippingFee : 0;
  }

  getProductVoucherDiscount(): number {
    if (!this.selectedProductVoucher || this.getSubtotal() <= 0) {
      return 0;
    }

    return Math.min(
      this.getSubtotal(),
      Math.round((this.getSubtotal() * this.selectedProductVoucher.value) / 100)
    );
  }

  getShippingVoucherDiscount(): number {
    if (!this.selectedShippingVoucher || this.getShippingFee() <= 0) {
      return 0;
    }

    return Math.min(this.getShippingFee(), Math.max(0, this.selectedShippingVoucher.value));
  }

  getTotal(): number {
    return Math.max(
      0,
      this.getSubtotal() +
        this.getShippingFee() -
        this.getProductVoucherDiscount() -
        this.getShippingVoucherDiscount()
    );
  }

  getSuggestedProducts(): SuggestedProduct[] {
    return this.suggestedProducts;
  }

  goToSuggestedProduct(product: SuggestedProduct): void {
    if (!product?.id || !product.id.startsWith('SP')) {
      return;
    }

    this.router.navigate(['/product-detail', product.id], {
      state: {
        productPreview: {
          id: product.id,
          name: product.name,
          image: product.image,
          price: product.price,
          originalPrice: product.originalPrice ?? null,
        },
      },
    });
  }

  addToCart(product: SuggestedProduct): void {
    if (!product.id || !product.id.startsWith('SP')) {
      console.warn('Sản phẩm mua kèm phải là sản phẩm trong bảng SAN_PHAM.');
      return;
    }

    const existingItem = this.cartItems.find(
      (item: CartItem) => item.id === product.id
    );

    if (existingItem?.maxQuantity && existingItem.quantity >= existingItem.maxQuantity) {
      console.warn(`Số lượng "${product.name}" đã đạt tối đa`);
      return;
    }

    // Cập nhật giao diện tức thì trước, không chờ phản hồi từ server.
    if (existingItem) {
      existingItem.quantity++;
      const topicName = this.getCartTopicName(product.status);

      if (topicName && !existingItem.topicName) {
        existingItem.topicName = topicName;
        existingItem.occasion = topicName;
      }
    } else {
      const topicName = this.getCartTopicName(product.status);

      this.cartItems.push({
        id: product.id,
        name: product.name,
        style: product.style || 'Sản phẩm mua kèm',
        occasion: topicName || 'Sản phẩm',
        topicName,
        price: product.price,
        originalPrice: product.originalPrice ?? null,
        quantity: 1,
        image: product.image,
        selected: true,
        maxQuantity: product.maxQuantity,
      });
    }

    this.saveCustomerCartCache();
    this.cdr.detectChanges();
    console.warn(`Đã thêm "${product.name}" vào giỏ hàng!`);

    if (this.isLoggedIn) {
      const customerId = this.getCustomerId();

      if (!customerId) {
        console.warn('Không tìm thấy thông tin khách hàng. Vui lòng đăng nhập lại.');
        return;
      }

      this.cartService.addItem(customerId, product.id, 1).subscribe({
        next: () => {
          this.dispatchCartChanged();
        },
        error: (err: unknown) => {
          console.error('Lỗi thêm sản phẩm mua kèm vào giỏ hàng database:', err);
        },
      });

      return;
    }

    this.saveGuestCartToStorage();
  }

  goToCheckout(): void {
    const selectedItems = this.cartItems.filter((item: CartItem) => item.selected);

    if (selectedItems.length === 0) {
      console.warn('Vui lòng chọn ít nhất một sản phẩm để đặt hàng.');
      return;
    }

    if (this.isBrowser) {
      localStorage.setItem(this.checkoutItemsStorageKey, JSON.stringify(selectedItems));
    }

    if (this.isLoggedIn) {
      this.router.navigate(['/order-registrant']);
      return;
    }

    this.router.navigate(['/order-haunt']);
  }

  prevSlide(): void {
    // Hiện đang cố định 4 sản phẩm mua kèm nên chưa cần slide
  }

  nextSlide(): void {
    // Hiện đang cố định 4 sản phẩm mua kèm nên chưa cần slide
  }

  formatPrice(price: number | null | undefined): string {
    const value = Number(price || 0);
    return value.toLocaleString('vi-VN') + 'đ';
  }

  private dispatchCartChanged(): void {
    if (this.isBrowser) {
      window.dispatchEvent(new Event('cart-changed'));
    }
  }

  private loadSuggestedMaterials(): void {
    this.materialService.getSuggestedMaterials().subscribe({
      next: (res: { products?: SuggestedProductResponse[]; materials?: SuggestedProductResponse[] }) => {
        const products: SuggestedProductResponse[] = Array.isArray(res.products)
          ? res.products
          : Array.isArray(res.materials)
            ? res.materials
            : [];

        this.suggestedProducts = products.map((item: SuggestedProductResponse) =>
          this.mapSuggestedProductResponse(item)
        );

        this.cdr.detectChanges();
      },
      error: (err: unknown) => {
        console.error('Lỗi load sản phẩm mua kèm:', err);
        this.suggestedProducts = [];
        this.cdr.detectChanges();
      },
    });
  }

  private mapSuggestedProductResponse(item: SuggestedProductResponse): SuggestedProduct {
    const id = String(item.SAN_PHAM_ID || item.NGUYEN_VAT_LIEU_ID || '');
    const originalPrice = Number(item.GIA || 0);
    const salePrice = Number(item.GIA_KHUYEN_MAI || 0);
    const price = salePrice > 0 && salePrice < originalPrice
      ? salePrice
      : Number(item.GIA_BAN || originalPrice || 0);

    return {
      id,
      name: String(item.TEN_SAN_PHAM || item.TEN_NGUYEN_VAT_LIEU || 'Sản phẩm mua kèm'),
      price,
      originalPrice: salePrice > 0 && salePrice < originalPrice ? originalPrice : null,
      image: this.getCartProductImage(item.TEN_SAN_PHAM, item.HINH_ANH),
      style: String(item.KIEU_DANG || 'Sản phẩm mua kèm'),
      status: this.getCartTopicName(item.TEN_CHU_DE || item.TRANG_THAI),
      maxQuantity: Number(item.SO_LUONG ?? item.SO_LUONG_TON ?? 0),
    };
  }

  private getCartProductImage(name: unknown, image: unknown): string {
    return String(name || '').trim().toLocaleLowerCase('vi-VN') === 'túi quà cao cấp'
      ? 'assets/images/tui-qua-cao-cap.png'
      : String(image || this.defaultImage);
  }
}
