import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PageHeader2 } from '../../components/page-header-2/page-header-2';
import { PageFooter2 } from '../../components/page-footer-2/page-footer-2';
import { RegisterService } from '../../services/register.service';
import { LoginService } from '../../services/login.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageFooter2, PageHeader2],
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class RegisterComponent {

  constructor(
    private registerService: RegisterService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private loginService: LoginService
    
  ) { }

  showPassword = false;
  showConfirmPassword = false;
  submitted = false;
  showSuccessPopup = false;
  phoneError = '';
  emailError = '';
  needsVerification = false;
  challengeId = '';
  verificationCode = '';
  verificationInvalid = false;
  onVerificationInput(value: string): void {
    this.verificationCode = value.replace(/\D/g, '').slice(0, 6);
    this.verificationInvalid = false;
    if (this.verificationCode.length === 6) this.verifyRegistration();
  }
  verificationMessage = '';
  busy = false;
  sendVerification(): void {
    if (this.busy) return;
    this.busy = true;
    this.loginService.sendOtp({ EMAIL: this.formData.email.trim(), purpose: 'DANG_KY' }).subscribe({
      next: (res: any) => { this.busy = false; this.challengeId = res.challengeId; this.verificationMessage = res.message; this.cdr.markForCheck(); },
      error: err => { this.busy = false; this.verificationMessage = err.error?.message || 'Chưa gửi được mã.'; this.cdr.markForCheck(); }
    });
  }
  verifyRegistration(): void {
    if (this.busy || !/^\d{6}$/.test(this.verificationCode)) return;
    this.busy = true;
    this.loginService.verifyOtp({ challengeId: this.challengeId, OTP: this.verificationCode, purpose: 'DANG_KY' }).subscribe({
      next: () => { this.busy = false; this.needsVerification = false; this.showSuccessPopup = true; this.cdr.markForCheck(); },
      error: err => { this.busy = false; this.verificationInvalid = true; this.verificationMessage = err.error?.message || 'Mã không hợp lệ.'; this.cdr.markForCheck(); }
    });
  }

  formData = {
    fullName: '',
    gender: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
    agreeTerms: false,
  };

  togglePassword(): void { this.showPassword = !this.showPassword; }
  toggleConfirmPassword(): void { this.showConfirmPassword = !this.showConfirmPassword; }

  onSubmit(): void {
    if (this.busy || this.needsVerification) return;
    this.submitted = true;
    this.phoneError = '';
    this.emailError = '';

    if (
      !this.formData.fullName ||
      !this.formData.phone ||
      !this.formData.password ||
      !this.formData.confirmPassword ||
      !this.formData.gender
    ) return;

    if (!/^(0[35789])\d{8}$/.test(this.formData.phone)) return;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.formData.email)) { this.emailError = 'Vui lòng nhập email để nhận mã xác minh.'; return; }

    if (this.formData.password.length < 8) return;

    if (this.formData.password !== this.formData.confirmPassword) return;

    if (!this.formData.agreeTerms) return;

    const payload = {
      TEN: this.formData.fullName,
      GIOI_TINH: this.formData.gender,
      SDT: this.formData.phone,
      EMAIL: this.formData.email?.trim() || null,
      MAT_KHAU: this.formData.password
    };

    this.busy = true;
    this.registerService.register(payload).subscribe({
      next: (res: any) => {

        this.busy = false;
        this.needsVerification = true;
        this.sendVerification();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.busy = false;
        this.emailError = err.error?.message || 'Đăng ký chưa thành công.';
        console.error('Lỗi status:', err.status);
        console.error('Lỗi body:', err.error);

        if (err.status === 409) {
          const field = err.error?.field;
          const message = err.error?.message || '';
          if (field === 'phone') {
            this.phoneError = message;
          } else if (field === 'email') {
            this.emailError = message;
          }
          this.cdr.detectChanges();
        } else {
          console.error('Lỗi server không xác định:', err);
        }
      }
    });
  }

  closeSuccessPopup(): void {

    this.showSuccessPopup = false;

    window.dispatchEvent(
      new Event('auth-changed')
    );

    this.router.navigate(['/login']);

  }

  dismissSuccessPopup(): void {
    this.showSuccessPopup = false;
  }
}
