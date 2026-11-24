import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentRetryEligibility, orderPaymentDeadline } from '../services/unpaid-order-expiry.service.js';

// Giao 16:30 ngày 24/11 (giờ Việt Nam), đơn đặt 10:21 cùng ngày, chưa thanh toán.
const base = { DON_HANG_ID: 'T1', TRANG_THAI: 'Thanh toán thất bại', HET_HAN_THANH_TOAN: true, PHUONG_THUC_THANH_TOAN: 'COD', TIEN_COC: 150000,
  NGAY_TAO: new Date('2026-11-24T10:21:00+07:00'), NGAY_MUON_GIAO: new Date('2026-11-24T00:00:00.000Z'), KHUNG_GIO_MUON_GIAO: '16:30' };

test('Đơn quá hạn, giờ giao còn dưới 4 giờ làm việc: không thanh toán lại, phải đặt lại', () => {
  const r = paymentRetryEligibility(base, new Date('2026-11-24T12:40:00+07:00'));
  assert.equal(r.allowed, false);
  assert.equal(r.expired, true);
  assert.equal(r.code, 'ORDER_PAYMENT_EXPIRED');
});

test('Đơn quá hạn nhưng giờ giao còn từ 4 giờ làm việc: được thanh toán lại', () => {
  const later = { ...base, NGAY_MUON_GIAO: new Date('2026-11-26T00:00:00.000Z'), KHUNG_GIO_MUON_GIAO: '10:00' };
  const r = paymentRetryEligibility(later, new Date('2026-11-25T11:00:00+07:00'));
  assert.equal(r.allowed, true);
  assert.equal(r.expired, true);
});

test('Đơn quá hạn đã hoàn điểm thưởng thì không gia hạn', () => {
  const later = { ...base, NGAY_MUON_GIAO: new Date('2026-11-26T00:00:00.000Z'), KHUNG_GIO_MUON_GIAO: '10:00', DA_HOAN_DIEM_THUONG: true };
  assert.equal(paymentRetryEligibility(later, new Date('2026-11-25T11:00:00+07:00')).allowed, false);
});

test('Gia hạn: hạn thanh toán tính lại từ lúc thanh toán lại', () => {
  const revived = { ...base, TRANG_THAI: 'Chờ thanh toán', HET_HAN_THANH_TOAN: false, NGAY_MUON_GIAO: new Date('2026-11-28T00:00:00.000Z'), KHUNG_GIO_MUON_GIAO: '10:00',
    GIA_HAN_THANH_TOAN_LUC: new Date('2026-11-25T11:00:00+07:00') };
  assert.equal(orderPaymentDeadline(revived)?.toISOString(), new Date('2026-11-26T11:00:00+07:00').toISOString());
});
