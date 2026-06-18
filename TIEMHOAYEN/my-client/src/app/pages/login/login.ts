import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PageHeader2 } from '../../components/page-header-2/page-header-2';
import { PageFooter2 } from '../../components/page-footer-2/page-footer-2';
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageFooter2, PageHeader2],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginComponent {

  // Trạng thái hiện/ẩn mật khẩu
  showPassword = false;

  // Dữ liệu form
  formData = {
    phone: '',
    password: '',
    rememberMe: false,
  };

  /** Hiện/ẩn mật khẩu */
  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  /** Xử lý submit form đăng nhập */
  onSubmit(): void {
    // TODO: Gọi API đăng nhập khi có backend
    console.log('Dữ liệu đăng nhập:', this.formData);
    alert('Đăng nhập thành công! (Giả lập)');
  }

  /** Đăng nhập với Google */
  loginWithGoogle(): void {
    // TODO: Tích hợp Google OAuth khi có backend
    console.log('Đăng nhập với Google');
  }

  /** Đăng nhập với Facebook */
  loginWithFacebook(): void {
    // TODO: Tích hợp Facebook OAuth khi có backend
    console.log('Đăng nhập với Facebook');
  }
}
