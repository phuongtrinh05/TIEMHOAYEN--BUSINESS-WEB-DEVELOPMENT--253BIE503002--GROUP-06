import { ANALYTICS_CONFIG } from './constants.js';

/** Bộ lọc thời gian chung (AD02) — tính theo giờ Việt Nam, kỳ so sánh = kỳ liền trước cùng độ dài. */

const OFFSET = ANALYTICS_CONFIG.timezoneOffsetMinutes * 60_000;
const DAY = 86_400_000;

export type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'custom';
export type Bucket = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface DateRange {
  preset: Preset;
  from: Date; // bao gồm
  to: Date; // không bao gồm
  label: string;
}

/** Nửa đêm VN của ngày chứa d (trả về instant UTC). */
export const vnStartOfDay = (d: Date): Date => new Date(Math.floor((d.getTime() + OFFSET) / DAY) * DAY - OFFSET);

/** Các thành phần ngày theo giờ VN. */
export const vnParts = (d: Date) => {
  const x = new Date(d.getTime() + OFFSET);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), h: x.getUTCHours(), min: x.getUTCMinutes(), dow: x.getUTCDay() };
};

/** Tạo instant từ ngày/giờ VN. */
export const vnDate = (y: number, m: number, d = 1, h = 0, min = 0): Date => new Date(Date.UTC(y, m, d, h, min) - OFFSET);

const fmt = (d: Date) => {
  const p = vnParts(d);
  return `${String(p.d).padStart(2, '0')}/${String(p.m + 1).padStart(2, '0')}/${p.y}`;
};

