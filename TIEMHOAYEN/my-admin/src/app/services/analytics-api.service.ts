import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { apiBaseUrl } from './api-config';

/* =====================================================================
 * Dashboard · Báo cáo · Thông báo Admin (AD02–AD07, AD09, AD60)
 * Khớp backend my-server/services/analytics/*
 * ===================================================================== */

export type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'custom';
export type GroupBy = 'day' | 'week' | 'month' | 'quarter' | 'year';

export type CompareMode = 'lastYear' | 'previous';

export interface RangeQuery {
  preset: RangePreset;
  /** Kỳ so sánh: cùng kỳ năm trước (mặc định) hoặc kỳ liền trước */
  compare?: CompareMode;
  from?: string; // yyyy-mm-dd (custom)
  to?: string;
}

export interface DateRangeDto {
  preset: string;
  from: string;
  to: string;
  label: string;
}

export interface KpiCard {
  key: string;
  code: string;
  label: string;
  unit: string;
  snapshot: boolean;
  formula: string;
  dateField: string;
  notes: string;
  value: number | null;
  previous: number | null;
  change: number | null;
  extra?: string;
}

export interface SeriesSet {
  labels: string[];
  revenue: number[];
  orders: number[];
  cash: number[];
}

export interface NeedActionItem {
  key: string;
  label: string;
  count: number;
  link: string;
  status: string | null;
}

export interface DeliveryItem {
  orderId: string;
  status: string;
  deliveryAt: string;
  slot: string;
  minutesLeft: number;
  urgency: 'overdue' | 'red' | 'orange' | 'green';
  recipient: string;
  address: string;
  total: number;
  items: { productId: string; name: string; quantity: number }[];
  link: string;
}

export interface AttentionOrder {
  orderId: string;
  status: string;
  createdAt: string | null;
  deliveryAt: string | null;
  total: number;
  paid: number;
  recipient: string;
  reasons: { code: string; label: string; detail: string }[];
  link: string;
}

export interface BestProduct {
  rank: number;
  productId: string;
  name: string;
  style: string;
  status: string;
  quantity: number;
  revenue: number;
  orders: number;
  share: number;
  image: string;
  link: string;
}

export interface MaterialAlert {
  materialId: string;
  name: string;
  unit: string;
  status: 'out' | 'low';
  label: string;
  available: number;
  threshold: number;
  maxLevel: number;
  suggestedOrder: number;
}

export interface DashboardOverview {
  range: DateRangeDto & { previous: DateRangeDto; compare: CompareMode };
  latestOrderAt: string | null;
  statusBreakdown: { status: string; count: number }[];
  generatedAt: string;
  kpis: KpiCard[];
  dataQuality: { estimatedCompletionDates: number };
  series: { bucket: GroupBy | 'hour'; labels: string[]; current: SeriesSet; previous: SeriesSet };
  needAction: NeedActionItem[];
  deliveries: DeliveryItem[];
  attentionOrders: AttentionOrder[];
  bestProducts: BestProduct[];
  inventory: {
    summary: { materialsOut: number; materialsLow: number; forecastShortages: number; ordersWithoutSchedule: number; productsOut: number; productsLow: number; qualityChecks: number };
    materials: MaterialAlert[];
  } | null;
  config: { deliveryRedMinutes: number; deliveryOrangeMinutes: number; deliveryWindowMinutes: number; pendingTooLongMinutes: number };
}

export interface ReportPeriodRow {
  key: string;
  label: string;
  newOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  refundRequests: number;
  netRevenue: number;
  cashCollected: number;
  cost: number;
  costCoveredRevenue: number;
  avgOrderValue: number | null;
  cancelRate: number | null;
  grossProfit: number | null;
}

export interface ReportProductRow {
  productId: string;
  name: string;
  style: string;
  quantity: number;
  orders: number;
  revenue: number;
  share: number | null;
  cost: number | null;
  grossProfit: number | null;
  margin: number | null;
  costMethod: string;
}

export interface ReportGroupRow {
  name: string;
  products: number;
  quantity: number;
  revenue: number;
  share: number | null;
  cost: number | null;
  grossProfit: number | null;
}

export interface AnalyticsReport {
  range: DateRangeDto & { previous: DateRangeDto; compare: CompareMode };
  groupBy: GroupBy;
  summary: { current: Record<string, number | null>; previous: Record<string, number | null> };
  periods: ReportPeriodRow[];
  byProduct: ReportProductRow[];
  byTopic: ReportGroupRow[];
  byStyle: ReportGroupRow[];
  byPaymentMethod: { method: string; transactions: number; amount: number }[];
  cancelReasons: { reason: string; count: number }[];
  profit: {
    goodsRevenue: number;
    costCoveredRevenue: number;
    cost: number;
    grossProfit: number;
    coverage: number | null;
    linesByMethod: { method: string; lines: number }[];
    note: string;
  };
  generatedAt: string;
}

