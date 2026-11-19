import type { NextFunction, Request, Response } from 'express';
import { getCollection } from '../mongo.js';
import { getActiveBomMap, type BomLine } from './inventory/bom.service.js';

/**
 * Bộ nhớ tạm cho dữ liệu đọc nhiều nhưng ít đổi (công thức BOM, ảnh đại diện, chủ đề, liên kết hoa/màu/đối tượng).
 * MongoDB Atlas ở xa nên mỗi truy vấn tốn vài trăm ms; trước đây mọi lượt tải trang đều đọc lại toàn bộ.
 *
 * KHÔNG lưu giá, trạng thái bán hay tồn kho nguyên vật liệu — các trường đó vẫn đọc mới mỗi request.
 * Mọi request ghi (POST/PUT/PATCH/DELETE) xử lý xong sẽ xóa toàn bộ bộ nhớ tạm, nên Admin sửa xong là thấy ngay.
 * Script chạy ngoài server (seed, migrate) sửa DB trực tiếp: tối đa READ_CACHE_TTL_MS (mặc định 60 giây) mới thấy.
 * Đặt READ_CACHE_TTL_MS=0 để tắt hẳn.
 */
const ttlMs = () => {
  const raw = Number(process.env.READ_CACHE_TTL_MS ?? 60_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
};

type Entry = { expiresAt: number; value: Promise<unknown> };
const store = new Map<string, Entry>();
let generation = 0;

export const cachedRead = <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const ttl = ttlMs();
  if (!ttl) return load();
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as Promise<T>;

  const startedAt = generation;
  const value = load();
  const entry: Entry = { expiresAt: now + ttl, value };
  store.set(key, entry);
  value.then(
    // Có lượt ghi xảy ra trong lúc đang đọc → kết quả có thể đã cũ, không giữ lại.
    () => { if (startedAt !== generation && store.get(key) === entry) store.delete(key); },
    () => { if (store.get(key) === entry) store.delete(key); },
  );
  return value;
};

export const clearReadCache = () => {
  generation += 1;
  store.clear();
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Xóa bộ nhớ tạm sau mỗi request ghi (kể cả khi lỗi giữa chừng) để không bao giờ hiển thị dữ liệu cũ. */
export const invalidateReadCacheOnWrite = (req: Request, res: Response, next: NextFunction) => {
  if (WRITE_METHODS.has(req.method)) {
    let done = false;
    const clear = () => { if (!done) { done = true; clearReadCache(); } };
    res.on('finish', clear);
    res.on('close', clear);
  }
  next();
};

/* ----------------------------- Dữ liệu dùng chung ----------------------------- */

export type PrimaryImage = { SAN_PHAM_ID: string; URL: string | null; HINH_ANH_ID?: string; LA_ANH_CHINH?: boolean };

const sortPrimaryImages = (left: any, right: any): number => {
  if (Boolean(left.LA_ANH_CHINH) !== Boolean(right.LA_ANH_CHINH)) return Boolean(left.LA_ANH_CHINH) ? -1 : 1;
  return String(left.HINH_ANH_ID || '').localeCompare(String(right.HINH_ANH_ID || ''), 'vi');
};

const allPrimaryImages = () => cachedRead('images:primary', async () => {
  const images = await (await getCollection<any>('HINH_ANH_SAN_PHAM')).find({}, {
    projection: { _id: 0, SAN_PHAM_ID: 1, LA_ANH_CHINH: 1, HINH_ANH_ID: 1, URL: 1 },
  }).toArray();
  const map = new Map<string, PrimaryImage>();
  for (const image of images.sort(sortPrimaryImages)) {
    const id = String(image.SAN_PHAM_ID || '');
    if (id && !map.has(id)) map.set(id, image as PrimaryImage);
  }
  return map;
});

/** Ảnh đại diện (ưu tiên LA_ANH_CHINH, sau đó HINH_ANH_ID nhỏ nhất) theo mã sản phẩm. */
export const getPrimaryImages = async (productIds: string[]): Promise<Map<string, PrimaryImage>> => {
  if (!productIds.length) return new Map();
  const all = await allPrimaryImages();
  const result = new Map<string, PrimaryImage>();
  for (const id of productIds) {
    const image = all.get(String(id));
    if (image) result.set(String(id), image);
  }
  return result;
};

/**
 * Công thức BOM đang áp dụng (kèm công thức cũ) — đọc một lần cho toàn bộ sản phẩm rồi lọc.
 * Không truyền productIds → trả về map của mọi sản phẩm (chỉ đọc, không sửa trực tiếp).
 */
export const getCachedActiveBomMap = async (productIds?: string[]): Promise<Map<string, BomLine[]>> => {
  const all = await cachedRead('bom:active', () => getActiveBomMap());
  if (!productIds) return all;
  const result = new Map<string, BomLine[]>();
  for (const id of productIds) {
    const lines = all.get(String(id));
    if (lines) result.set(String(id), lines);
  }
  return result;
};

/** Đọc toàn bộ một bảng nhỏ (chủ đề, hoa, màu...) theo bộ lọc cố định. */
export const getCachedRows = <T = any>(collectionName: string, filter: Record<string, unknown> = {}) =>
  cachedRead<T[]>(`rows:${collectionName}:${JSON.stringify(filter)}`, async () =>
    (await getCollection<any>(collectionName)).find(filter).toArray() as Promise<T[]>);
