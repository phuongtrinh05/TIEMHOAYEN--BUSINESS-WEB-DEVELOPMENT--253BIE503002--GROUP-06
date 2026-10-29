import { Component, inject, OnDestroy, OnInit, ChangeDetectorRef, AfterViewChecked, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { apiBaseUrl, currentOrderAccountKey, orderAccessSession } from '../../services/api-config';
import { OrderAccessService } from '../../services/order-access.service';
import { SalesChatService } from '../../services/sales-chat.service';
import { SupportChatService, SupportSession } from '../../services/support-chat.service';
import { OrderRequest } from '../../pages/orders/order-request/order-request';
@Component({ selector: 'app-chatbot-widget', standalone: true, imports: [CommonModule, FormsModule, RouterLink, OrderRequest], templateUrl: './chatbot-widget.html', styleUrl: './chatbot-widget.css' })
export class ChatbotWidget implements OnInit, OnDestroy, AfterViewChecked {
    @ViewChild('chatBody')
    private chatBody?: ElementRef<HTMLElement>;
    private lastScrollKey = '';
    private http = inject(HttpClient);
    private router = inject(Router);
    private cdr = inject(ChangeDetectorRef);
    private sales = inject(SalesChatService);
    private support = inject(SupportChatService);
    readonly access = inject(OrderAccessService);
    isOpen = false;
    salesRequestId = '';
    latestSalesRequestId = '';
    session: SupportSession | null = null;
    ticket: any;
    messages: any[] = [];
    inputText = '';
    busy = false;
    error = '';
    contact = { name: '', phone: '', email: '' };
    selectedImageDataUrl = '';
    selectedFileName = '';
    orderData: any = null;
    showOrderAccess = false;
    orderPhone = '';
    otpCode = '';
    challengeId = '';
    otpBusy = false;
    otpNotice = '';
    resendAt = 0;
    now = Date.now();
    rating = 0;
    formatOrderTotal(value: unknown) {
        const total = Number(value);
        return Number.isFinite(total) ? total.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) : '—';
    }
    ratingNotice = '';
    private subscriptions: Subscription[] = [];
    private timer?: ReturnType<typeof setInterval>;
    private accountKey = '';
    private pendingSend: {
        fingerprint: string;
        id: string;
    } | null = null;
    get hasAccount() { return !!currentOrderAccountKey(); }
    get needsLogin() { return this.hasAccount && !orderAccessSession(); }
    get guestForm() { return !this.session && !this.hasAccount; }
    get resendSeconds() { return Math.max(0, Math.ceil((this.resendAt - this.now) / 1000)); }
    get statusText() { return this.ticket?.status === 'Đã xử lý' ? 'Đã kết thúc hỗ trợ' : this.ticket?.mode === 'WAITING' ? 'Đang chờ nhân viên tiếp nhận' : this.ticket?.mode === 'HUMAN' ? 'Nhân viên đang hỗ trợ' : 'Tư vấn tự động'; }
    ngOnInit() {
        if (typeof window === 'undefined')
            return;
        this.accountKey = currentOrderAccountKey();
        this.session = this.support.session;
        this.subscriptions.push(this.sales.request$.subscribe(id => { this.salesRequestId = id; if (id) {
            this.latestSalesRequestId = id;
            this.isOpen = true;
        } this.cdr.markForCheck(); }));
        this.subscriptions.push(this.support.opened.subscribe(s => { this.session = s; this.sales.assistant(); this.isOpen = true; this.read(); }));
        this.timer = setInterval(() => { this.now = Date.now(); const account = currentOrderAccountKey(); if (account !== this.accountKey) {
            this.accountKey = account;
            this.resetView();
            this.support.clear();
        } if (this.isOpen && this.session && !this.busy && !this.salesRequestId)
            this.read(true); if (!orderAccessSession())
            this.orderData = null; this.cdr.markForCheck(); }, 5000);
    }
    ngOnDestroy() { this.subscriptions.forEach(s => s.unsubscribe()); if (this.timer)
        clearInterval(this.timer); }
    ngAfterViewChecked() { const key = `${this.session?.ticketId}:${this.messages.length}:${this.showOrderAccess}:${this.ticket?.ratingEligible}`; if (this.chatBody && key !== this.lastScrollKey) {
        this.lastScrollKey = key;
        this.chatBody.nativeElement.scrollTop = this.chatBody.nativeElement.scrollHeight;
    } }
    openChat() { this.isOpen = true; this.error = ''; this.session = this.support.session; if (this.session)
        this.read();
    else if (this.hasAccount && !this.needsLogin)
        this.start(); }
    closeChat() { this.isOpen = false; }
    backToAssistant() { this.sales.assistant(); this.openChat(); }
    resumeSalesChat() { if (this.latestSalesRequestId)
        this.sales.open(this.latestSalesRequestId); }
    private get url() { return `${apiBaseUrl()}/support`; }
    private headers() { return new HttpHeaders(this.session?.guestToken ? { 'x-support-token': this.session.guestToken } : {}); }
    start() {
        if (this.busy)
            return;
        if (!this.hasAccount && (!this.contact.name.trim() || !/^0\d{9}$/.test(this.contact.phone.replace(/[\s.-]/g, '')))) {
            this.error = 'Nhập tên và SĐT hợp lệ trước khi bắt đầu chat.';
            return;
        }
        this.busy = true;
        this.error = '';
        this.http.post<any>(`${this.url}/sessions`, { ...this.contact, ...(this.session ? { ticketId: this.session.ticketId } : {}) }, { headers: this.headers() }).subscribe({ next: r => { this.session = this.support.save(r); this.ticket = r.ticket; this.busy = false; this.read(); }, error: e => this.fail(e) });
    }
    read(quiet = false) {
        if (!this.session)
            return;
        const id = this.session.ticketId;
        this.http.get<any>(`${this.url}/sessions/${id}`, { headers: this.headers() }).subscribe({ next: r => { if (this.session?.ticketId !== id)
                return; this.ticket = r.ticket; this.messages = r.messages; this.cdr.markForCheck(); }, error: e => { if (this.session?.ticketId !== id)
                return; if (e.status === 401 || e.status === 403) {
                if (e.status === 401 && this.hasAccount)
                    sessionStorage.removeItem('orderLookupAccess');
                this.support.clear();
                this.resetView();
            } if (!quiet)
                this.fail(e); } });
    }
    private context() { const match = this.router.url.match(/\/product-detail\/([^/?#]+)/); return match ? { productId: decodeURIComponent(match[1]) } : {}; }
    sendMessage(extra: any = {}) {
        if (this.busy || !this.session)
            return;
        const text = String(extra.chatInput ?? this.inputText).trim();
        if (!text && !this.selectedImageDataUrl && !extra.selectedImageId)
            return;
        const payload = { chatInput: text, imageDataUrl: this.selectedImageDataUrl || undefined, ...this.context(), ...extra };
        const fingerprint = JSON.stringify(payload);
        if (this.pendingSend?.fingerprint !== fingerprint)
            this.pendingSend = { fingerprint, id: crypto.randomUUID() };
        this.busy = true;
        this.error = '';
        this.http.post<any>(`${this.url}/sessions/${this.session.ticketId}/messages`, { ...payload, messageId: this.pendingSend.id }, { headers: this.headers() }).subscribe({ next: r => { this.busy = false; this.messages = r.messages; this.ticket = r.ticket; this.inputText = ''; this.selectedImageDataUrl = ''; this.selectedFileName = ''; this.pendingSend = null; if (r.authRequired) {
                this.showOrderAccess = true;
                this.otpNotice = 'Xác minh SĐT người đặt để xem dữ liệu đơn riêng.';
            } if (r.orderData) {
                this.orderData = r.orderData;
                this.showOrderAccess = true;
            } this.cdr.markForCheck(); }, error: e => this.fail(e) });
    }
    quick(text: string) { this.sendMessage({ chatInput: text }); }
    selectImage(image: any) { this.sendMessage({ chatInput: 'Tôi muốn nhân viên tư vấn mẫu ảnh này.', selectedImageId: image.id, action: 'handoff' }); }
    onEnter(e: KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
    } }
    onFileSelected(e: Event) { const file = (e.target as HTMLInputElement).files?.[0]; if (!file)
        return; if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        this.error = 'Chọn ảnh JPG, PNG hoặc WEBP tối đa 5MB.';
        return;
    } const reader = new FileReader(); reader.onload = () => { this.selectedImageDataUrl = String(reader.result); this.selectedFileName = file.name; this.cdr.markForCheck(); }; reader.readAsDataURL(file); }
    openOrders() { this.orderPhone = this.ticket?.phone || ''; this.showOrderAccess = true; this.error = ''; if (orderAccessSession())
        this.loadOrders(); }
    loadOrders() { if (!this.session)
        return; this.otpBusy = true; this.http.get<any>(`${this.url}/sessions/${this.session.ticketId}/orders`, { headers: this.headers() }).subscribe({ next: r => { this.orderData = r; this.otpBusy = false; this.cdr.markForCheck(); }, error: e => { this.otpBusy = false; this.orderData = null; this.error = e.error?.message || 'Chưa tải được đơn.'; this.cdr.markForCheck(); } }); }
    sendOtp() { if (this.otpBusy || this.resendSeconds)
        return; this.otpBusy = true; this.error = ''; this.access.requestOtp(this.orderPhone || this.ticket.phone).subscribe({ next: r => { this.challengeId = r.challengeId; this.otpNotice = r.message; this.resendAt = Date.now() + 60000; this.otpBusy = false; this.cdr.markForCheck(); }, error: e => { this.otpBusy = false; this.fail(e); } }); }
    verifyOtp() { if (this.otpBusy || !/^\d{6}$/.test(this.otpCode))
        return; this.otpBusy = true; this.access.verify(this.challengeId, this.otpCode).subscribe({ next: () => { this.otpCode = ''; this.challengeId = ''; this.otpBusy = false; this.loadOrders(); }, error: e => { this.otpBusy = false; this.fail(e); } }); }
    rate() { if (this.busy || !this.session || !this.rating)
        return; this.busy = true; this.http.post(`${this.url}/sessions/${this.session.ticketId}/rating`, { score: this.rating, round: this.ticket.round }, { headers: this.headers() }).subscribe({ next: () => { this.busy = false; this.ratingNotice = 'Cảm ơn bạn đã đánh giá!'; this.read(); }, error: e => this.fail(e) }); }
    image(url: string) { return url?.startsWith('/uploads/') ? `${apiBaseUrl().replace(/\/api$/, '')}${url}` : url; }
    newSession() { this.support.clear(); this.resetView(); }
    private resetView() { this.session = null; this.ticket = null; this.messages = []; this.orderData = null; this.showOrderAccess = false; this.error = ''; this.contact = { name: '', phone: '', email: '' }; this.inputText = ''; this.selectedImageDataUrl = ''; this.pendingSend = null; }
    private fail(e: any) { this.busy = false; this.error = e?.error?.message || 'Chưa thực hiện được, vui lòng thử lại.'; this.cdr.markForCheck(); }
}
