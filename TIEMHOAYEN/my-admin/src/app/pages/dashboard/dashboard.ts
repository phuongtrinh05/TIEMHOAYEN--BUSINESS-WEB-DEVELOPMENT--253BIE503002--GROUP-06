import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { interval } from 'rxjs';
import * as XLSX from 'xlsx';
import {
  AdminNotification,
  AnalyticsApiService,
  AnalyticsReport,
  CompareMode,
  DashboardOverview,
  DeliveryItem,
  GroupBy,
  KpiCard,
  NotificationList,
  RangePreset,
  RangeQuery,
  Reconciliation,
} from '../../services/analytics-api.service';
import { switchApiBaseUrl } from '../../services/api-config';

type ChartMetric = 'revenue' | 'cash' | 'orders';
type ReportTab = 'time' | 'product' | 'category' | 'payment' | 'cancel' | 'profit';

/** Cột xuất file: [tiêu đề, khóa | hàm lấy giá trị] */
type Col<T> = [string, keyof T | ((row: T) => unknown)];

const NOTI_POLL_MS = 30_000;
const DELIVERY_POLL_MS = 60_000;

/**
 * Bộ nhớ đệm phía trình duyệt (sống suốt phiên SPA): quay lại trang Tổng quan hiển thị ngay số liệu lần trước,
 * sau đó mới tải lại ngầm. Khóa = bộ lọc thời gian + tùy chọn.
 */
