import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InventoryTabsComponent } from '../inventory-tabs/inventory-tabs';
import {
  InvMaterial,
  InvSupplier,
  InvSupplierMaterial,
  InventoryApiService,
  inventoryErrorMessage,
} from '../../../services/inventory-api.service';

const EMPTY_SUPPLIER = {
  name: '', representative: '', phone: '', email: '', address: '', taxCode: '', status: 'Hoạt động',
  paymentTerms: '', orderCutoffTime: '12:00', defaultLeadDays: 1, note: '', logo: '',
};

const EMPTY_LINK = {
  materialId: '', supplierSku: '', purchaseUnit: '', conversionRate: 1, unitCost: 0, minOrderQty: 0,
  leadDays: 1, orderCutoffTime: '', priority: 1, confidence: 'Trung bình', note: '', active: true,
};

/**
 * AD30–AD32 — Nhà cung cấp + nguồn cung theo NVL (NCC bán NVL nào, giá, lead time, giờ chốt đơn).
 * NCC đã có phiếu/PO chỉ chuyển "Ngừng hợp tác", không xóa cứng.
 */
@Component({
  selector: 'app-supplier-list',
  standalone: true,
  imports: [CommonModule, FormsModule, InventoryTabsComponent],
  templateUrl: './supplier-list.html',
  styleUrls: ['../inventory.css', './supplier-list.css'],
})
export class SupplierListComponent implements OnInit {
  private readonly api = inject(InventoryApiService);

  readonly suppliers = signal<InvSupplier[]>([]);
  readonly statuses = signal<string[]>(['Hoạt động', 'Đang hợp tác', 'Tạm ngưng', 'Ngừng hợp tác', 'Bị khóa']);
  readonly materials = signal<InvMaterial[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly toast = signal<{ text: string; error?: boolean } | null>(null);

  search = '';
  statusFilter = '';
  private readonly tick = signal(0);
  readonly filtered = computed(() => {
    this.tick();
    const q = this.search.trim().toLowerCase();
    return this.suppliers().filter((s) => (!this.statusFilter || s.TRANG_THAI === this.statusFilter)
      && (!q || `${s.NHA_CUNG_CAP_ID} ${s.TEN_NHA_CUNG_CAP} ${s.SDT || ''} ${s.EMAIL || ''} ${s.NGUOI_DAI_DIEN || ''}`.toLowerCase().includes(q)));
  });

  // Chi tiết / form
  readonly selected = signal<InvSupplier | null>(null);
  readonly tab = signal<'info' | 'materials'>('info');
  readonly formOpen = signal(false);
  readonly saving = signal(false);
  readonly formError = signal('');
  form = { ...EMPTY_SUPPLIER };

  readonly links = signal<InvSupplierMaterial[]>([]);
  linkForm: typeof EMPTY_LINK = { ...EMPTY_LINK };
  editingLinkId: string | null = null;
  readonly linkError = signal('');

  ngOnInit(): void {
    this.api.materials().subscribe({ next: (r) => this.materials.set(r.materials), error: () => {} });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.suppliers().subscribe({
      next: (r) => { this.suppliers.set(r.suppliers); if (r.statuses?.length) this.statuses.set(r.statuses); this.loading.set(false); },
      error: (e) => { this.error.set(inventoryErrorMessage(e)); this.loading.set(false); },
    });
  }
  refilter(): void { this.tick.update((x) => x + 1); }

  openCreate(): void {
    this.selected.set(null);
    this.form = { ...EMPTY_SUPPLIER };
    this.formError.set('');
    this.tab.set('info');
    this.formOpen.set(true);
  }

  open(s: InvSupplier, tab: 'info' | 'materials' = 'info'): void {
    this.selected.set(s);
    this.form = {
      name: s.TEN_NHA_CUNG_CAP, representative: s.NGUOI_DAI_DIEN || '', phone: String(s.SDT || ''), email: s.EMAIL || '', address: s.DIA_CHI || '',
      taxCode: String(s.MA_SO_THUE || ''), status: s.TRANG_THAI, paymentTerms: s.DIEU_KHOAN_THANH_TOAN || '', orderCutoffTime: s.GIO_CHOT_DON || '',
      defaultLeadDays: s.SO_NGAY_GIAO_MAC_DINH ?? 1, note: s.GHI_CHU || '', logo: s.LOGO || '',
    };
    this.formError.set('');
    this.tab.set(tab);
    this.formOpen.set(true);
    this.loadLinks();
  }

  save(): void {
    if (!this.form.name.trim()) { this.formError.set('Tên nhà cung cấp là bắt buộc.'); return; }
    if (this.form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.form.email)) { this.formError.set('Email không hợp lệ.'); return; }
    if (this.form.phone && !/^\+?\d{9,11}$/.test(this.form.phone.replace(/\s/g, ''))) { this.formError.set('Số điện thoại phải 9–11 chữ số.'); return; }
    this.saving.set(true);
    const s = this.selected();
    const req = s ? this.api.updateSupplier(s.NHA_CUNG_CAP_ID, this.form) : this.api.createSupplier(this.form);
    req.subscribe({
      next: (r) => {
        this.saving.set(false);
        this.notify(s ? 'Đã cập nhật nhà cung cấp.' : 'Đã thêm nhà cung cấp. Khai báo NVL cung cấp ở tab "Nguồn cung".');
        this.load();
        if (!s) { this.open(r.supplier, 'materials'); } else { this.selected.set(r.supplier); }
      },
      error: (e) => { this.saving.set(false); this.formError.set(inventoryErrorMessage(e)); },
    });
  }

