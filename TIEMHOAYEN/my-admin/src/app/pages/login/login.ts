import { Component, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminApiService } from '../../services/admin-api.service';

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
    private adminApi: AdminApiService
  ) {}

  submitted = false;
  loginError = '';
  showPassword = false;

  showForgotPopup = false;
  showOtpPopup = false;
  showNewPasswordPopup = false;
  showSuccessToast = false;

  forgotEmail = '';
  forgotSubmitted = false;
  forgotEmailError = '';

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

    this.clearStoredAdminSession();

    this.adminApi.loginAdmin(email, password).subscribe({
      next: (response) => {
        localStorage.setItem('adminLoggedIn', 'true');
        localStorage.setItem('adminEmail', response.employee.email);
        localStorage.setItem('adminEmployeeId', response.employee.id);
        localStorage.setItem('adminRole', response.employee.role);
        localStorage.setItem('adminPermissions', JSON.stringify(response.permissions));
        this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        this.loginError = error?.error?.message || 'Email hoặc mật khẩu không đúng.';
        this.cdr.detectChanges();
      },
    });
  }

  private clearStoredAdminSession(): void {
    [
      'adminLoggedIn',
      'adminEmail',
      'adminEmployeeId',
      'adminRole',
      'adminPermissions',
      'adminToken',
      'adminUser',
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

    console.log('Gửi OTP đến email:', email);
    this.showForgotPopup = false;
    this.showOtpPopup = true;
    this.forgotSubmitted = false;
    this.forgotEmailError = '';
    this.resetOtp();
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
    const key = event.key;

    if (/^\d$/.test(key)) {
      event.preventDefault();
      this.otpSubmitted = false;
      this.otpValues[index] = key;
      this.focusOtpInput(index + 1);
      return;
    }

    if (key === 'Backspace') {
      event.preventDefault();
      this.otpSubmitted = false;

      if (this.otpValues[index]) {
        this.otpValues[index] = '';
        return;
      }

      if (index > 0) {
        this.otpValues[index - 1] = '';
        this.focusOtpInput(index - 1);
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

    const focusIndex = Math.min(digits.length, this.otpValues.length - 1);
    this.focusOtpInput(focusIndex);
  }

  verifyOtp(): void {
    this.otpSubmitted = true;
    if (!this.isOtpValid()) return;

    console.log('OTP đã nhập:', this.otpValues.join(''));
    this.showOtpPopup = false;
    this.showNewPasswordPopup = true;
    this.otpSubmitted = false;
    this.resetNewPasswordForm();
  }

  resendOtp(): void {
    this.resetOtp();
    console.log('Gửi lại OTP đến email:', this.forgotEmail.trim());
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
    return (
      password.length >= 8 &&
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[^A-Za-z0-9]/.test(password)
    );
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

    console.log('Đổi mật khẩu mới:', this.newPassword);
    this.showSuccessToast = true;

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
