import { InventoryDialogComponent } from '../inventory-dialog';
import { InventoryReversalComponent } from '../inventory-reversal';
import { exportInventoryCsv } from '../inventory-csv';
import { InventoryPagerComponent } from '../inventory-pager';
import { CommonModule } from '@angular/common';
import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { InventoryTabsComponent } from '../inventory-tabs/inventory-tabs';
import {
  InvBomProduct,
  InvDocument,
  InvMaterial,
  InvMaterialDetail,
  InventoryApiService,
  inventoryErrorMessage,
} from '../../../services/inventory-api.service';
import { AdminApiService } from '../../../services/admin-api.service';

interface ExportLine {
  materialId: string;
  bomQty: number | null;
  quantity: number;
  note: string;
}

const TYPE_HELP: Record<string, string> = {
  'Làm hoa theo đơn': 'Nhân viên lấy NVL cho MỘT đơn MỘT lần khi bắt đầu cắm. Phần đang giữ của đơn được giải phóng; nếu lấy ít hơn phần giữ thì nhả phần dư. Không xuất lần 2 khi giao.',
  'Cắm bó sẵn': 'Xuất NVL theo BOM để cắm bó trưng bày; tồn thành phẩm của sản phẩm tăng đúng số bó. Khi bán bó này không trừ NVL lần nữa.',
  'Hao hụt/hỏng khi bảo quản': 'Hoa/NVL hỏng trong kho (chưa đánh dấu không đạt). Không phân bổ vào giá vốn từng bó.',
  'Xuất hủy NVL cách ly': 'Hủy phần đã đánh dấu "Không đạt" trước đó: giảm tồn thực và giải tỏa lượng không đạt.',
  'Điều chỉnh kiểm kê': 'Giảm tồn khi kiểm kê thấy thiếu so với sổ.',
  'Khác': 'Bắt buộc ghi chú lý do.',
};

/**
 * AD27–AD29 — Phiếu xuất kho: Nháp → Đã ghi nhận một lần, phân bổ FIFO nguồn nhập (hoa tươi), lưu giá vốn tại lúc xuất.
 */
@Component({
  selector: 'app-export-list',
  standalone: true,
  imports: [InventoryDialogComponent, InventoryReversalComponent, CommonModule, FormsModule, InventoryTabsComponent, InventoryPagerComponent],
  templateUrl: './export-list.html',
  styleUrls: ['../inventory.css', './export-list.css'],
})
export class ExportListComponent implements OnInit {
  exportCsv(): void { exportInventoryCsv('export-list', ['Mã phiếu','Loại','Đơn','Sản phẩm','Ngày xuất','Giá vốn','Trạng thái'], this.filtered().map(d => [d.PHIEU_XUAT_ID, d.LOAI_XUAT, d.DON_HANG_ID, d.SAN_PHAM_ID, d.NGAY_XUAT, d.TONG_GIA_VON, d.TRANG_THAI])); }
  readonly listPage = signal(1);
  readonly displayPage = computed(() => Math.min(this.listPage(), Math.max(1, Math.ceil(this.filtered().length / 15))));
  filtersOpen = false;
  @ViewChild(InventoryDialogComponent) private dialog!: InventoryDialogComponent;
  private readonly api = inject(InventoryApiService);
  private readonly route = inject(ActivatedRoute);
  /** Sales chỉ có quyền xem kho: ẩn nút lập phiếu (backend cũng chặn). */
  readonly canEdit = inject(AdminApiService).can('materials', 'create');

  readonly docs = signal<InvDocument[]>([]);
  readonly materials = signal<InvMaterial[]>([]);
  readonly products = signal<InvBomProduct[]>([]);
  readonly exportTypes = signal<string[]>(Object.keys(TYPE_HELP));
  readonly loading = signal(false);
  readonly error = signal('');
  readonly toast = signal<{ text: string; error?: boolean } | null>(null);
  readonly help = TYPE_HELP;

  statusFilter = '';
  typeFilter = '';
  search = '';
  private readonly tick = signal(0);
  readonly filtered = computed(() => {
    this.tick();
    const q = this.search.trim().toLowerCase();
    return this.docs().filter((d) => !q || `${d.PHIEU_XUAT_ID} ${d.DON_HANG_ID || ''} ${d.SAN_PHAM_ID || ''} ${d.GHI_CHU || ''}`.toLowerCase().includes(q));
  });

  readonly formOpen = signal(false);
  readonly saving = signal(false);
  readonly suggesting = signal(false);
  readonly formError = signal('');
  editingId: string | null = null;
  header = { type: 'Làm hoa theo đơn', orderId: '', productId: '', bundles: 1, exportedAt: '', note: '' };
  lines: ExportLine[] = [];
  readonly reversing = signal<InvDocument | null>(null);
  readonly viewing = signal<InvDocument | null>(null);

