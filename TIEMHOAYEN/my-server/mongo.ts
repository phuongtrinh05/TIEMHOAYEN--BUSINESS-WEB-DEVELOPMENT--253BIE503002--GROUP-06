import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

loadEnvFile(path.resolve(process.cwd(), '.env'));

const mongoUri = process.env.MONGO_URI;
const mongoDatabase = process.env.MONGO_DATABASE;

if (!mongoUri) {
  throw new Error('Missing MONGO_URI. Set it in your deployment environment or local .env file.');
}

if (!mongoDatabase) {
  throw new Error('Missing MONGO_DATABASE. Set it in your deployment environment or local .env file.');
}

let client: MongoClient | null = null;
let database: Db | null = null;
let connecting: Promise<Db> | null = null;

/**
 * Tùy chọn kết nối giúp đọc nhanh hơn khi DB ở xa (Atlas):
 * - compressors zlib: nén dữ liệu trả về (có sẵn trong Node, không cần cài thêm) — tắt bằng MONGO_COMPRESSORS=none
 * - minPoolSize: giữ sẵn vài kết nối TLS, khỏi bắt tay lại cho mỗi truy vấn song song
 */
const clientOptions = () => {
  const compressors = (process.env.MONGO_COMPRESSORS || 'zlib').split(',').map((x) => x.trim()).filter((x) => x && x !== 'none');
  return {
    ...(compressors.length ? { compressors: compressors as ('zlib' | 'zstd' | 'snappy' | 'none')[] } : {}),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 3),
    maxIdleTimeMS: 10 * 60_000,
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 8_000),
    connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 8_000),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 15_000),
  };
};

export const connectMongo = async (): Promise<Db> => {
  if (database) {
    return database;
  }
  // Nhiều request đến cùng lúc lúc khởi động → chỉ tạo 1 kết nối (trước đây mỗi request tạo 1 MongoClient)
  if (connecting) return connecting;
  connecting = (async () => {
    const c = new MongoClient(mongoUri, clientOptions());
    try { await c.connect(); }
    catch (error) { await c.close().catch(() => {}); throw error; }
    client = c;
    database = c.db(mongoDatabase);
    console.log(`Đã kết nối thành công tới MongoDB database ${mongoDatabase}!`);
    return database;
  })().finally(() => { connecting = null; });
  return connecting;
};

export const getDb = async (): Promise<Db> => {
  return connectMongo();
};

/** Dùng cho các nghiệp vụ kho cần transaction (MongoDB Atlas là replica set nên hỗ trợ). */
export const getMongoClient = async (): Promise<MongoClient> => {
  await connectMongo();
  return client as MongoClient;
};

/**
 * Đổi tên trường theo từ điển dữ liệu. Lệnh ghi luôn lưu cả tên cũ và tên chuẩn để có thể quay lại bản trước.
 * - Bảng trong READ_STANDARD_TABLES: truy vấn dùng tên chuẩn, kết quả đổi lại tên cũ.
 * - Bảng còn lại đang ghi song song: truy vấn dùng tên cũ, kết quả bỏ tên chuẩn để không lộ thêm trường qua API.
 */
