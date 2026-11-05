import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { apiBaseUrl } from '../../../services/api-config';
import { endSession } from '../../../services/session-auth';

interface PasswordRule {
  key: string;
  label: string;
  test: (password: string) => boolean;
}

type PasswordField = 'currentPassword' | 'password' | 'confirmPassword';

/** Quy tắc giống server (GET /api/auth/password-rules); nhãn lấy từ server nếu có. */
const LOCAL_RULES: PasswordRule[] = [
  { key: 'length', label: 'từ 8 đến 72 ký tự', test: p => p.length >= 8 && p.length <= 72 },
  { key: 'lower', label: 'ít nhất 1 chữ thường', test: p => /[a-z]/.test(p) },
  { key: 'upper', label: 'ít nhất 1 chữ hoa', test: p => /[A-Z]/.test(p) },
  { key: 'digit', label: 'ít nhất 1 chữ số', test: p => /\d/.test(p) },
  { key: 'special', label: 'ít nhất 1 ký tự đặc biệt', test: p => /[^A-Za-z0-9\s]/.test(p) },
];

/** KH19: đổi mật khẩu trong trang tài khoản. */
@Component({
  selector: 'app-account-change-password',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './change-password.html',
  styleUrl: './change-password.css',
})
export class AccountChangePassword implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private redirectTimer?: ReturnType<typeof setTimeout>;

  rules: PasswordRule[] = LOCAL_RULES;
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  showPasswords = false;
  submitted = false;
  saving = false;
  successMessage = '';
  formError = '';
  serverErrors: Partial<Record<PasswordField, string>> = {};
  serverFailedRules: string[] = [];

  ngOnInit(): void {
    this.http.get<{ rules?: { key: string; label: string }[] }>(`${apiBaseUrl()}/auth/password-rules`).subscribe({
      next: response => {
        const labels = new Map((response?.rules || []).map(rule => [rule.key, rule.label]));
        this.rules = LOCAL_RULES.map(rule => ({ ...rule, label: labels.get(rule.key) || rule.label }));
        this.cdr.markForCheck();
      },
      error: () => { /* Dùng quy tắc mặc định khi không tải được. */ },
    });
  }

  ngOnDestroy(): void {
    if (this.redirectTimer) {
      // Rời trang trước khi hết thời gian chờ: vẫn phải kết thúc phiên đã bị thu hồi.
      clearTimeout(this.redirectTimer);
      endSession();
    }
  }

  rulePassed(rule: PasswordRule): boolean {
    return rule.test(this.newPassword);
  }

  get allRulesPassed(): boolean {
    return this.rules.every(rule => rule.test(this.newPassword));
  }

  get differsFromCurrent(): boolean {
    return !!this.newPassword && this.newPassword !== this.currentPassword;
  }

  get currentPasswordError(): string {
    if (this.serverErrors.currentPassword) return this.serverErrors.currentPassword;
    return this.submitted && !this.currentPassword ? 'Vui lòng nhập mật khẩu hiện tại.' : '';
  }

  get newPasswordError(): string {
    if (this.serverErrors.password) return this.serverErrors.password;
    if (!this.submitted) return '';
    if (!this.newPassword) return 'Vui lòng nhập mật khẩu mới.';
    if (!this.allRulesPassed) return 'Mật khẩu mới chưa đáp ứng đủ yêu cầu bên dưới.';
    if (this.newPassword === this.currentPassword) return 'Mật khẩu mới phải khác mật khẩu hiện tại.';
    return '';
  }

  get confirmPasswordError(): string {
    if (this.serverErrors.confirmPassword) return this.serverErrors.confirmPassword;
    if (this.submitted && !this.confirmPassword) return 'Vui lòng nhập lại mật khẩu mới.';
    return this.confirmPassword && this.confirmPassword !== this.newPassword ? 'Mật khẩu xác nhận không khớp.' : '';
  }

  clearServerError(field: PasswordField): void {
    delete this.serverErrors[field];
    if (field === 'password') this.serverFailedRules = [];
    this.formError = '';
  }

  submit(): void {
    if (this.saving || this.successMessage) return;
    this.submitted = true;
    this.formError = '';
    if (this.currentPasswordError || this.newPasswordError || this.confirmPasswordError) return;

    this.saving = true;
    this.http.post<{ message?: string }>(`${apiBaseUrl()}/auth/change-password`, {
      CURRENT_PASSWORD: this.currentPassword,
      NEW_PASSWORD: this.newPassword,
      CONFIRM_PASSWORD: this.confirmPassword,
    }).subscribe({
      next: response => {
        this.saving = false;
        this.successMessage = response?.message || 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.';
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
        this.cdr.markForCheck();
        // Server đã thu hồi mọi phiên (kể cả phiên này): xoá phiên ở trình duyệt rồi về /login.
        const notice = this.successMessage;
        this.redirectTimer = setTimeout(() => {
          this.redirectTimer = undefined;
          endSession();
          void this.router.navigate(['/login'], { state: { notice } });
        }, 1800);
      },
      error: (error: HttpErrorResponse) => {
        this.saving = false;
        const body = error?.error || {};
        const message = typeof body.message === 'string' ? body.message : '';
        const field = body.field as PasswordField | undefined;
        if (error.status === 400 && field && ['currentPassword', 'password', 'confirmPassword'].includes(field)) {
          this.serverErrors = { ...this.serverErrors, [field]: message || 'Thông tin chưa hợp lệ.' };
          this.serverFailedRules = Array.isArray(body.failedRules) ? body.failedRules : [];
        } else if (error.status === 401) {
          this.formError = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
        } else if (error.status === 0 || error.status >= 500) {
          this.formError = 'Chưa đổi được mật khẩu do lỗi kết nối hoặc hệ thống. Vui lòng thử lại.';
        } else {
          this.formError = message || 'Chưa đổi được mật khẩu. Vui lòng thử lại.';
        }
        this.cdr.markForCheck();
      },
    });
  }
}
