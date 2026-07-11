import { Component, ElementRef, ViewChild, ChangeDetectorRef, NgZone, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { take } from 'rxjs/operators';

interface Message {
  id?: string;
  role: 'bot' | 'user';
  content: string;
  type: 'text';
  time: string;
  imageUrl?: string;
}

interface ServerChatMessage {
  id: string;
  role: 'bot' | 'user';
  content: string;
  time: string;
  imageUrl?: string | null;
  type?: string | null;
}

interface ProductChatContext {
  productId: string | null;
  productInfo: Record<string, unknown> | null;
}

interface OrderChatContext {
  orderId: string | null;
}

interface ChatImagePayload {
  name: string;
  type: string;
  dataUrl: string;
}

interface GuestContactForm {
  name: string;
  phone: string;
  email: string;
}

@Component({
  selector: 'app-chatbot-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chatbot-widget.html',
  styleUrl: './chatbot-widget.css'
})
export class ChatbotWidget implements OnInit, OnDestroy {

  @ViewChild('chatBody') chatBody!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  isOpen = false;
  inputText = '';
  isLoading = false;
  loadingText = 'Dang xu ly...';
  private isSending = false;

  private webhookUrl = 'https://tiem-hoa-yen-api.onrender.com/api/chats';
  private handoffUrl = 'https://tiem-hoa-yen-api.onrender.com/api/chats/handoff';
  private customerMessagesUrl = 'https://tiem-hoa-yen-api.onrender.com/api/chats/customer';
  private guestMessagesUrl = 'https://tiem-hoa-yen-api.onrender.com/api/chats/guest';
  private readonly productContextKey = 'tiemHoaYenCurrentProductContext';
  private readonly guestConversationKey = 'tiemHoaYenGuestConversationId';
  private readonly maxImageSizeBytes = 5 * 1024 * 1024;
  private readonly maxImageDimension = 1280;
  private syncTimer: number | null = null;
  private syncedServerMessageIds = new Set<string>();
  private pendingGuestText = 'Liên hệ nhân viên';
  private pendingGuestImage: ChatImagePayload | null = null;

  showGuestContactForm = false;
  guestContact: GuestContactForm = {
    name: '',
    phone: '',
    email: ''
  };

  messages: Message[] = [
    {
      role: 'bot',
      content: 'Chào bạn! 🌸 Tiệm Hoa Yên rất vui được hỗ trợ bạn. Bạn đang cần mình giúp gì ạ?',
      type: 'text',
      time: this.getTime()
    }
  ];

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Staff-message polling will be enabled when the matching backend GET
    // endpoints are available. Direct n8n replies are handled by sendMessage().
  }

  ngOnDestroy(): void {
    if (this.syncTimer !== null) {
      window.clearInterval(this.syncTimer);
    }
  }

  openChat(): void { this.isOpen = true; }
  closeChat(): void { this.isOpen = false; }

  getTime(): string {
    return new Date().toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  scrollToBottom(): void {
    setTimeout(() => {
      if (this.chatBody) {
        this.chatBody.nativeElement.scrollTop =
          this.chatBody.nativeElement.scrollHeight;
      }
    }, 100);
  }

  private getCustomerId(): string | null {
    const rawCustomer = localStorage.getItem('khachHang');

    if (!rawCustomer || rawCustomer === 'null' || rawCustomer === 'undefined') {
      return null;
    }

    try {
      const customer = JSON.parse(rawCustomer);
      return customer?.KHACH_HANG_ID ? String(customer.KHACH_HANG_ID) : null;
    } catch {
      return null;
    }
  }

  private getGuestConversationId(): string | null {
    const chatId = localStorage.getItem(this.guestConversationKey);
    return chatId && chatId !== 'null' && chatId !== 'undefined' ? chatId : null;
  }

  private setGuestConversationId(chatId: unknown): void {
    const value = String(chatId || '').trim();
    if (value) {
      localStorage.setItem(this.guestConversationKey, value);
    }
  }

  private normalizeVietnamese(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd');
  }

  private isHumanContactRequest(text: string): boolean {
    const normalized = this.normalizeVietnamese(text);
    return normalized.includes('lien he nhan vien') ||
      normalized.includes('lien he') ||
      normalized.includes('nhan vien') ||
      normalized.includes('gap nhan vien') ||
      normalized.includes('tu van') ||
      normalized.includes('nhan vien ho tro');
  }

  private getProductContext(): ProductChatContext {
    const match = this.router.url.match(/\/product-detail\/([^/?#]+)/);

    if (!match) {
      return { productId: null, productInfo: null };
    }

    const routeProductId = decodeURIComponent(match[1]);
    const fallbackInfo = { SAN_PHAM_ID: routeProductId };
    const rawContext = localStorage.getItem(this.productContextKey);

    if (!rawContext) {
      return { productId: routeProductId, productInfo: fallbackInfo };
    }

    try {
      const context = JSON.parse(rawContext);
      const contextProductId = String(
        context?.productId || context?.productInfo?.SAN_PHAM_ID || ''
      );

      if (contextProductId !== routeProductId) {
        return { productId: routeProductId, productInfo: fallbackInfo };
      }

      return {
        productId: routeProductId,
        productInfo: context?.productInfo || fallbackInfo
      };
    } catch {
      return { productId: routeProductId, productInfo: fallbackInfo };
    }
  }

  private getOrderContext(): OrderChatContext {
    const match = this.router.url.match(/\/order-detail\/([^/?#]+)/);

    if (!match) {
      return { orderId: null };
    }

    return { orderId: decodeURIComponent(match[1]) };
  }

  private getSelectedImagePayload(): ChatImagePayload | null {
    if (!this.selectedFile || !this.selectedImageDataUrl) {
      return null;
    }

    return {
      name: this.selectedFile.name,
      type: this.selectedFile.type,
      dataUrl: this.selectedImageDataUrl
    };
  }

  private getLoadingText(message: string, hasImageAttachment: boolean): string {
    if (hasImageAttachment) {
      return 'Dang chuyen nhan vien...';
    }

    const normalized = message.toLowerCase();
    const likelyImageRequest =
      normalized.includes('tao') ||
      normalized.includes('mau') ||
      normalized.includes('hinh') ||
      normalized.includes('anh');

    return likelyImageRequest ? 'Dang tao anh...' : 'Dang tra loi...';
  }

  private syncCustomerReplies(): void {
    const customerId = this.getCustomerId();
    const guestConversationId = this.getGuestConversationId();
    const syncUrl = customerId
      ? `${this.customerMessagesUrl}/${encodeURIComponent(customerId)}/messages`
      : guestConversationId
        ? `${this.guestMessagesUrl}/${encodeURIComponent(guestConversationId)}/messages`
        : null;

    if (!syncUrl) {
      return;
    }

    this.http
      .get<{ messages: ServerChatMessage[] }>(syncUrl)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          const newServerMessages = (res?.messages || []).filter(
            (msg) =>
              (msg.type === 'human_request' || msg.type === 'staff_reply') &&
              !this.syncedServerMessageIds.has(msg.id)
          );

          if (!newServerMessages.length) {
            return;
          }

          newServerMessages.forEach((msg) => {
            this.syncedServerMessageIds.add(msg.id);
            this.messages.push({
              id: msg.id,
              role: msg.role,
              content: msg.content || '',
              imageUrl: msg.imageUrl || undefined,
              type: 'text',
              time: msg.time || this.getTime()
            });
          });

          this.cdr.detectChanges();
          this.scrollToBottom();
        },
        error: (error) => {
          console.warn('Khong dong bo duoc tin nhan chat:', error);
        }
      });
  }

  private saveHandoffMessage(payload: Record<string, unknown>): void {
    this.http.post<any>(this.handoffUrl, payload).pipe(take(1)).subscribe({
      next: (res) => {
        this.zone.run(() => {
          this.isLoading = false;
          this.isSending = false;
          if (!this.getCustomerId()) {
            this.setGuestConversationId(res?.chatId);
          }
          if (res?.chatId) {
            this.syncedServerMessageIds.add(String(res.chatId));
          }

          this.messages.push({
            role: 'bot',
            content: res?.imageSaved === false
              ? 'Mình đã chuyển yêu cầu cho nhân viên, nhưng database chưa có cột lưu ảnh nên ảnh chưa được lưu.'
              : 'Mình đã chuyển yêu cầu kèm hình ảnh cho nhân viên. Nhân viên Tiệm Hoa Yên sẽ phản hồi bạn sớm nhất nhé!',
            type: 'text',
            time: this.getTime()
          });

          this.cdr.detectChanges();
          this.scrollToBottom();
        });
      },
      error: (error) => {
        console.error('Khong luu duoc yeu cau kem hinh anh:', error);
        this.zone.run(() => {
          this.isLoading = false;
          this.isSending = false;

          this.messages.push({
            role: 'bot',
            content: 'Xin lỗi, mình chưa lưu được yêu cầu kèm hình ảnh. Bạn thử lại nhé!',
            type: 'text',
            time: this.getTime()
          });

          this.cdr.detectChanges();
          this.scrollToBottom();
        });
      }
    });
  }

  private openGuestContactForm(text: string, imagePayload: ChatImagePayload | null = null): void {
    this.pendingGuestText = text || 'Liên hệ nhân viên';
    this.pendingGuestImage = imagePayload;
    this.showGuestContactForm = true;
    this.isOpen = true;
    this.isLoading = false;
    this.isSending = false;
    this.cdr.detectChanges();
  }

  closeGuestContactForm(): void {
    this.showGuestContactForm = false;
    this.pendingGuestImage = null;
  }

  submitGuestContactForm(): void {
    const name = this.guestContact.name.trim();
    const phone = this.guestContact.phone.trim();

    if (!name || !phone) {
      alert('Vui lòng nhập tên và số điện thoại để nhân viên liên hệ.');
      return;
    }

    const productContext = this.getProductContext();
    const orderContext = this.getOrderContext();
    const imagePayload = this.pendingGuestImage;
    const userText = this.pendingGuestText || 'Liên hệ nhân viên';

    this.showGuestContactForm = false;
    this.inputText = '';
    this.clearSelectedFile();
    this.isLoading = true;
    this.isSending = true;
    this.loadingText = 'Dang chuyen nhan vien...';

    this.messages.push({
      role: 'user',
      content: userText,
      imageUrl: imagePayload?.dataUrl,
      type: 'text',
      time: this.getTime()
    });

    this.saveHandoffMessage({
      chatInput: userText,
      customerId: null,
      productId: productContext.productId,
      productInfo: productContext.productInfo,
      orderId: orderContext.orderId,
      image: imagePayload,
      imageDataUrl: imagePayload?.dataUrl || null,
      imageName: imagePayload?.name || null,
      imageType: imagePayload?.type || null,
      guestName: name,
      guestPhone: phone,
      guestEmail: this.guestContact.email.trim() || null
    });

    this.pendingGuestImage = null;
    this.cdr.detectChanges();
    this.scrollToBottom();
  }

  private parseWebhookResponse(response: any): { reply: string; imageUrl?: string } {
    let reply = '';
    let imageUrl = '';
    const visited = new Set<any>();

    const visit = (value: any): void => {
      if (value === null || value === undefined || visited.has(value)) return;

      if (typeof value === 'string') {
        const text = value.trim();
        if (!text) return;

        if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
          try {
            visit(JSON.parse(text));
            return;
          } catch {
            // This is a regular text reply, not serialized JSON.
          }
        }
        return;
      }

      if (typeof value !== 'object') return;
      visited.add(value);

      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }

      const textCandidate =
        value.output ?? value.reply ?? value.message ?? value.text ?? value.content?.parts?.[0]?.text;
      const imageCandidate = value.image_url ?? value.imageUrl ?? value.image;

      if (!reply && typeof textCandidate === 'string') reply = textCandidate.trim();
      if (!imageUrl && typeof imageCandidate === 'string') imageUrl = imageCandidate.trim();

      Object.values(value).forEach(visit);
    };

    visit(response);
    return { reply, imageUrl: imageUrl || undefined };
  }

  sendMessage(): void {
    const imagePayload = this.getSelectedImagePayload();

    if ((!this.inputText.trim() && !imagePayload) || this.isLoading || this.isSending) return;

    this.isSending = true;
    const userText = this.inputText.trim();
    const userMsg = userText || 'Khach hang da gui hinh anh';

    if (imagePayload && !this.getCustomerId()) {
      this.openGuestContactForm(userMsg, imagePayload);
      return;
    }

    this.loadingText = this.getLoadingText(userMsg, !!imagePayload);
    this.inputText = '';

    this.messages.push({
      role: 'user',
      content: userText,
      imageUrl: imagePayload?.dataUrl,
      type: 'text',
      time: this.getTime()
    });

    this.clearSelectedFile();

    this.isLoading = true;
    this.cdr.detectChanges();
    this.scrollToBottom();

    const productContext = this.getProductContext();
    const orderContext = this.getOrderContext();

    const payload = {
      chatInput: userMsg,
      customerId: this.getCustomerId(),
      productId: productContext.productId,
      productInfo: productContext.productInfo,
      orderId: orderContext.orderId,
      image: imagePayload,
      imageDataUrl: imagePayload?.dataUrl || null,
      imageName: imagePayload?.name || null,
      imageType: imagePayload?.type || null
    };

    if (imagePayload) {
      this.saveHandoffMessage(payload);
      return;
    }

    this.http.post<any>(this.webhookUrl, payload).pipe(take(1)).subscribe({
      next: (res) => {
        this.zone.run(() => {
          this.isLoading = false;
          this.isSending = false;
          console.log('Response:', res);
          const { reply, imageUrl } = this.parseWebhookResponse(res);

          this.messages.push({
            role: 'bot',
            content: reply || '',
            imageUrl: imageUrl,
            type: 'text',
            time: this.getTime()
            
          });

          this.cdr.detectChanges();
          this.scrollToBottom();
        });
      },
      error: () => {
        this.zone.run(() => {
          this.isLoading = false;
          this.isSending = false;
          this.messages.push({
            role: 'bot',
            content: 'Xin lỗi, mình đang gặp sự cố. Bạn thử lại nhé! 🌸',
            type: 'text',
            time: this.getTime()
          });
          this.cdr.detectChanges();
          this.scrollToBottom();
        });
      }
    });
  }

  sendQuickAction(text: string): void {
    if (this.isLoading || this.isSending) return;

    if (!this.getCustomerId() && this.isHumanContactRequest(text)) {
      this.openGuestContactForm(text);
      return;
    }

    this.inputText = text;
    this.sendMessage();
  }

  autoResize(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    const maxHeight = 120;
    if (el.scrollHeight >= maxHeight) {
      el.style.height = maxHeight + 'px';
      el.style.overflowY = 'auto';
    } else {
      el.style.height = el.scrollHeight + 'px';
      el.style.overflowY = 'hidden';
    }
  }

  onEnter(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
      setTimeout(() => {
        const ta = document.querySelector('.chat-input textarea') as HTMLTextAreaElement;
        if (ta) { ta.style.height = 'auto'; }
      }, 0);
    }
  }

  selectedFile: File | null = null;
  selectedImageDataUrl: string | null = null;

  clearSelectedFile(): void {
    this.selectedFile = null;
    this.selectedImageDataUrl = null;
  }

  private compressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => reject(new Error('Khong doc duoc file anh.'));
      reader.onload = () => {
        const img = new Image();

        img.onerror = () => reject(new Error('Khong xu ly duoc file anh.'));
        img.onload = () => {
          const scale = Math.min(
            1,
            this.maxImageDimension / Math.max(img.width, img.height)
          );
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Khong tao duoc canvas anh.'));
            return;
          }

          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };

        img.src = String(reader.result || '');
      };

      reader.readAsDataURL(file);
    });
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Vui long chon file anh.');
      event.target.value = '';
      return;
    }

    if (file.size > this.maxImageSizeBytes) {
      alert('Anh qua lon. Vui long chon anh duoi 5MB.');
      event.target.value = '';
      return;
    }

    this.selectedFile = file;
    this.compressImage(file)
      .then((dataUrl) => {
        this.selectedImageDataUrl = dataUrl;
        this.cdr.detectChanges();
      })
      .catch((error) => {
        console.error('Khong xu ly duoc anh dinh kem:', error);
        alert('Khong xu ly duoc anh. Ban thu chon anh khac nhe.');
        this.clearSelectedFile();
      })
      .finally(() => {
        this.cdr.detectChanges();
        event.target.value = '';
      });
  }
}
