import { Component, ChangeDetectorRef, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { PageHeader2 } from '../../components/page-header-2/page-header-2';
import { PageFooter2 } from '../../components/page-footer-2/page-footer-2';
import { ForgotPasswordService } from '../../services/forgot-password.service';
import {
  DEFAULT_PASSWORD_RULES, PasswordRule, RegisterService, passwordMeetsAllRules, passwordRuleMet
} from '../../services/register.service';
import { endSession } from '../../services/session-auth';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageFooter2, PageHeader2],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.css'
})
export class ForgotPasswordComponent implements OnInit, OnDestroy {
  constructor(
    private forgotPasswordService: ForgotPasswordService,
    private registerService: RegisterService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  /** Không có resetToken (vào thẳng trang hoặc đã hết phiên) → không hiển thị form. */
  hasResetToken = false;
  passwordRules: PasswordRule[] = DEFAULT_PASSWORD_RULES;
  submitted = false;
  saving = false;
  errorMessage = '';
  /** resetToken hết hạn (5 phút) → yêu cầu xác minh lại. */
  sessionExpired = false;
  successMessage = '';
  showNewPassword = false;
  showConfirmPassword = false;
  private redirectTimer?: ReturnType<typeof setTimeout>;

  formData = {
    newPassword: '',
    confirmPassword: ''
  };

  ngOnInit(): void {
    this.hasResetToken = !!sessionStorage.getItem('passwordResetToken');
    // Dọn dữ liệu cũ của phiên bản trước (không còn dùng).
    localStorage.removeItem('forgotPhone');
    if (!this.hasResetToken) return;
    this.registerService.passwordRules().subscribe(rules => {
      this.passwordRules = rules;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void { clearTimeout(this.redirectTimer); }

  ruleMet(key: string): boolean { return passwordRuleMet(key, this.formData.newPassword); }
  get passwordValid(): boolean { return passwordMeetsAllRules(this.formData.newPassword, this.passwordRules); }
  get passwordsMatch(): boolean { return !!this.formData.confirmPassword && this.formData.newPassword === this.formData.confirmPassword; }

  toggleNewPassword(): void {
    this.showNewPassword = !this.showNewPassword;
  }

  toggleConfirmPassword(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  clearError(): void {
    if (!this.sessionExpired) this.errorMessage = '';
  }

  onSubmit(): void {
    if (this.saving || this.successMessage || this.sessionExpired) return;
    this.submitted = true;
    this.errorMessage = '';
    if (!this.passwordValid || !this.passwordsMatch) return;

    const resetToken = sessionStorage.getItem('passwordResetToken');
    if (!resetToken) {
      this.hasResetToken = false;
      return;
    }

    this.saving = true;
    this.forgotPasswordService
      .changePassword({ resetToken, NEW_PASSWORD: this.formData.newPassword })
      .pipe(timeout(30000), finalize(() => { this.saving = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: () => {
          this.successMessage = 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.';
          this.formData = { newPassword: '', confirmPassword: '' };
          sessionStorage.removeItem('passwordResetToken');
          // Server đã thu hồi mọi phiên đăng nhập: xoá phiên cũ trên trình duyệt này.
          endSession();
          this.redirectTimer = setTimeout(() => this.router.navigate(['/login']), 2500);
        },
        error: (err) => {
          const body = err?.error || {};
          if (err?.status === 0 || err?.name === 'TimeoutError') {
            this.errorMessage = 'Không kết nối được máy chủ. Vui lòng thử lại.';
          } else if (body.expired) {
            this.sessionExpired = true;
            sessionStorage.removeItem('passwordResetToken');
            this.errorMessage = 'Phiên đặt lại mật khẩu đã hết hạn (5 phút). Vui lòng xác minh lại để tiếp tục.';
          } else {
            let message = body.message || 'Không đổi được mật khẩu. Vui lòng thử lại.';
            if (Array.isArray(body.failedRules) && body.failedRules.length) {
              const failed = body.failedRules.map((r: any) => typeof r === 'string' ? r : r?.label).filter(Boolean).join(', ');
              if (failed && !message.includes(failed)) message = `${message} (${failed})`;
            }
            this.errorMessage = message;
          }
        }
      });
  }

  goToLogin(): void {
    clearTimeout(this.redirectTimer);
    this.router.navigate(['/login']);
  }
}
