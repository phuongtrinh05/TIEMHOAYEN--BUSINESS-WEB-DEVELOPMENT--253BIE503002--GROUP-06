import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeader2 } from '../../components/page-header-2/page-header-2';
import { PageFooter2 } from '../../components/page-footer-2/page-footer-2';
@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, PageFooter2, PageHeader2],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.css'
})
export class ForgotPasswordComponent {

  showNewPassword = false;
  showConfirmPassword = false;

  formData = {
    newPassword: '',
    confirmPassword: ''
  };

  toggleNewPassword(): void {
    this.showNewPassword = !this.showNewPassword;
  }

  toggleConfirmPassword(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  onSubmit(): void {

    if (
      this.formData.newPassword !==
      this.formData.confirmPassword
    ) {
      return;
    }

    console.log('Đổi mật khẩu:', this.formData);

    alert('Đổi mật khẩu thành công! (Giả lập)');
  }
}