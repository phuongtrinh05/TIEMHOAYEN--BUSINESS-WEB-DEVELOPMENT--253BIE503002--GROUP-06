/**
 * Kiểm thử nghiệp vụ kho (Stage plan §08 + D01).
 * Chạy: TEST_MONGO_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0" npm run test:inventory
 * Cần MongoDB replica set (Atlas hoặc mongod --replSet) vì dùng transaction.
 * Test tự tạo database riêng TIEM_HOA_YEN_INVENTORY_TEST và XÓA SẠCH sau khi chạy — KHÔNG trỏ vào DB thật.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const uri = process.env.TEST_MONGO_URI;
const DB = 'TIEM_HOA_YEN_INVENTORY_TEST';

if (!uri) {
  test('bỏ qua: chưa đặt TEST_MONGO_URI', { skip: true }, () => {});
} else {
  process.env.MONGO_URI = uri;
  process.env.MONGO_DATABASE = DB;
  process.env.INVENTORY_HOLD_MINUTES = '5';

  let mongo: typeof import('../mongo.js');
  let stock: typeof import('../services/inventory/stock.service.js');
  let master: typeof import('../services/inventory/master-data.service.js');
  let bom: typeof import('../services/inventory/bom.service.js');
  let avail: typeof import('../services/inventory/availability.service.js');
  let K: typeof import('../services/inventory/constants.js');
  const actor = { id: 'NV001', role: 'Admin' };

  const material = async (id: string) => (await mongo.getCollection<any>('NGUYEN_VAT_LIEU')).findOne({ NGUYEN_VAT_LIEU_ID: id });
  const available = (m: any) => m.TON_THUC - m.TON_DANG_GIU - m.TON_KHONG_DAT;
  const importAndPost = async (lines: any[], extra: any = {}) => {
    const pn: any = await stock.createImport({ type: K.IMPORT_TYPES.purchase, supplierId: 'NCC001', details: lines, ...extra }, actor);
    return stock.postImport(pn.PHIEU_NHAP_ID, actor);
  };

  before(async () => {
    mongo = await import('../mongo.js');
    const db = await mongo.getDb();
    await db.dropDatabase();
    K = await import('../services/inventory/constants.js');
    stock = await import('../services/inventory/stock.service.js');
    master = await import('../services/inventory/master-data.service.js');
    bom = await import('../services/inventory/bom.service.js');
    avail = await import('../services/inventory/availability.service.js');
    const { ensureInventoryIndexes } = await import('../services/inventory/setup.js');
    await ensureInventoryIndexes();

    await db.collection<any>('NHA_CUNG_CAP').insertMany([
      { _id: 'NCC001', NHA_CUNG_CAP_ID: 'NCC001', TEN_NHA_CUNG_CAP: 'Vườn Hoa Đà Lạt', TRANG_THAI: 'Hoạt động', SO_NGAY_GIAO_MAC_DINH: 1, GIO_CHOT_DON: '12:00' },
      { _id: 'NCC007', NHA_CUNG_CAP_ID: 'NCC007', TEN_NHA_CUNG_CAP: 'Tạm ngưng', TRANG_THAI: 'Tạm ngưng' },
    ]);
    for (const m of [
      { code: 'NVL001', name: 'Hoa hồng', unit: 'cành', group: 'DE_HU', type: 'Hoa tươi', importPrice: 8000, threshold: 220, substitutionGroup: 'HONG' },
      { code: 'NVL004', name: 'Hoa cẩm chướng', unit: 'cành', group: 'DE_HU', type: 'Hoa tươi', importPrice: 4500, threshold: 30, substitutionGroup: 'HONG' },
      { code: 'NVL051', name: 'Giấy gói', unit: 'Tờ', group: 'IT_HU', type: 'Giấy gói', importPrice: 3000, threshold: 20 },
      { code: 'NVL075', name: 'Ruy băng', unit: 'm', group: 'IT_HU', type: 'Ruy băng', importPrice: 2500, threshold: 20 },
    ]) await master.createMaterial(m, actor);
    await db.collection<any>('SAN_PHAM').insertMany([
      { _id: 'SPA', SAN_PHAM_ID: 'SPA', TEN_SAN_PHAM: 'Bó A (10 hồng)', TRANG_THAI: 'Đang bán', GIA: 500000 },
      { _id: 'SPB', SAN_PHAM_ID: 'SPB', TEN_SAN_PHAM: 'Bó B ruy băng', TRANG_THAI: 'Đang bán', GIA: 200000 },
    ]);
    await db.collection<any>('DON_HANG').insertMany(['DH1', 'DH2', 'DH3'].map((id) => ({ _id: id, DON_HANG_ID: id, TRANG_THAI: 'Chờ xử lý' })));
    await db.collection<any>('DON_HANG_CHI_TIET').insertMany([{ DON_HANG_ID: 'DH1', SAN_PHAM_ID: 'SPA', SO_LUONG: 2 }]);
    await bom.createBomVersion('SPA', { activate: true, lines: [
      { materialId: 'NVL001', quantity: 10, role: 'Chính', substitutes: ['NVL004'] },
      { materialId: 'NVL051', quantity: 2, role: 'Phụ liệu' },
    ] }, actor);
    await bom.createBomVersion('SPB', { activate: true, lines: [
      { materialId: 'NVL004', quantity: 1, role: 'Chính' },
      { materialId: 'NVL075', quantity: 1.2, role: 'Phụ liệu' },
    ] }, actor);
  });

  after(async () => {
    const db = await mongo.getDb();
    await db.dropDatabase();
    (await mongo.getMongoClient()).close();
  });

  describe('Phiếu nhập', () => {
    test('nhập 20, đạt 18 → tồn tăng 18; ghi nhận lần 2 không cộng thêm; giá vốn phân bổ vào SL đạt', async () => {
      const pn: any = await stock.createImport({ type: K.IMPORT_TYPES.purchase, supplierId: 'NCC001', details: [{ materialId: 'NVL001', receivedQty: 20, rejectedQty: 2, unitPrice: 8000 }] }, actor);
      await stock.postImport(pn.PHIEU_NHAP_ID, actor);
      const again: any = await stock.postImport(pn.PHIEU_NHAP_ID, actor);
      assert.equal(again.alreadyPosted, true);
      const m = await material('NVL001');
      assert.equal(m.TON_THUC, 18);
      const detail = await (await mongo.getCollection<any>('CHI_TIET_PHIEU_NHAP_NVL')).findOne({ PHIEU_NHAP_ID: pn.PHIEU_NHAP_ID });
      assert.equal(detail.DON_GIA_VON, Math.round(160000 / 18));
    });

    test('đạt + không đạt ≠ thực nhận → báo lỗi', async () => {
      await assert.rejects(stock.createImport({ supplierId: 'NCC001', details: [{ materialId: 'NVL001', receivedQty: 10, acceptedQty: 7, rejectedQty: 2, unitPrice: 1 }] }, actor), /phải bằng/);
    });

    test('NCC tạm ngưng không ghi nhận được; phiếu Posted không sửa được', async () => {
      const pn: any = await stock.createImport({ supplierId: 'NCC007', details: [{ materialId: 'NVL001', receivedQty: 1, unitPrice: 1 }] }, actor);
      await assert.rejects(stock.postImport(pn.PHIEU_NHAP_ID, actor), /Tạm ngưng/);
      const ok: any = await importAndPost([{ materialId: 'NVL051', receivedQty: 100, unitPrice: 3000 }]);
      await assert.rejects(stock.updateImport(ok.PHIEU_NHAP_ID, { details: [] }, actor), /không sửa trực tiếp/);
      await assert.rejects(stock.deleteDraftDocument('import', ok.PHIEU_NHAP_ID), /không được xóa/);
    });
  });

  describe('Giữ tồn', () => {
    test('BOM 10 cành/bó × 2 bó = 20 cành; đơn khác không dùng trùng phần đã giữ', async () => {
      await importAndPost([{ materialId: 'NVL001', receivedQty: 12, unitPrice: 8000 }]); // tổng 30
      const r: any = await stock.reserveProducts([{ productId: 'SPA', quantity: 2 }], { status: 'CHINH_THUC', orderId: 'DH1', actor });
      const roses = r.reservations.filter((x: any) => x.NGUYEN_VAT_LIEU_ID === 'NVL001').reduce((s: number, x: any) => s + x.SO_LUONG, 0);
      assert.equal(roses, 20);
      assert.equal(available(await material('NVL001')), 10);
      await assert.rejects(stock.reserveProducts([{ productId: 'SPA', quantity: 2 }], { status: 'CHINH_THUC', orderId: 'DH2', actor }), (e: any) => {
        assert.equal(e.status, 409);
        assert.equal(e.details.shortages[0].missing, 10);
        return true;
      });
    });

    test('hai khách đồng thời giữ bó cuối cùng → chỉ một thành công', async () => {
      // còn 10 hồng khả dụng = đúng 1 bó A
      const results = await Promise.allSettled([
        stock.reserveProducts([{ productId: 'SPA', quantity: 1 }], { status: 'TAM_CHO_QR', paymentSessionId: 'QR-1', actor }),
        stock.reserveProducts([{ productId: 'SPA', quantity: 1 }], { status: 'TAM_CHO_QR', paymentSessionId: 'QR-2', actor }),
      ]);
      assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
      assert.equal(available(await material('NVL001')), 0);
    });

    test('giữ tạm quá hạn được nhả; xác nhận sau hạn bị từ chối; xác nhận 2 lần không giữ thêm', async () => {
      const resCol = await mongo.getCollection<any>('GIU_TON');
      const held = await resCol.findOne({ MA_PHIEN_THANH_TOAN: { $in: ['QR-1', 'QR-2'] }, TRANG_THAI: 'TAM_CHO_QR' });
      await resCol.updateMany({ MA_PHIEN_THANH_TOAN: held.MA_PHIEN_THANH_TOAN }, { $set: { HET_HAN_LUC: new Date(Date.now() - 1000) } });
      await assert.rejects(stock.confirmReservations({ paymentSessionId: held.MA_PHIEN_THANH_TOAN }, 'DH3', actor), (e: any) => e.status === 410);
      const swept = await stock.sweepExpiredReservations();
      assert.ok(swept.released >= 1);
      assert.equal(available(await material('NVL001')), 10);

      await stock.reserveProducts([{ productId: 'SPA', quantity: 1 }], { status: 'TAM_CHO_QR', paymentSessionId: 'QR-3', actor });
      const before = await material('NVL001');
      const c1 = await stock.confirmReservations({ paymentSessionId: 'QR-3' }, 'DH3', actor);
      const c2 = await stock.confirmReservations({ paymentSessionId: 'QR-3' }, 'DH3', actor);
      assert.ok(c1.confirmed > 0);
      assert.equal(c2.alreadyConfirmed, true);
      assert.equal((await material('NVL001')).TON_DANG_GIU, before.TON_DANG_GIU);
    });

    test('hủy đơn trước khi xuất → nhả toàn bộ phần giữ', async () => {
      const result = await stock.cancelOrderInventory('DH3', actor);
      assert.ok(result.released > 0);
      assert.equal(available(await material('NVL001')), 10);
    });
  });

  describe('Phiếu xuất', () => {
    test('xuất cho đơn: giảm tồn thực x, kết thúc giữ n; gọi lần 2 không trừ', async () => {
      const lines = await stock.suggestExportLines({ type: K.EXPORT_TYPES.order, orderId: 'DH1' });
      assert.deepEqual(lines.find((l: any) => l.materialId === 'NVL001')?.quantity, 20);
      const before = await material('NVL001');
      // thực lấy 18 < 20 đã giữ → nhả 2
      const px: any = await stock.createExport({ type: K.EXPORT_TYPES.order, orderId: 'DH1', details: lines.map((l: any) => ({ ...l, quantity: l.materialId === 'NVL001' ? 18 : l.quantity })) }, actor);
      await stock.postExport(px.PHIEU_XUAT_ID, actor);
      const again: any = await stock.postExport(px.PHIEU_XUAT_ID, actor);
      assert.equal(again.alreadyPosted, true);
      const after1 = await material('NVL001');
      assert.equal(after1.TON_THUC, before.TON_THUC - 18);
      assert.equal(after1.TON_DANG_GIU, before.TON_DANG_GIU - 20);
      assert.equal(available(after1), available(before) + 2);
      // Phiếu xuất thứ 2 cho cùng đơn bị chặn
      const px2: any = await stock.createExport({ type: K.EXPORT_TYPES.order, orderId: 'DH1', details: [{ materialId: 'NVL001', quantity: 1 }] }, actor);
      await assert.rejects(stock.postExport(px2.PHIEU_XUAT_ID, actor), /đã xuất NVL/);
    });

    test('FIFO: lấy nguồn nhập cũ trước, lưu giá vốn từng nguồn', async () => {
      await importAndPost([{ materialId: 'NVL004', receivedQty: 12, unitPrice: 4000 }], { receivedAt: '2026-10-01T01:00:00Z' });
      await importAndPost([{ materialId: 'NVL004', receivedQty: 20, unitPrice: 5000 }], { receivedAt: '2026-10-02T01:00:00Z' });
      const px: any = await stock.createExport({ type: K.EXPORT_TYPES.readyMade, productId: 'SPB', bundles: 20, details: [{ materialId: 'NVL004', quantity: 20 }, { materialId: 'NVL075', quantity: 24 }] }, actor);
      // thiếu ruy băng → lỗi, transaction hủy, không trừ gì
      await assert.rejects(stock.postExport(px.PHIEU_XUAT_ID, actor));
      assert.equal((await material('NVL004')).TON_THUC, 32);
      await importAndPost([{ materialId: 'NVL075', receivedQty: 30, unitPrice: 2500 }]);
      await stock.postExport(px.PHIEU_XUAT_ID, actor);
      const d = await (await mongo.getCollection<any>('CHI_TIET_PHIEU_XUAT_NVL')).findOne({ PHIEU_XUAT_ID: px.PHIEU_XUAT_ID, NGUYEN_VAT_LIEU_ID: 'NVL004' });
      assert.deepEqual(d.PHAN_BO.map((a: any) => [a.SO_LUONG, a.DON_GIA_VON]), [[12, 4000], [8, 5000]]);
      const product = await (await mongo.getCollection<any>('SAN_PHAM')).findOne({ SAN_PHAM_ID: 'SPB' });
      assert.equal(product.TON_THANH_PHAM, 20); // thành phẩm tăng do cắm sẵn, NVL không bị trừ lần 2 khi bán
    });

    test('không xuất vượt khả dụng', async () => {
      const px: any = await stock.createExport({ type: K.EXPORT_TYPES.storageLoss, details: [{ materialId: 'NVL004', quantity: 999 }] }, actor);
      await assert.rejects(stock.postExport(px.PHIEU_XUAT_ID, actor), (e: any) => e.status === 409);
    });

    test('đánh dấu không đạt giảm khả dụng, xuất hủy cách ly giảm tồn thực', async () => {
      const before = await material('NVL004');
      await stock.markMaterialDamaged({ materialId: 'NVL004', quantity: 3 }, actor);
      const mid = await material('NVL004');
      assert.equal(mid.TON_THUC, before.TON_THUC);
      assert.equal(available(mid), available(before) - 3);
      const px: any = await stock.createExport({ type: K.EXPORT_TYPES.quarantineDisposal, details: [{ materialId: 'NVL004', quantity: 3 }] }, actor);
      await stock.postExport(px.PHIEU_XUAT_ID, actor);
      const end = await material('NVL004');
      assert.equal(end.TON_THUC, before.TON_THUC - 3);
      assert.equal(end.TON_KHONG_DAT, 0);
    });
  });

  describe('Tính khả dụng, BOM, danh mục', () => {
    test('số bó sát ngưỡng không làm tròn lên; định lượng thập phân chia đúng', () => {
      const calculate = (onHand: number, quantity: number) => avail.computeBuildable([
        { NGUYEN_VAT_LIEU_ID: 'X', DINH_LUONG: quantity } as any,
      ], new Map([['X', { TON_THUC: onHand }]])).buildable;
      assert.equal(calculate(999.999, 1000), 0);
      assert.equal(calculate(1000, 1000), 1);
      assert.equal(calculate(0.3, 0.1), 3);
    });

    test('cùng mã phiên gửi đồng thời chỉ giữ một lần, không đổi nội dung hoặc giữ lại sau nhả', async () => {
      const ctx = { status: K.RESERVATION_STATUS.temporary, paymentSessionId: 'SAME-KEY', actor };
      const before = await material('NVL004');
      const results = await Promise.all([1, 2].map(() => stock.reserveProducts([{ productId: 'SPB', quantity: 1 }], ctx)));
      assert.equal(results.filter(r => r.idempotent).length, 1);
      assert.equal(results[0].reservations.length, results[1].reservations.length);
      await assert.rejects(stock.reserveProducts([{ productId: 'SPB', quantity: 2 }], ctx), /nội dung khác/);
      await stock.releaseReservations({ paymentSessionId: 'SAME-KEY' }, actor);
      assert.equal((await stock.reserveProducts([{ productId: 'SPB', quantity: 1 }], ctx)).idempotent, true);
      assert.equal((await material('NVL004')).TON_DANG_GIU, before.TON_DANG_GIU);
    });

    test('bỏ sót NVL đã giữ phải chặn Posted; dòng thực lấy 0 nhả hết phần dư', async () => {
      await (await mongo.getCollection<any>('DON_HANG')).insertOne({ DON_HANG_ID: 'AUDIT-EXPORT' });
      const { withTransaction } = await import('../services/inventory/helpers.js');
      await withTransaction(session => stock.reserveMaterialNeeds(session, new Map([['NVL004', 1], ['NVL075', 1]]), {
        status: K.RESERVATION_STATUS.official, orderId: 'AUDIT-EXPORT', actor,
      }));
      const px: any = await stock.createExport({ type: K.EXPORT_TYPES.order, orderId: 'AUDIT-EXPORT', details: [{ materialId: 'NVL004', quantity: 1 }] }, actor);
      const before = await material('NVL004');
      await assert.rejects(stock.postExport(px.PHIEU_XUAT_ID, actor), /thiếu NVL đã giữ/);
      assert.equal((await material('NVL004')).TON_THUC, before.TON_THUC);
      await stock.updateExport(px.PHIEU_XUAT_ID, { type: K.EXPORT_TYPES.order, orderId: 'AUDIT-EXPORT', details: [
        { materialId: 'NVL004', quantity: 1 }, { materialId: 'NVL075', quantity: 0 },
      ] }, actor);
      await stock.postExport(px.PHIEU_XUAT_ID, actor);
      assert.equal(await (await mongo.getCollection<any>('GIU_TON')).countDocuments({ DON_HANG_ID: 'AUDIT-EXPORT', TRANG_THAI: 'CHINH_THUC' }), 0);
    });

    test('nhập hoàn kiểm tra PX, giới hạn đồng thời và giữ giá vốn gốc', async () => {
      const bad: any = await stock.createImport({ type: K.IMPORT_TYPES.return, originalExportId: 'DOES_NOT_EXIST', details: [{ materialId: 'NVL004', receivedQty: 999, unitPrice: 1 }] }, actor);
      await assert.rejects(stock.postImport(bad.PHIEU_NHAP_ID, actor), /phiếu xuất gốc/);
      const px: any = await stock.createExport({ type: K.EXPORT_TYPES.other, note: 'Audit return', details: [{ materialId: 'NVL075', quantity: 2 }] }, actor);
      await stock.postExport(px.PHIEU_XUAT_ID, actor);
      const makeReturn = () => stock.createImport({ type: K.IMPORT_TYPES.return, originalExportId: px.PHIEU_XUAT_ID, details: [{ materialId: 'NVL075', receivedQty: 2, unitPrice: 1 }] }, actor);
      const a: any = await makeReturn(), b: any = await makeReturn();
      const before = await material('NVL075');
      const results = await Promise.allSettled([stock.postImport(a.PHIEU_NHAP_ID, actor), stock.postImport(b.PHIEU_NHAP_ID, actor)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await material('NVL075')).TON_THUC, before.TON_THUC + 2);
      const id = results[0].status === 'fulfilled' ? a.PHIEU_NHAP_ID : b.PHIEU_NHAP_ID;
      const receipt: any = await stock.getImport(id);
      assert.equal(receipt.details[0].DON_GIA_VON, 2500);
      assert.ok(receipt.details[0].PHAN_BO_NGUON_GOC[0].PHIEU_NHAP_ID);
      assert.equal((await stock.postImport(id, actor)).alreadyPosted, true);
    });
    test('số bó làm được = min ⌊khả dụng / định mức⌋, có NVL chốt chặn', async () => {
      const ms = await (await mongo.getCollection<any>('NGUYEN_VAT_LIEU')).find({}).toArray();
      const r = avail.computeBuildable([
        { NGUYEN_VAT_LIEU_ID: 'NVL004', DINH_LUONG: 1 } as any,
        { NGUYEN_VAT_LIEU_ID: 'NVL075', DINH_LUONG: 1.2 } as any,
      ], new Map(ms.map((m: any) => [m.NGUYEN_VAT_LIEU_ID, m])));
      assert.equal(r.buildable, 5); // ruy băng còn 6m / 1.2 = 5
      assert.equal(r.bottleneck.materialId, 'NVL075');
    });

    test('đơn tương lai: PO đang giao kịp → available; quá hạn PO → need_review', async () => {
      const deliver = new Date(Date.now() + 3 * 86_400_000);
      const before = await avail.checkProductAvailability('SPA', 3, deliver.toISOString());
      assert.equal(before.decision, 'need_review');
      const po: any = await master.createPurchaseOrder({ supplierId: 'NCC001', expectedAt: new Date(Date.now() + 86_400_000), lines: [{ materialId: 'NVL001', quantity: 50 }, { materialId: 'NVL051', quantity: 10 }] }, actor);
      await master.changePurchaseOrderStatus(po.PO_ID, K.PO_STATUS.waiting, actor);
      const stillWaiting = await avail.checkProductAvailability('SPA', 3, deliver.toISOString());
      assert.equal(stillWaiting.decision, 'need_review'); // PO chưa "Đang giao" không tính
      await master.changePurchaseOrderStatus(po.PO_ID, K.PO_STATUS.shipping, actor);
      const ok = await avail.checkProductAvailability('SPA', 3, deliver.toISOString());
      assert.equal(ok.decision, 'available');
    });

    test('BOM: không trùng NVL, phải có NVL Chính, thay thế phải cùng nhóm', async () => {
      const { errors } = await bom.validateBomLines([
        { materialId: 'NVL001', quantity: 1, role: 'Phụ', substitutes: ['NVL051'] },
        { materialId: 'NVL001', quantity: 2, role: 'Phụ' },
      ]);
      assert.ok(errors.some((e) => /trùng/.test(e)));
      assert.ok(errors.some((e) => /Chính/.test(e)));
      assert.ok(errors.some((e) => /nhóm thay thế/.test(e)));
    });

    test('BOM phiên bản mới thay phiên bản cũ, đồng bộ công thức cũ', async () => {
      const v2: any = await bom.createBomVersion('SPA', { lines: [{ materialId: 'NVL001', quantity: 12, role: 'Chính' }] }, actor);
      await bom.activateBom(v2.BOM_ID, actor);
      const list = await bom.listProductBoms('SPA');
      assert.deepEqual(list.boms.map((b: any) => [b.PHIEN_BAN, b.TRANG_THAI]), [[2, 'Hiệu lực'], [1, 'Ngừng sử dụng']]);
      const recipe = await (await mongo.getCollection<any>('CONG_THUC_SAN_PHAM')).find({ SAN_PHAM_ID: 'SPA' }).toArray();
      assert.equal(recipe.length, 1);
      assert.equal(recipe[0].SO_LUONG_CAN, 12);
    });

    test('NVL: không nhập tồn khi tạo; đã có giao dịch thì chỉ ẩn', async () => {
      await assert.rejects(master.createMaterial({ name: 'Hoa X', unit: 'cành', quantity: 5 }, actor), /Không nhập tồn/);
      const r = await master.deleteOrHideMaterial('NVL001', actor);
      assert.equal(r.hidden, true);
      await master.updateMaterial('NVL001', { active: true }, actor);
    });

    test('đối soát: bộ đếm khớp sổ biến động', async () => {
      const r = await stock.reconcileInventory(false);
      assert.equal(r.ok, true, JSON.stringify(r.diffs));
    });
  });
  describe('Đảo phiếu và bộ lọc PN', () => {
    test('PN chỉ đảo trong 24 giờ từ ghi nhận; quá hạn và thiếu thời gian bị chặn, không đổi tồn', async()=>{
      const {reverseInventoryDocument:reverse}=await import('../services/inventory/reversal.service.js');
      await master.createMaterial({code:'REV_TIME',name:'Hạn đảo',unit:'cành',group:'DE_HU',type:'Hoa tươi'},actor);
      const verified={reason:'Ghi nhận sai cần đảo',physicallyVerified:true};
      const recent:any=await importAndPost([{materialId:'REV_TIME',receivedQty:2,unitPrice:100}]);
      await (await mongo.getCollection<any>('PHIEU_NHAP_NVL')).updateOne({PHIEU_NHAP_ID:recent.PHIEU_NHAP_ID},{$set:{NGAY_XAC_NHAN:new Date(Date.now()-86400000+60000)}});
      await reverse('import',recent.PHIEU_NHAP_ID,verified,actor);
      const expired:any=await importAndPost([{materialId:'REV_TIME',receivedQty:3,unitPrice:100}]);
      await (await mongo.getCollection<any>('PHIEU_NHAP_NVL')).updateOne({PHIEU_NHAP_ID:expired.PHIEU_NHAP_ID},{$set:{NGAY_XAC_NHAN:new Date(Date.now()-86400000)}});
      await assert.rejects(reverse('import',expired.PHIEU_NHAP_ID,verified,actor),/quá hạn/);
      assert.equal((await material('REV_TIME')).TON_THUC,3);
      await (await mongo.getCollection<any>('PHIEU_NHAP_NVL')).updateOne({PHIEU_NHAP_ID:expired.PHIEU_NHAP_ID},{$unset:{NGAY_XAC_NHAN:''}});
      await assert.rejects(reverse('import',expired.PHIEU_NHAP_ID,verified,actor),/thời điểm ghi nhận/);
      await (await mongo.getCollection<any>('PHIEU_NHAP_NVL')).updateOne({PHIEU_NHAP_ID:recent.PHIEU_NHAP_ID},{$set:{NGAY_XAC_NHAN:new Date(0)}});
      assert.equal((await reverse('import',recent.PHIEU_NHAP_ID,verified,actor)).alreadyReversed,true);
    });

    test('đảo PN đồng thời chỉ một lần, giữ liên kết gốc và khớp sổ', async () => {
      const { reverseInventoryDocument: reverse } = await import('../services/inventory/reversal.service.js');
      await master.createMaterial({code:'REV1',name:'Kiểm thử đảo',unit:'cành',group:'DE_HU',type:'Hoa tươi'},actor);
      const pn:any = await importAndPost([{materialId:'REV1',receivedQty:10,unitPrice:100}]);
      const payload={reason:'Ghi nhận nhầm phiếu',physicallyVerified:true};
      const results=await Promise.all([reverse('import',pn.PHIEU_NHAP_ID,payload,actor),reverse('import',pn.PHIEU_NHAP_ID,payload,actor)]);
      assert.equal(results.filter(r=>r.alreadyReversed).length,1);
      assert.equal((await material('REV1')).TON_THUC,0);
      const original:any=await stock.getImport(pn.PHIEU_NHAP_ID);
      assert.equal(original.DA_DAO,true);assert.equal(original.TRANG_THAI,K.DOC_STATUS.posted);
      assert.equal((await stock.reconcileInventory(false)).ok,true);
    });
    test('đảo PX phục hồi nguồn, giá vốn; PN đã dùng và PX liên kết bị chặn',async()=>{
      const { reverseInventoryDocument:reverse }=await import('../services/inventory/reversal.service.js');
      const pn:any=await importAndPost([{materialId:'REV1',receivedQty:10,unitPrice:200}]);
      const px:any=await stock.createExport({type:K.EXPORT_TYPES.other,note:'Kiểm thử đảo phiếu',details:[{materialId:'REV1',quantity:4}]},actor);
      await stock.postExport(px.PHIEU_XUAT_ID,actor);
      const payload={reason:'Kiểm tra ghi nhận sai',physicallyVerified:true};
      await assert.rejects(reverse('import',pn.PHIEU_NHAP_ID,payload,actor),/đã được dùng/);
      await reverse('export',px.PHIEU_XUAT_ID,payload,actor);
      assert.equal((await material('REV1')).TON_THUC,10);assert.equal((await material('REV1')).GIA_VON_BQ,200);
      const source:any=await (await mongo.getCollection<any>('CHI_TIET_PHIEU_NHAP_NVL')).findOne({PHIEU_NHAP_ID:pn.PHIEU_NHAP_ID});
      assert.equal(source.SL_DA_XUAT,0);assert.equal(source.SL_CON_LAI,10);
      const linked:any=await (await mongo.getCollection<any>(K.COLLECTIONS.exportSlip)).findOne({DON_HANG_ID:'DH1',TRANG_THAI:K.DOC_STATUS.posted});
      await (await mongo.getCollection<any>(K.COLLECTIONS.order)).updateOne({DON_HANG_ID:'DH1'},{$set:{TRANG_THAI:'Đã giao'}});
      await assert.rejects(reverse('export',linked.PHIEU_XUAT_ID,payload,actor),/Đơn hàng/);
      await (await mongo.getCollection<any>(K.COLLECTIONS.order)).updateOne({DON_HANG_ID:'DH1'},{$set:{TRANG_THAI:'Chờ xử lý'}});

      await assert.rejects(reverse('export',px.PHIEU_XUAT_ID,{reason:'sai',physicallyVerified:true},actor),/lý do/);
      await assert.rejects(reverse('import',pn.PHIEU_NHAP_ID,{reason:'Lý do đủ dài'},actor),/xác nhận/);
      assert.equal((await stock.reconcileInventory(false)).ok,true);
    });
    test('lọc ngày theo ngày Việt Nam và người lập/xác nhận',async()=>{
      const pn:any=await importAndPost([{materialId:'REV1',receivedQty:1,unitPrice:200}],{receivedAt:'2020-01-01T17:00:00Z'});
      const found=await master.listDocuments('import',{from:'2020-01-02',to:'2020-01-02',createdBy:'NV001',confirmedBy:'NV001'});
      assert.ok(found.items.some((x:any)=>x.PHIEU_NHAP_ID===pn.PHIEU_NHAP_ID));
      assert.equal((await master.listDocuments('import',{from:'2020-01-01',to:'2020-01-01'})).items.length,0);
      assert.equal((await master.listDocuments('import',{createdBy:'NO_MATCH'})).total,0);
      await assert.rejects(master.listDocuments('import',{from:'2020-02-02',to:'2020-01-01'}),/Ngày bắt đầu/);
    });
  });

  describe('PN liên kết và điều chỉnh chênh lệch', () => {
    const verified = { reason: 'Sửa ghi nhận sau kiểm tra thực tế', physicallyVerified: true };
    const newMaterial = (code: string) => master.createMaterial({code, name: code, unit:'cành', group:'DE_HU', type:'Hoa tươi'},actor);
    const poDoc = async (id: string) => (await mongo.getCollection<any>(K.COLLECTIONS.purchaseOrder)).findOne({PO_ID:id});

    test('đảo PN theo PO trừ đúng lượng thực nhận/đạt, mở lại PO, không mất PN khác', async()=>{
      const {reverseInventoryDocument:reverse}=await import('../services/inventory/reversal.service.js');
      await newMaterial('POREV');
      const po:any=await master.createPurchaseOrder({supplierId:'NCC001',expectedAt:new Date(),lines:[{materialId:'POREV',quantity:10}]},actor);
      await master.changePurchaseOrderStatus(po.PO_ID,K.PO_STATUS.waiting,actor);
      const a:any=await importAndPost([{materialId:'POREV',receivedQty:4,unitPrice:100}],{purchaseOrderId:po.PO_ID});
      await master.changePurchaseOrderStatus(po.PO_ID,K.PO_STATUS.shipping,actor);
      const b:any=await importAndPost([{materialId:'POREV',receivedQty:6,acceptedQty:5,rejectedQty:1,unitPrice:100}],{purchaseOrderId:po.PO_ID});
      assert.equal((await poDoc(po.PO_ID)).TRANG_THAI,K.PO_STATUS.done);
      const result=await Promise.all([reverse('import',a.PHIEU_NHAP_ID,verified,actor),reverse('import',a.PHIEU_NHAP_ID,verified,actor)]);
      assert.equal(result.filter(r=>r.alreadyReversed).length,1);
      let after:any=await poDoc(po.PO_ID);
      assert.equal(after.CHI_TIET[0].SL_DA_NHAN,6);assert.equal(after.CHI_TIET[0].SL_DAT_DA_NHAN,5);
      assert.equal(after.TRANG_THAI,K.PO_STATUS.shipping);assert.equal(after.NGAY_HOAN_TAT,undefined);
      assert.equal((await material('POREV')).TON_THUC,5);
      await reverse('import',b.PHIEU_NHAP_ID,verified,actor);
      after=await poDoc(po.PO_ID);assert.equal(after.CHI_TIET[0].SL_DA_NHAN,0);assert.equal((await material('POREV')).TON_THUC,0);
    });

    test('đảo PN toàn không đạt vẫn sửa PO; PO đã hủy không tự mở lại',async()=>{
      const {reverseInventoryDocument:reverse}=await import('../services/inventory/reversal.service.js');
      const po:any=await master.createPurchaseOrder({supplierId:'NCC001',expectedAt:new Date(),lines:[{materialId:'POREV',quantity:10}]},actor);
      await master.changePurchaseOrderStatus(po.PO_ID,K.PO_STATUS.waiting,actor);
      const pn:any=await importAndPost([{materialId:'POREV',receivedQty:2,acceptedQty:0,rejectedQty:2,unitPrice:100}],{purchaseOrderId:po.PO_ID});
      await master.changePurchaseOrderStatus(po.PO_ID,K.PO_STATUS.cancelled,actor);
      await reverse('import',pn.PHIEU_NHAP_ID,verified,actor);
      const after:any=await poDoc(po.PO_ID);assert.equal(after.TRANG_THAI,K.PO_STATUS.cancelled);assert.equal(after.CHI_TIET[0].SL_DA_NHAN,0);
    });

    test('sai NCC/NVL của PO hoặc số nhận PO không khớp: không ghi dở tồn',async()=>{
      const {reverseInventoryDocument:reverse}=await import('../services/inventory/reversal.service.js');
      const po:any=await master.createPurchaseOrder({supplierId:'NCC001',expectedAt:new Date(),lines:[{materialId:'POREV',quantity:5}]},actor);
      await master.changePurchaseOrderStatus(po.PO_ID,K.PO_STATUS.waiting,actor);
      const wrong:any=await stock.createImport({supplierId:'NCC001',purchaseOrderId:po.PO_ID,details:[{materialId:'REV1',receivedQty:1,unitPrice:100}]},actor);
      const before=(await material('REV1')).TON_THUC;
      await assert.rejects(stock.postImport(wrong.PHIEU_NHAP_ID,actor),/không khớp PO/);
      assert.equal((await material('REV1')).TON_THUC,before);assert.equal((await stock.getImport(wrong.PHIEU_NHAP_ID)).TRANG_THAI,K.DOC_STATUS.draft);
      const pn:any=await importAndPost([{materialId:'POREV',receivedQty:2,unitPrice:100}],{purchaseOrderId:po.PO_ID});
      await (await mongo.getCollection<any>(K.COLLECTIONS.purchaseOrder)).updateOne({PO_ID:po.PO_ID},{$set:{'CHI_TIET.0.SL_DA_NHAN':0}});
      await assert.rejects(reverse('import',pn.PHIEU_NHAP_ID,verified,actor),/không khớp/);
      assert.equal((await material('POREV')).TON_THUC,2);assert.ok(!(await stock.getImport(pn.PHIEU_NHAP_ID)).DA_DAO);
      await (await mongo.getCollection<any>(K.COLLECTIONS.purchaseOrder)).updateOne({PO_ID:po.PO_ID},{$set:{'CHI_TIET.0.SL_DA_NHAN':2}});
    });

    test('đảo nhập hoàn trả đúng hạn mức nhiều nguồn, dùng giá vốn gốc và gọi lặp an toàn',async()=>{
      const {reverseInventoryDocument:reverse}=await import('../services/inventory/reversal.service.js');
      await newMaterial('RETURNREV');
      await importAndPost([{materialId:'RETURNREV',receivedQty:2,unitPrice:100}],{receivedAt:'2020-01-01T01:00:00Z'});
      await importAndPost([{materialId:'RETURNREV',receivedQty:2,unitPrice:300}],{receivedAt:'2020-01-02T01:00:00Z'});
      const px:any=await stock.createExport({type:K.EXPORT_TYPES.other,note:'Kiểm thử hoàn',details:[{materialId:'RETURNREV',quantity:4}]},actor);
      await stock.postExport(px.PHIEU_XUAT_ID,actor);
      const makeReturn=()=>stock.createImport({type:K.IMPORT_TYPES.return,originalExportId:px.PHIEU_XUAT_ID,details:[{materialId:'RETURNREV',receivedQty:3,acceptedQty:2,rejectedQty:1,unitPrice:999999}]},actor);
      const pn:any=await makeReturn();await stock.postImport(pn.PHIEU_NHAP_ID,actor);
      const before=await material('RETURNREV');
      const detail:any=(await stock.getImport(pn.PHIEU_NHAP_ID)).details[0];assert.equal(detail.DON_GIA_VON,167);
      const results=await Promise.all([reverse('import',pn.PHIEU_NHAP_ID,verified,actor),reverse('import',pn.PHIEU_NHAP_ID,verified,actor)]);
      assert.equal(results.filter(r=>r.alreadyReversed).length,1);assert.equal((await material('RETURNREV')).TON_THUC,before.TON_THUC-2);
      const exported:any=(await stock.getExport(px.PHIEU_XUAT_ID)).details[0];assert.ok(exported.PHAN_BO.every((a:any)=>a.SL_DA_HOAN===0));
      const again:any=await makeReturn();await stock.postImport(again.PHIEU_NHAP_ID,actor);
      assert.equal((await stock.getImport(again.PHIEU_NHAP_ID)).details[0].DON_GIA_VON,167);
    });

    test('nguồn nhập hoàn đã dùng: chặn đảo và giữ nguyên hạn mức hoàn',async()=>{
      const {reverseInventoryDocument:reverse}=await import('../services/inventory/reversal.service.js');
      const px:any=await stock.createExport({type:K.EXPORT_TYPES.other,note:'Sử dụng nguồn hoàn',details:[{materialId:'RETURNREV',quantity:1}]},actor);
      await stock.postExport(px.PHIEU_XUAT_ID,actor);
      const pn:any=(await (await mongo.getCollection<any>(K.COLLECTIONS.importSlip)).find({LOAI_NHAP:K.IMPORT_TYPES.return,DA_DAO:{$ne:true}}).sort({PHIEU_NHAP_ID:-1}).toArray()).find((x:any)=>x.PX_GOC_ID);
      const original:any=await stock.getExport(pn.PX_GOC_ID);
      await assert.rejects(reverse('import',pn.PHIEU_NHAP_ID,verified,actor),/đã được dùng/);
      assert.deepEqual((await stock.getExport(pn.PX_GOC_ID)).details,original.details);
    });

    test('điều chỉnh PN đã dùng/giữ bảo vệ lượng giữ, không sửa phiếu gốc hoặc PO',async()=>{
      const {adjustImportDocument:adjust,reverseInventoryDocument:reverse}=await import('../services/inventory/reversal.service.js');
      await newMaterial('ADJREV');
      const po:any=await master.createPurchaseOrder({supplierId:'NCC001',expectedAt:new Date(),lines:[{materialId:'ADJREV',quantity:10}]},actor);
      await master.changePurchaseOrderStatus(po.PO_ID,K.PO_STATUS.waiting,actor);
      const pn:any=await importAndPost([{materialId:'ADJREV',receivedQty:10,unitPrice:200}],{purchaseOrderId:po.PO_ID});
      const px:any=await stock.createExport({type:K.EXPORT_TYPES.other,note:'Đã dùng NVL',details:[{materialId:'ADJREV',quantity:2}]},actor);await stock.postExport(px.PHIEU_XUAT_ID,actor);
      await (await mongo.getCollection<any>(K.COLLECTIONS.product)).insertOne({_id:'SP-ADJREV',SAN_PHAM_ID:'SP-ADJREV',TEN_SAN_PHAM:'Kiểm thử',TRANG_THAI:'Đang bán'});
      await bom.createBomVersion('SP-ADJREV',{activate:true,lines:[{materialId:'ADJREV',quantity:4,role:'Chính'}]},actor);
      await stock.reserveProducts([{productId:'SP-ADJREV',quantity:1}],{status:'CHINH_THUC',orderId:'HOLD-ADJREV',actor});
      const payload={...verified,requestId:'adjust-request-000001',details:[{materialId:'ADJREV',quantity:-3}]};
      const results=await Promise.all([adjust(pn.PHIEU_NHAP_ID,payload,actor),adjust(pn.PHIEU_NHAP_ID,payload,actor)]);
      assert.equal(results.filter(r=>r.alreadyPosted).length,1);assert.equal((await material('ADJREV')).TON_THUC,5);assert.equal((await material('ADJREV')).TON_DANG_GIU,4);
      const doc:any=await stock.getImport(pn.PHIEU_NHAP_ID);assert.equal(doc.details[0].SL_DAT,10);assert.equal(doc.details[0].SL_DANG_GIU,4);assert.equal(doc.DIEU_CHINH.length,1);
      assert.equal((await poDoc(po.PO_ID)).CHI_TIET[0].SL_DA_NHAN,10);
      await assert.rejects(adjust(pn.PHIEU_NHAP_ID,{...payload,requestId:'adjust-request-000002',details:[{materialId:'ADJREV',quantity:-2}]},actor),/không đủ/);
      await assert.rejects(adjust(pn.PHIEU_NHAP_ID,{...payload,details:[{materialId:'ADJREV',quantity:-1}]},actor),/nội dung khác/);
      await assert.rejects(reverse('import',pn.PHIEU_NHAP_ID,verified,actor),/đã có điều chỉnh/);
      assert.equal((await material('ADJREV')).TON_THUC,5);
      const concurrent=await Promise.allSettled(['a','b'].map(k=>adjust(pn.PHIEU_NHAP_ID,{...payload,requestId:'adjust-concurrent-0000'+k,details:[{materialId:'ADJREV',quantity:-1}]},actor)));
      assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);assert.equal((await material('ADJREV')).TON_THUC,4);
    });

    test('điều chỉnh nhiều dòng lỗi phải rollback; tăng giảm có sổ, giá vốn và lịch sử',async()=>{
      const {adjustImportDocument:adjust}=await import('../services/inventory/reversal.service.js');
      await newMaterial('ADJA');await newMaterial('ADJZ');
      const pn:any=await importAndPost([{materialId:'ADJA',receivedQty:2,unitPrice:100},{materialId:'ADJZ',receivedQty:2,unitPrice:300}]);
      const payload={...verified,requestId:'adjust-multiline-0001',details:[{materialId:'ADJA',quantity:1},{materialId:'ADJZ',quantity:-3}]};
      await assert.rejects(adjust(pn.PHIEU_NHAP_ID,payload,actor),/không đủ/);
      assert.equal((await material('ADJA')).TON_THUC,2);assert.ok(!(await stock.getImport(pn.PHIEU_NHAP_ID)).DIEU_CHINH);
      await adjust(pn.PHIEU_NHAP_ID,{...payload,details:[{materialId:'ADJA',quantity:1.125},{materialId:'ADJZ',quantity:-1}]},actor);
      assert.equal((await material('ADJA')).TON_THUC,3.125);assert.equal((await material('ADJA')).GIA_VON_BQ,100);
      assert.equal((await material('ADJZ')).TON_THUC,1);assert.equal((await material('ADJZ')).GIA_VON_BQ,300);
      const doc:any=await stock.getImport(pn.PHIEU_NHAP_ID);assert.equal(doc.DIEU_CHINH[0].CHI_TIET.length,2);
      for(const details of [[{materialId:'ADJA',quantity:NaN}],[{materialId:'ADJA',quantity:0.0001}],[{materialId:'ADJA',quantity:1},{materialId:'ADJA',quantity:2}]]) {
        await assert.rejects(adjust(pn.PHIEU_NHAP_ID,{...payload,details},actor));
      }
      assert.equal((await stock.reconcileInventory(false)).ok,true);
    });
    test('chi tiết NVL giữ lịch sử khi nguồn hết, lọc đúng dòng NVL của chứng từ nhiều dòng', async()=>{
      const {adjustImportDocument:adjust}=await import('../services/inventory/reversal.service.js');
      const before=await master.getMaterialDetail('ADJZ');
      assert.equal(before.corrections.length,1);
      assert.equal(before.corrections[0].CHI_TIET.length,1);
      assert.equal(before.corrections[0].CHI_TIET[0].NGUYEN_VAT_LIEU_ID,'ADJZ');
      assert.equal((before.corrections[0] as any).FINGERPRINT,undefined);
      const pn=before.corrections[0].PHIEU_GOC_ID;
      await adjust(pn,{...verified,requestId:'history-test-0000001',details:[{materialId:'ADJZ',quantity:-1}]},actor);
      const after=await master.getMaterialDetail('ADJZ');
      assert.equal(after.sources.length,0);assert.equal(after.corrections.length,2);
      assert.equal(after.corrections[0].CHI_TIET[0].CHENH_LECH,-1);
      assert.ok(after.corrections.every(c=>c.CHI_TIET.every((l:any)=>l.NGUYEN_VAT_LIEU_ID==='ADJZ')));
      assert.equal((await master.getMaterialDetail('ADJA')).corrections.length,1);
      const original:any=await stock.getImport(pn);
      assert.equal(original.DIEU_CHINH[0].CHI_TIET.length,2);
    });

    test('lịch sử NVL phân trang, không mất bản cũ và lọc ngày Việt Nam/từ khóa literal', async()=>{
      await newMaterial('HISTORYTEST');
      const corrections=await mongo.getCollection<any>('DIEU_CHINH_KHO');
      const movements=await mongo.getCollection<any>(K.COLLECTIONS.movement);
      const time=(n:number)=>new Date(Date.parse('2021-01-01T16:45:00Z')+n*60_000);
      await corrections.insertMany(Array.from({length:35},(_,n)=>({_id:'hist-'+n,DIEU_CHINH_ID:'DCHIST'+n,PHIEU_GOC_ID:'PNHIST',TRANG_THAI:K.DOC_STATUS.posted,
        NGAY_XAC_NHAN:time(n),NGUOI_XAC_NHAN:actor.id,LY_DO:n===3?'Kiểm kê [đợt]':'Kiểm kê',FINGERPRINT:'private',
        CHI_TIET:[{NGUYEN_VAT_LIEU_ID:'HISTORYTEST',CHENH_LECH:1,DON_GIA_VON:100},{NGUYEN_VAT_LIEU_ID:'ADJA',CHENH_LECH:999,DON_GIA_VON:100}]})));
      await movements.insertMany(Array.from({length:35},(_,n)=>({_id:'hist-mv-'+n,NGUYEN_VAT_LIEU_ID:'HISTORYTEST',THOI_DIEM:time(n),LOAI:'DIEU_CHINH_NHAP',
        CHUNG_TU_ID:'DCHIST'+n,PHIEU_NHAP_NGUON:'PNHIST',DELTA_TON_THUC:0,DELTA_DANG_GIU:0,DELTA_KHONG_DAT:0,KHA_DUNG_SAU:0})));
      const first=await master.getMaterialHistory('HISTORYTEST',{kind:'corrections'});
      const second=await master.getMaterialHistory('HISTORYTEST',{kind:'corrections',page:2});
      const last=await master.getMaterialHistory('HISTORYTEST',{kind:'corrections',page:999});
      assert.equal(first.total,35);assert.equal(first.items.length,15);assert.equal(second.items.length,15);assert.equal(last.items.length,5);assert.equal(last.page,3);
      assert.equal(first.items[0].docId,'DCHIST34');assert.equal(last.items.at(-1)?.docId,'DCHIST0');
      assert.equal(new Set([...first.items,...second.items,...last.items].map(r=>r.id)).size,35);
      assert.equal(first.items[0].deltaOnHand,1);assert.equal((first.items[0] as any).FINGERPRINT,undefined);
      assert.equal((await master.getMaterialHistory('HISTORYTEST',{kind:'corrections',search:'['})).total,1);
      assert.equal((await master.getMaterialHistory('HISTORYTEST',{kind:'corrections',from:'2021-01-02',to:'2021-01-02'})).total,20);
      assert.equal((await master.getMaterialHistory('HISTORYTEST',{search:'PNHIST',page:3})).items.length,5);
      assert.equal((await master.getMaterialHistory('HISTORYTEST',{search:'NO_MATCH'})).page,1);
      assert.equal((await master.getMaterialDetail('HISTORYTEST')).corrections.length,15);
      await assert.rejects(master.getMaterialHistory('HISTORYTEST',{kind:'invalid'}),/Loại lịch sử/);
      await assert.rejects(master.getMaterialHistory('HISTORYTEST',{page:-1}),/Trang lịch sử/);
      await assert.rejects(master.getMaterialHistory('HISTORYTEST',{from:'2021-02-30'}),/Ngày lọc/);
      await assert.rejects(master.getMaterialHistory('HISTORYTEST',{from:'2021-02-01',to:'2021-01-01'}),/Ngày bắt đầu/);
    });

  });

  describe('Khắc phục lệch quy tắc kho D01/D04',()=>{
    test('mặc định dùng hạn giữ 5 phút và không đổi ĐVT của NVL đã hết tồn nhưng có lịch sử/BOM',async()=>{
      assert.equal(K.INVENTORY_CONFIG.holdMinutes,5);
      await master.createMaterial({code:'UNITTEST',name:'Kiểm thử ĐVT',unit:'cành',group:'DE_HU',type:'Hoa tươi'},actor);
      await master.updateMaterial('UNITTEST',{unit:'Bông'},actor);
      const pn:any=await importAndPost([{materialId:'UNITTEST',receivedQty:1,unitPrice:100}]);
      const px:any=await stock.createExport({type:K.EXPORT_TYPES.other,note:'Xuất hết để thử ĐVT',details:[{materialId:'UNITTEST',quantity:1}]},actor);
      await stock.postExport(px.PHIEU_XUAT_ID,actor);
      assert.equal((await material('UNITTEST')).TON_THUC,0);
      await assert.rejects(master.updateMaterial('UNITTEST',{unit:'bó'},actor),/không đổi ĐVT/);
      assert.equal((await material('UNITTEST')).DON_VI_TINH,'Bông');
      await assert.rejects(master.updateMaterial('NVL001',{unit:'bó'},actor),/không đổi ĐVT/);
    });
    test('luôn FIFO dù request và phiếu nháp cũ chỉ định nguồn mới, giữ đúng phân bổ A5+B2',async()=>{
      await master.createMaterial({code:'FIFO-FIX',name:'Kiểm thử nguồn trùng',unit:'cành',group:'DE_HU',type:'Hoa tươi'},actor);
      const a:any=await importAndPost([{materialId:'FIFO-FIX',receivedQty:5,unitPrice:100}],{receivedAt:'2020-01-01T01:00:00Z'});
      const b:any=await importAndPost([{materialId:'FIFO-FIX',receivedQty:5,unitPrice:200}],{receivedAt:'2020-01-02T01:00:00Z'});
      await (await mongo.getCollection<any>(K.COLLECTIONS.product)).insertOne({_id:'SP-FIFO',SAN_PHAM_ID:'SP-FIFO',TEN_SAN_PHAM:'FIFO',TRANG_THAI:'Đang bán'});
      await bom.createBomVersion('SP-FIFO',{activate:true,lines:[{materialId:'FIFO-FIX',quantity:5,role:'Chính'}]},actor);
      await (await mongo.getCollection<any>(K.COLLECTIONS.order)).insertOne({_id:'DH-FIFO',DON_HANG_ID:'DH-FIFO',TRANG_THAI:'Chờ xử lý'});
      await stock.reserveProducts([{productId:'SP-FIFO',quantity:1}],{status:K.RESERVATION_STATUS.official,orderId:'DH-FIFO',actor});
      const px:any=await stock.createExport({type:K.EXPORT_TYPES.order,orderId:'DH-FIFO',details:[{materialId:'FIFO-FIX',quantity:7,sourceId:b.PHIEU_NHAP_ID}]},actor);
      assert.equal((await stock.getExport(px.PHIEU_XUAT_ID)).details[0].PHIEU_NHAP_CHI_DINH,null);
      await (await mongo.getCollection<any>(K.COLLECTIONS.exportDetail)).updateOne({PHIEU_XUAT_ID:px.PHIEU_XUAT_ID},{$set:{PHIEU_NHAP_CHI_DINH:b.PHIEU_NHAP_ID}});
      await stock.postExport(px.PHIEU_XUAT_ID,actor);
      const line:any=(await stock.getExport(px.PHIEU_XUAT_ID)).details[0];
      assert.deepEqual(line.PHAN_BO.map((x:any)=>[x.PHIEU_NHAP_ID,x.SO_LUONG]),[[a.PHIEU_NHAP_ID,5],[b.PHIEU_NHAP_ID,2]]);
      assert.equal((await material('FIFO-FIX')).TON_THUC,3);assert.equal((await material('FIFO-FIX')).TON_DANG_GIU,0);
    });
    test('đổi BOM không đổi snapshot khi giữ lại, lập nhu cầu hoặc gợi ý xuất đơn cũ',async()=>{
      const {withTransaction}=await import('../services/inventory/helpers.js');
      const {reserveOrderLines}=await import('../services/order-stock.service.js');
      await master.createMaterial({code:'SNAP-FIX',name:'Kiểm thử snapshot',unit:'cành',group:'DE_HU',type:'Hoa tươi'},actor);
      await importAndPost([{materialId:'SNAP-FIX',receivedQty:30,unitPrice:100}]);
      await (await mongo.getCollection<any>(K.COLLECTIONS.product)).insertOne({_id:'SP-SNAP',SAN_PHAM_ID:'SP-SNAP',TEN_SAN_PHAM:'Snapshot',TRANG_THAI:'Đang bán'});
      await bom.createBomVersion('SP-SNAP',{activate:true,lines:[{materialId:'SNAP-FIX',quantity:2,role:'Chính'}]},actor);
      const held:any=await stock.reserveProducts([{productId:'SP-SNAP',quantity:1}],{status:K.RESERVATION_STATUS.temporary,paymentSessionId:'SNAP-OLD-KEY',actor});
      const snapshot=held.snapshots['SP-SNAP'];assert.equal(snapshot.lines[0].DINH_LUONG,2);
      const expiry=held.reservations[0].HET_HAN_LUC.getTime()-held.reservations[0].TAO_LUC.getTime();assert.equal(expiry,300000);
      await stock.releaseReservations({paymentSessionId:'SNAP-OLD-KEY'},actor);
      await bom.createBomVersion('SP-SNAP',{activate:true,lines:[{materialId:'SNAP-FIX',quantity:9,role:'Chính'}]},actor);
      await (await mongo.getCollection<any>(K.COLLECTIONS.order)).insertOne({_id:'DH-SNAP',DON_HANG_ID:'DH-SNAP',TRANG_THAI:'Chờ xử lý'});
      await (await mongo.getCollection<any>(K.COLLECTIONS.orderDetail)).insertOne({DON_HANG_ID:'DH-SNAP',SAN_PHAM_ID:'SP-SNAP',SO_LUONG:3,BOM_SNAPSHOT:snapshot});
      await withTransaction(session=>reserveOrderLines(session,[{id:'SP-SNAP',qty:3,bom:snapshot}],{status:K.RESERVATION_STATUS.official,orderId:'DH-SNAP',actor}));
      assert.equal((await material('SNAP-FIX')).TON_DANG_GIU,6);
      await stock.releaseReservations({orderId:'DH-SNAP'},actor);
      const suggested=await stock.suggestExportLines({type:K.EXPORT_TYPES.order,orderId:'DH-SNAP'});assert.equal(suggested[0].quantity,6);
      await assert.rejects(stock.recordOrderDemand('DH-SNAP',{},actor),/đã thanh toán/);
      await (await mongo.getCollection<any>('THANH_TOAN')).insertOne({DON_HANG_ID:'DH-SNAP',TRANG_THAI_THANH_TOAN:'Thành công'});
      await assert.rejects(stock.recordOrderDemand('DH-SNAP',{items:[{productId:'SP-SNAP',quantity:99}]},actor),/đúng sản phẩm/);
      const calls=await Promise.allSettled([stock.recordOrderDemand('DH-SNAP',{},actor),stock.recordOrderDemand('DH-SNAP',{},actor)]);
      assert.equal(calls.filter(x=>x.status==='fulfilled').length,1);
      const demand:any=await (await mongo.getCollection<any>(K.COLLECTIONS.demand)).findOne({DON_HANG_ID:'DH-SNAP'});assert.equal(demand.SO_LUONG,6);
      await stock.setOrderPrepTime('DH-SNAP',new Date(Date.now()+600000),actor);
      await (await mongo.getCollection<any>(K.COLLECTIONS.order)).insertOne({_id:'DH-UNPAID',DON_HANG_ID:'DH-UNPAID',TRANG_THAI:'Chờ thanh toán'});
      await (await mongo.getCollection<any>(K.COLLECTIONS.demand)).insertOne({DON_HANG_ID:'DH-UNPAID',NGUYEN_VAT_LIEU_ID:'SNAP-FIX',SO_LUONG:99999,THOI_DIEM_CAN_DUNG:new Date(),TRANG_THAI:K.DEMAND_STATUS.waiting});
      assert.equal((await avail.pendingDemandByMaterial(new Date(Date.now()+3600000))).get('SNAP-FIX'),6);
      assert.ok(!(await avail.getInventoryAlerts()).forecastShortages.some((x:any)=>x.orderId==='DH-UNPAID'));
      await assert.rejects(stock.reserveOrderDemand('DH-UNPAID',actor),/chưa thanh toán/);
      await (await mongo.getCollection<any>(K.COLLECTIONS.orderDetail)).insertOne({DON_HANG_ID:'DH-UNPAID',SAN_PHAM_ID:'SP-SNAP',SO_LUONG:1});
      await (await mongo.getCollection<any>(K.COLLECTIONS.demand)).deleteMany({DON_HANG_ID:'DH-UNPAID'});
      await assert.rejects(stock.suggestExportLines({type:K.EXPORT_TYPES.order,orderId:'DH-UNPAID'}),/snapshot/);
    });
  });

  describe('Đảo PX có liên kết',()=>{
    const verified={reason:'Sửa phiếu xuất ghi nhận sai sau kiểm tra thực tế',physicallyVerified:true};
    test('đảo PX theo đơn khôi phục giữ và dấu xuất; được lập phiếu thay thế một lần',async()=>{
      const {reverseInventoryDocument:reverse}=await import('../services/inventory/reversal.service.js');
      const exports=await mongo.getCollection<any>(K.COLLECTIONS.exportSlip);
      const original:any=await exports.findOne({DON_HANG_ID:'DH-FIFO',TRANG_THAI:K.DOC_STATUS.posted});
      assert.ok(original);
      const results=await Promise.all([reverse('export',original.PHIEU_XUAT_ID,verified,actor),reverse('export',original.PHIEU_XUAT_ID,verified,actor)]);
      assert.equal(results.filter(x=>x.alreadyReversed).length,1);
      assert.equal((await material('FIFO-FIX')).TON_THUC,10);assert.equal((await material('FIFO-FIX')).TON_DANG_GIU,5);
      const order:any=await (await mongo.getCollection<any>(K.COLLECTIONS.order)).findOne({DON_HANG_ID:'DH-FIFO'});assert.equal(order.DA_XUAT_NVL,false);
      assert.equal((await stock.getExport(original.PHIEU_XUAT_ID)).TRANG_THAI,'Đã đảo');
      const active=await stock.suggestExportLines({type:K.EXPORT_TYPES.order,orderId:'DH-FIFO'});assert.equal(active[0].quantity,5);
      const replacement:any=await stock.createExport({type:K.EXPORT_TYPES.order,orderId:'DH-FIFO',details:[{materialId:'FIFO-FIX',quantity:4}]},actor);
      await stock.postExport(replacement.PHIEU_XUAT_ID,actor);
      assert.equal((await material('FIFO-FIX')).TON_THUC,6);assert.equal((await material('FIFO-FIX')).TON_DANG_GIU,0);
      assert.equal(await exports.countDocuments({DON_HANG_ID:'DH-FIFO',TRANG_THAI:K.DOC_STATUS.posted}),1);
      assert.ok((await master.listDocuments('export',{status:'Đã đảo'})).items.some((d:any)=>d.PHIEU_XUAT_ID===original.PHIEU_XUAT_ID));
    });
    test('đảo cắm sẵn trừ thành phẩm và phục hồi NVL, chặn khi thành phẩm đang giữ',async()=>{
      const {reverseInventoryDocument:reverse}=await import('../services/inventory/reversal.service.js');
      await master.createMaterial({code:'PROD-REV',name:'Đảo sản xuất',unit:'cành',group:'DE_HU',type:'Hoa tươi'},actor);
      await importAndPost([{materialId:'PROD-REV',receivedQty:6,unitPrice:100}]);
      await (await mongo.getCollection<any>(K.COLLECTIONS.product)).insertOne({_id:'SP-PRODREV',SAN_PHAM_ID:'SP-PRODREV',TEN_SAN_PHAM:'Đảo sản xuất',TRANG_THAI:'Đang bán'});
      await bom.createBomVersion('SP-PRODREV',{activate:true,lines:[{materialId:'PROD-REV',quantity:2,role:'Chính'}]},actor);
      const px:any=await stock.createExport({type:K.EXPORT_TYPES.readyMade,productId:'SP-PRODREV',bundles:2,details:[{materialId:'PROD-REV',quantity:4}]},actor);
      await stock.postExport(px.PHIEU_XUAT_ID,actor);
      await stock.reserveProducts([{productId:'SP-PRODREV',quantity:1}],{status:K.RESERVATION_STATUS.official,orderId:'HOLD-PRODREV',actor});
      await assert.rejects(reverse('export',px.PHIEU_XUAT_ID,verified,actor),/không đủ/);
      assert.equal((await material('PROD-REV')).TON_THUC,2);assert.ok(!(await stock.getExport(px.PHIEU_XUAT_ID)).DA_DAO);
      await stock.releaseReservations({orderId:'HOLD-PRODREV'},actor);
      await reverse('export',px.PHIEU_XUAT_ID,verified,actor);
      assert.equal((await material('PROD-REV')).TON_THUC,6);
      const product:any=await (await mongo.getCollection<any>(K.COLLECTIONS.product)).findOne({SAN_PHAM_ID:'SP-PRODREV'});assert.equal(product.TON_THANH_PHAM,0);assert.equal(product.GIA_VON_THANH_PHAM,0);
      assert.equal((await stock.reconcileInventory(false)).ok,true);
    });
    test('đảo PX không được lấy phần đã nhả dư mà đơn khác đang giữ; lỗi phải rollback',async()=>{
      const {reverseInventoryDocument:reverse}=await import('../services/inventory/reversal.service.js');
      await master.createMaterial({code:'RESTORE-HOLD',name:'Kiểm thử khôi phục giữ',unit:'cành',group:'DE_HU',type:'Hoa tươi'},actor);
      await importAndPost([{materialId:'RESTORE-HOLD',receivedQty:10,unitPrice:100}]);
      await (await mongo.getCollection<any>(K.COLLECTIONS.product)).insertOne({_id:'SP-RESTORE',SAN_PHAM_ID:'SP-RESTORE',TEN_SAN_PHAM:'Khôi phục',TRANG_THAI:'Đang bán'});
      await bom.createBomVersion('SP-RESTORE',{activate:true,lines:[{materialId:'RESTORE-HOLD',quantity:1,role:'Chính'}]},actor);
      await (await mongo.getCollection<any>(K.COLLECTIONS.order)).insertOne({_id:'DH-RESTORE',DON_HANG_ID:'DH-RESTORE',TRANG_THAI:'Chờ xử lý'});
      await stock.reserveProducts([{productId:'SP-RESTORE',quantity:5}],{status:K.RESERVATION_STATUS.official,orderId:'DH-RESTORE',actor});
      const px:any=await stock.createExport({type:K.EXPORT_TYPES.order,orderId:'DH-RESTORE',details:[{materialId:'RESTORE-HOLD',quantity:3}]},actor);
      await stock.postExport(px.PHIEU_XUAT_ID,actor);
      await stock.reserveProducts([{productId:'SP-RESTORE',quantity:6}],{status:K.RESERVATION_STATUS.official,orderId:'OTHER-BUYER',actor});
      await assert.rejects(reverse('export',px.PHIEU_XUAT_ID,verified,actor),/không đủ/);
      assert.equal((await material('RESTORE-HOLD')).TON_THUC,7);assert.equal((await material('RESTORE-HOLD')).TON_DANG_GIU,6);
      assert.ok(!(await stock.getExport(px.PHIEU_XUAT_ID)).DA_DAO);
      const order:any=await (await mongo.getCollection<any>(K.COLLECTIONS.order)).findOne({DON_HANG_ID:'DH-RESTORE'});assert.equal(order.DA_XUAT_NVL,true);
      await stock.releaseReservations({orderId:'OTHER-BUYER'},actor);
      await reverse('export',px.PHIEU_XUAT_ID,verified,actor);
      assert.equal((await material('RESTORE-HOLD')).TON_THUC,10);assert.equal((await material('RESTORE-HOLD')).TON_DANG_GIU,5);
      assert.equal((await stock.reconcileInventory(false)).ok,true);
    });

  });

}
