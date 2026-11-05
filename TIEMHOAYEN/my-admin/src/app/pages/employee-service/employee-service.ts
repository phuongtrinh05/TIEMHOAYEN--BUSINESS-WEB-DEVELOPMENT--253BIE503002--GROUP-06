import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * AD54: Hồ sơ nhân viên và tài khoản đăng nhập được quản lý chung ở một màn hình
 * (Quản lý tài khoản quản trị). Trang cũ chỉ là dữ liệu giả nên chuyển hướng sang /admin-account.
 */
@Component({
  selector: 'app-employee-service',
  imports: [],
  templateUrl: './employee-service.html',
  styleUrl: './employee-service.css',
})
export class EmployeeService implements OnInit {
  private readonly router = inject(Router);

  ngOnInit(): void {
    void this.router.navigate(['/admin-account'], { replaceUrl: true });
  }
}
