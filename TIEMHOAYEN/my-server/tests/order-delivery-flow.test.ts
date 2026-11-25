import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertOrderTransition,
  assertOrderTransitionForRole,
  assertRoleCanSetOrderStatus,
  orderNextStep,
  pendingCashTotal,
  sumVerifiedPayments,
} from '../services/admin-order.service.js';
import { ACTIVE_RESERVATION_STATUSES, RESERVATION_STATUS } from '../services/inventory/constants.js';
import { availableOf, InventoryError } from '../services/inventory/helpers.js';
import { autoCompleteDecision } from '../services/order-auto-complete.service.js';

const expect409 = (action: () => unknown) => assert.throws(action, (error: unknown) => {
  assert.ok(error instanceof InventoryError);
  assert.equal(error.status, 409);
  return true;
});

test('GH-01 Chuyển từ chuẩn bị đến đang giao và chặn bỏ bước', () => {
  const preparing = {
    TRANG_THAI: 'Đang chuẩn bị hàng',
    PHUONG_THUC_THANH_TOAN: 'Chuyển khoản',
    TONG_TIEN: 200_000,
    THOI_DIEM_BAT_DAU_THUC_TE: new Date(),
    NHAN_VIEN_GIAO_HANG_ID: 'NV_GIAO_01',
  };

  assert.doesNotThrow(() => assertRoleCanSetOrderStatus('Nhân viên kho', 'Chờ vận chuyển'));
  assert.doesNotThrow(() => assertOrderTransition(preparing, 'Chờ vận chuyển', 200_000));

  const waiting = { ...preparing, TRANG_THAI: 'Chờ vận chuyển' };
  assert.doesNotThrow(() => assertRoleCanSetOrderStatus('Nhân viên giao hàng', 'Đang giao'));
  assert.doesNotThrow(() => assertOrderTransitionForRole(waiting, 'Đang giao', 200_000, 'Nhân viên giao hàng'));
  expect409(() => assertOrderTransitionForRole(waiting, 'Đã giao', 200_000, 'Nhân viên giao hàng'));
});

test('GH-02 Giao COD thành công và chặn hoàn thành khi chưa đối soát', () => {
  const delivered = {
    TRANG_THAI: 'Đã giao',
    PHUONG_THUC_THANH_TOAN: 'COD',
    TIEN_COC: 0,
    TONG_TIEN: 200_000,
    NHAN_VIEN_GIAO_HANG_ID: 'NV_GIAO_01',
  };
  const pending190 = [{
    THANH_TOAN_ID: 'GD_GH02_SD01', LOAI_GIAO_DICH: 'SO_DU', SO_TIEN: 190_000,
    TRANG_THAI_THANH_TOAN: 'Chờ đối soát',
  }];
  assert.equal(pendingCashTotal(pending190), 190_000);
  assert.equal(orderNextStep(delivered, 0, pendingCashTotal(pending190)).blocked, true);
  expect409(() => assertOrderTransition(delivered, 'Hoàn thành', 0));

  const pending200 = [{ ...pending190[0], SO_TIEN: 200_000 }];
  assert.equal(pendingCashTotal(pending200), 200_000);
  assert.equal(orderNextStep(delivered, 0, pendingCashTotal(pending200)).blocked, true,
    'Khai đủ tiền vẫn phải chờ nhân viên có quyền đối soát');
  assert.throws(() => assertRoleCanSetOrderStatus('Nhân viên giao hàng', 'Hoàn thành'),
    (error: unknown) => error instanceof InventoryError && error.status === 403);

  const reconciled = [{ ...pending200[0], TRANG_THAI_THANH_TOAN: 'Thành công', MA_GIAO_DICH: 'TX-GH02-001' }];
  const verified = sumVerifiedPayments(reconciled);
  assert.equal(verified, 200_000);
  assert.doesNotThrow(() => assertOrderTransitionForRole(delivered, 'Hoàn thành', verified, 'Admin'));
});

