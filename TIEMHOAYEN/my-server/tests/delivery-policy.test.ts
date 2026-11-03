import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDeliverySchedule } from '../services/delivery-policy.service.js';

test('same-day delivery at least three hours ahead in shop hours is normal',()=>{
  const result=classifyDeliverySchedule('2026-11-01T14:00:00+07:00',new Date('2026-11-01T10:00:00+07:00'));
  assert.equal(result.scheduleClass,'NORMAL');assert.equal(result.requiresSales,false);
});
test('delivery under one hour is rejected by the minimum urgent lead time',()=>{
  assert.throws(()=>classifyDeliverySchedule('2026-11-01T10:45:00+07:00',new Date('2026-11-01T10:00:00+07:00')),/ít nhất 1 giờ/);
});
test('delivery between one and three hours requires Sales review',()=>{
  assert.equal(classifyDeliverySchedule('2026-11-01T12:00:00+07:00',new Date('2026-11-01T10:00:00+07:00')).scheduleClass,'EXCEPTION_UNDER_3H');
});
test('early-morning and after-22:00 delivery are outside shop hours',()=>{
  assert.equal(classifyDeliverySchedule('2026-11-02T05:30:00+07:00',new Date('2026-11-01T10:00:00+07:00')).scheduleClass,'OUTSIDE_HOURS');
  assert.equal(classifyDeliverySchedule('2026-11-01T22:30:00+07:00',new Date('2026-11-01T10:00:00+07:00')).scheduleClass,'OUTSIDE_HOURS');
});
test('future in-hours delivery remains unconfirmed until Sales verifies supply',()=>{
  assert.equal(classifyDeliverySchedule('2026-11-04T14:00:00+07:00',new Date('2026-11-01T10:00:00+07:00')).scheduleClass,'FUTURE_UNCERTAIN');
});
