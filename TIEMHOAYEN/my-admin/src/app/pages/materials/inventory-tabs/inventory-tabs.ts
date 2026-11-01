import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** Thanh tab dùng chung cho các màn hình Kho (NVL, PN, PX, PO, NCC, BOM, Tổng quan). */
@Component({
  selector: 'app-inventory-tabs',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="inv-tabs" aria-label="Quản lý kho">
      @for (tab of tabs; track tab.link) {
        <a [routerLink]="tab.link" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
          <i class="bi" [class]="tab.icon"></i><span>{{ tab.label }}</span>
        </a>
      }
    </nav>
  `,
  styles: [`
    :host { display: block; min-width: 0; font-family: var(--font-body); }
    .inv-tabs { display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 4px; background: #ffd9d9; border-radius: 10px; padding: 5px; scrollbar-width: thin; }
    .inv-tabs a { flex: 0 0 auto; height: 40px; padding: 0 12px; border-radius: 7px; color: #4d5968; font-size: 13px; text-decoration: none;
      display: inline-flex; align-items: center; gap: 6px; transition: all .2s; white-space: nowrap; }
    .inv-tabs a:hover { background: rgba(255,255,255,.55); color: #7f1717; }
    .inv-tabs a.active { background: #fff; color: #731919; font-weight: 700; }
    .inv-tabs a:focus-visible { outline: 2px solid #731919; outline-offset: -2px; }
  `],
})
export class InventoryTabsComponent {

  readonly tabs = [
    { link: '/materials/stock', label: 'Tổng quan kho', icon: 'bi-speedometer2' },
    { link: '/materials', label: 'Nguyên vật liệu', icon: 'bi-flower1' },
    { link: '/materials/imports', label: 'Nhập kho', icon: 'bi-box-arrow-in-down' },
    { link: '/materials/exports', label: 'Xuất kho', icon: 'bi-box-arrow-up' },
    { link: '/materials/purchase-orders', label: 'Đặt mua NCC', icon: 'bi-truck' },
    { link: '/materials/suppliers', label: 'Nhà cung cấp', icon: 'bi-shop' },
    { link: '/materials/boms', label: 'Công thức BOM', icon: 'bi-diagram-3' },
  ];
}