  ngOnInit(): void {
    this.api.meta().subscribe({ next: (m) => this.exportTypes.set(m.exportTypes), error: () => {} });
    this.api.materials().subscribe({ next: (r) => this.materials.set(r.materials), error: () => {} });
    this.api.bomProducts().subscribe({ next: (r) => this.products.set(r.items), error: () => {} });
    this.load();
    const q = this.route.snapshot.queryParamMap;
    if (q.get('new')) {
      this.openCreate();
      if (q.get('type')) this.header.type = q.get('type')!;
      if (q.get('orderId')) { this.header.orderId = q.get('orderId')!; this.suggest(); }
    }
  }

  load(): void { this.listPage.set(1);
    this.loading.set(true);
    this.api.documents('exports', { status: this.statusFilter, type: this.typeFilter }).subscribe({
      next: (r) => { this.docs.set(r.items); this.loading.set(false); this.error.set(''); },
      error: (e) => { this.error.set(inventoryErrorMessage(e)); this.loading.set(false); },
    });
  }
  refilter(): void { this.listPage.set(1); this.tick.update((x) => x + 1); }

  newLine(materialId = ''): ExportLine { return { materialId, bomQty: null, quantity: 0, note: '' }; }

  openCreate(): void {
    this.editingId = null;
    this.header = { type: 'Làm hoa theo đơn', orderId: '', productId: '', bundles: 1, exportedAt: '', note: '' };
    this.lines = [];
    this.productQuery = '';
    this.formError.set('');
    this.formOpen.set(true);
  }

  openEdit(doc: InvDocument): void {
    this.editingId = doc.PHIEU_XUAT_ID!;
    this.header = { type: doc.LOAI_XUAT || 'Khác', orderId: doc.DON_HANG_ID || '', productId: doc.SAN_PHAM_ID || '', bundles: doc.SO_BO || 1, exportedAt: '', note: doc.GHI_CHU || '' };
    this.lines = doc.details.map((d) => ({ materialId: d.NGUYEN_VAT_LIEU_ID, bomQty: d.SL_THEO_BOM ?? null, quantity: d.SO_LUONG_XUAT || 0, note: d.GHI_CHU || '' }));
    this.viewing.set(null);
    this.formError.set('');
    this.formOpen.set(true);
  }

  onTypeChange(): void {
    this.lines = [];
    if (this.header.type === 'Xuất hủy NVL cách ly') {
      this.lines = this.materials().filter((m) => m.damaged > 0).map((m) => ({ ...this.newLine(m.code), quantity: m.damaged }));
    }
  }

  /** Điền dòng theo BOM / lượng giữ của đơn. */
  suggest(): void {
    const t = this.header.type;
    if (t === 'Làm hoa theo đơn' && !this.header.orderId) { this.formError.set('Nhập mã đơn hàng trước.'); return; }
    if (t === 'Cắm bó sẵn' && !this.header.productId) { this.formError.set('Chọn sản phẩm trước.'); return; }
    this.suggesting.set(true);
    this.formError.set('');
    this.api.suggestExport({ type: t, orderId: this.header.orderId, productId: this.header.productId, bundles: this.header.bundles }).subscribe({
      next: (rows) => {
        this.suggesting.set(false);
        if (!rows.length) { this.formError.set('Không tìm thấy BOM / lượng giữ cho lựa chọn này.'); return; }
        this.lines = rows.map((r) => ({ materialId: r.materialId, bomQty: r.bomQty, quantity: r.quantity, note: '' }));
          },
      error: (e) => { this.suggesting.set(false); this.formError.set(inventoryErrorMessage(e)); },
    });
  }

  /* ---------- Cắm bó sẵn: tìm sản phẩm + số bó tự chọn ---------- */
  productQuery = '';
  readonly productTick = signal(0);
  readonly filteredProducts = computed(() => {
    this.productTick();
    const q = this.productQuery.trim().toLowerCase();
    const list = this.products();
    if (!q) return list;
    const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
    const nq = norm(q);
    return list.filter((p) => p.SAN_PHAM_ID === this.header.productId || norm(`${p.SAN_PHAM_ID} ${p.TEN_SAN_PHAM}`).includes(nq));
  });
  selectedProduct(): InvBomProduct | undefined { return this.products().find((p) => p.SAN_PHAM_ID === this.header.productId); }

  private readyMadeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Đổi sản phẩm hoặc số bó thì tính lại dòng NVL theo BOM × đúng số bó đã chọn. */
  onReadyMadeChange(): void {
    if (this.header.type !== 'Cắm bó sẵn') return;
    if (this.readyMadeTimer) clearTimeout(this.readyMadeTimer);
    const bundles = Math.floor(Number(this.header.bundles));
    if (!this.header.productId || !(bundles > 0)) { this.lines = []; return; }
    this.readyMadeTimer = setTimeout(() => this.suggest(), 250);
  }

