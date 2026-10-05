import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { MongoClient, type AnyBulkWriteOperation, type Collection, type Document } from 'mongodb';

type SqlColumn = {
  name: string;
  type: string;
  nullable: boolean;
  length?: number;
  isMax?: boolean;
  precision?: number;
  scale?: number;
};

type SqlTable = {
  schemaName: string;
  tableName: string;
  columns: SqlColumn[];
  primaryKey: string[];
};

type ForeignKeyInfo = {
  tableName: string;
  columns: string[];
};

type BacpacModel = {
  tables: SqlTable[];
  foreignKeys: ForeignKeyInfo[];
};

type Options = {
  bacpacPath: string;
  outDir: string;
  exportJson: boolean;
  seedMongo: boolean;
  dropCollections: boolean;
  selectedTables: Set<string> | null;
  mongoUri: string;
  mongoDatabase: string;
  batchSize: number;
};

type ManifestTable = {
  tableName: string;
  collection: string;
  rows: number;
  files: string[];
  primaryKey: string[];
};

const MS_PER_DAY = 86_400_000;
const SQL_DATE_EPOCH_MS = createUtcDate(1, 1, 1).getTime();
const SQL_DATETIME_EPOCH_MS = Date.UTC(1900, 0, 1);

const parseArgs = (): Options => {
  const args = process.argv.slice(2);
  const envFile = getArgValue(args, '--env-file') ?? '.env';
  loadEnvFile(path.resolve(process.cwd(), envFile));

  const bacpacPath = getArgValue(args, '--bacpac') ?? process.env.BACPAC_PATH;
  const outDir = getArgValue(args, '--out-dir') ?? process.env.BACPAC_EXPORT_DIR ?? path.resolve(process.cwd(), 'mongo-seed');
  const selectedTablesArg = getArgValue(args, '--tables') ?? process.env.MIGRATION_TABLES;
  const selectedTables = selectedTablesArg
    ? new Set(selectedTablesArg.split(',').map(normalizeTableName).filter(Boolean))
    : null;
  const mongoUri = getArgValue(args, '--mongo-uri') ?? process.env.MONGO_URI;
  const mongoDatabase = getArgValue(args, '--mongo-db') ?? process.env.MONGO_DATABASE;
  const batchSize = Number(getArgValue(args, '--batch-size') ?? process.env.MIGRATION_BATCH_SIZE ?? 500);
  const seedMongo = hasFlag(args, '--seed');

  if (!bacpacPath) {
    throw new Error(`Missing BACPAC path. Use --bacpac=... or set BACPAC_PATH in ${envFile}.`);
  }

  if (seedMongo && !mongoUri) {
    throw new Error(`Missing MongoDB URI. Use --mongo-uri=... or set MONGO_URI in ${envFile}.`);
  }

  if (seedMongo && !mongoDatabase) {
    throw new Error(`Missing MongoDB database name. Use --mongo-db=... or set MONGO_DATABASE in ${envFile}.`);
  }

  return {
    bacpacPath,
    outDir,
    exportJson: hasFlag(args, '--export') || !seedMongo,
    seedMongo,
    dropCollections: hasFlag(args, '--drop') || parseBoolean(process.env.MIGRATION_DROP_COLLECTIONS),
    selectedTables,
    mongoUri: mongoUri ?? '',
    mongoDatabase: mongoDatabase ?? '',
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 500,
  };
};

