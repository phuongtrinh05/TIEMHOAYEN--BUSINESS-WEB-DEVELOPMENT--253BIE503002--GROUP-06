import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { apiBaseUrl } from '../../services/api-config';
import {
  Router,
  NavigationEnd,
  RouterLink
} from '@angular/router';
import { CommonModule } from '@angular/common';
import { filter } from 'rxjs';
import { AdminApiService } from '../../services/admin-api.service';

@Component({
  selector: 'app-admin-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink
  ],
  templateUrl: './admin-header.html',
  styleUrl: './admin-header.css'
})
export class AdminHeader implements OnInit, OnDestroy {
  supportPending = 0;
  supportVisible = false;
  showNotifications = false;
  notificationsLoading = false;
  notificationsError = '';
  notifications: Array<{ id:string; title:string; message:string; group:string; priority:string; link:string; queryParams:Record<string,string>|null; createdAt:string; viewed:boolean; read:boolean }> = [];
  private savingViewed = false;
  private supportTimer?: ReturnType<typeof setInterval>;

  pageTitle = '';
  productCount = 0;
  activeTab = 'products';
  isProductPage = false;
  showProfileMenu = false;
  currentLanguage = 'vi';
  private productCountLoaded = false;

  private readonly routeTitles: Array<{ match: string; title: string; exact?: boolean }> = [
    { match: '/dashboard', title: 'Dashboard', exact: true },
    { match: '/orders/requests', title: 'Yêu cầu đặt hàng' },
    { match: '/orders/order-list', title: 'Đơn hàng' },
    { match: '/orders/create-order', title: 'Tạo đơn hàng' },
    { match: '/orders/order-detail', title: 'Chi tiết đơn hàng' },
    { match: '/orders/', title: 'Chi tiết đơn hàng' },
    { match: '/transactions', title: 'Giao dịch' },
    { match: '/products/product-list', title: 'Sản phẩm' },
    { match: '/products/product-detail', title: 'Chi tiết sản phẩm' },
    { match: '/products/category-list', title: 'Danh mục sản phẩm' },
    { match: '/materials/imports', title: 'Nhập kho' },
    { match: '/materials/exports', title: 'Xuất kho' },
    { match: '/materials/suppliers', title: 'Nhà cung cấp' },
    { match: '/materials/purchase-orders', title: 'Đặt mua NCC' },
    { match: '/materials/boms', title: 'Công thức BOM' },
    { match: '/materials/stock', title: 'Tổng quan kho' },
    { match: '/materials', title: 'Nguyên vật liệu', exact: true },
    { match: '/customers/detail', title: 'Chi tiết khách hàng' },
    { match: '/customers/', title: 'Chi tiết khách hàng' },
    { match: '/customers', title: 'Khách hàng', exact: true },
    { match: '/promotions/vouchers', title: 'Voucher' },
    { match: '/promotions', title: 'Khuyến mãi', exact: true },
    { match: '/customer-service/customer-chat', title: 'Chăm sóc khách hàng' },
    { match: '/customer-service/chatbot-management', title: 'Quản lý chatbot' },
    { match: '/employee-service', title: 'Nhân viên' },
    { match: '/content/article-list', title: 'Nội dung' },
    { match: '/content/create-article', title: 'Tạo bài viết' },
    { match: '/content/article-detail', title: 'Chi tiết bài viết' },
    { match: '/admin-account', title: 'Tài khoản quản trị' },
    { match: '/role-permission', title: 'Phân quyền' }
  ];
  constructor(
    private router: Router,
    private cdr: ChangeDetectorRef,
    private adminApi: AdminApiService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      this.loadSupportSummary();
      this.supportTimer = setInterval(() => { if (!document.hidden) this.loadNotifications(true); }, 10000);
    }
    
    this.updateHeader(this.router.url);

