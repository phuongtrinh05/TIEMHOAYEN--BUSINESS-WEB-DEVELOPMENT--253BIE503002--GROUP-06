import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

type Options = {
  mongoUri: string;
  mongoDatabase: string;
};

const parseArgs = (): Options => {
  const args = process.argv.slice(2);
  const envFile = getArgValue(args, '--env-file') ?? '.env';
  loadEnvFile(path.resolve(process.cwd(), envFile));

  const mongoUri = getArgValue(args, '--mongo-uri') ?? process.env.MONGO_URI;
  const mongoDatabase = getArgValue(args, '--mongo-db') ?? process.env.MONGO_DATABASE;

  if (!mongoUri) {
    throw new Error(`Missing MongoDB URI. Use --mongo-uri=... or set MONGO_URI in ${envFile}.`);
  }

  if (!mongoDatabase) {
    throw new Error(`Missing MongoDB database name. Use --mongo-db=... or set MONGO_DATABASE in ${envFile}.`);
  }

  return { mongoUri, mongoDatabase };
};

const main = async () => {
  const options = parseArgs();
  const client = new MongoClient(options.mongoUri);

  try {
    await client.connect();

    const db = client.db(options.mongoDatabase);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const counts = await Promise.all(
      collections.map(async (collection) => ({
        name: collection.name,
        count: await db.collection(collection.name).countDocuments(),
      })),
    );

    const totalDocuments = counts.reduce((total, collection) => total + collection.count, 0);

    console.log(`MongoDB database: ${options.mongoDatabase}`);
    console.log(`Collections: ${collections.length}`);
    console.log(`Documents: ${totalDocuments}`);

    for (const collection of counts.sort((left, right) => left.name.localeCompare(right.name))) {
      console.log(`- ${collection.name}: ${collection.count}`);
    }
  } finally {
    await client.close();
  }
};

const getArgValue = (args: string[], name: string): string | undefined => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }

  return undefined;
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
