import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { interval } from 'rxjs';
import {
  AdminNotification,
  AnalyticsApiService,
  CompareMode,
  DashboardOverview,
  DeliveryItem,
  KpiCard,
  NotificationList,
  RangeQuery,
} from '../../services/analytics-api.service';
import { switchApiBaseUrl } from '../../services/api-config';
import { RangeFilter, RangeValue } from './shared/range-filter';
import * as F from './shared/format';
import { ENTER_ANIMATION } from './shared/charts';
import { ExportKind, ExportMenu, ExportSheet, exportCsv, exportExcel, printPdf } from './shared/export';

type ChartMetric = 'revenue' | 'cash' | 'orders';
export type ViewBy = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

/** Mốc đầu kỳ (giờ VN) của Ngày / Tuần (thứ Hai) / Tháng / Quý / Năm, tính tới hôm nay. */
const periodRange = (p: Exclude<Period, 'custom'>): { from: string; to: string } => {
  const today = F.isoDate(0);
  const [y, m, d] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (p) {
    case 'day': return { from: today, to: today };
    case 'week': {
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      return { from: F.isoDate(-((dow + 6) % 7)), to: today };
    }
    case 'month': return { from: `${y}-${pad(m)}-01`, to: today };
    case 'quarter': return { from: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, to: today };
    case 'year': return { from: `${y}-01-01`, to: today };
  }
};
const PERIOD_BUCKET: Record<Period, 'hour' | 'day' | 'week' | 'month' | undefined> = { day: 'hour', week: 'day', month: 'day', quarter: 'week', year: 'month', custom: undefined };

const NOTI_POLL_MS = 30_000;
const DELIVERY_POLL_MS = 60_000;

/** Bộ nhớ đệm trong phiên: quay lại trang hiện ngay số liệu lần trước rồi mới tải lại ngầm. */
const memo = new Map<string, unknown>();
const memoRange: { value: RangeValue | null } = { value: null };

