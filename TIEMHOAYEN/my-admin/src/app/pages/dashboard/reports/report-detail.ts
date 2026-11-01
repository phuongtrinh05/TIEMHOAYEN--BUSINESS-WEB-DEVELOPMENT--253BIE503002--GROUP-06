import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import * as XLSX from 'xlsx';
import { AnalyticsApiService, GroupBy, ReportRun } from '../../../services/analytics-api.service';
import { switchApiBaseUrl } from '../../../services/api-config';
import { RangeFilter, RangeValue } from '../shared/range-filter';
import * as F from '../shared/format';
import * as C from '../shared/charts';
import { markViewed, readStore, writeStore } from './report-store';

type Col = ReportRun['columns'][number];

/** Báo cáo ↔ khối tương ứng trên Bảng phân tích (để quay lại xem xu hướng). */
const ANALYSIS_SECTION: Record<string, string> = {
  'sales-by-time': 'doanh-thu', 'business-result': 'chi-phi', 'sales-by-product': 'dip-tang', 'sales-by-occasion': 'dip-tang', 'sales-by-style': 'dip-tang',
  'sales-by-customer': 'khach-hang', 'new-customers': 'khach-hang', reviews: 'khach-hang', 'material-usage': 'chi-phi', 'material-purchases': 'chi-phi',
  cancellations: 'van-hanh', refunds: 'van-hanh', 'delivery-schedule': 'van-hanh', 'orders-detail': 'van-hanh', 'payments-by-method': 'van-hanh', 'cashflow-by-day': 'doanh-thu',
};

/**
 * CHI TIẾT 1 BÁO CÁO — dùng chung cho mọi báo cáo trong danh mục:
 * lọc ngày / trạng thái / độ hạt, tìm kiếm, sắp xếp cột, phân trang, dòng tổng, biểu đồ, xuất Excel / CSV / PDF.
 */
@Component({
  selector: 'app-report-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, BaseChartDirective, RangeFilter],
  templateUrl: './report-detail.html',
  styleUrls: ['../shared/dashboard-shared.css', './reports.css'],
})
export class ReportDetail implements OnInit {
  private api = inject(AnalyticsApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly f = F;
  readonly Math = Math;

  readonly groupByOptions: { key: GroupBy; label: string }[] = [
    { key: 'day', label: 'Ngày' }, { key: 'week', label: 'Tuần' }, { key: 'month', label: 'Tháng' }, { key: 'quarter', label: 'Quý' }, { key: 'year', label: 'Năm' },
  ];
  readonly pageSizes = [20, 50, 100];

  key = signal('');
  range = signal<RangeValue>({ from: F.isoDate(-29), to: F.isoDate(0), compare: 'previous' });
  status = signal('');
  groupBy = signal<GroupBy | null>(null);
  report = signal<ReportRun | null>(null);
  loading = signal(false);
  error = signal('');
  search = signal('');
  sortCol = signal<string | null>(null);
  sortDir = signal<1 | -1>(-1);
  page = signal(1);
  pageSize = signal(20);
  exportOpen = signal(false);
  showChart = signal(true);
  favorite = signal(false);

  analysisSection = computed(() => ANALYSIS_SECTION[this.key()] || null);

  /** Hàng sau tìm kiếm + sắp xếp. */
  rows = computed(() => {
    const r = this.report();
    if (!r) return [];
    const term = F.slug(this.search().trim()).toLowerCase();
    let rows = r.rows;
    if (term) {
      const textCols = r.columns.map((c) => c.key);
      rows = rows.filter((row) => F.slug(textCols.map((k) => this.cell(row, r.columns.find((c) => c.key === k)!)).join(' ')).toLowerCase().includes(term));
    }
    const sc = this.sortCol();
    if (sc) {
      const dir = this.sortDir();
      rows = [...rows].sort((a, b) => {
        const x = a[sc];
        const y = b[sc];
        if (x === y) return 0;
        if (x === null || x === undefined || x === '') return 1;
        if (y === null || y === undefined || y === '') return -1;
        const nx = typeof x === 'number' ? x : Date.parse(x);
        const ny = typeof y === 'number' ? y : Date.parse(y);
        if (!Number.isNaN(nx) && !Number.isNaN(ny) && (typeof x === 'number' || /^\d{4}-\d{2}-\d{2}T/.test(String(x)))) return (nx - ny) * dir;
        return String(x).localeCompare(String(y), 'vi') * dir;
      });
    }
    return rows;
  });

  pageRows = computed(() => this.rows().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()));
  totalPages = computed(() => Math.max(1, Math.ceil(this.rows().length / this.pageSize())));

