import { Injectable, signal } from '@angular/core';

export type AppErrorType = 'network' | 'server' | 'forbidden';

export interface AppErrorNotice {
  type: AppErrorType;
  message: string;
}

export const APP_ERROR_MESSAGES: Record<AppErrorType, string> = {
  network: 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.',
  server: 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau ít phút.',
  forbidden: 'Bạn không có quyền truy cập nội dung này.',
};

/**
 * KH33: thông báo lỗi toàn cục (mất kết nối, lỗi 5xx, 403) hiển thị dạng banner
 * có thể đóng — không điều hướng người dùng khỏi trang đang xem.
 */
@Injectable({ providedIn: 'root' })
export class AppErrorService {
  private readonly current = signal<AppErrorNotice | null>(null);
  readonly notice = this.current.asReadonly();
  private hideTimer?: ReturnType<typeof setTimeout>;

  show(type: AppErrorType, message = APP_ERROR_MESSAGES[type]): void {
    this.current.set({ type, message });
    if (this.hideTimer) clearTimeout(this.hideTimer);
    // Tự ẩn sau 8 giây; người dùng có thể đóng sớm hơn.
    if (typeof window !== 'undefined') this.hideTimer = setTimeout(() => this.dismiss(), 8000);
  }

  dismiss(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    this.current.set(null);
  }
}
