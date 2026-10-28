/**
 * THIẾT LẬP DỮ LIỆU KHO (S1–S2) — chạy được nhiều lần (idempotent).
 *
 *   npm run inventory:migrate              # chuẩn hóa dữ liệu thật: NVL, NCC, BOM v1, tồn đầu kỳ, phiếu cũ
 *   npm run inventory:migrate -- --dry-run # chỉ báo cáo, không ghi
 *   npm run inventory:seed-demo            # thêm dữ liệu mẫu để kiểm thử (gắn cờ DU_LIEU_MAU)
 *   npm run inventory:reset-demo           # xóa toàn bộ dữ liệu mẫu và tính lại tồn từ sổ biến động
 *   npm run inventory:reconcile            # đối soát bộ đếm tồn với sổ biến động
 *
 * LƯU Ý: script ghi vào database trong MONGO_URI/MONGO_DATABASE của file .env.
 * Hãy chạy thử trên database dev/bản sao trước khi chạy trên database dùng chung của nhóm.
 */
import { ObjectId } from 'mongodb';
import { getCollection } from '../mongo.js';
import {
  BOM_STATUS,
  COLLECTIONS,
  DOC_STATUS,
  EXPORT_TYPES,
  IMPORT_TYPES,
  MATERIAL_GROUP,
  MATERIAL_STATUS,
  PO_STATUS,
  RESERVATION_STATUS,
} from '../services/inventory/constants.js';
import { normalizeText, roundQty, unitsCompatible, type Actor } from '../services/inventory/helpers.js';
import { ensureInventoryIndexes } from '../services/inventory/setup.js';
import * as stock from '../services/inventory/stock.service.js';
import * as master from '../services/inventory/master-data.service.js';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const SYSTEM: Actor = { id: 'NV001', role: 'Admin' };
const MARKER_MIGRATE = 'migration:inventory-v1';
const MARKER_DEMO = 'demo:inventory-v1';

const log = (...a: unknown[]) => console.log('[inventory-setup]', ...a);
const c = (name: string) => getCollection<any>(name);

/* ------------------------------------------------------------------
 * Suy luận thuộc tính NVL từ tên/đơn vị dữ liệu hiện có
 * ------------------------------------------------------------------ */

const SUBSTITUTION_GROUPS: Record<string, string[]> = {
  HOA_NEN_NHO: ['NVL007', 'NVL014', 'NVL024', 'NVL035', 'NVL022'],
  HOA_CHINH_HONG_CAMCHUONG: ['NVL001', 'NVL004', 'NVL017'],
  HOA_CUC_DONGTIEN: ['NVL003', 'NVL005', 'NVL025', 'NVL031'],
  HOA_LY_HUE_LOAKEN: ['NVL006', 'NVL008', 'NVL034'],
  HOA_CAO_CAP_NHAP: ['NVL009', 'NVL018', 'NVL026'],
};

/** Ngưỡng theo bảng D01.7 (giả định khởi đầu, cần chủ shop xác nhận). */
const THRESHOLDS: Record<string, [number, number]> = {
  NVL001: [220, 440], // hồng — nhóm A
  NVL012: [50, 100], // lan
  NVL013: [40, 80], // mõm sói
  NVL005: [40, 80], // cúc
  NVL003: [30, 50], // đồng tiền
};

export const inferMaterial = (m: any) => {
  const name = normalizeText(m.TEN_NGUYEN_VAT_LIEU);
  const id = m.NGUYEN_VAT_LIEU_ID;
  let type = 'Phụ kiện cắm';
  if (name.startsWith('hoa ')) type = 'Hoa tươi';
  else if (name.startsWith('la ')) type = 'Lá';
  else if (name.startsWith('giay')) type = 'Giấy gói';
  else if (name.startsWith('luoi')) type = 'Lưới';
  else if (name.startsWith('ruy bang')) type = 'Ruy băng';
  else if (name.startsWith('hop') || name.startsWith('tui')) type = 'Hộp/Túi';
  else if (name.startsWith('gio') || name.startsWith('lan may')) type = 'Giỏ';
  else if (/^(keo|tuot gai|ban xoay)/.test(name)) type = 'Dụng cụ';
  else if (['gau bong', 'nen thom', 'thiep', 'tui qua cao cap'].includes(name)) type = 'Quà tặng kèm';
  else if (['phu lieu khac', 'la va phu kien di kem', 'banh keo/snack'].includes(name)) type = 'Phụ liệu chung';
  if (type === 'Hộp/Túi' && name === 'tui qua cao cap') type = 'Quà tặng kèm';

  const perishable = type === 'Hoa tươi' || type === 'Lá';
  const defaults: Record<string, [number, number]> = {
    'Hoa tươi': [30, 60], 'Lá': [10, 30], 'Giấy gói': [20, 50], 'Ruy băng': [20, 50], 'Lưới': [10, 30],
    'Hộp/Túi': [10, 30], 'Giỏ': [10, 30], 'Phụ kiện cắm': [10, 30], 'Dụng cụ': [2, 5], 'Quà tặng kèm': [5, 20], 'Phụ liệu chung': [10, 30],
  };
  const [threshold, maxLevel] = THRESHOLDS[id] || defaults[type];
  let substitutionGroup: string | null = Object.entries(SUBSTITUTION_GROUPS).find(([, ids]) => ids.includes(id))?.[0] || null;
  if (!substitutionGroup && type === 'Lá') substitutionGroup = 'LA_PHU';
  if (!substitutionGroup && type === 'Giấy gói' && normalizeText(m.DON_VI_TINH) === 'to') substitutionGroup = 'GIAY_GOI_TO';
  if (!substitutionGroup && type === 'Ruy băng') substitutionGroup = 'RUY_BANG';
  return {
    NHOM_NVL: perishable ? MATERIAL_GROUP.perishable : MATERIAL_GROUP.durable,
    LOAI_NVL: type,
    NGUONG_CANH_BAO: threshold,
    NGUONG_TOI_DA: maxLevel,
    SO_NGAY_BAO_QUAN: type === 'Hoa tươi' ? 5 : type === 'Lá' ? 7 : null,
    NHOM_THAY_THE: substitutionGroup,
  };
};

