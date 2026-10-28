import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { apiBaseUrl, LOCAL_API_BASE_URL, switchApiBaseUrl } from '../../../services/api-config';

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
    <div class="inv-backend">
      Backend: <b>{{ isLocal ? 'Local (localhost:3000)' : 'Render' }}</b>
      @if (isLocal) {
        <button type="button" (click)="use('render')">Chuyển về Render</button>
      } @else {
        <button type="button" (click)="use('local')">Dùng backend local</button>
      }
    </div>
  `,
  styles: [`
    .inv-tabs { display: flex; flex-wrap: wrap; gap: 4px; background: #ffd4d7; border-radius: 10px; padding: 5px; }
    .inv-tabs a { height: 40px; padding: 0 14px; border-radius: 7px; color: #4d5968; font-size: 14px; text-decoration: none;
      display: inline-flex; align-items: center; gap: 6px; transition: all .2s; white-space: nowrap; }
    .inv-tabs a:hover { background: rgba(255,255,255,.55); color: #7f1717; }
    .inv-tabs a.active { background: #fff; color: #7f1717; font-weight: 800; box-shadow: 0 4px 10px rgba(127,23,23,.16); }
    .inv-backend { display: flex; justify-content: flex-end; align-items: center; gap: 8px; font-size: 12px; color: #6b7280; margin-top: 6px; }
    .inv-backend button { border: 1px solid #e5d3d3; background: #fff; color: #731919; border-radius: 6px; padding: 2px 10px; font-size: 12px; cursor: pointer; }
    @media (max-width: 720px) { .inv-tabs a span { display: none; } }
  `],
})
export class InventoryTabsComponent {
  readonly isLocal = apiBaseUrl() === LOCAL_API_BASE_URL;
  use(target: 'local' | 'render'): void { switchApiBaseUrl(target); }

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