const main = async () => {
  const options = parseArgs();

  if (!fs.existsSync(options.bacpacPath)) {
    throw new Error(`BACPAC file not found: ${options.bacpacPath}`);
  }

  const zip = new AdmZip(options.bacpacPath);
  const model = parseModel(zip);
  const tables = options.selectedTables
    ? model.tables.filter((table) => options.selectedTables?.has(normalizeTableName(table.tableName)))
    : model.tables;

  if (tables.length === 0) {
    console.log('No tables matched the migration filter.');
    return;
  }

  if (options.exportJson) {
    fs.mkdirSync(options.outDir, { recursive: true });
  }

  const mongo = options.seedMongo ? new MongoClient(options.mongoUri) : null;
  const manifest: ManifestTable[] = [];

  try {
    if (mongo) {
      await mongo.connect();
      console.log(`Connected to MongoDB: ${options.mongoDatabase}`);
    }

    const mongoDb = mongo?.db(options.mongoDatabase);

    for (const table of tables) {
      const entries = getTableDataEntries(zip, table);
      const documents: Document[] = [];
      const sourceFiles = entries.map((entry) => entry.entryName);

      for (const entry of entries) {
        documents.push(...parseBcpFile(entry.getData(), table));
      }

      for (let index = 0; index < documents.length; index += 1) {
        documents[index]._id = buildMongoId(table, documents[index], index);
      }

      if (options.exportJson) {
        writeNdjson(path.join(options.outDir, `${table.tableName}.ndjson`), documents);
      }

      if (mongoDb) {
        const collection = mongoDb.collection(table.tableName);
        if (options.dropCollections) {
          await collection.drop().catch((error: any) => {
            if (error?.codeName !== 'NamespaceNotFound') {
              throw error;
            }
          });
        }

        await createIndexes(collection, table, model.foreignKeys);
        await seedCollection(collection, documents, options.batchSize);
      }

      manifest.push({
        tableName: table.tableName,
        collection: table.tableName,
        rows: documents.length,
        files: sourceFiles,
        primaryKey: table.primaryKey,
      });

      console.log(`${table.tableName}: ${documents.length} rows`);
    }

    if (options.exportJson) {
      fs.writeFileSync(
        path.join(options.outDir, 'manifest.json'),
        `${JSON.stringify({ generatedAt: new Date().toISOString(), tables: manifest }, null, 2)}\n`,
        'utf8',
      );
      console.log(`\nExported NDJSON files to ${options.outDir}`);
    }

    if (mongo) {
      console.log(`Seeded MongoDB database ${options.mongoDatabase}`);
    }
  } finally {
    await mongo?.close();
  }
};

const parseModel = (zip: AdmZip): BacpacModel => {
  const modelXml = zip.readAsText('model.xml');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
  });
  const parsed = parser.parse(modelXml);
  const topElements = toArray(parsed?.DataSchemaModel?.Model?.Element);
  const primaryKeys = parsePrimaryKeys(topElements);
  const tables: SqlTable[] = [];

  for (const element of topElements) {
    if (element?._Type !== 'SqlTable') {
      continue;
    }

    const [schemaName, tableName] = parseSqlName(element._Name);
    const columnsRelationship = getRelationship(element, 'Columns');
    const columns = toArray(columnsRelationship?.Entry)
      .map((entry: any) => toArray(entry.Element).find((column: any) => column?._Type === 'SqlSimpleColumn'))
      .filter(Boolean)
      .map(parseColumn);

    tables.push({
      schemaName,
      tableName,
      columns,
      primaryKey: primaryKeys.get(tableName) ?? [],
    });
  }

  return {
    tables,
    foreignKeys: parseForeignKeys(topElements),
  };
};

const parseColumn = (column: any): SqlColumn => {
  const parts = parseSqlName(column._Name);
  const name = parts[parts.length - 1];
  const props = getProperties(column);
  const typeSpecifier = toArray(getRelationship(column, 'TypeSpecifier')?.Entry)
    .flatMap((entry: any) => toArray(entry.Element))
    .find((element: any) => element?._Type === 'SqlTypeSpecifier');
  const typeReference = toArray(getRelationship(typeSpecifier, 'Type')?.Entry)
    .map((entry: any) => entry.References)
    .find(Boolean);
  const typeProps = getProperties(typeSpecifier);

  return {
    name,
    type: String(typeReference?._Name ?? '').replace(/^\[|\]$/g, '').toLowerCase(),
    nullable: props.IsNullable !== 'False',
    length: typeProps.Length ? Number(typeProps.Length) : undefined,
    isMax: typeProps.IsMax === 'True',
    precision: typeProps.Precision ? Number(typeProps.Precision) : undefined,
    scale: typeProps.Scale ? Number(typeProps.Scale) : undefined,
  };
};

