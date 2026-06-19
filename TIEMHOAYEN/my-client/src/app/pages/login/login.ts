import { Component } from '@angular/core';
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
  private router: Router
) {}
  loginError = '';
  showPassword = false;
  submitted = false;
  showForgotPasswordPopup = false;
  showOtpPopup = false;
  forgotPhone = '';
  otpValues: string[] = ['', '', '', '', '', ''];
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
    this.resetOtp();
  }

  closeForgotPasswordPopup(): void {
    this.showForgotPasswordPopup = false;
    this.forgotPhone = '';
  }

  isForgotPhoneValid(): boolean {
    const phoneRegex = /^0[0-9]{9}$/;
    return phoneRegex.test(this.forgotPhone);
  }

  sendOtp(): void {

    if (!this.isForgotPhoneValid()) return;

    this.loginService.sendOtp({
      SDT: this.forgotPhone
    }).subscribe({

      next: () => {

        this.showForgotPasswordPopup = false;
        this.showOtpPopup = true;

        this.resetOtp();
      },

      error: (err) => {

        alert(
          err.error?.message
        );
      }
    });
}

  closeOtpPopup(): void {
    this.showOtpPopup = false;
    this.resetOtp();
  }

  resetOtp(): void {
    this.otpValues = ['', '', '', '', '', ''];
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

    const nextIndex = Math.min(digits.length, this.otpValues.length - 1);
    setTimeout(() => {
      const nextInput = document.getElementById(`otp-${nextIndex}`) as HTMLInputElement;
      nextInput?.focus();
    });
  }

verifyOtp(): void {

  if (!this.isOtpValid()) return;

  const otpCode =
    this.otpValues.join('');

  this.loginService.verifyOtp({

    SDT: this.forgotPhone,

    OTP: otpCode

  }).subscribe({

    next: () => {

      localStorage.setItem(
        'forgotPhone',
        this.forgotPhone
      );

      this.router.navigate([
  '/forgot-password'
]);
    },

    error: (err) => {

      alert(
        err.error?.message
      );
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
        alert(err.error?.message || 'Gửi lại OTP thất bại.');
      }
    });
}

onSubmit() {

  this.submitted = true;
  this.loginError = '';

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
  },

  error: (err) => {

    console.log('STATUS:', err.status);
    console.log('ERROR:', err.error);
    console.log('BODY:', this.formData);

    this.loginError =
      err.error?.message || 'Đăng nhập thất bại';
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
