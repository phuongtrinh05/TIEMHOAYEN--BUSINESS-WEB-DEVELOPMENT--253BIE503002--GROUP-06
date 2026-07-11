import { Component, HostBinding, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AdminRolePermissionSet } from '../../services/admin-api.service';

interface SidebarItem {
  label: string;
  icon: string;
  route: string;
  module: string;
  exact?: boolean;
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
    { label: 'Dashboard', icon: 'bi-house', route: '/dashboard', module: 'dashboard', exact: true },
    { label: 'Đơn hàng', icon: 'bi-cart', route: '/orders/order-list', module: 'orders' },
    { label: 'Thanh toán', icon: 'bi-credit-card', route: '/transactions', module: 'payments' },
    { label: 'Sản phẩm', icon: 'bi-box-seam', route: '/products/product-list', module: 'products' },
    { label: 'Nguyên vật liệu', icon: 'bi-flower1', route: '/materials', module: 'materials' },
    { label: 'Khách hàng', icon: 'bi-people', route: '/customers', module: 'customers' },
    { label: 'Khuyến mãi', icon: 'bi-ticket-perforated', route: '/promotions', module: 'promotions' },
    { label: 'Chăm sóc khách hàng', icon: 'bi-chat-square-heart', route: '/customer-service', module: 'customerService' },
    { label: 'Nội dung', icon: 'bi-star', route: '/content', module: 'content' },
  ];

  adminMenuItems: SidebarItem[] = [
    { label: 'Tài khoản quản trị', icon: 'bi-person-gear', route: '/admin-account', module: 'permissions' },
    { label: 'Phân quyền', icon: 'bi-gear', route: '/role-permission', module: 'permissions' },
  ];

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.updateSidebarWidth();
  }

  ngOnDestroy(): void {
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
    if (item.exact) return this.router.url === item.route;
    if (item.module === 'products') return this.router.url.startsWith('/products');
    return this.router.url.startsWith(item.route);
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