export interface ReconcileIssue {
  code: string;
  group: 'Tiền' | 'Kho' | 'Dữ liệu';
  severity: 'Cao' | 'Trung bình' | 'Thấp';
  title: string;
  hint: string;
  count: number;
  rows: Record<string, any>[];
}

export interface Reconciliation {
  generatedAt: string;
  inventoryGoLive: string | null;
  totals: { issues: number; rows: number };
  issues: ReconcileIssue[];
}

export interface AdminNotification {
  id: string;
  type: string;
  group: string;
  priority: 'Cao' | 'Trung bình' | 'Thấp';
  title: string;
  message: string;
  link: string;
  queryParams: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  read: boolean;
}

export interface NotificationList {
  total: number;
  unread: number;
  unreadByGroup: Record<string, number>;
  groups: string[];
  items: AdminNotification[];
  canMarkRead: boolean;
}

export interface AnalyticsDictionary {
  kpis: Omit<KpiCard, 'value' | 'previous' | 'change'>[];
  attentionRules: Record<string, string>;
  notificationEvents: { type: string; group: string; priority: string; module: string; trigger: string; link: string; autoResolve: string }[];
  config: Record<string, number>;
}

/* ---------------- Bảng phân tích ---------------- */
export interface AnalysisKpi { key: string; label: string; unit: string; value: number | null; previous: number | null; change: number | null }
export interface GroupRow { name: string; revenue: number; quantity: number; orders: number; products: number; share: number | null; grossProfit: number | null; margin: number | null; previous?: number; change?: number | null }

export interface AnalysisPage {
  range: DateRangeDto & { previous: DateRangeDto; compare: CompareMode };
  groupBy: GroupBy | 'hour';
  generatedAt: string;
  latestOrderAt: string | null;
  revenue: {
    reportKey: string;
    kpis: AnalysisKpi[];
    series: { labels: string[]; prevLabels: string[]; netRevenue: number[]; netRevenuePrev: number[]; completedOrders: number[]; completedOrdersPrev: number[]; grossProfit: number[]; cashCollected: number[] };
    byWeekday: { label: string; revenue: number; orders: number }[];
    coverage: number | null;
  };
  occasions: {
    reportKey: string;
    byTopic: GroupRow[];
    byStyle: GroupRow[];
    topProducts: { productId: string; name: string; topic: string; style: string; quantity: number; revenue: number; grossProfit: number | null; margin: number | null; costMethod: string }[];
    matrix: { topics: string[]; styles: string[]; cells: number[][] };
  };
  customers: {
    reportKey: string;
    kpis: AnalysisKpi[];
    series: { labels: string[]; newBuyers: number[]; returningBuyers: number[] };
    revenueSplit: { label: string; value: number }[];
    topCustomers: { customerId: string; name: string; phone: string; orders: number; revenue: number; lastOrderAt: string | null; type: string }[];
    ratingDist: { stars: number; count: number }[];
  };
  costs: {
    reportKey: string;
    statement: { key: string; label: string; value: number; previous: number; change: number | null; kind: 'income' | 'cost' | 'result'; note?: string }[];
    breakdown: { label: string; value: number }[];
    ratios: AnalysisKpi[];
    series: { labels: string[]; revenue: number[]; cogs: number[]; loss: number[]; purchases: number[] };
    bySupplier: { name: string; value: number }[];
    lossByType: { name: string; value: number }[];
    coverage: number | null;
    note: string;
  };
  operations: {
    reportKey: string;
    kpis: AnalysisKpi[];
    sample: { explicitCompletions: number; totalCompletions: number };
    funnel: { label: string; count: number; rate: number | null }[];
    statusBreakdown: { status: string; count: number }[];
    deliveryByHour: { label: string; orders: number }[];
    cancelReasons: { reason: string; count: number }[];
    paymentMethods: { method: string; amount: number }[];
  };
}

