import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { AnalysisKpi, AnalysisPage, AnalyticsApiService, CompareMode, GroupBy, RangeQuery } from '../../../services/analytics-api.service';
import { switchApiBaseUrl } from '../../../services/api-config';
import { RangeFilter, RangeValue } from '../shared/range-filter';
import * as F from '../shared/format';
import * as C from '../shared/charts';
import { ExportKind, ExportMenu, ExportSheet, exportCsv, exportExcel, printPdf } from '../shared/export';

const memo = new Map<string, AnalysisPage>();
const memoState: { range: RangeValue | null; groupBy: GroupBy | null } = { range: null, groupBy: null };

/**
 * TRANG BẢNG PHÂN TÍCH — phục vụ quyết định kinh doanh.
 * 5 khối: Xu hướng doanh thu · Sản phẩm theo dịp tặng · Khách hàng · Chi phí · Hiệu quả vận hành.
 * Mỗi khối có nút "Báo cáo chi tiết" mở đúng báo cáo trong Danh sách báo cáo với cùng khoảng ngày.
 */
@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, RouterLink, BaseChartDirective, RangeFilter, ExportMenu],
  templateUrl: './analytics.html',
  styleUrls: ['../shared/dashboard-shared.css', './analytics.css'],
})
export class Analytics implements OnInit {
  private api = inject(AnalyticsApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly f = F;

  readonly sections = [
    { id: 'doanh-thu', label: 'Xu hướng doanh thu', icon: 'bi-graph-up-arrow' },
    { id: 'dip-tang', label: 'Sản phẩm theo dịp tặng', icon: 'bi-gift' },
    { id: 'khach-hang', label: 'Khách hàng', icon: 'bi-people' },
    { id: 'chi-phi', label: 'Chi phí', icon: 'bi-cash-stack' },
    { id: 'van-hanh', label: 'Hiệu quả vận hành', icon: 'bi-speedometer2' },
  ];
  readonly groupByOptions: { key: GroupBy; label: string }[] = [
    { key: 'day', label: 'Ngày' }, { key: 'week', label: 'Tuần' }, { key: 'month', label: 'Tháng' }, { key: 'quarter', label: 'Quý' }, { key: 'year', label: 'Năm' },
  ];

  range = signal<RangeValue>(memoState.range || { from: F.isoDate(-29), to: F.isoDate(0), compare: 'previous' });
  groupBy = signal<GroupBy | null>(memoState.groupBy);
  data = signal<AnalysisPage | null>(null);
  loading = signal(false);
  error = signal('');
  revenueMetric = signal<'revenue' | 'profit' | 'cash'>('revenue');
  compareShort = computed(() => (this.range().compare === 'lastYear' ? 'Cùng kỳ năm trước' : 'Kỳ liền trước'));

  ngOnInit(): void {
    if (!this.isBrowser) return;
    const q = this.route.snapshot.queryParamMap;
    if (q.get('from') && q.get('to')) this.range.set({ from: q.get('from')!, to: q.get('to')!, compare: (q.get('compare') as CompareMode) || 'previous' });
    this.load();
  }

  private get query(): RangeQuery {
    const r = this.range();
    return { preset: 'custom', from: r.from, to: r.to, compare: r.compare };
  }

  load(fresh = false): void {
    memoState.range = this.range();
    memoState.groupBy = this.groupBy();
    const key = `${this.range().from}|${this.range().to}|${this.range().compare}|${this.groupBy() || ''}`;
    if (memo.has(key) && !fresh) this.data.set(memo.get(key)!);
    this.loading.set(true);
    this.error.set('');
    this.api.analysis(this.query, this.groupBy() || undefined, fresh).subscribe({
      next: (d) => {
        memo.set(key, d);
        this.data.set(d);
        this.loading.set(false);
        const frag = this.route.snapshot.fragment;
        if (frag) setTimeout(() => this.scrollTo(frag), 150);
      },
      error: (e: Error) => { this.error.set(e.message); this.loading.set(false); },
    });
  }

  onRange(v: RangeValue): void {
    this.range.set(v);
    this.groupBy.set(null); // để server chọn độ hạt phù hợp với khoảng mới
    this.router.navigate([], { queryParams: { from: v.from, to: v.to, compare: v.compare }, replaceUrl: true });
    this.load();
  }

  setGroupBy(g: GroupBy): void {
    this.groupBy.set(g);
    this.load();
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  rangeParams(extra: Record<string, string> = {}): Record<string, string> {
    const r = this.range();
    return { from: r.from, to: r.to, compare: r.compare, ...extra };
  }

  /* ======================= Xuất file ======================= */

  onExport(kind: ExportKind): void {
    if (kind === 'pdf') return printPdf();
    const d = this.data();
    if (!d) return;
    const cmp = this.compareShort();
    const kpiRows = (rows: AnalysisKpi[]) => rows.map((k) => ({ 'Chỉ số': k.label, 'Giá trị': k.value, [cmp]: k.previous, 'Thay đổi': F.changeText(k.change, k.unit), 'Đơn vị': k.unit }));
    const s = d.revenue.series;
    const sheets: ExportSheet[] = [
      { name: '1. Doanh thu - KPI', title: ['Bảng phân tích — Tiệm Hoa Yên', `Khoảng ngày: ${d.range.label} · so với ${cmp.toLowerCase()} (${d.range.previous.label})`, `Số liệu lúc ${F.dateTime(d.generatedAt)}`], rows: kpiRows(d.revenue.kpis) },
      { name: '1. Doanh thu - Diễn biến', rows: s.labels.map((l, i) => ({ 'Kỳ': l, 'Doanh thu thuần': s.netRevenue[i], [`DT ${cmp.toLowerCase()}`]: s.netRevenuePrev[i] ?? null, 'LN gộp': s.grossProfit[i], 'Tiền đã thu': s.cashCollected[i], 'Đơn hoàn thành': s.completedOrders[i] })) },
      { name: '1. Doanh thu - Thứ', rows: d.revenue.byWeekday.map((w) => ({ 'Thứ': w.label, 'Doanh thu thuần': w.revenue, 'Đơn hoàn thành': w.orders })) },
      { name: '2. Dịp tặng', rows: d.occasions.byTopic.map((t) => ({ 'Dịp tặng': t.name, 'Số mẫu': t.products, 'SL': t.quantity, 'Số đơn': t.orders, 'Doanh thu hàng': t.revenue, 'Tỷ trọng %': t.share, [cmp]: t.previous ?? null, 'Thay đổi': F.changeText(t.change ?? null), 'LN gộp': t.grossProfit ?? 'Chưa đủ dữ liệu', 'Biên %': t.margin })) },
      { name: '2. Kiểu dáng', rows: d.occasions.byStyle.map((t) => ({ 'Kiểu dáng': t.name, 'SL': t.quantity, 'Doanh thu hàng': t.revenue, 'Tỷ trọng %': t.share, 'LN gộp': t.grossProfit ?? 'Chưa đủ dữ liệu', 'Biên %': t.margin })) },
      { name: '2. Dịp x kiểu dáng', rows: d.occasions.matrix.topics.map((t, i) => ({ 'Dịp tặng': t, ...Object.fromEntries(d.occasions.matrix.styles.map((st, j) => [st, d.occasions.matrix.cells[i][j]])) })) },
      { name: '2. Top sản phẩm', rows: d.occasions.topProducts.map((p, i) => ({ '#': i + 1, 'Sản phẩm': p.name, 'Dịp tặng': p.topic, 'Kiểu dáng': p.style, 'SL': p.quantity, 'Doanh thu hàng': p.revenue, 'LN gộp': p.grossProfit ?? 'Chưa đủ dữ liệu', 'Biên %': p.margin, 'Cách tính giá vốn': p.costMethod })) },
      { name: '3. Khách hàng - KPI', rows: kpiRows(d.customers.kpis) },
      { name: '3. Khách mới - quay lại', rows: d.customers.series.labels.map((l, i) => ({ 'Kỳ': l, 'Mua lần đầu': d.customers.series.newBuyers[i], 'Quay lại': d.customers.series.returningBuyers[i] })) },
      { name: '3. Nhóm khách', rows: d.customers.revenueSplit.map((x) => ({ 'Nhóm': x.label, 'Doanh thu thuần': x.value })) },
      { name: '3. Top khách', rows: d.customers.topCustomers.map((c) => ({ 'Khách hàng': c.name, 'SĐT': c.phone, 'Loại': c.type, 'Số đơn': c.orders, 'Doanh thu thuần': c.revenue, 'Mua gần nhất': F.dateOnly(c.lastOrderAt) })) },
      { name: '3. Đánh giá', rows: d.customers.ratingDist.map((r) => ({ 'Số sao': r.stars, 'Số đánh giá': r.count })) },
      { name: '4. Kết quả kinh doanh', rows: d.costs.statement.map((x) => ({ 'Chỉ tiêu': x.label, 'Kỳ này': x.value, [cmp]: x.previous, 'Thay đổi': F.changeText(x.change), 'Ghi chú': x.note || '' })) },
      { name: '4. Chi phí - tỷ lệ', rows: [...kpiRows(d.costs.ratios), ...d.costs.breakdown.map((b) => ({ 'Chỉ số': b.label, 'Giá trị': b.value, [cmp]: null, 'Thay đổi': '', 'Đơn vị': 'đ' }))] },
      { name: '4. Chi phí theo kỳ', rows: d.costs.series.labels.map((l, i) => ({ 'Kỳ': l, 'Doanh thu thuần': d.costs.series.revenue[i], 'Giá vốn NVL': d.costs.series.cogs[i], 'Hao hụt / hủy': d.costs.series.loss[i], 'Tiền nhập NVL': d.costs.series.purchases[i] })) },
      { name: '5. Vận hành - KPI', rows: kpiRows(d.operations.kpis) },
      { name: '5. Phễu đơn', rows: d.operations.funnel.map((f) => ({ 'Bước': f.label, 'Số đơn': f.count, 'Tỷ lệ %': f.rate })) },
      { name: '5. Giờ giao', rows: d.operations.deliveryByHour.map((h) => ({ 'Giờ': h.label, 'Số đơn': h.orders })) },
      { name: '5. Lý do hủy', rows: d.operations.cancelReasons.map((c) => ({ 'Lý do': c.reason, 'Số đơn': c.count })) },
      { name: '5. Thanh toán', rows: d.operations.paymentMethods.map((m) => ({ 'Phương thức': m.method, 'Tiền đã thu': m.amount })) },
    ];
    const file = `BangPhanTich_${this.range().from}_${this.range().to}`;
    if (kind === 'excel') exportExcel(file, sheets);
    else exportCsv(file, sheets);
  }

  useLocalBackend(): void {
    switchApiBaseUrl('local');
  }

  /* ======================= Biểu đồ ======================= */

  revenueChart = computed<ChartConfiguration<'bar'>['data']>(() => {
    const d = this.data();
    if (!d) return { labels: [], datasets: [] };
    const s = d.revenue.series;
    const m = this.revenueMetric();
    const main = m === 'profit' ? s.grossProfit : m === 'cash' ? s.cashCollected : s.netRevenue;
    const label = m === 'profit' ? 'Lợi nhuận gộp' : m === 'cash' ? 'Tiền đã thu' : 'Doanh thu thuần';
    return {
      labels: s.labels,
      datasets: [
        C.lineSet(label, main, F.PALETTE[0], false, true) as any,
        ...(m === 'revenue' ? [C.lineSet(this.compareShort(), s.netRevenuePrev, F.PALETTE[1], true) as any] : []),
        { ...C.barSet('Đơn hoàn thành', s.completedOrders, 'rgba(201,162,122,0.35)'), yAxisID: 'y1' },
      ],
    };
  });
  revenueOptions: ChartConfiguration<'bar'>['options'] = {
    ...C.barOptions({ money: true, legend: true }),
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 11 } } },
      y: { beginAtZero: true, grid: { color: '#F1ECEA' }, ticks: { font: { size: 11 }, callback: (v) => F.compact(Number(v)) } },
      y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { font: { size: 11 }, precision: 0 }, title: { display: true, text: 'đơn', font: { size: 11 } } },
    },
    plugins: {
      legend: { position: 'top', align: 'end', labels: { boxWidth: 14, font: { size: 12 } } },
      tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${c.dataset.yAxisID === 'y1' ? F.num(Number(c.raw)) + ' đơn' : F.money(Number(c.raw))}` } },
    },
  };

  weekdayChart = computed<ChartConfiguration<'bar'>['data']>(() => {
    const w = this.data()?.revenue.byWeekday || [];
    return { labels: w.map((x) => x.label), datasets: [C.barSet('Doanh thu thuần', w.map((x) => x.revenue))] };
  });
  moneyBar = C.barOptions({ money: true });
  moneyBarH = C.barOptions({ money: true, horizontal: true });
  countBarH = C.barOptions({ horizontal: true, unit: 'đơn' });
  countBar = C.barOptions({ unit: 'đơn' });
  stackedBar = C.barOptions({ stacked: true, legend: true, unit: 'khách' });
  costLine = C.barOptions({ money: true, legend: true });
  doughnutMoney = C.doughnutOptions(true);
  doughnutCount = C.doughnutOptions(false);

  topicChart = computed(() => {
    const t = this.data()?.occasions.byTopic || [];
    return C.doughnutData(t.map((x) => x.name), t.map((x) => x.revenue));
  });

  styleChart = computed<ChartConfiguration<'bar'>['data']>(() => {
    const s = this.data()?.occasions.byStyle || [];
    return { labels: s.map((x) => x.name), datasets: [C.barSet('Doanh thu hàng', s.map((x) => x.revenue), F.PALETTE[1]), C.barSet('LN gộp', s.map((x) => x.grossProfit ?? 0), F.PALETTE[2])] };
  });
  styleOptions = C.barOptions({ money: true, horizontal: true, legend: true });

  matrixMax = computed(() => Math.max(1, ...(this.data()?.occasions.matrix.cells.flat() || [0])));
  heat(v: number): string {
    if (!v) return 'transparent';
    const a = 0.12 + 0.78 * (v / this.matrixMax());
    return `rgba(115, 25, 25, ${a.toFixed(2)})`;
  }

  customerChart = computed<ChartConfiguration<'bar'>['data']>(() => {
    const s = this.data()?.customers.series;
    if (!s) return { labels: [], datasets: [] };
    return { labels: s.labels, datasets: [C.barSet('Mua lần đầu', s.newBuyers, F.PALETTE[0]), C.barSet('Quay lại', s.returningBuyers, F.PALETTE[1])] };
  });
  splitChart = computed(() => {
    const s = this.data()?.customers.revenueSplit || [];
    return C.doughnutData(s.map((x) => x.label), s.map((x) => x.value));
  });
  ratingTotal = computed(() => (this.data()?.customers.ratingDist || []).reduce((s, x) => s + x.count, 0));

  costChart = computed<ChartConfiguration<'bar'>['data']>(() => {
    const s = this.data()?.costs.series;
    if (!s) return { labels: [], datasets: [] };
    return {
      labels: s.labels,
      datasets: [
        C.lineSet('Doanh thu thuần', s.revenue, F.PALETTE[0]) as any,
        C.barSet('Giá vốn NVL', s.cogs, F.PALETTE[1], { stack: 'cost' }),
        C.barSet('Hao hụt / hủy', s.loss, F.PALETTE[3], { stack: 'cost' }),
        C.barSet('Tiền nhập NVL', s.purchases, 'rgba(75,106,136,0.45)', { stack: 'buy' }),
      ],
    };
  });
  costBreakdownChart = computed(() => {
    const b = (this.data()?.costs.breakdown || []).filter((x) => x.value > 0);
    return C.doughnutData(b.map((x) => x.label), b.map((x) => x.value));
  });
  statementMax = computed(() => Math.max(1, ...(this.data()?.costs.statement || []).map((x) => Math.abs(x.value))));

  hourChart = computed<ChartConfiguration<'bar'>['data']>(() => {
    const h = this.data()?.operations.deliveryByHour || [];
    return { labels: h.map((x) => x.label), datasets: [C.barSet('Đơn cần giao', h.map((x) => x.orders), F.PALETTE[4])] };
  });
  cancelChart = computed<ChartConfiguration<'bar'>['data']>(() => {
    const c = this.data()?.operations.cancelReasons || [];
    return { labels: c.map((x) => x.reason), datasets: [C.barSet('Số đơn', c.map((x) => x.count), F.PALETTE[3])] };
  });
  methodChart = computed(() => {
    const m = this.data()?.operations.paymentMethods || [];
    return C.doughnutData(m.map((x) => x.method), m.map((x) => x.amount));
  });

  /* ======================= Hiển thị ======================= */

  kpiPrev(k: AnalysisKpi): string {
    if (k.previous === null || k.previous === undefined) return '';
    return (this.range().compare === 'lastYear' ? 'Năm trước ' : 'Kỳ trước ') + (k.unit === 'đ' ? F.compact(k.previous) : F.kpiValue(k.previous, k.unit));
  }

  sum(values: number[]): number {
    return values.reduce((s, v) => s + v, 0);
  }

  barPct(v: number, max: number): string {
    return `${Math.max(1, Math.round((Math.abs(v) / Math.max(1, max)) * 100))}%`;
  }
}
