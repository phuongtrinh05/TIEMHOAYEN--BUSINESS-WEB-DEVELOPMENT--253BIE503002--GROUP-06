import {Design3dService} from '../../../services/design3d.service';
﻿import { CommonModule, isPlatformBrowser } from '@angular/common';
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
import { PricingService, ServerQuote } from '../../../services/pricing.service';



interface CartItem {
  id: string;
  designId?: string | null;
  requiresReview?: boolean;
  badges?: string[];
  lineKey: string;
  variantId?: string | null;
  configuration?: Record<string, unknown>;
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
  priceChanged?: boolean;
  priceWhenAdded?: number;
  availabilityDecision?: string;
  status?: string;
  purchasable: boolean;
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
  TON_KHA_DUNG?: number | string | null;
  KIEU_DANG?: string | null;
  TRANG_THAI?: string | null;
  CHU_DE_ID?: string | null;
  TEN_CHU_DE?: string | null;

  NGUYEN_VAT_LIEU_ID?: string;
  TEN_NGUYEN_VAT_LIEU?: string;
  GIA_BAN?: number | string | null;
  SO_LUONG_TON?: number | string | null;
}

type ShippingMethod = 'express' | 'standard';

interface CartVoucher {
  id: string;
  code: string;
  type: string;
  value: number;
  startDate?: string | null;
  endDate?: string | null;
  used?: boolean | number;
  maxDiscount?: number;
  minOrder?: number;
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

  private readonly guestCartStorageKey = 'tiemHoaYenCart';
  private readonly checkoutItemsStorageKey = 'tiemHoaYenCheckoutItems';

  private readonly defaultImage = 'assets/images/hoa.jpg';
  private readonly shippingMethodStorageKey = 'tiemHoaYenShippingMethod';
  private readonly cartCacheTtlMs = 10 * 60 * 1000;

  /** Nội thành TP.HCM: phí ship theo hình thức giao và giá trị đơn (tạm tính). */
  readonly shippingMethods: { id: ShippingMethod; label: string; eta: string }[] = [
    { id: 'standard', label: 'Giao tiêu chuẩn', eta: 'Trong ngày làm việc' },
    { id: 'express', label: 'Giao nhanh hỏa tốc', eta: '2-4 giờ, trong giờ làm việc' },
  ];
  shippingMethod: ShippingMethod = 'standard';

  cartItems: CartItem[] = [];
  suggestedProducts: SuggestedProduct[] = [];
  availableVouchers: CartVoucher[] = [];
  serverQuote: ServerQuote | null = null;
  quoteError = '';
  cartError = '';
  private quoteRequestVersion = 0;
  private cachedCustomerId = '';
  private suggestedMobileStartIndex = 0;

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    private materialService: MaterialService,
    private productDetailService: ProductDetailService,
    private cartService: CartService,
    private designApi: Design3dService,
    private customerService: CustomerService,
    private pricingService: PricingService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.cachedCustomerId = this.resolveCustomerId();
    this.restoreShippingMethod();
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

