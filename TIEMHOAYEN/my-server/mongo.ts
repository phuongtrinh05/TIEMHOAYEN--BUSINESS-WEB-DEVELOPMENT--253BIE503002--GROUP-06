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
    await c.connect();
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

export const getCollection = async <T extends Document = Document>(name: string): Promise<Collection<T>> => {
  const db = await getDb();
  return db.collection<T>(name);
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