/* ------------------------------------------------------------------
 * MIGRATE
 * ------------------------------------------------------------------ */

const migrate = async () => {
  const counters = await c(COLLECTIONS.counter);
  const marker = await counters.findOne({ _id: MARKER_MIGRATE });
  const materials = await (await c(COLLECTIONS.material)).find({}).toArray();
  log(`NVL: ${materials.length}, đã migrate trước đó: ${Boolean(marker)}`);

  // 1. Thuộc tính NVL (chỉ bổ sung trường còn thiếu, không ghi đè cấu hình Admin đã sửa)
  let materialUpdates = 0;
  for (const m of materials) {
    const inferred = inferMaterial(m);
    const set: any = {};
    Object.entries(inferred).forEach(([k, v]) => { if (m[k] === undefined) set[k] = v; });
    if (m.TRANG_THAI === undefined) set.TRANG_THAI = MATERIAL_STATUS.active;
    if (m.GIA_VON_BQ === undefined) set.GIA_VON_BQ = Number(m.GIA_NHAP || 0);
    if (!marker) Object.assign(set, { TON_THUC: 0, SO_LUONG_TON: 0, TON_DANG_GIU: 0, TON_KHONG_DAT: 0, TON_DAU_KY_CU: Number(m.SO_LUONG_TON || 0) });
    if (Object.keys(set).length) {
      materialUpdates++;
      if (!DRY) await (await c(COLLECTIONS.material)).updateOne({ _id: m._id }, { $set: set });
    }
  }
  log(`Cập nhật thuộc tính NVL: ${materialUpdates}`);

  // 2. NCC: giờ chốt đơn & lead time mặc định
  if (!DRY) {
    await (await c(COLLECTIONS.supplier)).updateMany({ GIO_CHOT_DON: { $exists: false } }, { $set: { GIO_CHOT_DON: '12:00' } });
    await (await c(COLLECTIONS.supplier)).updateMany({ SO_NGAY_GIAO_MAC_DINH: { $exists: false } }, { $set: { SO_NGAY_GIAO_MAC_DINH: 1 } });
  }

  // 3. Phiếu cũ → coi là Đã ghi nhận (đã nằm trong SO_LUONG_TON cũ), KHÔNG phải nguồn FIFO
  const oldImports = await (await c(COLLECTIONS.importSlip)).countDocuments({ TRANG_THAI: { $exists: false } });
  const oldExports = await (await c(COLLECTIONS.exportSlip)).countDocuments({ TRANG_THAI: { $exists: false } });
  log(`Phiếu cũ cần chuẩn hóa: PN ${oldImports}, PX ${oldExports}`);
  if (!DRY) {
    await (await c(COLLECTIONS.importSlip)).updateMany({ TRANG_THAI: { $exists: false } }, [
      { $set: { TRANG_THAI: DOC_STATUS.posted, LOAI_NHAP: { $ifNull: ['$LOAI_NHAP', IMPORT_TYPES.purchase] }, THOI_DIEM_NHAN: { $ifNull: ['$THOI_DIEM_NHAN', '$NGAY_NHAP'] }, DU_LIEU_CU: true } },
    ]);
    await (await c(COLLECTIONS.importDetail)).updateMany({ LA_NGUON_NHAP: { $exists: false } }, [
      { $set: { LA_NGUON_NHAP: false, SL_THUC_NHAN: { $ifNull: ['$SL_THUC_NHAN', '$SO_LUONG_NHAP'] }, SL_DAT: { $ifNull: ['$SL_DAT', '$SO_LUONG_NHAP'] }, SL_KHONG_DAT: { $ifNull: ['$SL_KHONG_DAT', 0] }, DON_GIA_VON: { $ifNull: ['$DON_GIA_VON', '$DON_GIA_NHAP'] }, DU_LIEU_CU: true } },
    ]);
    await (await c(COLLECTIONS.exportSlip)).updateMany({ TRANG_THAI: { $exists: false } }, [
      { $set: { TRANG_THAI: DOC_STATUS.posted, LOAI_XUAT: { $ifNull: ['$LOAI_XUAT', EXPORT_TYPES.other] }, GHI_CHU: { $ifNull: ['$GHI_CHU', '$LY_DO_XUAT'] }, DU_LIEU_CU: true } },
    ]);
  }

  // 4. Thành phẩm cắm sẵn: khởi tạo bộ đếm riêng (KHÔNG dùng lại SAN_PHAM.SO_LUONG vì website đang đọc cột này)
  if (!DRY) {
    await (await c(COLLECTIONS.product)).updateMany({ TON_THANH_PHAM: { $exists: false } }, { $set: { TON_THANH_PHAM: 0, TP_DANG_GIU: 0 } });
  }

  // 5. BOM v1 từ CONG_THUC_SAN_PHAM
  await migrateBoms();

  // 6. Tồn đầu kỳ: 1 phiếu nhập "Tồn đầu kỳ" Posted từ SO_LUONG_TON cũ (chỉ chạy 1 lần)
  if (!marker) {
    const lines = materials
      .filter((m) => Number(m.SO_LUONG_TON || 0) > 0)
      .map((m) => ({ materialId: m.NGUYEN_VAT_LIEU_ID, receivedQty: Number(m.SO_LUONG_TON), rejectedQty: 0, unitPrice: Number(m.GIA_NHAP || 0), chargesAcceptedOnly: true, note: 'Chuyển từ SO_LUONG_TON cũ' }));
    log(`Tồn đầu kỳ: ${lines.length} dòng, tổng ${lines.reduce((s, l) => s + l.receivedQty, 0)}`);
    if (!DRY) {
      if (lines.length) {
        const pn: any = await stock.createImport({
          type: IMPORT_TYPES.opening,
          receivedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          note: 'Tồn đầu kỳ khi chuyển sang quản lý kho mới (kiểm kê lại trước khi bật cảnh báo)',
          details: lines,
        }, SYSTEM);
        await stock.postImport(pn.PHIEU_NHAP_ID, SYSTEM);
        log(`Đã tạo & ghi nhận ${pn.PHIEU_NHAP_ID}`);
      }
      await counters.updateOne({ _id: MARKER_MIGRATE }, { $set: { at: new Date() } }, { upsert: true });
    }
  }
  if (!DRY) await ensureInventoryIndexes();
  log(DRY ? 'DRY RUN — không ghi gì.' : 'Migrate xong.');
};

