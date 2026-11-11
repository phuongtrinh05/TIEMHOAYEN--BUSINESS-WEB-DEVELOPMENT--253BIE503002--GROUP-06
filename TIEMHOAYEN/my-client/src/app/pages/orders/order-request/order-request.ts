import { ChangeDetectorRef, Component, inject, Input, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { OrderAccessService } from '../../../services/order-access.service';
import { OrderService } from '../../../services/order.service';
import { Subscription } from 'rxjs';
import { requestStatusTone } from '../request-status-tone';

@Component({ selector: 'app-order-request', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './order-request.html', styleUrls: ['./order-request.css', './order-request-refinement.css', '../request-status-tone.css'] })
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
  readOnly = false;
  private token = ''; private id = ''; private timer?: ReturnType<typeof setInterval>;
  private pendingMessage: { text: string; id: string } | null = null;
  private requestEvents?: Subscription;
  private refreshPending = false;
  readonly requestStatusTone = requestStatusTone;
  ngOnInit() {
    if (typeof localStorage === 'undefined') return;
    this.id = this.requestId || this.route.snapshot.paramMap.get('id') || '';
    this.readOnly = this.isReadOnlySession();
    const linkToken = this.compact ? '' :
      new URLSearchParams(location.hash.slice(1)).get('access') || sessionStorage.getItem(`guestRequestLink:${this.id}`) || '';
    if (/^ra_[a-f0-9]{64}$/.test(linkToken)) {
      const ok = this.access.useRequestLink(linkToken, this.id);
      if (location.hash) history.replaceState(null, '', location.pathname);
      if (!ok) { this.error = 'Đây là liên kết yêu cầu khách vãng lai. Hãy đăng xuất hoặc mở trong cửa sổ riêng để xem.'; return; }
    }
    this.token = this.access.session?.accessToken || '';
    this.readOnly = this.isReadOnlySession();
    if (!this.token) this.error = 'Vui lòng xác minh số điện thoại người đặt bằng OTP để xem yêu cầu.';
    this.load();
    if (this.token && this.id) {
      this.requestEvents = this.access.watchRequests(this.id).subscribe(() => {
        this.refreshPending = true;
        this.refreshIfReady();
      });
    }
    let ticks = 0;
    this.timer = setInterval(() => {
      this.cdr.markForCheck();
      if (++ticks % 10 === 0 && !document.hidden) this.refreshPending = true;
      this.refreshIfReady();
    }, 1000);
  }
  private refreshIfReady() {
    if (!this.refreshPending || this.busy || this.loading) return;
    this.refreshPending = false;
    this.load(true);
  }
  get historyRoute() { return this.access.session?.authType === 'guest_lookup' ? '/order-list' : '/order-requests'; }
  get paymentRemainingLabel() {
    const end = new Date(this.request?.paymentDeadlineAt || this.request?.orderResult?.paymentDeadline || '').getTime();
    if (!Number.isFinite(end)) return '';
    const seconds = Math.max(0, Math.floor((end - Date.now()) / 1000));
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
    return seconds ? `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(rest).padStart(2,'0')}` : 'Đã hết hạn';
  }
  private isReadOnlySession() {
    const session = this.access.session;
    return session?.readOnly === true && !(session.authType === 'guest_lookup' && !!this.id);
  }
  ngOnDestroy() { this.requestEvents?.unsubscribe(); if (this.timer) clearInterval(this.timer); }
  image(url: string) { return this.service.assetUrl(url); }
  get privateLink() {
    const token = typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem(`guestRequestLink:${this.id}`);
    return token ? `${location.origin}/order-request/${this.id}#access=${token}` : '';
  }
  copyPrivateLink() {
    if (this.privateLink) void navigator.clipboard.writeText(this.privateLink).then(() => { this.feedback = 'Đã sao chép liên kết riêng. Chỉ chia sẻ với người được phép xem yêu cầu.'; this.cdr.markForCheck(); }).catch(() => { this.error = 'Trình duyệt chưa cho phép sao chép. Bạn có thể mở lại yêu cầu từ liên kết riêng đã lưu.'; this.cdr.markForCheck(); });
  }
  get canChange() { return !this.readOnly && this.request && !['Chờ thanh toán','Chờ khách thanh toán','Đã lên đơn','Đã từ chối','Đã tư vấn','Khách đã hủy','Hết hạn thanh toán'].includes(this.request.status); }
  get canCancel() { return !this.readOnly && this.request && !['Đã lên đơn','Đã từ chối','Đã tư vấn','Khách đã hủy','Hết hạn thanh toán'].includes(this.request.status); }
  editSchedule() {
    const delivery = this.request.quote?.delivery || this.request.delivery;
    this.requestedDate = /^\d{2}\/\d{2}\/\d{4}$/.test(delivery.date || '') ? delivery.date.split('/').reverse().join('-') : delivery.date || '';
    this.requestedTime = String(delivery.time || '').match(/\b\d{2}:\d{2}\b/)?.[0] || ''; this.showSchedule = !this.showSchedule;
  }
  change(action: string) {
    if (this.busy || (action === 'cancel' ? !this.canCancel || !this.cancelConfirmation : !this.canChange)) return;
    this.busy = true; this.error = ''; this.feedback = '';
    this.service.updateSalesRequest(this.id, this.token, { action, date: this.requestedDate, time: this.requestedTime }).subscribe({
      next: value => { this.request = value; this.busy = false; this.showSchedule = false; this.cancelConfirmation = false; this.confirmed = false;
        this.feedback = action === 'cancel' ? 'Đã dừng yêu cầu.' : 'Đã gửi lịch mới để shop kiểm tra lại.'; this.cdr.markForCheck(); },
      error: err => { this.error = err?.error?.message || 'Chưa cập nhật được yêu cầu.'; this.busy = false; this.cdr.markForCheck(); },
    });
  }
  confirmCancel() {
    if (this.busy || !this.canCancel) return;
    this.cancelConfirmation = true;
    this.change('cancel');
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
    if (this.busy || !this.request?.quote) return;
    this.busy = true; this.error = '';
    this.service.respondSalesRequest(this.id, this.token, this.request.quote.id, action).subscribe({
      next: value => { this.request = value; this.busy = false; this.cdr.markForCheck(); },
      error: err => { this.error = err?.error?.message || 'Chưa gửi được xác nhận.'; this.busy = false; this.cdr.markForCheck(); },
    });
  }
  /** Enter gửi tin; Shift+Enter xuống dòng; bỏ qua khi bộ gõ tiếng Việt đang ghép chữ. */
  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.send();
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
