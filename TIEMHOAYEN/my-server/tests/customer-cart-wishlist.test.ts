import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';

test('cart and wishlist persist in MongoDB, reload on new login, and stay isolated between customers', { skip: !process.env.TEST_MONGO_URI }, async () => {
  if (!/^mongodb:\/\/127\.0\.0\.1:/.test(process.env.TEST_MONGO_URI!)) throw Error('Local DB required');
  process.env.MONGO_URI = process.env.TEST_MONGO_URI;
  process.env.MONGO_DATABASE = `CART_WISHLIST_${randomUUID().replaceAll('-', '')}_LOCAL_TEST`;
  const mongo = await import('../mongo.js');
  const { hashPassword } = await import('../utils/passwordHash.js');
  const customerRoutes = (await import('../routes/customer.js')).default;
  const cartRoutes = (await import('../routes/cart.js')).default;
  const { checkProductAvailability } = await import('../services/inventory/availability.service.js');
  const db = await mongo.getDb();
  const app = express(); app.use(express.json());
  app.use('/api/customers', customerRoutes); app.use('/api/cart', cartRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const call = async (path: string, token = '', method = 'GET', body?: any) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-order-access': token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() as any };
  };
  const password = 'Local-test-only-384!';
  try {
    const hash = await hashPassword(password);
    await db.collection('KHACH_HANG').insertMany(['A', 'B'].map((id, i) => ({ KHACH_HANG_ID: `KH_${id}`, SDT: `090000000${i + 1}`, MAT_KHAU: hash, TRANG_THAI: 'Hoạt động' })));
    await db.collection('SAN_PHAM').insertOne({ SAN_PHAM_ID: 'SP_TEST', TEN_SAN_PHAM: 'Test Flower', GIA: 100000, TRANG_THAI: 'Đang bán', TON_THANH_PHAM: 20 });
    await assert.rejects(checkProductAvailability('SP_TEST', 1, new Date(Date.now() - 60000)), /Ngày giờ giao/);
    await assert.rejects(checkProductAvailability('SP_TEST', 1, new Date(Date.now() + 30 * 60000)), /ít nhất 1 giờ/);
    const login = async (phone: string) => {
      const r = await call('/customers/login', '', 'POST', { SDT: phone, MAT_KHAU: password });
      assert.equal(r.status, 200); return r.data.token as string;
    };
    const a = await login('0900000001'), b = await login('0900000002');
    assert.equal((await call('/cart/add', a, 'POST', { customerId: 'KH_A', productId: 'SP_TEST', quantity: 2 })).status, 200);
    assert.equal((await call('/customers/KH_A/wishlist/SP_TEST', a, 'POST', {})).status, 200);
    assert.equal((await call('/customers/KH_A/wishlist/SP_TEST', a, 'POST', {})).status, 200);
    const cart = await db.collection('GIO_HANG').findOne({ KHACH_HANG_ID: 'KH_A' });
    assert.ok(cart?.GIO_HANG_ID);
    assert.equal((await db.collection('GIO_HANG_CHI_TIET').findOne({ GIO_HANG_ID: cart!.GIO_HANG_ID }))?.SO_LUONG, 2);
    assert.equal(await db.collection('YEU_THICH').countDocuments({ KHACH_HANG_ID: 'KH_A', SAN_PHAM_ID: 'SP_TEST' }), 1);
    const fresh = await login('0900000001');
    assert.equal((await call('/cart/customer/KH_A', fresh)).data.items[0].SO_LUONG, 2);
    assert.equal((await call('/customers/KH_A/wishlist', fresh)).data.items[0].SAN_PHAM_ID, 'SP_TEST');
    assert.equal((await call('/cart/customer/KH_B', b)).data.items.length, 0);
    assert.equal((await call('/customers/KH_B/wishlist', b)).data.total, 0);
    assert.equal((await call('/cart/customer/KH_A', b)).status, 403);
    assert.equal((await call('/customers/KH_A/wishlist', b)).status, 403);
    assert.equal((await call('/cart/customer/KH_A')).status, 401);
    // Dòng giỏ hàng từ schema cũ chưa có LINE_KEY vẫn phải cập nhật được khi
    // frontend mới gửi lineKey suy ra từ SAN_PHAM_ID.
    await db.collection('GIO_HANG_CHI_TIET').updateOne(
      { GIO_HANG_ID: cart!.GIO_HANG_ID, SAN_PHAM_ID: 'SP_TEST' },
      { $unset: { LINE_KEY: '' } },
    );
    const shortageUpdate = await call('/cart/update', fresh, 'PUT', { customerId: 'KH_A', productId: 'SP_TEST', lineKey: 'SP_TEST', quantity: 25 });
    assert.equal(shortageUpdate.status, 200);
    assert.equal(shortageUpdate.data.availability?.decision, 'need_review');
    assert.equal((await call('/cart/customer/KH_A', fresh)).data.items[0].SO_LUONG, 25);
    assert.equal((await call('/cart/remove', fresh, 'DELETE', { customerId: 'KH_A', productId: 'SP_TEST', lineKey: 'SP_TEST' })).status, 200);
    assert.equal((await call('/customers/KH_A/wishlist/SP_TEST', fresh, 'DELETE')).status, 200);
    assert.equal((await call('/cart/customer/KH_A', fresh)).data.items.length, 0);
    assert.equal((await call('/customers/KH_A/wishlist', fresh)).data.total, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await db.dropDatabase(); await (await mongo.getMongoClient()).close(); }
});
