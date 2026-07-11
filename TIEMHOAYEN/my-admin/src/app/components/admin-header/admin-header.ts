import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
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
export class AdminHeader implements OnInit {

  pageTitle = '';
  productCount = 0;
  activeTab = 'products';
  isProductPage = false;
  showProfileMenu = false;
  currentLanguage = 'vi';
  private productCountLoaded = false;

  private readonly routeTitles: Array<{ match: string; title: string; exact?: boolean }> = [
    { match: '/dashboard', title: 'Dashboard', exact: true },
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
    private adminApi: AdminApiService
  ) {}

  ngOnInit(): void {
    
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
