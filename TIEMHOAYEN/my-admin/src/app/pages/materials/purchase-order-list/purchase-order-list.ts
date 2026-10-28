import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { InventoryTabsComponent } from '../inventory-tabs/inventory-tabs';
import {
  InvMaterial,
  InvPurchaseOrder,
  InvSupplier,
  InvSupplierMaterial,
  InventoryApiService,
  inventoryErrorMessage,
} from '../../../services/inventory-api.service';

interface PoLine { materialId: string; quantity: number; unitCost: number; }

const NEXT_STATUS: Record<string, string[]> = {
  'Nháp': ['Chờ NCC xác nhận', 'Đã hủy'],
  'Chờ NCC xác nhận': ['Đang giao', 'Đã hủy'],
  'Đang giao': ['Giao thành công', 'Đã hủy'],
};

/**
 * Đơn đặt mua NCC (PO) — nguồn "hàng đang về" để DỰ BÁO theo lịch T.
 * PO không làm tăng tồn; hàng về phải lập phiếu nhập. Chỉ PO "Đang giao" được tính vào dự báo.
 */
@Component({
  selector: 'app-purchase-order-list',
  standalone: true,
  imports: [CommonModule, FormsModule, InventoryTabsComponent],
  templateUrl: './purchase-order-list.html',
  styleUrls: ['../inventory.css'],
})
export class PurchaseOrderListComponent implements OnInit {
  private readonly api = inject(InventoryApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly orders = signal<InvPurchaseOrder[]>([]);
  readonly suppliers = signal<InvSupplier[]>([]);
  readonly materials = signal<InvMaterial[]>([]);
  readonly supplierLinks = signal<InvSupplierMaterial[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly toast = signal<{ text: string; error?: boolean } | null>(null);
  readonly nextStatus = NEXT_STATUS;

  statusFilter = '';
  private readonly tick = signal(0);
  readonly filtered = computed(() => { this.tick(); return this.orders().filter((o) => !this.statusFilter || o.TRANG_THAI === this.statusFilter); });

  readonly formOpen = signal(false);
  readonly saving = signal(false);
  readonly formError = signal('');
  editingId: string | null = null;
  header = { supplierId: '', expectedAt: '', note: '' };
  lines: PoLine[] = [];

  ngOnInit(): void {
    this.api.suppliers().subscribe({ next: (r) => this.suppliers.set(r.suppliers), error: () => {} });
    this.api.materials().subscribe({ next: (r) => this.materials.set(r.materials), error: () => {} });
    this.load();
    const q = this.route.snapshot.queryParamMap;
    if (q.get('new')) {
      this.openCreate();
      const m = q.get('material');
      if (m) this.lines = [{ materialId: m, quantity: Number(q.get('qty') || 0), unitCost: 0 }];
    }
  }

  load(): void {
    this.loading.set(true);
    this.api.purchaseOrders().subscribe({
      next: (r) => { this.orders.set(r.purchaseOrders); this.loading.set(false); },
      error: (e) => { this.error.set(inventoryErrorMessage(e)); this.loading.set(false); },
    });
  }
  refilter(): void { this.tick.update((x) => x + 1); }

  openCreate(): void {
    this.editingId = null;
    this.header = { supplierId: '', expectedAt: '', note: '' };
    this.lines = [{ materialId: '', quantity: 0, unitCost: 0 }];
    this.formError.set('');
    this.supplierLinks.set([]);
    this.formOpen.set(true);
  }

  openEdit(po: InvPurchaseOrder): void {
    this.editingId = po.PO_ID;
    this.header = { supplierId: po.NHA_CUNG_CAP_ID, expectedAt: po.NGAY_GIO_DU_KIEN_GIAO ? this.toLocal(po.NGAY_GIO_DU_KIEN_GIAO) : '', note: po.GHI_CHU || '' };
    this.lines = po.CHI_TIET.map((l) => ({ materialId: l.NGUYEN_VAT_LIEU_ID, quantity: l.SL_DAT, unitCost: l.DON_GIA_DU_KIEN }));
    this.formError.set('');
    this.onSupplierChange();
    this.formOpen.set(true);
  }

  /** Tải NVL mà NCC này cung cấp để gợi ý giá & lead time. */
  onSupplierChange(): void {
    if (!this.header.supplierId) { this.supplierLinks.set([]); return; }
    this.api.supplierMaterials({ supplierId: this.header.supplierId }).subscribe({ next: (r) => this.supplierLinks.set(r.items), error: () => {} });
  }

  onLineMaterial(l: PoLine): void {
    const link = this.supplierLinks().find((x) => x.NGUYEN_VAT_LIEU_ID === l.materialId);
    l.unitCost = link?.DON_GIA ?? this.materials().find((m) => m.code === l.materialId)?.importPrice ?? 0;
    if (link && l.quantity < link.SL_DAT_TOI_THIEU) l.quantity = link.SL_DAT_TOI_THIEU;
  }

  linkFor(materialId: string): InvSupplierMaterial | undefined { return this.supplierLinks().find((x) => x.NGUYEN_VAT_LIEU_ID === materialId); }

  save(): void {
    if (!this.header.supplierId) { this.formError.set('Chọn nhà cung cấp.'); return; }
    const lines = this.lines.filter((l) => l.materialId && l.quantity > 0);
    if (!lines.length) { this.formError.set('PO cần ít nhất một NVL có SL > 0.'); return; }
    this.saving.set(true);
    const body = { ...this.header, expectedAt: this.header.expectedAt ? new Date(this.header.expectedAt).toISOString() : null, lines };
    const req = this.editingId ? this.api.updatePurchaseOrder(this.editingId, body) : this.api.createPurchaseOrder(body);
    req.subscribe({
      next: () => { this.saving.set(false); this.formOpen.set(false); this.notify('Đã lưu PO.'); this.load(); },
      error: (e) => { this.saving.set(false); this.formError.set(inventoryErrorMessage(e)); },
    });
  }

  changeStatus(po: InvPurchaseOrder, status: string): void {
    let note: string | undefined;
    if (status === 'Đã hủy') { note = prompt('Lý do hủy PO?') ?? undefined; if (note === undefined) return; }
    if (status === 'Giao thành công' && po.CHI_TIET.some((l) => (l.SL_DA_NHAN || 0) < l.SL_DAT)
      && !confirm('PO chưa nhận đủ. Đóng PO sẽ không còn tính phần chưa giao vào hàng đang về. Tiếp tục?')) return;
    this.api.changePurchaseOrderStatus(po.PO_ID, status, note).subscribe({
      next: () => { this.notify(`PO ${po.PO_ID} → ${status}`); this.load(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  updateExpected(po: InvPurchaseOrder): void {
    const v = prompt('Ngày giờ NCC báo giao mới (YYYY-MM-DD HH:mm)', po.NGAY_GIO_DU_KIEN_GIAO ? this.toLocal(po.NGAY_GIO_DU_KIEN_GIAO).replace('T', ' ') : '');
    if (!v) return;
    this.api.updatePurchaseOrder(po.PO_ID, { expectedAt: new Date(v.replace(' ', 'T')).toISOString() }).subscribe({
      next: () => { this.notify('Đã cập nhật ngày dự kiến giao. Kiểm tra cảnh báo thiếu NVL theo T.'); this.load(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  receive(po: InvPurchaseOrder): void {
    this.router.navigate(['/materials/imports'], { queryParams: { new: 1, po: po.PO_ID } });
  }

  supplierName(id: string): string { return this.suppliers().find((s) => s.NHA_CUNG_CAP_ID === id)?.TEN_NHA_CUNG_CAP || id; }
  materialName(id: string): string { return this.materials().find((m) => m.code === id)?.name || id; }
  pending(po: InvPurchaseOrder): number { return po.CHI_TIET.reduce((s, l) => s + Math.max(0, l.SL_DAT - (l.SL_DA_NHAN || 0)), 0); }
  statusClass(s: string): string {
    return ({ 'Nháp': 'gray', 'Chờ NCC xác nhận': 'waiting', 'Đang giao': 'shipping', 'Giao thành công': 'done', 'Đã hủy': 'cancelled' } as Record<string, string>)[s] || 'gray';
  }
  total(): number { return this.lines.reduce((s, l) => s + (l.quantity || 0) * (l.unitCost || 0), 0); }
  toLocal(d: string): string {
    const x = new Date(d);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
  }
  notify(text: string, error = false): void { this.toast.set({ text, error }); setTimeout(() => this.toast.set(null), error ? 7000 : 3500); }
}
