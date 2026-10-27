import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { InventoryTabsComponent } from '../inventory-tabs/inventory-tabs';
import {
  InvDocument,
  InvMaterial,
  InvPurchaseOrder,
  InvSupplier,
  InventoryApiService,
  inventoryErrorMessage,
} from '../../../services/inventory-api.service';

interface ImportLine {
  materialId: string;
  expectedQty: number | null;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  unitPrice: number;
  chargesAcceptedOnly: boolean;
  note: string;
}

const toLocalInput = (d: Date | string | null | undefined) => {
  const date = d ? new Date(d) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * AD24–AD26 — Phiếu nhập kho: Nháp → Đã ghi nhận (một lần). Chỉ SL ĐẠT vào tồn.
 */
@Component({
  selector: 'app-import-list',
  standalone: true,
  imports: [CommonModule, FormsModule, InventoryTabsComponent],
  templateUrl: './import-list.html',
  styleUrls: ['../inventory.css', './import-list.css'],
})
export class ImportListComponent implements OnInit {
  private readonly api = inject(InventoryApiService);
  private readonly route = inject(ActivatedRoute);

  readonly docs = signal<InvDocument[]>([]);
  readonly materials = signal<InvMaterial[]>([]);
  readonly suppliers = signal<InvSupplier[]>([]);
  readonly purchaseOrders = signal<InvPurchaseOrder[]>([]);
  readonly importTypes = signal<string[]>(['Nhập mua NCC', 'Tồn đầu kỳ', 'Nhập hoàn', 'Điều chỉnh tăng']);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly toast = signal<{ text: string; error?: boolean } | null>(null);

  statusFilter = '';
  typeFilter = '';
  supplierFilter = '';
  search = '';
  private readonly tick = signal(0);

  readonly filtered = computed(() => {
    this.tick();
    const q = this.search.trim().toLowerCase();
    return this.docs().filter((d) =>
      (!q || `${d.PHIEU_NHAP_ID} ${d.TEN_NHA_CUNG_CAP} ${d.PO_ID || ''} ${d.GHI_CHU || ''}`.toLowerCase().includes(q)));
  });

  // Form
  readonly formOpen = signal(false);
  readonly saving = signal(false);
  readonly formError = signal('');
  editingId: string | null = null;
  header = { type: 'Nhập mua NCC', supplierId: '', purchaseOrderId: '', originalExportId: '', receivedAt: toLocalInput(null), note: '' };
  lines: ImportLine[] = [];

  readonly viewing = signal<InvDocument | null>(null);
  private pendingPoId: string | null = null;

  ngOnInit(): void {
    this.api.meta().subscribe({ next: (m) => this.importTypes.set(m.importTypes), error: () => {} });
    this.api.materials().subscribe({ next: (r) => this.materials.set(r.materials), error: () => {} });
    this.api.suppliers().subscribe({ next: (r) => this.suppliers.set(r.suppliers), error: () => {} });
    this.loadPurchaseOrders();
    this.load();
    const q = this.route.snapshot.queryParamMap;
    if (q.get('new')) {
      this.openCreate();
      const material = q.get('material');
      if (material) this.lines = [this.newLine(material)];
      const po = q.get('po');
      if (po) this.pendingPoId = po;
    }
  }

  load(): void {
    this.loading.set(true);
    this.api.documents('imports', { status: this.statusFilter, type: this.typeFilter, supplierId: this.supplierFilter }).subscribe({
      next: (r) => { this.docs.set(r.items); this.loading.set(false); this.error.set(''); },
      error: (e) => { this.error.set(inventoryErrorMessage(e)); this.loading.set(false); },
    });
  }

  loadPurchaseOrders(): void {
    this.api.purchaseOrders().subscribe({
      next: (r) => {
        this.purchaseOrders.set(r.purchaseOrders);
        // mở từ nút "Nhận hàng" của PO → điền sẵn NVL còn chờ giao
        if (this.pendingPoId) { this.header.purchaseOrderId = this.pendingPoId; this.pendingPoId = null; this.onPoChange(); }
      },
      error: () => {},
    });
  }

  refilter(): void { this.tick.update((x) => x + 1); }

  /* ---------- Form ---------- */
  newLine(materialId = ''): ImportLine {
    const m = this.materialById(materialId);
    return { materialId, expectedQty: null, receivedQty: 0, acceptedQty: 0, rejectedQty: 0, unitPrice: m?.importPrice || 0, chargesAcceptedOnly: false, note: '' };
  }

  openCreate(): void {
    this.editingId = null;
    this.header = { type: 'Nhập mua NCC', supplierId: '', purchaseOrderId: '', originalExportId: '', receivedAt: toLocalInput(null), note: '' };
    this.lines = [this.newLine()];
    this.formError.set('');
    this.formOpen.set(true);
  }

  openEdit(doc: InvDocument): void {
    this.editingId = doc.PHIEU_NHAP_ID!;
    this.header = {
      type: doc.LOAI_NHAP || 'Nhập mua NCC', supplierId: doc.NHA_CUNG_CAP_ID || '', purchaseOrderId: doc.PO_ID || '',
      originalExportId: (doc as any).PX_GOC_ID || '', receivedAt: toLocalInput(doc.THOI_DIEM_NHAN || doc.NGAY_NHAP), note: doc.GHI_CHU || '',
    };
    this.lines = doc.details.map((d) => ({
      materialId: d.NGUYEN_VAT_LIEU_ID, expectedQty: d.SL_DU_KIEN ?? null, receivedQty: d.SL_THUC_NHAN ?? d.SO_LUONG_NHAP ?? 0,
      acceptedQty: d.SL_DAT ?? 0, rejectedQty: d.SL_KHONG_DAT ?? 0, unitPrice: d.DON_GIA_NHAP ?? 0, chargesAcceptedOnly: !!d.NCC_CHI_TINH_SL_DAT, note: d.GHI_CHU || '',
    }));
    this.formError.set('');
    this.viewing.set(null);
    this.formOpen.set(true);
  }

  supplierPOs(): InvPurchaseOrder[] {
    return this.purchaseOrders().filter((p) => ['Đang giao', 'Chờ NCC xác nhận'].includes(p.TRANG_THAI) && (!this.header.supplierId || p.NHA_CUNG_CAP_ID === this.header.supplierId));
  }

  /** Chọn PO → điền NVL còn chờ giao (SL đặt − SL đã nhận). */
  onPoChange(): void {
    const po = this.purchaseOrders().find((p) => p.PO_ID === this.header.purchaseOrderId);
    if (!po) return;
    this.header.supplierId = po.NHA_CUNG_CAP_ID;
    this.lines = po.CHI_TIET
      .map((l) => {
        const pending = Math.max(0, l.SL_DAT - (l.SL_DA_NHAN || 0));
        // điền sẵn thực nhận = đạt = còn chờ giao; nhân viên sửa theo kiểm đếm thực tế
        return { ...this.newLine(l.NGUYEN_VAT_LIEU_ID), expectedQty: pending, receivedQty: pending, acceptedQty: pending, unitPrice: l.DON_GIA_DU_KIEN };
      })
      .filter((l) => (l.expectedQty || 0) > 0);
  }

  onReceivedChange(line: ImportLine): void {
    line.acceptedQty = Math.max(0, Number(line.receivedQty || 0) - Number(line.rejectedQty || 0));
  }

  onRejectedChange(line: ImportLine): void {
    line.rejectedQty = Math.min(Number(line.rejectedQty || 0), Number(line.receivedQty || 0));
    line.acceptedQty = Math.max(0, Number(line.receivedQty || 0) - Number(line.rejectedQty || 0));
  }

  onMaterialChange(line: ImportLine): void {
    const m = this.materialById(line.materialId);
    if (m && !line.unitPrice) line.unitPrice = m.importPrice;
  }

  lineAmount(l: ImportLine): number {
    return Math.round((l.chargesAcceptedOnly ? l.acceptedQty : l.receivedQty) * (l.unitPrice || 0));
  }

  lineUnitCost(l: ImportLine): number {
    return l.acceptedQty > 0 ? Math.round(this.lineAmount(l) / l.acceptedQty) : l.unitPrice;
  }

  totalAmount(): number { return this.lines.reduce((s, l) => s + this.lineAmount(l), 0); }

  lineError(l: ImportLine): string {
    if (!l.materialId) return 'Chưa chọn NVL';
    if (Math.abs(Number(l.acceptedQty) + Number(l.rejectedQty) - Number(l.receivedQty)) > 1e-9) return 'Đạt + không đạt ≠ thực nhận';
    if (this.lines.filter((x) => x.materialId === l.materialId).length > 1) return 'NVL bị trùng';
    return '';
  }

  save(post: boolean): void {
    if (this.header.type === 'Nhập mua NCC' && !this.header.supplierId) { this.formError.set('Phiếu nhập mua bắt buộc chọn nhà cung cấp.'); return; }
    const lines = this.lines.filter((l) => l.materialId);
    if (!lines.length) { this.formError.set('Phiếu phải có ít nhất một NVL.'); return; }
    const bad = lines.map((l) => this.lineError(l)).find(Boolean);
    if (bad) { this.formError.set(bad); return; }
    if (post && !confirm('Ghi nhận phiếu? Sau khi ghi nhận, tồn tăng theo SL đạt và phiếu không sửa được nữa.')) return;
    const body = {
      ...this.header,
      receivedAt: new Date(this.header.receivedAt).toISOString(),
      details: lines,
      post,
    };
    this.saving.set(true);
    this.api.saveDocument('imports', body, this.editingId || undefined).subscribe({
      next: (doc) => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.notify(post ? `Đã ghi nhận ${doc.PHIEU_NHAP_ID || this.editingId}. Tồn đã cập nhật.` : 'Đã lưu phiếu nháp.');
        this.load();
        this.loadPurchaseOrders();
      },
      error: (e) => { this.saving.set(false); this.formError.set(inventoryErrorMessage(e)); this.load(); },
    });
  }

  /* ---------- Hành động trên phiếu ---------- */
  post(doc: InvDocument): void {
    if (!confirm(`Ghi nhận ${doc.PHIEU_NHAP_ID}? Tồn sẽ tăng theo SL đạt.`)) return;
    this.api.postDocument('imports', doc.PHIEU_NHAP_ID!).subscribe({
      next: (r) => { this.notify(r.alreadyPosted ? 'Phiếu đã được ghi nhận trước đó — không cộng tồn lần 2.' : 'Đã ghi nhận phiếu nhập.'); this.viewing.set(null); this.load(); this.loadPurchaseOrders(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  cancel(doc: InvDocument): void {
    const reason = prompt('Lý do hủy phiếu nháp?') ?? '';
    this.api.cancelDocument('imports', doc.PHIEU_NHAP_ID!, reason).subscribe({
      next: () => { this.notify('Đã hủy phiếu nháp.'); this.viewing.set(null); this.load(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  remove(doc: InvDocument): void {
    if (!confirm(`Xóa hẳn phiếu ${doc.PHIEU_NHAP_ID}?`)) return;
    this.api.deleteDocument('imports', doc.PHIEU_NHAP_ID!).subscribe({
      next: () => { this.notify('Đã xóa phiếu.'); this.viewing.set(null); this.load(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  /* ---------- helpers ---------- */
  materialById(id: string): InvMaterial | undefined { return this.materials().find((m) => m.code === id); }
  statusClass(s: string): string { return s === 'Nháp' ? 'draft' : s === 'Đã hủy' ? 'cancelled' : 'posted'; }
  totalAccepted(doc: InvDocument): number { return doc.details.reduce((s, d) => s + Number(d.SL_DAT ?? d.SO_LUONG_NHAP ?? 0), 0); }
  totalRejected(doc: InvDocument): number { return doc.details.reduce((s, d) => s + Number(d.SL_KHONG_DAT || 0), 0); }
  notify(text: string, error = false): void { this.toast.set({ text, error }); setTimeout(() => this.toast.set(null), error ? 7000 : 3500); }
}
