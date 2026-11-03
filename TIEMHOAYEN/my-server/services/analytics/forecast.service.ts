import { getCollection } from '../../mongo.js';
import { getActiveBomMap } from '../inventory/bom.service.js';
import { availableOf } from '../inventory/helpers.js';
import { CACHE_TTL, swr } from './cache.js';
import { ORDER_STATUS, ORDER_VOID_STATUSES } from './constants.js';
import { Dataset } from './dataset.js';
import { vnDate, vnParts, vnStartOfDay } from './period.js';

/**
 * DỰ BÁO cho trang Tổng quan (không phụ thuộc bộ lọc ngày — luôn tính từ "hôm nay"):
 *  1. Doanh thu tháng này: lũy kế thực tế + dự kiến đến cuối tháng (tốc độ TB 28 ngày gần nhất).
 *  2. Đơn cần giao 7 ngày tới: đơn đã nhận theo ngày giao + số đơn dự kiến thêm (TB cùng thứ 8 tuần trước).
 *  3. Nguyên vật liệu còn đủ dùng bao nhiêu ngày: tồn khả dụng ÷ mức dùng TB/ngày (theo BOM × đơn 28 ngày).
 * Đây là ước tính đơn giản (trung bình trượt), không phải mô hình thống kê.
 */

const DAY = 86_400_000;
const LOOKBACK_DAYS = 28;
const WEEKS_FOR_WEEKDAY_AVG = 8;
const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const round = (v: number, d = 0) => { const k = 10 ** d; return Math.round(v * k) / k; };
const isVoid = (status: string) => (ORDER_VOID_STATUSES as readonly string[]).includes(status);

export interface ForecastData {
  generatedAt: Date;
  revenue: {
    month: string; daysInMonth: number; today: number;
    labels: string[]; actual: (number | null)[]; projected: (number | null)[]; lastMonth: (number | null)[];
    monthToDate: number; projectedTotal: number; lastMonthTotal: number; dailyRate: number; changeVsLastMonth: number | null;
  };
  deliveries: { labels: string[]; dates: string[]; confirmed: number[]; expectedExtra: number[]; confirmedRevenue: number[]; totalConfirmed: number; totalExpected: number };
  materials: { materialId: string; name: string; unit: string; available: number; dailyUse: number; daysCover: number; need7: number; short7: boolean }[];
}

