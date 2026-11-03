import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

const uri = process.env.TEST_MONGO_URI;
if (!uri) {
  // Pure contract tests use injected catalog rows and never open a database connection.
  process.env.MONGO_URI = 'mongodb://127.0.0.1:1';
  process.env.MONGO_DATABASE = 'TIEM_HOA_YEN_UNIT_ONLY';
  test('checkout integration requires TEST_MONGO_URI (isolated replica set)', { skip: true }, () => {});
} else {
  process.env.MONGO_URI = uri;
  process.env.INVENTORY_SAME_DAY_CUTOFF = '23:59';
  process.env.MONGO_DATABASE = `TIEM_HOA_YEN_CHECKOUT_TEST_${randomUUID().replaceAll('-', '')}`;
  let mongo: typeof import('../mongo.js');
  let service: typeof import('../services/order-request.service.js');
  let stock: typeof import('../services/inventory/stock.service.js');
  const payload = { sender: { name: 'Người đặt', phone: '0901234567' }, receiver: { name: 'Người nhận', phone: '0912345678', address: '1 Đường A, Quận 1, Thành phố Hồ Chí Minh', districtName: 'Quận 1', provinceName: 'Thành phố Hồ Chí Minh' }, delivery: { date: '2026-11-01', time: '10:00' } };
  const verifiedToken = async (phone = payload.sender.phone) => {
    const token = 'oa_' + randomBytes(32).toString('hex');
    await (await mongo.getCollection<any>('XAC_THUC_TRA_CUU_DON')).insertOne({ _id: createHash('sha256').update(token).digest('hex'), kind: 'lookup', phone, expiresAt: new Date(Date.now()+1800000) });
    return token;
  };
  const checkout = async (items: { productId: string; quantity: number }[], key = randomUUID(), fail = false) => { const result = await service.routeCheckout(key, payload, items, async (session, orderId) => {
    await (await mongo.getCollection<any>('DON_HANG')).insertOne({ _id: orderId, DON_HANG_ID: orderId }, { session });
    if (fail) throw new Error('injected persistence failure');
    await (await mongo.getCollection<any>('THANH_TOAN')).insertOne({ _id: orderId, DON_HANG_ID: orderId }, { session });
    return { orderId };
  }); if (result.kind === 'sales_request') result.accessToken = await verifiedToken(); return result; };
  before(async () => {
    mongo = await import('../mongo.js');
    service = await import('../services/order-request.service.js');
    stock = await import('../services/inventory/stock.service.js');
    await (await mongo.getDb()).createCollection('PHIEN_DAT_HANG');
    await (await mongo.getDb()).createCollection(service.REQUESTS);
    await (await mongo.getDb()).createCollection('DON_HANG');
    await (await mongo.getDb()).createCollection('THANH_TOAN');
    await (await mongo.getCollection<any>('SAN_PHAM')).insertMany(['LAST', 'MIX', 'FAIL', 'EXPIRED', 'DUP', 'API', 'PAID', 'LATE', 'RETRY', 'ALT', 'RACE', 'REQUOTE', 'BOMCHANGE', 'HTTP', 'PHONE'].map(id => ({ _id: id, SAN_PHAM_ID: `SP_${id}`, TEN_SAN_PHAM: id, GIA: 400000, TON_THANH_PHAM: 1, TP_DANG_GIU: 0 })));
    await (await mongo.getCollection<any>('NGUYEN_VAT_LIEU')).insertMany([
      { NGUYEN_VAT_LIEU_ID: 'ROSE', TEN_NGUYEN_VAT_LIEU: 'Hồng đỏ', GIA_BAN: 10000, TON_THUC: 6, TON_DANG_GIU: 0, TON_KHONG_DAT: 0, NHOM_NVL: 'Phụ kiện', DON_VI_TINH: 'cành' },
      { NGUYEN_VAT_LIEU_ID: 'MIX', TEN_NGUYEN_VAT_LIEU: 'Hoa phối', GIA_BAN: 20000, TON_THUC: 10, TON_DANG_GIU: 0, TON_KHONG_DAT: 0, NHOM_NVL: 'Phụ kiện', DON_VI_TINH: 'cành' },
    ]);
  });
  after(async () => {
    if (mongo) { await (await mongo.getDb()).dropDatabase(); await (await mongo.getMongoClient()).close(); }
  });
  test('two buyers of the final bouquet: one order, one Sales request, no oversell', async () => {
    const outcomes = await Promise.all([checkout([{ productId: 'SP_LAST', quantity: 1 }]), checkout([{ productId: 'SP_LAST', quantity: 1 }])]);
    assert.equal(outcomes.filter(o => o.kind === 'order').length, 1);
    assert.equal(outcomes.filter(o => o.kind === 'sales_request').length, 1);
    const product = await (await mongo.getCollection<any>('SAN_PHAM')).findOne({ SAN_PHAM_ID: 'SP_LAST' });
    assert.equal(product.TON_THANH_PHAM, 1);
    assert.equal(product.TP_DANG_GIU, 1);
    const request = outcomes.find(o => o.kind === 'sales_request')!;
    assert.equal(await (await mongo.getCollection<any>('THANH_TOAN')).countDocuments({ DON_HANG_ID: request.requestId }), 0);
    const receipt = await service.getPublicRequest(request.requestId, request.accessToken);
    assert.equal(receipt.status, service.REQUEST_STATUS.waiting);
    assert.equal((receipt as any).receiver, undefined);
    await assert.rejects(service.getPublicRequest(request.requestId, '0'.repeat(64)));
  });
  test('retries of the same checkout do not reserve/create twice', async () => {
    const key = randomUUID();
    const results = await Promise.all([checkout([{ productId: 'SP_DUP', quantity: 1 }], key), checkout([{ productId: 'SP_DUP', quantity: 1 }], key)]);
    assert.equal(results[0].orderId, results[1].orderId);
    const p = await (await mongo.getCollection<any>('SAN_PHAM')).findOne({ SAN_PHAM_ID: 'SP_DUP' });
    assert.equal(p.TP_DANG_GIU, 1);
    await assert.rejects(service.routeCheckout(key, { ...payload, changed: true }, [], async () => ({})), /nội dung khác/);
  });
  test('partial stock reservation rolls back before a Sales request', async () => {
    const result = await checkout([{ productId: 'SP_MIX', quantity: 1 }, { productId: 'SP_LAST', quantity: 1 }]);
    assert.equal(result.kind, 'sales_request');
    const p = await (await mongo.getCollection<any>('SAN_PHAM')).findOne({ SAN_PHAM_ID: 'SP_MIX' });
    assert.equal(p.TP_DANG_GIU, 0);
  });
  test('order write failure rolls back stock instead of becoming a Sales request', async () => {
    await assert.rejects(checkout([{ productId: 'SP_FAIL', quantity: 1 }], randomUUID(), true), /injected/);
    const p = await (await mongo.getCollection<any>('SAN_PHAM')).findOne({ SAN_PHAM_ID: 'SP_FAIL' });
    assert.equal(p.TP_DANG_GIU, 0);
  });
  test('an abandoned expired payment hold becomes available to a new buyer', async () => {
    const first = await checkout([{ productId: 'SP_EXPIRED', quantity: 1 }]);
    await (await mongo.getCollection<any>('GIU_TON')).updateMany({ DON_HANG_ID: first.orderId }, { $set: { HET_HAN_LUC: new Date(0) } });
    assert.equal((await checkout([{ productId: 'SP_EXPIRED', quantity: 1 }])).kind, 'order');
  });
  test('two Sales claiming a request: only one owner; stale/foreign updates rejected', async () => {
    const result = await checkout([{ productId: 'SP_LAST', quantity: 1 }]);
    const a = { NHAN_VIEN_ID: 'NV_A', TEN: 'Sales A' }, b = { NHAN_VIEN_ID: 'NV_B', TEN: 'Sales B' };
    const results = await Promise.allSettled([service.updateSalesRequest(result.requestId, { action: 'claim', version: 0 }, a), service.updateSalesRequest(result.requestId, { action: 'claim', version: 0 }, b)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const row = (results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
    const owner = row.assignedTo === a.NHAN_VIEN_ID ? a : b;
    const other = owner === a ? b : a;
    await assert.rejects(service.updateSalesRequest(result.requestId, { action: 'reject', version: 1, note: 'No' }, other));
    await service.updateSalesRequest(result.requestId, { action: 'note', version: 1, note: 'Shop đang kiểm tra nguồn hoa.' }, owner);
    assert.equal((await service.getPublicRequest(result.requestId, result.accessToken)).customerMessage, 'Shop đang kiểm tra nguồn hoa.');
    await assert.rejects(service.updateSalesRequest(result.requestId, { action: 'reject', version: 1, note: 'stale' }, owner));
    const closed = await service.updateSalesRequest(result.requestId, { action: 'reject', version: 2, note: 'Không nhập kịp lịch giao.' }, owner);
    assert.equal(closed.status, service.REQUEST_STATUS.rejected);
    assert.equal(closed.history.length, 4);
  });
  const invoke = async (handler: any, body: any, params: any = {}, headers: any = {}) => {
    let code = 200, data: any;
    const response: any = { locals: {}, status(value: number) { code = value; return this; }, json(value: any) { data = value; return this; } };
    await handler({ body, params, headers }, response);
    return { code, data };
  };
  const submit = async (productId: string) => {
    const controller = await import('../controllers/order.js');
    return invoke(controller.createOrder, { ...payload, delivery: { date: new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()), time: '23:59' }, checkoutSessionId: randomUUID(), items: [{ id: productId, qty: 1, price: 100000 }],
      payment: { method: 'bank', methodName: 'Chuyển khoản' }, summary: { subtotal: 100000, total: 100000 }, flags: {} });
  };
  test('real createOrder controller: only A receives payment, B receives persisted Sales request', async () => {
    const results = await Promise.all([submit('SP_API'), submit('SP_API')]);
    assert.deepEqual(results.map(r => r.code), [201, 201]);
    const order = results.find(r => r.data.kind === 'order')!.data;
    const request = results.find(r => r.data.kind === 'sales_request')!.data;
    assert.equal(request.paymentId, undefined);
    assert.equal(await (await mongo.getCollection<any>('THANH_TOAN')).countDocuments({ DON_HANG_ID: order.orderId }), 1);
    assert.equal(await (await mongo.getCollection<any>(service.REQUESTS)).countDocuments({ requestId: request.requestId }), 1);
  });
  test('Admin confirms payment atomically with official stock hold; repeated confirmation adds no hold', async () => {
    const { updateAdminOrderPaymentStatus } = await import('../controllers/admin.js');
    const { data: order } = await submit('SP_PAID');
    const first = await invoke(updateAdminOrderPaymentStatus, { status: 'Thành công', amount: 400000 }, { orderId: order.orderId });
    assert.equal(first.code, 200);
    assert.equal((await (await mongo.getCollection<any>('GIU_TON')).findOne({ DON_HANG_ID: order.orderId })).TRANG_THAI, 'CHINH_THUC');
    assert.equal((await invoke(updateAdminOrderPaymentStatus, { status: 'Thành công', amount: 400000 }, { orderId: order.orderId })).code, 200);
    assert.equal((await (await mongo.getCollection<any>('SAN_PHAM')).findOne({ SAN_PHAM_ID: 'SP_PAID' })).TP_DANG_GIU, 1);
  });
  test('late payment cannot revive an expired hold or steal stock from another buyer', async () => {
    const { updateAdminOrderPaymentStatus } = await import('../controllers/admin.js');
    const { data: first } = await submit('SP_LATE');
    await (await mongo.getCollection<any>('GIU_TON')).updateMany({ DON_HANG_ID: first.orderId }, { $set: { HET_HAN_LUC: new Date(0) } });
    const { data: second } = await submit('SP_LATE');
    assert.equal(second.kind, 'order');
    const late = await invoke(updateAdminOrderPaymentStatus, { status: 'Thành công', amount: 400000 }, { orderId: first.orderId });
    assert.equal(late.code, 410);
    assert.equal((await (await mongo.getCollection<any>('THANH_TOAN')).findOne({ DON_HANG_ID: first.orderId })).TRANG_THAI_THANH_TOAN, 'Chờ thanh toán');
  });
  test('payment retry rechecks stock; retry after expiry fails if another buyer holds it', async () => {
    const { retryOrderPayment, expireOrderPayment } = await import('../controllers/order.js');
    const { data: first } = await submit('SP_RETRY');
    await (await mongo.getCollection<any>('THANH_TOAN')).updateMany({ DON_HANG_ID: first.orderId }, { $set: { NGAY_THANH_TOAN: new Date(0) } });
    await invoke(expireOrderPayment, {}, { orderId: first.orderId });
    const retry = await invoke(retryOrderPayment, {}, { orderId: first.orderId });
    assert.equal(retry.code, 200);
    await (await mongo.getCollection<any>('THANH_TOAN')).updateMany({ DON_HANG_ID: first.orderId }, { $set: { NGAY_THANH_TOAN: new Date(0) } });
    await invoke(expireOrderPayment, {}, { orderId: first.orderId });
    assert.equal((await submit('SP_RETRY')).data.kind, 'order');
    assert.equal((await invoke(retryOrderPayment, {}, { orderId: first.orderId })).code, 409);
  });
  // Same naming/role shape as the live NHAN_VIEN collection (HO_TEN, not TEN).
  const sales = { NHAN_VIEN_ID: 'NV_SALES', HO_TEN: 'Tư vấn viên' };
  const freshRequest = async () => {
    const receipt = await service.routeCheckout(randomUUID(), { ...payload, summary: { total: 300000 } }, [{ productId: 'SP_LAST', quantity: 1 }], async () => ({}));
    receipt.accessToken = await verifiedToken();
    await service.updateSalesRequest(receipt.requestId, { action: 'claim', version: 0 }, sales);
    return receipt;
  };
  const requestRow = async (id: string) => (await mongo.getCollection<any>(service.REQUESTS)).findOne({ _id: id });
  const offer = (id: string, version: number, productId = 'SP_ALT') => ({ version, items: [{ id: productId, qty: 1 }],
    date: '2099-11-01', time: '15:00', shippingFee: 0, paymentMethod: 'cod', depositAmount: 100000, note: 'Mẫu mới giá 400.000đ, cọc 100.000đ, còn lại khi nhận hoa.' });
  test('Sales offers 400k for original 300k; no payment before consent; convert exactly once with agreed snapshot', async () => {
    const flow = await import('../services/sales-proposal.service.js');
    const r = await freshRequest();
    const q = await flow.propose(r.requestId, offer(r.requestId, 1), sales);
    assert.equal(q.summary.total, 400000);
    assert.equal((await service.getPublicRequest(r.requestId, r.accessToken)).originalTotal, 300000);
    await assert.rejects(flow.convertProposal(r.requestId, { quoteId: q.id, version: 2 }, sales), /chưa đồng ý/);
    await flow.respondToProposal(r.requestId, r.accessToken, { action: 'accept', quoteId: q.id });
    const row = await requestRow(r.requestId);
    const results = await Promise.all([flow.convertProposal(r.requestId, { quoteId: q.id, version: row.version }, sales), flow.convertProposal(r.requestId, { quoteId: q.id, version: row.version }, sales)]);
    assert.equal(results[0].orderId, results[1].orderId);
    assert.equal(results[0].paymentAmount, 100000);
    const order = await (await mongo.getCollection<any>('DON_HANG')).findOne({ DON_HANG_ID: results[0].orderId });
    assert.equal(order.TONG_TIEN, 400000);
    assert.equal(order.YEU_CAU_DAT_HANG_ID, r.requestId);
    assert.equal(order.PHUONG_AN_SNAPSHOT.id, q.id);
    const receipt = await service.getPublicRequest(r.requestId, r.accessToken);
    assert.equal(receipt.checkoutData.items[0].name, 'ALT');
    assert.equal(receipt.status, service.REQUEST_STATUS.pendingPayment);
  });
  test('revised proposal revokes old consent; old acceptance cannot be replayed', async () => {
    const flow = await import('../services/sales-proposal.service.js');
    const r = await freshRequest();
    const q1 = await flow.propose(r.requestId, offer(r.requestId, 1, 'SP_REQUOTE'), sales);
    await flow.respondToProposal(r.requestId, r.accessToken, { action: 'accept', quoteId: q1.id });
    const row = await requestRow(r.requestId);
    const q2 = await flow.propose(r.requestId, { ...offer(r.requestId, row.version, 'SP_REQUOTE'), shippingFee: 20000 }, sales);
    assert.equal(q2.summary.total, 420000);
    await assert.rejects(flow.respondToProposal(r.requestId, r.accessToken, { action: 'accept', quoteId: q1.id }), /thay đổi/);
    await assert.rejects(flow.convertProposal(r.requestId, { quoteId: q1.id, version: row.version + 1 }, sales));
    assert.equal((await requestRow(r.requestId)).acceptedQuoteId, null);
    await flow.respondToProposal(r.requestId, r.accessToken, { action: 'decline', quoteId: q2.id });
    assert.equal((await requestRow(r.requestId)).status, service.REQUEST_STATUS.processing);
  });
  test('catalog stock lost after consent: conversion fails, leaves request and payment untouched', async () => {
    const flow = await import('../services/sales-proposal.service.js');
    const r = await freshRequest();
    const q = await flow.propose(r.requestId, offer(r.requestId, 1, 'SP_RACE'), sales);
    await flow.respondToProposal(r.requestId, r.accessToken, { action: 'accept', quoteId: q.id });
    await checkout([{ productId: 'SP_RACE', quantity: 1 }]);
    const row = await requestRow(r.requestId);
    await assert.rejects(flow.convertProposal(r.requestId, { quoteId: q.id, version: row.version }, sales), /Không đủ hàng/);
    assert.equal((await requestRow(r.requestId)).orderId, undefined);
    assert.equal((await requestRow(r.requestId)).status, service.REQUEST_STATUS.accepted);
    await service.updateSalesRequest(r.requestId, { action: 'reject', version: row.version, note: 'Không còn nguồn hoa kịp lịch, khách dừng yêu cầu.' }, sales);
    await assert.rejects(flow.convertProposal(r.requestId, { quoteId: q.id, version: row.version + 1 }, sales));
  });
  test('custom six roses plus other flowers: server prices materials, preserves picture and reserves exact dynamic BOM', async () => {
    const flow = await import('../services/sales-proposal.service.js');
    const r = await freshRequest();
    const body = { ...offer(r.requestId, 1), items: [{ custom: true, name: '6 hồng phối hoa', qty: 1,
      image: 'https://example.com/hoa-phoi.jpg', imageDescription: 'Ảnh minh họa phương án phối',
      materials: [{ materialId: 'ROSE', quantity: 6 }, { materialId: 'MIX', quantity: 2 }], designFee: 300000, extraFee: 0, price: 1 }] };
    const q = await flow.propose(r.requestId, body, sales);
    assert.equal(q.items[0].price, 400000);
    await flow.respondToProposal(r.requestId, r.accessToken, { action: 'accept', quoteId: q.id });
    const row = await requestRow(r.requestId);
    const order = await flow.convertProposal(r.requestId, { quoteId: q.id, version: row.version }, sales);
    const rose = await (await mongo.getCollection<any>('NGUYEN_VAT_LIEU')).findOne({ NGUYEN_VAT_LIEU_ID: 'ROSE' });
    assert.equal(rose.TON_THUC, 6); assert.equal(rose.TON_DANG_GIU, 6);
    const detail = await (await mongo.getCollection<any>('DON_HANG_CHI_TIET')).findOne({ DON_HANG_ID: order.orderId });
    assert.equal(detail.GIA, 400000); assert.equal(detail.HINH_ANH_SNAPSHOT, body.items[0].image); assert.equal(detail.BOM_SNAPSHOT.materials[0].quantity, 6);
    const { getOrderDetail } = await import('../controllers/order.js');
    const result: any = { data: null, status() { return this; }, json(value: any) { this.data = value; } };
    await getOrderDetail({ params: { orderId: order.orderId }, query: { phone: payload.receiver.phone } } as any, result);
    assert.equal(result.data.products[0].TEN_SAN_PHAM, '6 hồng phối hoa');
    assert.equal(result.data.products[0].HINH_ANH, body.items[0].image);
    // Changing current NVL price never rewrites this order.
    await (await mongo.getCollection<any>('NGUYEN_VAT_LIEU')).updateOne({ NGUYEN_VAT_LIEU_ID: 'ROSE' }, { $set: { GIA_BAN: 99999 } });
    assert.equal((await requestRow(r.requestId)).quote.items[0].price, 400000);
  });
  test('catalog BOM changed after consent requires a new proposal', async () => {
    const flow = await import('../services/sales-proposal.service.js');
    const r = await freshRequest();
    const q = await flow.propose(r.requestId, offer(r.requestId, 1, 'SP_BOMCHANGE'), sales);
    await flow.respondToProposal(r.requestId, r.accessToken, { action: 'accept', quoteId: q.id });
    await (await mongo.getCollection<any>('CONG_THUC_SAN_PHAM')).insertOne({ SAN_PHAM_ID: 'SP_BOMCHANGE', NGUYEN_VAT_LIEU_ID: 'MIX', SO_LUONG_CAN: 3 });
    const row = await requestRow(r.requestId);
    await assert.rejects(flow.convertProposal(r.requestId, { quoteId: q.id, version: row.version }, sales), /Công thức/);
  });
  test('request chat is private, retry-safe, and a chat OK does not count as proposal consent', async () => {
    const flow = await import('../services/sales-proposal.service.js');
    const r = await freshRequest();
    const id = randomUUID();
    await Promise.all([flow.sendMessage(r.requestId, { text: 'OK mẫu này', messageId: id }, { token: r.accessToken }), flow.sendMessage(r.requestId, { text: 'OK mẫu này', messageId: id }, { token: r.accessToken })]);
    await flow.sendMessage(r.requestId, { text: 'Đã gọi tư vấn; vui lòng xác nhận phương án trên website.', channel: 'phone', messageId: randomUUID() }, { employee: sales });
    assert.equal((await flow.messages(r.requestId, { token: r.accessToken })).length, 2);
    const stored = await (await mongo.getCollection<any>('TIN_NHAN_CHAT')).find({ YEU_CAU_ID: r.requestId }).toArray();
    assert.equal(stored.length, 2);
    assert.ok(stored.every(m => m.TIN_NHAN_ID && m.THOI_GIAN_GUI instanceof Date));
    assert.equal(stored.find(m => m.NHAN_VIEN_ID)?.TEN_NGUOI_GUI, sales.HO_TEN);
    const legacy = await import('../controllers/chat.js');
    let legacyResult: any;
    const legacyResponse: any = { status() { return this; }, json(value: any) { legacyResult = value; return this; } };
    await legacy.getGuestChatMessages({ params: { chatId: stored[0].TIN_NHAN_ID } } as any, legacyResponse);
    assert.equal(legacyResult.messages, undefined);
    assert.ok(!(await (await mongo.getDb()).listCollections({}, { nameOnly: true }).toArray()).some(c => c.name === 'TIN_NHAN_YEU_CAU_DAT_HANG'));
    await assert.rejects(flow.messages(r.requestId, { token: '0'.repeat(64) }));
    await assert.rejects(flow.messages(r.requestId, { employee: { NHAN_VIEN_ID: 'OTHER' } }));
    assert.equal((await requestRow(r.requestId)).acceptedQuoteId, undefined);
    await assert.rejects(flow.sendMessage(r.requestId, { text: 'changed', messageId: id }, { token: r.accessToken }));
    await assert.rejects(flow.propose(r.requestId, offer(r.requestId, 1), { NHAN_VIEN_ID: 'OTHER' }));
  });
  test('HTTP routes: Sales role, customer token, options, proposal, consent and conversion work together', async () => {
    const express = (await import('express')).default;
    const app = express(); app.use(express.json());
    app.use('/api/admin', (await import('../routes/admin.js')).default);
    app.use('/api/orders', (await import('../routes/order.js')).default);
    const server = await new Promise<any>(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    try {
      await (await mongo.getCollection<any>('NHAN_VIEN')).insertOne({ NHAN_VIEN_ID: sales.NHAN_VIEN_ID, VAI_TRO: 'Nhân viên bán hàng', TRANG_THAI: 'Đang làm việc', HO_TEN: sales.HO_TEN });
      const r = await freshRequest();
      const staff = await (await mongo.getCollection<any>('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: sales.NHAN_VIEN_ID });
      const staffSession = await (await import('../services/order-access.service.js')).createStaffAccess(staff);
      const admin = { Authorization: `Bearer ${staffSession.accessToken}`, 'Content-Type': 'application/json' };
      const customer = { 'x-request-token': r.accessToken, 'Content-Type': 'application/json' };
      assert.equal((await fetch(`${base}/admin/order-requests`, { headers: { 'x-admin-role': 'Admin' } })).status, 401);
      const list = await (await fetch(`${base}/admin/order-requests`, { headers: admin })).json() as any;
      assert.equal(list.requests.every((x: any) => !x.tokenHash), true);
      const choices = await (await fetch(`${base}/admin/order-requests/${r.requestId}/options`, { headers: admin })).json() as any;
      assert.ok(choices.products.some((p: any) => p.id === 'SP_HTTP' && p.finished === 1));
      const proposalRes = await fetch(`${base}/admin/order-requests/${r.requestId}/proposal`, { method: 'POST', headers: admin, body: JSON.stringify(offer(r.requestId, 1, 'SP_HTTP')) });
      assert.equal(proposalRes.status, 200);
      const proposal = await proposalRes.json() as any;
      assert.equal((await fetch(`${base}/orders/requests/${r.requestId}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteId: proposal.id, action: 'accept' }) })).status, 401);
      assert.equal((await fetch(`${base}/orders/requests/${r.requestId}/respond`, { method: 'POST', headers: customer, body: JSON.stringify({ quoteId: proposal.id, action: 'accept' }) })).status, 200);
      const row = await requestRow(r.requestId);
      const convert = await fetch(`${base}/admin/order-requests/${r.requestId}/convert`, { method: 'POST', headers: admin, body: JSON.stringify({ quoteId: proposal.id, version: row.version }) });
      assert.equal(convert.status, 200);
      const converted = await convert.json() as any;
      const receipt = await (await fetch(`${base}/orders/requests/${r.requestId}`, { headers: customer })).json() as any;
      assert.equal(receipt.orderResult.orderId, converted.orderId);
      assert.equal(receipt.checkoutData.summary.total, 400000);
      assert.equal((await fetch(base+'/orders/lookup')).status,401);
      assert.equal((await fetch(base+'/orders/'+converted.orderId+'/detail?phone='+payload.sender.phone)).status,401);
      assert.equal((await fetch(base+'/orders/requests/'+r.requestId,{headers:{'x-request-token':'a'.repeat(64)}})).status,401);
      const stranger=await verifiedToken(payload.receiver.phone);
      assert.equal((await fetch(base+'/orders/'+converted.orderId+'/detail',{headers:{'x-order-access':stranger}})).status,404);
      assert.equal((await fetch(base+'/orders/requests/'+r.requestId,{headers:{'x-order-access':stranger}})).status,404);
      const history=await (await fetch(base+'/orders/lookup',{headers:customer})).json() as any;
      assert.ok(history.orders.some((o:any)=>o.DON_HANG_ID===converted.orderId));
      assert.equal((await fetch(base+'/orders/'+converted.orderId+'/payment-status',{headers:{'x-checkout-access':converted.checkoutAccessToken}})).status,200);
      assert.equal((await fetch(base+'/orders/'+converted.orderId+'/detail',{headers:{'x-checkout-access':converted.checkoutAccessToken}})).status,401);
    } finally { await new Promise<void>((resolve, reject) => server.close((error: any) => error ? reject(error) : resolve())); }
  });
  test('urgent and scheduled guidance never promises confirmation or delivery', async () => {
    const { requestWorkflow } = await import('../services/request-workflow.js');
    const now = new Date('2026-10-28T03:00:00Z');
    const row = { status: service.REQUEST_STATUS.processing, delivery: { date: '28/10/2026', time: '11:00' } };
    assert.equal(requestWorkflow(row, now).urgency, 'urgent');
    assert.match(requestWorkflow(row, now).nextAction, /Gọi/);
    assert.equal(requestWorkflow({ ...row, delivery: { date: '2026-10-30', time: '11:00' } }, now).urgency, 'scheduled');
    const overdue = requestWorkflow({ ...row, delivery: { date: '2026-10-27', time: '11:00' } }, now);
    assert.equal(overdue.scheduleExpired, true);
    assert.equal(overdue.isEmergency, false);
    assert.equal(overdue.urgency, 'scheduled');
    assert.equal(overdue.severityRank, 4);
    assert.equal(requestWorkflow({ ...row, delivery: { date: '28/10/2026', time: '10:30' } }, now).severity, 'CRITICAL');
    assert.equal(requestWorkflow({ ...row, delivery: { date: '28/10/2026', time: '12:00' } }, now).priorityLabel, 'Khẩn cấp');
    assert.equal(requestWorkflow({ ...row, status: 'Khách đã đồng ý', delivery: { date: '28/10/2026', time: '12:00' } }, now).priorityLabel, 'Khẩn cấp');
    assert.equal(requestWorkflow({ ...row, delivery: { date: '28/10/2026', time: '05:00' } }, new Date('2026-10-27T19:00:00Z')).priorityLabel, 'Khẩn cấp');
    const bulk = requestWorkflow({ ...row, delivery: { date: '2026-10-30', time: '11:00' }, items: [{ quantity: 6 }, { quantity: 4 }] }, now);
    assert.equal(bulk.severity, 'ATTENTION'); assert.equal(bulk.totalQuantity, 10);
  });
  test('phone consent requires exact quote and readback; unreachable contact is tracked; order uses accepted price', async () => {
    const flow = await import('../services/sales-proposal.service.js'); const r = await freshRequest();
    await flow.recordContact(r.requestId, { version: 1, outcome: 'unreachable', note: 'Chưa nghe máy', followUpAt: '2099-10-31T01:00:00Z' }, sales);
    assert.equal((await service.getPublicRequest(r.requestId, r.accessToken)).workflow.contactStatus, 'unreachable');
    await assert.rejects(flow.recordContact(r.requestId, { version: 1, outcome: 'connected', note: 'Cũ' }, sales));
    const q = await flow.propose(r.requestId, offer(r.requestId, 2, 'SP_PHONE'), sales);
    await assert.rejects(flow.recordContact(r.requestId, { version: 3, outcome: 'agreed', quoteId: q.id, note: 'OK' }, sales));
    await assert.rejects(flow.recordContact(r.requestId, { version: 3, outcome: 'agreed', quoteId: 'old', readBackConfirmed: true, note: 'Đọc lại' }, sales));
    await flow.recordContact(r.requestId, { version: 3, outcome: 'agreed', quoteId: q.id, readBackConfirmed: true, note: 'Khách đồng ý mẫu, tổng 400k, cọc 100k và lịch giao.' }, sales);
    const row = await requestRow(r.requestId); assert.equal(row.acceptance.via, 'phone'); assert.equal(row.acceptance.total, 400000);
    const order = await flow.convertProposal(r.requestId, { version: row.version, quoteId: q.id }, sales);
    assert.equal(order.paymentAmount, 100000);
    await assert.rejects(flow.customerChangeRequest(r.requestId, r.accessToken, { action: 'cancel' }));
    assert.ok((await service.getPublicRequest(r.requestId, r.accessToken)).orderSummary);
  });
  test('customer reschedule revokes consent; quote revision increases; cancellation creates no order', async () => {
    const flow = await import('../services/sales-proposal.service.js'); const r = await freshRequest();
    const q = await flow.propose(r.requestId, offer(r.requestId, 1, 'SP_REQUOTE'), sales);
    await flow.respondToProposal(r.requestId, r.accessToken, { action: 'accept', quoteId: q.id });
    await assert.rejects(flow.customerChangeRequest(r.requestId, '0'.repeat(64), { action: 'cancel' }));
    await assert.rejects(flow.customerChangeRequest(r.requestId, r.accessToken, { action: 'reschedule', date: '2099-02-31', time: '11:00' }));
    await flow.customerChangeRequest(r.requestId, r.accessToken, { action: 'reschedule', date: '2099-11-02', time: '11:00' });
    const row = await requestRow(r.requestId); assert.equal(row.quote, null); assert.equal(row.acceptedQuoteId, null);
    await assert.rejects(flow.convertProposal(r.requestId, { quoteId: q.id, version: row.version }, sales));
    const q2 = await flow.propose(r.requestId, offer(r.requestId, row.version, 'SP_REQUOTE'), sales); assert.equal(q2.revision, q.revision + 1);
    await flow.customerChangeRequest(r.requestId, r.accessToken, { action: 'cancel' });
    assert.equal((await service.getPublicRequest(r.requestId, r.accessToken)).status, service.REQUEST_STATUS.cancelled);
    await assert.rejects(flow.recordContact(r.requestId, { version: (await requestRow(r.requestId)).version, outcome: 'connected', note: 'Tiếp tục' }, sales));
    assert.equal((await requestRow(r.requestId)).orderId, undefined);
  });

  test('urgent request is ranked before pagination, ahead of more than twenty scheduled requests', async () => {
    const col = await mongo.getCollection<any>(service.REQUESTS);
    await col.insertMany(Array.from({length:25}, (_,i)=>({_id:'QUEUE'+i,requestId:'QUEUE'+i,status:service.REQUEST_STATUS.waiting,delivery:{date:'2099-12-31',time:'12:00'},createdAt:new Date(),tokenHash:'private'})));
    await col.insertOne({_id:'URGENT_OLD',requestId:'URGENT_OLD',status:service.REQUEST_STATUS.waiting,delivery:{date:'01/01/2020',time:'12:00'},createdAt:new Date(0),tokenHash:'private'});
    const { listRequests } = await import('../controllers/order-request.js');
    const response:any = { status(){return this;}, json(value:any){this.data=value;} };
    await listRequests({query:{page:'1',status:service.REQUEST_STATUS.waiting}} as any,response);
    assert.equal(response.data.requests[0].requestId,'URGENT_OLD');
    assert.equal(response.data.requests.length,20); assert.equal(response.data.requests[0].tokenHash,undefined);
  });

  test('lookup OTP is single-use, hashed, rate-limited, expires and revokes access', async () => {
    const access = await import('../services/order-access.service.js'); process.env.ORDER_OTP_DELIVERY='console';
    const log=console.info; let code=''; console.info=(line:any)=>{code=String(line).match(/: (\d{6})/)?.[1]||'';};
    try {
      const challenge=await access.requestOrderOtp('+84 900 111 222','test-otp-ip'); assert.ok(code); assert.equal((challenge as any).code,undefined);
      const raw=await (await mongo.getCollection<any>('XAC_THUC_TRA_CUU_DON')).findOne({_id:challenge.challengeId});assert.notEqual(raw.codeHash,code);
      await assert.rejects(access.requestOrderOtp('0900111222','test-otp-ip'),/60 giây/);
      const attempts=await Promise.allSettled([access.verifyOrderOtp(challenge.challengeId,code),access.verifyOrderOtp(challenge.challengeId,code)]);
      assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
      const grant=(attempts.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<any>).value;assert.equal((await access.lookupAccess(grant.accessToken)).phone,'0900111222');
      await access.revokeOrderAccess(grant.accessToken);await assert.rejects(access.lookupAccess(grant.accessToken));
      const wrong=await access.requestOrderOtp('0900111223','test-otp-ip');const correct=code;
      const invalid=correct==='111111'?'222222':'111111';for(let i=0;i<5;i++)await assert.rejects(access.verifyOrderOtp(wrong.challengeId,invalid));
      await assert.rejects(access.verifyOrderOtp(wrong.challengeId,correct));
      const expired=await access.requestOrderOtp('0900111224','test-otp-ip');await (await mongo.getCollection<any>('XAC_THUC_TRA_CUU_DON')).updateOne({_id:expired.challengeId},{$set:{expiresAt:new Date(0)}});await assert.rejects(access.verifyOrderOtp(expired.challengeId,code));
      const replaced=await access.requestOrderOtp('0900111225','test-otp-ip');const oldCode=code;
      await (await mongo.getCollection<any>('XAC_THUC_TRA_CUU_DON')).updateOne({_id:'phone:0900111225'},{$set:{lastSentAt:new Date(0)}});
      await access.requestOrderOtp('0900111225','test-otp-ip');await assert.rejects(access.verifyOrderOtp(replaced.challengeId,oldCode));
    } finally {console.info=log;}
  });
  test('console OTP cannot be enabled in production', async()=>{
    const access=await import('../services/order-access.service.js');const old=process.env.NODE_ENV;process.env.NODE_ENV='production';
    try {await assert.rejects(access.requestOrderOtp('0900111226','test-prod'),/chưa được cấu hình/);} finally { if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old; }
  });

  test('member login opens only account-owned orders and requests without lookup OTP', async()=>{
    const express=(await import('express')).default;const app=express();app.use(express.json());app.use('/api/customers',(await import('../routes/customer.js')).default);app.use('/api/orders',(await import('../routes/order.js')).default);
    const customers=await mongo.getCollection<any>('KHACH_HANG');
    await customers.insertMany([{KHACH_HANG_ID:'MEMBER_A',SDT:'0900555001',MAT_KHAU:'LocalTestOnly!1',TEN:'Member A',TRANG_THAI:'Hoạt động'},{KHACH_HANG_ID:'MEMBER_B',SDT:'0900555002',MAT_KHAU:'LocalTestOnly!2',TEN:'Member B',TRANG_THAI:'Hoạt động'}]);
    await (await mongo.getCollection<any>('DON_HANG')).insertMany([{DON_HANG_ID:'MEMBER_ORDER_A',KHACH_HANG_ID:'MEMBER_A',SDT_NGUOI_DAT:'0900555002',TONG_TIEN:300000},{DON_HANG_ID:'MEMBER_ORDER_B',KHACH_HANG_ID:'MEMBER_B',SDT_NGUOI_DAT:'0900555001',TONG_TIEN:400000}]);
    await (await mongo.getCollection<any>(service.REQUESTS)).insertMany([{_id:'MEMBER_REQ_A',requestId:'MEMBER_REQ_A',customerId:'MEMBER_A',sender:{phone:'0900555002'},status:service.REQUEST_STATUS.waiting},{_id:'MEMBER_REQ_B',requestId:'MEMBER_REQ_B',customerId:'MEMBER_B',sender:{phone:'0900555001'},status:service.REQUEST_STATUS.waiting}]);
    const listener=await new Promise<any>(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});const base='http://127.0.0.1:'+listener.address().port+'/api';
    const post=async(path:string,body:any,headers:any={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    try {
      const otpBefore=await (await mongo.getCollection<any>('XAC_THUC_TRA_CUU_DON')).countDocuments({kind:'otp'});
      assert.equal((await post('/customers/login',{SDT:'0900555001',MAT_KHAU:'wrong'})).status,401);
      const response=await post('/customers/login',{SDT:'0900555001',MAT_KHAU:'LocalTestOnly!1'});assert.equal(response.status,200);const auth=await response.json() as any;
      assert.equal(auth.customer.MAT_KHAU,undefined);assert.equal(auth.orderAccess.authType,'member');
      const headers={'x-order-access':auth.token};const history=await (await fetch(base+'/orders/lookup',{headers})).json() as any;
      assert.deepEqual(history.orders.map((o:any)=>o.DON_HANG_ID),['MEMBER_ORDER_A']);assert.deepEqual(history.requests.map((r:any)=>r.requestId),['MEMBER_REQ_A']);
      assert.equal((await fetch(base+'/orders/requests/MEMBER_REQ_A',{headers})).status,200);
      assert.equal((await fetch(base+'/orders/requests/MEMBER_REQ_B',{headers})).status,404);
      assert.equal((await fetch(base+'/orders/MEMBER_ORDER_B/detail',{headers})).status,404);
      assert.equal((await fetch(base+'/customers/MEMBER_A/orders',{headers})).status,200);assert.equal((await fetch(base+'/customers/MEMBER_B/orders',{headers})).status,404);
      assert.equal((await post('/orders',{customerId:'MEMBER_B'},headers)).status,403);
      assert.equal((await fetch(base+'/orders/lookup',{headers:{'x-customer-id':'MEMBER_A'}})).status,401);
      assert.equal(await (await mongo.getCollection<any>('XAC_THUC_TRA_CUU_DON')).countDocuments({kind:'otp'}),otpBefore);
      await post('/orders/lookup/logout',{},headers);assert.equal((await fetch(base+'/orders/lookup',{headers})).status,401);
      const second=await (await post('/customers/login',{SDT:'0900555001',MAT_KHAU:'LocalTestOnly!1'})).json() as any;
      await customers.updateOne({KHACH_HANG_ID:'MEMBER_A'},{$set:{TRANG_THAI:'Bị khóa'}});
      assert.equal((await fetch(base+'/orders/lookup',{headers:{'x-order-access':second.token}})).status,401);
    } finally {await new Promise<void>((resolve,reject)=>listener.close((e:any)=>e?reject(e):resolve()));}
  });

}

test('verified balance excludes pending/failed and deduplicates receipt references', async () => {
  const { sumVerifiedPayments } = await import('../services/admin-order.service.js');
  assert.equal(sumVerifiedPayments([
    { THANH_TOAN_ID: 'A', MA_GIAO_DICH: 'REF', SO_TIEN: 300000, TRANG_THAI_THANH_TOAN: 'Thành công' },
    { THANH_TOAN_ID: 'B', MA_GIAO_DICH: 'REF', SO_TIEN: 300000, TRANG_THAI_THANH_TOAN: 'Thành công' },
    { THANH_TOAN_ID: 'C', SO_TIEN: 700000, TRANG_THAI_THANH_TOAN: 'Thất bại' },
    { THANH_TOAN_ID: 'D', SO_TIEN: 700000, TRANG_THAI_THANH_TOAN: 'Chờ thanh toán' },
  ]), 300000);
});

test('backend prices catalog, shipping and voucher instead of submitted money', async () => {
  const { priceCheckout } = await import('../services/admin-order.service.js');
  const rows: Record<string, any> = {
    SAN_PHAM: { SAN_PHAM_ID: 'SP1', TEN_SAN_PHAM: 'Hoa hồng', GIA: 400000, GIA_KHUYEN_MAI: 250000 },
    HINH_ANH_SAN_PHAM: { URL: '/sample.jpg' },
    VOUCHER: { VOUCHER_ID: 'V1', LOAI_GIAM_GIA: 'Phần trăm', GIA_TRI_GIAM: 10 },
  };
  const collections: any = async (name: string) => ({
    findOne: async () => rows[name] || null,
    find: () => ({ sort() { return this; }, limit() { return this; }, next: async () => rows[name] || null }),
  });
  const payload = { delivery: { date: '2099-11-01', time: '10:00' }, items: [{ id: 'SP1', qty: 1, price: 1 }], receiver: { address: '1 Đường A, Quận 1, Hồ Chí Minh', districtName: 'Quận 1', provinceName: 'Thành phố Hồ Chí Minh' },
    shippingMethod: 'standard', payment: { method: 'bank' }, voucher: { id: 'V1' }, summary: { total: 0, subtotal: 1, shippingFee: 0, depositAmount: 0 } };
  const quote = await priceCheckout(payload, undefined, collections);
  assert.equal(quote.items[0].price, 250000);
  assert.equal(quote.summary.subtotal, 250000);
  assert.equal(quote.summary.shippingFee, 30000);
  assert.equal(quote.summary.total, 255000);
  assert.equal(quote.items[0].image, '/sample.jpg');
  for (const type of ['Số tiền', 'Tiền mặt']) {
    rows.VOUCHER = { VOUCHER_ID: 'V1', LOAI_GIAM_GIA: type, GIA_TRI_GIAM: 50000 };
    const fixed = await priceCheckout(payload, undefined, collections);
    assert.equal(fixed.summary.productDiscount, 50000);
    assert.equal(fixed.summary.shippingFee, 30000);
    assert.equal(fixed.summary.total, 230000);
  }
  rows.VOUCHER = { VOUCHER_ID: 'V1', LOAI_GIAM_GIA: 'Freeship', GIA_TRI_GIAM: 50000 };
  const shipping = await priceCheckout(payload, undefined, collections);
  assert.equal(shipping.summary.productDiscount, 0);
  assert.equal(shipping.summary.shippingFee, 0);
  rows.SAN_PHAM.GIA_KHUYEN_MAI = 49999;
  const noDeposit = await priceCheckout({ ...payload, voucher: null, payment: { method: 'cod' } }, undefined, collections);
  assert.equal(noDeposit.summary.depositAmount, 0);
  assert.equal(noDeposit.summary.total, 79999);
  rows.SAN_PHAM.GIA_KHUYEN_MAI = 50000;
  const deposit = await priceCheckout({ ...payload, voucher: null, payment: { method: 'cod' } }, undefined, collections);
  assert.equal(deposit.summary.depositAmount, 50000);
  await assert.rejects(priceCheckout({ ...payload, payment: { method: 'unknown' } }, undefined, collections), /không được hỗ trợ/);
  await assert.rejects(priceCheckout({ ...payload, items: [{ id: 'SP1', qty: -1 }] }, undefined, collections), /số lượng/);
  await assert.rejects(priceCheckout({ ...payload, receiver: { address: 'Hà Nội' } }, undefined, collections), /Hồ Chí Minh/);
  rows.SAN_PHAM.TRANG_THAI = 'Đã xóa';
  await assert.rejects(priceCheckout(payload, undefined, collections), /không còn bán/);
});

test('existing Atlas deposit receipts count as money received without treating a pending deposit as paid', async () => {
  const { paymentSucceeded, sumVerifiedPayments } = await import('../services/admin-order.service.js');
  assert.equal(paymentSucceeded('Đã cọc'), true);
  assert.equal(paymentSucceeded('Đang thanh toán'), false);
  assert.equal(paymentSucceeded('\u0010� thanh to�n'), false);
  assert.equal(sumVerifiedPayments([
    { THANH_TOAN_ID: 'LEGACY', MA_GIAO_DICH: 'BANK-LEGACY', SO_TIEN: 100000, TRANG_THAI_THANH_TOAN: 'Đã cọc' },
    { THANH_TOAN_ID: 'PENDING', SO_TIEN: 300000, TRANG_THAI_THANH_TOAN: 'Chờ thanh toán' },
  ]), 100000);
});

test('order state cannot skip preparation or finish with an unpaid balance', async () => {
  const { assertOrderTransition } = await import('../services/admin-order.service.js');
  assert.throws(() => assertOrderTransition({ TRANG_THAI: 'Chờ thanh toán' }, 'Đang giao', 1000000), /bỏ qua/);
  assert.throws(() => assertOrderTransition({ TRANG_THAI: 'Đã đặt hàng thành công', TONG_TIEN: 400000, PHUONG_THUC_THANH_TOAN: 'Chuyển khoản', THOI_DIEM_CHUAN_BI_DU_KIEN: new Date(Date.now()+60000) }, 'Đang chuẩn bị hàng', 100000), /Chưa xác minh/);
  assert.throws(() => assertOrderTransition({ TRANG_THAI: 'Đã giao', TONG_TIEN: 400000, TIEN_COC: 100000, PHUONG_THUC_THANH_TOAN: 'COD' }, 'Hoàn thành', 100000), /số dư/);
});

test('forged Admin role and employee ID cannot replace an authenticated session', async () => {
  const { requireAdminPermission } = await import('../middleware/rolePermission.js');
  const { requireSales } = await import('../controllers/order-request.js');
  for (const middleware of [requireAdminPermission('orders'), requireSales]) {
    let code = 0, continued = false;
    const response: any = { locals: {}, status(value: number) { code = value; return this; }, json() { return this; } };
    await middleware({ headers: { 'x-admin-role': 'Admin', 'x-admin-id': 'NV001' }, method: 'POST' } as any, response, () => { continued = true; });
    assert.equal(code, 401);
    assert.equal(continued, false);
  }
});

test('a verified receipt cannot be repriced, reopened or counted again by retry', async () => {
  const { changeCheckoutPayment } = await import('../services/checkout-payment.service.js');
  const receipt = { THANH_TOAN_ID: 'TT1', DON_HANG_ID: 'D1', SO_TIEN: 300000, MA_GIAO_DICH: 'BANK1', TRANG_THAI_THANH_TOAN: 'Thành công' };
  const collections: any = async (name: string) => ({ findOne: async () => name === 'THANH_TOAN' ? receipt : { DON_HANG_ID: 'D1', TONG_TIEN: 1000000 } });
  const confirmed = await changeCheckoutPayment({} as any, 'TT1', { status: 'Thành công', amount: 300000 }, 'NV1', collections);
  assert.equal(confirmed, receipt);
  await assert.rejects(changeCheckoutPayment({} as any, 'TT1', { status: 'Thành công', amount: 1000000 }, 'NV1', collections), /không được sửa/);
  await assert.rejects(changeCheckoutPayment({} as any, 'TT1', { status: 'Thất bại' }, 'NV1', collections), /đã thu tiền/);
  await assert.rejects(changeCheckoutPayment({} as any, 'TT1', { status: 'Thành công', referenceCode: 'BANK2' }, 'NV1', collections), /đã thu tiền/);
});

test('KH34 phone OTP returns rows for the verified ordering phone regardless of Guest/member origin', async () => {
  const { ownedRequestQuery, ownedOrderQuery } = await import('../services/order-access.service.js');
  assert.deepEqual(ownedRequestQuery({ authType: 'member', customerId: 'KH_A' }), { customerId: 'KH_A' });
  const requestQuery:any = ownedRequestQuery({ phone: '0901234567', authType: 'guest_lookup' });
  const orderQuery:any = await ownedOrderQuery({ phone: '0901234567', authType: 'guest_lookup' });
  assert.equal(requestQuery.customerId, undefined);
  assert.equal(requestQuery['sender.phone'].test('0901234567'), true);
  assert.equal(orderQuery.KHACH_HANG_ID, undefined);
  assert.equal(orderQuery.SDT_NGUOI_DAT.test('0901234567'), true);
  assert.equal(orderQuery.SDT_NGUOI_DAT.test('0901234568'), false);
});

test('delivery validation accepts existing Admin slots and rejects invalid or past dates', async () => {
  const { validateCheckoutDelivery } = await import('../services/admin-order.service.js');
  assert.equal(validateCheckoutDelivery({ date: '01/11/2099', time: '11:00 AM–01:00 PM' }).date, '2099-11-01');
  assert.throws(() => validateCheckoutDelivery({ date: '2099-02-31', time: '10:00' }), /không tồn tại/);
  assert.throws(() => validateCheckoutDelivery({ date: '2000-01-01', time: '10:00' }), /đã qua/);
  assert.throws(() => validateCheckoutDelivery({ date: '2099-01-01', time: '25:00' }), /không hợp lệ/);
  assert.throws(() => validateCheckoutDelivery({ date: '2099-01-01', time: '17:00-08:00' }), /không hợp lệ/);
});

test('same-day stock is not diverted to Sales only because checkout is after the cutoff', async () => {
  const source = await import('../services/inventory/availability.service.js');
  const file = await import('node:fs/promises').then(async fs => fs.readFile((await import('node:path')).resolve(process.cwd(), 'services/inventory/availability.service.ts'), 'utf8'));
  assert.doesNotMatch(file, /vnTimeKey\(now\)\s*>=\s*INVENTORY_CONFIG\.sameDayCutoff/);
  assert.match(file, /if \(sameDay\)[\s\S]*if \(sellable < qty\)/);
  assert.equal(typeof source.checkProductAvailability, 'function');
});

test('same-day reserved perishable stock skips shelf-day review but explicit expiry remains blocked', async () => {
  const file = await import('node:fs/promises').then(async fs => fs.readFile((await import('node:path')).resolve(process.cwd(), 'services/order-request.service.ts'), 'utf8'));
  assert.match(file, /if \(future && !product && item\.NHOM_NVL === 'DE_HU'/);
  assert.match(file, /if \(expires && \(!Number\.isFinite\(expires\.getTime\(\)\) \|\| expires <= now \|\| expires < when\)\)/);
});


test('Stage 3 derives permitted actions from payment, preparation and refund-request state', async () => {
  const { allowedOrderStatuses, assertOrderTransition } = await import('../services/admin-order.service.js');
  assert.deepEqual(allowedOrderStatuses({ TRANG_THAI: 'Chờ thanh toán', TONG_TIEN: 100000 }, 0), ['Đã hủy']);
  const order = { TRANG_THAI: 'Đã đặt hàng thành công', PHUONG_THUC_THANH_TOAN: 'COD', TIEN_COC: 0, TONG_TIEN: 40000, THOI_DIEM_CHUAN_BI_DU_KIEN: new Date(Date.now()+60000) };
  assert.equal(allowedOrderStatuses(order, 0).includes('Đang chuẩn bị hàng'), false); // command riêng để xuất kho đúng một lần
  assert.doesNotThrow(() => assertOrderTransition(order, 'Đang chuẩn bị hàng', 0));
  assert.equal(allowedOrderStatuses(order, 0).includes('Đang giao'), false);
  assert.deepEqual(allowedOrderStatuses({TRANG_THAI:'Yêu cầu hoàn tiền/trả hàng'}, 0), ['Từ chối hoàn tiền/trả hàng']);
  assert.throws(() => assertOrderTransition({TRANG_THAI:'Yêu cầu hoàn tiền/trả hàng'}, 'Đã hoàn tiền', 100000), /Hậu mãi/);
});

test('Stage 3 staff token resolves a verified employee and is invalidated by password changes or lock', async () => {
  const { staffAccess } = await import('../services/order-access.service.js');
  const token = 'sa_' + 'a'.repeat(64);
  const employee: any = { NHAN_VIEN_ID:'NV_SAFE', VAI_TRO:'Admin', MAT_KHAU:'a-hashed-credential', TRANG_THAI:'Hoạt động' };
  const session = { employeeId:employee.NHAN_VIEN_ID, credentialHash:createHash('sha256').update(employee.MAT_KHAU).digest('hex') };
  const collections: any = async (name: string) => ({findOne:async (query: any) => {
    if (name === 'XAC_THUC_TRA_CUU_DON') { assert.equal(query.kind,'staff'); assert.equal(query._id,createHash('sha256').update(token).digest('hex')); return session; }
    return employee;
  }});
  assert.equal((await staffAccess(token, collections)).NHAN_VIEN_ID, 'NV_SAFE');
  employee.MAT_KHAU = 'changed'; await assert.rejects(staffAccess(token, collections), /không còn hiệu lực/);
  employee.MAT_KHAU = 'a-hashed-credential'; employee.TRANG_THAI='Khóa'; await assert.rejects(staffAccess(token, collections), /không còn hiệu lực/);
  await assert.rejects(staffAccess('forged-token', collections), /đăng nhập/);
});

test('Stage 3 rejects a pending receipt that exceeds the remaining deposit obligation', async () => {
  const { changeCheckoutPayment } = await import('../services/checkout-payment.service.js');
  let locks = 0;
  const receipt = {THANH_TOAN_ID:'P',DON_HANG_ID:'O',SO_TIEN:400000,MA_GIAO_DICH:'R',TRANG_THAI_THANH_TOAN:'Chờ thanh toán'};
  const order = {DON_HANG_ID:'O',TONG_TIEN:400000,TIEN_COC:100000,PHUONG_THUC_THANH_TOAN:'COD',TRANG_THAI:'Chờ thanh toán'};
  const collections: any = async (name: string) => ({ findOne: async () => name === 'THANH_TOAN' ? receipt : order,
    updateOne: async () => { locks++; return {matchedCount:1}; }, find: () => ({toArray:async () => []}) });
  await assert.rejects(changeCheckoutPayment({} as any,'P',{status:'Thành công',amount:400000},'NV_SAFE',collections), /nghĩa vụ còn lại/);
  assert.equal(locks,1);
});


test('Stage 3 payment status endpoint cannot turn a refund record into a receipt', async () => {
  const { changeCheckoutPayment } = await import('../services/checkout-payment.service.js');
  const collections: any = async () => ({ findOne: async () => ({ THANH_TOAN_ID:'REFUND',LOAI_GIAO_DICH:'HOAN_TIEN' }) });
  await assert.rejects(changeCheckoutPayment({} as any, 'REFUND', {status:'Thành công'}, 'NV_SAFE', collections), /hồ sơ hậu mãi/);
});


test('Stage 4 after-sales validates affected lines, evidence and actual refundable balance', async () => {
 const {afterSalesInput,refundableAmount}=await import('../services/admin-order.service.js');
 const details=[{SAN_PHAM_ID:'SP1',SO_LUONG:2}];
 assert.equal(afterSalesInput({type:'exchange',reason:'Giao sai mẫu',evidence:['https://example.com/proof.jpg']},details).items[0].quantity,2);
 assert.throws(()=>afterSalesInput({type:'refund',reason:'Lỗi shop',items:[{productId:'OTHER',quantity:1}]},details),/không thuộc đơn/);
 assert.throws(()=>afterSalesInput({type:'refund',reason:'Lỗi shop',evidence:['javascript:alert(1)']},details),/bằng chứng/);
 assert.throws(()=>afterSalesInput({type:'cancel',reason:'Đổi ý'},details),/trả hàng/);
 assert.equal(refundableAmount([{THANH_TOAN_ID:'A',SO_TIEN:100000,TRANG_THAI_THANH_TOAN:'Đã cọc'},{THANH_TOAN_ID:'B',SO_TIEN:30000,LOAI_GIAO_DICH:'HOAN_TIEN',TRANG_THAI_THANH_TOAN:'Thành công'},{THANH_TOAN_ID:'C',SO_TIEN:900000,TRANG_THAI_THANH_TOAN:'Chờ thanh toán'}]),70000);
});

test('Stage 4 order-scoped Guest lookup cannot select another order or Sales requests', async () => {
 const {ownedOrderQuery,ownedRequestQuery}=await import('../services/order-access.service.js');
 const access={phone:'0901234567',orderId:'YEN_ALLOWED'};
 assert.equal((await ownedOrderQuery(access)).DON_HANG_ID,'YEN_ALLOWED');
 assert.equal(ownedRequestQuery(access)._id,'__ORDER_ONLY__');
});

test('KH34 exact Sales request scope uses request code and verified ordering phone even when request has an account', async () => {
 const {ownedRequestQuery}=await import('../services/order-access.service.js');
 const query:any=ownedRequestQuery({phone:'0786941361',requestId:'YC794A4ACFA8C1B43C',authType:'guest_lookup'});
 assert.equal(query.requestId,'YC794A4ACFA8C1B43C');
 assert.equal(query.customerId,undefined);
 assert.equal(query['sender.phone'].test('0786941361'),true);
 assert.equal(query['sender.phone'].test('0786941362'),false);
});

test('KH34 phone lookup token may manage only an owned Sales request route', async () => {
  const { requireLookupAction } = await import('../controllers/order-access.js');
  const invoke = async (locals: any) => {
    let nextCalled = false, status = 200, payload: any;
    const req: any = { headers: {}, params: locals.params || {} };
    const res: any = { locals, status(code: number) { status = code; return this; }, json(value: any) { payload = value; return this; } };
    await requireLookupAction(req, res, () => { nextCalled = true; });
    return { nextCalled, status, payload };
  };
  const guest = await invoke({ orderAccess: { kind: 'lookup', authType: 'guest_lookup', readOnly: true } });
  assert.equal(guest.nextCalled, false);
  assert.equal(guest.status, 403);
  assert.match(guest.payload.message, /chỉ được xem/i);
  const requestGuest = await invoke({ orderAccess: { kind: 'lookup', authType: 'guest_lookup', readOnly: true }, params: { requestId: 'YC_TEST' } });
  assert.equal(requestGuest.nextCalled, true);
  assert.equal((await invoke({ orderAccess: { kind: 'lookup', authType: 'member' } })).nextCalled, true);
  assert.equal((await invoke({ orderAccess: { kind: 'request', authType: 'guest_request' } })).nextCalled, true);
  assert.equal((await invoke({ checkoutAccess: true })).nextCalled, true);
});

test('KH34 validates an optional order code before creating an OTP challenge', async () => {
  const { requestOrderOtp } = await import('../services/order-access.service.js');
  await assert.rejects(requestOrderOtp('0901234567', 'unit-ip', 'INVALID'), /Mã đơn hàng không đúng định dạng/);
});
