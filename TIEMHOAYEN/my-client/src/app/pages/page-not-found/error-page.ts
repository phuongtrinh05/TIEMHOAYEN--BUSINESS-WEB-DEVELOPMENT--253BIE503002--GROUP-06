import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { APP_ERROR_MESSAGES, AppErrorType } from '../../services/app-error.service';

const TITLES: Record<AppErrorType, string> = {
  network: 'Không kết nối được máy chủ',
  server: 'Hệ thống đang gặp sự cố',
  forbidden: 'Không có quyền truy cập',
};

const ICONS: Record<AppErrorType, string> = {
  network: 'bi-wifi-off',
  server: 'bi-exclamation-triangle',
  forbidden: 'bi-shield-lock',
};

/** KH33: trang lỗi chung, /error?type=network|server|forbidden. */
@Component({
  selector: 'app-error-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './error-page.html',
  styleUrl: './page-not-found.css',
})
export class ErrorPageComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly type = toSignal(
    this.route.queryParamMap.pipe(map(params => this.normalize(params.get('type')))),
    { initialValue: 'server' as AppErrorType },
  );

  protected title(): string { return TITLES[this.type()]; }
  protected message(): string { return APP_ERROR_MESSAGES[this.type()]; }
  protected icon(): string { return ICONS[this.type()]; }

  protected retry(): void {
    if (typeof window === 'undefined') return;
    if (window.history.length > 1) window.history.back();
    else window.location.assign('/');
  }

  private normalize(value: string | null): AppErrorType {
    return value === 'network' || value === 'forbidden' ? value : 'server';
  }
}
