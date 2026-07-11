import { Component, Injectable  } from '@angular/core';

@Component({
  selector: 'app-employee-service',
  imports: [],
  templateUrl: './employee-service.html',
  styleUrl: './employee-service.css',
})
@Injectable({
  providedIn: 'root'
})
export class EmployeeService {
  employees = [
    {
      code: 'NV001',
      name: 'Phạm Ngọc Phương Trinh',
      email: 'trinhnpp123@gmail.com',
      phone: '0123456789',
      role: 'Admin',
      createdAt: '09/06/2026',
      status: 'Hoạt động',
      statusClass: 'active'
    },
    {
      code: 'NV002',
      name: 'Huỳnh Vũ Phúc Diễm',
      email: 'diemhvp123@gmail.com',
      phone: '0123456789',
      role: 'Nhân viên bán hàng',
      createdAt: '09/06/2026',
      status: 'Hoạt động',
      statusClass: 'active'
    },
    {
      code: 'NV003',
      name: 'Trần Võ Thiên Huy',
      email: 'huytv123@gmail.com',
      phone: '0123456789',
      role: 'Nhân viên bán hàng',
      createdAt: '09/06/2026',
      status: 'Hoạt động',
      statusClass: 'active'
    },
    {
      code: 'NV004',
      name: 'Hồ Thị Anh Thoa',
      email: 'thoah123@gmail.com',
      phone: '0123456789',
      role: 'Nhân viên giao hàng',
      createdAt: '09/06/2026',
      status: 'Bị khóa',
      statusClass: 'locked'
    },
    {
      code: 'NV005',
      name: 'Vày Thượng Thư',
      email: 'thuvt123@gmail.com',
      phone: '0123456789',
      role: 'Nhân viên Marketing',
      createdAt: '09/06/2026',
      status: 'Hoạt động',
      statusClass: 'active'
    },
    {
      code: 'NV006',
      name: 'Trần Thế Vinh',
      email: 'vinhtv123@gmail.com',
      phone: '0123456789',
      role: 'Nhân viên CSKH',
      createdAt: '09/06/2026',
      status: 'Hoạt động',
      statusClass: 'active'
    }
  ];
  
}
