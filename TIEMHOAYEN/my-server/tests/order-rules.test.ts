import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Hạn thanh toán: giao xa 24 giờ, giao gần trước giờ nhận 4 giờ', async () => {
  const { isUnpaidPastDeadline, orderPaymentDeadline } = await import('../services/unpaid-order-expiry.service.js');
  const created = new Date('2026-11-10T08:00:00+07:00');
  // Nhận hàng xa (3 ngày sau): hạn = 24 giờ kể từ lúc đặt.
  const far = { TRANG_THAI: 'Chờ thanh toán', PHUONG_THUC_THANH_TOAN: 'MoMo', TONG_TIEN: 300000, NGAY_TAO: created, NGAY_MUON_GIAO: new Date('2026-11-13T00:00:00.000Z'), KHUNG_GIO_MUON_GIAO: '14:00' };
  assert.equal(orderPaymentDeadline(far)?.toISOString(), new Date('2026-11-11T08:00:00+07:00').toISOString());
  assert.equal(isUnpaidPastDeadline(far, 0, new Date('2026-11-11T07:59:00+07:00')), false);
  assert.equal(isUnpaidPastDeadline(far, 0, new Date('2026-11-11T08:01:00+07:00')), true);
  // Đơn gấp nhận 20:00 cùng ngày: phải thanh toán trước 16:00.
  const urgent = { ...far, NGAY_MUON_GIAO: new Date('2026-11-10T00:00:00.000Z'), KHUNG_GIO_MUON_GIAO: '20:00' };
  assert.equal(orderPaymentDeadline(urgent)?.toISOString(), new Date('2026-11-10T16:00:00+07:00').toISOString());
  assert.equal(isUnpaidPastDeadline(urgent, 0, new Date('2026-11-10T16:01:00+07:00')), true);
  assert.equal(isUnpaidPastDeadline(urgent, 300000, new Date('2026-11-10T16:01:00+07:00')), false, 'đã trả đủ thì không hủy');
  // Nhận sau 26 giờ (> 24 giờ) là đơn giao xa: hạn vẫn là 24 giờ kể từ lúc đặt, không phải trước giờ nhận 4 giờ.
  const farSoon = { ...far, NGAY_MUON_GIAO: new Date('2026-11-11T00:00:00.000Z'), KHUNG_GIO_MUON_GIAO: '10:00' };
  assert.equal(orderPaymentDeadline(farSoon)?.toISOString(), new Date('2026-11-11T08:00:00+07:00').toISOString());
});

test('Đơn chưa thanh toán bị hủy khi quá hạn (đơn nhận 14:00 phải trả trước 10:00)', async () => {
  const { isUnpaidPastDelivery, requiredPrepayment } = await import('../services/unpaid-order-expiry.service.js');
  const order = { TRANG_THAI: 'Chờ thanh toán', PHUONG_THUC_THANH_TOAN: 'Chuyển khoản', TONG_TIEN: 300000,
    NGAY_MUON_GIAO: new Date('2026-11-10T00:00:00.000Z'), KHUNG_GIO_MUON_GIAO: '14:00' };
  const beforeDelivery = new Date('2026-11-10T09:59:00+07:00');
  const afterDelivery = new Date('2026-11-10T10:01:00+07:00');
  assert.equal(isUnpaidPastDelivery(order, 0, beforeDelivery), false);
  assert.equal(isUnpaidPastDelivery(order, 0, afterDelivery), true);
  assert.equal(isUnpaidPastDelivery(order, 300000, afterDelivery), false, 'đã trả đủ thì không hủy');
  assert.equal(isUnpaidPastDelivery({ ...order, TRANG_THAI: 'Đã đặt hàng thành công' }, 0, afterDelivery), false, 'đơn đã đặt thành công không bị hủy');
  const cod = { ...order, PHUONG_THUC_THANH_TOAN: 'COD', TIEN_COC: 50000 };
  assert.equal(requiredPrepayment(cod), 50000);
  assert.equal(isUnpaidPastDelivery(cod, 50000, afterDelivery), false, 'COD đã đặt cọc đủ thì không hủy');
  assert.equal(isUnpaidPastDelivery(cod, 0, afterDelivery), true);
});

