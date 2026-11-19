import {endAdminSession} from '../../services/api-config';
import { Component, HostBinding, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AdminRolePermissionSet } from '../../services/admin-api.service';

interface SidebarItem {
  label: string;
  icon: string;
  route: string;
  module: string;
  exact?: boolean;
  /** Tiền tố đường dẫn của cả nhóm (để tự mở nhóm và tô đậm mục cha khi đang ở trang con). */
  group?: string;
  /** Mục con (vd. Tổng quan ▸ Bảng phân tích, Danh sách báo cáo) */
  children?: SidebarItem[];
}

@Component({
  selector: 'app-admin-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive
  ],
  templateUrl: './admin-sidebar.html',
  styleUrl: './admin-sidebar.css'
})
export class AdminSidebar implements OnInit, OnDestroy {
  isCollapsed = false;

  @HostBinding('class.sidebar-collapsed')
  get sidebarCollapsed(): boolean {
    return this.isCollapsed;
  }

  mainMenuItems: SidebarItem[] = [
    {
      label: 'Tổng quan', icon: 'bi-house', route: '/dashboard', module: 'dashboard', exact: true, group: '/dashboard',
      children: [
        { label: 'Bảng phân tích', icon: 'bi-bar-chart-line', route: '/dashboard/analytics', module: 'dashboard' },
        { label: 'Danh sách báo cáo', icon: 'bi-journal-text', route: '/dashboard/reports', module: 'dashboard' },
      ],
    },
    { label: 'Đơn hàng', icon: 'bi-cart', route: '/orders/order-list', module: 'orders' },
    { label: 'Yêu cầu đặt hàng', icon: 'bi-inbox', route: '/orders/requests', module: 'orders' },
    { label: 'Thanh toán', icon: 'bi-credit-card', route: '/transactions', module: 'payments' },
    { label: 'Sản phẩm', icon: 'bi-box-seam', route: '/products/product-list', module: 'products' },
    {
      // Bấm "Nguyên vật liệu" mở Tổng quan kho; các chức năng kho nằm trong mục con.
      label: 'Nguyên vật liệu', icon: 'bi-flower1', route: '/materials/stock', module: 'materials', exact: true, group: '/materials',
      children: [
        { label: 'Nguyên vật liệu', icon: 'bi-flower1', route: '/materials', module: 'materials', exact: true },
        { label: 'Nhập kho', icon: 'bi-box-arrow-in-down', route: '/materials/imports', module: 'materials' },
        { label: 'Xuất kho', icon: 'bi-box-arrow-up', route: '/materials/exports', module: 'materials' },
        { label: 'Đặt mua NCC', icon: 'bi-truck', route: '/materials/purchase-orders', module: 'materials' },
        { label: 'Nhà cung cấp', icon: 'bi-shop', route: '/materials/suppliers', module: 'materials' },
        { label: 'Công thức BOM', icon: 'bi-diagram-3', route: '/materials/boms', module: 'materials' },
      ],
    },
    { label: 'Khách hàng', icon: 'bi-people', route: '/customers', module: 'customers' },
    { label: 'Khuyến mãi', icon: 'bi-ticket-perforated', route: '/promotions', module: 'promotions' },
    { label: 'Chăm sóc khách hàng', icon: 'bi-chat-square-heart', route: '/customer-service', module: 'customerService' },
    { label: 'Nội dung', icon: 'bi-star', route: '/content', module: 'content' },
  ];

  adminMenuItems: SidebarItem[] = [
    { label: 'Tài khoản quản trị', icon: 'bi-person-gear', route: '/admin-account', module: 'permissions' },
    { label: 'Phân quyền', icon: 'bi-gear', route: '/role-permission', module: 'permissions' },
    { label: 'Nhật ký hệ thống', icon: 'bi-clock-history', route: '/audit-logs', module: 'system' },
  ];

  /** Nhóm người dùng tự thu gọn / mở ra; mặc định nhóm chứa trang hiện tại được mở. */
  private groupOpen = signal<Record<string, boolean>>({});
  /** Đường dẫn hiện tại dạng signal để sidebar vẽ lại khi chuyển trang (app chạy zoneless + SSR). */
  private currentPath = signal('');
  private navSub?: Subscription;

  constructor(private router: Router) {
    this.currentPath.set(this.pathOf(this.router.url));
    this.navSub = this.router.events.pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(e => this.currentPath.set(this.pathOf((e as NavigationEnd).urlAfterRedirects)));
  }

  private pathOf(url: string): string { return String(url || '').split('?')[0].split('#')[0]; }

  isGroupActive(item: SidebarItem): boolean {
    const path = this.currentPath();
    return !!item.group && (path === item.group || path.startsWith(item.group + '/'));
  }

  isGroupOpen(item: SidebarItem): boolean {
    return this.groupOpen()[item.route] ?? this.isGroupActive(item);
  }

  toggleGroup(item: SidebarItem, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.groupOpen.update(open => ({ ...open, [item.route]: !this.isGroupOpen(item) }));
  }

  ngOnInit(): void {
    this.updateSidebarWidth();
  }

  ngOnDestroy(): void {
    this.navSub?.unsubscribe();
    document.documentElement.style.removeProperty('--admin-sidebar-width');
  }

  toggleSidebar(): void {
    this.isCollapsed = !this.isCollapsed;
    this.updateSidebarWidth();
  }

  private updateSidebarWidth(): void {
    document.documentElement.style.setProperty(
      '--admin-sidebar-width',
      this.isCollapsed ? '70px' : '260px'
    );
  }

  get adminEmail(): string {
    return localStorage.getItem('adminEmail') || '';
  }

  get permissions(): AdminRolePermissionSet {
    const raw = localStorage.getItem('adminPermissions');
    if (!raw) return {};

    try {
      return JSON.parse(raw) as AdminRolePermissionSet;
    } catch {
      return {};
    }
  }

  canView(moduleKey: string): boolean {
    return Boolean(this.permissions[moduleKey]?.view);
  }

  isItemActive(item: SidebarItem): boolean {
    const path = this.currentPath();
    if (item.exact) return path === item.route;
    if (item.module === 'products') return path.startsWith('/products');
    return path.startsWith(item.route);
  }

  openMenu(item: SidebarItem, event: MouseEvent): void {
    if (!this.canView(item.module)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.router.navigate([item.route]);
  }

  openStore(): void {
    window.open('https://tiem-hoa-yen.vercel.app', '_blank', 'noopener,noreferrer');
  }

  logout(): void {
    endAdminSession();
    [
      'adminLoggedIn',
      'adminEmail',
      'adminEmployeeId',
      'adminRole',
      'adminPermissions',
      'adminToken',
      'adminUser',
      'selectedProduct'
    ].forEach((key) => localStorage.removeItem(key));

    sessionStorage.clear();
    this.router.navigate(['/login']);
  }
}
