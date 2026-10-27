import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InventoryTabsComponent } from '../inventory-tabs/inventory-tabs';
import {
  InvBom,
  InvBomLine,
  InvBomProduct,
  InvMaterial,
  InventoryApiService,
  inventoryErrorMessage,
} from '../../../services/inventory-api.service';

interface EditLine { materialId: string; quantity: number; role: string; substitutes: string[]; note: string; }

/**
 * AD62 / D02 — Công thức BOM có phiên bản.
 * Sửa BOM = tạo phiên bản Nháp mới → Kích hoạt (phiên bản cũ tự "Ngừng sử dụng"). Đơn cũ giữ snapshot BOM cũ.
 */
@Component({
  selector: 'app-bom-list',
  standalone: true,
  imports: [CommonModule, FormsModule, InventoryTabsComponent],
  templateUrl: './bom-list.html',
  styleUrls: ['../inventory.css'],
})
export class BomListComponent implements OnInit {
  private readonly api = inject(InventoryApiService);

  readonly products = signal<InvBomProduct[]>([]);
  readonly materials = signal<InvMaterial[]>([]);
  readonly loading = signal(false);
  readonly toast = signal<{ text: string; error?: boolean } | null>(null);
  search = '';
  onlyReview = false;
  onlyNoBom = false;
  private readonly tick = signal(0);
  readonly filtered = computed(() => {
    this.tick();
    const q = this.search.trim().toLowerCase();
    return this.products().filter((p) => (!q || `${p.SAN_PHAM_ID} ${p.TEN_SAN_PHAM}`.toLowerCase().includes(q))
      && (!this.onlyReview || p.needsReview) && (!this.onlyNoBom || !p.activeBomId));
  });

  readonly selected = signal<InvBomProduct | null>(null);
  readonly boms = signal<InvBom[]>([]);
  readonly legacy = signal<InvBomLine[]>([]);
  readonly active = computed(() => this.boms().find((b) => b.TRANG_THAI === 'Hiệu lực') || null);

  // editor
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly editError = signal('');
  editBomId: string | null = null;
  allowSubstitution = true;
  editNote = '';
  lines: EditLine[] = [];
  readonly roles = ['Chính', 'Phụ', 'Phụ liệu'];

  ngOnInit(): void {
    this.api.materials().subscribe({ next: (r) => this.materials.set(r.materials), error: () => {} });
    this.loadProducts();
  }

  loadProducts(): void {
    this.loading.set(true);
    this.api.bomProducts().subscribe({
      next: (r) => {
        this.products.set(r.items);
        this.loading.set(false);
        const sel = this.selected();
        if (sel) this.selected.set(r.items.find((p) => p.SAN_PHAM_ID === sel.SAN_PHAM_ID) || sel);
      },
      error: (e) => { this.loading.set(false); this.notify(inventoryErrorMessage(e), true); },
    });
  }
  refilter(): void { this.tick.update((x) => x + 1); }

