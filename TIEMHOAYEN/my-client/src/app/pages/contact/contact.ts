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
      answer: 'Thời gian giao hoa phụ thuộc vào địa điểm nhận hàng và khung giờ khách hàng lựa chọn. Đối với khu vực nội thành, đơn hàng thường được giao trong khoảng 1–3 giờ sau khi được xác nhận. Với các đơn đặt trước theo ngày hoặc giờ cụ thể, Tiệm Hoa Yên sẽ chuẩn bị và giao đúng thời gian đã hẹn để đảm bảo hoa luôn tươi mới khi đến tay người nhận. Trong các dịp lễ cao điểm như 8/3, 20/10, Valentine hoặc Tết, thời gian giao hàng có thể kéo dài hơn dự kiến. Chúng tôi luôn chủ động liên hệ với khách hàng nếu có bất kỳ thay đổi nào.',
    },
    {
      question: 'Tiệm Hoa Yên có giao hoa ngoại thành không?',
      answer: 'Có. Tiệm Hoa Yên hỗ trợ giao hoa đến nhiều khu vực ngoại thành và các quận, huyện lân cận. Phí giao hàng sẽ được tính dựa trên khoảng cách và địa điểm nhận hoa. Đối với những khu vực ở xa trung tâm hoặc ngoài phạm vi hỗ trợ thông thường, đội ngũ nhân viên sẽ liên hệ để tư vấn thời gian giao hàng và báo phí vận chuyển trước khi xác nhận đơn. Chúng tôi luôn cố gắng mang đến dịch vụ giao hoa nhanh chóng, an toàn và đảm bảo chất lượng sản phẩm.',
    },
    {
      question: 'Chính sách đổi trả như thế nào?',
      answer: 'Tiệm Hoa Yên luôn đặt chất lượng sản phẩm và sự hài lòng của khách hàng lên hàng đầu. Nếu sản phẩm giao không đúng mẫu đã đặt, bị hư hỏng trong quá trình vận chuyển hoặc không đúng thông tin người nhận, khách hàng vui lòng liên hệ với chúng tôi trong vòng 24 giờ kể từ khi nhận hàng để được hỗ trợ đổi hoặc hoàn tiền theo chính sách. Đối với các trường hợp thay đổi ý định sau khi hoa đã được chuẩn bị hoặc giao thành công, rất mong quý khách thông cảm vì chúng tôi sẽ không thể áp dụng chính sách đổi trả.',
    },
    {
      question: 'Tôi có thể hủy đơn hàng không?',
      answer: 'Khách hàng có thể hủy đơn hàng trước khi đơn được xác nhận hoặc trước khi cửa hàng bắt đầu thực hiện cắm hoa. Sau khi đơn hàng đã được chuẩn bị hoặc đang trong quá trình giao, việc hủy đơn có thể không được chấp nhận hoặc sẽ phát sinh một khoản chi phí tùy theo tình trạng xử lý của đơn hàng. Nếu cần thay đổi hoặc hủy đơn, quý khách vui lòng liên hệ với Tiệm Hoa Yên trong thời gian sớm nhất để được hỗ trợ nhanh chóng.',
    },
    {
      question: 'Làm sao để biết đơn hàng được xác nhận?',
      answer: 'Sau khi đặt hàng thành công, khách hàng sẽ nhận được thông báo xác nhận qua email, số điện thoại hoặc tài khoản trên website (nếu đã đăng nhập). Ngoài ra, khách hàng có thể sử dụng chức năng Tra cứu đơn hàng trên website để theo dõi trạng thái đơn theo thời gian thực. Nếu sau một thời gian vẫn chưa nhận được xác nhận, vui lòng liên hệ với Tiệm Hoa Yên để chúng tôi kiểm tra và hỗ trợ kịp thời.',
    },
    {
      question: 'Tiệm Hoa Yên có xuất hóa đơn VAT không?',
      answer: 'Có. Tiệm Hoa Yên hỗ trợ xuất hóa đơn VAT theo yêu cầu của khách hàng. Khi đặt hàng, quý khách chỉ cần cung cấp đầy đủ thông tin xuất hóa đơn như tên công ty, mã số thuế, địa chỉ và email nhận hóa đơn. Hóa đơn điện tử sẽ được phát hành và gửi đến email của khách hàng sau khi đơn hàng được thanh toán thành công theo đúng quy định hiện hành. Nếu cần hỗ trợ về thủ tục xuất hóa đơn, đội ngũ chăm sóc khách hàng luôn sẵn sàng giải đáp.',
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
      this.showError('Vui lòng nhập đầy đủ thông tin liên hệ');
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
