import { formatDateTime24 } from '../../../shared/date-time';
import { InventoryDialogComponent } from '../inventory-dialog';
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { InventoryTabsComponent } from '../inventory-tabs/inventory-tabs';
import { exportInventoryCsv } from '../inventory-csv';
import { InvAlerts, InvBomProduct, InvPrepOrder, InventoryApiService, inventoryErrorMessage } from '../../../services/inventory-api.service';
import { AdminApiService } from '../../../services/admin-api.service';

/** So khớp không dấu, không phân biệt hoa thường. */
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

type Tab = 'alerts' | 'reservations' | 'prep' | 'finished' | 'ledger' | 'reconcile';

const MOVEMENT_LABEL: Record<string, string> = {
  NHAP: 'Nhập kho', DAO_NHAP: 'Đảo nhập kho', KHOI_PHUC_GIU: 'Khôi phục giữ sau đảo', DAO_CAM_SAN: 'Đảo cắm bó sẵn', DAO_XUAT: 'Đảo xuất kho', DIEU_CHINH_NHAP: 'Điều chỉnh tồn theo PN', XUAT: 'Xuất kho', GIU: 'Giữ tồn', NHA_GIU: 'Nhả giữ', KET_THUC_GIU: 'Kết thúc giữ (xuất)',
  DANH_DAU_KHONG_DAT: 'Đánh dấu không đạt', XUAT_HUY: 'Xuất hủy / hao hụt', NHAP_THANH_PHAM: 'Nhập thành phẩm',
  XUAT_THANH_PHAM: 'Giao thành phẩm', HUY_THANH_PHAM: 'Hủy thành phẩm', CHUYEN_GIU_CHINH_THUC: 'Chuyển giữ chính thức',
};

/**
 * Tổng quan kho (AD08): cảnh báo, giữ tồn, đơn cần chuẩn bị (theo T), thành phẩm cắm sẵn, sổ biến động, đối soát.
 */