export const computeForecast = async (ds: Dataset, now = new Date()): Promise<ForecastData> => {
  const today = vnStartOfDay(now);
  const p = vnParts(now);

  /* ---------- 1. Doanh thu tháng này ---------- */
  const monthStart = vnDate(p.y, p.m, 1);
  const daysInMonth = new Date(Date.UTC(p.y, p.m + 1, 0)).getUTCDate();
  const lastMonthStart = vnDate(p.y, p.m - 1, 1);
  const daysInLastMonth = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
  const daily = new Map<number, number>(); // khóa = mốc nửa đêm VN
  ds.orders.forEach((o) => {
    if (o.status !== ORDER_STATUS.completed || !o.completedAt) return;
    const k = vnStartOfDay(o.completedAt).getTime();
    daily.set(k, (daily.get(k) || 0) + o.netRevenue);
  });
  const dayValue = (start: Date, i: number) => daily.get(start.getTime() + i * DAY) || 0;
  let acc = 0;
  const actual: (number | null)[] = [];
  for (let i = 0; i < daysInMonth; i++) {
    if (i < p.d) { acc += dayValue(monthStart, i); actual.push(acc); } else actual.push(null);
  }
  const monthToDate = acc;
  let lookback = 0;
  for (let i = 1; i <= LOOKBACK_DAYS; i++) lookback += daily.get(today.getTime() - i * DAY) || 0;
  const dailyRate = lookback / LOOKBACK_DAYS;
  const projected: (number | null)[] = actual.map((_, i) => (i < p.d - 1 ? null : monthToDate + dailyRate * (i - (p.d - 1))));
  const projectedTotal = Math.round(projected[daysInMonth - 1] ?? monthToDate);
  let lacc = 0;
  const lastMonth: (number | null)[] = [];
  for (let i = 0; i < daysInMonth; i++) {
    if (i < daysInLastMonth) { lacc += dayValue(lastMonthStart, i); lastMonth.push(lacc); } else lastMonth.push(null);
  }
  const lastMonthTotal = lacc;

  /* ---------- 2. Đơn cần giao 7 ngày tới ---------- */
  const deliveryDay = new Map<number, { count: number; revenue: number }>();
  ds.orders.forEach((o) => {
    if (!o.deliveryStart || isVoid(o.status)) return;
    const k = vnStartOfDay(o.deliveryStart).getTime();
    const cur = deliveryDay.get(k) || { count: 0, revenue: 0 };
    cur.count += 1; cur.revenue += o.total;
    deliveryDay.set(k, cur);
  });
  const labels: string[] = [], dates: string[] = [], confirmed: number[] = [], expectedExtra: number[] = [], confirmedRevenue: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() + i * DAY);
    const dp = vnParts(d);
    let hist = 0;
    for (let w = 1; w <= WEEKS_FOR_WEEKDAY_AVG; w++) hist += deliveryDay.get(d.getTime() - w * 7 * DAY)?.count || 0;
    const expected = hist / WEEKS_FOR_WEEKDAY_AVG;
    const got = deliveryDay.get(d.getTime()) || { count: 0, revenue: 0 };
    labels.push(i === 0 ? 'Hôm nay' : `${WEEKDAY[dp.dow]} ${String(dp.d).padStart(2, '0')}/${String(dp.m + 1).padStart(2, '0')}`);
    dates.push(`${dp.y}-${String(dp.m + 1).padStart(2, '0')}-${String(dp.d).padStart(2, '0')}`);
    confirmed.push(got.count);
    confirmedRevenue.push(got.revenue);
    expectedExtra.push(Math.max(0, Math.round(expected - got.count)));
  }

  /* ---------- 3. NVL còn đủ dùng bao nhiêu ngày ---------- */
  const [bomMap, materialRows] = await Promise.all([
    getActiveBomMap().catch(() => new Map()),
    getCollection<any>('NGUYEN_VAT_LIEU').then((c) => c.find({}).project({ NGUYEN_VAT_LIEU_ID: 1, TEN_NGUYEN_VAT_LIEU: 1, DON_VI_TINH: 1, TON_THUC: 1, TON_DANG_GIU: 1, TON_KHONG_DAT: 1, TRANG_THAI: 1, DA_XOA: 1 }).toArray()).catch(() => [] as any[]),
  ]);
  const use28 = new Map<string, number>();
  const need7 = new Map<string, number>();
  const addNeed = (target: Map<string, number>, orderId: string) => {
    (ds.detailsByOrder.get(orderId) || []).forEach((d) => {
      (bomMap.get(d.productId) || []).forEach((l: any) => {
        const q = Number(l.DINH_LUONG || 0) * d.quantity;
        if (q > 0) target.set(String(l.NGUYEN_VAT_LIEU_ID), (target.get(String(l.NGUYEN_VAT_LIEU_ID)) || 0) + q);
      });
    });
  };
  const from28 = today.getTime() - LOOKBACK_DAYS * DAY;
  const to7 = today.getTime() + 7 * DAY;
  ds.orders.forEach((o) => {
    if (isVoid(o.status)) return;
    if (o.createdAt && o.createdAt.getTime() >= from28 && o.createdAt.getTime() < today.getTime()) addNeed(use28, o.id);
    if (o.deliveryStart && !o.materialIssued && o.deliveryStart.getTime() >= today.getTime() && o.deliveryStart.getTime() < to7) addNeed(need7, o.id);
  });
  const materials = materialRows
    .filter((m: any) => !m.DA_XOA && !/ẩn|ngừng/i.test(String(m.TRANG_THAI || '')))
    .map((m: any) => {
      const id = String(m.NGUYEN_VAT_LIEU_ID);
      const dailyUse = (use28.get(id) || 0) / LOOKBACK_DAYS;
      const available = availableOf(m);
      return {
        materialId: id, name: String(m.TEN_NGUYEN_VAT_LIEU || id), unit: String(m.DON_VI_TINH || ''), available: round(available, 2),
        dailyUse: round(dailyUse, 2), daysCover: dailyUse > 0 ? round(available / dailyUse, 1) : Infinity,
        need7: round(need7.get(id) || 0, 2), short7: (need7.get(id) || 0) > available,
      };
    })
    .filter((m) => Number.isFinite(m.daysCover))
    .sort((a, b) => a.daysCover - b.daysCover)
    .slice(0, 8);

  return {
    generatedAt: new Date(),
    revenue: {
      month: `${String(p.m + 1).padStart(2, '0')}/${p.y}`, daysInMonth, today: p.d,
      labels: Array.from({ length: daysInMonth }, (_, i) => String(i + 1)),
      actual: actual.map((v) => (v === null ? null : Math.round(v))), projected: projected.map((v) => (v === null ? null : Math.round(v))), lastMonth,
      monthToDate: Math.round(monthToDate), projectedTotal, lastMonthTotal: Math.round(lastMonthTotal), dailyRate: Math.round(dailyRate),
      changeVsLastMonth: lastMonthTotal > 0 ? round(((projectedTotal - lastMonthTotal) / lastMonthTotal) * 100, 1) : null,
    },
    deliveries: { labels, dates, confirmed, expectedExtra, confirmedRevenue, totalConfirmed: confirmed.reduce((s, x) => s + x, 0), totalExpected: confirmed.reduce((s, x) => s + x, 0) + expectedExtra.reduce((s, x) => s + x, 0) },
    materials,
  };
};

/** Có cache (dự báo không cần cập nhật từng giây). */
export const getForecast = (ds: Dataset, opts: { fresh?: boolean } = {}) =>
  swr('forecast', { ttlMs: CACHE_TTL.heavyMs, maxStaleMs: CACHE_TTL.heavyMaxStaleMs, ...opts }, () => computeForecast(ds));