const parsePrimaryKeys = (topElements: any[]): Map<string, string[]> => {
  const primaryKeys = new Map<string, string[]>();

  for (const element of topElements) {
    if (element?._Type !== 'SqlPrimaryKeyConstraint') {
      continue;
    }

    const columnsRelationship = getRelationship(element, 'ColumnSpecifications');
    const columns: string[] = [];
    let tableName = '';

    for (const entry of toArray(columnsRelationship?.Entry)) {
      const indexedColumn = toArray(entry.Element).find((candidate: any) => candidate?._Type === 'SqlIndexedColumnSpecification');
      const columnReference = toArray(getRelationship(indexedColumn, 'Column')?.Entry)
        .map((candidate: any) => candidate.References?._Name)
        .find(Boolean);

      if (columnReference) {
        const parts = parseSqlName(columnReference);
        tableName = parts[1];
        columns.push(parts[2]);
      }
    }

    if (tableName && columns.length > 0) {
      primaryKeys.set(tableName, columns);
    }
  }

  return primaryKeys;
};

const parseForeignKeys = (topElements: any[]): ForeignKeyInfo[] => {
  const foreignKeys: ForeignKeyInfo[] = [];

  for (const element of topElements) {
    if (element?._Type !== 'SqlForeignKeyConstraint') {
      continue;
    }

    const columns = toArray(getRelationship(element, 'Columns')?.Entry)
      .map((entry: any) => entry.References?._Name)
      .filter(Boolean)
      .map((name: string) => parseSqlName(name));

    if (columns.length > 0) {
      foreignKeys.push({
        tableName: columns[0][1],
        columns: columns.map((parts) => parts[2]),
      });
    }
  }

  return foreignKeys;
};

const getTableDataEntries = (zip: AdmZip, table: SqlTable) => {
  const prefix = `Data/${table.schemaName}.${table.tableName}/`;
  return zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.startsWith(prefix) && entry.entryName.endsWith('.BCP'))
    .sort((left, right) => left.entryName.localeCompare(right.entryName));
};

const parseBcpFile = (buffer: Buffer, table: SqlTable): Document[] => {
  const reader = new BcpReader(buffer, table.tableName);
  const documents: Document[] = [];

  while (!reader.isDone()) {
    const document: Document = {};
    const rowStart = reader.offset;
    const rowIndex = documents.length;

    for (const column of table.columns) {
      try {
        document[column.name] = readColumnValue(reader, column);
      } catch (error: any) {
        error.message = `${table.tableName}[${rowIndex}].${column.name}: ${error.message}`;
        throw error;
      }
    }

    if (reader.offset === rowStart) {
      throw new Error(`Parser made no progress while reading ${table.tableName} at offset ${reader.offset}`);
    }

    documents.push(document);
  }

  return documents;
};

const readColumnValue = (reader: BcpReader, column: SqlColumn): unknown => {
  switch (column.type) {
    case 'nvarchar':
      return readText(reader, column, 'utf16le');
    case 'varchar':
      return readText(reader, column, 'utf16le');
    case 'int':
      return readFixed(reader, column, 4, () => reader.readInt32LE());
    case 'bigint':
      return readFixed(reader, column, 8, () => toJsonInteger(reader.readBigInt64LE()));
    case 'bit':
      return readFixed(reader, column, 1, () => reader.readUInt8() === 1, true);
    case 'date':
      return readFixed(reader, column, 3, () => decodeSqlDate(reader.readUIntLE(3)));
    case 'datetime':
      return readFixed(reader, column, 8, () => decodeSqlDateTime(reader.readInt32LE(), reader.readUInt32LE()));
    case 'datetime2':
      return readFixed(reader, column, datetime2ByteLength(column.scale ?? 7), () => decodeSqlDateTime2(reader, column.scale ?? 7));
    case 'decimal':
      return readFixed(reader, column, 19, (length) => decodeSqlDecimal(reader.readBytes(length), column.scale ?? 0), true);
    default:
      throw new Error(`Unsupported SQL type ${column.type} for ${column.name}`);
  }
};

