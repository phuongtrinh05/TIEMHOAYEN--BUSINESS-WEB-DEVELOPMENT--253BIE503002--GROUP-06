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
  process.env.INVENTORY_HOLD_MINUTES = '15';

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
}