const LUCKY_FIELD_ALIASES: Record<string, string> = {
  name: 'TEN', terms: 'DIEU_KHOAN', status: 'TRANG_THAI', startAt: 'NGAY_BAT_DAU', endAt: 'NGAY_KET_THUC', prizes: 'DS_PHAN_THUONG',
  threshold: 'NGUONG', minimumOrder: 'DON_TOI_THIEU', spinDays: 'SO_NGAY_QUAY', rewardDays: 'SO_NGAY_THUONG', reminderDays: 'SO_NGAY_NHAC',
  version: 'PHIEN_BAN', pauses: 'LAN_TAM_DUNG', createdAt: 'NGAY_TAO', updatedAt: 'NGAY_CAP_NHAT', updatedBy: 'NGUOI_CAP_NHAT', endedAt: 'NGAY_DA_KET_THUC',
  at: 'THOI_DIEM', token: 'TOKEN', revision: 'SO_PHIEN_BAN', count: 'SO_LUONG', prizeId: 'PHAN_THUONG_ID', programId: 'CHUONG_TRINH_ID',
  spinId: 'LUOT_QUAY_ID', orderId: 'DON_HANG_ID', customerId: 'KHACH_HANG_ID', programVersion: 'PHIEN_BAN_CHUONG_TRINH', prize: 'PHAN_THUONG',
  weights: 'TRONG_SO', rewardId: 'PHAN_THUONG_ID', grantedAt: 'NGAY_CAP', baseExpiresAt: 'HET_HAN_GOC', qualifyingValue: 'GIA_TRI_DU_DIEU_KIEN',
  rules: 'QUY_TAC', resultId: 'KET_QUA_ID', spunAt: 'NGAY_QUAY', reason: 'LY_DO', actor: 'NGUOI_THUC_HIEN', action: 'HANH_DONG', snapshot: 'BAN_CHUP',
  result: 'KET_QUA', activatedAt: 'NGAY_KICH_HOAT', expiresAt: 'HET_HAN', discount: 'GIAM_GIA', code: 'MA', sourceOrderId: 'DON_HANG_NGUON_ID',
  issuedAt: 'NGAY_PHAT_HANH', heldAt: 'NGAY_GIU', heldUntil: 'GIU_DEN', usedOrderId: 'DON_HANG_DA_DUNG_ID', usedAt: 'NGAY_SU_DUNG', revokedAt: 'NGAY_THU_HOI',
  read: 'DA_DOC', text: 'NOI_DUNG', technicalFailure: 'LOI_KY_THUAT', needsGiftReview: 'CAN_DOI_SOAT_QUA', giftStatus: 'TRANG_THAI_QUA',
  restoredAt: 'NGAY_KHOI_PHUC', sourceCancelledReview: 'DA_DOI_SOAT_HUY_NGUON', deliveredAt: 'NGAY_GIAO_QUA', actualGiftCost: 'GIA_VON_QUA_THUC_TE', giftExportId: 'PHIEU_XUAT_QUA_ID',
};
const LUCKY_TABLES = ['VQ_CHUONG_TRINH', 'VQ_LUOT_QUAY', 'VQ_KET_QUA', 'VQ_PHAN_THUONG', 'VQ_HAN_MUC', 'VQ_NHAT_KY', 'VQ_THONG_BAO', 'VQ_YEU_CAU_QUAY', 'VQ_DONG_BO_META'];
const READ_STANDARD_TABLES = new Set([...LUCKY_TABLES, 'YEU_CAU_HO_TRO', 'YEU_CAU_TAO_ANH', 'THIET_KE_3D']);
const FIELD_ALIASES: Record<string, Record<string, string>> = {
  ...Object.fromEntries(LUCKY_TABLES.map((table) => {
    const aliases: Record<string, string> = { ...LUCKY_FIELD_ALIASES, id: `${table}_ID` };
    // prizeId (hạn mức) và rewardId (thưởng) cùng tên chuẩn PHAN_THUONG_ID nên mỗi bảng chỉ giữ một nghĩa.
    delete aliases[table === 'VQ_HAN_MUC' ? 'rewardId' : 'prizeId'];
    return [table, aliases];
  })),
  YEU_CAU_HO_TRO: {
    customerId: 'KHACH_HANG_ID', guestHash: 'MA_BAM_KHACH_VANG_LAI', name: 'TEN', phone: 'SDT', email: 'EMAIL', source: 'NGUON', status: 'TRANG_THAI',
    mode: 'CHE_DO', priority: 'UU_TIEN', assignedTo: 'NGUOI_PHU_TRACH_ID', assignedName: 'TEN_NGUOI_PHU_TRACH', reason: 'LY_DO', version: 'PHIEN_BAN',
    round: 'VONG', createdAt: 'NGAY_TAO', updatedAt: 'NGAY_CAP_NHAT', expiresAt: 'HET_HAN', history: 'LICH_SU', notes: 'GHI_CHU', ratings: 'DS_DANH_GIA',
    preferences: 'TUY_CHON', messageCount: 'SO_TIN_NHAN', messageWindowAt: 'MOC_CUA_SO_TIN_NHAN', productId: 'SAN_PHAM_ID', closedAt: 'NGAY_DONG',
    selectedImageId: 'ANH_DA_CHON_ID', busyUntil: 'KHOA_XU_LY_DEN',
  },
  YEU_CAU_TAO_ANH: { COLOR: 'MAU_SAC', OCCASION: 'DIP' },
  THIET_KE_3D: { name: 'TEN', image: 'HINH_ANH', materials: 'NGUYEN_VAT_LIEU', arrangement: 'KIEU_CAM', fingerprint: 'FINGERPRINT', createdAt: 'NGAY_TAO' },
};