const pickRole = (line: any, material: any, mainId: string | null) => {
  if (!material) return 'Phụ';
  if (material.LOAI_NVL === 'Phụ liệu chung' || !['Hoa tươi', 'Lá'].includes(material.LOAI_NVL)) return 'Phụ liệu';
  return line.NGUYEN_VAT_LIEU_ID === mainId ? 'Chính' : 'Phụ';
};

const migrateBoms = async () => {
  const recipes = await (await c(COLLECTIONS.legacyRecipe)).find({}).toArray();
  const materials = await (await c(COLLECTIONS.material)).find({}).toArray();
  const byId = new Map(materials.map((m: any) => [m.NGUYEN_VAT_LIEU_ID, { ...m, ...inferMaterial(m), ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) }]));
  const existing = new Set((await (await c(COLLECTIONS.bom)).find({}).project({ SAN_PHAM_ID: 1 }).toArray()).map((b: any) => b.SAN_PHAM_ID));
  const byProduct = new Map<string, any[]>();
  recipes.forEach((r: any) => byProduct.set(r.SAN_PHAM_ID, [...(byProduct.get(r.SAN_PHAM_ID) || []), r]));

  // Sản phẩm mua kèm (SPM143..146) chưa có công thức → map 1-1 sang NVL cùng tên
  const products = await (await c(COLLECTIONS.product)).find({}).project({ SAN_PHAM_ID: 1, TEN_SAN_PHAM: 1, KIEU_DANG: 1 }).toArray();
  products.forEach((p: any) => {
    if (byProduct.has(p.SAN_PHAM_ID)) return;
    const m = materials.find((x: any) => normalizeText(x.TEN_NGUYEN_VAT_LIEU) === normalizeText(p.TEN_SAN_PHAM));
    if (m) byProduct.set(p.SAN_PHAM_ID, [{ SAN_PHAM_ID: p.SAN_PHAM_ID, NGUYEN_VAT_LIEU_ID: m.NGUYEN_VAT_LIEU_ID, SO_LUONG_CAN: 1, DON_VI_TINH: m.DON_VI_TINH, GHI_CHU: 'Sản phẩm mua kèm = 1 NVL' }]);
  });

  let created = 0;
  let flagged = 0;
  const bomCol = await c(COLLECTIONS.bom);
  const lineCol = await c(COLLECTIONS.bomLine);
  let seq = await bomCol.countDocuments({});
  for (const [productId, rows] of byProduct) {
    if (existing.has(productId)) continue;
    const flowers = rows.filter((r) => ['Hoa tươi'].includes(byId.get(r.NGUYEN_VAT_LIEU_ID)?.LOAI_NVL));
    const main = (flowers.length ? flowers : rows).slice().sort((a, b) => Number(b.SO_LUONG_CAN) - Number(a.SO_LUONG_CAN))[0];
    let needsReview = false;
    const lines = rows.map((r) => {
      const m: any = byId.get(r.NGUYEN_VAT_LIEU_ID);
      const compatible = unitsCompatible(r.DON_VI_TINH, m?.DON_VI_TINH);
      if (!m || !compatible) needsReview = true;
      const subs = m?.NHOM_THAY_THE
        ? materials.filter((x: any) => x.NGUYEN_VAT_LIEU_ID !== m.NGUYEN_VAT_LIEU_ID && (byId.get(x.NGUYEN_VAT_LIEU_ID) as any)?.NHOM_THAY_THE === m.NHOM_THAY_THE).slice(0, 4).map((x: any) => x.NGUYEN_VAT_LIEU_ID)
        : [];
      return {
        NGUYEN_VAT_LIEU_ID: r.NGUYEN_VAT_LIEU_ID,
        DINH_LUONG: roundQty(r.SO_LUONG_CAN),
        DON_VI_TINH: m?.DON_VI_TINH || r.DON_VI_TINH,
        VAI_TRO: pickRole(r, m, main?.NGUYEN_VAT_LIEU_ID || null),
        DS_THAY_THE: subs,
        GHI_CHU: [r.GHI_CHU || '', !compatible ? `[Rà soát] Công thức cũ ghi đơn vị "${r.DON_VI_TINH}", NVL dùng "${m?.DON_VI_TINH}".` : ''].filter(Boolean).join(' '),
      };
    });
    if (!lines.some((l) => l.VAI_TRO === 'Chính')) lines[0].VAI_TRO = 'Chính';
    created++;
    if (needsReview) flagged++;
    if (DRY) continue;
    seq++;
    const bomId = `BOM${String(seq).padStart(5, '0')}`;
    await bomCol.insertOne({
      _id: bomId, BOM_ID: bomId, SAN_PHAM_ID: productId, PHIEN_BAN: 1, TRANG_THAI: BOM_STATUS.active, CHO_THAY_THE_NVL: true,
      HIEU_LUC_TU: new Date(), HIEU_LUC_DEN: null, CAN_RA_SOAT: needsReview, GHI_CHU: 'Tạo tự động từ CONG_THUC_SAN_PHAM', NGUOI_TAO: SYSTEM.id, NGAY_TAO: new Date(),
    });
    await lineCol.insertMany(lines.map((l) => ({ _id: `${bomId}:${l.NGUYEN_VAT_LIEU_ID}`, BOM_ID: bomId, ...l })));
  }
  if (!DRY) await (await c(COLLECTIONS.counter)).updateOne({ _id: `${COLLECTIONS.bom}:BOM` }, { $max: { value: seq } }, { upsert: true });
  log(`BOM v1 tạo mới: ${created} (cần rà soát đơn vị: ${flagged})`);
};

