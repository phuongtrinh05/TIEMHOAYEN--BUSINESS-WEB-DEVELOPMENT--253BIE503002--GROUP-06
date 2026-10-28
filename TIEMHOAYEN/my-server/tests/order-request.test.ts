import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

const uri = process.env.TEST_MONGO_URI;
if (!uri) {
  test('checkout integration requires TEST_MONGO_URI (isolated replica set)', { skip: true }, () => {});
} else {
  process.env.MONGO_URI = uri;
  process.env.MONGO_DATABASE = `TIEM_HOA_YEN_CHECKOUT_TEST_${randomUUID().replaceAll('-', '')}`;
  let mongo: typeof import('../mongo.js');
  let service: typeof import('../services/order-request.service.js');
  let stock: typeof import('../services/inventory/stock.service.js');
  const payload = { sender: { name: 'Người đặt', phone: '0901234567' }, receiver: { name: 'Người nhận', phone: '0912345678', address: 'Test' }, delivery: { date: '2026-11-01', time: '10:00' } };
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
  const invoke = async (handler: any, body: any, params: any = {}) => {
    let code = 200, data: any;
    const response: any = { status(value: number) { code = value; return this; }, json(value: any) { data = value; return this; } };
    await handler({ body, params }, response);
    return { code, data };
  };
  const submit = async (productId: string) => {
    const controller = await import('../controllers/order.js');
    return invoke(controller.createOrder, { ...payload, checkoutSessionId: randomUUID(), items: [{ id: productId, qty: 1, price: 100000 }],
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
    const first = await invoke(updateAdminOrderPaymentStatus, { status: 'Thành công', amount: 100000 }, { orderId: order.orderId });
    assert.equal(first.code, 200);
    assert.equal((await (await mongo.getCollection<any>('GIU_TON')).findOne({ DON_HANG_ID: order.orderId })).TRANG_THAI, 'CHINH_THUC');
    assert.equal((await invoke(updateAdminOrderPaymentStatus, { status: 'Thành công', amount: 100000 }, { orderId: order.orderId })).code, 200);
    assert.equal((await (await mongo.getCollection<any>('SAN_PHAM')).findOne({ SAN_PHAM_ID: 'SP_PAID' })).TP_DANG_GIU, 1);
  });
  test('late payment cannot revive an expired hold or steal stock from another buyer', async () => {
    const { updateAdminOrderPaymentStatus } = await import('../controllers/admin.js');
    const { data: first } = await submit('SP_LATE');
    await (await mongo.getCollection<any>('GIU_TON')).updateMany({ DON_HANG_ID: first.orderId }, { $set: { HET_HAN_LUC: new Date(0) } });
    const { data: second } = await submit('SP_LATE');
    assert.equal(second.kind, 'order');
    const late = await invoke(updateAdminOrderPaymentStatus, { status: 'Thành công', amount: 100000 }, { orderId: first.orderId });
    assert.equal(late.code, 410);
    assert.equal((await (await mongo.getCollection<any>('THANH_TOAN')).findOne({ DON_HANG_ID: first.orderId })).TRANG_THAI_THANH_TOAN, 'Chờ thanh toán');
  });
  test('payment retry rechecks stock; retry after expiry fails if another buyer holds it', async () => {
    const { retryOrderPayment, expireOrderPayment } = await import('../controllers/order.js');
    const { data: first } = await submit('SP_RETRY');
    await invoke(expireOrderPayment, {}, { orderId: first.orderId });
    const retry = await invoke(retryOrderPayment, {}, { orderId: first.orderId });
    assert.equal(retry.code, 200);
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
    assert.equal(receipt.status, service.REQUEST_STATUS.converted);
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
      const admin = { 'x-admin-id': sales.NHAN_VIEN_ID, 'Content-Type': 'application/json' };
      const customer = { 'x-request-token': r.accessToken, 'Content-Type': 'application/json' };
      assert.equal((await fetch(`${base}/admin/order-requests`, { headers: { 'x-admin-role': 'Admin' } })).status, 403);
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
    assert.equal(requestWorkflow({ ...row, delivery: { date: '2026-10-27', time: '11:00' } }, now).scheduleExpired, true);
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
