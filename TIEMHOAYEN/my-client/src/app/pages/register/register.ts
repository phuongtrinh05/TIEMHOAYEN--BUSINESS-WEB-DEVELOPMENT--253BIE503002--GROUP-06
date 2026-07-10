import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PageHeader2 } from '../../components/page-header-2/page-header-2';
import { PageFooter2 } from '../../components/page-footer-2/page-footer-2';
import { RegisterService } from '../../services/register.service';

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
    private router: Router
    
  ) { }

  showPassword = false;
  showConfirmPassword = false;
  submitted = false;
  showSuccessPopup = false;
  phoneError = '';
  emailError = '';

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

    if (this.formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.formData.email)) return;

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

    this.registerService.register(payload).subscribe({
      next: (res: any) => {

        // Lưu thông tin khách hàng
        localStorage.setItem(
          'khachHang',
          JSON.stringify(res.customer)
        );

        if (res.token) {
          localStorage.setItem(
            'token',
            res.token
          );
        }

        // Hiện popup thành công
        this.showSuccessPopup = true;
        this.cdr.detectChanges();
      },
      error: (err) => {
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

    this.router.navigate(['/homepage']);

  }

  dismissSuccessPopup(): void {
    this.showSuccessPopup = false;
  }
}
