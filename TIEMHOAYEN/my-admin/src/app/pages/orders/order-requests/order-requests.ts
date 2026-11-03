import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { apiBaseUrl } from '../../../services/api-config';

@Component({ selector: 'app-order-requests', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './order-requests.html', styleUrls: ['./order-requests.css', './order-requests-refinement.css'] })
export class OrderRequests implements OnInit, OnDestroy {
  private http = inject(HttpClient); private cdr = inject(ChangeDetectorRef); private route = inject(ActivatedRoute);
  statuses = ['Chờ Sales tiếp nhận', 'Sales đang xử lý', 'Chờ khách xác nhận', 'Chờ khách thanh toán', 'Đã lên đơn', 'Đã từ chối', 'Khách đã hủy', 'Hết hạn thanh toán'];
  employeeId = typeof localStorage !== 'undefined' ? localStorage.getItem('adminEmployeeId') : '';
  requests: any[] = []; active: any; options: any; draft: any; messages: any[] = [];
  private draftBaseline = '';
  private replacementBaseline = '{}';
  workTab = 'stock'; chatOpen = false; showDecision = false; showOriginalConfirm = false;
  replacementChoice: Record<string, string> = {};
  proposalReplacementChoice: Record<string, string> = {};
  approvedReplacements: Record<string, { productId: string; sourceMaterialId: string; substituteMaterialId: string; substituteName: string }> = {};
  contact = { outcome: 'connected', note: '', followUpAt: '', readBackConfirmed: false };
  readonly closedStatuses = ['Đã lên đơn', 'Đã từ chối', 'Đã tư vấn', 'Khách đã hủy'];
  allCount = 0; waitingCount = 0; urgentCount = 0;
  canOpen(row: any) { return row?.assignedTo === this.employeeId; }
  get canConfirmOriginal() {
    return this.active?.status === 'Sales đang xử lý' && !this.active?.quote && !this.editing;
  }
  get canShowConfirmOriginal() { return this.active?.status === 'Sales đang xử lý' && !this.active?.quote; }
  get proposalChanged() {
    if (!this.editing || !this.draft || !this.active) return false;
    return this.draftFingerprint(this.draft) !== this.draftBaseline;
  }
  get materialChanged() { return JSON.stringify(this.approvedReplacements) !== this.replacementBaseline; }
  get onlyMaterialChanged() { return this.editing && this.materialChanged && !this.proposalChanged; }
  get requiresCustomerProposal() { return this.proposalChanged || (this.active?.status === 'Chờ khách xác nhận' && this.materialChanged); }
  private draftFingerprint(draft: any) {
    return JSON.stringify({
      items: (draft?.items || []).map((item: any) => ({ id: item.id || '', baseProductId: item.baseProductId || '', name: item.name || '',
        qty: Number(item.qty || 0), custom: !!item.custom, materials: (item.materials || []).map((m: any) => ({ materialId: m.materialId || '', quantity: Number(m.quantity || 0) })),
        designFee: Number(item.designFee || 0), extraFee: Number(item.extraFee || 0) })),
      date: draft?.date || '', time: draft?.time || '', shippingFee: Number(draft?.shippingFee || 0),
      paymentMethod: draft?.paymentMethod || '', note: String(draft?.note || '').trim(),
    });
  }
  statusTone(value: string) {
    if (value === 'Đã lên đơn') return 'success';
    if (value === 'Chờ khách xác nhận' || value === 'Chờ khách thanh toán' || value === 'Chờ thanh toán') return 'waiting';
    if (value === 'Đã từ chối' || value === 'Khách đã hủy') return 'danger';
    return value === 'Chờ Sales tiếp nhận' ? 'new' : 'processing';
  }
  get originals(): any[] { return this.options?.products?.filter((p: any) => p.original) || []; }
  get alternatives(): any[] { return (this.options?.products || []).filter((p: any) => !p.original && p.active !== false && p.finished + p.buildable > 0).slice(0, 6); }
  incomingFor(materialId: string): any[] {
    return (this.options?.incomingOrders || []).filter((order: any) =>
      String(order?.materialId || '') === String(materialId || ''));
  }
  get historyEntries(): any[] {
    return [...(this.active?.history || [])].sort((a: any, b: any) =>
      new Date(b?.at || 0).getTime() - new Date(a?.at || 0).getTime());
  }
  historyAction(entry: any) {
    const labels: Record<string, string> = {
      claim: 'Sales tiếp nhận yêu cầu',
      note: 'Cập nhật ghi chú xử lý',
      reject: 'Từ chối yêu cầu',
      close: 'Kết thúc tư vấn',
    };
    return labels[String(entry?.action || '')] || entry?.action || 'Cập nhật yêu cầu';
  }
  historyActor(entry: any) {
    const actor = String(entry?.actor || '');
    if (!actor || actor === 'CUSTOMER') return 'Khách hàng';
    if (['SYSTEM', 'PAYMENT'].includes(actor)) return 'Hệ thống';
    if (actor === String(this.active?.assignedTo || '')) return this.active?.assignedName || actor;
    return actor;
  }
  saveContact() {
    if (this.busy || !this.active) return; this.busy = true; this.error = '';
    this.http.post(`${this.url}/${this.active.requestId}/contact`, { ...this.contact, version: this.active.version, quoteId: this.active.quote?.id, followUpAt: this.contact.followUpAt ? new Date(this.contact.followUpAt).toISOString() : undefined }).subscribe({ next: () => { this.busy = false; this.contact = { outcome: 'connected', note: '', followUpAt: '', readBackConfirmed: false }; this.load(); this.loadMessages(); }, error: err => this.fail(err) });
  }
  message = ''; channel = 'website'; search = ''; note = ''; editing = false;
  catalogLoaded = false; optionsLoading = false; optionsError = ''; sourcesLoading = false; sourcesLoaded = false;
  total = 0; page = 1; status = ''; queueSearch = ''; appliedQueueSearch = ''; error = ''; loading = false; busy = false;
  private timer?: ReturnType<typeof setInterval>;
  private targetRequestId = '';
  private pendingEdit = false;
  private pendingMessage: { text: string; channel: string; id: string } | null = null;
  private get url() { return `${apiBaseUrl()}/admin/order-requests`; }
  ngOnInit() {
    if (typeof localStorage === 'undefined') return;
    this.targetRequestId = String(this.route.snapshot.queryParamMap.get('requestId') || '').trim();
    if (this.targetRequestId) {
      this.queueSearch = this.targetRequestId;
      this.appliedQueueSearch = this.targetRequestId;
    }
    this.load(); this.timer = setInterval(() => { if (!document.hidden && !this.busy && !this.editing) this.load(true); }, 15000);
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }
  image(url: string) { return url?.startsWith('/uploads/') ? `${apiBaseUrl().replace(/\/api$/, '')}${url}` : url || 'assets/images/logo-main.png'; }
  applySearch() { this.appliedQueueSearch = this.queueSearch.trim(); this.page = 1; this.active = null; this.load(); }
  clearSearch() { this.queueSearch = ''; this.appliedQueueSearch = ''; this.page = 1; this.active = null; this.load(); }
  load(quiet = false) {
    if (this.loading) return;
    this.loading = true; if (!quiet) this.error = '';
    this.http.get<any>(this.url, { params: new HttpParams().set('page', this.page).set('status', this.status).set('search', this.appliedQueueSearch) }).subscribe({
      next: data => { this.requests = data.requests; this.total = data.total; this.allCount = Number(data.summary?.total ?? data.total ?? 0); this.waitingCount = Number(data.summary?.waiting || 0); this.urgentCount = Number(data.summary?.urgent || 0); this.loading = false;
        if (this.targetRequestId && !this.active) {
          const target = this.requests.find(r => r.requestId === this.targetRequestId);
          if (target) this.open(target);
          this.targetRequestId = '';
        }
        if (this.active) { const oldActive = this.active; const oldQuote = oldActive.quote?.id; this.active = this.requests.find(r => r.requestId === oldActive.requestId) || oldActive; if (oldQuote !== this.active.quote?.id) { this.contact.readBackConfirmed = false; this.contact.outcome = 'connected'; } if (this.chatOpen) this.loadMessages(); }
        this.cdr.markForCheck(); }, error: err => { this.loading = false; this.fail(err); },
    });
  }
  private fail(err: any) { this.error = err?.error?.message || 'Chưa lưu được thao tác. Vui lòng thử lại.'; this.busy = false; this.cdr.markForCheck(); }
  open(row: any) { this.workTab = 'stock'; this.chatOpen = false; this.showDecision = false; this.showOriginalConfirm = false; this.replacementChoice = {}; this.proposalReplacementChoice = {}; this.approvedReplacements = {}; this.contact = { outcome: 'connected', note: '', followUpAt: '', readBackConfirmed: false }; this.active = row; this.editing = false; this.draft = null; this.pendingEdit = false; this.catalogLoaded = false; this.optionsLoading = false; this.optionsError = ''; this.sourcesLoading = false; this.sourcesLoaded = false; this.options = null; this.message = ''; this.note = ''; this.search = ''; this.messages = []; this.loadOptions(); }
  selectWorkTab(tab: string) {
    this.workTab = tab;
    if (tab === 'proposal' && ['Sales đang xử lý','Chờ khách xác nhận'].includes(this.active?.status) && !this.editing) {
      this.showOriginalConfirm = false;
      if (!this.catalogLoaded) { this.editing = true; this.loadOptions(true); } else if (this.options) this.edit();
    }
  }
  openChat() { if (!this.active) return; this.chatOpen = true; this.loadMessages(); }
  closeChat() { this.chatOpen = false; }
  replacementKey(product: any, requirement: any) { return `${product.id}:${requirement.materialId}`; }
  canReplaceRequirement(requirement: any) {
    return requirement?.substitutionExplicitlyAllowed === true
      && requirement?.allowSubstitution === true
      && Array.isArray(requirement?.substitutes) && requirement.substitutes.length > 0;
  }
  canSelectReplacement() {
    return ['Sales đang xử lý', 'Chờ khách xác nhận'].includes(String(this.active?.status || ''));
  }
  appliedReplacement(product: any, requirement: any) { return this.approvedReplacements[this.replacementKey(product, requirement)]; }
  private syncQuoteReplacements() {
    const restored: typeof this.approvedReplacements = {};
    for (const item of this.active?.quote?.items || []) {
      const productId = String(item.baseProductId || item.id || '');
      for (const replacement of item.bom?.substitutions || []) {
        const sourceMaterialId = String(replacement.sourceMaterialId || '');
        const substituteMaterialId = String(replacement.substituteMaterialId || '');
        if (!productId || !sourceMaterialId || !substituteMaterialId) continue;
        restored[`${productId}:${sourceMaterialId}`] = { productId, sourceMaterialId, substituteMaterialId,
          substituteName: String(replacement.substituteName || substituteMaterialId) };
      }
    }
    this.approvedReplacements = restored;
  }
  removeReplacement(product: any, requirement: any) { delete this.approvedReplacements[this.replacementKey(product, requirement)]; this.showOriginalConfirm = false; }
  productCanBeConfirmed(product: any) {
    if (Number(product.finished || 0) >= Number(product.requestedQuantity || 0)) return true;
    return (product.requirements || []).every((requirement: any) => {
      if (Number(requirement.missing || 0) <= 0) return true;
      const replacement = this.appliedReplacement(product, requirement);
      if (!replacement) return false;
      const option = requirement.substitutes?.find((item: any) => item.materialId === replacement.substituteMaterialId);
      return !!option && Number(option.available || 0) >= Number(requirement.required || 0) * Number(option.conversionRatio || 1);
    });
  }
  applyReplacement(product: any, requirement: any) {
    const substituteId = this.replacementChoice[this.replacementKey(product, requirement)];
    const substitute = requirement.substitutes?.find((item: any) => item.materialId === substituteId);
    if (!substitute || !product.allowSubstitution || !this.canReplaceRequirement(requirement)) return;
    this.approvedReplacements[this.replacementKey(product, requirement)] = { productId: product.id,
      sourceMaterialId: requirement.materialId, substituteMaterialId: substitute.materialId, substituteName: substitute.name };
    this.replacementChoice[this.replacementKey(product, requirement)] = '';
    this.showOriginalConfirm = false;
  }
  confirmOriginal() {
    if (this.busy || !this.canConfirmOriginal) return;
    const summary = this.active.originalSummary || {};
    const body = { version: this.active.version,
      items: this.active.items.map((item: any) => ({ id: item.productId, qty: item.quantity, custom: false })),
      date: this.dateInput(this.active.delivery?.date), time: String(this.active.delivery?.time || '').match(/\b\d{2}:\d{2}\b/)?.[0] || '',
      shippingFee: Number(summary.shippingFee || 0), paymentMethod: 'cod', depositAmount: Number(summary.depositAmount || 0),
      substitutions: Object.values(this.approvedReplacements),
      note: 'Shop xác nhận có thể đáp ứng nguyên mẫu, số lượng, giá tham chiếu và lịch giao khách đã yêu cầu.' };
    this.busy = true; this.error = '';
    this.http.post(`${this.url}/${this.active.requestId}/confirm`, body).subscribe({
      next: () => { this.busy = false; this.showOriginalConfirm = false; this.workTab = 'stock'; this.status = ''; this.load(); this.cdr.markForCheck(); },
      error: err => this.fail(err),
    });
  }
  loadOptions(includeCatalog = false) {
    if (!this.active || this.optionsLoading) return;
    const id = this.active.requestId;
    this.optionsLoading = true; this.optionsError = '';
    this.http.get<any>(`${this.url}/${id}/options`, { params: { search: this.search, includeCatalog: String(includeCatalog), includeSources: 'false' } }).subscribe({
      next: data => { if (this.active?.requestId === id) { data.suppliers = this.options?.suppliers || []; data.incomingOrders = this.options?.incomingOrders || []; this.options = data; this.catalogLoaded = !!data.catalogIncluded; this.syncQuoteReplacements();
          if (this.pendingEdit) { this.pendingEdit = false; this.edit(); }
          if (this.workTab === 'proposal' && ['Sales đang xử lý','Chờ khách xác nhận'].includes(this.active.status) && (includeCatalog || !this.editing)) this.edit(); }
        this.optionsLoading = false; if (!this.sourcesLoaded) this.loadSources(id); this.cdr.markForCheck(); }, error: err => { this.optionsLoading = false; this.optionsError = err?.error?.message || 'Không tải được dữ liệu kho.'; this.cdr.markForCheck(); },
    });
  }
  private loadSources(id: string) {
    if (this.sourcesLoading || this.sourcesLoaded) return;
    this.sourcesLoading = true;
    this.http.get<any>(`${this.url}/${id}/options`, { params: { includeCatalog: 'false', includeSources: 'true' } }).subscribe({
      next: data => { if (this.active?.requestId === id && this.options) this.options = { ...this.options, suppliers: data.suppliers || [], incomingOrders: data.incomingOrders || [] };
        this.sourcesLoading = false; this.sourcesLoaded = true; this.cdr.markForCheck(); },
      error: () => { this.sourcesLoading = false; this.cdr.markForCheck(); },
    });
  }
  beginEdit() {
    if (this.busy || this.editing || !this.active) return;
    // Dữ liệu sản phẩm gốc và BOM đã có từ lần mở yêu cầu, vì vậy mở form
    // ngay. Danh mục các mẫu khác chỉ là dữ liệu bổ sung và được tải nền để
    // tránh bắt nhân viên chờ Atlas trước khi có thể sửa.
    if (this.options) this.edit();
    else this.pendingEdit = true;
    if (!this.catalogLoaded) this.loadOptions(true);
  }
  loadMessages() {
    if (!this.active) return;
    const id = this.active.requestId;
    this.http.get<any[]>(`${this.url}/${id}/messages`).subscribe({ next: data => { if (this.active?.requestId === id) this.messages = data; this.cdr.markForCheck(); }, error: err => this.fail(err) });
  }
  update(row: any, action: string) {
    if (this.busy) return;
    this.busy = true; this.error = '';
    this.http.patch<any>(`${this.url}/${row.requestId}`, { action, version: Number.isInteger(row.version) ? row.version : 0, note: this.note }).subscribe({
      next: data => {
        this.busy = false;
        this.requests = this.requests.map(item => item.requestId === data.requestId ? data : item);
        this.status = '';
        if (action === 'claim') {
          // Open exactly the request whose claim succeeded. A resort/refresh of
          // the queue must never replace it with another request.
          this.open(data);
        } else {
          this.active = data;
        }
        this.load(true);
        this.cdr.markForCheck();
      }, error: err => this.fail(err),
    });
  }
  edit() {
    if (!this.active || !this.options) return;
    const q = this.active.quote;
    this.draft = { items: q ? q.items.map((item: any) => ({ ...item, materials: item.custom ? item.bom.materials.map((m: any) => ({ ...m })) : [], designFee: item.bom?.designFee || 0, extraFee: item.bom?.extraFee || 0 }))
      : this.active.items.map((i: any) => i.designId ? {id:i.productId,qty:i.quantity,custom:true,designId:i.designId,name:i.name,image:i.image,imageDescription:'Thiết kế 3D khách gửi; cần xác nhận khả năng thực hiện',materials:i.bom.materials.map((m:any)=>({...m})),designFee:i.bom.designFee || 0,extraFee:i.bom.extraFee || 0} : { id: i.productId, qty: i.quantity, custom: false }),
      date: this.dateInput(q?.delivery.date || this.active.delivery?.date), time: String(q?.delivery.time || this.active.delivery?.time || '').match(/\b\d{2}:\d{2}\b/)?.[0] || '',
      shippingFee: q?.summary.shippingFee ?? this.active.originalSummary?.shippingFee ?? 0,
      paymentMethod: q?.payment.method || 'bank', depositAmount: q?.summary.depositAmount || 0, note: q?.note || '' };
    this.draftBaseline = this.draftFingerprint(this.draft);
    this.replacementBaseline = JSON.stringify(this.approvedReplacements);
    this.workTab = 'stock'; this.editing = true;
  }
  cancelEdit() {
    this.approvedReplacements = JSON.parse(this.replacementBaseline || '{}');
    this.replacementChoice = {};
    this.draft = null;
    this.editing = false;
  }
  closeMaterialEdit() {
    this.draft = null;
    this.editing = false;
  }
  private dateInput(value: string) { return /^\d{2}\/\d{2}\/\d{4}$/.test(value || '') ? value.split('/').reverse().join('-') : value || ''; }
  addCatalog() { this.draft.items.push({ id: '', qty: 1, custom: false }); }
  draftProduct(item: any) { return this.options?.products?.find((product: any) => product.id === item.id) || null; }
  replaceableRequirements(product: any): any[] {
    return (product?.requirements || []).filter((requirement: any) => this.canReplaceRequirement(requirement));
  }
  applyDraftReplacement(item: any, itemIndex: number, requirement: any) {
    const key = `${itemIndex}:${requirement.materialId}`;
    const substituteId = this.proposalReplacementChoice[key];
    const product = this.draftProduct(item);
    const substitute = requirement.substitutes?.find((entry: any) => entry.materialId === substituteId);
    if (!product || !substitute || !product.allowSubstitution || !this.canReplaceRequirement(requirement)) return;
    const materials = product.requirements.map((line: any) => line.materialId === requirement.materialId
      ? { materialId: substitute.materialId, quantity: Number(line.perUnit || 0) * Number(substitute.conversionRatio || 1), replacesMaterialId: line.materialId }
      : { materialId: line.materialId, quantity: Number(line.perUnit || 0) });
    this.draft.items[itemIndex] = { id: `SPYC_${product.id}`, baseProductId: product.id, name: `${product.name} · thay nguyên vật liệu`, qty: Number(item.qty || 1),
      custom: true, image: product.image, designSource: 'SALES_CUSTOM', description: `Thay ${requirement.name} bằng ${substitute.name} theo BOM sản phẩm.`,
      materials, designFee: 0, extraFee: 0 };
    delete this.proposalReplacementChoice[key];
  }
  chooseAlternative(product: any) {
    this.edit();
    if (this.draft?.items.length === 1) this.draft.items[0] = { id: product.id, qty: this.draft.items[0].qty, custom: false };
  }
  addCustom() { this.draft.items.push({ name: '', qty: 1, custom: true, image: '', materials: [{ materialId: '', quantity: 1 }], designFee: 0, extraFee: 0, designSource: 'SALES_CUSTOM' }); }
  changeMaterialQuantity(material: any, amount: number) { material.quantity = Math.max(1, Math.round(Number(material.quantity || 1) + amount)); }
  unitPrice(item: any): number {
    if (!item.custom) return this.options?.products.find((p: any) => p.id === item.id)?.price || 0;
    return Math.round(item.materials.reduce((sum: number, m: any) => sum + Number(m.quantity || 0) * (this.options?.materials.find((x: any) => x.id === m.materialId)?.price || 0), 0) + Number(item.designFee || 0) + Number(item.extraFee || 0));
  }
  get draftCardFee() { return Number(this.active?.giftCard?.fee || 0); }
  get draftTotal() { return this.draft ? this.draft.items.reduce((sum: number, i: any) => sum + this.unitPrice(i) * Number(i.qty || 0), 0) + Number(this.draft.shippingFee || 0) + this.draftCardFee : 0; }
  get draftDeposit() {
    if (!this.draft || this.draft.paymentMethod !== 'cod') return 0;
    const subtotal = this.draftTotal - Number(this.draft.shippingFee || 0) - this.draftCardFee;
    if (subtotal < 50000) return 0;
    const totalQty = this.draft.items.reduce((sum: number, item: any) => sum + Number(item.qty || 0), 0);
    const special = totalQty >= 10 || this.draft.items.some((item: any) => /cưới|sự kiện|wedding|event/i.test(String(item.name || '')));
    const amount = special ? Math.round(subtotal * .7) : subtotal < 300000 ? 50000 : subtotal < 500000 ? 100000
      : Math.round(subtotal * (subtotal < 1000000 ? .3 : subtotal < 2000000 ? .4 : .5));
    return Math.min(this.draftTotal, amount);
  }
  upload(item: any, event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file || !this.active) return;
    if (file.size > 5 * 1024 * 1024) { this.error = 'Ảnh tối đa 5MB.'; return; }
    const form = new FormData(); form.append('image', file); this.busy = true; this.error = '';
    this.http.post<any>(`${this.url}/${this.active.requestId}/image`, form).subscribe({ next: data => { item.image = data.url; this.busy = false; this.cdr.markForCheck(); }, error: err => this.fail(err) });
  }
  propose() {
    if (this.busy || !this.active) return;
    // Merely opening the proposal workspace is not a commercial change. If
    // product, quantity, delivery and fee are untouched, follow the normal
    // direct-confirmation flow instead of asking the customer to reconfirm.
    if (!this.requiresCustomerProposal) { this.confirmOriginal(); return; }
    this.busy = true; this.error = '';
    this.http.post<any>(`${this.url}/${this.active.requestId}/proposal`, { ...this.draft, version: this.active.version,
      substitutions: Object.values(this.approvedReplacements) }).subscribe({
      next: quote => {
        // Swap the editor back to the request card immediately. The returned
        // immutable quote is now the current customer-facing request content;
        // the queue refresh and BOM refresh continue in the background.
        this.active = { ...this.active, quote, status: 'Chờ khách xác nhận', acceptedQuoteId: null,
          version: Number(this.active.version || 0) + 1, updatedAt: new Date().toISOString() };
        this.busy = false; this.editing = false; this.draft = null; this.status = '';
        this.options = null; this.catalogLoaded = false; this.sourcesLoaded = false;
        this.loadOptions(); this.load(true); this.cdr.markForCheck();
      }, error: err => this.fail(err),
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
