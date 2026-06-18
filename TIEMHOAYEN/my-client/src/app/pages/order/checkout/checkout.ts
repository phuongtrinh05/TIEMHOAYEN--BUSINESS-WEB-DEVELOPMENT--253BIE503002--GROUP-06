import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageHeader } from '../../../components/page-header/page-header';
import { PageFooter } from '../../../components/page-footer/page-footer';

// =============================================
// DỮ LIỆU GIẢ LẬP — xóa/thay khi có backend
// =============================================
const MOCK_ORDER = {
  receiver: {
    name: 'Trần Thị B',
    phone: '0908 987 654',
    address: '123 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
  },
  sender: {
    name: 'Nguyễn Văn A',
    phone: '0909 123 456',
    email: 'nguyenvana@gmail.com',
  },
  delivery: {
    date: '20/06/2025',
    time: '09:00 - 11:00',
    message: 'Chúc mừng khai trương hồng phát!',
  },
  products: [
    {
      name: 'Melodious',
      qty: 1,
      price: 699000,
      image: 'assets/images/cart-melodious.png',
    },
    {
      name: 'Khai trương hồng phát',
      qty: 1,
      price: 1450000,
      image: 'assets/images/cart-khaitruonghongphat.png',
    },
    {
      name: 'Say đắm',
      qty: 1,
      price: 420000,
      image: 'assets/images/cart-saydam.png',
    },
  ],
  payment: {
    bank: 'MB Bank',
    accountNumber: '1234 5678 9x',
    accountName: 'Tiệm Hoa Yên',
    content: 'Thanh toán đơn #HD250620',
  },
  summary: {
    subtotal: 2569000,
    shipping: 30000,
    discount: 50000,
    total: 2549000,
  },
};
// =============================================

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, RouterLink, PageFooter, PageHeader],
  templateUrl: './checkout.html',
  styleUrl: './checkout.css',
})
export class CheckoutComponent {
  // TODO: Thay bằng dữ liệu thật từ service/API khi có backend
  order = MOCK_ORDER;
}