@Component({
  selector: 'app-stock-overview',
  standalone: true,
  imports: [InventoryDialogComponent, CommonModule, FormsModule, InventoryTabsComponent, RouterLink],
  templateUrl: './stock-overview.html',
  styleUrls: ['../inventory.css'],
})
export class StockOverviewComponent implements OnInit {
  @ViewChild(InventoryDialogComponent) private dialog!: InventoryDialogComponent;
  exportCsv(): void {
    const tab = this.tab();
    if (tab === 'alerts') {
      const a = this.alerts();
      if (!a) return;
      exportInventoryCsv('canh-bao-kho', ['Nhóm', 'Đối tượng', 'Tên', 'Khả dụng', 'Thiếu', 'Đơn', 'Thời điểm cần'], [
        ...a.materialAlerts.map(m => ['Nguyên liệu', m.materialId, m.name, m.available, '', '', '']),
        ...a.forecastShortages.map(m => ['Dự báo thiếu', m.materialId, m.name, m.available, m.missing, m.orderId, m.neededAt]),
        ...a.productAlerts.map(p => ['Sản phẩm', p.productId, p.name, p.sellable, '', '', '']),
      ]);
      return;
    }
    if (tab === 'prep') {
      exportInventoryCsv('don-can-chuan-bi', ['Đơn', 'Người nhận', 'Giờ giao', 'T', 'Trạng thái NVL', 'Sản phẩm', 'NVL'], this.prep().map(o => [
        o.orderId, o.receiverName, o.deliveryAt || '', o.prepAt || '', o.stateLabel,
        o.products.map(p => `${p.name} x${p.quantity}`).join('; '), o.materials.map(m => `${m.name} ${m.quantity} ${m.unit} (${m.status})`).join('; ')]));
      return;
    }
    const rows: Record<string, any>[] = tab === 'reservations' ? this.reservations()
      : tab === 'finished' ? this.finished() : tab === 'ledger' ? this.ledger() : this.reconcileResult()?.diffs || [];
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(key => key !== '_id');
    exportInventoryCsv('kho-' + tab, keys.length ? keys : ['Kết quả'], rows.map(row => keys.map(key => typeof row[key] === 'object' ? JSON.stringify(row[key]) : row[key])));
  }
  private readonly api = inject(InventoryApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly tab = signal<Tab>('alerts');
  readonly alerts = signal<InvAlerts | null>(null);
  readonly reservations = signal<any[]>([]);
  readonly prep = signal<InvPrepOrder[]>([]);
  readonly prepLoading = signal(false);
  readonly holdReminderHours = signal(24);
  readonly highlight = signal('');
  /** Form nhập/đổi T đang mở (một đơn tại một thời điểm). */
  readonly tForm = signal<{ orderId: string; change: boolean; value: string; reason: string; error: string; saving: boolean } | null>(null);
  readonly finished = signal<any[]>([]);
  readonly ledger = signal<any[]>([]);
  readonly reconcileResult = signal<{ ok: boolean; checkedMaterials: number; diffs: any[] } | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly toast = signal<{ text: string; error?: boolean } | null>(null);
  readonly movementLabel = MOVEMENT_LABEL;
  /** Nhóm nhắc việc đang mở rộng (mặc định chỉ hiện 8 đơn đầu). */
  readonly expandedBlocks = signal<Set<string>>(new Set());
  toggleBlock(title: string): void {
    const next = new Set(this.expandedBlocks());
    next.has(title) ? next.delete(title) : next.add(title);
    this.expandedBlocks.set(next);
  }

  ledgerFilter = { materialId: '', type: '', orderId: '', from: '', to: '' };

  /** Sales chỉ được XEM kho: ẩn các nút thao tác (backend cũng chặn). */
  readonly canEdit = inject(AdminApiService).can('materials', 'update');

  /* ---------- Tìm kiếm chung cho mọi tab ---------- */
  readonly query = signal('');
  private match(...values: unknown[]): boolean {
    const q = norm(this.query().trim());
    return !q || values.some(v => norm(v).includes(q));
  }
  readonly fMaterialAlerts = computed(() => (this.alerts()?.materialAlerts || []).filter(m => this.match(m.materialId, m.name)));
  readonly fForecast = computed(() => (this.alerts()?.forecastShortages || []).filter(f => this.match(f.orderId, f.materialId, f.name)));
  readonly fProductAlerts = computed(() => (this.alerts()?.productAlerts || []).filter(p => this.match(p.productId, p.name)));
  readonly fQuality = computed(() => (this.alerts()?.qualityChecks || []).filter(q => this.match(q.materialId, q.name, q.sourceId)));
  readonly fReservations = computed(() => this.reservations().filter(r => this.match(r.MA_GIU_TON, r.DON_HANG_ID, r.MA_PHIEN_THANH_TOAN, r.SAN_PHAM_ID, r.TEN)));
  readonly fPrep = computed(() => this.prep().filter(o => this.match(o.orderId, o.receiverName, ...o.products.map(p => p.name), ...o.materials.map(m => m.name))));
  readonly fLedger = computed(() => this.ledger().filter(m => this.match(m.NGUYEN_VAT_LIEU_ID, m.SAN_PHAM_ID, m.TEN, m.CHUNG_TU_ID, m.DON_HANG_ID)));

  /* ---------- Tồn thành phẩm & khả năng làm (Sales tra cứu trước khi nhận đơn) ---------- */
  readonly stockProducts = signal<InvBomProduct[]>([]);
  readonly fStockProducts = computed(() => this.stockProducts()
    .filter(p => this.match(p.SAN_PHAM_ID, p.TEN_SAN_PHAM))
    .sort((a, b) => (b.finishedAvailable + b.buildable) - (a.finishedAvailable + a.buildable)));
  finishedOf(productId: string): any { return this.finished().find(f => f.SAN_PHAM_ID === productId); }
  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap;
    const orderId = q.get('orderId');
    if (orderId || q.get('tab') === 'prep') { this.loadAlerts(); this.openPrep(orderId || ''); return; }
    this.loadAlerts();
  }

