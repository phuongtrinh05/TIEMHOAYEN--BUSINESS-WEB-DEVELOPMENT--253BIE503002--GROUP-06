import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PageHeader2 } from '../../components/page-header-2/page-header-2';
import { PageFooter2 } from '../../components/page-footer-2/page-footer-2';
import { LoginService } from '../../services/login.service';
import { Router } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { endSession } from '../../services/session-auth';
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageFooter2, PageHeader2],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginComponent {
constructor(
  private loginService: LoginService,
  private router: Router,
  private cdr: ChangeDetectorRef 
) {
  this.restoreRememberedLogin();
}
  loginError = '';
  isLoggingIn = false;
  otpChecking = false;
  challengeId = '';
  otpSeconds = 0;
  private otpTimer?: ReturnType<typeof setInterval>;
  startOtpCountdown(): void {
    clearInterval(this.otpTimer);
    const deadline = Date.now() + 60000;
    this.otpSeconds = 60;
    this.otpTimer = setInterval(() => {
      this.otpSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      this.cdr.markForCheck();
      if (!this.otpSeconds) clearInterval(this.otpTimer);
    }, 250);
  }
  ngOnDestroy(): void { clearInterval(this.otpTimer); }

  loginPhoneError = '';
  showPassword = false;
  submitted = false;
  showForgotPasswordPopup = false;
  showOtpPopup = false;
  forgotPhone = '';
  forgotPhoneError = '';
  trackOtpIndex(index: number): number { return index; }
  otpValues: string[] = ['', '', '', '', '', ''];
  otpError = '';
  formData = {
    phone: '',
    password: '',
    rememberMe: false,
  };

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

  openForgotPasswordPopup(): void {
    this.showForgotPasswordPopup = true;
    this.showOtpPopup = false;
    this.forgotPhone = '';
    this.forgotPhoneError = '';
    this.resetOtp();
  }

  closeForgotPasswordPopup(): void {
    this.showForgotPasswordPopup = false;
    this.forgotPhone = '';
    this.forgotPhoneError = '';
  }

  isForgotPhoneValid(): boolean {
    const phoneRegex = /^0[0-9]{9}$/;
    return phoneRegex.test(this.forgotPhone);
  }

  sendOtp(): void {

    this.forgotPhoneError = '';

    if (!this.forgotPhone.trim()) {
      this.forgotPhoneError = 'Vui lòng nhập số điện thoại.';
      this.cdr.detectChanges();
      return;
    }

    if (!this.isForgotPhoneValid()) {
      this.forgotPhoneError = 'Số điện thoại không hợp lệ.';
      this.cdr.detectChanges();
      return;
    }

    this.loginService.sendOtp({
      SDT: this.forgotPhone
    }).subscribe({

      next: (response: any) => {
        this.challengeId = response.challengeId; this.startOtpCountdown();

        this.showForgotPasswordPopup = false;
        this.showOtpPopup = true;
        this.resetOtp();
        this.cdr.detectChanges(); 
      },

      error: (err) => {
        console.warn(err.error?.message);
        this.forgotPhoneError = err.error?.message || 'Chưa gửi được mã xác minh.';
        this.cdr.detectChanges();
      }
    });
}

  closeOtpPopup(): void {
    this.showOtpPopup = false;
    this.resetOtp();
  }

  resetOtp(): void {
    this.otpValues = ['', '', '', '', '', ''];
    this.otpError = '';
  }

  isOtpEmpty(): boolean {
    return this.otpValues.every(value => value.trim() === '');
  }

  isOtpValid(): boolean {
    return this.otpValues.every(value => /^\d$/.test(value));
  }

  onOtpKeydown(event: KeyboardEvent, index: number): void {
    if (this.otpChecking) { event.preventDefault(); return; }
    const key = event.key;

    if (/^\d$/.test(key)) {
      event.preventDefault();
      this.otpValues[index] = key;
      queueMicrotask(() => { if (this.isOtpValid()) this.verifyOtp(); });
      this.otpError = '';

      if (index < this.otpValues.length - 1) {
        setTimeout(() => {
          const nextInput = document.getElementById(`otp-${index + 1}`) as HTMLInputElement;
          nextInput?.focus();
        });
      }
      return;
    }

    if (key === 'Backspace') {
      event.preventDefault();
      this.otpError = '';
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
    if (this.otpChecking) return;
    event.preventDefault();
    const digits = (event.clipboardData?.getData('text') || '')
      .replace(/\D/g, '').slice(0, 6).split('');

    this.resetOtp();
    digits.forEach((digit, i) => this.otpValues[i] = digit);
    this.otpError = '';

    queueMicrotask(() => { if (this.isOtpValid()) this.verifyOtp(); });
    const nextIndex = Math.min(digits.length, this.otpValues.length - 1);
    setTimeout(() => {
      const nextInput = document.getElementById(`otp-${nextIndex}`) as HTMLInputElement;
      nextInput?.focus();
    });
  }

verifyOtp(): void {
    if (this.otpSeconds <= 0) { this.otpError = 'Mã đã hết hạn. Vui lòng gửi mã mới.'; this.cdr.markForCheck(); return; }
  if (this.otpChecking || !this.isOtpValid()) return;

  this.otpError = '';

  if (!this.isOtpValid()) {
    this.otpError = 'Mã code chưa đúng. Vui lòng nhập lại mã code.';
    this.cdr.detectChanges();
    return;
  }

  const otpCode =
    this.otpValues.join('');

  this.otpChecking = true;
  this.loginService.verifyOtp({

    SDT: this.forgotPhone,

    OTP: otpCode
    , challengeId: this.challengeId

  }).pipe(timeout(20000), finalize(() => { this.otpChecking = false; this.cdr.markForCheck(); })).subscribe({

    next: (res: any) => {
      sessionStorage.setItem('passwordResetToken', res.resetToken || '');

      if (
        res?.success === false ||
        res?.valid === false ||
        res?.isValid === false ||
        res?.verified === false
      ) {
        this.otpError = 'Mã code chưa đúng. Vui lòng nhập lại mã code.';
        this.cdr.detectChanges();
        return;
      }

      localStorage.setItem(
        'forgotPhone',
        this.forgotPhone
      );

      this.router.navigate([
  '/forgot-password'
]);
    },

    error: (err) => {

      console.warn(
        err.error?.message
      );
      this.otpError = 'Mã code chưa đúng. Vui lòng nhập lại mã code.';
      this.cdr.detectChanges();
    }
  });
}

  resendOtp(): void {
    if (this.otpSeconds > 0) return;
    this.resetOtp();
    this.loginService.sendOtp({
      SDT: this.forgotPhone
    }).subscribe({
      next: (res: any) => { this.challengeId = res.challengeId; this.startOtpCountdown(); },
      error: (err) => {
        console.warn(err.error?.message || 'Gửi lại OTP thất bại.');
      }
    });
}

onSubmit() {
  if (this.isLoggingIn) return;

  this.submitted = true;
  this.loginError = '';
  this.loginPhoneError = '';

  if (
    !this.formData.phone ||
    !this.formData.password ||
    !/^0\d{9}$/.test(this.formData.phone) ||
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
    endSession();
    localStorage.setItem('khachHang', JSON.stringify(res.customer));

    if (res?.token) {
      localStorage.setItem('token', String(res.token));
    }

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


    if (err.status === 404) {
      this.loginPhoneError = 'Số điện thoại không hợp lệ.';
      this.loginError = '';
    } else {
      this.loginError =
        err.error?.message || 'Đăng nhập thất bại';
    }
    this.cdr.detectChanges(); 
  }
});

}
  

  loginWithGoogle(): void {
    // TODO: Tích hợp Google OAuth khi có backend
    console.log('Đăng nhập với Google');
  }

  loginWithFacebook(): void {
    // TODO: Tích hợp Facebook OAuth khi có backend
    console.log('Đăng nhập với Facebook');
  }
}
