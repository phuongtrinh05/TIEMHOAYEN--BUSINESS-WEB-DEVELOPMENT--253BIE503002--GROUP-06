import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDeliverySlotStart, classifyDeliverySchedule, isWithinShopHours, subtractWorkingMinutes, URGENT_CONTACT_PHONE, workingMinutesBetween } from '../services/delivery-policy.service.js';

const now = new Date('2026-11-01T08:00:00+07:00');

test('delivery from 4 to under 24 hours in shop hours is checked against current materials', () => {
  const result = classifyDeliverySchedule('2026-11-01T14:00:00+07:00', now);
  assert.equal(result.scheduleClass, 'UNDER_24H');
  assert.equal(result.requiresSales, false);
});
test('delivery under 4 hours is blocked with the shop phone popup message', () => {
  assert.throws(() => classifyDeliverySchedule('2026-11-01T11:59:00+07:00', now), (error: any) => {
    assert.equal(error.status, 400);
    assert.equal(error.details.code, 'URGENT_DELIVERY');
    assert.match(error.message, new RegExp(URGENT_CONTACT_PHONE));
    return true;
  });
});
test('exactly 4 hours ahead is accepted', () => {
  assert.equal(classifyDeliverySchedule('2026-11-01T12:00:00+07:00', now).scheduleClass, 'UNDER_24H');
});
test('24 hours or more goes straight to checkout', () => {
  assert.equal(classifyDeliverySchedule('2026-11-02T08:00:00+07:00', now).scheduleClass, 'FROM_24H');
  assert.equal(classifyDeliverySchedule('2026-11-02T09:59:00+07:00', new Date('2026-11-01T10:00:00+07:00')).scheduleClass, 'UNDER_24H');
});
test('before 08:00 or after 22:00 is rejected, never turned into a request', () => {
  assert.throws(() => classifyDeliverySchedule('2026-11-02T07:30:00+07:00', now), (error: any) => error.details.code === 'OUTSIDE_SHOP_HOURS');
  assert.throws(() => classifyDeliverySchedule('2026-11-01T22:30:00+07:00', now), (error: any) => error.details.code === 'OUTSIDE_SHOP_HOURS');
  assert.equal(classifyDeliverySchedule('2026-11-01T22:00:00+07:00', now).scheduleClass, 'UNDER_24H');
});
test('a slot crossing 22:00 is checked as a whole', () => {
  assert.equal(isWithinShopHours('2026-11-01T20:00:00+07:00', '2026-11-01T22:00:00+07:00'), true);
  assert.equal(isWithinShopHours('2026-11-01T21:00:00+07:00', '2026-11-01T23:00:00+07:00'), false);
  assert.equal(isWithinShopHours('2026-11-01T07:00:00+07:00', '2026-11-01T09:00:00+07:00'), false);
});
test('past delivery is rejected; UTC-stored values compare in Vietnam time', () => {
  assert.throws(() => classifyDeliverySchedule('2026-11-01T07:00:00+07:00', now), (error: any) => error.details.code === 'DELIVERY_IN_PAST');
  // 2026-11-01T01:00Z = 08:00 giờ Việt Nam → trong giờ shop.
  assert.equal(isWithinShopHours('2026-11-01T01:00:00Z'), true);
  assert.equal(isWithinShopHours('2026-11-01T00:30:00Z'), false);
});
test('a 30-minute slot must start between 08:00 and 21:30', () => {
  assert.doesNotThrow(() => assertDeliverySlotStart('2026-11-01T08:00:00+07:00'));
  assert.doesNotThrow(() => assertDeliverySlotStart('2026-11-01T21:30:00+07:00'));
  assert.throws(() => assertDeliverySlotStart('2026-11-01T22:00:00+07:00'), (error: any) => error.details.code === 'OUTSIDE_SHOP_HOURS');
  assert.throws(() => assertDeliverySlotStart('2026-11-01T07:30:00+07:00'), (error: any) => error.details.code === 'OUTSIDE_SHOP_HOURS');
});

test('4-hour lead counts only shop working hours 06:30–22:00', () => {
  const late = new Date('2026-11-01T23:00:00+07:00');
  // 23:00 → 08:00 hôm sau: chỉ có 06:30–08:00 = 1 giờ 30 phút làm việc → đơn gấp.
  assert.throws(() => classifyDeliverySchedule('2026-11-02T08:00:00+07:00', late), (error: any) => error.details.code === 'URGENT_DELIVERY');
  // 05:00 → 09:00: 06:30–09:00 = 2 giờ 30 phút → đơn gấp.
  assert.throws(() => classifyDeliverySchedule('2026-11-02T09:00:00+07:00', new Date('2026-11-02T05:00:00+07:00')), (error: any) => error.details.code === 'URGENT_DELIVERY');
  // 23:00 → 10:30 hôm sau: đúng 4 giờ làm việc → nhận.
  const ok = classifyDeliverySchedule('2026-11-02T10:30:00+07:00', late);
  assert.equal(ok.workingMinutesUntilDelivery, 240);
  assert.equal(ok.scheduleClass, 'UNDER_24H');
  // 20:00 → 10:00 hôm sau: 20:00–22:00 + 06:30–10:00 = 5 giờ 30 phút → nhận.
  assert.equal(classifyDeliverySchedule('2026-11-02T10:00:00+07:00', new Date('2026-11-01T20:00:00+07:00')).workingMinutesUntilDelivery, 330);
});
test('working minutes skip the night and can be subtracted back across days', () => {
  assert.equal(workingMinutesBetween('2026-11-01T21:00:00+07:00', '2026-11-02T07:30:00+07:00'), 120);
  assert.equal(workingMinutesBetween('2026-11-01T22:30:00+07:00', '2026-11-02T06:00:00+07:00'), 0);
  assert.equal(subtractWorkingMinutes('2026-11-02T12:00:00+07:00', 240).toISOString(), new Date('2026-11-02T08:00:00+07:00').toISOString());
  assert.equal(subtractWorkingMinutes('2026-11-02T10:00:00+07:00', 240).toISOString(), new Date('2026-11-01T21:30:00+07:00').toISOString());
  assert.equal(subtractWorkingMinutes('2026-11-02T20:00:00+07:00', 240).toISOString(), new Date('2026-11-02T16:00:00+07:00').toISOString());
});
