import { InventoryPagerComponent } from '../inventory-pager';
import { InventoryDialogComponent } from '../inventory-dialog';
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { InventoryTabsComponent } from '../inventory-tabs/inventory-tabs';
import {
  InvMaterial,
  InvMaterialDetail,
  InvMaterialHistory,
  InventoryApiService,
  inventoryErrorMessage,
} from '../../../services/inventory-api.service';

type MaterialForm = Partial<InvMaterial> & { code?: string };

const EMPTY_FORM: MaterialForm = {
  use3d: false, model3d: '', color3d: '', review3d: false, name: '', unit: '', group: 'IT_HU', type: 'Phụ kiện cắm', importPrice: 0, sellPrice: 0, threshold: 10, maxLevel: 30,
  shelfDays: null, substitutionGroup: '', purchaseUnit: '', conversionRate: 1, description: '', image: '',
};

/**
 * AD21–AD23 — Danh sách NVL.
 * Hiển thị tồn thực / đang giữ / không đạt / khả dụng; KHÔNG cho sửa tồn trực tiếp (đi qua phiếu nhập/xuất).
 */
@Component({
  selector: 'app-material-list',
  standalone: true,
  imports: [InventoryPagerComponent, InventoryDialogComponent, CommonModule, FormsModule, InventoryTabsComponent],
  templateUrl: './material-list.html',
  styleUrls: ['../inventory.css', './material-list.css'],
})
export class MaterialListComponent implements OnInit {
  @ViewChild(InventoryDialogComponent) private dialog!: InventoryDialogComponent;
  private readonly api = inject(InventoryApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly materials = signal<InvMaterial[]>([]);
  readonly types = signal<string[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly toast = signal<{ text: string; error?: boolean } | null>(null);

  search = '';
  typeFilter = '';
  groupFilter = '';
  stockFilter = '';
  includeHidden = false;
  filtersOpen = false;
  sortKey: keyof InvMaterial = 'code';
  sortAsc = true;
  readonly page = signal(1);
  readonly pageSize = 15;
  private readonly filterTick = signal(0);

  readonly filtered = computed(() => {
    this.filterTick();
    const q = this.normalize(this.search);
    const rows = this.materials().filter((m) =>
      (!q || this.normalize(`${m.code} ${m.name} ${m.type}`).includes(q))
      && (!this.typeFilter || m.type === this.typeFilter)
      && (!this.groupFilter || m.group === this.groupFilter)
      && (!this.stockFilter || m.stockStatus === this.stockFilter));
    const key = this.sortKey;
    return [...rows].sort((a, b) => {
      const x = a[key] as any;
      const y = b[key] as any;
      const r = typeof x === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'vi');
      return this.sortAsc ? r : -r;
    });
  });
  readonly paged = computed(() => this.filtered().slice((this.page() - 1) * this.pageSize, this.page() * this.pageSize));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize)));
  readonly pageNumbers = computed(() => {
    const total = this.totalPages(), current = this.page();
    const visible = total <= 7 ? Array.from({ length: total }, (_, i) => i + 1)
      : [...new Set([1, total, ...Array.from({ length: 5 }, (_, i) => Math.max(2, Math.min(current - 2, total - 5)) + i)])].sort((a, b) => a - b);
    const result: number[] = [];
    for (const n of visible) {
      if (result.length && n - result[result.length - 1] > 1) result.push(0);
      result.push(n);
    }
    return result;
  });
  readonly summary = computed(() => {
    const all = this.materials();
    return {
      total: all.length,
      out: all.filter((m) => m.stockStatus === 'out').length,
      low: all.filter((m) => m.stockStatus === 'low').length,
      damaged: all.filter((m) => m.damaged > 0).length,
      reserved: all.filter((m) => m.reserved > 0).length,
    };
  });

  readonly designModels = [{id:'rose',name:'Hoa hồng'},{id:'lily',name:'Hoa ly'},{id:'sunflower',name:'Hướng dương'},{id:'baby',name:'Baby'},{id:'gerbera',name:'Đồng tiền'},{id:'carnation',name:'Cẩm chướng'},{id:'chrysanthemum',name:'Hoa cúc'},{id:'tuberose',name:'Hoa huệ'},{id:'tulip',name:'Tulip'},{id:'lotus',name:'Hoa sen'},{id:'lisianthus',name:'Cát tường'},{id:'orchid',name:'Hoa lan'}];
  readonly materialColors = ['Đỏ', 'Hồng', 'Trắng', 'Vàng', 'Cam', 'Tím', 'Xanh lá', 'Xanh dương', 'Kem', 'Nâu', 'Đen', 'Nhiều màu'];
  readonly modelColors: Record<string,string[]> = {rose:['Đỏ','Hồng'],lily:['Hồng'],sunflower:['Vàng'],baby:['Trắng'],gerbera:['Đỏ'],carnation:['Hồng'],chrysanthemum:['Trắng'],tuberose:['Trắng'],tulip:['Hồng','Trắng'],lotus:['Hồng'],lisianthus:['Tím'],orchid:['Tím']};
  onDesignModelChange(): void { this.form.colors3d = [...(this.modelColors[this.form.model3d || ''] || [])]; }
  selectedDesignColors(): string[] { return this.form.colors3d?.length ? this.form.colors3d : (this.modelColors[this.form.model3d || ''] || []); }
  toggleDesignColor(color:string,checked:boolean):void {
    const selected=this.selectedDesignColors();
    const next=checked?[...new Set([...selected,color])]:selected.filter(c=>c!==color);
    if(!next.length && this.form.model3d)return;
    this.form.colors3d=next;
  }
  // Form thêm/sửa
  readonly formOpen = signal(false);
  readonly saving = signal(false);
  readonly uploadingImage = signal(false);
  readonly defaultMaterialImage = 'assets/images/flower_default.png';
  hasCustomImage(image?: string): boolean {
    return !!image && !image.split(/[?#]/)[0].endsWith('/flower_default.png');
  }
  readonly formError = signal('');
  editingCode: string | null = null;
  form: MaterialForm = { ...EMPTY_FORM };

  // Chi tiết
  readonly detail = signal<InvMaterialDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailTab = signal<'overview' | 'sources' | 'reservations' | 'suppliers' | 'history'>('overview');
  readonly sourcePage = signal(1);
  readonly history = signal<InvMaterialHistory>({kind: 'movements', page: 1, pageSize: 15, total: 0, items: []});
  readonly historyLoading = signal(false);
  readonly historyError = signal('');
  historyKind: 'movements' | 'corrections' = 'movements';
  historySearch = ''; historyFrom = ''; historyTo = '';
  private historyVersion = 0;
  selectDetailTab(tab: 'overview' | 'sources' | 'reservations' | 'suppliers' | 'history'): void {
    this.detailTab.set(tab);
    if (tab === 'history') this.loadHistory(1);
  }
  loadHistory(page = 1): void {
    const id = this.detail()?.material.code;
    if (!id) return;
    const version = ++this.historyVersion;
    this.historyLoading.set(true); this.historyError.set('');
    this.api.materialHistory(id, {kind: this.historyKind, page, search: this.historySearch, from: this.historyFrom, to: this.historyTo}).subscribe({
      next: result => {
        if (version !== this.historyVersion || this.detail()?.material.code !== id) return;
        this.history.set(result); this.historyLoading.set(false);
      },
      error: e => {
        if (version !== this.historyVersion || this.detail()?.material.code !== id) return;
        this.historyError.set(inventoryErrorMessage(e)); this.historyLoading.set(false);
      }
    });
  }
  clearHistoryFilters(): void { this.historySearch = ''; this.historyFrom = ''; this.historyTo = ''; this.loadHistory(1); }
  shortDocId(id: string | null): string { return !id ? '—' : id.length > 16 ? id.slice(0, 7) + '…' + id.slice(-5) : id; }
  damageForm = { sourceId: '', quantity: 0, note: '' };

  ngOnInit(): void {
    this.api.meta().subscribe({ next: (m) => this.types.set(m.materialTypes), error: () => {} });
    this.load();
    const query = this.route.snapshot.queryParamMap;
    const material = query.get('material');
    if (material) this.openDetail(material, query.get('source') || '');
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.materials({ includeHidden: this.includeHidden }).subscribe({
      next: (res) => {
        if (res.materials?.length && (res.materials[0] as any).available === undefined) {
          this.error.set(inventoryErrorMessage({ status: 404, error: null }));
        }
        this.materials.set(res.materials);
        if (res.types?.length) this.types.set(res.types);
        this.loading.set(false);
        if (this.page() > this.totalPages()) this.page.set(1);
      },
      error: (e) => { this.error.set(inventoryErrorMessage(e)); this.loading.set(false); },
    });
  }

  applyFilters(): void {
    this.page.set(1);
    this.filterTick.update((x) => x + 1);
  }

  sortBy(key: keyof InvMaterial): void {
    this.sortAsc = this.sortKey === key ? !this.sortAsc : true;
    this.sortKey = key;
    this.filterTick.update((x) => x + 1);
  }

  /* ---------- Thêm / sửa ---------- */
  openCreate(): void {
    this.editingCode = null;
    this.form = { ...EMPTY_FORM };
    this.formError.set('');
    this.formOpen.set(true);
  }

  openEdit(m: InvMaterial): void {
    this.editingCode = m.code;
    this.form = { ...m };
    this.formError.set('');
    this.formOpen.set(true);
  }

  onGroupChange(): void {
    if (this.form.group === 'DE_HU' && !this.form.shelfDays) this.form.shelfDays = 5;
  }

  uploadImage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.uploadingImage()) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      this.notify('Chọn ảnh JPG, PNG, WEBP hoặc GIF, tối đa 5 MB.', true);
      return;
    }
    this.uploadingImage.set(true);
    this.api.uploadMaterialImage(file).subscribe({
      next: (url) => { this.form = { ...this.form, image: url }; this.uploadingImage.set(false); this.notify('Đã tải ảnh lên.'); },
      error: (e) => { this.uploadingImage.set(false); this.notify(inventoryErrorMessage(e), true); },
    });
  }

  save(): void {
    this.formError.set('');
    if (this.uploadingImage()) return;
    if (!this.form.name?.trim() || !this.form.unit?.trim()) {
      this.formError.set('Tên NVL và đơn vị tính là bắt buộc.');
      return;
    }
    if (Number(this.form.maxLevel || 0) > 0 && Number(this.form.maxLevel) < Number(this.form.threshold || 0)) {
      this.formError.set('Ngưỡng tối đa phải ≥ ngưỡng cảnh báo.');
      return;
    }
    const body: MaterialForm = {
      code: this.editingCode ? undefined : (this.form.code || undefined),
      colors3d: [...this.selectedDesignColors()], use3d: !!this.form.use3d, model3d: this.form.model3d || '', color3d: this.form.color3d || '', review3d: !!this.form.review3d,
      name: this.form.name, unit: this.form.unit, group: this.form.group, type: this.form.type,
      importPrice: Number(this.form.importPrice || 0), sellPrice: Number(this.form.sellPrice || 0),
      threshold: Number(this.form.threshold || 0), maxLevel: Number(this.form.maxLevel || 0),
      shelfDays: this.form.shelfDays === null || (this.form.shelfDays as any) === '' ? null : Number(this.form.shelfDays),
      substitutionGroup: this.form.substitutionGroup || '', purchaseUnit: this.form.purchaseUnit || '',
      conversionRate: Number(this.form.conversionRate || 1), description: this.form.description || '', image: this.form.image || '',
    };
    this.saving.set(true);
    const req = this.editingCode ? this.api.updateMaterial(this.editingCode, body) : this.api.createMaterial(body);
    req.subscribe({
      next: (result) => {
        this.saving.set(false);
        const saved = result.material;
        if (!saved || saved.use3d !== body.use3d || saved.review3d !== body.review3d ||
            saved.model3d !== body.model3d || saved.color3d !== body.color3d?.trim() ||
            JSON.stringify(saved.colors3d || []) !== JSON.stringify(body.colors3d || [])) {
          this.formError.set('Backend chưa xác nhận lưu cấu hình 3D. Hãy chạy lại my-server bằng code mới và kiểm tra Admin/khách hàng đang dùng cùng backend. Các thông tin NVL khác có thể đã được lưu.');
          return;
        }
        this.formOpen.set(false);
        this.notify(this.editingCode ? 'Đã cập nhật NVL.' : 'Đã thêm NVL. Nhập tồn đầu kỳ bằng phiếu nhập.');
        this.load();
        if (this.detail()) this.openDetail(this.detail()!.material.code);
      },
      error: (e) => { this.saving.set(false); this.formError.set(inventoryErrorMessage(e)); },
    });
  }

  async toggleActive(m: InvMaterial): Promise<void> {
    if (m.active) {
      if (!(await this.dialog.confirm(`Ngừng sử dụng / xóa NVL ${m.name}? NVL đã có giao dịch hoặc nằm trong BOM sẽ chỉ bị ẩn.`))) return;
      this.api.deleteMaterial(m.code).subscribe({
        next: (r) => { this.notify(r.message || (r.deleted ? 'Đã xóa NVL.' : 'Đã ẩn NVL.')); this.detail.set(null); this.load(); },
        error: (e) => this.notify(inventoryErrorMessage(e), true),
      });
    } else {
      this.api.updateMaterial(m.code, { active: true }).subscribe({
        next: () => { this.notify('Đã kích hoạt lại NVL.'); this.load(); this.openDetail(m.code); },
        error: (e) => this.notify(inventoryErrorMessage(e), true),
      });
    }
  }

  /* ---------- Chi tiết ---------- */
  openDetail(code: string, sourceId = ''): void {
    this.historyVersion++; this.detailTab.set(sourceId ? 'sources' : 'overview'); this.sourcePage.set(1);
    this.history.set({kind: 'movements', page: 1, pageSize: 15, total: 0, items: []}); this.historyLoading.set(false);
    this.historyKind = 'movements'; this.historySearch = ''; this.historyFrom = ''; this.historyTo = ''; this.historyError.set('');
    this.detailLoading.set(true);
    this.damageForm = { sourceId: '', quantity: 0, note: '' };
    this.api.materialDetail(code).subscribe({
      next: (d) => {
        this.damageForm.sourceId = d.sources.some(s => s.sourceId === sourceId) ? sourceId : '';
        if (sourceId) this.sourcePage.set(Math.floor(Math.max(0, d.sources.findIndex(s => s.sourceId === sourceId)) / 15) + 1);
        this.detail.set(d); this.detailLoading.set(false);
      },
      error: (e) => { this.detailLoading.set(false); this.notify(inventoryErrorMessage(e), true); },
    });
  }

  markDamaged(): void {
    const d = this.detail();
    if (!d) return;
    const qty = Number(this.damageForm.quantity);
    if (!(qty > 0)) { this.notify('Nhập số lượng không đạt > 0.', true); return; }
    this.api.markDamaged(d.material.code, { quantity: qty, sourceId: this.damageForm.sourceId || undefined, note: this.damageForm.note }).subscribe({
      next: () => { this.notify(`Đã chuyển ${qty} ${d.material.unit} sang "Không đạt". Lập phiếu xuất "Xuất hủy NVL cách ly" khi hủy.`); this.openDetail(d.material.code); this.load(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  goImport(code: string): void {
    this.router.navigate(['/materials/imports'], { queryParams: { new: 1, material: code } });
  }

  /* ---------- Xuất CSV ---------- */
  exportCsv(): void {
    const header = ['Mã', 'Tên', 'Loại', 'Nhóm', 'ĐVT', 'Tồn thực', 'Đang giữ', 'Không đạt', 'Khả dụng', 'Ngưỡng cảnh báo', 'Ngưỡng tối đa', 'Trạng thái', 'Giá vốn BQ'];
    const rows = this.filtered().map((m) => [m.code, m.name, m.type, this.groupLabel(m.group), m.unit, m.onHand, m.reserved, m.damaged, m.available, m.threshold, m.maxLevel, m.status, m.averageCost]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ton-kho-nvl-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- helpers ---------- */
  groupLabel(g: string): string { return g === 'DE_HU' ? 'Dễ hư (FIFO)' : 'Ít hư (tồn tổng)'; }
  barWidth(m: InvMaterial, part: 'avail' | 'held' | 'bad'): number {
    const total = Math.max(m.onHand, 1);
    const v = part === 'avail' ? m.available : part === 'held' ? m.reserved : m.damaged;
    return Math.max(0, Math.min(100, (v / total) * 100));
  }
  movementLabel(type: string): string {
    return ({ NHAP: 'Nhập kho', DAO_NHAP: 'Đảo nhập kho', KHOI_PHUC_GIU: 'Khôi phục giữ sau đảo', DAO_CAM_SAN: 'Đảo cắm bó sẵn', DAO_XUAT: 'Đảo xuất kho', DIEU_CHINH_NHAP: 'Điều chỉnh tồn theo PN', XUAT: 'Xuất kho', GIU: 'Giữ tồn', NHA_GIU: 'Nhả giữ', KET_THUC_GIU: 'Kết thúc giữ', DANH_DAU_KHONG_DAT: 'Đánh dấu không đạt', XUAT_HUY: 'Xuất hủy/hao hụt' } as Record<string, string>)[type] || type;
  }
  notify(text: string, error = false): void {
    this.toast.set({ text, error });
    setTimeout(() => this.toast.set(null), error ? 6000 : 3500);
  }
  private normalize(v: string): string {
    return (v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
  }
}
