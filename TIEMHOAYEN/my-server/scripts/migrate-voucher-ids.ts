import type { ClientSession, Collection } from 'mongodb';
import { getDb, getMongoClient } from '../mongo.js';

const applyChanges = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run') || !applyChanges;

if (applyChanges && process.argv.includes('--dry-run')) {
  throw new Error('Choose either --apply or --dry-run, not both.');
}

const formatVoucherId = (number: number): string => `VC${String(number).padStart(4, '0')}`;

const createIdMap = (vouchers: any[]): Map<string, string> => {
  if (vouchers.length > 9999) {
    throw new Error('There are more than 9,999 vouchers; VC0000 format cannot represent them uniquely.');
  }

  const oldIds = vouchers.map((voucher) => String(voucher.VOUCHER_ID ?? voucher._id ?? '').trim());
  if (oldIds.some((id) => !id) || new Set(oldIds).size !== oldIds.length) {
    throw new Error('Voucher records contain missing or duplicate IDs; no changes were applied.');
  }

  return new Map(oldIds.map((oldId, index) => [oldId, formatVoucherId(index + 1)]));
};

const remapReferenceId = (name: string, documentId: any, oldId: string, newId: string): any => {
  if (name === 'DON_HANG_VOUCHER') {
    if (!documentId || typeof documentId !== 'object' || documentId.VOUCHER_ID !== oldId) {
      throw new Error(`Unexpected _id shape in ${name}; no changes were applied.`);
    }
    return { ...documentId, VOUCHER_ID: newId };
  }

  if (typeof documentId === 'string' && documentId.startsWith(`${oldId}:`)) {
    return `${newId}${documentId.slice(oldId.length)}`;
  }

  throw new Error(`Unexpected _id shape in ${name}; no changes were applied.`);
};

const readVoucherRows = async (
  collection: Collection<any>,
  session?: ClientSession,
): Promise<any[]> => {
  const rows = await collection.find({}, session ? { session } : {}).toArray();
  rows.sort((left, right) =>
    String(left.VOUCHER_ID ?? left._id).localeCompare(String(right.VOUCHER_ID ?? right._id), 'en', { numeric: true }),
  );
  return rows;
};

const migrate = async (): Promise<void> => {
  const client = await getMongoClient();
  const db = await getDb();
  const vouchersCollection = db.collection<any>('VOUCHER');

  if (dryRun) {
    try {
      const vouchers = await readVoucherRows(vouchersCollection);
      const idMap = createIdMap(vouchers);
      const changedCount = vouchers.filter((voucher, index) =>
        String(voucher.VOUCHER_ID ?? voucher._id) !== formatVoucherId(index + 1) ||
        voucher._id !== formatVoucherId(index + 1),
      ).length;
      const referenceCounts: Record<string, number> = {};
      for (const name of ['DON_HANG_VOUCHER', 'VOUCHER_SU_DUNG', 'VOUCHER_GIOI_HAN_NGUOI_DUNG']) {
        const rows = await db.collection<any>(name).find(
          { VOUCHER_ID: { $in: [...idMap.keys()] } },
        ).toArray();
        let changedCount = 0;
        for (const row of rows) {
          const oldId = String(row.VOUCHER_ID);
          const newId = idMap.get(oldId);
          if (!newId) throw new Error(`Cannot map voucher reference in ${name}.`);
          if (oldId === newId) continue;
          remapReferenceId(name, row._id, oldId, newId);
          changedCount++;
        }
        referenceCounts[name] = changedCount;
      }

      console.log(`Dry run: ${changedCount} of ${vouchers.length} voucher IDs would be normalized.`);
      for (const [collection, count] of Object.entries(referenceCounts)) {
        console.log(`${count} linked records would be updated in ${collection}.`);
      }
    } finally {
      await client.close();
    }
    return;
  }

  const session = client.startSession();
  try {
    let updatedVoucherCount = 0;
    const updatedReferenceCounts: Record<string, number> = {};

    await session.withTransaction(async () => {
      const vouchers = await readVoucherRows(vouchersCollection, session);
      const oldIds = vouchers.map((voucher) => String(voucher.VOUCHER_ID ?? voucher._id ?? '').trim());
      const idMap = createIdMap(vouchers);
      const voucherUpdates = vouchers.map((voucher, index) => {
        const newId = formatVoucherId(index + 1);
        return {
          original: voucher,
          updated: { ...voucher, _id: newId, VOUCHER_ID: newId },
        };
      });
      const changedVouchers = voucherUpdates.filter(({ original, updated }) =>
        String(original.VOUCHER_ID ?? original._id) !== updated._id ||
        String(original._id) !== updated._id,
      );

      const referenceCollections = [
        'DON_HANG_VOUCHER',
        'VOUCHER_SU_DUNG',
        'VOUCHER_GIOI_HAN_NGUOI_DUNG',
      ];

      const updatedReferences: Array<{
        name: string;
        collection: Collection<any>;
        changedRows: any[];
        replacements: any[];
      }> = [];
      for (const name of referenceCollections) {
        const collection = db.collection<any>(name);
        const rows = await collection.find({ VOUCHER_ID: { $in: oldIds } }, { session }).toArray();
        const changedRows: any[] = [];
        const replacements: any[] = [];
        for (const row of rows) {
          const oldId = String(row.VOUCHER_ID);
          const newId = idMap.get(oldId);
          if (!newId) {
            throw new Error(`Cannot map voucher reference in ${name}.`);
          }
          if (oldId === newId) continue;

          const newDocumentId = remapReferenceId(name, row._id, oldId, newId);

          changedRows.push(row);
          replacements.push({ ...row, _id: newDocumentId, VOUCHER_ID: newId });
        }

        updatedReferences.push({ name, collection, changedRows, replacements });
      }

      updatedVoucherCount = changedVouchers.length;

      if (updatedVoucherCount === 0 && updatedReferences.every(({ replacements }) => replacements.length === 0)) {
        return;
      }

      for (const { name, collection, changedRows, replacements } of updatedReferences) {
        if (replacements.length === 0) continue;
        await collection.deleteMany({ _id: { $in: changedRows.map((row) => row._id) } }, { session });
        await collection.insertMany(replacements, { session });
        updatedReferenceCounts[name] = replacements.length;
      }

      if (changedVouchers.length > 0) {
        await vouchersCollection.deleteMany(
          { _id: { $in: changedVouchers.map(({ original }) => original._id) } },
          { session },
        );
        await vouchersCollection.insertMany(changedVouchers.map(({ updated }) => updated), { session });
      }
    });

    console.log(`Updated ${updatedVoucherCount} voucher IDs.`);
    for (const [collection, count] of Object.entries(updatedReferenceCounts)) {
      console.log(`Updated ${count} linked records in ${collection}.`);
    }
  } finally {
    await session.endSession();
    await client.close();
  }
};

migrate().catch((error: unknown) => {
  console.error('Voucher ID migration failed:', error);
  process.exitCode = 1;
});
