import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink
  ],
  templateUrl: './contact.html',
  styleUrl: './contact.css'
})
export class Contact {

  fullName = '';
  phone = '';
  subject = '';
  message = '';
  showSubject = false;

  faqOpen: number | null = null;

  faqs = [
    {
      question: 'Tiệm Hoa Yên giao hoa trong bao lâu?',
      answer: 'Thông thường từ 1 - 3 giờ trong nội thành.'
    },
    {
      question: 'Tiệm Hoa Yên có giao hoa ngoại thành không?',
      answer: 'Có hỗ trợ giao ngoại thành.'
    },
    {
      question: 'Chính sách đổi trả như thế nào?',
      answer: 'Hỗ trợ đổi trả khi sản phẩm lỗi hoặc không đúng mẫu.'
    },
    {
      question: 'Tôi có thể hủy đơn hàng không?',
      answer: 'Có thể hủy trước khi cửa hàng thực hiện đơn.'
    },
    {
      question: 'Làm sao để biết đơn hàng được xác nhận?',
      answer: 'Nhân viên sẽ gọi điện hoặc gửi email xác nhận.'
    },
    {
      question: 'Tiệm Hoa Yên có xuất hóa đơn VAT không?',
      answer: 'Có hỗ trợ xuất hóa đơn VAT.'
    }
  ];

  // toggleFaq(index: number) {
  //   this.faqOpen =
  //     this.faqOpen === index ? null : index;
  // }

  sendContact() {
    alert('Thông tin đã được gửi.');
  }

  selectSubject(value: string){
    this.subject = value;
    this.showSubject = false;
  }
  constructor() {
  console.log('CONTACT CREATED');
}

toggleFaq(index: number) {

  console.log('FAQ CLICK', index);

  this.faqOpen =
    this.faqOpen === index
      ? null
      : index;
}
}