const toStandardPath = (path: string, aliases: Record<string, string>): string => {
  const root = path.split('.')[0];
  return aliases[root] ? aliases[root] + path.slice(root.length) : path;
};

const toStandardKeys = <V extends Document | undefined>(fields: V, aliases: Record<string, string>): V => (
  fields && Object.fromEntries(Object.entries(fields).map(([key, value]) => [toStandardPath(key, aliases), value])) as V
);

const toStandardFilter = (filter: Document | undefined, aliases: Record<string, string>): Document => (
  Object.fromEntries(Object.entries(filter || {}).map(([key, value]) => {
    if (['$or', '$and', '$nor'].includes(key)) return [key, (value as Document[]).map((item) => toStandardFilter(item, aliases))];
    return [key.startsWith('$') ? key : toStandardPath(key, aliases), value];
  }))
);

const toStandardExpression = (value: unknown, aliases: Record<string, string>): unknown => {
  if (typeof value === 'string') return /^\$[^$]/.test(value) ? `$${toStandardPath(value.slice(1), aliases)}` : value;
  if (Array.isArray(value)) return value.map((item) => toStandardExpression(item, aliases));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toStandardExpression(item, aliases)]));
  }
  return value;
};

const toStandardPipeline = (pipeline: Document[], aliases: Record<string, string>): Document[] => pipeline.map((stage) => {
  if (stage.$match) return { $match: toStandardFilter(stage.$match, aliases) };
  if (stage.$sort) return { $sort: toStandardKeys(stage.$sort, aliases) };
  return toStandardExpression(stage, aliases) as Document;
});

const toStandardOptions = (options: Document | undefined, aliases: Record<string, string>): Document | undefined => {
  if (!options) return options;
  return {
    ...options,
    ...(options.sort ? { sort: toStandardKeys(options.sort, aliases) } : {}),
    ...(options.projection ? { projection: toStandardKeys(options.projection, aliases) } : {}),
  };
};

const toLegacyDocument = <D extends Document | null>(doc: D, aliases: Record<string, string>): D => {
  if (!doc) return doc;
  const legacy: Document = { ...doc };
  for (const [oldName, standardName] of Object.entries(aliases)) {
    if (standardName in legacy) {
      legacy[oldName] = legacy[standardName];
      delete legacy[standardName];
    }
  }
  return legacy as D;
};

const withoutStandardFields = <D extends Document | null>(doc: D, aliases: Record<string, string>): D => {
  if (!doc) return doc;
  const legacy: Document = { ...doc };
  for (const standardName of Object.values(aliases)) delete legacy[standardName];
  return legacy as D;
};

const withStandardCursor = (cursor: any, aliases: Record<string, string>, readsStandard: boolean) => {
  const keysOf = (fields: Document) => (readsStandard ? toStandardKeys(fields, aliases) : fields);
  const documentOf = readsStandard ? toLegacyDocument : withoutStandardFields;
  const proxy: any = new Proxy(cursor.map((doc: Document) => documentOf(doc, aliases)), {
    get(target, property) {
      if (property === 'sort') return (sort: Document, ...rest: unknown[]) => { target.sort(keysOf(sort), ...rest); return proxy; };
      if (property === 'project') return (projection: Document) => { target.project(keysOf(projection)); return proxy; };
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        return result === target ? proxy : result;
      };
    },
  });
  return proxy;
};