/* ------------------------------------------------------------------
 * SEED DEMO — dữ liệu mẫu bám dữ liệu thật, gắn cờ DU_LIEU_MAU
 * ------------------------------------------------------------------ */

const at = (days: number, hh = 9, mm = 0) => {
  const d = new Date();
  // tính theo giờ VN (UTC+7)
  const vn = new Date(d.getTime() + 7 * 3600_000);
  vn.setUTCDate(vn.getUTCDate() + days);
  vn.setUTCHours(hh, mm, 0, 0);
  return new Date(vn.getTime() - 7 * 3600_000);
};

const seedDemo = async () => {
  const counters = await c(COLLECTIONS.counter);
  if (!(await counters.findOne({ _id: MARKER_MIGRATE }))) throw new Error('Chưa chạy inventory:migrate.');
  if (await counters.findOne({ _id: MARKER_DEMO })) { log('Dữ liệu mẫu đã có. Chạy inventory:reset-demo nếu muốn tạo lại.'); return; }
  const demo = { demo: true };
  const supplierCol = await c(COLLECTIONS.supplier);
  const materials = await (await c(COLLECTIONS.material)).find({}).toArray();
  const has = (id: string) => materials.some((m: any) => m.NGUYEN_VAT_LIEU_ID === id);

  // a. Hai NCC phụ kiện/quà tặng (NCC hiện có đều là vườn hoa)
  const extraSuppliers = [
    { _id: 'NCC016', NHA_CUNG_CAP_ID: 'NCC016', TEN_NHA_CUNG_CAP: 'Bao Bì Hoa Sài Gòn (mẫu)', NGUOI_DAI_DIEN: 'Lê Minh Tâm', SDT: '0902000016', EMAIL: 'baobihoa.sg@example.com', DIA_CHI: 'Q.5, TP.HCM', MA_SO_THUE: '0319999016', TRANG_THAI: 'Hoạt động', GIO_CHOT_DON: '15:00', SO_NGAY_GIAO_MAC_DINH: 3, DIEU_KHOAN_THANH_TOAN: 'Công nợ 15 ngày', DU_LIEU_MAU: true },
    { _id: 'NCC017', NHA_CUNG_CAP_ID: 'NCC017', TEN_NHA_CUNG_CAP: 'Quà Tặng Yên Gift (mẫu)', NGUOI_DAI_DIEN: 'Phạm Thu Hà', SDT: '0902000017', EMAIL: 'yengift@example.com', DIA_CHI: 'Q.3, TP.HCM', MA_SO_THUE: '0319999017', TRANG_THAI: 'Hoạt động', GIO_CHOT_DON: '16:00', SO_NGAY_GIAO_MAC_DINH: 2, DIEU_KHOAN_THANH_TOAN: 'Thanh toán khi nhận', DU_LIEU_MAU: true },
  ];
  for (const s of extraSuppliers) if (!(await supplierCol.findOne({ NHA_CUNG_CAP_ID: s.NHA_CUNG_CAP_ID }))) await supplierCol.insertOne(s);
  await supplierCol.updateMany({ NHA_CUNG_CAP_ID: { $in: ['NCC001', 'NCC002', 'NCC008'] } }, { $set: { SO_NGAY_GIAO_MAC_DINH: 1, GIO_CHOT_DON: '12:00' } });
  await supplierCol.updateMany({ NHA_CUNG_CAP_ID: 'NCC005' }, { $set: { SO_NGAY_GIAO_MAC_DINH: 5, GIO_CHOT_DON: '10:00' } });

  // b. Nguồn cung NCC–NVL
  const flowerSuppliers = ['NCC001', 'NCC002', 'NCC003', 'NCC004', 'NCC008', 'NCC013'];
  const links: any[] = [];
  materials.forEach((m: any, i: number) => {
    const inf = inferMaterial(m);
    const id = m.NGUYEN_VAT_LIEU_ID;
    if (inf.LOAI_NVL === 'Hoa tươi' || inf.LOAI_NVL === 'Lá') {
      const rare = ['NVL009', 'NVL018', 'NVL019', 'NVL026', 'NVL027'].includes(id);
      if (rare) links.push({ supplierId: 'NCC005', materialId: id, leadDays: 5, priority: 1, confidence: 'Thấp', unitCost: Math.round(Number(m.GIA_NHAP) * 1.1), minOrderQty: 20 });
      links.push({ supplierId: flowerSuppliers[i % flowerSuppliers.length], materialId: id, leadDays: 1, priority: rare ? 2 : 1, confidence: 'Cao', unitCost: Number(m.GIA_NHAP), minOrderQty: 10 });
      links.push({ supplierId: flowerSuppliers[(i + 1) % flowerSuppliers.length], materialId: id, leadDays: 2, priority: 3, confidence: 'Trung bình', unitCost: Math.round(Number(m.GIA_NHAP) * 1.05), minOrderQty: 20 });
    } else if (inf.LOAI_NVL === 'Quà tặng kèm') {
      links.push({ supplierId: 'NCC017', materialId: id, leadDays: 2, priority: 1, confidence: 'Cao', unitCost: Number(m.GIA_NHAP), minOrderQty: 5 });
    } else if (inf.LOAI_NVL !== 'Phụ liệu chung') {
      links.push({ supplierId: 'NCC016', materialId: id, leadDays: 3, priority: 1, confidence: 'Cao', unitCost: Number(m.GIA_NHAP), minOrderQty: 10 });
    }
  });
  if (has('NVL012')) links.push({ supplierId: 'NCC009', materialId: 'NVL012', leadDays: 1, priority: 1, confidence: 'Cao', unitCost: 6000, minOrderQty: 20 });
  if (has('NVL001')) links.push({ supplierId: 'NCC007', materialId: 'NVL001', leadDays: 1, priority: 5, confidence: 'Thấp', unitCost: 7000, minOrderQty: 50, note: 'NCC đang tạm ngưng — để kiểm thử lọc NCC không hoạt động' });
  for (const l of links) {
    const doc: any = await master.upsertSupplierMaterial(l, SYSTEM);
    await (await c(COLLECTIONS.supplierMaterial)).updateOne({ _id: doc._id }, { $set: { DU_LIEU_MAU: true } });
  }
  log(`Nguồn cung NCC–NVL: ${links.length}`);

  // c. PO
  const po1: any = await master.createPurchaseOrder({ supplierId: 'NCC001', expectedAt: at(1, 9), note: 'Hồng + baby cho đơn ngày mai', lines: [{ materialId: 'NVL001', quantity: 300, unitCost: 8000 }, { materialId: 'NVL007', quantity: 20, unitCost: 2000 }] }, SYSTEM, demo);
  await master.changePurchaseOrderStatus(po1.PO_ID, PO_STATUS.waiting, SYSTEM);
  await master.changePurchaseOrderStatus(po1.PO_ID, PO_STATUS.shipping, SYSTEM);
  const po2: any = await master.createPurchaseOrder({ supplierId: 'NCC009', expectedAt: at(2, 8), note: 'Lan chờ NCC xác nhận', lines: [{ materialId: 'NVL012', quantity: 100, unitCost: 6000 }] }, SYSTEM, demo);
  await master.changePurchaseOrderStatus(po2.PO_ID, PO_STATUS.waiting, SYSTEM);
  const po3: any = await master.createPurchaseOrder({ supplierId: 'NCC005', expectedAt: at(5, 10), note: 'Tulip nhập khẩu — lead time 5 ngày', lines: [{ materialId: 'NVL009', quantity: 50, unitCost: 24000 }] }, SYSTEM, demo);
  await master.changePurchaseOrderStatus(po3.PO_ID, PO_STATUS.waiting, SYSTEM);
  await master.changePurchaseOrderStatus(po3.PO_ID, PO_STATUS.shipping, SYSTEM);
  const po4: any = await master.createPurchaseOrder({ supplierId: 'NCC001', expectedAt: at(0, 7), note: 'PO đã giao — liên kết phiếu nhập mẫu', lines: [{ materialId: 'NVL001', quantity: 100, unitCost: 8000 }, { materialId: 'NVL004', quantity: 50, unitCost: 4500 }] }, SYSTEM, demo);
  await master.changePurchaseOrderStatus(po4.PO_ID, PO_STATUS.waiting, SYSTEM);
  await master.changePurchaseOrderStatus(po4.PO_ID, PO_STATUS.shipping, SYSTEM);
  log(`PO: ${po1.PO_ID} (Đang giao), ${po2.PO_ID} (Chờ NCC), ${po3.PO_ID} (Đang giao, 5 ngày), ${po4.PO_ID} (sẽ giao đủ)`);

  // d. Phiếu nhập
  const pn1: any = await stock.createImport({
    type: IMPORT_TYPES.purchase, supplierId: 'NCC001', purchaseOrderId: po4.PO_ID, receivedAt: at(0, 7, 30), note: 'Ví dụ D02.5: 100 nhận, 95 đạt, shop trả đủ 800.000đ',
    details: [
      { materialId: 'NVL001', expectedQty: 100, receivedQty: 100, acceptedQty: 95, rejectedQty: 5, unitPrice: 8000, chargesAcceptedOnly: false, note: '5 bông dập cánh' },
      { materialId: 'NVL004', expectedQty: 50, receivedQty: 50, acceptedQty: 50, rejectedQty: 0, unitPrice: 4500, chargesAcceptedOnly: true },
    ],
  }, SYSTEM, demo);
  await stock.postImport(pn1.PHIEU_NHAP_ID, SYSTEM);
  const pn2: any = await stock.createImport({
    type: IMPORT_TYPES.purchase, supplierId: 'NCC016', receivedAt: at(-1, 14), note: 'Nhập giấy gói & ruy băng',
    details: [
      { materialId: 'NVL051', receivedQty: 200, rejectedQty: 0, unitPrice: 1200, chargesAcceptedOnly: true },
      { materialId: 'NVL075', receivedQty: 10, rejectedQty: 0, unitPrice: 42000, chargesAcceptedOnly: true },
    ],
  }, SYSTEM, demo);
  await stock.postImport(pn2.PHIEU_NHAP_ID, SYSTEM);
  const pn3: any = await stock.createImport({
    type: IMPORT_TYPES.purchase, supplierId: 'NCC009', receivedAt: at(0, 10), note: 'PHIẾU NHÁP để nhóm thử bấm "Ghi nhận"',
    details: [{ materialId: 'NVL012', expectedQty: 60, receivedQty: 60, acceptedQty: 55, rejectedQty: 5, unitPrice: 6000, chargesAcceptedOnly: true }],
  }, SYSTEM, demo);
  log(`PN: ${pn1.PHIEU_NHAP_ID} (Posted, liên kết ${po4.PO_ID}), ${pn2.PHIEU_NHAP_ID} (Posted), ${pn3.PHIEU_NHAP_ID} (Nháp)`);

  // e. Đánh dấu không đạt & xuất hủy một phần
  await stock.markMaterialDamaged({ materialId: 'NVL001', quantity: 10, note: 'Hoa héo khi kiểm kho sáng' }, SYSTEM, demo);
  const pxDispose: any = await stock.createExport({ type: EXPORT_TYPES.quarantineDisposal, note: 'Hủy 4 bông héo đã cách ly', details: [{ materialId: 'NVL001', quantity: 4 }] }, SYSTEM, demo);
  await stock.postExport(pxDispose.PHIEU_XUAT_ID, SYSTEM);
  const pxLoss: any = await stock.createExport({ type: EXPORT_TYPES.storageLoss, note: 'Cúc gãy cành khi bảo quản', details: [{ materialId: 'NVL005', quantity: 5 }] }, SYSTEM, demo);
  await stock.postExport(pxLoss.PHIEU_XUAT_ID, SYSTEM);

  // f. Cắm bó sẵn 2 bó SP0204 (nếu có)
  const products = await c(COLLECTIONS.product);
  const readyProduct = (await products.findOne({ SAN_PHAM_ID: 'SP0204' })) ? 'SP0204' : (await products.findOne({}))?.SAN_PHAM_ID;
  if (readyProduct) {
    const lines = await stock.suggestExportLines({ type: EXPORT_TYPES.readyMade, productId: readyProduct, bundles: 2 });
    const px: any = await stock.createExport({ type: EXPORT_TYPES.readyMade, productId: readyProduct, bundles: 2, note: 'Cắm sẵn trưng bày', details: lines }, SYSTEM, demo);
    await stock.postExport(px.PHIEU_XUAT_ID, SYSTEM);
    log(`Cắm bó sẵn ${readyProduct} × 2 (${px.PHIEU_XUAT_ID})`);
  }

  // g. Giữ tồn cho đơn thật đang chuẩn bị + phiếu xuất NHÁP để thử "xuất 1 lần"
  const orders = await c(COLLECTIONS.order);
  // Thử lần lượt các đơn đang chuẩn bị / chờ xử lý cho tới khi giữ đủ (đơn nào thiếu NVL sẽ được ghi log — đúng nghiệp vụ)
  const candidates = await orders.find({ TRANG_THAI: { $in: ['Đang chuẩn bị hàng', 'Chờ xử lý', 'Chờ vận chuyển'] } }).sort({ TRANG_THAI: 1 }).toArray();
  const touchedOrders: string[] = [];
  for (const preparing of candidates) {
    if (['YEN16082', 'YEN16106'].includes(preparing.DON_HANG_ID)) continue; // để dành làm đơn tương lai
    const items = (await (await c(COLLECTIONS.orderDetail)).find({ DON_HANG_ID: preparing.DON_HANG_ID }).toArray()).map((d: any) => ({ productId: d.SAN_PHAM_ID, quantity: d.SO_LUONG }));
    if (!items.length) continue;
    try {
      await stock.reserveProducts(items, { status: RESERVATION_STATUS.official, orderId: preparing.DON_HANG_ID, neededAt: at(0, 16), actor: SYSTEM, demo: true });
      await stock.setOrderPrepTime(preparing.DON_HANG_ID, at(0, 16), SYSTEM);
      touchedOrders.push(preparing.DON_HANG_ID);
      const lines = await stock.suggestExportLines({ type: EXPORT_TYPES.order, orderId: preparing.DON_HANG_ID });
      const px: any = await stock.createExport({ type: EXPORT_TYPES.order, orderId: preparing.DON_HANG_ID, note: 'PHIẾU NHÁP — bấm Ghi nhận khi bắt đầu cắm', details: lines }, SYSTEM, demo);
      log(`Giữ chính thức cho ${preparing.DON_HANG_ID} (${preparing.TRANG_THAI}), PX nháp ${px.PHIEU_XUAT_ID}`);
      break;
    } catch (e: any) {
      const missing = (e.details?.shortages || []).map((x: any) => `${x.name} thiếu ${x.missing}`).join(', ');
      log(`Đơn ${preparing.DON_HANG_ID} không giữ đủ: ${e.message} ${missing}`);
    }
  }

  // h. Giữ tạm QR (tự nhả sau thời gian giữ) — mô phỏng khách đang ở màn hình thanh toán
  const qrProduct = (await products.findOne({ SAN_PHAM_ID: 'SP0213' })) ? 'SP0213' : readyProduct;
  if (qrProduct) {
    try {
      await stock.reserveProducts([{ productId: qrProduct, quantity: 1 }], { status: RESERVATION_STATUS.temporary, paymentSessionId: `QR-DEMO-${new ObjectId().toHexString().slice(-6)}`, actor: SYSTEM, demo: true });
    } catch (e: any) { log(`Giữ tạm QR mẫu thất bại: ${e.message}`); }
  }

  // i. Nhu cầu dự kiến cho đơn tương lai: 1 đơn có T ngày mai (dự báo thiếu hồng), 1 đơn chưa xếp T
  const futureA = await orders.findOne({ DON_HANG_ID: 'YEN16082' }) || await orders.findOne({ TRANG_THAI: 'Chờ xử lý' });
  if (futureA) {
    await stock.recordOrderDemand(futureA.DON_HANG_ID, { neededAt: at(1, 8).toISOString(), items: [{ productId: 'SP0213', quantity: 3 }, { productId: 'SP0204', quantity: 2 }].filter(Boolean) }, SYSTEM, demo).catch((e) => log(e.message));
    touchedOrders.push(futureA.DON_HANG_ID);
  }
  const futureB = await orders.findOne({ DON_HANG_ID: 'YEN16106' }) || await orders.findOne({ TRANG_THAI: 'Chờ xử lý', DON_HANG_ID: { $ne: futureA?.DON_HANG_ID } });
  if (futureB) {
    await stock.recordOrderDemand(futureB.DON_HANG_ID, {}, SYSTEM, demo).catch((e) => log(e.message));
    touchedOrders.push(futureB.DON_HANG_ID);
  }

  await counters.updateOne({ _id: MARKER_DEMO }, { $set: { at: new Date(), orders: touchedOrders } }, { upsert: true });
  const rec = await stock.reconcileInventory(false);
  log(`Seed demo xong. Đối soát: ${rec.ok ? 'KHỚP' : `LỆCH ${rec.diffs.length}`}`);
};

