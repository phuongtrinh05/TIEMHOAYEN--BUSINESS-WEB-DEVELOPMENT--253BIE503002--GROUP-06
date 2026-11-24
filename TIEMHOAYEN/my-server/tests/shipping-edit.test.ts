import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCustomerReschedule, rescheduleModeForOrder } from '../services/shipping-edit-policy.service.js';

// Đơn gốc giao 14:00 ngày 20/11; hiện tại 14:00 ngày 14/11 (giờ Việt Nam).
const order = { NGAY_MUON_GIAO: new Date('2026-11-20T00:00:00.000Z'), KHUNG_GIO_MUON_GIAO: '14:00' };
const now = new Date('2026-11-14T14:00:00+07:00');

test('Không đổi ngày/giờ thì cho sửa người nhận/địa chỉ', () => {
  assert.deepEqual(assertCustomerReschedule(order, '2026-11-20', '14:00', now), { changed: false });
});

test('Lịch mới còn từ 24 giờ: cập nhật trực tiếp', () => {
  const result = assertCustomerReschedule(order, '2026-11-16', '09:00–11:00', now);
  assert.equal(result.changed, true);
});

test('Lịch mới từ 4 đến dưới 24 giờ: liên hệ shop (ví dụ đổi sang 21:00 cùng ngày)', () => {
  assert.throws(() => assertCustomerReschedule(order, '2026-11-14', '21:00', now), (e: any) => e.status === 409 && e.details.code === 'RESCHEDULE_CONTACT_SHOP');
});

test('Lịch mới dưới 4 giờ: gọi shop', () => {
  assert.throws(() => assertCustomerReschedule(order, '2026-11-14', '17:00', now), (e: any) => e.details.code === 'RESCHEDULE_LOCKED');
});

test('Giờ đã qua hoặc ngoài 06:30–22:00 bị từ chối', () => {
  assert.throws(() => assertCustomerReschedule(order, '2026-11-13', '10:00', now), /đã qua/);
  assert.throws(() => assertCustomerReschedule(order, '2026-11-18', '22:30', now), /06:30 đến 22:00/);
  assert.throws(() => assertCustomerReschedule(order, '2026-11-18', '21:00–23:00', now), /06:30 đến 22:00/);
});

test('Lịch hiện tại còn dưới 4 giờ: khóa đổi ngày/giờ', () => {
  const soon = new Date('2026-11-20T11:00:00+07:00');
  assert.equal(rescheduleModeForOrder(order, soon), 'locked');
  assert.throws(() => assertCustomerReschedule(order, '2026-11-25', '10:00', soon), (e: any) => e.details.code === 'RESCHEDULE_LOCKED');
  assert.equal(rescheduleModeForOrder(order, now), 'direct');
});