const mirrorFields = (fields: Document, aliases: Record<string, string>): Document => {
  const mirrored: Document = { ...fields };
  for (const [key, value] of Object.entries(fields)) {
    const root = key.split('.')[0];
    if (aliases[root]) mirrored[aliases[root] + key.slice(root.length)] = value;
  }
  return mirrored;
};

const mirrorUpdate = (update: Document, aliases: Record<string, string>): Document => {
  if (Array.isArray(update)) throw new TypeError('Bảng đang đổi tên trường chưa hỗ trợ cập nhật bằng pipeline.');
  return Object.fromEntries(Object.entries(update).map(([operator, fields]) => [
    operator,
    operator.startsWith('$') && fields && typeof fields === 'object' ? mirrorFields(fields, aliases) : fields,
  ]));
};

const withFieldAliases = <T extends Document>(collection: Collection<T>): Collection<T> => {
  const aliases = FIELD_ALIASES[collection.collectionName];
  if (!aliases) return collection;
  const readsStandard = READ_STANDARD_TABLES.has(collection.collectionName);
  const filterOf = (filter: Document) => (readsStandard ? toStandardFilter(filter, aliases) : filter);
  const optionsOf = (options?: Document) => (readsStandard ? toStandardOptions(options, aliases) : options);
  const pipelineOf = (pipeline: Document[] = []) => (readsStandard ? toStandardPipeline(pipeline, aliases) : pipeline);
  const documentOf = <D extends Document | null>(doc: D) => (readsStandard ? toLegacyDocument(doc, aliases) : withoutStandardFields(doc, aliases));
  const writers: Record<string, (target: any, args: any[]) => unknown> = {
    insertOne: (target, [doc, ...rest]) => target.insertOne(mirrorFields(doc, aliases), ...rest),
    insertMany: (target, [docs, ...rest]) => target.insertMany(docs.map((doc: Document) => mirrorFields(doc, aliases)), ...rest),
    replaceOne: (target, [filter, doc, ...rest]) => target.replaceOne(filterOf(filter), mirrorFields(doc, aliases), ...rest),
    updateOne: (target, [filter, update, ...rest]) => target.updateOne(filterOf(filter), mirrorUpdate(update, aliases), ...rest),
    updateMany: (target, [filter, update, ...rest]) => target.updateMany(filterOf(filter), mirrorUpdate(update, aliases), ...rest),
    findOneAndUpdate: async (target, [filter, update, options]) => documentOf(await target.findOneAndUpdate(filterOf(filter), mirrorUpdate(update, aliases), optionsOf(options))),
    findOne: async (target, [filter, options]) => documentOf(await target.findOne(filterOf(filter), optionsOf(options))),
    find: (target, [filter, options]) => withStandardCursor(target.find(filterOf(filter), optionsOf(options)), aliases, readsStandard),
    countDocuments: (target, [filter, options]) => target.countDocuments(filterOf(filter), options),
    aggregate: (target, [pipeline, options]) => target.aggregate(pipelineOf(pipeline), options),
  };
  return new Proxy(collection, {
    get(target, property) {
      const writer = typeof property === 'string' ? writers[property] : undefined;
      if (writer) return (...args: any[]) => writer(target, args);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
};

export const getCollection = async <T extends Document = Document>(name: string): Promise<Collection<T>> => {
  const db = await getDb();
  return withFieldAliases(db.collection<T>(name));
};

export const getNextPrefixedId = async (
  collectionName: string,
  idField: string,
  prefix: string,
  width: number,
): Promise<string> => {
  const collection = await getCollection(collectionName);
  const rows = await collection
    .find({ [idField]: { $regex: `^${escapeRegex(prefix)}\\d+$` } })
    .project({ [idField]: 1 })
    .toArray();
  const max = rows.reduce((currentMax, row: any) => {
    const value = String(row[idField] ?? '');
    const numericPart = Number(value.slice(prefix.length));
    return Number.isFinite(numericPart) ? Math.max(currentMax, numericPart) : currentMax;
  }, 0);

  return `${prefix}${String(max + 1).padStart(width, '0')}`;
};

export const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

function loadEnvFile(envPath: string) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
