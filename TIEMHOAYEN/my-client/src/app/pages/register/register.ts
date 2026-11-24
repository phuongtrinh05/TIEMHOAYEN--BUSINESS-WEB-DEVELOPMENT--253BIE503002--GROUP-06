import { Component, ChangeDetectorRef, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import {
  DEFAULT_PASSWORD_RULES, PasswordRule, RegisterService, passwordMeetsAllRules, passwordRuleMet
} from '../../services/register.service';
import { LoginService } from '../../services/login.service';
import { OFFLINE_MESSAGE, OtpTimers, isOffline, otpErrorText } from '../../services/otp-helpers';

type FieldKey = 'name' | 'gender' | 'phone' | 'email' | 'password';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class RegisterComponent implements OnInit, OnDestroy {

  constructor(
    private registerService: RegisterService,
    private loginService: LoginService,
    private cdr: ChangeDetectorRef,
    private router: Router,
  ) { }

  readonly genders = ['Nam', 'Nữ', 'Khác'];
  passwordRules: PasswordRule[] = DEFAULT_PASSWORD_RULES;

  showPassword = false;
  showConfirmPassword = false;
  submitted = false;
  showSuccessPopup = false;

  /* ---- Bước 2: nhập mã OTP xác minh đăng ký ---- */
  showOtpPopup = false;
  otpValues = ['', '', '', '', '', ''];
  otpError = '';
  otpNotice = '';
  otpDestinationMessage = '';
  otpChecking = false;
  otpSending = false;
  otpExceeded = false;
  private challengeId = '';
  private registeredPhone = '';
  readonly otpTimers = new OtpTimers(() => this.cdr.markForCheck());

  /** Lỗi theo từng trường do server trả về (field). */
  serverErrors: Partial<Record<FieldKey, string>> = {};
  formError = '';
  busy = false;

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

  ngOnDestroy(): void { this.otpTimers.stop(); }

  ruleMet(key: string): boolean { return passwordRuleMet(key, this.formData.password); }
  get passwordValid(): boolean { return passwordMeetsAllRules(this.formData.password, this.passwordRules); }
  get passwordsMatch(): boolean { return !!this.formData.confirmPassword && this.formData.password === this.formData.confirmPassword; }
  get phoneFormatValid(): boolean { return /^0\d{9}$/.test(this.formData.phone.trim()); }
  /** Email không bắt buộc: để trống là hợp lệ, có nhập thì phải đúng định dạng. */
  get emailFormatValid(): boolean {
    const email = this.formData.email.trim();
    return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  clearServerError(field: FieldKey): void {
    delete this.serverErrors[field];
    this.formError = '';
  }

  togglePassword(): void { this.showPassword = !this.showPassword; }
  toggleConfirmPassword(): void { this.showConfirmPassword = !this.showConfirmPassword; }

  onSubmit(): void {
    if (this.busy) return;
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
    this.registerService.register(payload)
      .pipe(timeout(30000), finalize(() => { this.busy = false; this.cdr.markForCheck(); }))
      .subscribe({
        // Tài khoản chỉ hoạt động sau khi nhập đúng mã OTP gửi tới email/số điện thoại.
        next: (res: any) => {
          if (res?.requiresVerification === false) { this.showSuccessPopup = true; return; }
          this.registeredPhone = payload.SDT;
          this.openOtpPopup(res);
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
          } else {
            this.formError = message;
          }
        }
      });
  }

  /* ================= Bước 2: nhập mã OTP ================= */

  private openOtpPopup(res: any): void {
    this.resetOtp();
    this.otpNotice = '';
    this.challengeId = String(res?.challengeId || '');
    this.otpDestinationMessage = res?.otpSent === false
      ? 'Chưa gửi được mã xác minh.'
      : (res?.destinationMessage || 'Mã xác minh đã được gửi tới bạn. Mã có hiệu lực 60 giây.');
    if (res?.otpSent === false) {
      this.otpError = res?.otpError || 'Chưa gửi được mã xác minh. Vui lòng bấm Gửi mã mới.';
      this.otpTimers.start(0, Number(res?.resendAfter) || 0);
    } else {
      this.otpTimers.start(Number(res?.expiresIn) || 60, Number(res?.resendAfter) || 60);
    }
    this.showOtpPopup = true;
    setTimeout(() => document.getElementById('register-otp-0')?.focus());
  }

  closeOtpPopup(): void {
    this.showOtpPopup = false;
    this.otpTimers.stop();
    this.resetOtp();
    this.formError = 'Tài khoản chưa được xác minh. Bấm Đăng ký lại với cùng số điện thoại để nhận mã mới.';
  }

  private resetOtp(): void {
    this.otpValues = ['', '', '', '', '', ''];
    this.otpError = '';
    this.otpExceeded = false;
  }

  private clearOtpInputs(): void {
    this.otpValues = ['', '', '', '', '', ''];
    setTimeout(() => document.getElementById('register-otp-0')?.focus());
  }

  trackOtpIndex(index: number): number { return index; }

  private isOtpValid(): boolean {
    return this.otpValues.every(value => /^\d$/.test(value));
  }

  onOtpKeydown(event: KeyboardEvent, index: number): void {
    if (this.otpChecking || this.otpExceeded) { if (event.key !== 'Tab') event.preventDefault(); return; }
    const key = event.key;
    if (/^\d$/.test(key)) {
      event.preventDefault();
      this.otpValues[index] = key;
      this.otpError = '';
      this.otpNotice = '';
      queueMicrotask(() => { if (this.isOtpValid()) this.verifyOtp(); });
      if (index < this.otpValues.length - 1) setTimeout(() => document.getElementById(`register-otp-${index + 1}`)?.focus());
      return;
    }
    if (key === 'Backspace') {
      event.preventDefault();
      this.otpError = '';
      const lastFilled = this.otpValues.reduce((last, value, i) => value !== '' ? i : last, -1);
      if (lastFilled >= 0) {
        this.otpValues[lastFilled] = '';
        document.getElementById('register-otp-' + lastFilled)?.focus();
      }
      return;
    }
    if (key === 'Tab' || key === 'ArrowLeft' || key === 'ArrowRight') return;
    event.preventDefault();
  }

  onOtpPaste(event: ClipboardEvent): void {
    event.preventDefault();
    if (this.otpChecking || this.otpExceeded) return;
    const digits = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6).split('');
    this.otpValues = ['', '', '', '', '', ''];
    digits.forEach((digit, i) => this.otpValues[i] = digit);
    this.otpError = '';
    queueMicrotask(() => { if (this.isOtpValid()) this.verifyOtp(); });
    const nextIndex = Math.min(digits.length, this.otpValues.length - 1);
    setTimeout(() => document.getElementById(`register-otp-${nextIndex}`)?.focus());
  }

  verifyOtp(): void {
    if (this.otpChecking || this.otpExceeded || !this.isOtpValid()) return;
    if (!this.challengeId || this.otpTimers.expiresSeconds <= 0) {
      this.otpError = 'Mã đã hết hạn. Vui lòng gửi mã mới.';
      this.clearOtpInputs();
      return;
    }
    this.otpError = '';
    this.otpNotice = '';
    this.otpChecking = true;
    this.loginService.verifyOtp({ challengeId: this.challengeId, OTP: this.otpValues.join(''), purpose: 'DANG_KY' })
      .pipe(timeout(30000), finalize(() => { this.otpChecking = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: () => {
          this.otpTimers.stop();
          this.showOtpPopup = false;
          this.formError = '';
          this.showSuccessPopup = true;
        },
        error: (err) => {
          const body = err?.error || {};
          if (body.attemptsExceeded) {
            this.otpExceeded = true;
            this.otpError = body.message || 'Bạn đã nhập sai quá 5 lần. Vui lòng bấm Gửi mã mới.';
          } else if (body.expired) {
            this.otpTimers.expireNow();
            this.otpError = body.message || 'Mã đã hết hạn. Vui lòng gửi mã mới.';
          } else if (isOffline(err)) {
            this.otpError = OFFLINE_MESSAGE;
          } else {
            this.otpError = otpErrorText(body);
          }
          this.clearOtpInputs();
        }
      });
  }

  resendOtp(): void {
    if (this.otpSending || this.otpChecking || this.otpTimers.resendSeconds > 0 || !this.registeredPhone) return;
    this.otpSending = true;
    this.otpNotice = '';
    this.loginService.sendOtp({ SDT: this.registeredPhone, purpose: 'DANG_KY' })
      .pipe(timeout(30000), finalize(() => { this.otpSending = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (res: any) => {
          this.challengeId = res.challengeId;
          this.resetOtp();
          this.otpNotice = 'Đã gửi lại mã mới. Mã cũ không còn hiệu lực.';
          if (res.message) this.otpDestinationMessage = res.message;
          this.otpTimers.start(Number(res.expiresIn) || 60, Number(res.resendAfter) || 60);
          setTimeout(() => document.getElementById('register-otp-0')?.focus());
        },
        error: (err) => {
          if (err?.status === 429 && err.error?.resendAfter) this.otpTimers.delayResend(Number(err.error.resendAfter));
          this.otpError = isOffline(err) ? OFFLINE_MESSAGE : (err?.error?.message || 'Chưa gửi được mã. Vui lòng thử lại.');
        }
      });
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
