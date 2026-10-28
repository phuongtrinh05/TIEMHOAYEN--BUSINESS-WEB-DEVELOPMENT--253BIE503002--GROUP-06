import type { ClientSession, Collection, Document } from 'mongodb';
import { getCollection, getMongoClient } from '../../mongo.js';
import { COLLECTIONS, INVENTORY_CONFIG, UNIT_ALIASES } from './constants.js';

/** Lỗi nghiệp vụ có mã HTTP để controller trả đúng status. */
export class InventoryError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const factor = 10 ** INVENTORY_CONFIG.quantityDecimals;

export const roundQty = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * factor) / factor;
};

/** Làm tròn lên theo đơn vị nhỏ nhất (D02.3). */
export const ceilQty = (value: number): number => Math.ceil(value * factor - 1e-6) / factor;

export const money = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

export const toPositiveQty = (value: unknown, field: string): number => {
  const n = roundQty(value);
  if (!(n > 0)) throw new InventoryError(400, `${field} phải lớn hơn 0.`);
  return n;
};

export const toNonNegativeQty = (value: unknown, field: string): number => {
  const n = roundQty(value ?? 0);
  if (n < 0) throw new InventoryError(400, `${field} không được âm.`);
  return n;
};

export const parseDate = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Ngày theo giờ Việt Nam dạng YYYY-MM-DD */
export const vnDateKey = (date: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: INVENTORY_CONFIG.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export const vnTimeKey = (date: Date): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: INVENTORY_CONFIG.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);

export const isSameVnDay = (a: Date, b: Date): boolean => vnDateKey(a) === vnDateKey(b);

export const normalizeUnit = (unit: unknown): string => String(unit ?? '').trim().toLowerCase();

export const unitsCompatible = (a: unknown, b: unknown): boolean => {
  const x = normalizeUnit(a);
  const y = normalizeUnit(b);
  if (!x || !y || x === y) return true;
  return UNIT_ALIASES.some((group) => group.includes(x) && group.includes(y));
};

export const normalizeText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();

export const col = <T extends Document = any>(name: string): Promise<Collection<T>> => getCollection<T>(name);

/**
 * Sinh mã tăng dần an toàn khi nhiều request cùng lúc (dùng bộ đếm $inc).
 * Lần đầu khởi tạo bộ đếm từ mã lớn nhất đang có trong collection.
 */
export const nextCode = async (collectionName: string, idField: string, prefix: string, width: number): Promise<string> => {
  const counters = await col(COLLECTIONS.counter);
  const key = `${collectionName}:${prefix}`;
  const existing = await counters.findOne({ _id: key as any });
  if (!existing) {
    const rows = await (await col(collectionName))
      .find({ [idField]: { $regex: `^${prefix}\\d+$` } })
      .project({ [idField]: 1 })
      .toArray();
    const max = rows.reduce((m: number, row: any) => {
      const n = Number(String(row[idField]).slice(prefix.length));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    await counters.updateOne({ _id: key as any }, { $setOnInsert: { value: max } }, { upsert: true });
  }
  const updated = await counters.findOneAndUpdate({ _id: key as any }, { $inc: { value: 1 } }, { returnDocument: 'after' });
  return `${prefix}${String((updated as any).value).padStart(width, '0')}`;
};

/**
 * Chạy một nghiệp vụ trong transaction. Mongo tự retry khi 2 request ghi trùng một document
 * (write conflict) → đảm bảo không giữ/xuất vượt tồn khi đồng thời.
 */
export const withTransaction = async <T>(work: (session: ClientSession) => Promise<T>): Promise<T> => {
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await work(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result as T;
  } finally {
    await session.endSession();
  }
};

export interface Actor {
  id: string | null;
  role: string | null;
}

export const actorFromRequest = (req: { headers: Record<string, any> }): Actor => {
  const pick = (v: any) => (Array.isArray(v) ? v[0] : v) || null;
  return { id: pick(req.headers['x-admin-id']), role: pick(req.headers['x-admin-role']) };
};

export const availableOf = (m: any): number =>
  Math.max(0, roundQty(Number(m?.TON_THUC || 0) - Number(m?.TON_DANG_GIU || 0) - Number(m?.TON_KHONG_DAT || 0)));

export const finishedAvailableOf = (p: any): number =>
  Math.max(0, roundQty(Number(p?.TON_THANH_PHAM || 0) - Number(p?.TP_DANG_GIU || 0)));
