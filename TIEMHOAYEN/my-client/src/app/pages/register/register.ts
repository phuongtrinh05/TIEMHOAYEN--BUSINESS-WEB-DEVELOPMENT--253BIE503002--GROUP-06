import { Component, ChangeDetectorRef, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { PageHeader2 } from '../../components/page-header-2/page-header-2';
import { PageFooter2 } from '../../components/page-footer-2/page-footer-2';
import {
  DEFAULT_PASSWORD_RULES, PasswordRule, RegisterService, passwordMeetsAllRules, passwordRuleMet
} from '../../services/register.service';
import { LoginService } from '../../services/login.service';

type FieldKey = 'name' | 'gender' | 'phone' | 'email' | 'password';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageFooter2, PageHeader2],
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class RegisterComponent implements OnInit, OnDestroy {

  constructor(
    private registerService: RegisterService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private loginService: LoginService
  ) { }

  readonly genders = ['Nam', 'Nữ', 'Khác'];
  passwordRules: PasswordRule[] = DEFAULT_PASSWORD_RULES;

  showPassword = false;
  showConfirmPassword = false;
  submitted = false;
  showSuccessPopup = false;

  /** Lỗi theo từng trường do server trả về (field). */
  serverErrors: Partial<Record<FieldKey, string>> = {};
  formError = '';
  /** 409 pendingVerification: SĐT đã đăng ký nhưng chưa xác minh. */
  pendingVerification = false;

  busy = false;            // đang gửi form đăng ký
  needsVerification = false;
  challengeId = '';
  verificationCode = '';
  verificationInvalid = false;
  verificationMessage = '';
  verificationError = '';
  attemptsExceeded = false;
  otpSending = false;
  otpVerifying = false;
  expiresSeconds = 0;
  resendSeconds = 0;
  private expiresAt = 0;
  private resendAt = 0;
  private timer?: ReturnType<typeof setInterval>;

  formData = {
    fullName: '',
    gender: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
    agreeTerms: false,
  };

  ngOnInit(): void {
    this.registerService.passwordRules().subscribe(rules => {
      this.passwordRules = rules;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void { clearInterval(this.timer); }

  ruleMet(key: string): boolean { return passwordRuleMet(key, this.formData.password); }
  get passwordValid(): boolean { return passwordMeetsAllRules(this.formData.password, this.passwordRules); }
  get passwordsMatch(): boolean { return !!this.formData.confirmPassword && this.formData.password === this.formData.confirmPassword; }
  get phoneFormatValid(): boolean { return /^0\d{9}$/.test(this.formData.phone.trim()); }
  get emailFormatValid(): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.formData.email.trim()); }

  clearServerError(field: FieldKey): void {
    delete this.serverErrors[field];
    this.formError = '';
    if (field === 'phone' || field === 'email') this.pendingVerification = false;
  }

  togglePassword(): void { this.showPassword = !this.showPassword; }
  toggleConfirmPassword(): void { this.showConfirmPassword = !this.showConfirmPassword; }

  onSubmit(): void {
    if (this.busy || this.needsVerification) return;
    this.submitted = true;
    this.formError = '';

    const name = this.formData.fullName.trim();
    if (
      name.length < 2 ||
      !this.formData.gender ||
      !this.phoneFormatValid ||
      !this.emailFormatValid ||
      !this.passwordValid ||
      !this.passwordsMatch ||
      !this.formData.agreeTerms
    ) return;

    const payload = {
      TEN: name,
      GIOI_TINH: this.formData.gender,
      SDT: this.formData.phone.trim(),
      EMAIL: this.formData.email.trim(),
      MAT_KHAU: this.formData.password
    };

    this.busy = true;
    this.serverErrors = {};
    this.pendingVerification = false;
    this.registerService.register(payload)
      .pipe(timeout(30000), finalize(() => { this.busy = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: () => {
          this.needsVerification = true;
          this.sendVerification();
        },
        error: (err) => {
          const body = err?.error || {};
          const field = body.field as FieldKey | undefined;
          let message = body.message || 'Đăng ký chưa thành công. Vui lòng thử lại.';
          if (field === 'password' && Array.isArray(body.failedRules) && body.failedRules.length) {
            const failed = body.failedRules.map((r: any) => typeof r === 'string' ? r : r?.label).filter(Boolean).join(', ');
            if (failed && !message.includes(failed)) message = `${message} (${failed})`;
          }
          if (err?.status === 0 || err?.name === 'TimeoutError') {
            this.formError = 'Không kết nối được máy chủ. Vui lòng thử lại.';
          } else if (field && ['name', 'gender', 'phone', 'email', 'password'].includes(field)) {
            this.serverErrors[field] = message;
            if (err.status === 409 && body.pendingVerification) this.pendingVerification = true;
          } else {
            this.formError = message;
          }
        }
      });
  }

  /** Tài khoản đã đăng ký nhưng chưa xác minh: gửi lại mã và chuyển sang bước nhập mã. */
  resendForPending(): void {
    this.needsVerification = true;
    this.serverErrors = {};
    this.pendingVerification = false;
    this.sendVerification();
  }

  sendVerification(): void {
    if (this.otpSending || this.otpVerifying || this.resendSeconds > 0) return;
    const isResend = !!this.challengeId;
    const email = this.formData.email.trim();
    const target = email ? { EMAIL: email } : { SDT: this.formData.phone.trim() };
    this.otpSending = true;
    this.verificationError = '';
    this.loginService.sendOtp({ ...target, purpose: 'DANG_KY' })
      .pipe(timeout(30000), finalize(() => { this.otpSending = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (res: any) => {
          this.challengeId = res.challengeId;
          this.verificationCode = '';
          this.verificationInvalid = false;
          this.attemptsExceeded = false;
          this.verificationMessage = isResend
            ? 'Đã gửi lại mã mới. Mã cũ không còn hiệu lực.'
            : (res.message || 'Mã xác minh đã được gửi.');
          this.startTimers(Number(res.expiresIn) || 60, Number(res.resendAfter) || 60);
          setTimeout(() => document.getElementById('registration-code')?.focus());
        },
        error: (err) => {
          if (err?.status === 429 && err.error?.resendAfter) {
            this.startTimers(this.expiresSeconds, Number(err.error.resendAfter));
          }
          this.verificationError = err?.status === 0 || err?.name === 'TimeoutError'
            ? 'Không kết nối được máy chủ. Vui lòng thử lại.'
            : (err?.error?.message || 'Chưa gửi được mã xác minh.');
        }
      });
  }

  onVerificationInput(value: string): void {
    this.verificationCode = (value || '').replace(/\D/g, '').slice(0, 6);
    this.verificationInvalid = false;
    if (!this.attemptsExceeded) this.verificationError = '';
    if (this.verificationCode.length === 6) this.verifyRegistration();
  }

  verifyRegistration(): void {
    if (this.otpVerifying || this.attemptsExceeded || !/^\d{6}$/.test(this.verificationCode)) return;
    if (this.expiresSeconds <= 0) {
      this.verificationError = 'Mã đã hết hạn. Vui lòng bấm Gửi lại mã.';
      this.verificationInvalid = true;
      return;
    }
    this.otpVerifying = true;
    this.verificationError = '';
    this.loginService.verifyOtp({ challengeId: this.challengeId, OTP: this.verificationCode, purpose: 'DANG_KY' })
      .pipe(timeout(30000), finalize(() => { this.otpVerifying = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: () => {
          clearInterval(this.timer);
          this.needsVerification = false;
          this.showSuccessPopup = true;
        },
        error: (err) => {
          const body = err?.error || {};
          this.verificationInvalid = true;
          this.verificationCode = '';
          if (body.attemptsExceeded) {
            this.attemptsExceeded = true;
            this.verificationError = 'Bạn đã nhập sai quá 5 lần. Vui lòng bấm Gửi lại mã.';
          } else if (body.expired) {
            this.expiresSeconds = 0;
            this.verificationError = body.message || 'Mã đã hết hạn. Vui lòng bấm Gửi lại mã.';
          } else if (err?.status === 0 || err?.name === 'TimeoutError') {
            this.verificationError = 'Không kết nối được máy chủ. Vui lòng thử lại.';
          } else {
            this.verificationError = otpErrorText(body);
          }
          setTimeout(() => document.getElementById('registration-code')?.focus());
        }
      });
  }

  private startTimers(expiresIn: number, resendAfter: number): void {
    clearInterval(this.timer);
    const now = Date.now();
    this.expiresAt = now + Math.max(0, expiresIn) * 1000;
    this.resendAt = now + Math.max(0, resendAfter) * 1000;
    const tick = () => {
      const t = Date.now();
      this.expiresSeconds = Math.max(0, Math.ceil((this.expiresAt - t) / 1000));
      this.resendSeconds = Math.max(0, Math.ceil((this.resendAt - t) / 1000));
      if (!this.expiresSeconds && !this.resendSeconds) clearInterval(this.timer);
      this.cdr.markForCheck();
    };
    tick();
    this.timer = setInterval(tick, 250);
  }

  closeSuccessPopup(): void {
    this.showSuccessPopup = false;
    window.dispatchEvent(new Event('auth-changed'));
    this.router.navigate(['/login']);
  }

  dismissSuccessPopup(): void {
    this.showSuccessPopup = false;
  }
}

/** Ghép thông báo sai mã kèm số lần thử còn lại (nếu server chưa ghi trong message). */
function otpErrorText(body: any): string {
  const remaining = body?.remainingAttempts;
  const hasCount = typeof remaining === 'number';
  if (body?.message) {
    return hasCount && !/\d/.test(body.message) ? `${body.message} Bạn còn ${remaining} lần thử.` : body.message;
  }
  return hasCount ? `Mã chưa đúng. Bạn còn ${remaining} lần thử.` : 'Mã không hợp lệ.';
}