  setTab(t: Tab): void {
    this.tab.set(t);
    if (t === 'alerts') this.loadAlerts();
    if (t === 'reservations') this.loadReservations();
    if (t === 'prep') this.loadPrep();
    if (t === 'finished') this.loadFinished();
    if (t === 'ledger') this.loadLedger();
  }

  loadAlerts(): void {
    this.loading.set(true);
    this.api.alerts().subscribe({
      next: (a) => { this.alerts.set(a); this.loading.set(false); this.error.set(''); },
      error: (e) => { this.error.set(inventoryErrorMessage(e)); this.loading.set(false); },
    });
  }
  loadReservations(): void { this.api.reservations().subscribe({ next: (r) => this.reservations.set(r.items), error: (e) => this.notify(inventoryErrorMessage(e), true) }); }
  loadPrep(): void {
    this.prepLoading.set(true);
    this.api.preparation().subscribe({
      next: (r) => { this.prep.set(r.orders); this.holdReminderHours.set(r.holdReminderHours); this.prepLoading.set(false); this.scrollToHighlight(); },
      error: (e) => { this.prepLoading.set(false); this.notify(inventoryErrorMessage(e), true); },
    });
  }
  /** Mở tab "Đơn cần chuẩn bị" và làm nổi bật một đơn (từ tab Đang giữ / Cảnh báo / link ?orderId=). */
  openPrep(orderId: string): void {
    this.highlight.set(orderId);
    this.setTab('prep');
  }
  private scrollToHighlight(): void {
    const id = this.highlight();
    if (!id) return;
    setTimeout(() => document.getElementById('prep-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }
  loadFinished(): void {
    this.api.finishedGoods().subscribe({ next: (r) => this.finished.set(r.items), error: (e) => this.notify(inventoryErrorMessage(e), true) });
    this.api.bomProducts().subscribe({ next: (r) => this.stockProducts.set(r.items), error: (e) => this.notify(inventoryErrorMessage(e), true) });
  }
  loadLedger(): void {
    const f = this.ledgerFilter;
    this.api.movements({ ...f, from: f.from ? new Date(f.from).toISOString() : '', to: f.to ? new Date(f.to + 'T23:59:59').toISOString() : '', limit: 300 })
      .subscribe({ next: (r) => this.ledger.set(r.items), error: (e) => this.notify(inventoryErrorMessage(e), true) });
  }

  /* ---------- hành động ---------- */
  createPo(materialId: string, qty: number): void {
    this.router.navigate(['/materials/purchase-orders'], { queryParams: { new: 1, material: materialId, qty } });
  }
  openMaterial(materialId: string, sourceId: string): void {
    this.router.navigate(['/materials'], { queryParams: { material: materialId, source: sourceId } });
  }

  async release(r: any): Promise<void> {
    if (!(await this.dialog.confirm(`Nhả giữ ${r.SO_LUONG} ${r.TEN || ''} (${r.MA_GIU_TON})?`))) return;
    this.api.releaseReservations({ reservationIds: [r.MA_GIU_TON], reason: 'Admin nhả giữ thủ công' }).subscribe({
      next: (x) => { this.notify(`Đã nhả ${x.released} bản ghi giữ.`); this.loadReservations(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  private toLocalInput(value: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}T${p(value.getHours())}:${p(value.getMinutes())}`;
  }
  openTForm(o: InvPrepOrder): void {
    const base = o.prepAt ? new Date(o.prepAt)
      : o.deliveryAt ? new Date(new Date(o.deliveryAt).getTime() - 3 * 3_600_000) : new Date(Date.now() + 3_600_000);
    this.tForm.set({ orderId: o.orderId, change: !!o.prepAt, value: this.toLocalInput(base), reason: '', error: '', saving: false });
  }
  patchTForm(change: Partial<{ value: string; reason: string }>): void {
    const f = this.tForm();
    if (f) this.tForm.set({ ...f, ...change });
  }
  prepTitle(o: InvPrepOrder): string {
    const at = o.prepSetAt ? formatDateTime24(o.prepSetAt) : '';
    const changes = o.prepHistory.length > 1 ? ` · đã đổi ${o.prepHistory.length - 1} lần` : '';
    return `Nhập bởi ${o.prepSetBy || '—'}${at ? ' lúc ' + at : ''}${changes}`;
  }
  prepAlertBlocks(pa: NonNullable<InvAlerts['preparationAlerts']>) {
    return [
      { list: pa.paidWithoutT, title: 'Đơn đã thanh toán chưa có T', cls: 'warn', hint: 'Nhập T để kho xếp lịch giữ và xuất NVL.' },
      { list: pa.holdDueSoon, title: `Còn ≤ ${pa.holdReminderHours} giờ đến T mà chưa giữ`, cls: 'warn', hint: 'Kiểm tra dự báo và bấm Giữ chính thức.' },
      { list: pa.overdueExport, title: 'Đã quá T mà chưa xuất NVL', cls: 'error', hint: 'Lập phiếu xuất NVL khi cắm hoặc đổi T.' },
    ];
  }
  saveT(): void {
    const f = this.tForm();
    if (!f) return;
    const at = new Date(f.value);
    if (!f.value || !Number.isFinite(at.getTime())) { this.tForm.set({ ...f, error: 'Chọn thời điểm T hợp lệ.' }); return; }
    this.tForm.set({ ...f, saving: true, error: '' });
    this.api.setPrepTime(f.orderId, at.toISOString(), f.reason.trim()).subscribe({
      next: () => { this.tForm.set(null); this.notify(f.change ? 'Đã đổi T. Dự báo NVL được tính lại.' : 'Đã nhập T.'); this.loadPrep(); },
      error: (e) => this.tForm.set({ ...f, saving: false, error: inventoryErrorMessage(e) }),
    });
  }
  async reserveNow(o: InvPrepOrder): Promise<void> {
    const short = o.forecastShortages.length ? ` Dự báo đang thiếu ${o.forecastShortages.map(x => x.name).join(', ')}; nếu không đủ hàng hệ thống sẽ báo và không giữ phần nào.` : '';
    if (!(await this.dialog.confirm(`Giữ chính thức NVL cho đơn ${o.orderId}?${short}`))) return;
    this.api.reserveDemand(o.orderId).subscribe({
      next: () => { this.notify('Đã giữ chính thức NVL cho đơn.'); this.loadPrep(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  issueForOrder(orderId: string): void {
    this.router.navigate(['/materials/exports'], { queryParams: { new: 1, type: 'Làm hoa theo đơn', orderId } });
  }

  async dispose(p: any): Promise<void> {
    const v = await this.dialog.prompt(`Hủy bao nhiêu bó "${p.TEN_SAN_PHAM}" không đạt? (khả dụng ${p.KHA_DUNG})`, '1', {title: 'Hủy thành phẩm', type: 'number', min: 1, max: p.KHA_DUNG});
    if (!v) return;
    const note = await this.dialog.prompt('Lý do hủy thành phẩm', 'Bó không còn đạt chất lượng', {title: 'Xác nhận hủy thành phẩm', label: 'Hủy thành phẩm'});
    if (note === null) return;
    this.api.disposeFinished(p.SAN_PHAM_ID, Number(v), note).subscribe({
      next: () => { this.notify('Đã hủy thành phẩm.'); this.loadFinished(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  async reconcile(fix: boolean): Promise<void> {
    if (fix && !(await this.dialog.confirm('Ghi đè bộ đếm tồn theo sổ biến động? Chỉ dùng khi đã kiểm tra chênh lệch.'))) return;
    this.api.reconcile(fix).subscribe({
      next: (r) => { this.reconcileResult.set(r); this.notify(r.ok ? 'Đối soát khớp.' : `Có ${r.diffs.length} chênh lệch.`, !r.ok); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  holdLabel(s: string): string { return s === 'TAM_CHO_QR' ? 'Giữ tạm QR' : s === 'CHINH_THUC' ? 'Giữ chính thức' : s; }
  notify(text: string, error = false): void { this.toast.set({ text, error }); setTimeout(() => this.toast.set(null), error ? 7000 : 3500); }
}