const resetDemo = async () => {
  const counters = await c(COLLECTIONS.counter);
  const marker = await counters.findOne({ _id: MARKER_DEMO });
  const tagged = [
    COLLECTIONS.supplierMaterial, COLLECTIONS.purchaseOrder, COLLECTIONS.importSlip, COLLECTIONS.importDetail,
    COLLECTIONS.exportSlip, COLLECTIONS.exportDetail, COLLECTIONS.reservation, COLLECTIONS.demand, COLLECTIONS.movement, COLLECTIONS.supplier,
  ];
  for (const name of tagged) {
    const r = await (await c(name)).deleteMany({ DU_LIEU_MAU: true });
    log(`Xóa ${r.deletedCount} bản ghi mẫu trong ${name}`);
  }
  const orderIds: string[] = marker?.orders || [];
  if (orderIds.length) {
    await (await c(COLLECTIONS.order)).updateMany({ DON_HANG_ID: { $in: orderIds } }, { $unset: { DA_XUAT_NVL: '', PHIEU_XUAT_NVL_ID: '', NGAY_XUAT_NVL: '', THOI_DIEM_BAT_DAU_CHUAN_BI: '', NGUOI_NHAP_T: '' } });
  }
  const rec = await stock.reconcileInventory(true);
  log(`Tính lại bộ đếm từ sổ biến động: sửa ${rec.diffs.length} chỗ.`);
  await counters.deleteOne({ _id: MARKER_DEMO });
};

const main = async () => {
  try {
    if (args.has('--migrate')) await migrate();
    if (args.has('--seed-demo')) await seedDemo();
    if (args.has('--reset-demo')) await resetDemo();
    if (args.has('--reconcile')) {
      const r = await stock.reconcileInventory(args.has('--fix'));
      log(r.ok ? `Đối soát KHỚP (${r.checkedMaterials} NVL).` : `Đối soát LỆCH ${r.diffs.length}:`);
      if (!r.ok) console.dir(r.diffs.slice(0, 30), { depth: 4 });
    }
    if (![...args].some((a) => ['--migrate', '--seed-demo', '--reset-demo', '--reconcile'].includes(a))) {
      log('Chọn một tác vụ: --migrate [--dry-run] | --seed-demo | --reset-demo | --reconcile [--fix]');
    }
  } catch (error) {
    console.error('[inventory-setup] LỖI:', error);
    process.exit(1);
  }
  process.exit(0);
};

main();