  /** Tổng theo hàng đang lọc (khác tổng toàn báo cáo khi có tìm kiếm). */
  totals = computed(() => {
    const r = this.report();
    if (!r) return {} as Record<string, number>;
    const out: Record<string, number> = {};
    r.columns.filter((c) => c.sum).forEach((c) => (out[c.key] = this.rows().reduce((s, row) => s + (Number(row[c.key]) || 0), 0)));
    return out;
  });
  hasTotals = computed(() => (this.report()?.columns || []).some((c) => c.sum));

  chartData = computed<ChartConfiguration['data'] | null>(() => {
    const ch = this.report()?.chart;
    if (!ch) return null;
    if (ch.type === 'doughnut') return C.doughnutData(ch.labels, ch.series[0]?.data || []) as any;
    return {
      labels: ch.labels,
      datasets: ch.series.map((s, i) => (ch.type === 'line' ? (C.lineSet(s.label, s.data, F.PALETTE[i], false, i === 0) as any) : C.barSet(s.label, s.data, F.PALETTE[i]))),
    };
  });
  chartOptions = computed<any>(() => {
    const ch = this.report()?.chart;
    if (!ch) return {};
    if (ch.type === 'doughnut') return { ...C.doughnutOptions(!!ch.money), plugins: { ...C.doughnutOptions(!!ch.money)!.plugins, legend: { display: true, position: 'right' } } };
    if (ch.type === 'line') return C.lineOptions(!!ch.money);
    return C.barOptions({ money: !!ch.money, legend: ch.series.length > 1, horizontal: ch.labels.length > 8 && ch.labels.some((l) => l.length > 10) });
  });