test('Chỉ Admin/kho được chuyển "Chờ vận chuyển"; shipper chỉ cập nhật các bước giao', async () => {
  const { roleCanSetOrderStatus, assertRoleCanSetOrderStatus, assertRoleCanDoOrderAction, allowedOrderStatuses } = await import('../services/admin-order.service.js');
  assert.equal(roleCanSetOrderStatus('Admin', 'Chờ vận chuyển'), true);
  assert.equal(roleCanSetOrderStatus('Nhân viên kho', 'Chờ vận chuyển'), true);
  assert.equal(roleCanSetOrderStatus('Nhân viên kho', 'Đang giao'), false);
  assert.equal(roleCanSetOrderStatus('Nhân viên giao hàng', 'Chờ vận chuyển'), false);
  assert.equal(roleCanSetOrderStatus('Nhân viên bán hàng', 'Chờ vận chuyển'), false);
  for (const status of ['Đang giao', 'Đã giao', 'Giao không thành công']) assert.equal(roleCanSetOrderStatus('Nhân viên giao hàng', status), true);
  for (const status of ['Đã hủy', 'Hoàn thành']) assert.equal(roleCanSetOrderStatus('Nhân viên giao hàng', status), false);
  assert.throws(() => assertRoleCanSetOrderStatus('Nhân viên giao hàng', 'Chờ vận chuyển'), /Admin hoặc nhân viên kho/);
  assert.throws(() => assertRoleCanDoOrderAction('Nhân viên giao hàng', 'assign-shipper'), /giao hàng/);
  assert.doesNotThrow(() => assertRoleCanDoOrderAction('Nhân viên kho', 'start-preparation'));

  const preparing = { TRANG_THAI: 'Đang chuẩn bị hàng', PHUONG_THUC_THANH_TOAN: 'Chuyển khoản', TONG_TIEN: 100000, THOI_DIEM_CHUAN_BI_DU_KIEN: new Date() };
  assert.deepEqual(allowedOrderStatuses(preparing, 100000, 'Nhân viên giao hàng'), []);
  assert.deepEqual(allowedOrderStatuses(preparing, 100000, 'Nhân viên kho'), ['Chờ vận chuyển']);
  const shipping = { ...preparing, TRANG_THAI: 'Chờ vận chuyển' };
  assert.deepEqual(allowedOrderStatuses(shipping, 100000, 'Nhân viên giao hàng'), ['Đang giao']);
});

test('Hạn gửi hỗ trợ 1 giờ sau giao thành công và tự chuyển Hoàn thành', async () => {
  const { orderDeliveredAt, supportDeadline } = await import('../services/admin-order.service.js');
  const { autoCompleteDecision } = await import('../services/order-auto-complete.service.js');
  const deliveredAt = new Date('2026-11-10T10:00:00+07:00');
  const order = { TRANG_THAI: 'Đã giao', TONG_TIEN: 200000,
    LICH_SU_TRANG_THAI: [{ from: 'Đang giao', to: 'Đã giao', at: deliveredAt }] };
  assert.equal(orderDeliveredAt(order)?.getTime(), deliveredAt.getTime(), 'lấy mốc giao từ lịch sử khi chưa có NGAY_GIAO_THUC_TE');
  assert.equal(supportDeadline(order)?.getTime(), deliveredAt.getTime() + 3600_000);
  const at = (minutes: number) => new Date(deliveredAt.getTime() + minutes * 60_000);
  assert.equal(autoCompleteDecision(order, 200000, false, at(59)), 'wait', 'còn trong 1 giờ thì chờ');
  assert.equal(autoCompleteDecision(order, 200000, false, at(61)), 'complete');
  assert.equal(autoCompleteDecision(order, 200000, true, at(61)), 'skip', 'có yêu cầu hỗ trợ thì không tự hoàn thành');
  assert.equal(autoCompleteDecision(order, 100000, false, at(61)), 'needs-payment', 'chưa thu đủ tiền thì báo admin');
  assert.equal(autoCompleteDecision({ ...order, TRANG_THAI: 'Đang giao' }, 200000, false, at(61)), 'skip');
  const withField = { ...order, NGAY_GIAO_THUC_TE: at(30) };
  assert.equal(supportDeadline(withField)?.getTime(), at(90).getTime(), 'ưu tiên NGAY_GIAO_THUC_TE');
});

