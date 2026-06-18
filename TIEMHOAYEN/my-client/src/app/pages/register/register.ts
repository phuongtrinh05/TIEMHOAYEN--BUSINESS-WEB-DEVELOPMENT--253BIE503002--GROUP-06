import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PageHeader2 } from '../../components/page-header-2/page-header-2';
import { PageFooter2 } from '../../components/page-footer-2/page-footer-2';


@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageFooter2, PageHeader2],
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class RegisterComponent {

  // Trạng thái hiện/ẩn mật khẩu
  showPassword = false;
  showConfirmPassword = false;

  // Dữ liệu form
  formData = {
    fullName: '',
    gender: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
    agreeTerms: false,
  };

  /** Hiện/ẩn mật khẩu */
  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  /** Hiện/ẩn xác nhận mật khẩu */
  toggleConfirmPassword(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  /** Xử lý submit form đăng ký */
  onSubmit(): void {
    if (this.formData.password !== this.formData.confirmPassword) {
      alert('Mật khẩu xác nhận không khớp!');
      return;
    }

    if (!this.formData.agreeTerms) {
      alert('Vui lòng đồng ý với điều khoản và điều kiện!');
      return;
    }

    // TODO: Gọi API đăng ký khi có backend
    console.log('Dữ liệu đăng ký:', this.formData);
    alert('Đăng ký thành công! (Giả lập)');
  }
}
