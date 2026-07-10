import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PageHeader2 } from '../../components/page-header-2/page-header-2';
import { PageFooter2 } from '../../components/page-footer-2/page-footer-2';
import { LoginService } from '../../services/login.service';
import { Router } from '@angular/router';
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
) {}
  loginError = '';
  loginPhoneError = '';
  showPassword = false;
  submitted = false;
  showForgotPasswordPopup = false;
  showOtpPopup = false;
  forgotPhone = '';
  forgotPhoneError = '';
  otpValues: string[] = ['', '', '', '', '', ''];
  otpError = '';
  formData = {
    phone: '',
    password: '',
    rememberMe: false,
  };

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

      next: () => {

        this.showForgotPasswordPopup = false;
        this.showOtpPopup = true;
        this.resetOtp();
        this.cdr.detectChanges();
        setTimeout(() => {
          const firstInput = document.getElementById('otp-0') as HTMLInputElement | null;
          firstInput?.focus();
        });
      },

      error: (err) => {
        console.warn(err.error?.message);
        this.forgotPhoneError = 'Số điện thoại không hợp lệ.';
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

  private resetInvalidOtp(): void {
    this.otpValues = ['', '', '', '', '', ''];
    this.otpError = 'Mã code chưa đúng. Vui lòng nhập lại mã code.';
    this.cdr.detectChanges();

    setTimeout(() => {
      const firstInput = document.getElementById('otp-0') as HTMLInputElement | null;
      firstInput?.focus();
    });
  }

  isOtpEmpty(): boolean {
    return this.otpValues.every(value => value.trim() === '');
  }

  isOtpValid(): boolean {
    return this.otpValues.every(value => /^\d$/.test(value));
  }

  onOtpKeydown(event: KeyboardEvent, index: number): void {
    const key = event.key;

    if (/^\d$/.test(key)) {
      event.preventDefault();
      this.otpValues[index] = key;
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

      if (this.otpValues[index]) {
        this.otpValues[index] = '';
        return;
      }

      if (index > 0) {
        this.otpValues[index - 1] = '';
        setTimeout(() => {
          const prevInput = document.getElementById(`otp-${index - 1}`) as HTMLInputElement;
          prevInput?.focus();
        });
      }
      return;
    }

    if (key === 'Tab' || key === 'ArrowLeft' || key === 'ArrowRight') return;

    event.preventDefault();
  }

  onOtpPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const digits = (event.clipboardData?.getData('text') || '')
      .replace(/\D/g, '').slice(0, 6).split('');

    this.resetOtp();
    digits.forEach((digit, i) => this.otpValues[i] = digit);
    this.otpError = '';

    const nextIndex = Math.min(digits.length, this.otpValues.length - 1);
    setTimeout(() => {
      const nextInput = document.getElementById(`otp-${nextIndex}`) as HTMLInputElement;
      nextInput?.focus();
    });
  }

verifyOtp(): void {

  this.otpError = '';

  if (!this.isOtpValid()) {
    this.resetInvalidOtp();
    return;
  }

  const otpCode =
    this.otpValues.join('');

  this.loginService.verifyOtp({

    SDT: this.forgotPhone,

    OTP: otpCode

  }).subscribe({

    next: (res: any) => {

      if (
        res?.success === false ||
        res?.valid === false ||
        res?.isValid === false ||
        res?.verified === false
      ) {
        this.resetInvalidOtp();
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
      this.resetInvalidOtp();
    }
  });
}

  resendOtp(): void {
    this.resetOtp();
    this.loginService.sendOtp({
      SDT: this.forgotPhone
    }).subscribe({
      next: () => {},
      error: (err) => {
        console.warn(err.error?.message || 'Gửi lại OTP thất bại.');
      }
    });
}

onSubmit() {

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
this.loginService.login({
  SDT: this.formData.phone,
  MAT_KHAU: this.formData.password
})
.subscribe({
  next: (res) => {
    console.log('SUCCESS:', res);
    this.router.navigate(['/']);
    // Lưu thông tin khách hàng vào localStorage
    localStorage.setItem('khachHang', JSON.stringify(res.customer));

    this.router.navigate(['/']);
  },

  error: (err) => {

    console.log('STATUS:', err.status);
    console.log('ERROR:', err.error);
    console.log('BODY:', this.formData);

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