const memo = new Map<string, unknown>();
const memoState = { preset: 'custom' as RangePreset, customFrom: '', customTo: '', groupBy: null as GroupBy | null, compare: 'previous' as CompareMode };

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, BaseChartDirective],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  private api = inject(AnalyticsApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /* ---------- Bộ lọc thời gian chung (AD03) ---------- */
  /** Chỉ dùng khoảng Từ ngày – Đến ngày do người dùng chọn (mặc định 30 ngày gần nhất). */
  preset = signal<RangePreset>(memoState.preset);
  customFrom = signal(memoState.customFrom || this.isoDate(-29));
  customTo = signal(memoState.customTo || this.isoDate(0));
  /** Kỳ so sánh: mặc định kỳ liền trước (cùng độ dài, ngay trước "Từ ngày"). */
  compare = signal<CompareMode>(memoState.compare);
  compareName = computed(() => (this.compare() === 'lastYear' ? 'cùng kỳ năm trước' : 'kỳ liền trước'));
  compareShort = computed(() => (this.compare() === 'lastYear' ? 'Năm trước' : 'Kỳ trước'));

  /* ---------- Dữ liệu ---------- */
  overview = signal<DashboardOverview | null>(null);
  report = signal<AnalyticsReport | null>(null);
  reconcile = signal<Reconciliation | null>(null);
  noti = signal<NotificationList | null>(null);

  loading = signal(false);
  reportLoading = signal(false);
  reconcileLoading = signal(false);
  error = signal('');
  lastUpdated = signal<Date | null>(null);

  /* ---------- Trạng thái UI ---------- */
  chartMetric = signal<ChartMetric>('revenue');
  deliveryMode = signal<'window' | 'today'>('window');
  deliveries = signal<DeliveryItem[]>([]);
  bestSort = signal<'quantity' | 'revenue'>('quantity');
  notiGroup = signal<string>('');
  groupBy = signal<GroupBy>(memoState.groupBy || 'day');
  reportTab = signal<ReportTab>('time');
  openIssue = signal<string | null>(null);
  exportOpen = signal(false);
  showAllAttention = signal(false);

  readonly reportTabs: { key: ReportTab; label: string }[] = [
    { key: 'time', label: 'Theo thời gian' },
    { key: 'product', label: 'Theo sản phẩm' },
    { key: 'category', label: 'Chủ đề / kiểu dáng' },
    { key: 'payment', label: 'Phương thức thanh toán' },
    { key: 'cancel', label: 'Lý do hủy' },
    { key: 'profit', label: 'Lợi nhuận gộp' },
  ];
  readonly groupByOptions: { key: GroupBy; label: string }[] = [
    { key: 'day', label: 'Ngày' },
    { key: 'week', label: 'Tuần' },
    { key: 'month', label: 'Tháng' },
    { key: 'quarter', label: 'Quý' },
    { key: 'year', label: 'Năm' },
  ];

  /* ---------- Computed ---------- */
  /** 3 thẻ tiền đặt riêng hàng đầu để phân biệt doanh thu / đã thu / cọc. */
  moneyKpis = computed(() => (this.overview()?.kpis || []).filter((k) => ['netRevenue', 'cashCollected', 'depositHeld'].includes(k.key)));
  otherKpis = computed(() => (this.overview()?.kpis || []).filter((k) => !['netRevenue', 'cashCollected', 'depositHeld'].includes(k.key)));

  attentionVisible = computed(() => {
    const rows = this.overview()?.attentionOrders || [];
    return this.showAllAttention() ? rows : rows.slice(0, 6);
  });

  notiItems = computed(() => this.noti()?.items || []);

  issuesWithRows = computed(() => (this.reconcile()?.issues || []).filter((i) => i.count > 0));
  issuesClean = computed(() => (this.reconcile()?.issues || []).filter((i) => i.count === 0));

  reportMaxRevenue = computed(() => Math.max(1, ...(this.report()?.byProduct || []).map((p) => p.revenue)));

  chartData = computed<ChartConfiguration<'line'>['data']>(() => {
    const ov = this.overview();
    const m = this.chartMetric();
    if (!ov) return { labels: [], datasets: [] };
    const cur = ov.series.current[m];
    const prev = ov.series.previous[m];
    return {
      labels: ov.series.labels,
      datasets: [
        {
          label: 'Kỳ này',
          data: cur,
          borderColor: '#731919',
          backgroundColor: 'rgba(115,25,25,0.08)',
          pointRadius: cur.length > 40 ? 0 : 3,
          pointBackgroundColor: '#731919',
          borderWidth: 2,
          tension: 0.3,
          fill: true,
        },
        {
          label: this.compare() === 'lastYear' ? 'Cùng kỳ năm trước' : 'Kỳ liền trước',
          data: prev,
          borderColor: '#C9A27A',
          borderDash: [6, 4],
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.3,
          fill: false,
        },
      ],
    };
  });

  chartOptions = computed<ChartConfiguration<'line'>['options']>(() => {
    const isMoney = this.chartMetric() !== 'orders';
    const ov = this.overview();
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 18, usePointStyle: false, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            title: (items) => {
              const i = items[0]?.dataIndex ?? 0;
              const prevLabel = ov?.series.previous.labels[i];
              return `${items[0]?.label}${prevLabel ? `  (${this.compareShort().toLowerCase()}: ${prevLabel})` : ''}`;
            },
            label: (ctx) => `${ctx.dataset.label}: ${isMoney ? this.money(Number(ctx.raw)) : this.num(Number(ctx.raw)) + ' đơn'}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10, font: { size: 11 } } },
        y: {
          beginAtZero: true,
          grid: { color: '#F1ECEA' },
          ticks: { font: { size: 11 }, precision: 0, callback: (v) => (isMoney ? this.compact(Number(v)) : String(v)) },
        },
      },
    };
  });

  chartTotal = computed(() => {
    const ov = this.overview();
    if (!ov) return { cur: 0, prev: 0 };
    const m = this.chartMetric();
    const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
    return { cur: sum(ov.series.current[m]), prev: sum(ov.series.previous[m]) };
  });

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.loadAll();
    this.loadNotifications();
    const notiSub = interval(NOTI_POLL_MS).subscribe(() => this.loadNotifications());
    const delSub = interval(DELIVERY_POLL_MS).subscribe(() => this.loadDeliveries());
    this.destroyRef.onDestroy(() => {
      notiSub.unsubscribe();
      delSub.unsubscribe();
    });
    // Mở từ thông báo: /dashboard?section=doi-soat
    this.route.queryParamMap.subscribe((q) => {
      const s = q.get('section');
      if (s) setTimeout(() => this.scrollTo(s), 400);
    });
  }

  /* =====================================================================
   * Tải dữ liệu
   * ===================================================================== */

  private get query(): RangeQuery {
    const compare = this.compare();
    return this.preset() === 'custom' ? { preset: 'custom', from: this.customFrom(), to: this.customTo(), compare } : { preset: this.preset(), compare };
  }

  private key(kind: string, extra = ''): string {
    const q = this.query;
    return `${kind}|${q.preset}|${q.from || ''}|${q.to || ''}|${q.compare}|${extra}`;
  }

  /** Độ hạt mặc định cho bảng báo cáo — khớp autoBucket của backend (để không phải chờ overview). */
  private defaultGroupBy(): GroupBy {
    const p = this.preset();
    if (p === 'thisYear') return 'month';
    if (p !== 'custom') return 'day';
    const days = (new Date(this.customTo()).getTime() - new Date(this.customFrom()).getTime()) / 86_400_000 + 1;
    return days <= 62 ? 'day' : days <= 400 ? 'month' : 'year';
  }

  /**
   * Tải song song 3 khối độc lập: Tổng quan (KPI, biểu đồ, lịch giao…), Báo cáo, Đối chiếu.
   * Khối nào xong hiển thị khối đó — không chờ nhau. Có số liệu cũ trong bộ nhớ đệm thì hiển thị ngay.
   */
  loadAll(fresh = false, resetGroupBy = false): void {
    memoState.preset = this.preset();
    memoState.customFrom = this.customFrom();
    memoState.customTo = this.customTo();
    if (resetGroupBy || !memoState.groupBy) {
      this.groupBy.set(this.defaultGroupBy());
      memoState.groupBy = this.groupBy();
    }
    this.error.set('');

    const ovKey = this.key('overview', `${this.deliveryMode()}|${this.bestSort()}`);
    const cachedOv = memo.get(ovKey) as DashboardOverview | undefined;
    if (cachedOv && !fresh) {
      this.overview.set(cachedOv);
      this.deliveries.set(cachedOv.deliveries);
      this.lastUpdated.set(new Date(cachedOv.generatedAt));
    }
    this.loading.set(true);
    this.api.overview(this.query, { deliveryMode: this.deliveryMode(), bestSort: this.bestSort(), fresh }).subscribe({
      next: (ov) => {
        memo.set(ovKey, ov);
        this.overview.set(ov);
        this.deliveries.set(ov.deliveries);
        this.lastUpdated.set(new Date(ov.generatedAt));
        this.loading.set(false);
      },
      error: (e: Error) => {
        this.error.set(e.message);
        this.loading.set(false);
      },
    });

    this.loadReport(fresh);
    this.loadReconcile(fresh);
  }

  loadReport(fresh = false): void {
    memoState.groupBy = this.groupBy();
    const k = this.key('report', this.groupBy());
    const cached = memo.get(k) as AnalyticsReport | undefined;
    if (cached && !fresh) this.report.set(cached);
    this.reportLoading.set(true);
    this.api.report(this.query, this.groupBy(), fresh).subscribe({
      next: (r) => {
        memo.set(k, r);
        this.report.set(r);
        this.reportLoading.set(false);
      },
      error: (e: Error) => {
        this.error.set(e.message);
        this.reportLoading.set(false);
      },
    });
  }

  /** Đối chiếu không phụ thuộc bộ lọc → chỉ tải lại khi bấm Tải lại hoặc chưa có. */
  loadReconcile(fresh = false): void {
    const cached = memo.get('reconcile') as Reconciliation | undefined;
    if (cached && !fresh) {
      this.reconcile.set(cached);
      if (Date.now() - new Date(cached.generatedAt).getTime() < 60_000) return;
    }
    this.reconcileLoading.set(true);
    this.api.reconciliation(fresh).subscribe({
      next: (r) => {
        memo.set('reconcile', r);
        this.reconcile.set(r);
        this.reconcileLoading.set(false);
      },
      error: () => this.reconcileLoading.set(false),
    });
  }

  loadDeliveries(): void {
    this.api.deliveries(this.deliveryMode()).subscribe({ next: (r) => this.deliveries.set(r.items), error: () => void 0 });
  }

  loadBest(): void {
    this.api.bestProducts(this.query, this.bestSort()).subscribe({
      next: (r) => {
        const ov = this.overview();
        if (ov) this.overview.set({ ...ov, bestProducts: r.items });
      },
      error: (e: Error) => this.error.set(e.message),
    });
  }

  loadNotifications(): void {
    const k = `noti|${this.notiGroup()}`;
    const cached = memo.get(k) as NotificationList | undefined;
    if (cached && !this.noti()) this.noti.set(cached);
    this.api.notifications({ group: this.notiGroup() || undefined, limit: 30 }).subscribe({
      next: (r) => {
        memo.set(k, r);
        this.noti.set(r);
      },
      error: () => void 0,
    });
  }

  /* =====================================================================
   * Tương tác
   * ===================================================================== */

  onDateChange(which: 'from' | 'to', value: string): void {
    (which === 'from' ? this.customFrom : this.customTo).set(value || '');
  }

  applyCustom(): void {
    if (!this.customFrom() || !this.customTo()) {
      this.error.set('Chọn đủ Từ ngày và Đến ngày.');
      return;
    }
    if (this.customFrom() > this.customTo()) {
      this.error.set('Từ ngày phải trước hoặc bằng Đến ngày.');
      return;
    }
    const days = (new Date(this.customTo()).getTime() - new Date(this.customFrom()).getTime()) / 86_400_000;
    if (days > 731) {
      this.error.set('Khoảng ngày tối đa 2 năm.');
      return;
    }
    this.preset.set('custom');
    this.loadAll(false, true);
  }

  setDeliveryMode(m: 'window' | 'today'): void {
    this.deliveryMode.set(m);
    this.loadDeliveries();
  }

  setBestSort(s: 'quantity' | 'revenue'): void {
    if (this.bestSort() === s) return;
    this.bestSort.set(s);
    this.loadBest();
  }

  setGroupBy(g: GroupBy): void {
    this.groupBy.set(g);
    this.loadReport();
  }

  setNotiGroup(g: string): void {
    this.notiGroup.set(g);
    this.loadNotifications();
  }

  setCompare(c: CompareMode): void {
    if (this.compare() === c) return;
    this.compare.set(c);
    memoState.compare = c;
    this.loadAll();
  }

  /** Kỳ đang xem không có đơn nào (tạo mới hay hoàn thành). */
  isEmptyRange(): boolean {
    const k = this.overview()?.kpis || [];
    const v = (key: string) => Number(k.find((x) => x.key === key)?.value || 0);
    return k.length > 0 && v('newOrders') === 0 && v('completedOrders') === 0 && v('cashCollected') === 0;
  }

  /** Nhảy tới tháng có đơn gần nhất (bộ lọc Tùy chọn). */
  jumpToLatest(): void {
    const at = this.overview()?.latestOrderAt;
    if (!at) return;
    const d = new Date(new Date(at).getTime() + 7 * 3_600_000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const pad = (n: number) => String(n).padStart(2, '0');
    this.customFrom.set(`${y}-${pad(m + 1)}-01`);
    this.customTo.set(`${y}-${pad(m + 1)}-${pad(new Date(Date.UTC(y, m + 1, 0)).getUTCDate())}`);
    this.preset.set('custom');
    this.loadAll(false, true);
  }

  dateOnly(v: string | null): string {
    if (!v) return '—';
    return new Date(v).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
  }

  toggleIssue(code: string): void {
    this.openIssue.set(this.openIssue() === code ? null : code);
  }

  /** AD09 — nhấn thông báo: đánh dấu đã đọc (theo nhân viên) rồi mở đúng nội dung cần xử lý. */
  openNotification(n: AdminNotification): void {
    if (!n.read) {
      this.api.markRead(n.id).subscribe({ next: () => this.loadNotifications(), error: () => void 0 });
      this.patchNoti(n.id);
    }
    this.navigate(n.link, n.queryParams || undefined);
  }

  markAllRead(): void {
    this.api.markAllRead(this.notiGroup() || undefined).subscribe({ next: () => this.loadNotifications(), error: (e: Error) => this.error.set(e.message) });
  }

  private patchNoti(id: string): void {
    const cur = this.noti();
    if (!cur) return;
    const item = cur.items.find((i) => i.id === id);
    if (!item || item.read) return;
    this.noti.set({
      ...cur,
      unread: Math.max(0, cur.unread - 1),
      unreadByGroup: { ...cur.unreadByGroup, [item.group]: Math.max(0, (cur.unreadByGroup[item.group] || 0) - 1) },
      items: cur.items.map((i) => (i.id === id ? { ...i, read: true } : i)),
    });
  }

  navigate(link: string, queryParams?: Record<string, string>): void {
    if (!link) return;
    const [path, qs] = link.split('?');
    const params: Record<string, string> = { ...Object.fromEntries(new URLSearchParams(qs || '')), ...(queryParams || {}) };
    if (path === '/dashboard' && params['section']) {
      this.scrollTo(params['section']);
      return;
    }
    this.router.navigate([path], { queryParams: Object.keys(params).length ? params : undefined });
  }

  needActionParams(status: string | null): Record<string, string> | null {
    return status ? { status } : null;
  }

  scrollTo(id: string): void {
    if (!this.isBrowser) return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  useLocalBackend(): void {
    switchApiBaseUrl('local');
  }

  refresh(): void {
    this.api.syncNotifications().subscribe({ next: () => this.loadNotifications(), error: () => void 0 });
    this.loadAll(true);
  }

  /* =====================================================================
   * Xuất báo cáo: Excel (nhiều sheet) · CSV · PDF/In
   * ===================================================================== */

  private exportSheets(): { name: string; rows: Record<string, unknown>[] }[] {
    const ov = this.overview();
    const r = this.report();
    const rec = this.reconcile();
    const sheets: { name: string; rows: Record<string, unknown>[] }[] = [];
    const map = <T>(rows: T[], cols: Col<T>[]) =>
      rows.map((row) => Object.fromEntries(cols.map(([h, k]) => [h, typeof k === 'function' ? k(row) : (row as any)[k]])));

    if (ov) {
      sheets.push({
        name: 'KPI',
        rows: [
          { 'Chỉ số': 'Kỳ báo cáo', 'Giá trị': ov.range.label, 'Kỳ so sánh': `${this.compareName()} (${ov.range.previous.label})` },
          ...map(ov.kpis, [
            ['Mã', 'code'],
            ['Chỉ số', 'label'],
            ['Giá trị', 'value'],
            [this.compareShort(), 'previous'],
            ['Thay đổi', (k) => (k.change === null ? '' : `${k.change}${k.unit === '%' ? ' điểm %' : '%'}`)],
            ['Đơn vị', 'unit'],
            ['Công thức', 'formula'],
            ['Mốc ngày', 'dateField'],
          ]),
        ],
      });
    }
    if (r) {
      sheets.push({
        name: 'Theo thời gian',
        rows: map(r.periods, [
          ['Kỳ', 'label'],
          ['Đơn mới', 'newOrders'],
          ['Đơn hoàn thành', 'completedOrders'],
          ['Đơn hủy', 'cancelledOrders'],
          ['Yêu cầu trả/hoàn', 'refundRequests'],
          ['Doanh thu thuần', 'netRevenue'],
          ['Tiền đã thu', 'cashCollected'],
          ['Giá trị đơn TB', 'avgOrderValue'],
          ['Tỷ lệ hủy (%)', 'cancelRate'],
          ['Giá vốn (phần đủ dữ liệu)', 'cost'],
          ['Lợi nhuận gộp', 'grossProfit'],
        ]),
      });
      sheets.push({
        name: 'Sản phẩm',
        rows: map(r.byProduct, [
          ['Mã SP', 'productId'],
          ['Tên sản phẩm', 'name'],
          ['Kiểu dáng', 'style'],
          ['SL bán', 'quantity'],
          ['Số đơn', 'orders'],
          ['Doanh thu hàng', 'revenue'],
          ['Tỷ trọng (%)', 'share'],
          ['Giá vốn', (p) => p.cost ?? 'Chưa đủ dữ liệu'],
          ['Lợi nhuận gộp', (p) => p.grossProfit ?? 'Chưa đủ dữ liệu'],
          ['Biên LN (%)', (p) => p.margin ?? ''],
          ['Cách tính giá vốn', 'costMethod'],
        ]),
      });
      const grp = (name: string, rows: AnalyticsReport['byTopic']) => ({
        name,
        rows: map(rows, [
          ['Nhóm', 'name'],
          ['Số SP', 'products'],
          ['SL bán', 'quantity'],
          ['Doanh thu hàng', 'revenue'],
          ['Tỷ trọng (%)', 'share'],
          ['Lợi nhuận gộp', (g) => g.grossProfit ?? 'Chưa đủ dữ liệu'],
        ]),
      });
      sheets.push(grp('Chủ đề', r.byTopic), grp('Kiểu dáng', r.byStyle));
      sheets.push({ name: 'Thanh toán', rows: map(r.byPaymentMethod, [['Phương thức', 'method'], ['Số giao dịch', 'transactions'], ['Tiền đã thu', 'amount']]) });
      sheets.push({ name: 'Lý do hủy', rows: map(r.cancelReasons, [['Lý do', 'reason'], ['Số đơn', 'count']]) });
      sheets.push({
        name: 'Lợi nhuận',
        rows: [
          { 'Chỉ tiêu': 'Doanh thu hàng', 'Giá trị': r.profit.goodsRevenue },
          { 'Chỉ tiêu': 'Doanh thu có đủ giá vốn', 'Giá trị': r.profit.costCoveredRevenue },
          { 'Chỉ tiêu': 'Giá vốn', 'Giá trị': r.profit.cost },
          { 'Chỉ tiêu': 'Lợi nhuận gộp', 'Giá trị': r.profit.grossProfit },
          { 'Chỉ tiêu': 'Độ phủ dữ liệu giá vốn (%)', 'Giá trị': r.profit.coverage },
          ...r.profit.linesByMethod.map((m) => ({ 'Chỉ tiêu': `Số dòng: ${m.method}`, 'Giá trị': m.lines })),
          { 'Chỉ tiêu': 'Ghi chú', 'Giá trị': r.profit.note },
        ],
      });
    }
    if (ov) {
      sheets.push({
        name: 'Đơn cần chú ý',
        rows: map(ov.attentionOrders, [
          ['Mã đơn', 'orderId'],
          ['Trạng thái', 'status'],
          ['Giờ giao', (o) => this.dateTime(o.deliveryAt)],
          ['Tổng tiền', 'total'],
          ['Đã thu', 'paid'],
          ['Lý do', (o) => o.reasons.map((x) => `${x.label} (${x.detail})`).join('; ')],
        ]),
      });
      sheets.push({
        name: 'Lịch giao',
        rows: map(this.deliveries(), [
          ['Mã đơn', 'orderId'],
          ['Giờ giao', (d) => this.dateTime(d.deliveryAt)],
          ['Còn (phút)', 'minutesLeft'],
          ['Người nhận', 'recipient'],
          ['Địa chỉ', 'address'],
          ['Sản phẩm', (d) => d.items.map((i) => `${i.name} x${i.quantity}`).join(', ')],
          ['Trạng thái', 'status'],
        ]),
      });
    }
    if (rec) {
      sheets.push({
        name: 'Đối chiếu',
        rows: rec.issues.flatMap((i) =>
          i.count === 0
            ? [{ 'Mã lỗi': i.code, Nhóm: i.group, 'Mức độ': i.severity, 'Nội dung': i.title, 'Số trường hợp': 0, 'Chi tiết': 'Khớp' }]
            : i.rows.map((row) => ({ 'Mã lỗi': i.code, Nhóm: i.group, 'Mức độ': i.severity, 'Nội dung': i.title, 'Số trường hợp': i.count, 'Chi tiết': this.rowSummary(row) })),
        ),
      });
    }
    return sheets;
  }

  exportExcel(): void {
    this.exportOpen.set(false);
    const wb = XLSX.utils.book_new();
    this.exportSheets().forEach((s) => {
      const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ 'Không có dữ liệu': '' }]);
      const headers = Object.keys(s.rows[0] || {});
      ws['!cols'] = headers.map((h) => ({ wch: Math.min(48, Math.max(h.length + 2, ...s.rows.map((r) => String(r[h] ?? '').length + 2))) }));
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    });
    XLSX.writeFile(wb, `BaoCao_TiemHoaYen_${this.fileStamp()}.xlsx`);
  }

  /** CSV = bảng đang mở ở tab Báo cáo (UTF-8 BOM để Excel đọc đúng tiếng Việt). */
  exportCsv(): void {
    this.exportOpen.set(false);
    const sheets = this.exportSheets();
    const byTab: Record<ReportTab, string> = {
      time: 'Theo thời gian',
      product: 'Sản phẩm',
      category: 'Chủ đề',
      payment: 'Thanh toán',
      cancel: 'Lý do hủy',
      profit: 'Lợi nhuận',
    };
    const sheet = sheets.find((s) => s.name === byTab[this.reportTab()]) || sheets[0];
    if (!sheet) return;
    const ws = XLSX.utils.json_to_sheet(sheet.rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `BaoCao_${this.slug(sheet.name)}_${this.fileStamp()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** PDF: dùng hộp thoại In của trình duyệt (giữ đúng font tiếng Việt) → "Lưu dưới dạng PDF". */
  printReport(): void {
    this.exportOpen.set(false);
    setTimeout(() => window.print(), 50);
  }

  /* =====================================================================
   * Định dạng
   * ===================================================================== */

  money(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return new Intl.NumberFormat('vi-VN').format(Math.round(v)) + 'đ';
  }

  num(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return new Intl.NumberFormat('vi-VN').format(v);
  }

  compact(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ';
    if (a >= 1e6) return (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
    if (a >= 1e3) return (v / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'k';
    return String(v);
  }

  kpiValue(k: KpiCard): string {
    if (k.value === null || k.value === undefined) return '—';
    if (k.unit === 'đ') return this.money(k.value);
    if (k.unit === '%') return k.value.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%';
    return this.num(k.value);
  }

  kpiPrev(k: KpiCard): string {
    if (k.previous === null || k.previous === undefined) return '—';
    if (k.unit === 'đ') return this.compact(k.previous) + (Math.abs(k.previous) >= 1e3 ? '' : 'đ');
    if (k.unit === '%') return k.previous.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%';
    return this.num(k.previous);
  }

  /** Chiều "tốt": tỷ lệ hủy / yêu cầu hoàn giảm là tốt. */
  changeClass(k: KpiCard): string {
    if (k.change === null || k.change === 0) return 'flat';
    const lowerIsBetter = ['cancelRate', 'refundRequestRate'].includes(k.key);
    const good = lowerIsBetter ? k.change < 0 : k.change > 0;
    return good ? 'up' : 'down';
  }

  changeText(k: KpiCard): string {
    if (k.change === null) return '';
    const sign = k.change > 0 ? '+' : '';
    return `${sign}${k.change.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}${k.unit === '%' ? ' điểm' : '%'}`;
  }

  changePct(cur: number, prev: number): string {
    if (!prev) return '';
    const c = Math.round(((cur - prev) / prev) * 1000) / 10;
    return `${c > 0 ? '+' : ''}${c.toLocaleString('vi-VN')}%`;
  }

  urgencyLabel(d: DeliveryItem): string {
    if (d.urgency === 'overdue') return `Trễ ${Math.abs(d.minutesLeft)} phút`;
    if (d.minutesLeft < 60) return `Còn ${d.minutesLeft} phút`;
    const h = Math.floor(d.minutesLeft / 60);
    const m = d.minutesLeft % 60;
    return `Còn ${h}g${m ? String(m).padStart(2, '0') : ''}`;
  }

  time(v: string | Date | null): string {
    if (!v) return '—';
    return new Date(v).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
  }

  dateTime(v: string | Date | null): string {
    if (!v) return '—';
    return new Date(v).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
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

  /** Cột hiển thị cho bảng chi tiết lỗi đối chiếu (bỏ link). */
  issueColumns(rows: Record<string, unknown>[]): string[] {
    return Object.keys(rows[0] || {}).filter((k) => k !== 'link');
  }

  readonly columnLabels: Record<string, string> = {
    orderId: 'Mã đơn',
    total: 'Tổng tiền',
    paid: 'Đã thu',
    diff: 'Chênh lệch',
    status: 'Trạng thái',
    paymentId: 'Mã thanh toán',
    duplicateOf: 'Trùng với',
    transactionCode: 'Mã giao dịch',
    amount: 'Số tiền',
    linesPlusShipping: 'Σ dòng + ship',
    estimatedAt: 'Ngày HT ước tính',
    createdAt: 'Ngày tạo',
    reservationId: 'Mã giữ tồn',
    item: 'Mã hàng',
    quantity: 'Số lượng',
    kind: 'Loại',
    id: 'Mã',
    name: 'Tên',
    counters: 'Bộ đếm',
    ledger: 'Sổ kho',
  };

  cell(key: string, v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    if (['total', 'paid', 'diff', 'amount', 'linesPlusShipping'].includes(key) && typeof v === 'number') return this.money(v);
    if (['estimatedAt', 'createdAt'].includes(key)) return this.dateTime(String(v));
    if (typeof v === 'object') return Object.entries(v as object).map(([k, x]) => `${k}: ${x}`).join(', ');
    return String(v);
  }

  private rowSummary(row: Record<string, unknown>): string {
    return this.issueColumns([row]).map((k) => `${this.columnLabels[k] || k}: ${this.cell(k, row[k])}`).join(' | ');
  }

  private isoDate(offsetDays: number): string {
    const d = new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000);
    return d.toISOString().slice(0, 10);
  }

  private fileStamp(): string {
    const r = this.overview()?.range;
    const f = (s?: string) => (s ? new Date(new Date(s).getTime() + 7 * 3_600_000).toISOString().slice(0, 10) : '');
    return r ? `${f(r.from)}_${f(new Date(new Date(r.to).getTime() - 1).toISOString())}` : this.isoDate(0);
  }

  private slug(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^a-zA-Z0-9]+/g, '_');
  }

  barWidth(v: number, max: number): string {
    return `${Math.max(2, Math.round((v / Math.max(1, max)) * 100))}%`;
  }

  maxOf(rows: { revenue?: number; amount?: number; count?: number }[], key: 'revenue' | 'amount' | 'count'): number {
    return Math.max(1, ...rows.map((r) => Number(r[key] || 0)));
  }
}