test('Quy tắc hậu mãi: bằng chứng, mức hoàn gợi ý, duyệt lần 2, ngoại lệ', async () => {
  const { afterSalesInput, suggestRefund, needsSecondApproval, supportDeadline } = await import('../services/admin-order.service.js');
  const details = [{ SAN_PHAM_ID: 'SP1', SO_LUONG: 2, GIA: 200000 }];
  // Lỗi về hoa/giao hàng bắt buộc có ảnh/video.
  assert.throws(() => afterSalesInput({ type: 'refund', reason: 'Hoa héo', issueType: 'damaged', items: [{ productId: 'SP1', quantity: 1 }] }, details), /ít nhất 1 ảnh/);
  assert.doesNotThrow(() => afterSalesInput({ type: 'refund', reason: 'Hoa héo', issueType: 'damaged', items: [{ productId: 'SP1', quantity: 1 }], evidence: ['https://example.com/a.jpg'] }, details));
  assert.doesNotThrow(() => afterSalesInput({ type: 'refund', reason: 'Khác', issueType: 'other', items: [{ productId: 'SP1', quantity: 1 }] }, details));

  // Giá sau giảm giá: tạm tính 400k, giảm 40k (10%) → sản phẩm lỗi 200k còn 180k; ship 30k.
  const order = { TONG_TIEN: 390000, TAM_TINH: 400000, PHI_VAN_CHUYEN: 30000, TINH_TIEN_SNAPSHOT: { subtotal: 400000, productDiscount: 40000, shippingFee: 30000 } };
  const items = [{ productId: 'SP1', quantity: 1 }];
  assert.equal(suggestRefund(order, details, items, 'damaged', 390000).amount, 210000, 'lỗi shop: 100% sau giảm + ship');
  const partial = suggestRefund(order, details, items, 'partial_damage', 390000);
  assert.equal(partial.amount, 54000, 'hỏng một phần: tối thiểu 30%');
  assert.equal(partial.minAmount, 54000);
  assert.equal(suggestRefund(order, details, items, 'missing_accessory', 390000).amount, 0, 'thiếu phụ kiện: giao bù');
  assert.equal(suggestRefund(order, details, items, 'other', 390000).amount, 0);
  assert.equal(suggestRefund(order, details, items, 'damaged', 100000).amount, 100000, 'không vượt tiền đã thu');

  assert.equal(needsSecondApproval(2_000_001, 10_000_000), true, 'trên 2 triệu');
  assert.equal(needsSecondApproval(600_000, 1_000_000), true, 'trên 50% giá trị đơn');
  assert.equal(needsSecondApproval(500_000, 1_000_000), false);

  const deliveredAt = new Date('2026-11-10T10:00:00+07:00');
  const base = { NGAY_GIAO_THUC_TE: deliveredAt };
  assert.equal(supportDeadline(base)?.getTime(), deliveredAt.getTime() + 3600_000);
  const exceptionUntil = new Date('2026-11-10T15:00:00+07:00');
  assert.equal(supportDeadline({ ...base, HO_TRO_NGOAI_LE: { until: exceptionUntil } })?.getTime(), exceptionUntil.getTime(), 'ngoại lệ kéo dài hạn');
});

test('Khung giờ đồng nhất 24h', async () => {
  const { slot24h } = await import('../services/time-format.js');
  assert.equal(slot24h('09:00 AM–11:00 AM'), '09:00–11:00');
  assert.equal(slot24h('11:00 AM–01:00 PM'), '11:00–13:00');
  assert.equal(slot24h('07:00 PM–09:00 PM'), '19:00–21:00');
  assert.equal(slot24h('12:00 AM'), '00:00');
  assert.equal(slot24h('12:30 PM'), '12:30');
  assert.equal(slot24h('17h'), '17:00');
  assert.equal(slot24h('17h30'), '17:30');
  assert.equal(slot24h('14:00'), '14:00');
  assert.equal(slot24h('08:00–10:00'), '08:00–10:00');
  assert.equal(slot24h(''), '');
  assert.equal(slot24h('Giao cả ngày'), 'Giao cả ngày');
  const { orderDeliveryAt } = await import('../services/inventory/stock.service.js');
  const at = orderDeliveryAt({ NGAY_MUON_GIAO: new Date('2026-11-10T00:00:00.000Z'), KHUNG_GIO_MUON_GIAO: '01:00 PM–03:00 PM' });
  assert.equal(at?.toISOString(), new Date('2026-11-10T13:00:00+07:00').toISOString(), 'khung giờ PM cũ được hiểu đúng là buổi chiều');
});

