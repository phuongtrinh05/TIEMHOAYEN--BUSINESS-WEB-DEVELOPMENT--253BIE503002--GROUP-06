import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { InventoryTabsComponent } from '../inventory-tabs/inventory-tabs';
import {
  InvBomProduct,
  InvDocument,
  InvMaterial,
  InventoryApiService,
  inventoryErrorMessage,
} from '../../../services/inventory-api.service';

interface ExportLine {
  materialId: string;
  bomQty: number | null;
  quantity: number;
  sourceId: string;
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
  imports: [CommonModule, FormsModule, InventoryTabsComponent],
  templateUrl: './export-list.html',
  styleUrls: ['../inventory.css', './export-list.css'],
})
export class ExportListComponent implements OnInit {
  private readonly api = inject(InventoryApiService);
  private readonly route = inject(ActivatedRoute);

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

  load(): void {
    this.loading.set(true);
    this.api.documents('exports', { status: this.statusFilter, type: this.typeFilter }).subscribe({
      next: (r) => { this.docs.set(r.items); this.loading.set(false); this.error.set(''); },
      error: (e) => { this.error.set(inventoryErrorMessage(e)); this.loading.set(false); },
    });
  }
  refilter(): void { this.tick.update((x) => x + 1); }

  newLine(materialId = ''): ExportLine { return { materialId, bomQty: null, quantity: 0, sourceId: '', note: '' }; }

  openCreate(): void {
    this.editingId = null;
    this.header = { type: 'Làm hoa theo đơn', orderId: '', productId: '', bundles: 1, exportedAt: '', note: '' };
    this.lines = [];
    this.formError.set('');
    this.formOpen.set(true);
  }

  openEdit(doc: InvDocument): void {
    this.editingId = doc.PHIEU_XUAT_ID!;
    this.header = { type: doc.LOAI_XUAT || 'Khác', orderId: doc.DON_HANG_ID || '', productId: doc.SAN_PHAM_ID || '', bundles: doc.SO_BO || 1, exportedAt: '', note: doc.GHI_CHU || '' };
    this.lines = doc.details.map((d) => ({ materialId: d.NGUYEN_VAT_LIEU_ID, bomQty: d.SL_THEO_BOM ?? null, quantity: d.SO_LUONG_XUAT || 0, sourceId: (d as any).PHIEU_NHAP_CHI_DINH || '', note: d.GHI_CHU || '' }));
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
        this.lines = rows.map((r) => ({ materialId: r.materialId, bomQty: r.bomQty, quantity: r.quantity, sourceId: '', note: '' }));
      },
      error: (e) => { this.suggesting.set(false); this.formError.set(inventoryErrorMessage(e)); },
    });
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

  save(post: boolean): void {
    const t = this.header.type;
    if (t === 'Làm hoa theo đơn' && !this.header.orderId) { this.formError.set('Xuất theo đơn phải có mã đơn hàng.'); return; }
    if (t === 'Cắm bó sẵn' && (!this.header.productId || !(this.header.bundles > 0))) { this.formError.set('Cắm bó sẵn phải chọn sản phẩm và số bó.'); return; }
    if (t === 'Khác' && !this.header.note.trim()) { this.formError.set('Loại "Khác" bắt buộc ghi chú.'); return; }
    const lines = this.lines.filter((l) => l.materialId);
    if (!lines.length) { this.formError.set('Phiếu phải có ít nhất một NVL.'); return; }
    if (lines.some((l) => this.lines.filter((x) => x.materialId === l.materialId).length > 1)) { this.formError.set('NVL bị trùng.'); return; }
    if (post && !confirm('Ghi nhận phiếu xuất? Tồn thực bị trừ ngay và phiếu không sửa được nữa.')) return;
    const body = {
      type: t, orderId: this.header.orderId, productId: this.header.productId, bundles: this.header.bundles, note: this.header.note,
      exportedAt: this.header.exportedAt ? new Date(this.header.exportedAt).toISOString() : undefined,
      details: lines.map((l) => ({ materialId: l.materialId, bomQty: l.bomQty, quantity: Number(l.quantity || 0), sourceId: l.sourceId, note: l.note })),
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

  post(doc: InvDocument): void {
    if (!confirm(`Ghi nhận ${doc.PHIEU_XUAT_ID}? Tồn thực bị trừ ngay.`)) return;
    this.api.postDocument('exports', doc.PHIEU_XUAT_ID!).subscribe({
      next: (r) => { this.notify(r.alreadyPosted ? 'Phiếu đã ghi nhận trước đó — không trừ lần 2.' : 'Đã ghi nhận phiếu xuất.'); this.viewing.set(null); this.load(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }
  cancel(doc: InvDocument): void {
    const reason = prompt('Lý do hủy phiếu nháp?') ?? '';
    this.api.cancelDocument('exports', doc.PHIEU_XUAT_ID!, reason).subscribe({
      next: () => { this.notify('Đã hủy phiếu.'); this.viewing.set(null); this.load(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }
  remove(doc: InvDocument): void {
    if (!confirm(`Xóa hẳn phiếu ${doc.PHIEU_XUAT_ID}?`)) return;
    this.api.deleteDocument('exports', doc.PHIEU_XUAT_ID!).subscribe({
      next: () => { this.notify('Đã xóa phiếu.'); this.viewing.set(null); this.load(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  materialById(id: string): InvMaterial | undefined { return this.materials().find((m) => m.code === id); }
  productName(id: string | null | undefined): string { return this.products().find((p) => p.SAN_PHAM_ID === id)?.TEN_SAN_PHAM || id || ''; }
  statusClass(s: string): string { return s === 'Nháp' ? 'draft' : s === 'Đã hủy' ? 'cancelled' : 'posted'; }
  totalQty(doc: InvDocument): number { return doc.details.reduce((s, d) => s + Number(d.SO_LUONG_XUAT || 0), 0); }
  notify(text: string, error = false): void { this.toast.set({ text, error }); setTimeout(() => this.toast.set(null), error ? 7000 : 3500); }
}
