import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { apiBaseUrl } from '../../../services/api-config';

@Component({ selector: 'app-order-requests', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './order-requests.html', styleUrl: './order-requests.css' })
export class OrderRequests implements OnInit, OnDestroy {
  private http = inject(HttpClient); private cdr = inject(ChangeDetectorRef);
  statuses = ['Chờ Sales tiếp nhận', 'Sales đang xử lý', 'Chờ khách xác nhận', 'Khách đã đồng ý', 'Đã lên đơn', 'Đã từ chối', 'Đã tư vấn', 'Khách đã hủy'];
  employeeId = typeof localStorage !== 'undefined' ? localStorage.getItem('adminEmployeeId') : '';
  requests: any[] = []; active: any; options: any; draft: any; messages: any[] = [];
  workTab = 'stock'; contact = { outcome: 'connected', note: '', followUpAt: '', readBackConfirmed: false };
  get originals(): any[] { return this.options?.products?.filter((p: any) => p.original) || []; }
  get alternatives(): any[] { return (this.options?.products || []).filter((p: any) => !p.original && p.active !== false && p.finished + p.buildable > 0).slice(0, 6); }
  saveContact() {
    if (this.busy || !this.active) return; this.busy = true; this.error = '';
    this.http.post(`${this.url}/${this.active.requestId}/contact`, { ...this.contact, version: this.active.version, quoteId: this.active.quote?.id, followUpAt: this.contact.followUpAt ? new Date(this.contact.followUpAt).toISOString() : undefined }).subscribe({ next: () => { this.busy = false; this.contact = { outcome: 'connected', note: '', followUpAt: '', readBackConfirmed: false }; this.load(); this.loadMessages(); }, error: err => this.fail(err) });
  }
  message = ''; channel = 'website'; search = ''; note = ''; editing = false;
  total = 0; page = 1; status = ''; error = ''; loading = false; busy = false;
  private timer?: ReturnType<typeof setInterval>;
  private pendingMessage: { text: string; channel: string; id: string } | null = null;
  private get url() { return `${apiBaseUrl()}/admin/order-requests`; }
  ngOnInit() {
    if (typeof localStorage === 'undefined') return;
    this.load(); this.timer = setInterval(() => { if (!document.hidden && !this.busy && !this.editing) this.load(true); }, 15000);
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }
  image(url: string) { return url?.startsWith('/uploads/') ? `${apiBaseUrl().replace(/\/api$/, '')}${url}` : url || 'assets/images/logo-main.png'; }
  load(quiet = false) {
    if (this.loading) return;
    this.loading = true; if (!quiet) this.error = '';
    this.http.get<any>(this.url, { params: new HttpParams().set('page', this.page).set('status', this.status) }).subscribe({
      next: data => { this.requests = data.requests; this.total = data.total; this.loading = false;
        if (this.active) { const oldQuote = this.active.quote?.id; this.active = this.requests.find(r => r.requestId === this.active.requestId); if (this.active) { if (oldQuote !== this.active.quote?.id) { this.contact.readBackConfirmed = false; this.contact.outcome = 'connected'; } this.loadMessages(); } }
        this.cdr.markForCheck(); }, error: err => { this.loading = false; this.fail(err); },
    });
  }
  private fail(err: any) { this.error = err?.error?.message || 'Chưa lưu được thao tác. Vui lòng thử lại.'; this.busy = false; this.cdr.markForCheck(); }
  open(row: any) { this.workTab = ['Khách đã đồng ý','Đã lên đơn'].includes(row.status) ? 'proposal' : 'stock'; this.contact = { outcome: 'connected', note: '', followUpAt: '', readBackConfirmed: false }; this.active = row; this.editing = false; this.options = null; this.message = ''; this.note = ''; this.search = ''; this.messages = []; this.loadOptions(); this.loadMessages(); }
  loadOptions() {
    if (!this.active) return;
    const id = this.active.requestId;
    this.http.get<any>(`${this.url}/${id}/options`, { params: { search: this.search } }).subscribe({
      next: data => { if (this.active?.requestId === id) this.options = data; this.cdr.markForCheck(); }, error: err => this.fail(err),
    });
  }
  loadMessages() {
    if (!this.active) return;
    const id = this.active.requestId;
    this.http.get<any[]>(`${this.url}/${id}/messages`).subscribe({ next: data => { if (this.active?.requestId === id) this.messages = data; this.cdr.markForCheck(); }, error: err => this.fail(err) });
  }
  update(row: any, action: string) {
    if (this.busy) return;
    this.busy = true; this.error = '';
    this.http.patch<any>(`${this.url}/${row.requestId}`, { action, version: row.version, note: this.note }).subscribe({
      next: data => { this.busy = false; this.active = data; this.status = ''; this.load(); if (action === 'claim') { this.loadOptions(); this.loadMessages(); } this.cdr.markForCheck(); }, error: err => this.fail(err),
    });
  }
  edit() {
    if (!this.active || !this.options) return;
    const q = this.active.quote;
    this.draft = { items: q ? q.items.map((item: any) => ({ ...item, materials: item.custom ? item.bom.materials.map((m: any) => ({ ...m })) : [], designFee: item.bom?.designFee || 0, extraFee: item.bom?.extraFee || 0 }))
      : this.active.items.map((i: any) => ({ id: i.productId, qty: i.quantity, custom: false })),
      date: this.dateInput(q?.delivery.date || this.active.delivery?.date), time: String(q?.delivery.time || this.active.delivery?.time || '').match(/\b\d{2}:\d{2}\b/)?.[0] || '',
      shippingFee: q?.summary.shippingFee ?? this.active.originalSummary?.shippingFee ?? 0,
      paymentMethod: q?.payment.method || 'bank', depositAmount: q?.summary.depositAmount || 0, note: q?.note || '' };
    this.workTab = 'proposal'; this.editing = true;
  }
  private dateInput(value: string) { return /^\d{2}\/\d{2}\/\d{4}$/.test(value || '') ? value.split('/').reverse().join('-') : value || ''; }
  addCatalog() { this.draft.items.push({ id: '', qty: 1, custom: false }); }
  chooseAlternative(product: any) {
    this.edit();
    if (this.draft?.items.length === 1) this.draft.items[0] = { id: product.id, qty: this.draft.items[0].qty, custom: false };
  }
  addCustom() { this.draft.items.push({ name: '', qty: 1, custom: true, image: '', imageDescription: 'Ảnh minh họa, thành phẩm thực tế có thể có khác biệt nhỏ', materials: [{ materialId: '', quantity: 1 }], designFee: 0, extraFee: 0 }); }
  unitPrice(item: any): number {
    if (!item.custom) return this.options?.products.find((p: any) => p.id === item.id)?.price || 0;
    return Math.round(item.materials.reduce((sum: number, m: any) => sum + Number(m.quantity || 0) * (this.options?.materials.find((x: any) => x.id === m.materialId)?.price || 0), 0) + Number(item.designFee || 0) + Number(item.extraFee || 0));
  }
  get draftTotal() { return this.draft ? this.draft.items.reduce((sum: number, i: any) => sum + this.unitPrice(i) * Number(i.qty || 0), 0) + Number(this.draft.shippingFee || 0) : 0; }
  upload(item: any, event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file || !this.active) return;
    if (file.size > 5 * 1024 * 1024) { this.error = 'Ảnh tối đa 5MB.'; return; }
    const form = new FormData(); form.append('image', file); this.busy = true; this.error = '';
    this.http.post<any>(`${this.url}/${this.active.requestId}/image`, form).subscribe({ next: data => { item.image = data.url; this.busy = false; this.cdr.markForCheck(); }, error: err => this.fail(err) });
  }
  propose() {
    if (this.busy || !this.active) return;
    this.busy = true; this.error = '';
    this.http.post(`${this.url}/${this.active.requestId}/proposal`, { ...this.draft, version: this.active.version }).subscribe({
      next: () => { this.busy = false; this.editing = false; this.status = ''; this.load(); this.cdr.markForCheck(); }, error: err => this.fail(err),
    });
  }
  convert() {
    if (this.busy || !this.active?.quote) return;
    this.busy = true; this.error = '';
    this.http.post(`${this.url}/${this.active.requestId}/convert`, { version: this.active.version, quoteId: this.active.quote.id }).subscribe({
      next: () => { this.busy = false; this.status = ''; this.load(); this.cdr.markForCheck(); }, error: err => this.fail(err),
    });
  }
  send() {
    if (this.busy || !this.message.trim()) return;
    const content = this.message.trim();
    if (this.pendingMessage?.text !== content || this.pendingMessage?.channel !== this.channel) this.pendingMessage = { text: content, channel: this.channel, id: crypto.randomUUID() };
    this.busy = true; this.error = '';
    this.http.post(`${this.url}/${this.active.requestId}/messages`, { text: content, channel: this.channel, messageId: this.pendingMessage!.id }).subscribe({
      next: () => { this.busy = false; this.message = ''; this.pendingMessage = null; this.loadMessages(); this.cdr.markForCheck(); }, error: err => this.fail(err),
    });
  }
}