const parseDay = (value: unknown): Date | null => {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return vnDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

export const resolveRange = (query: { preset?: unknown; from?: unknown; to?: unknown }, now = new Date()): DateRange => {
  const preset = (String(query.preset || '7d') as Preset);
  const today = vnStartOfDay(now);
  const p = vnParts(now);
  let from: Date;
  let to: Date;
  switch (preset) {
    case 'today': from = today; to = new Date(today.getTime() + DAY); break;
    case 'yesterday': from = new Date(today.getTime() - DAY); to = today; break;
    case '30d': from = new Date(today.getTime() - 29 * DAY); to = new Date(today.getTime() + DAY); break;
    case 'thisMonth': from = vnDate(p.y, p.m, 1); to = vnDate(p.y, p.m + 1, 1); break;
    case 'lastMonth': from = vnDate(p.y, p.m - 1, 1); to = vnDate(p.y, p.m, 1); break;
    case 'thisQuarter': { const q = Math.floor(p.m / 3) * 3; from = vnDate(p.y, q, 1); to = vnDate(p.y, q + 3, 1); break; }
    case 'thisYear': from = vnDate(p.y, 0, 1); to = vnDate(p.y + 1, 0, 1); break;
    case 'custom': {
      const f = parseDay(query.from);
      const t = parseDay(query.to);
      if (!f || !t || t < f) throw Object.assign(new Error('Khoảng ngày tùy chọn không hợp lệ (YYYY-MM-DD).'), { status: 400 });
      if (t.getTime() - f.getTime() > 366 * 2 * DAY) throw Object.assign(new Error('Khoảng ngày tối đa 2 năm.'), { status: 400 });
      from = f; to = new Date(t.getTime() + DAY); break;
    }
    case '7d':
    default: from = new Date(today.getTime() - 6 * DAY); to = new Date(today.getTime() + DAY);
  }
  const label = to.getTime() - from.getTime() === DAY ? fmt(from) : `${fmt(from)} – ${fmt(new Date(to.getTime() - 1))}`;
  return { preset: (['today', 'yesterday', '7d', '30d', 'thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'custom'].includes(preset) ? preset : '7d') as Preset, from, to, label };
};

/** Kỳ liền trước cùng độ dài (với tháng/quý/năm: cùng số ngày, liền kề). */
export const previousRange = (r: DateRange): DateRange => {
  const len = r.to.getTime() - r.from.getTime();
  const from = new Date(r.from.getTime() - len);
  const to = r.from;
  const label = len === DAY ? fmt(from) : `${fmt(from)} – ${fmt(new Date(to.getTime() - 1))}`;
  return { preset: 'custom', from, to, label };
};

export type CompareMode = 'lastYear' | 'previous';
export const parseCompare = (v: unknown): CompareMode => (v === 'lastYear' ? 'lastYear' : 'previous');

/** Lùi 1 năm theo lịch VN, giữ ngày/giờ (29/02 → 28/02). */
const minusOneYear = (d: Date): Date => {
  const p = vnParts(d);
  const y = p.y - 1;
  const last = new Date(Date.UTC(y, p.m + 1, 0)).getUTCDate();
  return vnDate(y, p.m, Math.min(p.d, last), p.h, p.min);
};

/** Cùng kỳ năm trước: cùng ngày/tháng, năm − 1 (vd 25/10/2026–31/10/2026 → 25/10/2025–31/10/2025). */
export const sameRangeLastYear = (r: DateRange): DateRange => {
  const from = minusOneYear(r.from);
  const to = minusOneYear(r.to);
  const label = to.getTime() - from.getTime() === DAY ? fmt(from) : `${fmt(from)} – ${fmt(new Date(to.getTime() - 1))}`;
  return { preset: 'custom', from, to, label };
};

/** Kỳ so sánh theo lựa chọn: mặc định kỳ liền trước. */
export const compareRange = (r: DateRange, mode: CompareMode = 'previous'): DateRange => (mode === 'previous' ? previousRange(r) : sameRangeLastYear(r));

export const inRange = (d: Date | null | undefined, r: { from: Date; to: Date }) =>
  !!d && d.getTime() >= r.from.getTime() && d.getTime() < r.to.getTime();

export const autoBucket = (r: DateRange): Bucket => {
  const days = (r.to.getTime() - r.from.getTime()) / DAY;
  if (days <= 1) return 'hour';
  if (days <= 62) return 'day';
  if (days <= 400) return 'month';
  return 'year';
};

/** Khóa nhóm + nhãn hiển thị cho một thời điểm theo bucket. */
export const bucketKey = (d: Date, bucket: Bucket): { key: string; label: string } => {
  const p = vnParts(d);
  const dd = String(p.d).padStart(2, '0');
  const mm = String(p.m + 1).padStart(2, '0');
  switch (bucket) {
    case 'hour': return { key: `${p.y}-${mm}-${dd}T${String(p.h).padStart(2, '0')}`, label: `${String(p.h).padStart(2, '0')}:00` };
    case 'day': return { key: `${p.y}-${mm}-${dd}`, label: `${dd}/${mm}` };
    case 'week': {
      // tuần bắt đầu thứ Hai
      const start = new Date(vnStartOfDay(d).getTime() - ((p.dow + 6) % 7) * DAY);
      const s = vnParts(start);
      return { key: `W${s.y}-${String(s.m + 1).padStart(2, '0')}-${String(s.d).padStart(2, '0')}`, label: `Tuần ${String(s.d).padStart(2, '0')}/${String(s.m + 1).padStart(2, '0')}` };
    }
    case 'month': return { key: `${p.y}-${mm}`, label: `${mm}/${p.y}` };
    case 'quarter': { const q = Math.floor(p.m / 3) + 1; return { key: `${p.y}-Q${q}`, label: `Q${q}/${p.y}` }; }
    case 'year': default: return { key: `${p.y}`, label: `${p.y}` };
  }
};

/** Danh sách bucket liên tục trong kỳ (để biểu đồ không bị "lủng" ngày không có đơn). */
export const enumerateBuckets = (r: { from: Date; to: Date }, bucket: Bucket) => {
  const out: { key: string; label: string; start: Date }[] = [];
  const seen = new Set<string>();
  const step = bucket === 'hour' ? 3_600_000 : DAY;
  for (let t = r.from.getTime(); t < r.to.getTime(); t += step) {
    const b = bucketKey(new Date(t), bucket);
    if (!seen.has(b.key)) { seen.add(b.key); out.push({ ...b, start: new Date(t) }); }
    if (out.length > 800) break;
  }
  return out;
};

export const pctChange = (current: number, previous: number): number | null =>
  previous === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;

/** Giờ giao mong muốn: NGAY_MUON_GIAO (ngày) + KHUNG_GIO_MUON_GIAO ("07:00", "05:00 PM–07:00 PM", "23:14"). */
export const parseDeliveryWindow = (dateValue: unknown, slot: unknown): { start: Date; end: Date } | null => {
  if (!dateValue) return null;
  const raw = dateValue instanceof Date ? dateValue : new Date(String(dateValue));
  if (Number.isNaN(raw.getTime())) return null;
  // Ngày giao được lưu dạng nửa đêm UTC của ngày VN → lấy Y-M-D theo UTC
  const y = raw.getUTCFullYear();
  const m = raw.getUTCMonth();
  const d = raw.getUTCDate();
  const times = [...String(slot || '').matchAll(/(\d{1,2}):(\d{2})\s*(AM|PM|SA|CH)?/gi)].map((x) => {
    let h = Number(x[1]);
    const ap = (x[3] || '').toUpperCase();
    if ((ap === 'PM' || ap === 'CH') && h < 12) h += 12;
    if ((ap === 'AM' || ap === 'SA') && h === 12) h = 0;
    return { h, min: Number(x[2]) };
  });
  if (!times.length) {
    return { start: vnDate(y, m, d, 8, 0), end: vnDate(y, m, d, 21, 0) }; // không có giờ → cả ngày làm việc
  }
  const start = vnDate(y, m, d, times[0].h, times[0].min);
  const last = times[times.length - 1];
  const end = times.length > 1 ? vnDate(y, m, d, last.h, last.min) : new Date(start.getTime() + 60 * 60_000);
  return { start, end };
};