    this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd =>
            event instanceof NavigationEnd
        )
      )
       .subscribe(event => {
          this.updateHeader(
            event.urlAfterRedirects
          );
      });
  }

  ngOnDestroy(): void { if (this.supportTimer) clearInterval(this.supportTimer); }

  private loadSupportSummary(): void {
    this.loadNotifications(true);
  }

  loadNotifications(quiet = false): void {
    if (this.notificationsLoading) return;
    this.notificationsLoading = true;
    if (!quiet) this.notificationsError = '';
    this.http.get<any>(`${apiBaseUrl()}/admin/notifications`, { params: { limit: '20' } }).subscribe({
      next: r => {
        this.notifications = Array.isArray(r?.items) ? r.items : [];
        this.supportPending = Number(r?.unseen ?? this.notifications.filter(item => !item.viewed).length);
        this.supportVisible = true;
        this.notificationsLoading = false;
        this.cdr.markForCheck();
        if (this.showNotifications) this.markCurrentNotificationsViewed();
      },
      error: () => {
        this.notificationsLoading = false;
        this.notificationsError = quiet ? this.notificationsError : 'Chưa tải được thông báo. Vui lòng thử lại.';
        this.supportVisible = this.notifications.length > 0;
        this.cdr.markForCheck();
      }
    });
  }

  toggleNotifications(event: MouseEvent): void {
    event.stopPropagation();
    this.showNotifications = !this.showNotifications;
    this.showProfileMenu = false;
    if (!this.showNotifications) return;
    this.loadNotifications();
    this.markCurrentNotificationsViewed();
  }

  private markCurrentNotificationsViewed(): void {
    if (this.savingViewed || !this.notifications.some(item => !item.viewed)) return;
    this.savingViewed = true;
    this.http.post(`${apiBaseUrl()}/admin/notifications/read-all`, { viewedOnly: true }).subscribe({
      next: () => {
        this.savingViewed = false;
        this.notifications = this.notifications.map(item => ({ ...item, viewed: true }));
        this.supportPending = 0;
        this.cdr.markForCheck();
      },
      error: () => {
        this.savingViewed = false;
        this.notificationsError = 'Chưa lưu được trạng thái đã xem.';
        this.cdr.markForCheck();
      }
    });
  }

  openNotification(item: any, event: MouseEvent): void {
    event.stopPropagation();
    const navigate = () => {
      this.showNotifications = false;
      void this.router.navigate([item.link || '/dashboard'], { queryParams: item.queryParams || undefined });
    };
    if (item.read) { navigate(); return; }
    this.http.post(`${apiBaseUrl()}/admin/notifications/${encodeURIComponent(item.id)}/read`, {}).subscribe({
      next: () => { item.read = true; item.viewed = true; navigate(); },
      error: () => { this.notificationsError = 'Chưa đánh dấu được thông báo đã đọc.'; this.cdr.markForCheck(); }
    });
  }

  notificationTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
  }

  notificationIcon(group: string): string {
    if (group === 'Đơn hàng') return 'bi-receipt';
    if (group === 'Khiếu nại') return 'bi-chat-square-heart';
    if (group === 'Tồn kho') return 'bi-box-seam';
    return 'bi-bell';
  }

  @HostListener('document:click')
  closeHeaderPopups(): void { this.showNotifications = false; }

  private updateHeader(url: string): void {
    const normalizedUrl = this.normalizeUrl(url);

    this.pageTitle = this.getPageTitle(normalizedUrl);

  this.isProductPage =
    normalizedUrl === '/products/product-list' ||
    normalizedUrl === '/products/category-list';

  this.activeTab =
    normalizedUrl.includes('category-list')
      ? 'categories'
      : 'products';

  if (this.isProductPage) {
    this.loadProductCount();
  }

  this.cdr.detectChanges();
  }

  private loadProductCount(): void {
    if (this.productCountLoaded) {
      return;
    }

    this.productCountLoaded = true;
    this.adminApi.getProducts().subscribe({
      next: (response) => {
        this.productCount = Number(response.total ?? response.products?.length ?? 0);
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Cannot load product count', error);
        this.productCountLoaded = false;
        this.cdr.detectChanges();
      }
    });
  }

  private normalizeUrl(url: string): string {
    const path = (url || '').split('?')[0].split('#')[0];
    return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  }

  private getPageTitle(url: string): string {
    const route = this.routeTitles.find((item) => (
      item.exact ? url === item.match : url.startsWith(item.match)
    ));

    return route?.title || 'Dashboard';
  }

  toggleLanguage(): void {

    this.currentLanguage =
      this.currentLanguage === 'vi'
        ? 'en'
        : 'vi';

    localStorage.setItem(
      'language',
      this.currentLanguage
    );
  }
  toggleProfileMenu(): void {
    this.showProfileMenu =
      !this.showProfileMenu;
    this.showNotifications = false;
  }

  logout(): void {
    [
      'adminLoggedIn',
      'adminEmail',
      'adminToken',
      'adminUser',
      'selectedProduct'
    ].forEach((key) => localStorage.removeItem(key));

    sessionStorage.clear();
    this.showProfileMenu = false;
    this.router.navigate(['/login']);
  }
}
