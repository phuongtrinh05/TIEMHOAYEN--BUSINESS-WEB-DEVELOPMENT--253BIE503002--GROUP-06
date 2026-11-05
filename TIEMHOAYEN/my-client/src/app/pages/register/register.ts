import { Component, ChangeDetectorRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import {
  DEFAULT_PASSWORD_RULES, PasswordRule, RegisterService, passwordMeetsAllRules, passwordRuleMet
} from '../../services/register.service';

type FieldKey = 'name' | 'gender' | 'phone' | 'email' | 'password';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class RegisterComponent implements OnInit {

  constructor(
    private registerService: RegisterService,
    private cdr: ChangeDetectorRef,
    private router: Router,
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
        // Không còn bước xác minh email: đăng ký xong là dùng được ngay.
        next: () => { this.showSuccessPopup = true; },
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

  closeSuccessPopup(): void {
    this.showSuccessPopup = false;
    window.dispatchEvent(new Event('auth-changed'));
    this.router.navigate(['/login']);
  }

  dismissSuccessPopup(): void {
    this.showSuccessPopup = false;
  }
}
