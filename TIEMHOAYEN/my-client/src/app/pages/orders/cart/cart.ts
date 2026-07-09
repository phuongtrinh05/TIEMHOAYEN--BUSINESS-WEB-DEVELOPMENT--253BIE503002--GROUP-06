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

import { PageHeader } from '../../../components/page-header/page-header';
import { PageFooter } from '../../../components/page-footer/page-footer';

import { MaterialService } from '../../../services/material.service';

import {
  CartService,
  CartApiItem,
  CartResponse,
} from '../../../services/cart.service';



interface CartItem {
  id: string;
  name: string;
  style: string;
  occasion: string;
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

  // Giữ tương thích nếu backend cũ còn trả về format NGUYEN_VAT_LIEU.
  NGUYEN_VAT_LIEU_ID?: string;
  TEN_NGUYEN_VAT_LIEU?: string;
  GIA_BAN?: number | string | null;
  SO_LUONG_TON?: number | string | null;
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

  cartItems: CartItem[] = [];
  suggestedProducts: SuggestedProduct[] = [];
  isLoadingCart = false;

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    private materialService: MaterialService,
    private cartService: CartService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadCartByLoginState();
    this.loadSuggestedMaterials();
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

  private getCustomerId(): string {
    const customer = this.getLoggedInCustomer();
    return customer?.KHACH_HANG_ID ? String(customer.KHACH_HANG_ID) : '';
  }

  get isLoggedIn(): boolean {
    return !!this.getCustomerId();
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
      this.isLoadingCart = false;
      this.cdr.detectChanges();
      return;
    }

    try {
      const parsedCart = JSON.parse(rawCart);

      if (!Array.isArray(parsedCart)) {
        this.cartItems = [];
        this.isLoadingCart = false;
        this.cdr.detectChanges();
        return;
      }

      this.cartItems = parsedCart.map((item: unknown) =>
        this.mapStorageItemToCartItem(item)
      );

      this.isLoadingCart = false;
      this.cdr.detectChanges();
    } catch (error: unknown) {
      console.error('Lỗi đọc giỏ hàng localStorage:', error);
      this.cartItems = [];
      this.isLoadingCart = false;
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

    this.isLoadingCart = true;
    this.cdr.detectChanges();

    this.cartService.getCart(customerId).subscribe({
      next: (res: CartResponse) => {
        const items: CartApiItem[] = Array.isArray(res.items) ? res.items : [];

        this.cartItems = items.map((item: CartApiItem) =>
          this.mapApiItemToCartItem(item)
        );

        this.isLoadingCart = false;
        this.cdr.detectChanges();
        this.dispatchCartChanged();
      },
      error: (err: unknown) => {
        console.error('Lỗi lấy giỏ hàng từ database:', err);
        this.cartItems = [];
        this.isLoadingCart = false;
        this.cdr.detectChanges();
      },
    });
  }

  private mapApiItemToCartItem(item: CartApiItem): CartItem {
    return {
      id: String(item.SAN_PHAM_ID || ''),
      name: String(item.TEN_SAN_PHAM || ''),
      style: String(item.KIEU_DANG || 'Sản phẩm'),
      occasion: String(item.TRANG_THAI || 'Đang bán'),
      price: Number(item.GIA_KHUYEN_MAI || item.GIA || 0),
      originalPrice: item.GIA_KHUYEN_MAI ? Number(item.GIA || 0) : null,
      quantity: Math.max(1, Number(item.SO_LUONG || 1)),
      image: String(item.HINH_ANH || this.defaultImage),
      selected: true,
      maxQuantity:
        item.SO_LUONG_TON === null || item.SO_LUONG_TON === undefined
          ? undefined
          : Number(item.SO_LUONG_TON),
    };
  }