  remove(s: InvSupplier): void {
    if (!confirm(`Xóa / ngừng hợp tác với ${s.TEN_NHA_CUNG_CAP}? NCC đã có phiếu, PO hoặc nguồn cung sẽ chỉ chuyển "Ngừng hợp tác".`)) return;
    this.api.deleteSupplier(s.NHA_CUNG_CAP_ID).subscribe({
      next: (r) => { this.notify(r.message || 'Đã xóa NCC.'); this.formOpen.set(false); this.load(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  /* ---------- Nguồn cung NCC–NVL ---------- */
  loadLinks(): void {
    const s = this.selected();
    if (!s) { this.links.set([]); return; }
    this.api.supplierMaterials({ supplierId: s.NHA_CUNG_CAP_ID }).subscribe({ next: (r) => this.links.set(r.items), error: () => {} });
  }

  editLink(l: InvSupplierMaterial): void {
    this.editingLinkId = l._id;
    this.linkForm = {
      materialId: l.NGUYEN_VAT_LIEU_ID, supplierSku: l.MA_HANG_NCC || '', purchaseUnit: l.DON_VI_MUA, conversionRate: l.HE_SO_QUY_DOI,
      unitCost: l.DON_GIA, minOrderQty: l.SL_DAT_TOI_THIEU, leadDays: l.SO_NGAY_GIAO, orderCutoffTime: l.GIO_CHOT_DON || '',
      priority: l.UU_TIEN, confidence: l.MUC_TIN_CAY, note: l.GHI_CHU || '', active: l.TRANG_THAI !== 'Ngừng',
    };
    this.linkError.set('');
  }

  resetLink(): void {
    this.editingLinkId = null;
    const s = this.selected();
    this.linkForm = { ...EMPTY_LINK, leadDays: s?.SO_NGAY_GIAO_MAC_DINH ?? 1 };
    this.linkError.set('');
  }

  onLinkMaterialChange(): void {
    const m = this.materials().find((x) => x.code === this.linkForm.materialId);
    if (m && !this.editingLinkId) { this.linkForm.unitCost = m.importPrice; this.linkForm.purchaseUnit = m.unit; }
  }

  saveLink(): void {
    const s = this.selected();
    if (!s) return;
    if (!this.linkForm.materialId) { this.linkError.set('Chọn NVL.'); return; }
    this.api.saveSupplierMaterial({ ...this.linkForm, supplierId: s.NHA_CUNG_CAP_ID }, this.editingLinkId || undefined).subscribe({
      next: () => { this.notify('Đã lưu nguồn cung.'); this.resetLink(); this.loadLinks(); this.load(); },
      error: (e) => this.linkError.set(inventoryErrorMessage(e)),
    });
  }

  removeLink(l: InvSupplierMaterial): void {
    if (!confirm(`Bỏ ${l.TEN_NGUYEN_VAT_LIEU} khỏi danh sách NCC cung cấp?`)) return;
    this.api.deleteSupplierMaterial(l._id).subscribe({ next: () => { this.loadLinks(); this.load(); }, error: (e) => this.notify(inventoryErrorMessage(e), true) });
  }

  statusClass(st: string): string {
    return ['Hoạt động', 'Đang hợp tác'].includes(st) ? 'ok' : st === 'Tạm ngưng' ? 'low' : 'out';
  }
  notify(text: string, error = false): void { this.toast.set({ text, error }); setTimeout(() => this.toast.set(null), error ? 7000 : 3500); }
}