/**
 * TRANG TỔNG QUAN — công việc hằng ngày:
 * kết quả kinh doanh (mặc định hôm nay), tình trạng đơn, lịch giao hoa, cảnh báo NVL, thông báo.
 * Muốn xem xu hướng → Bảng phân tích; muốn tra cứu chi tiết → Danh sách báo cáo (các nút liên kết mang theo khoảng ngày).
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, BaseChartDirective, RangeFilter, ExportMenu],
  templateUrl: './dashboard.html',
  styleUrls: ['./shared/dashboard-shared.css', './dashboard.css'],
})
export class Dashboard implements OnInit {
  private api = inject(AnalyticsApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly f = F;

  /** Mặc định: hôm nay, so với hôm qua. */
  range = signal<RangeValue>(memoRange.value || { from: F.isoDate(0), to: F.isoDate(0), compare: 'previous' });
  /** Xem số liệu biểu đồ theo Ngày / Tuần / Tháng / Quý / Năm trong khoảng Từ ngày – Đến ngày. */
  readonly viewOptions: { key: ViewBy; label: string }[] = [
    { key: 'day', label: 'Ngày' }, { key: 'week', label: 'Tuần' }, { key: 'month', label: 'Tháng' }, { key: 'quarter', label: 'Quý' }, { key: 'year', label: 'Năm' },
  ];
  /** null = tự chọn theo độ dài khoảng ngày. */
  viewBy = signal<ViewBy | null>(null);
  readonly periods: { key: Period; label: string }[] = [
    { key: 'day', label: 'Ngày' }, { key: 'week', label: 'Tuần' }, { key: 'month', label: 'Tháng' }, { key: 'quarter', label: 'Quý' }, { key: 'year', label: 'Năm' }, { key: 'custom', label: 'Tùy chọn' },
  ];
  /** Kỳ đang chọn — suy ra từ khoảng ngày (khớp Ngày/Tuần/… nào thì sáng nút đó). */
  period = signal<Period>('day');
  showCustom = signal(false);
  periodLabel = computed(() => ({ day: 'Hôm nay', week: 'Tuần này', month: 'Tháng này', quarter: 'Quý này', year: 'Năm nay', custom: 'Khoảng tùy chọn' } as Record<Period, string>)[this.period()]);
  isToday = computed(() => this.range().from === F.isoDate(0) && this.range().to === F.isoDate(0));
  compareShort = computed(() => (this.range().compare === 'lastYear' ? 'Năm trước' : this.range().from === this.range().to ? 'Hôm trước' : 'Kỳ trước'));

  overview = signal<DashboardOverview | null>(null);
  noti = signal<NotificationList | null>(null);
  deliveries = signal<DeliveryItem[]>([]);
  loading = signal(false);
  error = signal('');
  lastUpdated = signal<Date | null>(null);

  chartMetric = signal<ChartMetric>('revenue');
  deliveryMode = signal<'window' | 'today'>('window');
  notiGroup = signal('');

  /** Kết quả kinh doanh: 4 thẻ chính + 3 thẻ phụ. */
  mainKpis = computed(() => this.pick(['netRevenue', 'cashCollected', 'newOrders', 'depositHeld']));
  subKpis = computed(() => this.pick(['completedOrders', 'avgOrderValue', 'cancelRate']));

  statusTotal = computed(() => (this.overview()?.statusBreakdown || []).reduce((s, x) => s + x.count, 0));

  statusChart = computed<ChartConfiguration<'doughnut'>['data']>(() => {
    const rows = this.overview()?.statusBreakdown || [];
    return { labels: rows.map((r) => r.status), datasets: [{ data: rows.map((r) => r.count), backgroundColor: rows.map((_, i) => F.PALETTE[i % F.PALETTE.length]), borderWidth: 0 }] };
  });
  statusOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true, maintainAspectRatio: false, cutout: '64%', animation: { ...ENTER_ANIMATION, animateRotate: true, animateScale: true } as any, plugins: { legend: { display: false } },
  };

  chartData = computed<ChartConfiguration<'line'>['data']>(() => {
    const ov = this.overview();
    const m = this.chartMetric();
    if (!ov) return { labels: [], datasets: [] };
    const cur = ov.series.current[m];
    return {
      labels: ov.series.labels,
      datasets: [
        { label: 'Kỳ này', data: cur, borderColor: '#731919', backgroundColor: 'rgba(115,25,25,0.08)', pointRadius: cur.length > 40 ? 0 : 2, borderWidth: 2, tension: 0.3, fill: true },
        { label: this.compareShort(), data: ov.series.previous[m], borderColor: '#C9A27A', borderDash: [6, 4], pointRadius: 0, borderWidth: 2, tension: 0.3, fill: false },
      ],
    };
  });

  chartOptions = computed<ChartConfiguration<'line'>['options']>(() => {
    const isMoney = this.chartMetric() !== 'orders';
    return {
      responsive: true, maintainAspectRatio: false, animation: ENTER_ANIMATION, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { boxWidth: 16, font: { size: 12 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${isMoney ? F.money(Number(c.raw)) : F.num(Number(c.raw)) + ' đơn'}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: '#F1ECEA' }, ticks: { font: { size: 11 }, precision: 0, callback: (v) => (isMoney ? F.compact(Number(v)) : String(v)) } },
      },
    };
  });

  /* ---------------- Dự báo ---------------- */
  fcRevenueData = computed<ChartConfiguration<'line'>['data']>(() => {
    const r = this.overview()?.forecast?.revenue;
    if (!r) return { labels: [], datasets: [] };
    return {
      labels: r.labels,
      datasets: [
        { label: 'Thực tế', data: r.actual as any, borderColor: '#731919', backgroundColor: 'rgba(115,25,25,0.08)', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true, spanGaps: false },
        { label: 'Dự kiến', data: r.projected as any, borderColor: '#731919', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false },
        { label: 'Tháng trước', data: r.lastMonth as any, borderColor: '#C9A27A', borderWidth: 1.5, pointRadius: 0, tension: 0.25, fill: false },
      ],
    };
  });
  fcRevenueOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true, maintainAspectRatio: false, animation: ENTER_ANIMATION, interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', align: 'end', labels: { boxWidth: 14, font: { size: 11 } } },
      tooltip: { callbacks: { title: (items) => `Ngày ${items[0]?.label}`, label: (c) => (c.raw === null || c.raw === undefined ? '' : `${c.dataset.label}: ${F.money(Number(c.raw))}`) } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 11 } } },
      y: { beginAtZero: true, grid: { color: '#F1ECEA' }, ticks: { font: { size: 11 }, callback: (v) => F.compact(Number(v)) } },
    },
  };

  fcDeliveryData = computed<ChartConfiguration<'bar'>['data']>(() => {
    const d = this.overview()?.forecast?.deliveries;
    if (!d) return { labels: [], datasets: [] };
    return {
      labels: d.labels,
      datasets: [
        { label: 'Đã nhận', data: d.confirmed, backgroundColor: '#731919', borderRadius: 4, maxBarThickness: 34, stack: 's' },
        { label: 'Dự kiến thêm', data: d.expectedExtra, backgroundColor: '#E8D3C9', borderRadius: 4, maxBarThickness: 34, stack: 's' },
      ],
    };
  });
  fcDeliveryOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true, maintainAspectRatio: false, animation: ENTER_ANIMATION, interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', align: 'end', labels: { boxWidth: 14, font: { size: 11 } } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${F.num(Number(c.raw))} đơn` } },
    },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, font: { size: 11 } } },
      y: { stacked: true, beginAtZero: true, grid: { color: '#F1ECEA' }, ticks: { precision: 0, font: { size: 11 } } },
    },
  };

  shortIn7 = computed(() => (this.overview()?.forecast?.materials || []).filter((m) => m.short7).length);

  /** Màu theo số ngày còn đủ dùng: < 3 ngày đỏ, < 7 ngày cam, còn lại xanh. */
  coverColor = (days: number) => (days < 3 ? '#c0392b' : days < 7 ? '#E0A33A' : '#2F7D6B');
  fcMaterialData = computed<ChartConfiguration<'bar'>['data']>(() => {
    const m = this.overview()?.forecast?.materials || [];
    return {
      labels: m.map((x) => x.name),
      datasets: [{ label: 'Còn đủ dùng (ngày)', data: m.map((x) => Math.min(x.daysCover, 60)), backgroundColor: m.map((x) => this.coverColor(x.daysCover)), borderRadius: 4, maxBarThickness: 18 }],
    };
  });
  fcMaterialOptions = computed<ChartConfiguration<'bar'>['options']>(() => {
    const m = this.overview()?.forecast?.materials || [];
    return {
      responsive: true, maintainAspectRatio: false, animation: ENTER_ANIMATION, indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: (c) => { const x = m[c.dataIndex]; return x ? `Còn đủ ~${F.num(x.daysCover)} ngày · tồn ${F.num(x.available)} ${x.unit} · dùng ~${F.num(x.dailyUse)} ${x.unit}/ngày` : ''; },
          afterLabel: (c) => { const x = m[c.dataIndex]; return x?.need7 ? `Đơn 7 ngày tới cần ${F.num(x.need7)} ${x.unit}${x.short7 ? ' → THIẾU' : ''}` : ''; },
        } },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: '#F1ECEA' }, ticks: { font: { size: 11 }, callback: (v) => `${v} ng` } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    };
  });

  chartTotal = computed(() => {
    const ov = this.overview();
    const m = this.chartMetric();
    const sum = (a: number[] = []) => a.reduce((s, x) => s + x, 0);
    return { cur: sum(ov?.series.current[m]), prev: sum(ov?.series.previous[m]) };
  });

  ngOnInit(): void {
    if (!this.isBrowser) return;
    const q = this.route.snapshot.queryParamMap;
    if (q.get('from') && q.get('to')) this.range.set({ from: q.get('from')!, to: q.get('to')!, compare: (q.get('compare') as CompareMode) || 'previous' });
    const qp = q.get('period') as Period | null;
    this.period.set(qp && this.periods.some((x) => x.key === qp) ? qp : this.detectPeriod());
    const vb = q.get('view') as ViewBy | null;
    if (vb && this.viewOptions.some((x) => x.key === vb)) this.viewBy.set(vb);
    this.load();
    this.loadNotifications();
    const a = interval(NOTI_POLL_MS).subscribe(() => this.loadNotifications());
    const b = interval(DELIVERY_POLL_MS).subscribe(() => this.loadDeliveries());
    this.destroyRef.onDestroy(() => { a.unsubscribe(); b.unsubscribe(); });
  }

  private get query(): RangeQuery {
    const r = this.range();
    return { preset: 'custom', from: r.from, to: r.to, compare: r.compare };
  }

  private pick(keys: string[]): KpiCard[] {
    const all = this.overview()?.kpis || [];
    return keys.map((k) => all.find((x) => x.key === k)).filter((x): x is KpiCard => !!x);
  }

  load(fresh = false): void {
    memoRange.value = this.range();
    const key = `ov|${this.range().from}|${this.range().to}|${this.range().compare}|${this.deliveryMode()}|${this.period()}|${this.viewBy() ?? ''}`;
    const cached = memo.get(key) as DashboardOverview | undefined;
    if (cached && !fresh) this.apply(cached);
    this.loading.set(true);
    this.error.set('');
    this.api.overview(this.query, { deliveryMode: this.deliveryMode(), groupBy: this.viewBy() ?? (this.range().from === this.range().to ? 'hour' : PERIOD_BUCKET[this.period()]), fresh }).subscribe({
      next: (ov) => { memo.set(key, ov); this.apply(ov); this.loading.set(false); },
      error: (e: Error) => { this.error.set(e.message); this.loading.set(false); },
    });
  }

  private apply(ov: DashboardOverview): void {
    this.overview.set(ov);
    this.deliveries.set(ov.deliveries);
    this.lastUpdated.set(new Date(ov.generatedAt));
  }

  loadDeliveries(): void {
    this.api.deliveries(this.deliveryMode()).subscribe({ next: (r) => this.deliveries.set(r.items), error: () => void 0 });
  }

  loadNotifications(): void {
    const k = `noti|${this.notiGroup()}`;
    const cached = memo.get(k) as NotificationList | undefined;
    if (cached && !this.noti()) this.noti.set(cached);
    this.api.notifications({ group: this.notiGroup() || undefined, limit: 30 }).subscribe({ next: (r) => { memo.set(k, r); this.noti.set(r); }, error: () => void 0 });
  }

  /* ---------------- tương tác ---------------- */

  private detectPeriod(): Period {
    const r = this.range();
    const hit = (['day', 'week', 'month', 'quarter', 'year'] as const).find((p) => { const x = periodRange(p); return x.from === r.from && x.to === r.to; });
    return hit || 'custom';
  }

  setPeriod(p: Period): void {
    // Đang ở Tùy chọn thì giữ ô Từ ngày – Đến ngày; chỉ chọn kỳ khác mới ẩn đi.
    if (p === 'custom') { this.showCustom.set(this.period() === 'custom' ? true : !this.showCustom()); return; }
    this.showCustom.set(false);
    this.onRange({ ...periodRange(p), compare: this.range().compare }, p);
  }

  setCompare(c: CompareMode): void {
    if (c !== this.range().compare) this.onRange({ ...this.range(), compare: c }, this.period());
  }

  /** Đổi cách gom số liệu biểu đồ; giữ nguyên khoảng ngày. */
  setViewBy(v: ViewBy): void {
    this.viewBy.set(v);
    this.onRange(this.range(), this.period());
  }

  /** Từ bộ lọc: đổi ngày → Tùy chọn; chỉ đổi kỳ so sánh → giữ kỳ đang chọn. */
  onFilter(v: RangeValue): void {
    const r = this.range();
    this.onRange(v, v.from === r.from && v.to === r.to ? this.period() : 'custom');
  }

  /** p: kỳ người dùng vừa bấm (đầu tháng trùng hôm nay thì vẫn giữ "Tháng"). */
  onRange(v: RangeValue, p?: Period): void {
    this.range.set(v);
    this.period.set(p ?? this.detectPeriod());
    this.router.navigate([], { queryParams: { from: v.from, to: v.to, compare: v.compare, period: this.period(), view: this.viewBy() }, replaceUrl: true });
    this.load();
  }


  setDeliveryMode(m: 'window' | 'today'): void {
    this.deliveryMode.set(m);
    this.loadDeliveries();
  }

  setNotiGroup(g: string): void {
    this.notiGroup.set(g);
    this.loadNotifications();
  }

  refresh(): void {
    this.api.syncNotifications().subscribe({ next: () => this.loadNotifications(), error: () => void 0 });
    this.load(true);
  }

  /** Tham số khoảng ngày mang theo khi chuyển sang Bảng phân tích / Danh sách báo cáo. */
  rangeParams(): Record<string, string> {
    const r = this.range();
    return { from: r.from, to: r.to, compare: r.compare };
  }

  /** Nơi xem sâu cho từng KPI. */
  kpiTarget(k: KpiCard): { path: string; fragment?: string; label: string } {
    switch (k.key) {
      case 'depositHeld': return { path: '/dashboard/reports/deposits', label: 'Danh sách đơn đang giữ cọc' };
      case 'cashCollected': return { path: '/dashboard/reports/cashflow-by-day', label: 'Xem dòng tiền' };
      case 'newOrders': return { path: '/dashboard/reports/orders-detail', label: 'Xem chi tiết đơn' };
      case 'cancelRate': return { path: '/dashboard/analytics', fragment: 'van-hanh', label: 'Phân tích vận hành' };
      default: return { path: '/dashboard/analytics', fragment: 'doanh-thu', label: 'Phân tích xu hướng' };
    }
  }

  isEmptyRange(): boolean {
    const v = (key: string) => Number(this.overview()?.kpis.find((x) => x.key === key)?.value || 0);
    return !!this.overview() && v('newOrders') === 0 && v('completedOrders') === 0 && v('cashCollected') === 0;
  }

  jumpToLatest(): void {
    const at = this.overview()?.latestOrderAt;
    if (!at) return;
    const d = new Date(new Date(at).getTime() + 7 * 3_600_000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const pad = (n: number) => String(n).padStart(2, '0');
    this.onRange({ from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(new Date(Date.UTC(y, m + 1, 0)).getUTCDate())}`, compare: this.range().compare });
  }

  openNotification(n: AdminNotification): void {
    if (!n.read) {
      const cur = this.noti();
      if (cur) {
        this.noti.set({
          ...cur, unread: Math.max(0, cur.unread - 1),
          unreadByGroup: { ...cur.unreadByGroup, [n.group]: Math.max(0, (cur.unreadByGroup[n.group] || 0) - 1) },
          items: cur.items.map((i) => (i.id === n.id ? { ...i, read: true } : i)),
        });
      }
      this.api.markRead(n.id).subscribe({ next: () => this.loadNotifications(), error: () => void 0 });
    }
    this.navigate(n.link, n.queryParams || undefined);
  }

  markAllRead(): void {
    this.api.markAllRead(this.notiGroup() || undefined).subscribe({ next: () => this.loadNotifications(), error: (e: Error) => this.error.set(e.message) });
  }

  navigate(link: string, queryParams?: Record<string, string>): void {
    if (!link) return;
    const [path, qs] = link.split('?');
    const params: Record<string, string> = { ...Object.fromEntries(new URLSearchParams(qs || '')), ...(queryParams || {}) };
    // Thông báo cũ trỏ /dashboard?section=doi-soat → nay là báo cáo Đối chiếu
    if (path === '/dashboard' && params['section'] === 'doi-soat') {
      this.router.navigate(['/dashboard/reports/reconciliation']);
      return;
    }
    this.router.navigate([path], { queryParams: Object.keys(params).length ? params : undefined });
  }

  /* ---------------- xuất file ---------------- */

  onExport(kind: ExportKind): void {
    if (kind === 'pdf') return printPdf();
    const ov = this.overview();
    if (!ov) return;
    const head = [`Tổng quan — Tiệm Hoa Yên`, `Khoảng ngày: ${ov.range.label} · so với ${ov.range.previous.label}`, `Số liệu lúc ${F.dateTime(ov.generatedAt)}`];
    const sheets: ExportSheet[] = [
      { name: 'Kết quả kinh doanh', title: head, rows: ov.kpis.map((k) => ({ 'Chỉ số': k.label, 'Giá trị': k.value, [this.compareShort()]: k.previous, 'Thay đổi': F.changeText(k.change, k.unit), 'Đơn vị': k.unit, 'Ghi chú': k.snapshot ? `Tại thời điểm xem · ${k.extra || ''}` : '' })) },
      { name: 'Cần xử lý', rows: ov.needAction.map((n) => ({ 'Việc': n.label, 'Số lượng': n.count })) },
      { name: 'Tình trạng đơn', rows: ov.statusBreakdown.map((x) => ({ 'Trạng thái': x.status, 'Số đơn': x.count })) },
      { name: ov.series.bucket === 'hour' ? 'Theo giờ' : 'Theo ngày', rows: ov.series.labels.map((l, i) => ({
        'Mốc': l, 'Doanh thu thuần': ov.series.current.revenue[i], [`DT ${this.compareShort().toLowerCase()}`]: ov.series.previous.revenue[i] ?? null,
        'Tiền đã thu': ov.series.current.cash[i], 'Đơn mới': ov.series.current.orders[i] })) },
      { name: 'Lịch giao', rows: this.deliveries().map((d) => ({ 'Mã đơn': d.orderId, 'Giờ giao': F.dateTime(d.deliveryAt), 'Tình trạng': this.urgencyLabel(d), 'Người nhận': d.recipient, 'Địa chỉ': d.address, 'Sản phẩm': d.items.map((i) => `${i.name} ×${i.quantity}`).join(', '), 'Trạng thái đơn': d.status })) },
      { name: 'Đơn cần chú ý', rows: ov.attentionOrders.map((o) => ({ 'Mã đơn': o.orderId, 'Trạng thái': o.status, 'Giờ giao': F.dateTime(o.deliveryAt), 'Tổng tiền': o.total, 'Đã thu': o.paid, 'Lý do': o.reasons.map((r) => `${r.label} (${r.detail})`).join('; ') })) },
      { name: 'Cảnh báo NVL', rows: (ov.inventory?.materials || []).map((m) => ({ 'NVL': m.name, 'Mã': m.materialId, 'Tình trạng': m.label, 'Khả dụng': m.available, 'Ngưỡng': m.threshold, 'Gợi ý nhập': m.suggestedOrder, 'ĐVT': m.unit })) },
      { name: 'Bán chạy', rows: ov.bestProducts.map((p) => ({ 'Hạng': p.rank, 'Sản phẩm': p.name, 'Kiểu dáng': p.style, 'SL': p.quantity, 'Doanh thu hàng': p.revenue, 'Số đơn': p.orders })) },
    ];
    const file = `TongQuan_${this.range().from}_${this.range().to}`;
    if (kind === 'excel') exportExcel(file, sheets);
    else exportCsv(file, sheets);
  }

  useLocalBackend(): void {
    switchApiBaseUrl('local');
  }

  /* ---------------- hiển thị ---------------- */

  kpiPrev(k: KpiCard): string {
    if (k.previous === null || k.previous === undefined) return '—';
    if (k.unit === 'đ') return F.compact(k.previous) + (Math.abs(k.previous) >= 1e3 ? '' : 'đ');
    return F.kpiValue(k.previous, k.unit);
  }

  changePct(cur: number, prev: number): string {
    if (!prev) return '';
    const c = Math.round(((cur - prev) / prev) * 1000) / 10;
    return `${c > 0 ? '+' : ''}${c.toLocaleString('vi-VN')}%`;
  }

  urgencyLabel(d: DeliveryItem): string {
    if (d.urgency === 'overdue') {
      const late = Math.abs(d.minutesLeft);
      return late < 60 ? `Trễ ${late} phút` : `Trễ ${Math.floor(late / 60)}g${String(late % 60).padStart(2, '0')}`;
    }
    if (d.minutesLeft < 60) return `Còn ${d.minutesLeft} phút`;
    const h = Math.floor(d.minutesLeft / 60);
    const m = d.minutesLeft % 60;
    return `Còn ${h}g${m ? String(m).padStart(2, '0') : ''}`;
  }

  ago(v: string): string {
    const m = Math.round((Date.now() - new Date(v).getTime()) / 60_000);
    if (m < 1) return 'vừa xong';
    if (m < 60) return `${m} phút trước`;
    if (m < 1440) return `${Math.floor(m / 60)} giờ trước`;
    return `${Math.floor(m / 1440)} ngày trước`;
  }

  notiIcon(group: string): string {
    return ({ 'Đơn hàng': 'bi-bag-check', 'Tồn kho': 'bi-box-seam', 'Khiếu nại': 'bi-chat-left-dots', 'Hệ thống': 'bi-shield-exclamation' } as Record<string, string>)[group] || 'bi-bell';
  }

  needActionParams(status: string | null): Record<string, string> | null {
    return status ? { status } : null;
  }
}
