import { Component, inject } from '@angular/core';
import { AppErrorService } from '../../services/app-error.service';

@Component({
  selector: 'app-global-error-banner',
  standalone: true,
  template: `
    @if (errors.notice(); as notice) {
      <div class="global-error-banner" [class.is-forbidden]="notice.type === 'forbidden'" role="alert" aria-live="assertive">
        <i class="bi" [class.bi-wifi-off]="notice.type === 'network'" [class.bi-exclamation-triangle]="notice.type === 'server'" [class.bi-shield-lock]="notice.type === 'forbidden'" aria-hidden="true"></i>
        <span class="global-error-text">{{ notice.message }}</span>
        <button type="button" class="global-error-close" aria-label="Đóng thông báo" (click)="errors.dismiss()">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
    }
  `,
  styles: [`
    .global-error-banner {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      z-index: 13000;
      display: flex;
      align-items: center;
      gap: 12px;
      width: min(560px, calc(100vw - 24px));
      padding: 12px 14px 12px 16px;
      border-radius: 12px;
      border: 1px solid #f0c9c9;
      background: #fff5f5;
      color: var(--primary-color, #781b20);
      box-shadow: 0 10px 26px rgba(115, 25, 25, 0.16);
      font-family: var(--font-body, 'Nunito Sans', sans-serif);
      font-size: 14px;
      font-weight: 600;
    }
    .global-error-banner.is-forbidden { background: #fffaf0; border-color: #f1dfb8; }
    .global-error-banner > .bi { font-size: 18px; flex: 0 0 auto; }
    .global-error-text { flex: 1; line-height: 1.4; }
    .global-error-close {
      flex: 0 0 auto;
      border: 0;
      background: transparent;
      color: inherit;
      padding: 4px;
      cursor: pointer;
      line-height: 1;
    }
    .global-error-close:hover { opacity: 0.7; }
  `],
})
export class GlobalErrorBanner {
  protected readonly errors = inject(AppErrorService);
}