      this.hydrateDesignItems();
      this.hydrateMissingTopicNames();
      this.recalculateServerQuote();
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
        this.recalculateServerQuote();
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
    }
  }

  private mapApiItemToCartItem(item: CartApiItem): CartItem {
    const topicName = this.getCartTopicName(item.TEN_CHU_DE);
    const status = String(item.TRANG_THAI || '').trim();
    const purchasable = item.THIET_KE_3D_ID
      ? true
      : this.normalizeText(status) === this.normalizeText('Đang bán');

    return {
      id: String(item.SAN_PHAM_ID || ''),
      lineKey: String(item.LINE_KEY || item.SAN_PHAM_ID || ''),
      variantId: item.BIEN_THE_ID || null,
      designId: item.THIET_KE_3D_ID || item.THIET_KE_ID || null,
      configuration: item.CAU_HINH || {},
      requiresReview: !!item.CAN_SHOP_DUYET,
      badges: item.BADGES || [],
      name: String(item.TEN_SAN_PHAM || ''),
      style: String(item.KIEU_DANG || 'Sản phẩm'),
      occasion: topicName || 'Sản phẩm',
      topicName,
      price: Number(item.GIA_KHUYEN_MAI || item.GIA || 0),
      originalPrice: item.GIA_KHUYEN_MAI ? Number(item.GIA || 0) : null,
      quantity: Math.max(1, Number(item.SO_LUONG || 1)),
      image: this.getCartProductImage(item.TEN_SAN_PHAM, item.HINH_ANH),
      selected: true,
      purchasable,
      maxQuantity:
        item.TON_KHA_DUNG === null || item.TON_KHA_DUNG === undefined
          ? item.SO_LUONG_TON === null || item.SO_LUONG_TON === undefined
          ? undefined
          : Number(item.SO_LUONG_TON)
          : Number(item.TON_KHA_DUNG),
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
      lineKey: String(data.lineKey || data.id || ''),
      variantId: data.variantId || null,
      designId: data.designId || null,
      configuration: data.configuration || {},
      requiresReview: !!data.requiresReview,
      badges: data.badges || [],
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
      selected: data.purchasable !== false && data.selected !== false,
      maxQuantity: undefined,
      status: String(data.status || ''),
      purchasable: data.purchasable !== false,
    };
  }

  private hydrateDesignItems():void {
    for(const item of this.cartItems.filter(i=>i.id.startsWith('SP3D_')))this.designApi.get(item.id).subscribe({next:d=>{
      item.designId=d.designId;item.price=d.price;item.name=d.name;item.image=d.image || item.image;
      const short=d.materials.some(l=>l.quantity*item.quantity>l.available);
      item.requiresReview=d.requiresReview || short;item.badges=[...d.badges,...(short?['Số bó vượt NVL khả dụng']:[])];
      if(this.isLoggedIn)this.saveCustomerCartCache();else this.saveGuestCartToStorage();this.cdr.detectChanges();
    },error:()=>{item.requiresReview=true;item.badges=['Chưa xác minh được thiết kế; vui lòng tải lại trước khi đặt.'];this.cdr.detectChanges();}});
  }
  get hasDesignReview():boolean{return this.cartItems.some(i=>i.selected && i.requiresReview);}

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
      this.isProductItem(item) && !item.id.startsWith('SP3D_') && !item.topicName
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
      return;
    }

    this.customerService.getVouchers(customerId).subscribe({
      next: (vouchers: CustomerVoucher[]) => {
        const items = Array.isArray(vouchers) ? vouchers : [];

        this.availableVouchers = items
          .filter((item: CustomerVoucher) => !this.isVoucherUsed(item))
          .filter((item: CustomerVoucher) => this.isVoucherValidDate(item))
          .map((item: CustomerVoucher) => this.mapCustomerVoucher(item));

        this.cdr.detectChanges();
      },
      error: (err: unknown) => {
        console.error('Lỗi load voucher của khách hàng:', err);
        this.availableVouchers = [];
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
      maxDiscount: Number(item.GIAM_TOI_DA || 0),
      minOrder: Number(item.DON_TOI_THIEU || 0),
    };
  }

  /**
   * Chỉ chọn MỘT voucher (sản phẩm hoặc ship) có mức giảm thực tế cao nhất
   * theo tạm tính và phí ship hiện tại.
   */
  private get bestVoucher(): { voucher: CartVoucher; discount: number; shipping: boolean } | null {
    const subtotal = this.getSubtotal();
    const shippingFee = this.getShippingFee();
    let best: { voucher: CartVoucher; discount: number; shipping: boolean } | null = null;

    for (const voucher of this.availableVouchers) {
      const shipping = this.isShippingVoucher(voucher);
      const discount = shipping
        ? this.calculateShippingVoucherDiscount(voucher, subtotal, shippingFee)
        : this.calculateProductVoucherDiscount(voucher, subtotal);

      if (discount > (best?.discount ?? 0)) {
        best = { voucher, discount, shipping };
      }
    }

    return best;
  }

  get selectedProductVoucher(): CartVoucher | null {
    const best = this.bestVoucher;
    return best && !best.shipping ? best.voucher : null;
  }

  get selectedShippingVoucher(): CartVoucher | null {
    const best = this.bestVoucher;
    return best && best.shipping ? best.voucher : null;
  }

  private calculateShippingVoucherDiscount(voucher: CartVoucher, subtotal: number, shippingFee: number): number {
    if (shippingFee <= 0 || voucher.value <= 0) return 0;
    if ((voucher.minOrder || 0) > 0 && subtotal < (voucher.minOrder || 0)) return 0;

    let discount = this.isPercentVoucher(voucher)
      ? Math.round((shippingFee * voucher.value) / 100)
      : voucher.value;

    if (this.isPercentVoucher(voucher) && (voucher.maxDiscount || 0) > 0) {
      discount = Math.min(discount, voucher.maxDiscount as number);
    }

    return Math.min(shippingFee, Math.max(0, Math.round(discount)));
  }

  private calculateProductVoucherDiscount(voucher: CartVoucher, subtotal: number): number {
    if (subtotal <= 0 || voucher.value <= 0) return 0;
    if ((voucher.minOrder || 0) > 0 && subtotal < (voucher.minOrder || 0)) return 0;

    let discount: number;

    if (this.isPercentVoucher(voucher)) {
      discount = Math.round((subtotal * voucher.value) / 100);
      if ((voucher.maxDiscount || 0) > 0) {
        discount = Math.min(discount, voucher.maxDiscount as number);
      }
    } else {
      discount = voucher.value;
    }

    return Math.min(subtotal, Math.max(0, Math.round(discount)));
  }

  private isPercentVoucher(voucher: CartVoucher): boolean {
    return this.normalizeText(voucher.type) === this.normalizeText('Phần trăm');
  }

  private isShippingVoucher(voucher: CartVoucher): boolean {
    const type = this.normalizeText(voucher.type);
    return type === this.normalizeText('Phí vận chuyển') || type.includes('ship');
  }

  /** Báo giá sản phẩm (không ship, không voucher) để cập nhật giá hiện tại. Báo giá chính thức thực hiện ở checkout. */
  private recalculateServerQuote(): void {
    const items = this.cartItems
      .filter(item => item.selected && this.isProductItem(item))
      .map(item => ({
        id: item.id,
        quantity: item.quantity,
        lineKey: item.lineKey,
        variantId: item.variantId,
        designId: item.designId,
        configuration: item.configuration,
        displayedUnitPrice: item.price,
      }));
    const requestVersion = ++this.quoteRequestVersion;

    if (!items.length) {
      this.serverQuote = null;
      this.quoteError = '';
      return;
    }

    this.pricingService.quote({
      items,
      shippingFee: 0,
      voucher: null,
      customerId: this.getCustomerId() || null,
    }).subscribe({
      next: quote => {
        if (requestVersion !== this.quoteRequestVersion) return;
        quote.items.forEach(serverItem => {
          const item = this.cartItems.find(cartItem => cartItem.lineKey === serverItem.lineKey);
          if (!item) return;
          if (serverItem.priceChanged) {
            item.priceWhenAdded = item.price;
            item.priceChanged = true;
          }
          item.price = serverItem.unitPrice;
          item.originalPrice = serverItem.regularPrice > serverItem.unitPrice ? serverItem.regularPrice : null;
          item.availabilityDecision = String(serverItem.availability?.decision || '');
          item.maxQuantity = undefined;
        });
        this.serverQuote = quote;
        this.quoteError = '';
        this.cdr.detectChanges();
      },
      error: error => {
        if (requestVersion !== this.quoteRequestVersion) return;
        this.serverQuote = null;
        this.quoteError = error?.error?.message || 'Không thể kiểm tra giá sản phẩm.';
        this.cdr.detectChanges();
      },
    });
  }

  canCheckout(): boolean {
    return this.getSelectedCount() > 0;
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
    const purchasableItems = this.cartItems.filter((item) => item.purchasable);
    return purchasableItems.length > 0 && purchasableItems.every((item) => item.selected);
  }

  toggleSelectAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;

    this.cartItems.forEach((item: CartItem) => {
      item.selected = item.purchasable ? checked : false;
    });

    if (!this.isLoggedIn) {
      this.saveGuestCartToStorage();
    }

    this.cdr.detectChanges();
    this.recalculateServerQuote();
  }

  onItemSelectedChange(): void {
    this.cartItems.forEach((item) => {
      if (!item.purchasable) item.selected = false;
    });
    if (!this.isLoggedIn) {
      this.saveGuestCartToStorage();
    }
    this.recalculateServerQuote();
  }

  increaseQty(item: CartItem): void {
    this.setQuantity(item, item.quantity + 1);
  }

  decreaseQty(item: CartItem): void {
    this.setQuantity(item, item.quantity - 1);
  }

  /** Nhập số lượng trực tiếp trong ô số lượng của giỏ hàng. */
  onQuantityInput(item: CartItem, event: Event): void {
    const input = event.target as HTMLInputElement;
    const parsed = Math.floor(Number(input.value));
    const next = Number.isFinite(parsed) && parsed >= 1 ? parsed : item.quantity;

    this.setQuantity(item, next);
    input.value = String(item.quantity);
  }

  private setQuantity(item: CartItem, requested: number): void {
    if (!item.purchasable) return;

    let next = Math.max(1, Math.floor(requested));
    if (item.maxQuantity && next > item.maxQuantity) {
      next = item.maxQuantity;
      this.cartError = `"${item.name}" chỉ còn tối đa ${item.maxQuantity} sản phẩm.`;
    } else {
      this.cartError = '';
    }

    const previousQuantity = item.quantity;
    if (next === previousQuantity) {
      this.cdr.detectChanges();
      return;
    }

    item.quantity = next;
    if (item.id.startsWith('SP3D_')) this.hydrateDesignItems();
    this.saveCustomerCartCache();
    this.cdr.detectChanges();
    this.recalculateServerQuote();

    if (this.isLoggedIn && this.isProductItem(item)) {
      this.updateDatabaseQuantity(item, previousQuantity);
      return;
    }

    this.saveGuestCartToStorage();
  }

  /** Bấm vào ảnh/tên sản phẩm trong giỏ để mở trang chi tiết. */
  canOpenProductDetail(item: CartItem): boolean {
    return !!item.id && item.id.startsWith('SP') && !item.id.startsWith('SP3D_');
  }

  goToProductDetail(item: CartItem): void {
    if (!this.canOpenProductDetail(item)) return;

    this.router.navigate(['/product-detail', item.id], {
      state: {
        productPreview: {
          id: item.id,
          name: item.name,
          image: item.image,
          price: item.price,
          originalPrice: item.originalPrice ?? null,
        },
      },
    });
  }

  private updateDatabaseQuantity(item: CartItem, previousQuantity: number): void {
    const customerId = this.getCustomerId();

    if (!customerId) {
      return;
    }

    this.cartService.updateItem(customerId, item.id, item.quantity, item.lineKey).subscribe({
      next: () => {
        this.dispatchCartChanged();
      },
      error: (err: unknown) => {
        console.error('Lỗi cập nhật số lượng database:', err);
        item.quantity = previousQuantity;
        this.saveCustomerCartCache();
        this.recalculateServerQuote();
        this.cartError = (err as any)?.error?.message || 'Không thể cập nhật số lượng sản phẩm.';
        this.cdr.detectChanges();
      },
    });
  }

  removeItem(item: CartItem): void {
    const removedItems = this.cartItems.filter(
      (cartItem: CartItem) => cartItem.lineKey === item.lineKey
    );

    this.cartItems = this.cartItems.filter(
      (cartItem: CartItem) => cartItem.lineKey !== item.lineKey
    );
    this.saveCustomerCartCache();
    this.cdr.detectChanges();

    if (this.isLoggedIn && this.isProductItem(item)) {
      const customerId = this.getCustomerId();

      this.cartService.removeItem(customerId, item.id, item.lineKey).subscribe({
        next: () => {
          this.dispatchCartChanged();
        },
        error: (err: unknown) => {
          console.error('Lỗi xóa sản phẩm database:', err);
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

      this.cartItems = [];
      this.saveCustomerCartCache();
      this.cdr.detectChanges();

      if (productItems.length === 0) {
        this.dispatchCartChanged();
        return;
      }

      forkJoin(
        productItems.map((item: CartItem) =>
          this.cartService.removeItem(customerId, item.id, item.lineKey)
        )
      ).subscribe({
        next: () => {
          this.dispatchCartChanged();
        },
        error: (err: unknown) => {
          console.error('Lỗi xóa toàn bộ giỏ hàng:', err);
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
    if (this.serverQuote) return this.serverQuote.subtotal;
    return this.cartItems
      .filter((item: CartItem) => item.selected)
      .reduce((sum: number, item: CartItem) => sum + item.price * item.quantity, 0);
  }

  /**
   * Phí ship nội thành TP.HCM theo bảng quy định (tính theo tạm tính):
   *  - Hỏa tốc: < 300.000đ: 60.000đ | 300.000-500.000đ: 30.000đ | > 500.000đ: miễn phí
   *  - Tiêu chuẩn: < 300.000đ: 30.000đ | từ 300.000đ trở lên: miễn phí
   */
  getShippingFee(): number {
    if (this.getSelectedCount() === 0) return 0;

    const subtotal = this.getSubtotal();

    if (this.shippingMethod === 'express') {
      if (subtotal < 300000) return 60000;
      if (subtotal <= 500000) return 30000;
      return 0;
    }

    return subtotal < 300000 ? 30000 : 0;
  }

  setShippingMethod(method: ShippingMethod): void {
    this.shippingMethod = method;

    if (this.isBrowser) {
      try {
        localStorage.setItem(this.shippingMethodStorageKey, method);
      } catch {
      }
    }

    this.cdr.detectChanges();
  }

  private restoreShippingMethod(): void {
    if (!this.isBrowser) return;

    try {
      const saved = localStorage.getItem(this.shippingMethodStorageKey);
      if (saved === 'express' || saved === 'standard') {
        this.shippingMethod = saved;
      }
    } catch {
    }
  }

  getProductVoucherDiscount(): number {
    const voucher = this.selectedProductVoucher;
    return voucher ? this.calculateProductVoucherDiscount(voucher, this.getSubtotal()) : 0;
  }

  getShippingVoucherDiscount(): number {
    const voucher = this.selectedShippingVoucher;
    return voucher
      ? this.calculateShippingVoucherDiscount(voucher, this.getSubtotal(), this.getShippingFee())
      : 0;
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
    if (!this.isBrowser || window.innerWidth > 768 || this.suggestedProducts.length <= 2) {
      return this.suggestedProducts;
    }

    return [
      this.suggestedProducts[this.suggestedMobileStartIndex],
      this.suggestedProducts[(this.suggestedMobileStartIndex + 1) % this.suggestedProducts.length],
    ];
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

    if (existingItem && !existingItem.purchasable) {
      console.warn(`Sản phẩm "${product.name}" đã ngừng bán.`);
      return;
    }

    if (existingItem?.maxQuantity && existingItem.quantity >= existingItem.maxQuantity) {
      console.warn(`Số lượng "${product.name}" đã đạt tối đa`);
      return;
    }

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
        lineKey: product.id,
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
        status: 'Đang bán',
        purchasable: true,
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

      this.cartService.addItem(customerId, product.id, 1, { lineKey: existingItem?.lineKey || product.id }).subscribe({
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
    if (!this.isBrowser || window.innerWidth > 768 || this.suggestedProducts.length <= 2) return;

    const lastGroupStart = Math.floor((this.suggestedProducts.length - 1) / 2) * 2;
    this.suggestedMobileStartIndex = this.suggestedMobileStartIndex <= 0
      ? lastGroupStart
      : Math.max(0, this.suggestedMobileStartIndex - 2);
  }

  nextSlide(): void {
    if (!this.isBrowser || window.innerWidth > 768 || this.suggestedProducts.length <= 2) return;

    const nextIndex = this.suggestedMobileStartIndex + 2;
    this.suggestedMobileStartIndex = nextIndex >= this.suggestedProducts.length ? 0 : nextIndex;
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

        const existingIds = new Set(this.cartItems.map(item => item.id));
        this.suggestedProducts = products
          .filter(item => !item.TRANG_THAI || this.normalizeText(String(item.TRANG_THAI)) === this.normalizeText('Đang bán'))
          .map((item: SuggestedProductResponse) => this.mapSuggestedProductResponse(item))
          .filter(product => product.id.startsWith('SP') && !existingIds.has(product.id))
          .slice(0, 4);
        this.suggestedMobileStartIndex = 0;

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
      maxQuantity: Number(item.TON_KHA_DUNG ?? item.SO_LUONG ?? item.SO_LUONG_TON ?? 0),
    };
  }

  private getCartProductImage(name: unknown, image: unknown): string {
    return String(name || '').trim().toLocaleLowerCase('vi-VN') === 'túi quà cao cấp'
      ? 'assets/images/tui-qua-cao-cap.png'
      : String(image || this.defaultImage);
  }
}