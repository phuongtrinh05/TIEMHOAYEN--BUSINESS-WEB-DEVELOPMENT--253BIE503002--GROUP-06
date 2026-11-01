/** Định dạng số liệu dùng chung cho Tổng quan / Bảng phân tích / Danh sách báo cáo. */

const TZ = 'Asia/Ho_Chi_Minh';

export const money = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : new Intl.NumberFormat('vi-VN').format(Math.round(v)) + 'đ';

export const num = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(v);

export const compact = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ';
  if (a >= 1e6) return (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
  if (a >= 1e3) return (v / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'k';
  return String(Math.round(v));
};

export const percent = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%';

export const dateTime = (v: string | Date | null | undefined): string =>
  !v ? '—' : new Date(v).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });

export const dateOnly = (v: string | Date | null | undefined): string =>
  !v ? '—' : new Date(v).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });

export const time = (v: string | Date | null | undefined): string =>
  !v ? '—' : new Date(v).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

/** yyyy-mm-dd theo giờ VN, lệch offsetDays ngày so với hôm nay. */
export const isoDate = (offsetDays = 0, base = Date.now()): string =>
  new Date(base + 7 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

/** Giá trị KPI theo đơn vị. */
export const kpiValue = (value: number | null, unit: string): string => {
  if (value === null || value === undefined) return '—';
  if (unit === 'đ') return money(value);
  if (unit === '%') return percent(value);
  if (unit === '★') return value.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' ★';
  return num(value);
};

/** Chỉ số mà giảm là tốt (tỷ lệ hủy, chi phí…). */
const LOWER_IS_BETTER = ['cancelRate', 'refundRequestRate', 'refundRate', 'paymentFailRate', 'leadTime', 'cogsRatio', 'discountRatio', 'lossRatio', 'discount', 'cogs', 'loss'];

export const changeClass = (key: string, change: number | null): string => {
  if (change === null || change === 0) return 'flat';
  const good = LOWER_IS_BETTER.includes(key) ? change < 0 : change > 0;
  return good ? 'up' : 'down';
};

export const changeText = (change: number | null, unit = ''): string => {
  if (change === null || change === undefined) return '';
  return `${change > 0 ? '+' : ''}${change.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}${unit === '%' ? ' điểm' : '%'}`;
};

/** Bảng màu biểu đồ (theo nhận diện Tiệm Hoa Yên). */
export const PALETTE = ['#731919', '#C9A27A', '#2F7D6B', '#D96C5F', '#4B6A88', '#8E6BB3', '#E0A33A', '#7A8C3B', '#B85C8A', '#5D5350'];

export const slug = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^a-zA-Z0-9]+/g, '_');
