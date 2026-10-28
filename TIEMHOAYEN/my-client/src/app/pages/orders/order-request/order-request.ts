import { ChangeDetectorRef, Component, inject, Input, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { OrderAccessService } from '../../../services/order-access.service';
import { OrderService } from '../../../services/order.service';

@Component({ selector: 'app-order-request', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './order-request.html', styleUrl: './order-request.css' })
export class OrderRequest implements OnInit, OnDestroy {
  @Input() requestId = '';
  @Input() compact = false;
  private route = inject(ActivatedRoute);
  private service = inject(OrderService);
  private access = inject(OrderAccessService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  request: any; messages: any[] = []; error = ''; message = ''; confirmed = false; loading = false; busy = false;
  feedback = ''; showSchedule = false; requestedDate = ''; requestedTime = ''; cancelConfirmation = false;
  private token = ''; private id = ''; private timer?: ReturnType<typeof setInterval>;
  private pendingMessage: { text: string; id: string } | null = null;
  ngOnInit() {
    if (typeof localStorage === 'undefined') return;
    this.id = this.requestId || this.route.snapshot.paramMap.get('id') || '';
    this.token = this.access.session?.accessToken || '';
    if (!this.token) this.error = 'Vui lòng xác minh số điện thoại người đặt bằng OTP để xem yêu cầu.';
    this.load();
    this.timer = setInterval(() => { if (!this.busy && !document.hidden) this.load(true); }, 10000);
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }
  image(url: string) { return this.service.assetUrl(url); }
  get canChange() { return this.request && !['Đã lên đơn','Đã từ chối','Đã tư vấn','Khách đã hủy'].includes(this.request.status); }
  editSchedule() {
    const delivery = this.request.quote?.delivery || this.request.delivery;
    this.requestedDate = /^\d{2}\/\d{2}\/\d{4}$/.test(delivery.date || '') ? delivery.date.split('/').reverse().join('-') : delivery.date || '';
    this.requestedTime = String(delivery.time || '').match(/\b\d{2}:\d{2}\b/)?.[0] || ''; this.showSchedule = !this.showSchedule;
  }
  change(action: string) {
    if (this.busy || !this.canChange || action === 'cancel' && !this.cancelConfirmation) return;
    this.busy = true; this.error = ''; this.feedback = '';
    this.service.updateSalesRequest(this.id, this.token, { action, date: this.requestedDate, time: this.requestedTime }).subscribe({
      next: value => { this.request = value; this.busy = false; this.showSchedule = false; this.cancelConfirmation = false; this.confirmed = false;
        this.feedback = action === 'cancel' ? 'Đã dừng yêu cầu.' : 'Đã gửi lịch mới để shop kiểm tra lại.'; this.cdr.markForCheck(); },
      error: err => { this.error = err?.error?.message || 'Chưa cập nhật được yêu cầu.'; this.busy = false; this.cdr.markForCheck(); },
    });
  }
  load(quiet = false) {
    this.token = this.access.session?.accessToken || '';
    if (!this.token) { this.request = null; this.messages = []; this.error = 'Phiên tra cứu đã kết thúc. Vui lòng xác minh OTP lại.'; return; }
    if (this.loading) return;
    this.loading = true; if (!quiet) this.error = '';
    this.service.getSalesRequest(this.id, this.token).subscribe({
      next: value => { if (value.quote?.id !== this.request?.quote?.id) this.confirmed = false; this.request = value; this.loading = false; this.cdr.markForCheck(); },
      error: err => { if ([401,404].includes(err.status)) { this.request = null; this.messages = []; } this.error = err?.error?.message || 'Chưa tải được trạng thái. Vui lòng thử lại.'; this.loading = false; this.cdr.markForCheck(); },
    });
    this.service.getRequestMessages(this.id, this.token).subscribe({ next: value => { this.messages = value; this.cdr.markForCheck(); }, error: () => {} });
  }
  respond(action: string) {
    if (this.busy || !this.request?.quote || action === 'accept' && !this.confirmed) return;
    this.busy = true; this.error = '';
    this.service.respondSalesRequest(this.id, this.token, this.request.quote.id, action).subscribe({
      next: value => { this.request = value; this.busy = false; this.cdr.markForCheck(); },
      error: err => { this.error = err?.error?.message || 'Chưa gửi được xác nhận.'; this.busy = false; this.cdr.markForCheck(); },
    });
  }
  send() {
    if (this.busy || !this.message.trim()) return;
    const content = this.message.trim();
    if (this.pendingMessage?.text !== content) this.pendingMessage = { text: content, id: crypto.randomUUID() };
    this.busy = true; this.error = '';
    this.service.sendRequestMessage(this.id, this.token, content, this.pendingMessage!.id).subscribe({
      next: () => { this.message = ''; this.pendingMessage = null; this.busy = false; this.load(); this.cdr.markForCheck(); },
      error: err => { this.error = err?.error?.message || 'Chưa gửi được tin nhắn.'; this.busy = false; this.cdr.markForCheck(); },
    });
  }
  checkout() {
    if (!this.request?.checkoutData || !this.request?.orderResult) return;
    const data = this.request.checkoutData, created = this.request.orderResult;
    if (created.checkoutAccessToken) sessionStorage.setItem(`checkoutOrderAccess:${created.orderId}`, created.checkoutAccessToken);
    const source = data.customerId ? 'registrant' : 'guest';
    const stored = { ...data, subtotal: data.summary.subtotal, shippingFee: data.summary.shippingFee, total: data.summary.total,
      depositAmount: data.summary.depositAmount, remainingAmount: data.summary.total - created.paymentAmount };
    localStorage.setItem('tiemHoaYenCreatedOrder', JSON.stringify({ ...created, source, customerId: data.customerId }));
    localStorage.setItem(source === 'guest' ? 'tiemHoaYenGuestOrder' : 'tiemHoaYenRegistrantOrder', JSON.stringify(stored));
    this.router.navigate(['/checkout']);
  }
}