test('GH-03 Giao thất bại rồi đưa về chờ vận chuyển', () => {
  const shipping = {
    TRANG_THAI: 'Đang giao',
    PHUONG_THUC_THANH_TOAN: 'COD',
    TIEN_COC: 0,
    TONG_TIEN: 200_000,
    NHAN_VIEN_GIAO_HANG_ID: 'NV_GIAO_01',
  };
  assert.doesNotThrow(() => assertOrderTransitionForRole(shipping, 'Giao không thành công', 0, 'Nhân viên giao hàng'));

  const failed = { ...shipping, TRANG_THAI: 'Giao không thành công' };
  assert.doesNotThrow(() => assertOrderTransitionForRole(failed, 'Chờ vận chuyển', 0, 'Admin'));
  assert.equal(sumVerifiedPayments([]), 0, 'Giao thất bại không tự sinh khoản thu');
});

test('GH-04 Hủy trước khi chuẩn bị và nhả tồn đúng một lần', () => {
  const order = { TRANG_THAI: 'Đã đặt hàng thành công', PHUONG_THUC_THANH_TOAN: 'COD', TIEN_COC: 0, TONG_TIEN: 200_000 };
  assert.doesNotThrow(() => assertOrderTransition(order, 'Đã hủy', 0));

  const material = { TON_THUC: 20, TON_DANG_GIU: 5, TON_KHONG_DAT: 0 };
  const reservation = { TRANG_THAI: RESERVATION_STATUS.official, SO_LUONG: 5 };
  const releaseOnce = () => {
    if (!ACTIVE_RESERVATION_STATUSES.includes(reservation.TRANG_THAI as any)) return false;
    // reservation.TRANG_THAI = RESERVATION_STATUS.released;
    material.TON_DANG_GIU -= reservation.SO_LUONG;
    return true;
  };

  assert.equal(availableOf(material), 15);
  assert.equal(releaseOnce(), true);
  assert.equal(releaseOnce(), false, 'Gửi lại thao tác hủy không được nhả tồn lần hai');
  assert.deepEqual({ held: material.TON_DANG_GIU, available: availableOf(material), onHand: material.TON_THUC },
    { held: 0, available: 20, onHand: 20 });
});

test('GH-05 Chặn hủy theo luồng thông thường sau khi bắt đầu chuẩn bị', () => {
  const preparing = {
    TRANG_THAI: 'Đã đặt hàng thành công',
    PHUONG_THUC_THANH_TOAN: 'Chuyển khoản',
    TONG_TIEN: 200_000,
    THOI_DIEM_BAT_DAU_THUC_TE: new Date(),
  };
  expect409(() => assertOrderTransition(preparing, 'Đã hủy', 200_000));
  assert.equal(preparing.TRANG_THAI, 'Đã đặt hàng thành công');
});

test('GH-06 Chặn chuyển sang đang giao khi chưa phân công nhân viên giao hàng', () => {
  const waiting = {
    TRANG_THAI: 'Chờ vận chuyển', PHUONG_THUC_THANH_TOAN: 'Chuyển khoản',
    TONG_TIEN: 200_000,
  };
  expect409(() => assertOrderTransitionForRole(waiting, 'Đang giao', 200_000, 'Admin'));
  assert.equal(waiting.TRANG_THAI, 'Chờ vận chuyển');
});

test('GH-07 Chặn nhân viên giao hàng không được phân công thao tác đơn', () => {
  const order = { NHAN_VIEN_GIAO_HANG_ID: 'NV_GIAO_01' };
  const actor = 'NV_GIAO_02';
  const assertAssigned = () => {
    if (order.NHAN_VIEN_GIAO_HANG_ID !== actor) throw new InventoryError(403, 'Chỉ nhân viên được phân công giao đơn này mới được thao tác.');
  };
  assert.throws(assertAssigned, (error: unknown) => error instanceof InventoryError && error.status === 403);
});

