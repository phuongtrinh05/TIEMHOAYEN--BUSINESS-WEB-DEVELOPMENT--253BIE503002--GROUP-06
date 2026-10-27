import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InventoryTabsComponent } from '../inventory-tabs/inventory-tabs';
import { InvAlerts, InventoryApiService, inventoryErrorMessage } from '../../../services/inventory-api.service';

type Tab = 'alerts' | 'reservations' | 'demands' | 'finished' | 'ledger' | 'reconcile';

const MOVEMENT_LABEL: Record<string, string> = {
  NHAP: 'Nhập kho', XUAT: 'Xuất kho', GIU: 'Giữ tồn', NHA_GIU: 'Nhả giữ', KET_THUC_GIU: 'Kết thúc giữ (xuất)',
  DANH_DAU_KHONG_DAT: 'Đánh dấu không đạt', XUAT_HUY: 'Xuất hủy / hao hụt', NHAP_THANH_PHAM: 'Nhập thành phẩm',
  XUAT_THANH_PHAM: 'Giao thành phẩm', HUY_THANH_PHAM: 'Hủy thành phẩm', CHUYEN_GIU_CHINH_THUC: 'Chuyển giữ chính thức',
};

/**
 * Tổng quan kho (AD08): 3 tầng cảnh báo, giữ tồn, nhu cầu theo lịch T, thành phẩm cắm sẵn, sổ biến động, đối soát.
 */
@Component({
  selector: 'app-stock-overview',
  standalone: true,
  imports: [CommonModule, FormsModule, InventoryTabsComponent],
  templateUrl: './stock-overview.html',
  styleUrls: ['../inventory.css'],
})
export class StockOverviewComponent implements OnInit {
  private readonly api = inject(InventoryApiService);
  private readonly router = inject(Router);

  readonly tab = signal<Tab>('alerts');
  readonly alerts = signal<InvAlerts | null>(null);
  readonly reservations = signal<any[]>([]);
  readonly demands = signal<any[]>([]);
  readonly finished = signal<any[]>([]);
  readonly ledger = signal<any[]>([]);
  readonly reconcileResult = signal<{ ok: boolean; checkedMaterials: number; diffs: any[] } | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly toast = signal<{ text: string; error?: boolean } | null>(null);
  readonly movementLabel = MOVEMENT_LABEL;

  ledgerFilter = { materialId: '', type: '', orderId: '', from: '', to: '' };
  demandStatus = 'Chờ giữ';

  readonly demandGroups = computed(() => {
    const map = new Map<string, { orderId: string; neededAt: string | null; status: string; lines: any[] }>();
    this.demands().forEach((d) => {
      const g = map.get(d.DON_HANG_ID) || { orderId: d.DON_HANG_ID, neededAt: d.THOI_DIEM_CAN_DUNG, status: d.TRANG_THAI, lines: [] as any[] };
      g.lines.push(d);
      map.set(d.DON_HANG_ID, g);
    });
    return [...map.values()].sort((a, b) => String(a.neededAt || '9').localeCompare(String(b.neededAt || '9')));
  });

  ngOnInit(): void { this.loadAlerts(); }

  setTab(t: Tab): void {
    this.tab.set(t);
    if (t === 'alerts') this.loadAlerts();
    if (t === 'reservations') this.loadReservations();
    if (t === 'demands') this.loadDemands();
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
  loadDemands(): void { this.api.demands({ status: this.demandStatus }).subscribe({ next: (r) => this.demands.set(r.items), error: (e) => this.notify(inventoryErrorMessage(e), true) }); }
  loadFinished(): void { this.api.finishedGoods().subscribe({ next: (r) => this.finished.set(r.items), error: (e) => this.notify(inventoryErrorMessage(e), true) }); }
  loadLedger(): void {
    const f = this.ledgerFilter;
    this.api.movements({ ...f, from: f.from ? new Date(f.from).toISOString() : '', to: f.to ? new Date(f.to + 'T23:59:59').toISOString() : '', limit: 300 })
      .subscribe({ next: (r) => this.ledger.set(r.items), error: (e) => this.notify(inventoryErrorMessage(e), true) });
  }

  /* ---------- hành động ---------- */
  createPo(materialId: string, qty: number): void {
    this.router.navigate(['/materials/purchase-orders'], { queryParams: { new: 1, material: materialId, qty: Math.ceil(qty) } });
  }
  openMaterial(): void { this.router.navigate(['/materials']); }

  release(r: any): void {
    if (!confirm(`Nhả giữ ${r.SO_LUONG} ${r.TEN || ''} (${r.MA_GIU_TON})?`)) return;
    this.api.releaseReservations({ reservationIds: [r.MA_GIU_TON], reason: 'Admin nhả giữ thủ công' }).subscribe({
      next: (x) => { this.notify(`Đã nhả ${x.released} bản ghi giữ.`); this.loadReservations(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  setPrep(g: { orderId: string; neededAt: string | null }): void {
    const current = g.neededAt ? new Date(g.neededAt) : new Date(Date.now() + 86_400_000);
    const p = (n: number) => String(n).padStart(2, '0');
    const def = `${current.getFullYear()}-${p(current.getMonth() + 1)}-${p(current.getDate())} ${p(current.getHours())}:${p(current.getMinutes())}`;
    const v = prompt(`Thời điểm bắt đầu chuẩn bị T cho đơn ${g.orderId} (YYYY-MM-DD HH:mm):`, def);
    if (!v) return;
    this.api.setPrepTime(g.orderId, new Date(v.replace(' ', 'T')).toISOString()).subscribe({
      next: () => { this.notify('Đã cập nhật T. Dự báo thiếu NVL được tính lại.'); this.loadDemands(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  reserveNow(orderId: string): void {
    if (!confirm(`Giữ chính thức NVL cho đơn ${orderId} ngay bây giờ (đến lịch trước T)?`)) return;
    this.api.reserveDemand(orderId).subscribe({
      next: () => { this.notify('Đã giữ chính thức NVL cho đơn.'); this.loadDemands(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  issueForOrder(orderId: string): void {
    this.router.navigate(['/materials/exports'], { queryParams: { new: 1, type: 'Làm hoa theo đơn', orderId } });
  }

  dispose(p: any): void {
    const v = prompt(`Hủy bao nhiêu bó "${p.TEN_SAN_PHAM}" không đạt? (khả dụng ${p.KHA_DUNG})`, '1');
    if (!v) return;
    const note = prompt('Lý do?', 'Bó không còn đạt chất lượng') || '';
    this.api.disposeFinished(p.SAN_PHAM_ID, Number(v), note).subscribe({
      next: () => { this.notify('Đã hủy thành phẩm.'); this.loadFinished(); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  reconcile(fix: boolean): void {
    if (fix && !confirm('Ghi đè bộ đếm tồn theo sổ biến động? Chỉ dùng khi đã kiểm tra chênh lệch.')) return;
    this.api.reconcile(fix).subscribe({
      next: (r) => { this.reconcileResult.set(r); this.notify(r.ok ? 'Đối soát khớp.' : `Có ${r.diffs.length} chênh lệch.`, !r.ok); },
      error: (e) => this.notify(inventoryErrorMessage(e), true),
    });
  }

  holdLabel(s: string): string { return s === 'TAM_CHO_QR' ? 'Giữ tạm QR' : s === 'CHINH_THUC' ? 'Giữ chính thức' : s; }
  notify(text: string, error = false): void { this.toast.set({ text, error }); setTimeout(() => this.toast.set(null), error ? 7000 : 3500); }
}