  private mapStorageItemToCartItem(item: unknown): CartItem {
    const data = item as Partial<CartItem>;

    return {
      id: String(data.id || ''),
      name: String(data.name || ''),
      style: String(data.style || ''),
      occasion: String(data.occasion || ''),
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

  getSelectedCount(): number {
    return this.cartItems.filter((item: CartItem) => item.selected).length;
  }

  isAllSelected(): boolean {
    return this.cartItems.length > 0 &&
      this.cartItems.every((item: CartItem) => item.selected);
  }

  toggleSelectAll(event: Event): void {
    if (this.isLoadingCart) {
      return;
    }

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
      alert(`Số lượng "${item.name}" đã đạt tối đa`);
      return;
    }

    item.quantity++;

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

    if (this.isLoggedIn && this.isProductItem(item)) {
      this.updateDatabaseQuantity(item);
      return;
    }

    this.saveGuestCartToStorage();
  }

  private updateDatabaseQuantity(item: CartItem): void {
    const customerId = this.getCustomerId();

    if (!customerId) {
      return;
    }

    this.cartService.updateItem(customerId, item.id, item.quantity).subscribe({
      next: () => {
        this.dispatchCartChanged();
        this.loadCartFromDatabase();
      },
      error: (err: unknown) => {
        console.error('Lỗi cập nhật số lượng database:', err);
        this.loadCartFromDatabase();
      },
    });
  }

  removeItem(item: CartItem): void {
    if (this.isLoggedIn && this.isProductItem(item)) {
      const customerId = this.getCustomerId();

      this.cartService.removeItem(customerId, item.id).subscribe({
        next: () => {
          this.dispatchCartChanged();
          this.loadCartFromDatabase();
        },
        error: (err: unknown) => {
          console.error('Lỗi xóa sản phẩm database:', err);
        },
      });

      return;
    }

    this.cartItems = this.cartItems.filter(
      (cartItem: CartItem) => cartItem.id !== item.id
    );

    this.saveGuestCartToStorage();
  }

  private isProductItem(item: CartItem): boolean {
    return String(item.id).startsWith('SP');
  }

  getSubtotal(): number {
    return this.cartItems
      .filter((item: CartItem) => item.selected)
      .reduce((sum: number, item: CartItem) => sum + item.price * item.quantity, 0);
  }

  getTotal(): number {
    return this.getSubtotal();
  }

  getSuggestedProducts(): SuggestedProduct[] {
    return this.suggestedProducts;
  }

  addToCart(product: SuggestedProduct): void {
    if (!product.id || !product.id.startsWith('SP')) {
      alert('Sản phẩm mua kèm phải là sản phẩm trong bảng SAN_PHAM.');
      return;
    }

    const existingItem = this.cartItems.find(
      (item: CartItem) => item.id === product.id
    );

    if (existingItem?.maxQuantity && existingItem.quantity >= existingItem.maxQuantity) {
      alert(`Số lượng "${product.name}" đã đạt tối đa`);
      return;
    }

    if (this.isLoggedIn) {
      const customerId = this.getCustomerId();

      if (!customerId) {
        alert('Không tìm thấy thông tin khách hàng. Vui lòng đăng nhập lại.');
        return;
      }

      this.cartService.addItem(customerId, product.id, 1).subscribe({
        next: () => {
          this.dispatchCartChanged();
          this.loadCartFromDatabase();
          alert(`Đã thêm "${product.name}" vào giỏ hàng!`);
        },
        error: (err: unknown) => {
          console.error('Lỗi thêm sản phẩm mua kèm vào giỏ hàng database:', err);
          alert('Không thể thêm sản phẩm vào giỏ hàng.');
        },
      });

      return;
    }

    if (existingItem) {
      existingItem.quantity++;
    } else {
      this.cartItems.push({
        id: product.id,
        name: product.name,
        style: product.style || 'Sản phẩm mua kèm',
        occasion: product.status || 'Đang bán',
        price: product.price,
        originalPrice: product.originalPrice ?? null,
        quantity: 1,
        image: product.image,
        selected: true,
        maxQuantity: product.maxQuantity,
      });
    }

    this.saveGuestCartToStorage();
    this.cdr.detectChanges();
    alert(`Đã thêm "${product.name}" vào giỏ hàng!`);
  }

  goToCheckout(): void {
    const selectedItems = this.cartItems.filter((item: CartItem) => item.selected);

    if (selectedItems.length === 0) {
      alert('Vui lòng chọn ít nhất một sản phẩm để đặt hàng.');
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
      image: String(item.HINH_ANH || this.defaultImage),
      style: String(item.KIEU_DANG || 'Sản phẩm mua kèm'),
      status: String(item.TRANG_THAI || 'Đang bán'),
      maxQuantity: Number(item.SO_LUONG ?? item.SO_LUONG_TON ?? 0),
    };
  }
}