  select(p: InvBomProduct): void {
    this.selected.set(p);
    this.editing.set(false);
    this.api.productBoms(p.SAN_PHAM_ID).subscribe({
      next: (r) => { this.boms.set(r.boms); this.legacy.set(r.legacyRecipe); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  /** Tạo phiên bản mới: sao chép BOM hiệu lực (hoặc công thức cũ) để sửa. */
  newVersion(): void {
    const base = this.active()?.lines || this.legacy();
    this.editBomId = null;
    this.allowSubstitution = this.active()?.CHO_THAY_THE_NVL ?? true;
    this.editNote = '';
    this.lines = base.map((l) => ({ materialId: l.NGUYEN_VAT_LIEU_ID, quantity: l.DINH_LUONG, role: l.VAI_TRO || 'Chính', substitutes: [...(l.DS_THAY_THE || [])], note: l.GHI_CHU || '' }));
    if (!this.lines.length) this.lines = [{ materialId: '', quantity: 1, role: 'Chính', substitutes: [], note: '' }];
    this.editError.set('');
    this.editing.set(true);
  }

  editDraft(b: InvBom): void {
    this.editBomId = b.BOM_ID;
    this.allowSubstitution = b.CHO_THAY_THE_NVL;
    this.editNote = b.GHI_CHU || '';
    this.lines = b.lines.map((l) => ({ materialId: l.NGUYEN_VAT_LIEU_ID, quantity: l.DINH_LUONG, role: l.VAI_TRO, substitutes: [...l.DS_THAY_THE], note: l.GHI_CHU }));
    this.editError.set('');
    this.editing.set(true);
  }

  substituteOptions(materialId: string): InvMaterial[] {
    const m = this.material(materialId);
    if (!m?.substitutionGroup) return [];
    return this.materials().filter((x) => x.code !== m.code && x.substitutionGroup === m.substitutionGroup);
  }

  toggleSub(line: EditLine, code: string): void {
    line.substitutes = line.substitutes.includes(code) ? line.substitutes.filter((x) => x !== code) : [...line.substitutes, code];
  }

  save(activate: boolean): void {
    const p = this.selected();
    if (!p) return;
    const lines = this.lines.filter((l) => l.materialId);
    const body = { allowSubstitution: this.allowSubstitution, note: this.editNote, lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity) })) };
    this.saving.set(true);
    this.editError.set('');
    const req = this.editBomId ? this.api.updateBom(this.editBomId, body) : this.api.createBom(p.SAN_PHAM_ID, body);
    req.subscribe({
      next: (bom) => {
        const id = this.editBomId || bom.BOM_ID;
        if (!activate) { this.done('Đã lưu BOM nháp.'); return; }
        this.api.activateBom(id).subscribe({
          next: () => this.done('Đã kích hoạt BOM mới. Phiên bản cũ chuyển "Ngừng sử dụng"; đơn đã tạo vẫn giữ BOM cũ.'),
          error: (e) => { this.saving.set(false); this.editError.set(inventoryErrorMessage(e)); this.editBomId = id; },
        });
      },
      error: (e) => { this.saving.set(false); this.editError.set(inventoryErrorMessage(e)); },
    });
  }

  private done(msg: string): void {
    this.saving.set(false);
    this.editing.set(false);
    this.notify(msg);
    const p = this.selected();
    if (p) this.select(p);
    this.loadProducts();
  }

  activate(b: InvBom): void {
    if (!confirm(`Kích hoạt ${b.BOM_ID} (v${b.PHIEN_BAN})?`)) return;
    this.api.activateBom(b.BOM_ID).subscribe({ next: () => this.done('Đã kích hoạt.'), error: (e) => this.notify(inventoryErrorMessage(e), true) });
  }

  retire(b: InvBom): void {
    if (!confirm(b.TRANG_THAI === 'Nháp' ? `Xóa bản nháp ${b.BOM_ID}?` : `Ngừng sử dụng ${b.BOM_ID}? Sản phẩm sẽ không còn BOM hiệu lực.`)) return;
    this.api.retireBom(b.BOM_ID).subscribe({ next: () => this.done('Đã cập nhật.'), error: (e) => this.notify(inventoryErrorMessage(e), true) });
  }

  material(id: string): InvMaterial | undefined { return this.materials().find((m) => m.code === id); }
  canMake(l: InvBomLine): number { const m = this.material(l.NGUYEN_VAT_LIEU_ID); return m && l.DINH_LUONG > 0 ? Math.floor(m.available / l.DINH_LUONG + 1e-9) : 0; }
  margin(b: InvBom): number | null {
    const price = this.selected()?.GIA_KHUYEN_MAI || this.selected()?.GIA || 0;
    if (!price || !b.cost) return null;
    return Math.round(((price - b.cost.total) / price) * 100);
  }
  statusClass(s: string): string { return s === 'Hiệu lực' ? 'ok' : s === 'Nháp' ? 'draft' : 'gray'; }
  notify(text: string, error = false): void { this.toast.set({ text, error }); setTimeout(() => this.toast.set(null), error ? 8000 : 3500); }
}
