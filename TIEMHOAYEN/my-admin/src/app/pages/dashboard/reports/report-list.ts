import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AnalyticsApiService, ReportCatalog, ReportMeta } from '../../../services/analytics-api.service';
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
  imports: [CommonModule, FormsModule, RouterLink],
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
  rangeParams = signal<Record<string, string>>({});

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
    if (q.get('from') && q.get('to')) this.rangeParams.set({ from: q.get('from')!, to: q.get('to')!, ...(q.get('compare') ? { compare: q.get('compare')! } : {}) });
    if (q.get('category')) this.category.set(q.get('category')!);
    this.api.reportCatalog().subscribe({ next: (c) => this.catalog.set(c), error: (e: Error) => this.error.set(e.message) });
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
