import { apiBaseUrl, orderAccessSession } from '../../services/api-config';
import { SupportChatService } from '../../services/support-chat.service';
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './contact.html',
  styleUrl: './contact.css',
})
export class Contact implements OnInit {
  private http=inject(HttpClient);
  fieldErrors: Record<string,string> = {};
  ngOnInit() { this.http.get<any[]>(apiBaseUrl()+'/faqs/public').subscribe({next:rows=>{this.faqs=rows.map(r=>({question:r.CAU_HOI,answer:r.CAU_TRA_LOI}));this.cdr.markForCheck();},error:()=>{this.faqs=[];this.cdr.markForCheck();}}); }
  private pendingRequest: {fingerprint:string;id:string}|null=null;
  private get contactApiUrl() { return `${apiBaseUrl()}/contacts`; }
  private readonly support = inject(SupportChatService);
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

  faqs: {question:string;answer:string}[] = [];

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
      this.fieldErrors={};if(!fullName)this.fieldErrors['name']='Vui lòng nhập họ tên.';if(!phoneOrEmail)this.fieldErrors['phone']='Vui lòng nhập SĐT hoặc email.';if(!subject)this.fieldErrors['subject']='Chọn chủ đề.';if(!message)this.fieldErrors['message']='Nhập nội dung yêu cầu.';
      this.showError('Vui lòng nhập đầy đủ thông tin liên hệ');
      return;
    }

    this.fieldErrors={};
    if(fullName.length>100)this.fieldErrors['name']='Tối đa 100 ký tự.';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(phoneOrEmail)&&!/^(?:0\d{9}|\+84\d{9})$/.test(phoneOrEmail.replace(/[ .-]/g,'')))this.fieldErrors['phone']='Nhập đúng SĐT hoặc email.';
    if(message.length>2000)this.fieldErrors['message']='Tối đa 2000 ký tự.';
    if(Object.keys(this.fieldErrors).length){this.showError('Kiểm tra các trường được đánh dấu.');return;}
    const fingerprint=JSON.stringify({fullName,phoneOrEmail,subject,message});
    try { this.pendingRequest=JSON.parse(sessionStorage.getItem('pendingContactRequest')||'null'); }catch{}
    if(this.pendingRequest?.fingerprint!==fingerprint)this.pendingRequest={fingerprint,id:crypto.randomUUID()};
    sessionStorage.setItem('pendingContactRequest',JSON.stringify(this.pendingRequest));
    this.setLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(this.contactApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
            ...(orderAccessSession() ? {'x-order-access': orderAccessSession()!.accessToken} : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({fullName,phoneOrEmail,subject,message,clientRequestId:this.pendingRequest!.id        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.message || `Không thể gửi liên hệ. Mã lỗi: ${response.status}`);
      }

      if (data.support) this.support.save(data.support, true);
      this.showSuccess(
        data?.message || 'Gửi liên hệ thành công. Tiệm Hoa Yên sẽ phản hồi bạn sớm nhất!'
      );
      sessionStorage.removeItem('pendingContactRequest');this.pendingRequest=null;
      this.resetForm();
    } catch (error: any) {
      console.error('Lỗi gửi liên hệ:', error);

      if (error?.name === 'AbortError') {
        this.showError('Chưa nhận được phản hồi. Bạn thử gửi lại; hệ thống sẽ tránh tạo trùng yêu cầu.');
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
