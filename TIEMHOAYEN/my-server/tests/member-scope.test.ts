import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedOrderQuery, ownedRequestQuery } from '../services/order-access.service.js';

const member = { authType: 'member', customerId: 'KH_A', phone: '0901234567' };

test('Trang thành viên gộp đơn vãng lai đặt bằng SĐT của tài khoản', async () => {
  const q: any = await ownedOrderQuery(member);
  assert.equal(q.$or.length, 2);
  assert.deepEqual(q.$or[0], { KHACH_HANG_ID: 'KH_A' });
  assert.deepEqual(q.$or[1].KHACH_HANG_ID, { $in: [null, ''] });
  assert.ok(q.$or[1].SDT_NGUOI_DAT.test('090 123 4567'));
  assert.ok(q.$or[1].SDT_NGUOI_DAT.test('+84901234567'));
  assert.equal(q.$or[1].SDT_NGUOI_DAT.test('0901234568'), false);
});

test('Yêu cầu đặt hàng vãng lai cùng SĐT cũng hiện ở trang thành viên', () => {
  const q: any = ownedRequestQuery(member);
  assert.deepEqual(q.$or[0], { customerId: 'KH_A' });
  assert.deepEqual(q.$or[1].customerId, { $in: [null, ''] });
  assert.ok(q.$or[1]['sender.phone'].test('0901234567'));
});

test('Tài khoản chưa có SĐT hợp lệ chỉ thấy đơn của chính tài khoản', async () => {
  assert.deepEqual(await ownedOrderQuery({ authType: 'member', customerId: 'KH_B', phone: '' }), { KHACH_HANG_ID: 'KH_B' });
  assert.deepEqual(ownedRequestQuery({ authType: 'member', customerId: 'KH_B' }), { customerId: 'KH_B' });
});
