import { Component, ChangeDetectorRef, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { PageHeader2 } from '../../components/page-header-2/page-header-2';
import { PageFooter2 } from '../../components/page-footer-2/page-footer-2';
import { LoginService } from '../../services/login.service';
import { startMemberSession } from '../../services/session-auth';

const PHONE_RE = /^0\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OFFLINE_MESSAGE = 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.';

function isOffline(err: any): boolean {
  return err?.status === 0 || err?.name === 'TimeoutError';
}

/** Thông báo sai mã OTP kèm số lần thử còn lại (nếu server chưa ghi trong message). */
function otpErrorText(body: any): string {
  const remaining = body?.remainingAttempts;
  const hasCount = typeof remaining === 'number';
  if (body?.message) {
    return hasCount && !/\d/.test(body.message) ? `${body.message} Bạn còn ${remaining} lần thử.` : body.message;
  }
  return hasCount ? `Mã chưa đúng. Bạn còn ${remaining} lần thử.` : 'Mã không hợp lệ.';
}

/** Đồng hồ đếm ngược cho mã OTP: thời hạn mã và thời gian chờ gửi lại. */
class OtpTimers {
  expiresSeconds = 0;
  resendSeconds = 0;
  private expiresAt = 0;
  private resendAt = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private onTick: () => void) {}

  start(expiresIn: number, resendAfter: number): void {
    const now = Date.now();
    this.expiresAt = now + Math.max(0, expiresIn) * 1000;
    this.resendAt = now + Math.max(0, resendAfter) * 1000;
    this.run();
  }

  /** 429 khi gửi lại quá sớm: chỉ cập nhật thời gian chờ, giữ nguyên hạn mã hiện tại. */
  delayResend(seconds: number): void {
    this.resendAt = Date.now() + Math.max(0, seconds) * 1000;
    this.run();
  }

  expireNow(): void { this.expiresAt = Date.now(); this.run(); }

  stop(): void {
    clearInterval(this.timer);
    this.expiresSeconds = 0;
    this.resendSeconds = 0;
  }

  private run(): void {
    clearInterval(this.timer);
    const tick = () => {
      const t = Date.now();
      this.expiresSeconds = Math.max(0, Math.ceil((this.expiresAt - t) / 1000));
      this.resendSeconds = Math.max(0, Math.ceil((this.resendAt - t) / 1000));
      if (!this.expiresSeconds && !this.resendSeconds) clearInterval(this.timer);
      this.onTick();
    };
    tick();
    this.timer = setInterval(tick, 250);
  }
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageFooter2, PageHeader2],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginComponent implements OnInit, OnDestroy {
  constructor(
    private loginService: LoginService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {
    this.restoreRememberedLogin();
  }

  /* ---------- Đăng nhập ---------- */
  loginError = '';
  /** 429: khóa tạm 15 phút sau 5 lần sai mật khẩu. */
  loginLocked = false;
  socialNotice = '';
  isLoggingIn = false;
  showPassword = false;
  submitted = false;
  formData = {
    phone: '',
    password: '',
    // Mặc định ghi nhớ đăng nhập; khách dùng máy chung có thể bỏ chọn.
    rememberMe: true,
  };

  /* ---------- Quên mật khẩu ---------- */
  showForgotPasswordPopup = false;
  showOtpPopup = false;
  forgotIdentifier = '';
  forgotIdentifierError = '';
  otpSending = false;
  otpChecking = false;
  otpDestinationMessage = '';
  otpNotice = '';
  challengeId = '';
  otpValues: string[] = ['', '', '', '', '', ''];
  otpError = '';
  otpExceeded = false;
  readonly otpTimers = new OtpTimers(() => this.cdr.markForCheck());

  // Thông báo chuyển từ trang khác (vd. sau khi đổi mật khẩu trong tài khoản).
  pageNotice = '';

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('recover')) this.openForgotPasswordPopup();
    const notice = typeof history !== 'undefined' ? history.state?.notice : '';
    if (typeof notice === 'string') this.pageNotice = notice;
  }

  ngOnDestroy(): void {
    this.otpTimers.stop();
  }

  trackOtpIndex(index: number): number { return index; }

  private restoreRememberedLogin(): void {
    const rememberedPhone = localStorage.getItem('tiemHoaYenRememberedPhone');
    const rememberLogin = localStorage.getItem('tiemHoaYenRememberLogin') === 'true';

    if (rememberLogin && rememberedPhone) {
      this.formData.phone = rememberedPhone;
      this.formData.rememberMe = true;
    }
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  clearLoginFeedback(): void {
    this.loginError = '';
    this.loginLocked = false;
  }

  onSubmit(): void {
    if (this.isLoggingIn) return;

    this.submitted = true;
    this.loginError = '';
    this.loginLocked = false;
    this.socialNotice = '';

    if (
      !PHONE_RE.test(this.formData.phone) ||
      !this.formData.password ||
      this.formData.password.length < 8
    ) {
      return;
    }

    this.isLoggingIn = true;
    this.loginService.login({
      SDT: this.formData.phone,
      MAT_KHAU: this.formData.password
    })
      .pipe(timeout(30000), finalize(() => { this.isLoggingIn = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (res) => {
          try { startMemberSession(res); }
          catch { this.loginError = 'Chưa tạo được phiên đăng nhập. Vui lòng thử lại.'; return; }

          if (this.formData.rememberMe) {
            localStorage.setItem('tiemHoaYenRememberLogin', 'true');
            localStorage.setItem('tiemHoaYenRememberedPhone', this.formData.phone);
            sessionStorage.removeItem('tiemHoaYenSessionAuth');
          } else {
            localStorage.removeItem('tiemHoaYenRememberLogin');
            localStorage.removeItem('tiemHoaYenRememberedPhone');
            sessionStorage.setItem('tiemHoaYenSessionAuth', 'true');
          }

          window.dispatchEvent(new Event('auth-changed'));
          this.router.navigate(['/']);
        },

        error: (err) => {
          const body = err?.error || {};
          if (isOffline(err)) {
            this.loginError = OFFLINE_MESSAGE;
          } else if (err.status === 429) {
            this.loginLocked = true;
            const minutes = Number(body.retryAfterMinutes) || 15;
            this.loginError = body.message
              || `Bạn đã nhập sai mật khẩu quá 5 lần. Vui lòng thử lại sau ${minutes} phút hoặc dùng Quên mật khẩu.`;
          } else if (err.status === 403 && body.locked) {
            this.loginError = body.message || 'Tài khoản đã bị khóa. Vui lòng liên hệ Tiệm Hoa Yên để được hỗ trợ.';
          } else if (err.status === 401) {
            const remaining = body.remainingAttempts;
            this.loginError = body.message
              || (typeof remaining === 'number'
                ? `Số điện thoại hoặc mật khẩu không đúng. Bạn còn ${remaining} lần thử.`
                : 'Số điện thoại hoặc mật khẩu không đúng.');
          } else {
            this.loginError = body.message || 'Đăng nhập thất bại. Vui lòng thử lại.';
          }
        }
      });
  }

  loginWithGoogle(): void {
    this.socialNotice = 'Đăng nhập bằng Google sẽ sớm được hỗ trợ. Vui lòng đăng nhập bằng số điện thoại.';
  }

  loginWithFacebook(): void {
    this.socialNotice = 'Đăng nhập bằng Facebook sẽ sớm được hỗ trợ. Vui lòng đăng nhập bằng số điện thoại.';
  }

  /* ================= Quên mật khẩu – bước 1 ================= */

  openForgotPasswordPopup(): void {
    this.showForgotPasswordPopup = true;
    this.showOtpPopup = false;
    this.forgotIdentifier = '';
    this.forgotIdentifierError = '';
    this.resetOtp();
  }

  closeForgotPasswordPopup(): void {
    this.showForgotPasswordPopup = false;
    this.forgotIdentifier = '';
    this.forgotIdentifierError = '';
  }

  /** Phân loại giá trị nhập: số điện thoại hoặc email. */
  private forgotTarget(): { SDT: string } | { EMAIL: string } | null {
    const value = this.forgotIdentifier.trim();
    if (PHONE_RE.test(value.replace(/[\s.-]/g, ''))) return { SDT: value.replace(/[\s.-]/g, '') };
    if (EMAIL_RE.test(value)) return { EMAIL: value };
    return null;
  }

  isForgotIdentifierValid(): boolean {
    return !!this.forgotTarget();
  }

  sendOtp(): void {
    if (this.otpSending || this.otpChecking) return;

    this.forgotIdentifierError = '';
    const value = this.forgotIdentifier.trim();
    if (!value) {
      this.forgotIdentifierError = 'Vui lòng nhập số điện thoại hoặc email.';
      return;
    }
    const target = this.forgotTarget();
    if (!target) {
      this.forgotIdentifierError = value.includes('@')
        ? 'Email không hợp lệ.'
        : 'Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0.';
      return;
    }

    this.otpSending = true;
    this.loginService.sendOtp(target)
      .pipe(timeout(30000), finalize(() => { this.otpSending = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (response: any) => {
          this.challengeId = response.challengeId;
          this.otpDestinationMessage = response.message
            || 'Nếu thông tin trùng khớp với một tài khoản, mã xác minh đã được gửi tới bạn.';
          this.otpNotice = '';
          this.resetOtp();
          this.otpTimers.start(Number(response.expiresIn) || 60, Number(response.resendAfter) || 60);
          this.showForgotPasswordPopup = false;
          this.showOtpPopup = true;
          setTimeout(() => document.getElementById('otp-0')?.focus());
        },
        error: (err) => {
          this.forgotIdentifierError = isOffline(err)
            ? OFFLINE_MESSAGE
            : (err?.error?.message || 'Chưa gửi được mã xác minh. Vui lòng thử lại.');
        }
      });
  }

  /* ================= Quên mật khẩu – bước 2 (OTP) ================= */

  closeOtpPopup(): void {
    this.showOtpPopup = false;
    this.otpTimers.stop();
    this.resetOtp();
  }

  resetOtp(): void {
    this.otpValues = ['', '', '', '', '', ''];
    this.otpError = '';
    this.otpExceeded = false;
  }

  private clearOtpInputs(): void {
    this.otpValues = ['', '', '', '', '', ''];
    setTimeout(() => document.getElementById('otp-0')?.focus());
  }

  isOtpValid(): boolean {
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

      if (index < this.otpValues.length - 1) {
        setTimeout(() => document.getElementById(`otp-${index + 1}`)?.focus());
      }
      return;
    }

    if (key === 'Backspace') {
      event.preventDefault();
      this.otpError = '';
      const lastFilled = this.otpValues.reduce((last, value, i) => value !== '' ? i : last, -1);
      if (lastFilled >= 0) {
        this.otpValues[lastFilled] = '';
        document.getElementById('otp-' + lastFilled)?.focus();
      }
      return;
    }

    if (key === 'Tab' || key === 'ArrowLeft' || key === 'ArrowRight') return;

    event.preventDefault();
  }

  onOtpPaste(event: ClipboardEvent): void {
    event.preventDefault();
    if (this.otpChecking || this.otpExceeded) return;
    const digits = (event.clipboardData?.getData('text') || '')
      .replace(/\D/g, '').slice(0, 6).split('');

    this.otpValues = ['', '', '', '', '', ''];
    digits.forEach((digit, i) => this.otpValues[i] = digit);
    this.otpError = '';

    queueMicrotask(() => { if (this.isOtpValid()) this.verifyOtp(); });
    const nextIndex = Math.min(digits.length, this.otpValues.length - 1);
    setTimeout(() => document.getElementById(`otp-${nextIndex}`)?.focus());
  }

  verifyOtp(): void {
    if (this.otpChecking || this.otpExceeded || !this.isOtpValid()) return;
    if (this.otpTimers.expiresSeconds <= 0) {
      this.otpError = 'Mã đã hết hạn. Vui lòng gửi mã mới.';
      this.clearOtpInputs();
      return;
    }

    this.otpError = '';
    this.otpNotice = '';
    this.otpChecking = true;
    this.loginService.verifyOtp({
      challengeId: this.challengeId,
      OTP: this.otpValues.join('')
    })
      .pipe(timeout(30000), finalize(() => { this.otpChecking = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (res: any) => {
          // Chỉ lưu resetToken khi xác minh thành công và server thực sự trả token.
          const resetToken = typeof res?.resetToken === 'string' ? res.resetToken : '';
          if (!resetToken) {
            this.otpError = res?.message || 'Chưa xác minh được mã. Vui lòng thử lại.';
            this.clearOtpInputs();
            return;
          }
          sessionStorage.setItem('passwordResetToken', resetToken);
          this.otpTimers.stop();
          this.showOtpPopup = false;
          this.router.navigate(['/forgot-password']);
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
    if (this.otpSending || this.otpChecking || this.otpTimers.resendSeconds > 0) return;
    const target = this.forgotTarget();
    if (!target) { this.openForgotPasswordPopup(); return; }
    this.otpSending = true;
    this.otpNotice = '';
    this.loginService.sendOtp(target)
      .pipe(timeout(30000), finalize(() => { this.otpSending = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (res: any) => {
          this.challengeId = res.challengeId;
          this.resetOtp();
          this.otpNotice = 'Đã gửi lại mã mới. Mã cũ không còn hiệu lực.';
          if (res.message) this.otpDestinationMessage = res.message;
          this.otpTimers.start(Number(res.expiresIn) || 60, Number(res.resendAfter) || 60);
          setTimeout(() => document.getElementById('otp-0')?.focus());
        },
        error: (err) => {
          if (err?.status === 429 && err.error?.resendAfter) this.otpTimers.delayResend(Number(err.error.resendAfter));
          this.otpError = isOffline(err) ? OFFLINE_MESSAGE : (err?.error?.message || 'Gửi lại mã thất bại. Vui lòng thử lại.');
        }
      });
  }
}
