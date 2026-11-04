import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('batched catalog keeps active/legacy BOM, primary image and fresh stock semantics', { skip: !process.env.TEST_MONGO_URI }, async () => {
  if (!/^mongodb:\/\/127\.0\.0\.1:/.test(process.env.TEST_MONGO_URI!)) throw Error('Local DB required');
  process.env.MONGO_URI = process.env.TEST_MONGO_URI;
  process.env.MONGO_DATABASE = `CATALOG_${randomUUID().replaceAll('-', '')}_LOCAL_TEST`;
  const mongo = await import('../mongo.js');
  const { COLLECTIONS, BOM_STATUS } = await import('../services/inventory/constants.js');
  const { getActiveBom, getActiveBomMap } = await import('../services/inventory/bom.service.js');
  const { getAllProducts } = await import('../controllers/product.js');
  const db = await mongo.getDb();
  try {
    await db.collection(COLLECTIONS.product).insertMany(['P1', 'P2'].map(id => ({ SAN_PHAM_ID: id, TEN_SAN_PHAM: id, TRANG_THAI: 'Đang bán', TON_THANH_PHAM: 2 })));
    await db.collection(COLLECTIONS.material).insertOne({ NGUYEN_VAT_LIEU_ID: 'M1', TON_THUC: 10, TON_DANG_GIU: 2, TON_KHONG_DAT: 0 });
    await db.collection(COLLECTIONS.bom).insertOne({ BOM_ID: 'B1', SAN_PHAM_ID: 'P1', TRANG_THAI: BOM_STATUS.active });
    await db.collection(COLLECTIONS.bomLine).insertOne({ BOM_ID: 'B1', NGUYEN_VAT_LIEU_ID: 'M1', DINH_LUONG: 2 });
    await db.collection(COLLECTIONS.legacyRecipe).insertMany([
      { SAN_PHAM_ID: 'P1', NGUYEN_VAT_LIEU_ID: 'M1', SO_LUONG_CAN: 99 },
      { SAN_PHAM_ID: 'P2', NGUYEN_VAT_LIEU_ID: 'M1', SO_LUONG_CAN: 4 },
    ]);
    await db.collection('HINH_ANH_SAN_PHAM').insertMany([
      { SAN_PHAM_ID: 'P1', URL: 'secondary', HINH_ANH_ID: 'A', LA_ANH_CHINH: false },
      { SAN_PHAM_ID: 'P1', URL: 'primary', HINH_ANH_ID: 'B', LA_ANH_CHINH: true },
    ]);
    const map = await getActiveBomMap(['P1', 'P2']);
    for (const id of ['P1', 'P2']) assert.deepEqual(map.get(id), (await getActiveBom(id)).lines);
    const read = async () => {
      let result: any, status = 0;
      await getAllProducts({} as any, { status(code: number) { status = code; return this; }, json(data: any) { result = data; } } as any);
      assert.equal(status, 200);
      return result;
    };
    const [a, b] = await Promise.all([read(), read()]);
    assert.deepEqual(a, b);
    assert.equal(a[0].HINH_ANH, 'primary');
    assert.equal(a[0].SO_LUONG, 6);
    assert.equal(a[1].SO_LUONG, 4);
    await db.collection(COLLECTIONS.material).updateOne({ NGUYEN_VAT_LIEU_ID: 'M1' }, { $set: { TON_THUC: 2 } });
    assert.equal((await read())[0].SO_LUONG, 2);
  } finally { await db.dropDatabase(); await (await mongo.getMongoClient()).close(); }
});