  ngOnInit(): void {
    if (!this.isBrowser) return;
    const sub = this.route.paramMap.subscribe((p) => {
      this.key.set(String(p.get('key') || ''));
      const q = this.route.snapshot.queryParamMap;
      if (q.get('from') && q.get('to')) this.range.set({ from: q.get('from')!, to: q.get('to')!, compare: 'previous' });
      this.status.set(q.get('status') || '');
      this.groupBy.set((q.get('groupBy') as GroupBy) || null);
      this.search.set('');
      this.sortCol.set(null);
      this.page.set(1);
      this.favorite.set(readStore().favorites.includes(this.key()));
      markViewed(this.key());
      this.load();
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  load(fresh = false): void {
    this.loading.set(true);
    this.error.set('');
    const r = this.range();
    this.api.runReport(this.key(), { preset: 'custom', from: r.from, to: r.to }, { groupBy: this.groupBy() || undefined, status: this.status(), fresh }).subscribe({
      next: (rep) => { this.report.set(rep); this.loading.set(false); this.page.set(1); },
      error: (e: Error) => { this.error.set(e.message); this.loading.set(false); },
    });
  }

  private syncUrl(): void {
    const r = this.range();
    this.router.navigate([], {
      queryParams: { from: r.from, to: r.to, status: this.status() || null, groupBy: this.groupBy() || null },
      replaceUrl: true,
    });
  }

  onRange(v: RangeValue): void {
    this.range.set(v);
    this.groupBy.set(null);
    this.syncUrl();
    this.load();
  }

  setStatus(s: string): void {
    this.status.set(s);
    this.syncUrl();
    this.load();
  }

  setGroupBy(g: GroupBy): void {
    this.groupBy.set(g);
    this.syncUrl();
    this.load();
  }

  sortBy(c: Col): void {
    if (this.sortCol() === c.key) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else { this.sortCol.set(c.key); this.sortDir.set(['text', 'status'].includes(c.type) ? 1 : -1); }
    this.page.set(1);
  }

  onSearch(v: string): void {
    this.search.set(v);
    this.page.set(1);
  }

  setPageSize(n: number): void {
    this.pageSize.set(Number(n));
    this.page.set(1);
  }

  toggleFavorite(): void {
    const s = readStore();
    const fav = s.favorites.includes(this.key()) ? s.favorites.filter((k) => k !== this.key()) : [...s.favorites, this.key()];
    writeStore({ favorites: fav });
    this.favorite.set(fav.includes(this.key()));
  }

  rangeParams(): Record<string, string> {
    return { from: this.range().from, to: this.range().to };
  }

  open(row: Record<string, any>): void {
    if (!row['_link']) return;
    const [path, qs] = String(row['_link']).split('?');
    this.router.navigate([path], { queryParams: qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined });
  }

  useLocalBackend(): void {
    switchApiBaseUrl('local');
  }

  /* ---------------- hiển thị ---------------- */

  cell(row: Record<string, any>, c: Col): string {
    const v = row[c.key];
    if (v === null || v === undefined || v === '') return c.type === 'money' || c.type === 'percent' ? (c.key === 'cost' || c.key === 'grossProfit' ? 'Chưa đủ dữ liệu' : '—') : '';
    switch (c.type) {
      case 'money': return F.money(Number(v));
      case 'number': return F.num(Number(v));
      case 'percent': return F.percent(Number(v));
      case 'date': return F.dateOnly(v);
      case 'datetime': return F.dateTime(v);
      default: return String(v);
    }
  }

  isNumeric(c: Col): boolean {
    return ['money', 'number', 'percent'].includes(c.type);
  }

  statusClass(v: unknown): string {
    const s = F.slug(String(v || '')).toLowerCase();
    if (/hoan_thanh|thanh_cong|da_mua|moi$|^moi|da_giao/.test(s)) return 't-green';
    if (/huy|that_bai|het|cao$|^cao/.test(s)) return 't-red';
    if (/cho|sap|trung_binh|hoan_tien|tra_hang|chua/.test(s)) return 't-orange';
    return '';
  }

  /* ---------------- xuất file ---------------- */

  private exportRows(): Record<string, unknown>[] {
    const r = this.report()!;
    const rows = this.rows().map((row) => Object.fromEntries(r.columns.map((c) => [c.label, this.rawValue(row[c.key], c)])));
    if (this.hasTotals()) rows.push(Object.fromEntries(r.columns.map((c, i) => [c.label, c.sum ? this.totals()[c.key] : i === 0 ? 'TỔNG' : ''])));
    return rows;
  }

  private rawValue(v: unknown, c: Col): unknown {
    if (v === null || v === undefined) return '';
    if (c.type === 'date') return F.dateOnly(v as string);
    if (c.type === 'datetime') return F.dateTime(v as string);
    return v;
  }

  private fileName(ext: string): string {
    const r = this.report()!;
    const span = r.snapshot ? F.isoDate(0) : `${this.range().from}_${this.range().to}`;
    return `BaoCao_${F.slug(r.name)}_${span}.${ext}`;
  }

  exportExcel(): void {
    this.exportOpen.set(false);
    const r = this.report();
    if (!r) return;
    const header = [
      [r.name],
      [r.snapshot ? `Tại thời điểm: ${F.dateTime(r.generatedAt)}` : `Khoảng ngày: ${r.range.label}`],
      [this.status() ? `Lọc trạng thái: ${this.status()}` : '', this.search() ? `Tìm: "${this.search()}"` : ''],
      [],
    ];
    const ws = XLSX.utils.aoa_to_sheet(header);
    XLSX.utils.sheet_add_json(ws, this.exportRows(), { origin: header.length });
    ws['!cols'] = r.columns.map((c) => ({ wch: Math.min(48, Math.max(c.label.length + 2, ...this.rows().slice(0, 200).map((row) => String(this.cell(row, c)).length + 2))) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, r.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    if (r.note) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Ghi chú'], [r.note], [r.description]]), 'Ghi chu');
    XLSX.writeFile(wb, this.fileName('xlsx'));
  }

  exportCsv(): void {
    this.exportOpen.set(false);
    if (!this.report()) return;
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(this.exportRows()));
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.fileName('csv');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** PDF: in toàn bộ hàng đang lọc (bỏ phân trang) qua hộp thoại In của trình duyệt. */
  printing = signal(false);
  print(): void {
    this.exportOpen.set(false);
    this.printing.set(true);
    setTimeout(() => {
      window.print();
      this.printing.set(false);
    }, 80);
  }
}