/* ---------------- Danh sách báo cáo ---------------- */
export type ReportColType = 'text' | 'money' | 'number' | 'percent' | 'date' | 'datetime' | 'status';
export interface ReportMeta {
  key: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  popular?: boolean;
  snapshot?: boolean;
  filters: ('groupBy' | 'status')[];
}
export interface ReportCatalog { categories: string[]; reports: ReportMeta[] }
export interface ReportRun extends ReportMeta {
  range: DateRangeDto;
  groupBy: GroupBy;
  generatedAt: string;
  statusOptions: string[];
  columns: { key: string; label: string; type: ReportColType; sum?: boolean }[];
  rows: Record<string, any>[];
  totalRows: number;
  truncated: boolean;
  totals: Record<string, number>;
  chart: { type: 'line' | 'bar' | 'doughnut'; labels: string[]; series: { label: string; data: number[] }[]; money?: boolean } | null;
  note: string | null;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsApiService {
  constructor(private http: HttpClient) {}

  private get base(): string {
    return `${apiBaseUrl()}/admin`;
  }

  private rangeParams(q: RangeQuery, extra: Record<string, string | undefined> = {}): HttpParams {
    let p = new HttpParams().set('preset', q.preset).set('compare', q.compare || 'lastYear');
    if (q.preset === 'custom') {
      if (q.from) p = p.set('from', q.from);
      if (q.to) p = p.set('to', q.to);
    }
    Object.entries(extra).forEach(([k, v]) => {
      if (v !== undefined && v !== '') p = p.set(k, v);
    });
    return p;
  }

  private fail = (e: HttpErrorResponse) => {
    const msg =
      e.status === 0
        ? 'Không kết nối được backend. Kiểm tra server đang chạy (npm start trong my-server) hoặc bấm "Dùng backend local".'
        : e.status === 404
          ? 'Backend chưa có API Dashboard mới (404). Hãy chạy backend local bản mới nhất.'
          : e.status === 403
            ? 'Tài khoản không có quyền xem Tổng quan.'
            : e.error?.message || e.message;
    return throwError(() => new Error(msg));
  };

  /** fresh=true: bỏ qua cache server (nút Tải lại). */
  overview(q: RangeQuery, opts: { deliveryMode?: 'window' | 'today'; bestSort?: 'quantity' | 'revenue'; fresh?: boolean } = {}): Observable<DashboardOverview> {
    const { fresh, ...rest } = opts;
    return this.http
      .get<DashboardOverview>(`${this.base}/dashboard/overview`, { params: this.rangeParams(q, { ...rest, fresh: fresh ? '1' : undefined }) })
      .pipe(catchError(this.fail));
  }

  bestProducts(q: RangeQuery, sort: 'quantity' | 'revenue', limit = 5): Observable<{ items: BestProduct[] }> {
    return this.http
      .get<{ items: BestProduct[] }>(`${this.base}/dashboard/best-products`, { params: this.rangeParams(q, { sort, limit: String(limit) }) })
      .pipe(catchError(this.fail));
  }

  deliveries(mode: 'window' | 'today'): Observable<{ items: DeliveryItem[] }> {
    return this.http
      .get<{ items: DeliveryItem[] }>(`${this.base}/dashboard/deliveries`, { params: new HttpParams().set('mode', mode) })
      .pipe(catchError(this.fail));
  }

  /** Trang Bảng phân tích */
  analysis(q: RangeQuery, groupBy?: GroupBy, fresh = false): Observable<AnalysisPage> {
    return this.http
      .get<AnalysisPage>(`${this.base}/dashboard/analysis`, { params: this.rangeParams(q, { groupBy, fresh: fresh ? '1' : undefined }) })
      .pipe(catchError(this.fail));
  }

  /** Trang Danh sách báo cáo */
  reportCatalog(): Observable<ReportCatalog> {
    return this.http.get<ReportCatalog>(`${this.base}/reports/catalog`).pipe(catchError(this.fail));
  }

  runReport(key: string, q: RangeQuery, opts: { groupBy?: GroupBy; status?: string; fresh?: boolean } = {}): Observable<ReportRun> {
    return this.http
      .get<ReportRun>(`${this.base}/reports/run/${encodeURIComponent(key)}`, {
        params: this.rangeParams(q, { groupBy: opts.groupBy, status: opts.status || undefined, fresh: opts.fresh ? '1' : undefined }),
      })
      .pipe(catchError(this.fail));
  }

  dictionary(): Observable<AnalyticsDictionary> {
    return this.http.get<AnalyticsDictionary>(`${this.base}/dashboard/dictionary`).pipe(catchError(this.fail));
  }

  report(q: RangeQuery, groupBy: GroupBy, fresh = false): Observable<AnalyticsReport> {
    return this.http
      .get<AnalyticsReport>(`${this.base}/reports/analytics`, { params: this.rangeParams(q, { groupBy, fresh: fresh ? '1' : undefined }) })
      .pipe(catchError(this.fail));
  }

  reconciliation(fresh = false): Observable<Reconciliation> {
    const params = fresh ? new HttpParams().set('fresh', '1') : undefined;
    return this.http.get<Reconciliation>(`${this.base}/reports/reconciliation`, { params }).pipe(catchError(this.fail));
  }

  notifications(opts: { group?: string; unread?: boolean; limit?: number } = {}): Observable<NotificationList> {
    let p = new HttpParams().set('limit', String(opts.limit ?? 30));
    if (opts.group) p = p.set('group', opts.group);
    if (opts.unread) p = p.set('unread', 'true');
    return this.http.get<NotificationList>(`${this.base}/notifications`, { params: p }).pipe(catchError(this.fail));
  }

  markRead(id: string): Observable<{ marked: number }> {
    return this.http.post<{ marked: number }>(`${this.base}/notifications/${encodeURIComponent(id)}/read`, {}).pipe(catchError(this.fail));
  }

  markAllRead(group?: string): Observable<{ marked: number }> {
    return this.http.post<{ marked: number }>(`${this.base}/notifications/read-all`, group ? { group } : {}).pipe(catchError(this.fail));
  }

  syncNotifications(): Observable<unknown> {
    return this.http.post(`${this.base}/notifications/sync`, {}).pipe(catchError(this.fail));
  }
}
