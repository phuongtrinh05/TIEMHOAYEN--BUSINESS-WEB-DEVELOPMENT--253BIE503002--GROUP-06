/**
 * Kiểm thử Dashboard / Báo cáo / Thông báo (AD02–AD07, AD09, AD60) theo D05/D07.
 * Chạy: TEST_MONGO_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0" npm run test:analytics
 * Tự tạo và XÓA database TIEM_HOA_YEN_ANALYTICS_TEST.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const uri = process.env.TEST_MONGO_URI;
if (!uri) {
  test('bỏ qua: chưa đặt TEST_MONGO_URI', { skip: true }, () => {});
} else {
  process.env.MONGO_URI = uri;
  process.env.MONGO_DATABASE = 'TIEM_HOA_YEN_ANALYTICS_TEST';

  let mongo: typeof import('../mongo.js');
  let dash: typeof import('../services/analytics/dashboard.service.js');
  let reports: typeof import('../services/analytics/reports.service.js');
  let noti: typeof import('../services/analytics/notifications.service.js');
  let period: typeof import('../services/analytics/period.js');
  let data: typeof import('../services/analytics/dataset.js');

  const H = 3_600_000;
  const now = new Date();
  const ago = (hours: number) => new Date(now.getTime() - hours * H);
  // Ngày giao lưu như dữ liệu thật: nửa đêm UTC của ngày VN + khung giờ dạng chữ
  const vnDay = (d: Date) => {
    const x = new Date(d.getTime() + 7 * H);
    return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
  };
  const vnHHMM = (d: Date) => {
    const x = new Date(d.getTime() + 7 * H);
    return `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`;
  };
  const order = (id: string, o: any) => ({ _id: id, DON_HANG_ID: id, PHI_VAN_CHUYEN: 0, VAT: 0, TIEN_COC: 0, KHACH_HANG_ID: 'C1', TEN_NGUOI_NHAN: 'Lan', DIA_CHI_GIAO_HANG: 'Q1', ...o });

  before(async () => {
    mongo = await import('../mongo.js');
    const db = await mongo.getDb();
    await db.dropDatabase();
    dash = await import('../services/analytics/dashboard.service.js');
    reports = await import('../services/analytics/reports.service.js');
    noti = await import('../services/analytics/notifications.service.js');
    period = await import('../services/analytics/period.js');
    data = await import('../services/analytics/dataset.js');
    await noti.ensureNotificationIndexes();

    const soon = new Date(now.getTime() + 20 * 60_000); // giao sau 20 phút → đỏ
    const later = new Date(now.getTime() + 90 * 60_000); // 90 phút → xanh
    await db.collection<any>('DON_HANG').insertMany([
      // Hoàn thành hôm qua: 1.000.000 gồm 30.000 ship → doanh thu thuần 970.000
      order('D1', { TRANG_THAI: 'Hoàn thành', NGAY_TAO: ago(30), NGAY_HOAN_THANH: ago(26), TONG_TIEN: 1_000_000, PHI_VAN_CHUYEN: 30_000 }),
      // Đã cọc 300.000, chưa giao (giao sau 20 phút) → KHÔNG vào doanh thu, vào K05
      order('D2', { TRANG_THAI: 'Đang chuẩn bị hàng', NGAY_TAO: ago(5), TONG_TIEN: 1_000_000, TIEN_COC: 300_000, NGAY_MUON_GIAO: vnDay(soon), KHUNG_GIO_MUON_GIAO: vnHHMM(soon) }),
      // Hủy trong kỳ, đã có tiền thu → đối chiếu phải báo
      order('D3', { TRANG_THAI: 'Đã hủy', NGAY_TAO: ago(10), NGAY_HUY: ago(9), LY_DO_HUY: 'Khách đổi ý', TONG_TIEN: 500_000 }),
      // Chờ xử lý quá 30 phút → đơn cần chú ý + thông báo
      order('D4', { TRANG_THAI: 'Chờ xử lý', NGAY_TAO: ago(2), TONG_TIEN: 400_000, NGAY_MUON_GIAO: vnDay(later), KHUNG_GIO_MUON_GIAO: vnHHMM(later) }),
      // Hoàn thành 20 ngày trước (ngoài kỳ 7 ngày) — kỳ 30 ngày mới thấy
      order('D5', { TRANG_THAI: 'Hoàn thành', NGAY_TAO: ago(24 * 21), NGAY_HOAN_THANH: ago(24 * 20), TONG_TIEN: 2_000_000 }),
      // Hoàn thành chưa có ngày hoàn thành (dữ liệu cũ) → dùng ngày giao, gắn cờ ước tính
      order('D6', { TRANG_THAI: 'Hoàn thành', NGAY_TAO: ago(50), NGAY_MUON_GIAO: vnDay(ago(48)), KHUNG_GIO_MUON_GIAO: '05:00 PM–07:00 PM', TONG_TIEN: 300_000 }),
      order('D7', { TRANG_THAI: 'Yêu cầu hoàn tiền/trả hàng', NGAY_TAO: ago(40), NGAY_YEU_CAU_HOAN_TIEN_TRA_HANG: ago(3), LY_DO_HOAN_TIEN_TRA_HANG: 'Hoa héo', TONG_TIEN: 600_000 }),
    ]);
    await db.collection<any>('DON_HANG_CHI_TIET').insertMany([
      { DON_HANG_ID: 'D1', SAN_PHAM_ID: 'SPA', SO_LUONG: 2, GIA: 485_000 },
      { DON_HANG_ID: 'D2', SAN_PHAM_ID: 'SPA', SO_LUONG: 2, GIA: 500_000 },
      { DON_HANG_ID: 'D5', SAN_PHAM_ID: 'SPB', SO_LUONG: 1, GIA: 2_000_000 },
      { DON_HANG_ID: 'D6', SAN_PHAM_ID: 'SPB', SO_LUONG: 1, GIA: 300_000 },
      { DON_HANG_ID: 'D6', SAN_PHAM_ID: 'SPC', SO_LUONG: 3, GIA: 0 },
    ]);
    await db.collection<any>('THANH_TOAN').insertMany([
      { THANH_TOAN_ID: 'T1', DON_HANG_ID: 'D1', SO_TIEN: 1_000_000, TRANG_THAI_THANH_TOAN: 'Thành công', MA_GIAO_DICH: 'GD1', NGAY_THANH_TOAN: ago(26), CONG_THANH_TOAN: 'COD' },
      { THANH_TOAN_ID: 'T1b', DON_HANG_ID: 'D1', SO_TIEN: 1_000_000, TRANG_THAI_THANH_TOAN: 'Thành công', MA_GIAO_DICH: 'GD1', NGAY_THANH_TOAN: ago(25), CONG_THANH_TOAN: 'COD' }, // trùng
      { THANH_TOAN_ID: 'T2', DON_HANG_ID: 'D2', SO_TIEN: 300_000, TRANG_THAI_THANH_TOAN: 'Thành công', MA_GIAO_DICH: 'GD2', NGAY_THANH_TOAN: ago(5), CONG_THANH_TOAN: 'Momo' },
      { THANH_TOAN_ID: 'T3', DON_HANG_ID: 'D3', SO_TIEN: 500_000, TRANG_THAI_THANH_TOAN: 'Thành công', MA_GIAO_DICH: 'GD3', NGAY_THANH_TOAN: ago(10), CONG_THANH_TOAN: 'Momo' },
      { THANH_TOAN_ID: 'T4', DON_HANG_ID: 'D4', SO_TIEN: 400_000, TRANG_THAI_THANH_TOAN: 'Thất bại', MA_GIAO_DICH: 'GD4', NGAY_THANH_TOAN: ago(2), CONG_THANH_TOAN: 'Momo' },
    ]);
    await db.collection<any>('KHACH_HANG').insertMany([{ KHACH_HANG_ID: 'C1', NGAY_DANG_KY: ago(10) }, { KHACH_HANG_ID: 'C2', NGAY_DANG_KY: ago(24 * 40) }]);
    await db.collection<any>('SAN_PHAM').insertMany([
      { SAN_PHAM_ID: 'SPA', TEN_SAN_PHAM: 'Bó A', KIEU_DANG: 'Bó hoa', CHU_DE_ID: 'CD1', TRANG_THAI: 'Đang bán' },
      { SAN_PHAM_ID: 'SPB', TEN_SAN_PHAM: 'Bó B', KIEU_DANG: 'Giỏ hoa', CHU_DE_ID: 'CD1', TRANG_THAI: 'Đang bán' },
      { SAN_PHAM_ID: 'SPC', TEN_SAN_PHAM: 'Thiệp', KIEU_DANG: 'Sản phẩm mua kèm', TRANG_THAI: 'Đang bán' },
    ]);
    await db.collection<any>('CHU_DE').insertOne({ CHU_DE_ID: 'CD1', TEN_CHU_DE: 'Tình yêu' });
    // Giá vốn: SPA có BOM (10 hồng × 8.000 = 80.000/bó); SPB không BOM
    await db.collection<any>('NGUYEN_VAT_LIEU').insertOne({ NGUYEN_VAT_LIEU_ID: 'NVL001', TEN_NGUYEN_VAT_LIEU: 'Hồng', NHOM_NVL: 'IT_HU', GIA_VON_BQ: 8000, TON_THUC: 0, TON_DANG_GIU: 0, TON_KHONG_DAT: 0, NGUONG_CANH_BAO: 0 });
    await db.collection<any>('BOM_SAN_PHAM').insertOne({ BOM_ID: 'B1', SAN_PHAM_ID: 'SPA', PHIEN_BAN: 1, TRANG_THAI: 'Hiệu lực' });
    await db.collection<any>('CHI_TIET_BOM').insertOne({ BOM_ID: 'B1', NGUYEN_VAT_LIEU_ID: 'NVL001', DINH_LUONG: 10, DON_VI_TINH: 'cành', VAI_TRO: 'Chính', DS_THAY_THE: [] });
    await db.collection<any>('YEU_CAU_DAT_HANG').insertOne({ _id: 'YC1', requestId: 'YC1', status: 'Chờ Sales tiếp nhận', createdAt: ago(1) });
    await db.collection<any>('NHAN_VIEN').insertMany([{ NHAN_VIEN_ID: 'NV1', VAI_TRO: 'Admin' }, { NHAN_VIEN_ID: 'NV2', VAI_TRO: 'Admin' }]);
  });

  after(async () => {
    await (await mongo.getDb()).dropDatabase();
    (await mongo.getMongoClient()).close();
  });

  describe('Bộ lọc thời gian & kỳ so sánh (AD02)', () => {
    test('7 ngày = 7 ngày VN, kỳ trước liền kề cùng độ dài', () => {
      const r = period.resolveRange({ preset: '7d' }, new Date('2026-10-31T10:00:00+07:00'));
      assert.equal(r.from.toISOString(), '2026-10-24T17:00:00.000Z');
      assert.equal(r.to.toISOString(), '2026-10-31T17:00:00.000Z');
      const p = period.previousRange(r);
      assert.equal(p.to.toISOString(), r.from.toISOString());
      assert.equal(r.to.getTime() - r.from.getTime(), p.to.getTime() - p.from.getTime());
    });
    test('mặc định kỳ liền trước; cùng kỳ năm trước = cùng ngày/tháng, năm − 1', () => {
      const r = period.resolveRange({ preset: '7d' }, new Date('2026-10-31T10:00:00+07:00'));
      assert.equal(period.parseCompare(undefined), 'previous');
      const p = period.compareRange(r, 'lastYear');
      assert.equal(p.label, '25/10/2025 – 31/10/2025');
      const leap = period.resolveRange({ preset: 'custom', from: '2028-02-29', to: '2028-03-01' });
      assert.equal(period.sameRangeLastYear(leap).label, '28/02/2027 – 01/03/2027');
      assert.equal(period.compareRange(r, 'previous').label, '18/10/2026 – 24/10/2026');
    });
    test('khung giờ giao dạng chữ được hiểu đúng (07:00, 05:00 PM–07:00 PM)', () => {
      const w = period.parseDeliveryWindow(new Date('2026-07-13T00:00:00.000Z'), '05:00 PM–07:00 PM')!;
      assert.equal(w.start.toISOString(), '2026-07-13T10:00:00.000Z');
      assert.equal(w.end.toISOString(), '2026-07-13T12:00:00.000Z');
    });
    test('kỳ trước = 0 → % thay đổi là null ("—")', () => assert.equal(period.pctChange(5, 0), null));
  });

  describe('KPI (D05)', () => {
    test('cọc 300.000 của đơn chưa giao KHÔNG vào doanh thu, vào tiền cọc đang giữ', async () => {
      const ov = await dash.getDashboardOverview({ preset: '7d' });
      const k = Object.fromEntries(ov.kpis.map((x: any) => [x.key, x]));
      assert.equal(k.netRevenue.value, 970_000 + 300_000); // D1 (trừ ship) + D6 (ngày ước tính)
      assert.equal(k.depositHeld.value, 300_000 + 0); // D2; D3 đã hủy không tính
      assert.equal(k.completedOrders.value, 2);
    });
    test('giao dịch trùng mã không bị cộng 2 lần; giao dịch thất bại không tính', async () => {
      const ds = await data.loadDataset();
      const r = period.resolveRange({ preset: '7d' });
      const k = dash.computeKpis(ds, r);
      assert.equal(k.cashCollected, 1_000_000 + 300_000 + 500_000);
    });
    test('tỷ lệ hủy theo cohort ngày tạo; đổi bộ lọc thì số đổi theo', async () => {
      const ds = await data.loadDataset();
      const k7 = dash.computeKpis(ds, period.resolveRange({ preset: '7d' }));
      const k30 = dash.computeKpis(ds, period.resolveRange({ preset: '30d' }));
      assert.equal(k7.newOrders, 6);
      assert.equal(k7.cancelRate, Math.round((1 / 6) * 1000) / 10);
      assert.equal(k30.netRevenue, k7.netRevenue + 2_000_000);
    });
  });

  describe('Lịch giao, đơn cần chú ý, bán chạy (AD05–AD07)', () => {
    test('đơn giao sau 20 phút → đỏ; 90 phút → xanh; đơn chưa xác nhận không vào lịch giao', async () => {
      const ds = await data.loadDataset();
      const items = dash.computeDeliveries(ds, 'window');
      assert.deepEqual(items.map((i: any) => [i.orderId, i.urgency]), [['D2', 'red']]);
    });
    test('đơn cần chú ý: chờ xử lý lâu, yêu cầu trả/hoàn, sắp giao mà chưa giao', async () => {
      const ds = await data.loadDataset();
      const rows = dash.computeAttentionOrders(ds, new Set());
      const byId = Object.fromEntries(rows.map((r: any) => [r.orderId, r.reasons.map((x: any) => x.code)]));
      assert.ok(byId.D4.includes('pendingTooLong'));
      assert.ok(byId.D7.includes('refundRequest'));
      assert.ok(byId.D2.includes('deliveryAtRisk'));
      assert.equal(byId.D1, undefined);
    });
    test('bán chạy chỉ tính đơn hoàn thành; hòa số lượng thì xếp theo doanh thu', async () => {
      const ds = await data.loadDataset();
      const top = await dash.computeBestProducts(ds, period.resolveRange({ preset: '7d' }), 'quantity', 5);
      assert.deepEqual(top.map((t: any) => [t.productId, t.quantity]), [['SPC', 3], ['SPA', 2], ['SPB', 1]]);
      const byRev = await dash.computeBestProducts(ds, period.resolveRange({ preset: '7d' }), 'revenue', 5);
      assert.equal(byRev[0].productId, 'SPA');
    });
  });

  describe('Báo cáo & lợi nhuận (AD04, AD60)', () => {
    test('giá vốn: có BOM → định mức; không BOM → "Chưa đủ dữ liệu" (không tính 0)', async () => {
      const rep = await reports.getAnalyticsReport({ preset: '7d', groupBy: 'day' });
      const a = rep.byProduct.find((p: any) => p.productId === 'SPA')!;
      const b = rep.byProduct.find((p: any) => p.productId === 'SPB')!;
      assert.equal(a.cost, 2 * 80_000);
      assert.equal(a.grossProfit, 970_000 - 160_000);
      assert.equal(b.cost, null);
      assert.ok(rep.profit.coverage! < 100);
    });
    test('giá vốn thực tế từ phiếu xuất được ưu tiên', async () => {
      await (await mongo.getCollection<any>('PHIEU_XUAT_NVL')).insertOne({ PHIEU_XUAT_ID: 'PX1', DON_HANG_ID: 'D1', LOAI_XUAT: 'Làm hoa theo đơn', TRANG_THAI: 'Đã ghi nhận', TONG_GIA_VON: 150_000 });
      // ghi trực tiếp DB (giả lập module kho) → xóa cache như các luồng ghi thật
      (await import('../services/analytics/cache.js')).invalidateAnalyticsCache();
      const rep = await reports.getAnalyticsReport({ preset: '7d' });
      const a = rep.byProduct.find((p: any) => p.productId === 'SPA')!;
      assert.equal(a.cost, 150_000);
      assert.match(a.costMethod, /Thực tế/);
    });
    test('nhóm theo tháng/quý chạy được; lý do hủy được gom', async () => {
      const rep = await reports.getAnalyticsReport({ preset: 'thisYear', groupBy: 'quarter' });
      assert.ok(rep.periods.length >= 4);
      const rep2 = await reports.getAnalyticsReport({ preset: '7d' });
      assert.equal(rep2.cancelReasons[0].reason, 'Khách đổi ý');
    });
  });

  describe('Cache Dashboard', () => {
    test('gộp request đồng thời, trả cache trong ttl, fresh/invalidate đọc lại', async () => {
      const cache = await import('../services/analytics/cache.js');
      cache.invalidateAnalyticsCache();
      let loads = 0;
      const load = async () => { loads++; await new Promise((r) => setTimeout(r, 30)); return loads; };
      const [a, b] = await Promise.all([cache.swr('t', { ttlMs: 10_000 }, load), cache.swr('t', { ttlMs: 10_000 }, load)]);
      assert.equal(loads, 1); assert.equal(a, b);
      assert.equal(await cache.swr('t', { ttlMs: 10_000 }, load), 1);
      assert.equal(await cache.swr('t', { ttlMs: 10_000, fresh: true }, load), 2);
      cache.invalidateAnalyticsCache('t');
      assert.equal(await cache.swr('t', { ttlMs: 10_000 }, load), 3);
      // quá ttl nhưng còn trong maxStale → trả bản cũ ngay, làm mới ngầm
      assert.equal(await cache.swr('t', { ttlMs: 0, maxStaleMs: 10_000 }, load), 3);
      await new Promise((r) => setTimeout(r, 60));
      assert.equal(await cache.swr('t', { ttlMs: 10_000 }, load), 4);
      // allowStale=false → chờ đọc mới
      assert.equal(await cache.swr('t', { ttlMs: 0, maxStaleMs: 10_000, allowStale: false }, load), 5);
    });
  });

  describe('Đối chiếu đơn – tiền – kho', () => {
    test('phát hiện giao dịch trùng, đơn hủy vẫn có tiền, đơn hoàn thành ước tính ngày', async () => {
      const rec = await reports.getReconciliation();
      const count = (code: string) => rec.issues.find((i: any) => i.code === code)!.count;
      assert.equal(count('DUP_TRANSACTION'), 1);
      assert.equal(count('PAID_BUT_VOID'), 1);
      assert.equal(count('NO_COMPLETION_DATE'), 1);
      assert.ok(count('PAID_LESS') >= 1); // D5, D6 không có giao dịch
    });
  });

  describe('Thông báo Admin (AD09)', () => {
    test('sinh thông báo theo nhóm, không trùng khi quét lại', async () => {
      await noti.syncAdminNotifications(true);
      await noti.syncAdminNotifications(true);
      const list = await noti.listAdminNotifications({ id: 'NV1', role: 'Admin' }, {});
      const keys = list.items.map((i: any) => i.type);
      assert.ok(keys.includes('ORDER_PENDING_LONG'));
      assert.ok(keys.includes('SALES_REQUEST_NEW'));
      assert.ok(keys.includes('REFUND_REQUEST'));
      assert.ok(keys.includes('RECONCILE_ISSUE'));
      const dup = await (await mongo.getCollection<any>('THONG_BAO_ADMIN')).aggregate([{ $group: { _id: '$KHOA_SU_KIEN', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
      assert.equal(dup.length, 0);
      assert.ok(list.unreadByGroup['Đơn hàng'] > 0);
    });
    test('đã đọc theo TỪNG nhân viên', async () => {
      const l1 = await noti.listAdminNotifications({ id: 'NV1', role: 'Admin' }, {});
      const target = l1.items[0];
      await noti.markAdminNotificationsRead('NV1', [target.id]);
      const a = await noti.listAdminNotifications({ id: 'NV1', role: 'Admin' }, {});
      const b = await noti.listAdminNotifications({ id: 'NV2', role: 'Admin' }, {});
      assert.equal(a.items.find((i: any) => i.id === target.id)!.read, true);
      assert.equal(b.items.find((i: any) => i.id === target.id)!.read, false);
      assert.equal(a.unread, b.unread - 1);
    });
    test('xử lý xong thì thông báo trạng thái tự đóng', async () => {
      await (await mongo.getCollection<any>('DON_HANG')).updateOne({ DON_HANG_ID: 'D4' }, { $set: { TRANG_THAI: 'Đang chuẩn bị hàng' } });
      await noti.syncAdminNotifications(true);
      const l = await noti.listAdminNotifications({ id: 'NV1', role: 'Admin' }, {});
      assert.equal(l.items.some((i: any) => i.type === 'ORDER_PENDING_LONG'), false);
    });
    test('không có vai trò → không thấy thông báo; thiếu mã NV → không lưu đã đọc', async () => {
      const l = await noti.listAdminNotifications({ id: null, role: null }, {});
      assert.equal(l.total, 0);
      await assert.rejects(noti.markAdminNotificationsRead(null, 'all'));
    });
  });
}