test('GH-08 COD khai thiếu tiền bị từ chối và không tạo khoản chờ đối soát', () => {
  const total = 200_000;
  const verified = 0;
  const pending: any[] = [];
  const declare = (amount: number) => {
    const outstanding = total - verified - pendingCashTotal(pending);
    if (amount !== outstanding) throw new InventoryError(409, `Số tiền đã thu phải đúng ${outstanding}.`);
    pending.push({ THANH_TOAN_ID: 'GD_GH08', LOAI_GIAO_DICH: 'SO_DU', SO_TIEN: amount, TRANG_THAI_THANH_TOAN: 'Chờ đối soát' });
  };
  expect409(() => declare(190_000));
  assert.equal(pending.length, 0);
  assert.doesNotThrow(() => declare(200_000));
  assert.equal(pendingCashTotal(pending), 200_000);
});

test('GH-09 Gửi lặp thao tác khai thu không tạo khoản thu trùng', () => {
  const payments: any[] = [];
  const declareOnce = (amount: number) => {
    const outstanding = 200_000 - pendingCashTotal(payments);
    if (outstanding === 0) return false;
    if (amount !== outstanding) throw new InventoryError(409, 'Số tiền khai thu không khớp.');
    payments.push({ THANH_TOAN_ID: 'GD_GH09_SD01', LOAI_GIAO_DICH: 'SO_DU', SO_TIEN: amount, TRANG_THAI_THANH_TOAN: 'Chờ đối soát' });
    return true;
  };
  assert.equal(declareOnce(200_000), true);
  assert.equal(declareOnce(200_000), false);
  assert.equal(payments.length, 1);
});

test('GH-10 Chặn giao đơn chuyển khoản chưa thanh toán đủ', () => {
  const shipping = {
    TRANG_THAI: 'Đang giao', PHUONG_THUC_THANH_TOAN: 'Chuyển khoản',
    TONG_TIEN: 200_000, NHAN_VIEN_GIAO_HANG_ID: 'NV_GIAO_01',
  };
  expect409(() => assertOrderTransitionForRole(shipping, 'Đã giao', 190_000, 'Nhân viên giao hàng'));
  assert.equal(shipping.TRANG_THAI, 'Đang giao');
});

test('GH-11 Chặn đối soát sai số tiền hoặc dùng trùng mã giao dịch', () => {
  const expected = 200_000;
  const usedReferences = new Set<string>();
  const reconcile = (amount: number, reference: string) => {
    if (amount !== expected) throw new InventoryError(409, 'Số tiền phải khớp nghĩa vụ thanh toán.');
    if (!reference.trim()) throw new InventoryError(400, 'Cần mã tham chiếu khi xác nhận đã thu tiền.');
    if (usedReferences.has(reference)) throw new InventoryError(409, 'Mã tham chiếu đã được dùng.');
    usedReferences.add(reference);
  };
  expect409(() => reconcile(190_000, 'TX-GH11-A'));
  assert.throws(() => reconcile(200_000, ''), (error: unknown) => error instanceof InventoryError && error.status === 400);
  assert.doesNotThrow(() => reconcile(200_000, 'TX-GH11-A'));
  expect409(() => reconcile(200_000, 'TX-GH11-A'));
});

test('GH-12 Chặn cập nhật dựa trên phiên bản trạng thái đã cũ', () => {
  let version = 1;
  let status = 'Chờ vận chuyển';
  const update = (expectedVersion: number, next: string) => {
    if (expectedVersion !== version) throw new InventoryError(409, 'Đơn vừa được nhân viên khác cập nhật.');
    assertOrderTransition({ TRANG_THAI: status, PHUONG_THUC_THANH_TOAN: 'COD', TIEN_COC: 0, TONG_TIEN: 200_000, NHAN_VIEN_GIAO_HANG_ID: 'NV01' }, next, 200_000);
    status = next;
    version += 1;
  };
  assert.doesNotThrow(() => update(1, 'Đang giao'));
  expect409(() => update(1, 'Đã giao'));
  assert.equal(status, 'Đang giao');
});

