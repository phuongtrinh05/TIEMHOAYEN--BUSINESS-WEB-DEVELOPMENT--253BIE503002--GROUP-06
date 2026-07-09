import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeader2 } from '../../components/page-header-2/page-header-2';
import { PageFooter2 } from '../../components/page-footer-2/page-footer-2';
import { ForgotPasswordService } from '../../services/forgot-password.service';
import { Router } from '@angular/router';
@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, PageFooter2, PageHeader2],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.css'
})
export class ForgotPasswordComponent {
  constructor(
  private forgotPasswordService:
  ForgotPasswordService, private router: Router
){

  this.phone =
    localStorage.getItem(
      'forgotPhone'
    ) || '';
}
  
  phone = '';
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

  this.forgotPasswordService
    .changePassword({

      SDT: this.phone,

      NEW_PASSWORD:
        this.formData.newPassword

    })
    .subscribe({

      next: (res) => {

        localStorage.removeItem(
          'forgotPhone'
        );

        this.router.navigate([
          '/login'
        ]);
      },

      error: (err) => {

        console.warn(
          err.error?.message
        );
      }
    });
}
}