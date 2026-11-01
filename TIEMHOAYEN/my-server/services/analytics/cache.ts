/**
 * Cache trong bộ nhớ cho Dashboard / Báo cáo / Thông báo.
 *
 * Mục tiêu: mỗi lần mở trang Tổng quan không phải quét lại toàn bộ DON_HANG / THANH_TOAN / kho trên Atlas.
 *  - Gộp request trùng: nhiều API gọi cùng lúc chỉ tạo 1 lần đọc DB (chung 1 Promise).
 *  - Stale-while-revalidate: trong `ttlMs` trả bản đang có; quá ttl nhưng chưa quá `maxStaleMs`
 *    thì trả bản cũ ngay + làm mới ngầm; quá `maxStaleMs` (hoặc fresh=true) thì chờ đọc lại.
 *  - Ghi dữ liệu quan trọng (đổi trạng thái đơn, đánh giá…) gọi invalidateAnalyticsCache() để lần xem sau là số mới.
 */

interface Entry<T> {
  at: number;
  value?: T;
  hasValue: boolean;
  promise?: Promise<T>;
}

export interface SwrOptions {
  ttlMs: number;
  maxStaleMs?: number;
  /** Bỏ qua cache (nút "Tải lại"); vẫn gộp với lần đọc đang chạy. */
  fresh?: boolean;
  /** false = không chấp nhận bản quá ttl (dùng cho bộ quét thông báo). */
  allowStale?: boolean;
}

const store = new Map<string, Entry<any>>();
let generation = 0;

const refresh = <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const current = store.get(key);
  if (current?.promise) return current.promise;
  const gen = generation;
  const promise: Promise<T> = load().then(
    (value) => {
      const mine = store.get(key)?.promise === promise;
      // Bị invalidate trong lúc đang đọc → không ghi dữ liệu cũ vào cache
      if (mine && gen === generation) store.set(key, { at: Date.now(), value, hasValue: true });
      else if (mine) store.delete(key);
      return value;
    },
    (error) => {
      const e = store.get(key);
      if (e && e.promise === promise) {
        delete e.promise;
        if (!e.hasValue) store.delete(key);
      }
      throw error;
    },
  );
  store.set(key, { ...(current || { at: 0, hasValue: false }), promise });
  return promise;
};

export const swr = async <T>(key: string, opts: SwrOptions, load: () => Promise<T>): Promise<T> => {
  const e = store.get(key) as Entry<T> | undefined;
  const age = e?.hasValue ? Date.now() - e.at : Infinity;
  if (!opts.fresh && e?.hasValue) {
    if (age < opts.ttlMs) return e.value as T;
    if (opts.allowStale !== false && age < (opts.maxStaleMs ?? opts.ttlMs)) {
      refresh(key, load).catch((err) => console.error(`[analytics-cache] làm mới ${key} lỗi`, err?.message || err));
      return e.value as T;
    }
  }
  return refresh(key, load);
};

/** Xóa cache (toàn bộ hoặc các khóa chỉ định). Gọi sau khi ghi dữ liệu đơn / tiền / kho. */
export const invalidateAnalyticsCache = (...keys: string[]) => {
  generation++; // lần đọc đang chạy (nếu có) sẽ không được ghi vào cache
  if (!keys.length) store.clear();
  else keys.forEach((k) => store.delete(k));
};

export const cacheAge = (key: string): number | null => {
  const e = store.get(key);
  return e?.hasValue ? Date.now() - e.at : null;
};

const envMs = (key: string, fallbackSeconds: number) => {
  const v = Number(process.env[key]);
  return (Number.isFinite(v) && v >= 0 ? v : fallbackSeconds) * 1000;
};

/** Thời gian cache — chỉnh qua biến môi trường nếu cần. */
export const CACHE_TTL = {
  datasetMs: envMs('DASHBOARD_CACHE_SECONDS', 30),
  datasetMaxStaleMs: envMs('DASHBOARD_CACHE_MAX_STALE_SECONDS', 300),
  heavyMs: envMs('DASHBOARD_HEAVY_CACHE_SECONDS', 60), // giá vốn, đối chiếu, cảnh báo kho
  heavyMaxStaleMs: envMs('DASHBOARD_HEAVY_MAX_STALE_SECONDS', 600),
};