test('Voucher theo quy định: đối tượng, cá nhân, hạng, đơn tối thiểu, mức giảm tối đa', async () => {
  const { evaluateVoucher } = await import('../services/voucher-policy.service.js');
  const now = new Date('2026-11-08T10:00:00+07:00');
  const base = { customerId: 'KH1', customer: { LOAI_THANH_VIEN: 'Bạc' }, lines: [{ id: 'SP1', qty: 1, price: 600000 }], shippingFee: 30000, validOrderCount: 2, usedByCustomer: 0, now };
  const guest = { ...base, customerId: null, customer: null };
  const v = (x: any) => ({ VOUCHER_ID: 'V', NGAY_BAT_DAU: '2026-11-01T00:00:00Z', NGAY_KET_THUC: '2026-11-30T00:00:00Z', KICH_HOAT: true, ...x });
  // Tiền giảm = MIN(SP hợp lệ × %, tối đa).
  assert.equal(evaluateVoucher(v({ LOAI_GIAM_GIA: 'Phần trăm', GIA_TRI_GIAM: 10, MUC_GIAM_TOI_DA: 40000 }), base).productDiscount, 40000);
  // Đơn tối thiểu tính trên SP hợp lệ, trước phí giao.
  const min = evaluateVoucher(v({ LOAI_GIAM_GIA: 'Phần trăm', GIA_TRI_GIAM: 10, DON_TOI_THIEU: 700000 }), base);
  assert.equal(min.ok, false); assert.match(min.reason, /Cần mua thêm 100\.000đ/);
  // Guest chỉ dùng voucher công khai.
  assert.equal(evaluateVoucher(v({ LOAI_GIAM_GIA: 'Số tiền', GIA_TRI_GIAM: 20000, DOI_TUONG: 'Member' }), guest).ok, false);
  assert.equal(evaluateVoucher(v({ LOAI_GIAM_GIA: 'Số tiền', GIA_TRI_GIAM: 20000, DOI_TUONG: 'Tất cả' }), guest).ok, true);
  // Voucher cá nhân: chỉ tài khoản được cấp, dùng 1 lần.
  assert.equal(evaluateVoucher(v({ KHACH_HANG_ID: 'KH2', LOAI_GIAM_GIA: 'Số tiền', GIA_TRI_GIAM: 20000 }), base).ok, false);
  assert.equal(evaluateVoucher(v({ KHACH_HANG_ID: 'KH1', LOAI_GIAM_GIA: 'Số tiền', GIA_TRI_GIAM: 20000, DA_DUNG: true }), base).ok, false);
  // Voucher công khai không bị khóa bởi cờ DA_DUNG (cờ đó chỉ dành cho voucher cá nhân).
  assert.equal(evaluateVoucher(v({ LOAI_GIAM_GIA: 'Phí vận chuyển', GIA_TRI_GIAM: 50000, DOI_TUONG: 'Member', DA_DUNG: true }), base).shippingDiscount, 30000);
  // Hạng hiện tại tại thời điểm áp dụng.
  assert.equal(evaluateVoucher(v({ LOAI_GIAM_GIA: 'Số tiền', GIA_TRI_GIAM: 20000, HANG_THANH_VIEN: ['Vàng', 'Kim cương'] }), base).ok, false);
  assert.equal(evaluateVoucher(v({ LOAI_GIAM_GIA: 'Số tiền', GIA_TRI_GIAM: 20000, HANG_THANH_VIEN: ['Silver'] }), base).ok, true);
  // Giới hạn lượt mỗi người và đơn đầu tiên.
  assert.equal(evaluateVoucher(v({ LOAI_GIAM_GIA: 'Số tiền', GIA_TRI_GIAM: 20000, GIOI_HAN_MOI_NGUOI: 1 }), { ...base, usedByCustomer: 1 }).ok, false);
  assert.equal(evaluateVoucher(v({ LOAI_GIAM_GIA: 'Số tiền', GIA_TRI_GIAM: 20000, DON_DAU_TIEN: true }), base).ok, false);
  // Hết hạn theo ngày Việt Nam (hết ngày 30/11).
  assert.equal(evaluateVoucher(v({ LOAI_GIAM_GIA: 'Số tiền', GIA_TRI_GIAM: 20000 }), { ...base, now: new Date('2026-11-30T23:00:00+07:00') }).ok, true);
  assert.equal(evaluateVoucher(v({ LOAI_GIAM_GIA: 'Số tiền', GIA_TRI_GIAM: 20000 }), { ...base, now: new Date('2026-12-01T00:30:00+07:00') }).ok, false);
});

test('Thanh toán thất bại quá hạn: trạng thái cuối, khách không còn thấy, job không xử lý lại', async () => {
  const { isUnpaidPastDeadline, HIDE_EXPIRED_PAYMENT_FROM_CUSTOMER, PAYMENT_FAILED_STATUS } = await import('../services/unpaid-order-expiry.service.js');
  const order = { TRANG_THAI: PAYMENT_FAILED_STATUS, HET_HAN_THANH_TOAN: true, PHUONG_THUC_THANH_TOAN: 'MoMo', TONG_TIEN: 300000, NGAY_TAO: new Date('2026-11-01T08:00:00+07:00') };
  assert.equal(isUnpaidPastDeadline(order, 0, new Date('2026-11-08T08:00:00+07:00')), false);
  assert.deepEqual(HIDE_EXPIRED_PAYMENT_FROM_CUSTOMER.HET_HAN_THANH_TOAN, { $ne: true });
});
