import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './contact.html',
  styleUrl: './contact.css',
})
export class Contact {
  private readonly contactApiUrl = 'http://localhost:3000/api/contacts';
  private readonly requestTimeoutMs = 10000;
  private readonly cdr = inject(ChangeDetectorRef);

  fullName = '';
  phone = '';
  subject = '';
  message = '';
  showSubject = false;

  // Giữ cả 2 tên biến để tương thích với các bản contact.html cũ/mới.
  isSending = false;
  isSubmitting = false;

  submitMessage = '';
  submitSuccess = false;
  contactSuccessMessage = '';
  contactErrorMessage = '';

  faqOpen: number | null = null;

  faqs = [
    {
      question: 'Tiệm Hoa Yên giao hoa trong bao lâu?',
      answer: 'Thông thường từ 1 - 3 giờ trong nội thành.',
    },
    {
      question: 'Tiệm Hoa Yên có giao hoa ngoại thành không?',
      answer: 'Có hỗ trợ giao ngoại thành.',
    },
    {
      question: 'Chính sách đổi trả như thế nào?',
      answer: 'Hỗ trợ đổi trả khi sản phẩm lỗi hoặc không đúng mẫu.',
    },
    {
      question: 'Tôi có thể hủy đơn hàng không?',
      answer: 'Có thể hủy trước khi cửa hàng thực hiện đơn.',
    },
    {
      question: 'Làm sao để biết đơn hàng được xác nhận?',
      answer: 'Nhân viên sẽ gọi điện hoặc gửi email xác nhận.',
    },
    {
      question: 'Tiệm Hoa Yên có xuất hóa đơn VAT không?',
      answer: 'Có hỗ trợ xuất hóa đơn VAT.',
    },
  ];

  selectSubject(value: string): void {
    this.subject = value;
    this.showSubject = false;
  }

  toggleFaq(index: number): void {
    this.faqOpen = this.faqOpen === index ? null : index;
  }

  async sendContact(): Promise<void> {
    if (this.isSending || this.isSubmitting) {
      return;
    }

    const fullName = this.fullName.trim();
    const phoneOrEmail = this.phone.trim();
    const subject = this.subject.trim();
    const message = this.message.trim();

    this.clearMessages();

    if (!fullName || !phoneOrEmail || !subject || !message) {
      this.showError('Vui lòng nhập đầy đủ thông tin liên hệ.');
      return;
    }

    this.setLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(this.contactApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          // Các tên field frontend/backend có thể dùng.
          fullName,
          hoTen: fullName,

          phoneOrEmail,
          contactInfo: phoneOrEmail,
          phone: phoneOrEmail,
          email: phoneOrEmail,

          subject,
          chuDe: subject,

          message,
          noiDung: message,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.message || `Không thể gửi liên hệ. Mã lỗi: ${response.status}`);
      }

      this.showSuccess(
        data?.message || 'Gửi liên hệ thành công. Tiệm Hoa Yên sẽ phản hồi bạn sớm nhất!'
      );
      this.resetForm();
    } catch (error: any) {
      console.error('Lỗi gửi liên hệ:', error);

      if (error?.name === 'AbortError') {
        this.showError('Backend không phản hồi sau 10 giây. Hãy kiểm tra my-server đã chạy chưa.');
      } else {
        this.showError(error?.message || 'Không thể gửi liên hệ. Vui lòng thử lại.');
      }
    } finally {
      clearTimeout(timeoutId);
      this.setLoading(false);
    }
  }

  private setLoading(value: boolean): void {
    this.isSending = value;
    this.isSubmitting = value;
    this.cdr.detectChanges();
  }

  private clearMessages(): void {
    this.submitMessage = '';
    this.submitSuccess = false;
    this.contactSuccessMessage = '';
    this.contactErrorMessage = '';
  }

  private showSuccess(message: string): void {
    this.submitSuccess = true;
    this.submitMessage = message;
    this.contactSuccessMessage = message;
    this.contactErrorMessage = '';
    this.cdr.detectChanges();
  }

  private showError(message: string): void {
    this.submitSuccess = false;
    this.submitMessage = message;
    this.contactErrorMessage = message;
    this.contactSuccessMessage = '';
    this.cdr.detectChanges();
  }

  private resetForm(): void {
    this.fullName = '';
    this.phone = '';
    this.subject = '';
    this.message = '';
    this.showSubject = false;
  }
}
