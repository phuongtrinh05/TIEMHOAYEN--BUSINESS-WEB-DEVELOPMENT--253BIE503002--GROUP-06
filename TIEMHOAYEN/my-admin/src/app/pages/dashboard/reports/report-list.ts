import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AnalyticsApiService, ReportCatalog, ReportMeta, ReportRun } from '../../../services/analytics-api.service';
import { RangeFilter, RangeValue } from '../shared/range-filter';
import { ExportKind, ExportMenu, ExportSheet, exportCsv, exportExcel, printPdf } from '../shared/export';
import { switchApiBaseUrl } from '../../../services/api-config';
import * as F from '../shared/format';
import { readStore, writeStore } from './report-store';

type SortKey = 'name' | 'category' | 'viewed';

/**
 * TRANG DANH SÁCH BÁO CÁO — tổ chức các báo cáo chuyên biệt để tra cứu & đối soát.
 * Báo cáo phổ biến (thẻ) + bảng tất cả báo cáo: tìm theo tên/mô tả, lọc theo danh mục, đánh dấu yêu thích, xem gần nhất.
 */
@Component({
  selector: 'app-report-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RangeFilter, ExportMenu],
  templateUrl: './report-list.html',
  styleUrls: ['../shared/dashboard-shared.css', './reports.css'],
})
export class ReportList implements OnInit {
  private api = inject(AnalyticsApiService);
  private route = inject(ActivatedRoute);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly f = F;

  catalog = signal<ReportCatalog | null>(null);
  error = signal('');
  q = signal('');
  category = signal<string>('');
  onlyFavorites = signal(false);
  sortKey = signal<SortKey>('category');
  favorites = signal<string[]>(readStore().favorites);
  viewed = signal<Record<string, string>>(readStore().viewed);
  range = signal<RangeValue>({ from: F.isoDate(-29), to: F.isoDate(0), compare: 'previous' });
  rangeParams = computed<Record<string, string>>(() => ({ from: this.range().from, to: this.range().to }));
  exporting = signal(false);
  exportError = signal('');

  popular = computed(() => (this.catalog()?.reports || []).filter((r) => r.popular));
  recent = computed(() => {
    const v = this.viewed();
    return (this.catalog()?.reports || []).filter((r) => v[r.key]).sort((a, b) => v[b.key].localeCompare(v[a.key])).slice(0, 4);
  });

  filtered = computed(() => {
    const term = F.slug(this.q().trim()).toLowerCase();
    const cats = this.catalog()?.categories || [];
    const v = this.viewed();
    return (this.catalog()?.reports || [])
      .filter((r) => !this.category() || r.category === this.category())
      .filter((r) => !this.onlyFavorites() || this.favorites().includes(r.key))
      .filter((r) => !term || F.slug(`${r.name} ${r.description} ${r.category}`).toLowerCase().includes(term))
      .sort((a, b) => {
        if (this.sortKey() === 'name') return a.name.localeCompare(b.name, 'vi');
        if (this.sortKey() === 'viewed') return (v[b.key] || '').localeCompare(v[a.key] || '');
        return cats.indexOf(a.category) - cats.indexOf(b.category) || a.name.localeCompare(b.name, 'vi');
      });
  });

  countBy = computed(() => {
    const m: Record<string, number> = {};
    (this.catalog()?.reports || []).forEach((r) => (m[r.category] = (m[r.category] || 0) + 1));
    return m;
  });

  ngOnInit(): void {
    if (!this.isBrowser) return;
    const q = this.route.snapshot.queryParamMap;
    if (q.get('from') && q.get('to')) this.range.set({ from: q.get('from')!, to: q.get('to')!, compare: 'previous' });
    if (q.get('category')) this.category.set(q.get('category')!);
    this.api.reportCatalog().subscribe({ next: (c) => this.catalog.set(c), error: (e: Error) => this.error.set(e.message) });
  }

  onRange(v: RangeValue): void {
    this.range.set(v);
  }

  /** Xuất: chạy lần lượt các báo cáo đang hiển thị (cùng khoảng ngày) → Excel nhiều sheet / CSV gộp / PDF trang danh sách. */
  onExport(kind: ExportKind): void {
    if (kind === 'pdf') return printPdf();
    const list = this.filtered();
    if (!list.length) return;
    this.exporting.set(true);
    this.exportError.set('');
    const r = this.range();
    forkJoin(list.map((m) => this.api.runReport(m.key, { preset: 'custom', from: r.from, to: r.to }))).subscribe({
      next: (runs: ReportRun[]) => {
        const toRows = (run: ReportRun) => {
          const rows = run.rows.map((row) => Object.fromEntries(run.columns.map((c) => [c.label, c.type === 'date' ? F.dateOnly(row[c.key]) : c.type === 'datetime' ? F.dateTime(row[c.key]) : row[c.key] ?? ''])));
          if (run.columns.some((c) => c.sum)) rows.push(Object.fromEntries(run.columns.map((c, i) => [c.label, c.sum ? run.totals[c.key] : i === 0 ? 'TỔNG' : ''])));
          return rows;
        };
        const index: ExportSheet = {
          name: 'Mục lục',
          title: ['Danh sách báo cáo — Tiệm Hoa Yên', `Khoảng ngày: ${r.from} → ${r.to}`, `Xuất lúc ${F.dateTime(new Date())}`],
          rows: runs.map((run, i) => ({ 'STT': i + 1, 'Báo cáo': run.name, 'Danh mục': run.category, 'Phạm vi': run.snapshot ? 'Tại thời điểm xem' : run.range.label, 'Số dòng': run.totalRows, 'Mô tả': run.description })),
        };
        const sheets: ExportSheet[] = [index, ...runs.map((run) => ({ name: run.name, title: [run.name, run.snapshot ? `Tại thời điểm ${F.dateTime(run.generatedAt)}` : `Khoảng ngày: ${run.range.label}`, ...(run.note ? [run.note] : [])], rows: toRows(run) }))];
        const file = `DanhSachBaoCao_${r.from}_${r.to}`;
        if (kind === 'excel') exportExcel(file, sheets);
        else exportCsv(file, sheets);
        this.exporting.set(false);
      },
      error: (e: Error) => { this.exportError.set(e.message); this.exporting.set(false); },
    });
  }

  toggleFavorite(r: ReportMeta, ev?: Event): void {
    ev?.stopPropagation();
    ev?.preventDefault();
    const fav = this.favorites().includes(r.key) ? this.favorites().filter((k) => k !== r.key) : [...this.favorites(), r.key];
    this.favorites.set(fav);
    writeStore({ favorites: fav });
  }

  isFav(r: ReportMeta): boolean {
    return this.favorites().includes(r.key);
  }

  categoryClass(c: string): string {
    return 'cat-' + F.slug(c).toLowerCase();
  }

  useLocalBackend(): void {
    switchApiBaseUrl('local');
  }
}
