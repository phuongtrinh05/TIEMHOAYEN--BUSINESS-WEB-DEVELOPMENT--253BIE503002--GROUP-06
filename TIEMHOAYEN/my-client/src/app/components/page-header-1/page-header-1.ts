import {
  Component,
  HostListener,
  ElementRef,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  Inject,
  PLATFORM_ID,
  ViewChild
} from '@angular/core';

import { isPlatformBrowser, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NavigationEnd, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subscription, filter } from 'rxjs';
import { CartService } from '../../services/cart.service';

import {
  CollectionService,
  Collection
} from '../../services/collection.service'; 

import {
  TopicService,
  Topic
} from '../../services/topic.service';
import {
  TargetService,
  Target
} from '../../services/target.service';

import {
  FlowerService,
  Flower
} from '../../services/flower.service';

import {
  StyleService,
  Style
} from '../../services/style.service';


interface HeaderSearchProduct {
  id: string;
  name: string;
  image: string;
  originalPrice: number;
  salePrice: number | null;
  finalPrice: number;
  hasDiscount: boolean;
  meta: string;
  sold: number;
}

interface HeaderNotification {
  id: string;
  type: 'order' | 'promotion' | 'point' | 'review' | 'system';
  image: string;
  title: string;
  message: string;
  time: string;
  date: string;
  isRead: boolean;
  link: string;
}

interface HeaderCartItem {
  id: string;
  name: string;
  image: string;
  price: number;
  quantity: number;
}

@Component({
  selector: 'app-page-header-1',
  standalone: true,
  imports: [
    NgIf,
    RouterLink,
    FormsModule
  ],
  templateUrl: './page-header-1.html',
  styleUrl: './page-header-1.css',
})
export class PageHeader1 implements OnInit, OnDestroy {
  showLookupPopup = false;
  orderCode: string = '';
  phone: string = '';

  private readonly productApiUrl = 'http://localhost:3000/api/products';
  private readonly notificationApiUrl = 'http://localhost:3000/api/notifications';

  searchKeyword = '';
  searchResults: HeaderSearchProduct[] = [];
  showSearchSuggestions = false;
  isSearchLoading = false;
  searchMessage = '';
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private allSearchProductsCache: HeaderSearchProduct[] = [];
  private hasLoadedSearchCache = false;

  showImageSearchMenu = false;

  @ViewChild('uploadFileInput') uploadFileInput?: ElementRef<HTMLInputElement>;

  

  openLookupPopup() {
    this.showLookupPopup = true;
  }

  closeLookupPopup() {
    this.showLookupPopup = false;
  }

  lookupOrder(): void {
    const orderCode = String(this.orderCode || '').trim().toUpperCase();
    const receiverPhone = this.normalizeLookupPhone(this.phone);

    if (!orderCode) {
      alert('Vui lòng nhập mã đơn hàng.');
      return;
    }

    if (!receiverPhone) {
      alert('Vui lòng nhập số điện thoại nhận hàng.');
      return;
    }

    if (!/^0\d{9}$/.test(receiverPhone)) {
      alert('Số điện thoại nhận hàng không hợp lệ.');
      return;
    }

    this.showLookupPopup = false;
    this.orderCode = '';
    this.phone = '';

    this.router.navigate(['/order-detail', orderCode], {
      queryParams: {
        phone: receiverPhone,
      },
    });
  }

  onLookupPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.phone = this.formatLookupPhone(input.value);
  }

  private normalizeLookupPhone(phone: string): string {
    return String(phone || '').replace(/\D/g, '').slice(0, 10);
  }

  private formatLookupPhone(phone: string): string {
    const digits = this.normalizeLookupPhone(phone);

    if (digits.length <= 4) {
      return digits;
    }

    if (digits.length <= 7) {
      return `${digits.slice(0, 4)} ${digits.slice(4)}`;
    }

    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }


  goToWishlist(): void {
    if (!this.isBrowser()) {
      return;
    }

    const rawCustomer = localStorage.getItem('khachHang');

    if (!rawCustomer || rawCustomer === 'null' || rawCustomer === 'undefined') {
      this.showAccountMenu = false;
      this.showLanguageMenu = false;
      this.showMobileMenu = false;
      this.router.navigate(['/login']);
      return;
    }

    try {
      const customer = JSON.parse(rawCustomer);

      if (!customer?.KHACH_HANG_ID) {
        this.showAccountMenu = false;
        this.showLanguageMenu = false;
        this.showMobileMenu = false;
        this.router.navigate(['/login']);
        return;
      }

      this.showAccountMenu = false;
      this.showLanguageMenu = false;
      this.showMobileMenu = false;
      this.closeAllSubMenus();

      this.router.navigate(['/account'], {
        queryParams: { section: 'wishlist' },
        fragment: 'wishlist',
      });
    } catch {
      this.showAccountMenu = false;
      this.showLanguageMenu = false;
      this.showMobileMenu = false;
      this.router.navigate(['/login']);
    }
  }

  isScrolled = false;

  showSearch = false;
  showAccountMenu = false;
  showLanguageMenu = false;
  isLoggedIn = false;

  showNotifications = false;
  showCartMenu = false;


  private notificationHoverTimer: ReturnType<typeof setTimeout> | null = null;
  private cartHoverTimer: ReturnType<typeof setTimeout> | null = null;
  private accountHoverTimer: ReturnType<typeof setTimeout> | null = null;

  notifications: HeaderNotification[] = [];

  cartItems: HeaderCartItem[] = [];

  currentLanguage = 'vi';
  currentCustomer: any = null;
  customerDisplayName = '';
  customerAvatar = '';

  cartCount = 0;
  private routerSubscription: Subscription | null = null;
  private cartRefreshTimer: number | null = null;
  private isLoadingCartCount = false;

  showMobileMenu = false;

  showTopic = false;
  showTarget = false;
  showStyle = false;
  showFlower = false;
  showCollection = false;
  showSupport = false;
  showAbout = false;

  collections: Collection[] = [];
  topics: Topic[] = [];
  targets: Target[] = [];
  flowers: Flower[] = [];
  styles: Style[] = [];


  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    private elementRef: ElementRef,
    private collectionService: CollectionService,
    private topicService: TopicService,
    private targetService: TargetService,
    private flowerService: FlowerService,
    private styleService: StyleService,
    private cartService: CartService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  // Angular Router mặc định KHÔNG tự cuộn về đầu trang khi điều hướng bằng
  // routerLink (đây là do RouterModule chưa bật scrollPositionRestoration ở
  // app-routing, hoặc route dùng cùng component chỉ đổi query/param).
  // Gọi thủ công ở đây để chắc chắn luôn về đầu trang sau mỗi lần chuyển route.
  private scrollToTop(): void {
    if (!this.isBrowser()) {
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }

  ngOnInit(): void {
    this.loadLoggedInCustomer();
    this.loadCartCount();
    this.loadNotifications();
    this.loadSearchProductCache();
    this.startCartAutoRefresh();

    this.routerSubscription = this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        this.loadLoggedInCustomer();
        this.loadCartCount();
        this.loadNotifications();

        this.showSearch = false;
        this.showAccountMenu = false;
        this.showLanguageMenu = false;
        this.showNotifications = false;
        this.showCartMenu = false;
        this.showImageSearchMenu = false;
        this.showMobileMenu = false;
        this.closeSearchSuggestions();
        this.closeAllSubMenus();

        this.scrollToTop();
      });

    this.getCollections();
    this.getTopics();
    this.getTargets();
    this.getFlowers();
    this.getStyles();
  }

  ngOnDestroy(): void {
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
      this.routerSubscription = null;
    }

    if (this.cartRefreshTimer !== null && this.isBrowser()) {
      window.clearInterval(this.cartRefreshTimer);
      this.cartRefreshTimer = null;
    }

    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    this.notificationHoverTimer = this.clearHoverTimer(this.notificationHoverTimer);
    this.cartHoverTimer = this.clearHoverTimer(this.cartHoverTimer);
    this.accountHoverTimer = this.clearHoverTimer(this.accountHoverTimer);
  }

  @HostListener('window:storage')
  onStorageChange(): void {
    if (!this.isBrowser()) {
      return;
    }

    this.loadLoggedInCustomer();
    this.loadCartCount();
    this.loadNotifications();
  }

  @HostListener('window:auth-changed')
  onAuthChanged(): void {
    if (!this.isBrowser()) {
      return;
    }

    this.loadLoggedInCustomer();
    this.loadCartCount();
    this.loadNotifications();
  }

  @HostListener('window:cart-changed')
  onCartChanged(): void {
    if (!this.isBrowser()) {
      return;
    }

    this.loadCartCount();
  }

  loadLoggedInCustomer(): void {
    if (!this.isBrowser()) {
      return;
    }

    const rawCustomer = localStorage.getItem('khachHang');

    if (!rawCustomer) {
      this.resetLoggedInCustomer();
      return;
    }

    try {
      const customer = JSON.parse(rawCustomer);

      this.currentCustomer = customer;
      this.isLoggedIn = true;
      this.customerDisplayName = this.getCustomerName(customer);
      this.customerAvatar = this.getCustomerAvatar(customer);
    } catch (error) {
      console.error('Lỗi đọc thông tin khách hàng:', error);
      this.resetLoggedInCustomer();
    }
  }

  private resetLoggedInCustomer(): void {
    this.currentCustomer = null;
    this.isLoggedIn = false;
    this.customerDisplayName = '';
    this.customerAvatar = '';
  }

  private getCustomerName(customer: any): string {
    return (
      customer?.TEN_KHACH_HANG ||
      customer?.HO_TEN ||
      customer?.TEN ||
      customer?.name ||
      customer?.fullName ||
      customer?.SDT ||
      'Tài khoản'
    );
  }

  private getCustomerAvatar(customer: any): string {
    return (
      customer?.ANH_DAI_DIEN ||
      customer?.HINH_DAI_DIEN ||
      customer?.AVATAR ||
      customer?.avatar ||
      customer?.photoURL ||
      ''
    );
  }

  get customerInitial(): string {
    const name = this.customerDisplayName || 'T';

    return name.trim().charAt(0).toUpperCase();
  }

  onAvatarError(): void {
    this.customerAvatar = '';
  }

  private startCartAutoRefresh(): void {
    if (!this.isBrowser()) {
      return;
    }

    if (this.cartRefreshTimer !== null) {
      window.clearInterval(this.cartRefreshTimer);
    }

    this.cartRefreshTimer = window.setInterval(() => {
      this.loadCartCount();
    }, 2000);
  }

  private loadCartCount(): void {
    if (!this.isBrowser()) {
      this.cartCount = 0;
      return;
    }

    if (this.isLoadingCartCount) {
      return;
    }

    const customerId = this.getLoggedInCustomerId();

    if (!customerId) {
      this.cartCount = this.getGuestCartCount();
      this.cartItems = this.getGuestCartItems();
      this.cdr.detectChanges();
      return;
    }

    this.isLoadingCartCount = true;

    this.cartService.getCart(customerId).subscribe({
      next: (res: any) => {
        const items = Array.isArray(res?.items) ? res.items : [];

        this.cartCount = items.length;

        this.cartItems = items.map((item: any) => this.normalizeCartItem(item));

        this.isLoadingCartCount = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.cartCount = this.getGuestCartCount();
        this.cartItems = this.getGuestCartItems();
        this.isLoadingCartCount = false;
        this.cdr.detectChanges();
      }
    });
  }

  private normalizeCartItem(item: any): HeaderCartItem {
    const product = item?.SAN_PHAM || item?.sanPham || item?.product || {};

    return {
      id: String(
        item?.SAN_PHAM_ID ??
        item?.sanPhamId ??
        item?.productId ??
        item?.PRODUCT_ID ??
        product?.SAN_PHAM_ID ??
        product?.id ??
        item?.id ??
        item?.SO_ID ??
        ''
      ),

      // Ưu tiên đúng tên sản phẩm từ API/backend.
      name: String(
        item?.TEN_SAN_PHAM ??
        item?.TEN_SP ??
        item?.tenSanPham ??
        item?.productName ??
        item?.name ??
        product?.TEN_SAN_PHAM ??
        product?.TEN_SP ??
        product?.tenSanPham ??
        product?.productName ??
        product?.name ??
        'Sản phẩm'
      ).trim(),

      image: this.normalizeImageUrl(
        item?.HINH_ANH ??
        item?.hinhAnh ??
        item?.image ??
        product?.HINH_ANH ??
        product?.hinhAnh ??
        product?.image ??
        ''
      ),

      price: Number(
        item?.GIA_KHUYEN_MAI ??
        item?.DON_GIA ??
        item?.GIA_BAN ??
        item?.GIA ??
        item?.price ??
        product?.GIA_KHUYEN_MAI ??
        product?.DON_GIA ??
        product?.GIA_BAN ??
        product?.GIA ??
        product?.price ??
        0
      ),

      quantity: Math.max(
        1,
        Number(
          item?.SO_LUONG ??
          item?.soLuong ??
          item?.quantity ??
          item?.QUANTITY ??
          1
        )
      )
    };
  }

  private getGuestCartItems(): HeaderCartItem[] {
    if (!this.isBrowser()) {
      return [];
    }

    const rawCart = localStorage.getItem('tiemHoaYenCart');

    if (!rawCart) {
      return [];
    }

    try {
      const cart = JSON.parse(rawCart);

      if (!Array.isArray(cart)) {
        return [];
      }

      return cart.map((item: any) => this.normalizeCartItem(item));
    } catch {
      return [];
    }
  }

  private getGuestCartCount(): number {
    if (!this.isBrowser()) {
      return 0;
    }

    const rawCart = localStorage.getItem('tiemHoaYenCart');

    if (!rawCart) {
      return 0;
    }

    try {
      const cart = JSON.parse(rawCart);

      if (!Array.isArray(cart)) {
        return 0;
      }

      return cart.length;
    } catch {
      return 0;
    }
  }

  private getLoggedInCustomerId(): string {
    if (!this.isBrowser()) {
      return '';
    }

    try {
      const rawCustomer = localStorage.getItem('khachHang');
      const customer = rawCustomer ? JSON.parse(rawCustomer) : null;

      return String(customer?.KHACH_HANG_ID || '');
    } catch {
      return '';
    }
  }

  get cartBadgeText(): string {
    return this.cartCount > 99 ? '99+' : String(this.cartCount);
  }

  get unreadNotificationCount(): number {
    return this.notifications.filter(n => !n.isRead).length;
  }

  get notificationBadgeText(): string {
    return this.unreadNotificationCount > 99 ? '99+' : String(this.unreadNotificationCount);
  }

  get cartSubtotal(): number {
    return this.cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }

  formatCartPrice(value: number): string {
    return (value || 0).toLocaleString('vi-VN') + 'đ';
  }


  private loadNotifications(): void {
    if (!this.isBrowser()) {
      return;
    }

    const customerId = this.getLoggedInCustomerId();
    const requestUrl = customerId
      ? `${this.notificationApiUrl}?customerId=${encodeURIComponent(customerId)}&limit=10`
      : `${this.notificationApiUrl}/public?limit=10`;

    this.http.get<any>(requestUrl).subscribe({
      next: (res) => {
        const items = Array.isArray(res?.notifications)
          ? res.notifications
          : Array.isArray(res?.items)
            ? res.items
            : Array.isArray(res)
              ? res
              : [];

        this.notifications = items.map((item: any) => this.mapNotification(item));
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.warn('Chưa lấy được thông báo từ backend:', err);
        this.notifications = [];
        this.cdr.detectChanges();
      }
    });
  }

  private mapNotification(item: any): HeaderNotification {
    const rawType = String(item?.type || item?.LOAI_THONG_BAO || '').trim().toLowerCase();

    let type: HeaderNotification['type'] = 'system';

    if (
      rawType.includes('promotion') ||
      rawType.includes('khuyến') ||
      rawType.includes('khuyen') ||
      rawType.includes('voucher') ||
      rawType.includes('ưu đãi') ||
      rawType.includes('uu dai')
    ) {
      type = 'promotion';
    } else if (
      rawType.includes('point') ||
      rawType.includes('điểm') ||
      rawType.includes('diem') ||
      rawType.includes('reward') ||
      rawType.includes('thưởng') ||
      rawType.includes('thuong')
    ) {
      type = 'point';
    } else if (
      rawType.includes('review') ||
      rawType.includes('đánh giá') ||
      rawType.includes('danh gia')
    ) {
      type = 'review';
    } else if (
      rawType.includes('order') ||
      rawType.includes('đơn') ||
      rawType.includes('don') ||
      rawType.includes('thanh toán') ||
      rawType.includes('thanh toan') ||
      rawType.includes('giao')
    ) {
      type = 'order';
    }

    const createdAt = item?.createdAt || item?.NGAY_TAO || item?.THOI_GIAN || new Date().toISOString();
    const dateObj = new Date(createdAt);
    const hasValidDate = !Number.isNaN(dateObj.getTime());

    const orderCode = item?.MA_DON_HANG || item?.orderCode || item?.DON_HANG_ID || '';

    return {
      id: String(item?.id || item?.THONG_BAO_ID || item?.MA_THONG_BAO || `${type}-${Date.now()}-${Math.random()}`),
      type,
      image: this.normalizeImageUrl(item?.image || item?.HINH_ANH || item?.ANH || ''),
      title: String(item?.title || item?.TIEU_DE || this.getDefaultNotificationTitle(type, orderCode)).trim(),
      message: String(item?.message || item?.NOI_DUNG || item?.MO_TA || ''),
      time: hasValidDate ? dateObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '',
      date: hasValidDate ? dateObj.toLocaleDateString('vi-VN') : '',
      isRead: Boolean(item?.isRead ?? item?.DA_DOC ?? item?.read ?? false),
      link: String(item?.link || item?.DUONG_DAN || this.getDefaultNotificationLink(type, orderCode)),
    };
  }

  getNotificationIcon(item: HeaderNotification): string {
    switch (item.type) {
      case 'order':
        return 'bi-receipt';
      case 'promotion':
        return 'bi-ticket-perforated';
      case 'point':
        return 'bi-gift';
      case 'review':
        return 'bi-star';
      default:
        return 'bi-bell';
    }
  }

  getNotificationIconClass(item: HeaderNotification): string {
    return `notification-icon-${item.type || 'system'}`;
  }

  private getDefaultNotificationTitle(type: HeaderNotification['type'], orderCode: string): string {
    if (type === 'promotion') {
      return 'Chương trình ưu đãi';
    }

    if (type === 'point') {
      return 'Điểm thưởng';
    }

    if (type === 'review') {
      return 'Đánh giá đơn hàng';
    }

    if (type === 'order') {
      return `Đơn hàng ${orderCode || ''}`.trim();
    }

    return 'Thông báo';
  }

  private getDefaultNotificationLink(type: HeaderNotification['type'], orderCode: string): string {
    if (type === 'promotion') {
      return '/homepage';
    }

    if (type === 'point') {
      return '/account';
    }

    if (type === 'review') {
      return orderCode ? `/order-review/${orderCode}` : '/order-review';
    }

    if (type === 'order' && orderCode) {
      return `/order-detail/${orderCode}`;
    }

    return '/account';
  }

  private loadSearchProductCache(): void {
    if (!this.isBrowser() || this.hasLoadedSearchCache) {
      return;
    }

    this.http.get<any>(`${this.productApiUrl}?limit=100`).subscribe({
      next: (res) => {
        const items = Array.isArray(res?.products)
          ? res.products
          : Array.isArray(res?.items)
            ? res.items
            : Array.isArray(res)
              ? res
              : [];

        this.allSearchProductsCache = items.map((item: any) => this.mapSearchProduct(item));
        this.hasLoadedSearchCache = true;
        this.cdr.detectChanges();
      },
      error: () => {
        this.hasLoadedSearchCache = false;
      }
    });
  }

  private applyInstantSearch(keyword: string): void {
    const normalizedKeyword = this.normalizeSearchText(keyword);

    if (!normalizedKeyword || normalizedKeyword.length < 2) {
      return;
    }

    if (!this.hasLoadedSearchCache || this.allSearchProductsCache.length === 0) {
      return;
    }

    const tokens = normalizedKeyword.split(' ').filter(Boolean);

    this.searchResults = this.allSearchProductsCache
      .filter(product => {
        const haystack = this.normalizeSearchText(`${product.name} ${product.meta}`);
        return tokens.every(token => haystack.includes(token));
      })
      .slice(0, 8);

    this.searchMessage = this.searchResults.length === 0
      ? 'Không tìm thấy sản phẩm phù hợp.'
      : '';
  }

  getCollections(): void {
    this.collectionService.getAll().subscribe({
      next: (data) => {
        this.collections = data;
        console.log('Danh sách bộ sưu tập:', this.collections);
      },
      error: (err) => {
        console.error('Lỗi lấy bộ sưu tập:', err);
      }
    });
  }
  getTopics(): void {
    this.topicService.getAll().subscribe({
      next: (data) => {
        this.topics = data;
        console.log('Danh sách chủ đề:', this.topics);
      },
      error: (err) => {
        console.error('Lỗi lấy chủ đề:', err);
      }
    });
  }

  getTargets(): void {
    this.targetService.getAll().subscribe({
      next: (data) => {
        this.targets = data;
        console.log('Danh sách đối tượng:', this.targets);
      },
      error: (err) => {
        console.error('Lỗi lấy đối tượng:', err);
      }
    });
  }
  getFlowers(): void {
    this.flowerService.getAll().subscribe({
      next: (data) => {
        this.flowers = data;
        console.log('Danh sách hoa tươi:', this.flowers);
      },
      error: (err) => {
        console.error('Lỗi lấy hoa tươi:', err);
      }
    });
  }
  getStyles(): void {
    this.styleService.getAll().subscribe({
      next: (data) => {
        this.styles = data;
        console.log('Danh sách kiểu dáng:', this.styles);
      },
      error: (err) => {
        console.error('Lỗi lấy kiểu dáng:', err);
      }
    });
  }
  @HostListener('window:scroll')
  onScroll() {
    if (!this.isBrowser()) {
      return;
    }

    this.isScrolled = window.scrollY > 100;
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (!this.isBrowser()) {
      return;
    }

    this.showSearch = false;
    this.closeSearchSuggestions();
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent) {

    const target = event.target as HTMLElement;

    const clickedInsideHeader =
      this.elementRef.nativeElement.contains(target);

    const clickedDrawer =
      target.closest('.mobile-menu');

    const clickedButton =
      target.closest('.mobile-menu-btn');

    const clickedImageSearchMenu =
      target.closest('.camera-search-wrapper');

    if (!clickedInsideHeader) {
      this.showAccountMenu = false;
      this.showLanguageMenu = false;
      this.showNotifications = false;
      this.showCartMenu = false;
      this.showImageSearchMenu = false;
      this.showSearch = false;
      this.closeSearchSuggestions();

      this.notificationHoverTimer = this.clearHoverTimer(this.notificationHoverTimer);
      this.cartHoverTimer = this.clearHoverTimer(this.cartHoverTimer);
      this.accountHoverTimer = this.clearHoverTimer(this.accountHoverTimer);
    }

    if (!clickedImageSearchMenu) {
      this.showImageSearchMenu = false;
    }

    if (!clickedDrawer && !clickedButton) {
      this.showMobileMenu = false;
      this.closeAllSubMenus();
    }
  }

  toggleSearch(): void {
    this.showSearch = !this.showSearch;

    if (this.showSearch) {
      this.openSearchPanel();
      return;
    }

    this.closeSearchSuggestions();
    this.showImageSearchMenu = false;
  }

  toggleImageSearchMenu(): void {
    this.showImageSearchMenu = !this.showImageSearchMenu;

    if (this.showImageSearchMenu) {
      this.showAccountMenu = false;
      this.showLanguageMenu = false;
      this.showNotifications = false;
      this.showCartMenu = false;
      this.closeSearchSuggestions();
    }
  }

  triggerCameraCapture(): void {
    this.showImageSearchMenu = false;

    if (!this.isBrowser()) {
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const file = input.files && input.files.length > 0 ? input.files[0] : null;
      input.remove();

      if (file) {
        this.searchByImage(file);
      }
    });

    document.body.appendChild(input);
    input.click();
  }

  triggerImageUpload(): void {
    this.showImageSearchMenu = false;

    if (this.isBrowser()) {
      this.uploadFileInput?.nativeElement.click();
    }
  }

  onImageSearchFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length > 0 ? input.files[0] : null;

    input.value = '';

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      alert('Vui lòng chọn một tệp hình ảnh hợp lệ.');
      return;
    }

    this.searchByImage(file);
  }

  private searchByImage(file: File): void {
    this.showSearchSuggestions = true;
    this.isSearchLoading = true;
    this.searchMessage = '';
    this.searchResults = [];
    this.searchKeyword = '';
    this.cdr.detectChanges();

    const formData = new FormData();
    formData.append('image', file, file.name);

    const requestUrl = `${this.productApiUrl}/search-by-image`;

    this.http.post<any>(requestUrl, formData).subscribe({
      next: (res) => {
        const items = Array.isArray(res?.products)
          ? res.products
          : Array.isArray(res)
            ? res
            : [];

        this.searchResults = items.map((item: any) => this.mapSearchProduct(item));
        if (this.searchResults.length > 0) {
          this.mergeSearchCache(this.searchResults);
        }
        this.isSearchLoading = false;
        this.searchMessage = this.searchResults.length === 0
          ? 'Không tìm thấy sản phẩm phù hợp với ảnh này.'
          : '';
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi tìm kiếm bằng hình ảnh:', err);
        this.searchResults = [];
        this.isSearchLoading = false;
        this.searchMessage = 'Không thể tìm kiếm bằng ảnh lúc này. Vui lòng thử lại sau.';
        this.cdr.detectChanges();
      },
    });
  }

  onSearchInput(): void {
    this.showSearchSuggestions = true;
    this.searchMessage = '';

    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    const keyword = this.searchKeyword.trim();
    const normalizedKeyword = this.normalizeSearchText(keyword);

    if (!normalizedKeyword) {
      this.searchResults = [];
      this.isSearchLoading = false;
      this.searchMessage = '';
      this.cdr.detectChanges();
      return;
    }

    if (normalizedKeyword.length < 2) {
      this.searchResults = [];
      this.isSearchLoading = false;
      this.searchMessage = 'Nhập ít nhất 2 ký tự để tìm sản phẩm.';
      this.cdr.detectChanges();
      return;
    }

    this.isSearchLoading = false;
    this.applyInstantSearch(keyword);
    this.cdr.detectChanges();

    this.searchDebounceTimer = setTimeout(() => {
      this.searchProducts(keyword);
    }, 120);
  }

  openSearchPanel(): void {
    this.showSearchSuggestions = true;

    if (this.searchKeyword.trim()) {
      this.onSearchInput();
    }
  }

  closeSearchSuggestions(): void {
    this.showSearchSuggestions = false;
  }

  submitSearch(): void {
    const keyword = this.searchKeyword.trim();

    if (!keyword) {
      return;
    }

    if (this.searchResults.length > 0) {
      this.goToSearchProduct(this.searchResults[0]);
      return;
    }

    this.router.navigate(['/category'], {
      queryParams: {
        keyword,
      },
    });

    this.closeSearchSuggestions();
  }

  goToSearchProduct(product: HeaderSearchProduct): void {
    if (!product?.id) {
      return;
    }

    this.searchKeyword = '';
    this.searchResults = [];
    this.closeSearchSuggestions();

    this.showSearch = false;
    this.showAccountMenu = false;
    this.showLanguageMenu = false;
    this.showMobileMenu = false;
    this.closeAllSubMenus();

    this.router.navigate(['/product-detail', product.id]);
  }

  private searchProducts(keyword: string): void {
    const safeKeyword = String(keyword || '').trim();

    if (!safeKeyword) {
      this.searchResults = [];
      this.isSearchLoading = false;
      this.searchMessage = '';
      this.cdr.detectChanges();
      return;
    }

    const requestUrl = `${this.productApiUrl}/search?q=${encodeURIComponent(safeKeyword)}&limit=8`;

    this.http.get<any>(requestUrl).subscribe({
      next: (res) => {
        if (this.searchKeyword.trim() !== safeKeyword) {
          return;
        }

        const items = Array.isArray(res?.products)
          ? res.products
          : Array.isArray(res)
            ? res
            : [];

        this.searchResults = items.map((item: any) => this.mapSearchProduct(item));
        if (this.searchResults.length > 0) {
          this.mergeSearchCache(this.searchResults);
        }
        this.isSearchLoading = false;
        this.searchMessage = this.searchResults.length === 0
          ? 'Không tìm thấy sản phẩm phù hợp.'
          : '';
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi tìm kiếm sản phẩm:', err);
        this.searchResults = [];
        this.isSearchLoading = false;
        this.searchMessage = 'Không thể tìm kiếm sản phẩm. Vui lòng kiểm tra backend.';
        this.cdr.detectChanges();
      },
    });
  }

  private mapSearchProduct(item: any): HeaderSearchProduct {
    const originalPrice = Number(item?.GIA || item?.originalPrice || 0);

    const salePriceRaw =
      item?.GIA_KHUYEN_MAI === null ||
      item?.GIA_KHUYEN_MAI === undefined ||
      item?.GIA_KHUYEN_MAI === ''
        ? null
        : Number(item.GIA_KHUYEN_MAI);

    const hasDiscount =
      salePriceRaw !== null &&
      !Number.isNaN(salePriceRaw) &&
      salePriceRaw > 0 &&
      originalPrice > 0 &&
      salePriceRaw < originalPrice;

    const salePrice = hasDiscount ? salePriceRaw : null;
    const finalPrice = hasDiscount && salePrice !== null ? salePrice : originalPrice;

    const style = String(item?.KIEU_DANG || '').trim();
    const topicName = String(item?.TEN_CHU_DE || '').trim();
    const sold = Number(item?.DA_BAN || 0);
    const metaParts = [style, topicName].filter(Boolean);

    if (sold > 0) {
      metaParts.push(`Đã bán ${sold}`);
    }

    return {
      id: String(item?.SAN_PHAM_ID || item?.id || ''),
      name: String(item?.TEN_SAN_PHAM || item?.name || 'Sản phẩm'),
      image: this.normalizeImageUrl(item?.HINH_ANH || item?.image),
      originalPrice,
      salePrice,
      finalPrice,
      hasDiscount,
      meta: metaParts.join(' • '),
      sold,
    };
  }

  private mergeSearchCache(products: HeaderSearchProduct[]): void {
    const map = new Map<string, HeaderSearchProduct>();

    for (const product of this.allSearchProductsCache) {
      map.set(product.id, product);
    }

    for (const product of products) {
      map.set(product.id, product);
    }

    this.allSearchProductsCache = Array.from(map.values());
    this.hasLoadedSearchCache = this.allSearchProductsCache.length > 0;
  }

  formatSearchPrice(value: number | string | null | undefined): string {
    const numberValue = Number(value || 0);

    if (Number.isNaN(numberValue)) {
      return '0đ';
    }

    return numberValue.toLocaleString('vi-VN') + 'đ';
  }

  private normalizeImageUrl(url: string | null | undefined): string {
    if (!url) {
      return 'assets/images/hoa.jpg';
    }

    const value = String(url).trim();

    if (
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('assets/') ||
      value.startsWith('/')
    ) {
      return value;
    }

    return `assets/images/products/${value}`;
  }

  private normalizeSearchText(value: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9/\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  toggleAccountMenu() {
    this.accountHoverTimer = this.clearHoverTimer(this.accountHoverTimer);

    this.showAccountMenu = !this.showAccountMenu;

    if (this.showAccountMenu) {
      this.showNotifications = false;
      this.showCartMenu = false;
    } else {
      this.showLanguageMenu = false;
    }
  }


  private clearHoverTimer(timer: ReturnType<typeof setTimeout> | null): ReturnType<typeof setTimeout> | null {
    if (timer) {
      clearTimeout(timer);
    }

    return null;
  }

  onNotificationHoverEnter(): void {
    if (!this.isBrowser()) {
      return;
    }

    this.notificationHoverTimer = this.clearHoverTimer(this.notificationHoverTimer);

    this.showNotifications = true;
    this.showCartMenu = false;
    this.showAccountMenu = false;
    this.showLanguageMenu = false;
  }

  onNotificationHoverLeave(): void {
    if (!this.isBrowser()) {
      return;
    }

    this.notificationHoverTimer = this.clearHoverTimer(this.notificationHoverTimer);

    this.notificationHoverTimer = setTimeout(() => {
      this.showNotifications = false;
      this.cdr.detectChanges();
    }, 350);
  }

  onCartHoverEnter(): void {
    if (!this.isBrowser()) {
      return;
    }

    this.cartHoverTimer = this.clearHoverTimer(this.cartHoverTimer);

    this.showCartMenu = true;
    this.showNotifications = false;
    this.showAccountMenu = false;
    this.showLanguageMenu = false;
  }

  onCartHoverLeave(): void {
    if (!this.isBrowser()) {
      return;
    }

    this.cartHoverTimer = this.clearHoverTimer(this.cartHoverTimer);

    this.cartHoverTimer = setTimeout(() => {
      this.showCartMenu = false;
      this.cdr.detectChanges();
    }, 350);
  }

  onAccountHoverEnter(): void {
    if (!this.isBrowser()) {
      return;
    }

    this.accountHoverTimer = this.clearHoverTimer(this.accountHoverTimer);

    this.showAccountMenu = true;
    this.showNotifications = false;
    this.showCartMenu = false;
  }

  onAccountHoverLeave(): void {
    if (!this.isBrowser()) {
      return;
    }

    this.accountHoverTimer = this.clearHoverTimer(this.accountHoverTimer);

    this.accountHoverTimer = setTimeout(() => {
      this.showAccountMenu = false;
      this.showLanguageMenu = false;
      this.cdr.detectChanges();
    }, 350);
  }

  toggleNotifications(): void {
    this.notificationHoverTimer = this.clearHoverTimer(this.notificationHoverTimer);

    this.showNotifications = !this.showNotifications;

    if (this.showNotifications) {
      this.showAccountMenu = false;
      this.showLanguageMenu = false;
      this.showCartMenu = false;
    }
  }

  markNotificationRead(item: HeaderNotification): void {
    if (!item || item.isRead) {
      return;
    }

    item.isRead = true;
    this.cdr.detectChanges();

    this.http.patch(`${this.notificationApiUrl}/${encodeURIComponent(item.id)}/read`, {}).subscribe({
      next: () => {
        this.loadNotifications();
      },
      error: (err) => {
        console.warn('Không thể đánh dấu thông báo đã đọc:', err);
      }
    });
  }

  goToNotification(item: HeaderNotification): void {
    this.markNotificationRead(item);
    this.showNotifications = false;
    this.router.navigateByUrl(item.link);
  }

  toggleCartMenu(): void {
    this.cartHoverTimer = this.clearHoverTimer(this.cartHoverTimer);

    this.showCartMenu = !this.showCartMenu;

    if (this.showCartMenu) {
      this.showAccountMenu = false;
      this.showLanguageMenu = false;
      this.showNotifications = false;
    }
  }

  goToCart(): void {
    this.showCartMenu = false;
    this.router.navigate(['/cart']);
  }

  toggleLanguageMenu() {
    this.showLanguageMenu = !this.showLanguageMenu;
  }

  changeLanguage(lang: string) {
    this.currentLanguage = lang;

    if (this.isBrowser()) {
      localStorage.setItem('language', lang);
    }

    console.log('Language:', lang);
  }

  logout() {
    if (this.isBrowser()) {
      localStorage.removeItem('khachHang');
      localStorage.removeItem('token');
      window.dispatchEvent(new Event('auth-changed'));
    }

    this.resetLoggedInCustomer();

    this.showAccountMenu = false;
    this.showLanguageMenu = false;

    this.router.navigate(['/login']);
  }

  toggleMobileMenu() {
    this.showMobileMenu = !this.showMobileMenu;

    if (!this.showMobileMenu) {
      this.closeAllSubMenus();
    }
  }

  closeAllSubMenus() {
    this.showTopic = false;
    this.showTarget = false;
    this.showStyle = false;
    this.showFlower = false;
    this.showCollection = false;
    this.showSupport = false;
    this.showAbout = false;
  }

  toggleTopic() {
    const current = this.showTopic;
    this.closeAllSubMenus();
    this.showTopic = !current;
  }

  toggleTarget() {
    const current = this.showTarget;
    this.closeAllSubMenus();
    this.showTarget = !current;
  }

  toggleStyle() {
    const current = this.showStyle;
    this.closeAllSubMenus();
    this.showStyle = !current;
  }

  toggleFlower() {
    const current = this.showFlower;
    this.closeAllSubMenus();
    this.showFlower = !current;
  }

  toggleCollection() {
    const current = this.showCollection;
    this.closeAllSubMenus();
    this.showCollection = !current;
  }

  toggleSupport() {
    const current = this.showSupport;
    this.closeAllSubMenus();
    this.showSupport = !current;
  }

  toggleAbout() {
    const current = this.showAbout;
    this.closeAllSubMenus();
    this.showAbout = !current;
  }

  goToAllTopics(): void {
    this.closeAllSubMenus();
    this.showMobileMenu = false;
    this.showAccountMenu = false;
    this.showLanguageMenu = false;

    this.router.navigate(['/category']);
  }

  goToTopic(topicId: string): void {
    if (!topicId) return;

    this.closeAllSubMenus();
    this.showMobileMenu = false;
    this.showAccountMenu = false;
    this.showLanguageMenu = false;

    this.router.navigate(['/chu-de', topicId]);
  }
}