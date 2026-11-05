import { Component, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminApiService } from '../../services/admin-api.service';
import { finalize, timeout } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { endSession } from '../../services/session-auth';
import { apiBaseUrl } from '../../services/api-config';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements AfterViewInit {
  constructor(
    private router: Router,
    private cdr: ChangeDetectorRef,
    private adminApi: AdminApiService,
    private http: HttpClient
  ) {}

  submitted = false;
  isLoggingIn = false;
  recoveryBusy = false;
  recoveryError = '';
  otpChecking = false;
  challengeId = '';
  otpSeconds = 0;
  resendSeconds = 0;
  otpAttemptLimit = 3;
  otpRemainingAttempts: number | null = null;
  recoveryMessage = '';
  private otpTimer?: ReturnType<typeof setInterval>;
  private resendTimer?: ReturnType<typeof setInterval>;
  // Đếm ngược hiệu lực mã (60 giây) theo thời gian server trả về.
  startOtpCountdown(seconds = 60): void {
    clearInterval(this.otpTimer);
    const deadline = Date.now() + seconds * 1000;
    this.otpSeconds = seconds;
    this.otpTimer = setInterval(() => {
      this.otpSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      this.cdr.markForCheck();
      if (!this.otpSeconds) clearInterval(this.otpTimer);
    }, 250);
  }
  // Khoảng chờ trước khi được gửi lại mã (AD01: gửi lại sẽ hủy mã cũ).
  startResendCountdown(seconds = 60): void {
    clearInterval(this.resendTimer);
    const deadline = Date.now() + seconds * 1000;
    this.resendSeconds = seconds;
    this.resendTimer = setInterval(() => {
      this.resendSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      this.cdr.markForCheck();
      if (!this.resendSeconds) clearInterval(this.resendTimer);
    }, 250);
  }
  ngOnDestroy(): void { clearInterval(this.otpTimer); clearInterval(this.resendTimer); }

  readonly passwordRules = [
    { label: 'Từ 8 đến 72 ký tự', test: (p: string) => p.length >= 8 && p.length <= 72 },
    { label: 'Có chữ thường (a-z)', test: (p: string) => /[a-z]/.test(p) },
    { label: 'Có chữ hoa (A-Z)', test: (p: string) => /[A-Z]/.test(p) },
    { label: 'Có chữ số (0-9)', test: (p: string) => /\d/.test(p) },
    { label: 'Có ký tự đặc biệt (!@#...)', test: (p: string) => /[^A-Za-z0-9\s]/.test(p) },
  ];

  resetToken = '';
  private recoveryRequest(path: string, data: object, done: (result: any) => void): void {
    if (this.recoveryBusy) return;
    this.recoveryBusy = true;
    this.recoveryError = '';
    this.recoveryMessage = '';
    this.http.post(`${apiBaseUrl()}/auth/admin/` + path, data)
      .pipe(timeout(20000), finalize(() => { this.recoveryBusy = false; this.cdr.markForCheck(); }))
      .subscribe({ next: done, error: e => {
        const body = e?.error || {};
        this.recoveryError = e?.status === 0 ? 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.'
          : body.message || 'Chưa xử lý được yêu cầu. Vui lòng thử lại.';
        if (Number(body.resendAfter) > 0) this.startResendCountdown(Number(body.resendAfter));
        if (typeof body.remainingAttempts === 'number') this.otpRemainingAttempts = body.remainingAttempts;
        if (body.attemptsExceeded || body.expired) { this.otpSeconds = 0; clearInterval(this.otpTimer); }
        if (path === 'verify-otp') this.resetOtp();
      } });
  }
  loginError = '';
  showPassword = false;

  showForgotPopup = false;
  showOtpPopup = false;
  showNewPasswordPopup = false;
  showSuccessToast = false;

  forgotEmail = '';
  forgotSubmitted = false;
  forgotEmailError = '';

  trackOtpIndex(index: number): number { return index; }
  otpValues: string[] = ['', '', '', '', '', ''];
  otpSubmitted = false;

  newPassword = '';
  confirmPassword = '';
  showNewPassword = false;
  showConfirmPassword = false;
  newPasswordSubmitted = false;

  formData = {
    email: '',
    password: '',
  };

  private readonly emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  ngAfterViewInit(): void {
    if (typeof document === 'undefined') return;

    [300, 800, 1500].forEach((delay) => {
      setTimeout(() => this.syncLoginAutofillValues(), delay);
    });
  }

  syncLoginAutofillValues(): void {
    if (typeof document === 'undefined') return;

    const emailInput = document.getElementById('email') as HTMLInputElement | null;
    const passwordInput = document.getElementById('password') as HTMLInputElement | null;

    if (emailInput?.value) this.formData.email = emailInput.value;
    if (passwordInput?.value) this.formData.password = passwordInput.value;

    this.cdr.detectChanges();
  }

  getLoginEmailError(): string {
    const email = this.formData.email.trim();
    if (!email) return 'Vui lòng nhập email.';
    if (!this.emailRegex.test(email)) return 'Email không hợp lệ.';
    return '';
  }

  getLoginPasswordError(): string {
    if (!this.formData.password) return 'Vui lòng nhập mật khẩu.';
    return '';
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  onSubmit(emailValue?: string, passwordValue?: string): void {
    if (this.isLoggingIn) return;
    this.formData.email = emailValue || this.formData.email;
    this.formData.password = passwordValue || this.formData.password;

    this.submitted = true;
    this.loginError = '';

    const email = this.formData.email.trim();
    const password = this.formData.password;

    const emailError = this.getLoginEmailError();
    const passwordError = this.getLoginPasswordError();

    if (emailError || passwordError) {
      this.cdr.detectChanges();
      return;
    }

    endSession();
    this.clearStoredAdminSession();

    this.isLoggingIn = true;
    this.adminApi.loginAdmin(email, password).pipe(timeout(30000), finalize(() => {
      this.isLoggingIn = false;
      this.cdr.markForCheck();
    })).subscribe({
      next: (response) => {
        if (!response.adminSessionToken || !response.accessToken) {
          this.loginError = 'Chưa tạo được phiên đăng nhập. Vui lòng thử lại.';
          this.cdr.markForCheck();
          return;
        }
        localStorage.setItem('adminToken', response.accessToken);
        localStorage.setItem('adminLoggedIn', 'true');
        if(response.adminSessionToken)localStorage.setItem('adminSessionToken',response.adminSessionToken);
        localStorage.setItem('adminEmail', response.employee.email);
        localStorage.setItem('adminEmployeeId', response.employee.id);
        localStorage.setItem('adminRole', response.employee.role);
        localStorage.setItem('adminPermissions', JSON.stringify(response.permissions));
        if (response.employee.name) localStorage.setItem('adminName', response.employee.name);
        // AD01: lưu lần đăng nhập gần nhất (thời gian, IP, thiết bị) để header hiển thị.
        if (response.lastLogin) localStorage.setItem('adminLastLogin', JSON.stringify(response.lastLogin));
        else localStorage.removeItem('adminLastLogin');
        this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        this.loginError = error?.status === 0 ? 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.'
          : error?.error?.message || 'Email hoặc mật khẩu không đúng.';
        this.cdr.detectChanges();
      },
    });
  }

  private clearStoredAdminSession(): void {
    [
      'adminLoggedIn',
      'adminSessionToken',
      'adminEmail',
      'adminEmployeeId',
      'adminRole',
      'adminPermissions',
      'adminToken',
      'adminUser',
      'adminName',
      'adminLastLogin',
    ].forEach((key) => localStorage.removeItem(key));
  }

  openForgotPopup(): void {
    this.showForgotPopup = true;
    this.showOtpPopup = false;
    this.showNewPasswordPopup = false;
    this.showSuccessToast = false;
    this.forgotEmail = '';
    this.forgotSubmitted = false;
    this.forgotEmailError = '';
    this.recoveryError = '';
    this.recoveryMessage = '';
  }

  closeForgotPopup(): void {
    this.showForgotPopup = false;
    this.forgotEmail = '';
    this.forgotSubmitted = false;
    this.forgotEmailError = '';
  }

  isForgotEmailValid(): boolean {
    return this.emailRegex.test(this.forgotEmail.trim());
  }

  isAdminEmail(email: string): boolean {
    return this.emailRegex.test(email.trim());
  }

  sendResetEmail(): void {
    this.forgotSubmitted = true;
    this.forgotEmailError = '';

    const email = this.forgotEmail.trim();
    if (!email) {
      this.forgotEmailError = 'Vui lòng nhập email.';
      return;
    }

    if (!this.isForgotEmailValid()) {
      this.forgotEmailError = 'Email không hợp lệ.';
      return;
    }

    this.recoveryRequest('send-otp', { EMAIL: email }, result => {
    this.challengeId = result.challengeId;
    this.startOtpCountdown(Number(result.expiresIn) || 60);
    this.startResendCountdown(Number(result.resendAfter) || 60);
    this.otpAttemptLimit = Number(result.attemptLimit) || 3;
    this.otpRemainingAttempts = null;
    this.recoveryMessage = result.message || 'Đã gửi mã xác thực đến email của bạn.';
    this.showForgotPopup = false;
    this.showOtpPopup = true;
    this.forgotSubmitted = false;
    this.forgotEmailError = '';
    this.resetOtp();
    });
  }

  backToForgot(): void {
    this.showOtpPopup = false;
    this.showForgotPopup = true;
    this.forgotSubmitted = false;
    this.forgotEmailError = '';
    this.resetOtp();
  }

  closeOtpPopup(): void {
    this.showOtpPopup = false;
    this.resetOtp();
  }

  resetOtp(): void {
    this.otpValues = ['', '', '', '', '', ''];
    this.otpSubmitted = false;
  }

  isOtpValid(): boolean {
    return this.otpValues.every((value) => /^\d$/.test(value));
  }

  onOtpKeydown(event: KeyboardEvent, index: number): void {
    if (this.otpChecking) { event.preventDefault(); return; }
    const key = event.key;

    if (/^\d$/.test(key)) {
      event.preventDefault();
      this.otpSubmitted = false;
      this.otpValues[index] = key;
      queueMicrotask(() => { if (this.isOtpValid()) this.verifyOtp(); });
      this.focusOtpInput(index + 1);
      return;
    }

    if (key === 'Backspace') {
      event.preventDefault();
      this.otpSubmitted = false;
      const firstFilled = this.otpValues.reduce((last, value, i) => value !== '' ? i : last, -1);
      if (firstFilled >= 0) {
        this.otpValues[firstFilled] = '';
        document.getElementById('otp-' + firstFilled)?.focus();
      }
      return;
    }

    if (key === 'Tab' || key === 'ArrowLeft' || key === 'ArrowRight') return;
    event.preventDefault();
  }

  onOtpPaste(event: ClipboardEvent): void {
    event.preventDefault();
    this.otpSubmitted = false;

    const pastedValue = event.clipboardData?.getData('text') || '';
    const digits = pastedValue.replace(/\D/g, '').slice(0, 6).split('');

    this.otpValues = ['', '', '', '', '', ''];
    digits.forEach((digit, index) => {
      this.otpValues[index] = digit;
    });

    queueMicrotask(() => { if (this.isOtpValid()) this.verifyOtp(); });
    const focusIndex = Math.min(digits.length, this.otpValues.length - 1);
    this.focusOtpInput(focusIndex);
  }

  verifyOtp(): void {
    if (this.otpSeconds <= 0) { this.recoveryError = 'Mã đã hết hạn. Vui lòng gửi mã mới.'; this.cdr.markForCheck(); return; }
    if (this.recoveryBusy || !this.isOtpValid()) return;
    this.otpSubmitted = true;

    this.recoveryRequest('verify-otp', { challengeId: this.challengeId, OTP: this.otpValues.join('') }, result => {
    this.resetToken = result.resetToken;
    this.recoveryMessage = result.message || 'Xác thực thành công.';
    this.showOtpPopup = false;
    this.showNewPasswordPopup = true;
    this.otpSubmitted = false;
    this.resetNewPasswordForm();
    });
  }

  resendOtp(): void {
    if (this.recoveryBusy || this.resendSeconds > 0) return;
    this.resetOtp();
    this.sendResetEmail();
  }

  backToOtp(): void {
    this.showNewPasswordPopup = false;
    this.showOtpPopup = true;
    this.showSuccessToast = false;
    this.resetNewPasswordForm();
  }

  closeNewPasswordPopup(): void {
    this.showNewPasswordPopup = false;
    this.showSuccessToast = false;
    this.resetNewPasswordForm();
  }

  isPasswordStrong(password: string): boolean {
    return this.passwordRules.every(rule => rule.test(password));
  }

  getNewPasswordError(): string {
    if (!this.newPassword) return 'Vui lòng nhập mật khẩu.';
    if (!this.isPasswordStrong(this.newPassword)) {
      return 'Mật khẩu phải có ít nhất 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.';
    }
    return '';
  }

  getConfirmPasswordError(): string {
    if (!this.confirmPassword) return 'Vui lòng nhập lại mật khẩu.';
    if (this.confirmPassword !== this.newPassword) return 'Mật khẩu không khớp.';
    return '';
  }

  isNewPasswordValid(): boolean {
    return this.isPasswordStrong(this.newPassword) && this.confirmPassword === this.newPassword;
  }

  submitNewPassword(): void {
    this.newPasswordSubmitted = true;
    if (!this.isNewPasswordValid()) return;

    this.recoveryRequest('reset-password', { resetToken: this.resetToken, NEW_PASSWORD: this.newPassword }, () => {
    this.resetToken = '';
    this.showSuccessToast = true;
    clearInterval(this.otpTimer); clearInterval(this.resendTimer);

    setTimeout(() => {
      this.showSuccessToast = false;
      this.showForgotPopup = false;
      this.showOtpPopup = false;
      this.showNewPasswordPopup = false;
      this.resetOtp();
      this.resetNewPasswordForm();
      this.formData.email = this.forgotEmail.trim();
      this.formData.password = '';
      this.submitted = false;
      this.loginError = '';
      this.router.navigate(['/login']);
    }, 1200);
    });
  }

  private focusOtpInput(index: number): void {
    if (index < 0 || index >= this.otpValues.length) return;
    if (typeof document === 'undefined') return;

    setTimeout(() => {
      const input = document.getElementById(`otp-${index}`) as HTMLInputElement | null;
      input?.focus();
    });
  }

  private resetNewPasswordForm(): void {
    this.newPassword = '';
    this.confirmPassword = '';
    this.showNewPassword = false;
    this.showConfirmPassword = false;
    this.newPasswordSubmitted = false;
  }
}