const readText = (reader: BcpReader, column: SqlColumn, encoding: BufferEncoding): string | null => {
  const length = column.isMax ? reader.readInt64Length() : reader.readInt16LE();
  if (length < 0) {
    return null;
  }

  return reader.readBytes(length).toString(encoding);
};

const readFixed = <T>(
  reader: BcpReader,
  column: SqlColumn,
  expectedLength: number,
  readValue: (length: number) => T,
  forcePrefix = false,
): T | null => {
  if (!column.nullable && !forcePrefix) {
    return readValue(expectedLength);
  }

  const length = reader.readInt8();
  if (length < 0) {
    return null;
  }

  if (length !== expectedLength) {
    throw new Error(
      `Unexpected native length ${length} for ${column.name} (${column.type}); expected ${expectedLength} at offset ${reader.offset}`,
    );
  }

  return readValue(length);
};

const decodeSqlDate = (days: number): Date => {
  return new Date(SQL_DATE_EPOCH_MS + days * MS_PER_DAY);
};

const decodeSqlDateTime = (days: number, ticks: number): Date => {
  return new Date(SQL_DATETIME_EPOCH_MS + days * MS_PER_DAY + Math.round((ticks * 1000) / 300));
};

const decodeSqlDateTime2 = (reader: BcpReader, scale: number): Date => {
  const timeLength = datetime2TimeByteLength(scale);
  const timeUnits = reader.readUIntLE(timeLength);
  const days = reader.readUIntLE(3);
  const milliseconds = timeUnits * (1000 / 10 ** scale);

  return new Date(SQL_DATE_EPOCH_MS + days * MS_PER_DAY + Math.round(milliseconds));
};

const decodeSqlDecimal = (bytes: Buffer, fallbackScale: number): number | string => {
  const scale = Number.isFinite(bytes[1]) ? bytes[1] : fallbackScale;
  const sign = bytes[2] === 0 ? -1n : 1n;
  let magnitude = 0n;

  for (let index = 3; index < bytes.length; index += 1) {
    magnitude += BigInt(bytes[index]) << (8n * BigInt(index - 3));
  }

  const scaled = sign * magnitude;
  if (scale === 0) {
    return toJsonInteger(scaled);
  }

  const divisor = 10n ** BigInt(scale);
  const integerPart = scaled / divisor;
  const fractionPart = (scaled < 0n ? -scaled : scaled) % divisor;
  const asString = `${integerPart.toString()}.${fractionPart.toString().padStart(scale, '0')}`;
  const asNumber = Number(asString);

  return Number.isSafeInteger(Math.round(asNumber * 10 ** scale)) ? asNumber : asString;
};

const datetime2ByteLength = (scale: number): number => datetime2TimeByteLength(scale) + 3;

const datetime2TimeByteLength = (scale: number): number => {
  if (scale <= 2) return 3;
  if (scale <= 4) return 4;
  return 5;
};

const toJsonInteger = (value: bigint): number | string => {
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
};

const buildMongoId = (table: SqlTable, document: Document, index: number): unknown => {
  if (table.primaryKey.length === 1) {
    return document[table.primaryKey[0]];
  }

  if (table.primaryKey.length > 1) {
    return Object.fromEntries(table.primaryKey.map((column) => [column, document[column]]));
  }

  return `${table.tableName}_${index}_${crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex').slice(0, 16)}`;
};