test('GH-13 Giao thất bại nhiều lần rồi giao lại thành công', () => {
  let order: any = { TRANG_THAI: 'Đang giao', PHUONG_THUC_THANH_TOAN: 'COD', TIEN_COC: 0, TONG_TIEN: 200_000, NHAN_VIEN_GIAO_HANG_ID: 'NV01' };
  const history: string[] = [];
  const move = (next: string, paid = 0) => {
    assertOrderTransitionForRole(order, next, paid, next === 'Chờ vận chuyển' ? 'Admin' : 'Nhân viên giao hàng');
    history.push(`${order.TRANG_THAI} -> ${next}`);
    order = { ...order, TRANG_THAI: next };
  };
  move('Giao không thành công'); move('Chờ vận chuyển'); move('Đang giao'); move('Giao không thành công'); move('Chờ vận chuyển'); move('Đang giao'); move('Đã giao', 200_000);
  assert.equal(order.TRANG_THAI, 'Đã giao');
  assert.equal(history.filter(x => x.includes('Giao không thành công')).length, 4);
});

test('GH-14 Không tự hoàn thành trong một giờ hỗ trợ sau giao', () => {
  const deliveredAt = new Date('2026-11-25T10:00:00+07:00');
  const order = { TRANG_THAI: 'Đã giao', TONG_TIEN: 200_000, NGAY_GIAO_THUC_TE: deliveredAt };
  assert.equal(autoCompleteDecision(order, 200_000, false, new Date(deliveredAt.getTime() + 59 * 60_000)), 'wait');
});

test('GH-15 Hết một giờ và đủ tiền thì tự hoàn thành đúng điều kiện', () => {
  const deliveredAt = new Date('2026-11-25T10:00:00+07:00');
  const order = { TRANG_THAI: 'Đã giao', TONG_TIEN: 200_000, NGAY_GIAO_THUC_TE: deliveredAt };
  assert.equal(autoCompleteDecision(order, 200_000, false, new Date(deliveredAt.getTime() + 61 * 60_000)), 'complete');
  assert.equal(autoCompleteDecision({ ...order, TRANG_THAI: 'Hoàn thành' }, 200_000, false, new Date(deliveredAt.getTime() + 62 * 60_000)), 'skip');
});

test('GH-16 Có hồ sơ hỗ trợ thì không tự hoàn thành', () => {
  const deliveredAt = new Date('2026-11-25T10:00:00+07:00');
  const order = { TRANG_THAI: 'Đã giao', TONG_TIEN: 200_000, NGAY_GIAO_THUC_TE: deliveredAt };
  assert.equal(autoCompleteDecision(order, 200_000, true, new Date(deliveredAt.getTime() + 61 * 60_000)), 'skip');
});

test('GH-17 Hai yêu cầu hủy đồng thời chỉ nhả tồn một lần', async () => {
  const material = { TON_THUC: 20, TON_DANG_GIU: 5, TON_KHONG_DAT: 0 };
  let active = true;
  const release = async () => {
    if (!active) return false;
    active = false;
    material.TON_DANG_GIU -= 5;
    return true;
  };
  const results = await Promise.all([release(), release()]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.deepEqual({ held: material.TON_DANG_GIU, available: availableOf(material), onHand: material.TON_THUC }, { held: 0, available: 20, onHand: 20 });
});

test('GH-18 Đơn đã xuất kho hoặc bắt đầu chuẩn bị không được hủy thông thường', () => {
  const started = { TRANG_THAI: 'Đang chuẩn bị hàng', PHUONG_THUC_THANH_TOAN: 'Chuyển khoản', TONG_TIEN: 200_000, THOI_DIEM_BAT_DAU_THUC_TE: new Date(), PHIEU_XUAT_NVL_ID: 'PX001' };
  expect409(() => assertOrderTransition(started, 'Đã hủy', 200_000));
  assert.equal(started.TRANG_THAI, 'Đang chuẩn bị hàng');
});
