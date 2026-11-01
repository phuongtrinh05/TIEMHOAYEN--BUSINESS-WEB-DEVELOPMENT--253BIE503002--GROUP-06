import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const uri = process.env.TEST_MONGO_URI;

if (!uri) {
  test('order review integration requires TEST_MONGO_URI (isolated replica set)', { skip: true }, () => {});
} else {
  process.env.MONGO_URI = uri;
  process.env.MONGO_DATABASE = `TIEM_HOA_YEN_REVIEW_TEST_${randomUUID().replaceAll('-', '')}`;

  let mongo: typeof import('../mongo.js');
  let listener: any;
  let base = '';
  let accessToken = '';

  before(async () => {
    mongo = await import('../mongo.js');
    const db = await mongo.getDb();
    for (const name of [
      'DANH_GIA',
      'DANH_GIA_HINH_ANH',
      'DON_HANG',
      'DON_HANG_CHI_TIET',
      'HINH_ANH_SAN_PHAM',
      'KHACH_HANG',
      'SAN_PHAM',
      'XAC_THUC_TRA_CUU_DON',
    ]) {
      await db.createCollection(name);
    }

    accessToken = `oa_${randomBytes(32).toString('hex')}`;
    await (await mongo.getCollection<any>('XAC_THUC_TRA_CUU_DON')).insertOne({
      _id: createHash('sha256').update(accessToken).digest('hex'),
      kind: 'lookup',
      authType: 'member',
      customerId: 'REVIEW_MEMBER',
      phone: '0901234567',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await (await mongo.getCollection<any>('KHACH_HANG')).insertOne({
      KHACH_HANG_ID: 'REVIEW_MEMBER',
      TEN: 'Review Member',
    });
    await (await mongo.getCollection<any>('DON_HANG')).insertMany([
      {
        DON_HANG_ID: 'REVIEW_ORDER_A',
        KHACH_HANG_ID: 'REVIEW_MEMBER',
        NGAY_TAO: new Date(),
        TONG_TIEN: 300000,
        TRANG_THAI: 'Giao hàng thành công',
      },
      {
        DON_HANG_ID: 'REVIEW_ORDER_B',
        KHACH_HANG_ID: 'REVIEW_MEMBER',
        NGAY_TAO: new Date(),
        TONG_TIEN: 300000,
        TRANG_THAI: 'Giao hàng thành công',
      },
    ]);

    const products = ['SP_REVIEW_A1', 'SP_REVIEW_A2', 'SP_REVIEW_B1', 'SP_REVIEW_B2'];
    await (await mongo.getCollection<any>('SAN_PHAM')).insertMany(products.map((id) => ({
      SAN_PHAM_ID: id,
      TEN_SAN_PHAM: id,
      GIA: 150000,
      TRANG_THAI: 'Đang bán',
      TON_THANH_PHAM: 10,
    })));
    await (await mongo.getCollection<any>('DON_HANG_CHI_TIET')).insertMany([
      { DON_HANG_ID: 'REVIEW_ORDER_A', SAN_PHAM_ID: 'SP_REVIEW_A1', SO_LUONG: 1, GIA: 150000 },
      { DON_HANG_ID: 'REVIEW_ORDER_A', SAN_PHAM_ID: 'SP_REVIEW_A2', SO_LUONG: 1, GIA: 150000 },
      { DON_HANG_ID: 'REVIEW_ORDER_B', SAN_PHAM_ID: 'SP_REVIEW_B1', SO_LUONG: 1, GIA: 150000 },
      { DON_HANG_ID: 'REVIEW_ORDER_B', SAN_PHAM_ID: 'SP_REVIEW_B2', SO_LUONG: 1, GIA: 150000 },
    ]);
    await (await mongo.getCollection<any>('DANH_GIA')).insertOne({
      _id: 'OLD_REVIEW_B1',
      DANH_GIA_ID: 'OLD_REVIEW_B1',
      DON_HANG_ID: 'REVIEW_ORDER_B',
      SAN_PHAM_ID: 'SP_REVIEW_B1',
      KHACH_HANG_ID: 'REVIEW_MEMBER',
      AN_DANH: false,
      SO_SAO: 1,
      NOI_DUNG: 'Old individual review',
      NGAY_DANH_GIA: new Date(0),
      PHAN_HOI_SHOP: 'Old reply',
    });
    await (await mongo.getCollection<any>('DANH_GIA_HINH_ANH')).insertOne({
      _id: 'OLD_REVIEW_B1:1',
      DANH_GIA_HINH_ANH_ID: 'OLD_REVIEW_B1:1',
      DANH_GIA_ID: 'OLD_REVIEW_B1',
      URL: 'https://example.test/old-review.jpg',
    });

    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/reviews', (await import('../routes/review.js')).default);
    listener = await new Promise<any>((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
    base = `http://127.0.0.1:${listener.address().port}/api/reviews`;
  });

  after(async () => {
    if (listener) await new Promise<void>((resolve, reject) => listener.close((error: any) => error ? reject(error) : resolve()));
    if (mongo) {
      await (await mongo.getDb()).dropDatabase();
      await (await mongo.getMongoClient()).close();
    }
  });

  const submitOrderReview = (orderId: string) => {
    const body = new FormData();
    body.append('orderId', orderId);
    body.append('productIds', JSON.stringify(
      orderId === 'REVIEW_ORDER_A'
        ? ['SP_REVIEW_A1', 'SP_REVIEW_A2']
        : ['SP_REVIEW_B1', 'SP_REVIEW_B2'],
    ));
    body.append('hideReviewer', 'false');
    body.append('rating', '4');
    body.append('content', `Shared review for ${orderId}`);
    return fetch(base, {
      method: 'POST',
      headers: { 'x-order-access': accessToken },
      body,
    });
  };

  test('one order review is applied to every product and upgrades partial legacy reviews', async () => {
    const incompleteBody = new FormData();
    incompleteBody.append('orderId', 'REVIEW_ORDER_A');
    incompleteBody.append('productIds', JSON.stringify(['SP_REVIEW_A1']));
    incompleteBody.append('rating', '4');
    incompleteBody.append('content', 'Incomplete review');
    const incompleteResponse = await fetch(base, {
      method: 'POST',
      headers: { 'x-order-access': accessToken },
      body: incompleteBody,
    });
    assert.equal(incompleteResponse.status, 400);
    assert.equal(await (await mongo.getCollection<any>('DANH_GIA')).countDocuments({
      DON_HANG_ID: 'REVIEW_ORDER_A',
    }), 0);

    const firstResponse = await submitOrderReview('REVIEW_ORDER_A');
    assert.equal(firstResponse.status, 201);
    const firstResult = await firstResponse.json() as any;
    assert.equal(firstResult.reviews.length, 2);

    const reviewCollection = await mongo.getCollection<any>('DANH_GIA');
    const firstReviews = await reviewCollection.find({ DON_HANG_ID: 'REVIEW_ORDER_A' }).toArray();
    assert.equal(firstReviews.length, 2);
    assert.equal(new Set(firstReviews.map((review) => review.DANH_GIA_ID)).size, 2);
    assert.ok(firstReviews.every((review) => review.SO_SAO === 4 && review.NOI_DUNG === 'Shared review for REVIEW_ORDER_A'));

    const partialResponse = await submitOrderReview('REVIEW_ORDER_B');
    assert.equal(partialResponse.status, 201);
    const partialReviews = await reviewCollection.find({ DON_HANG_ID: 'REVIEW_ORDER_B' }).toArray();
    assert.equal(partialReviews.length, 2);
    assert.ok(partialReviews.every((review) => review.SO_SAO === 4 && review.NOI_DUNG === 'Shared review for REVIEW_ORDER_B'));
    assert.equal(partialReviews.find((review) => review.SAN_PHAM_ID === 'SP_REVIEW_B1')?.PHAN_HOI_SHOP, null);
    assert.equal(await (await mongo.getCollection<any>('DANH_GIA_HINH_ANH')).countDocuments({ DANH_GIA_ID: 'OLD_REVIEW_B1' }), 0);

    const duplicateResponse = await submitOrderReview('REVIEW_ORDER_A');
    assert.equal(duplicateResponse.status, 409);

    const productResponse = await fetch(`${base}/product/SP_REVIEW_A2`);
    const productResult = await productResponse.json() as any;
    assert.equal(productResult.reviews.length, 1);
    assert.equal(productResult.reviews[0].rating, 4);
    assert.equal(productResult.reviews[0].content, 'Shared review for REVIEW_ORDER_A');

    const ordersResponse = await fetch(`${base}/customer/REVIEW_MEMBER/reviewable-orders`, {
      headers: { 'x-order-access': accessToken },
    });
    const ordersResult = await ordersResponse.json() as any;
    assert.ok(ordersResult.orders.every((order: any) => order.reviewed && order.items.every((item: any) => item.reviewed)));
  });
}