const writeNdjson = (filePath: string, documents: Document[]) => {
  const lines = documents.map((document) => JSON.stringify(document));
  fs.writeFileSync(filePath, `${lines.join('\n')}${lines.length ? '\n' : ''}`, 'utf8');
};

const seedCollection = async (collection: Collection<Document>, documents: Document[], batchSize: number) => {
  for (let index = 0; index < documents.length; index += batchSize) {
    const batch = documents.slice(index, index + batchSize);
    const operations: AnyBulkWriteOperation<Document>[] = batch.map((document) => ({
      replaceOne: {
        filter: { _id: document._id },
        replacement: document,
        upsert: true,
      },
    }));

    if (operations.length > 0) {
      await collection.bulkWrite(operations, { ordered: false });
    }
  }
};

const createIndexes = async (collection: Collection<Document>, table: SqlTable, foreignKeys: ForeignKeyInfo[]) => {
  if (table.primaryKey.length > 1) {
    await collection.createIndex(toIndexSpec(table.primaryKey), { unique: true, name: `pk_${table.primaryKey.join('_')}` });
  }

  for (const foreignKey of foreignKeys.filter((candidate) => candidate.tableName === table.tableName)) {
    await collection.createIndex(toIndexSpec(foreignKey.columns), { name: `fk_${foreignKey.columns.join('_')}` });
  }
};

const toIndexSpec = (columns: string[]): Record<string, 1> => {
  return Object.fromEntries(columns.map((column) => [column, 1])) as Record<string, 1>;
};

const getRelationship = (element: any, name: string): any | undefined => {
  return toArray(element?.Relationship).find((relationship: any) => relationship?._Name === name);
};

const getProperties = (element: any): Record<string, string> => {
  return Object.fromEntries(toArray(element?.Property).map((property: any) => [property._Name, property._Value]));
};

const parseSqlName = (value: string): string[] => {
  return Array.from(value.matchAll(/\[([^\]]+)]/g)).map((match) => match[1]);
};

const normalizeTableName = (value: string): string => {
  return value.trim().replace(/^dbo\./i, '').toUpperCase();
};

function createUtcDate(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(0, month - 1, day));
  date.setUTCFullYear(year);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

const loadEnvFile = (envPath: string) => {
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
};

const getArgValue = (args: string[], name: string): string | undefined => {
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed) {
    return prefixed.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  if (index >= 0) {
    return args[index + 1];
  }

  return undefined;
};

const hasFlag = (args: string[], name: string): boolean => args.includes(name);

const parseBoolean = (value: unknown): boolean => {
  return ['1', 'true', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase());
};

const toArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

class BcpReader {
  offset = 0;

  constructor(
    private readonly buffer: Buffer,
    private readonly tableName: string,
  ) {}

  isDone(): boolean {
    return this.offset >= this.buffer.length;
  }

  readBytes(length: number): Buffer {
    this.ensure(length);
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readInt8(): number {
    this.ensure(1);
    const value = this.buffer.readInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUInt8(): number {
    this.ensure(1);
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readInt16LE(): number {
    this.ensure(2);
    const value = this.buffer.readInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  readInt32LE(): number {
    this.ensure(4);
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readUInt32LE(): number {
    this.ensure(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readUIntLE(length: number): number {
    this.ensure(length);
    const value = this.buffer.readUIntLE(this.offset, length);
    this.offset += length;
    return value;
  }

  readBigInt64LE(): bigint {
    this.ensure(8);
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  readInt64Length(): number {
    this.ensure(8);
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return value < 0n ? -1 : Number(value);
  }

  private ensure(length: number) {
    if (this.offset + length > this.buffer.length) {
      throw new Error(`Unexpected EOF while reading ${this.tableName} at offset ${this.offset}; wanted ${length} bytes`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