  lineWarn(l: ExportLine): string {
    const m = this.materialById(l.materialId);
    if (!l.materialId) return 'Chưa chọn NVL';
    if (this.lines.filter((x) => x.materialId === l.materialId).length > 1) return 'NVL bị trùng';
    if (!m) return '';
    if (this.header.type === 'Xuất hủy NVL cách ly') return l.quantity > m.damaged ? `Chỉ còn ${m.damaged} đang cách ly` : '';
    if (this.header.type !== 'Làm hoa theo đơn' && l.quantity > m.available) return `Vượt khả dụng (${m.available})`;
    return '';
  }

  async save(post: boolean): Promise<void> {
    const t = this.header.type;
    if (t === 'Làm hoa theo đơn' && !this.header.orderId) { this.formError.set('Xuất theo đơn phải có mã đơn hàng.'); return; }
    if (t === 'Cắm bó sẵn' && (!this.header.productId || !(this.header.bundles > 0) || !Number.isInteger(Number(this.header.bundles)))) { this.formError.set('Cắm bó sẵn phải chọn sản phẩm và số bó là số nguyên ≥ 1.'); return; }
    if (t === 'Khác' && !this.header.note.trim()) { this.formError.set('Loại "Khác" bắt buộc ghi chú.'); return; }
    const lines = this.lines.filter((l) => l.materialId);
    if (!lines.length) { this.formError.set('Phiếu phải có ít nhất một NVL.'); return; }
    if (lines.some((l) => this.lines.filter((x) => x.materialId === l.materialId).length > 1)) { this.formError.set('NVL bị trùng.'); return; }
    if (post && !(await this.dialog.confirm('Ghi nhận phiếu xuất? Tồn thực bị trừ ngay và phiếu không sửa được nữa.'))) return;
    const body = {
      type: t, orderId: this.header.orderId, productId: this.header.productId, bundles: this.header.bundles, note: this.header.note,
      exportedAt: this.header.exportedAt ? new Date(this.header.exportedAt).toISOString() : undefined,
      details: lines.map((l) => ({ materialId: l.materialId, bomQty: l.bomQty, quantity: Number(l.quantity || 0), note: l.note })),
      post,
    };
    this.saving.set(true);
    this.api.saveDocument('exports', body, this.editingId || undefined).subscribe({
      next: (doc) => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.notify(post ? `Đã ghi nhận ${doc.PHIEU_XUAT_ID || this.editingId}. Giá vốn: ${(doc.TONG_GIA_VON || 0).toLocaleString('vi-VN')}đ` : 'Đã lưu phiếu nháp.');
        this.load();
        this.api.materials().subscribe({ next: (r) => this.materials.set(r.materials) });
      },
      error: (e) => { this.saving.set(false); this.formError.set(inventoryErrorMessage(e)); this.load(); },
    });
  }

  async post(doc: InvDocument): Promise<void> {
    if (!(await this.dialog.confirm(`Ghi nhận ${doc.PHIEU_XUAT_ID}? Tồn thực bị trừ ngay.`))) return;
    this.api.postDocument('exports', doc.PHIEU_XUAT_ID!).subscribe({
      next: (r) => { this.notify(r.alreadyPosted ? 'Phiếu đã ghi nhận trước đó — không trừ lần 2.' : 'Đã ghi nhận phiếu xuất.'); this.viewing.set(null); this.load(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }
  async cancel(doc: InvDocument): Promise<void> {
    const reason = await this.dialog.prompt('Nhập lý do hủy phiếu nháp.');
    if (reason === null) return;
    this.api.cancelDocument('exports', doc.PHIEU_XUAT_ID!, reason).subscribe({
      next: () => { this.notify('Đã hủy phiếu.'); this.viewing.set(null); this.load(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }
  async remove(doc: InvDocument): Promise<void> {
    if (!(await this.dialog.confirm(`Xóa hẳn phiếu ${doc.PHIEU_XUAT_ID}?`))) return;
    this.api.deleteDocument('exports', doc.PHIEU_XUAT_ID!).subscribe({
      next: () => { this.notify('Đã xóa phiếu.'); this.viewing.set(null); this.load(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  materialById(id: string): InvMaterial | undefined { return this.materials().find((m) => m.code === id); }
  productName(id: string | null | undefined): string { return this.products().find((p) => p.SAN_PHAM_ID === id)?.TEN_SAN_PHAM || id || ''; }
  statusClass(s: string): string { return s === 'Nháp' ? 'draft' : (s === 'Đã hủy' || s === 'Đã đảo') ? 'cancelled' : 'posted'; }
  totalQty(doc: InvDocument): number { return doc.details.reduce((s, d) => s + Number(d.SO_LUONG_XUAT || 0), 0); }
  notify(text: string, error = false): void { this.toast.set({ text, error }); setTimeout(() => this.toast.set(null), error ? 7000 : 3500); }
}
