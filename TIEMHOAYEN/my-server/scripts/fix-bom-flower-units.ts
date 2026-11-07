/**
 * Sửa đơn vị hoa phụ trong BOM: công thức cũ đếm theo cành/nhánh/bông nhưng khi chuyển sang BOM
 * đơn vị bị đổi thành kg/g mà con số giữ nguyên (vd "30 nhánh Baby" thành 30 kg).
 * Phương án đã duyệt: giữ nguyên số lượng, đổi đơn vị kg/g → "cành" cho NVL, dòng BOM và công thức cũ.
 *
 * Chạy thử (không ghi):   npx tsx scripts/fix-bom-flower-units.ts
 * Ghi dữ liệu:            npx tsx scripts/fix-bom-flower-units.ts --apply
 * Trước khi ghi, bản gốc được sao lưu vào collection BACKUP_BOM_UNIT_FIX_20261107 (chạy lại không sao lưu đè).
 */
import { getCollection } from '../mongo.js';

const MATERIAL_IDS = ['NVL007', 'NVL011', 'NVL014', 'NVL022', 'NVL024', 'NVL035', 'NVL037'];
const NEW_UNIT = 'cành';
const OLD_UNITS = ['kg', 'g', 'Kg', 'KG', 'G'];
const BACKUP = 'BACKUP_BOM_UNIT_FIX_20261107';
const apply = process.argv.includes('--apply');

const cleanNote = (note: unknown) => String(note ?? '')
  .replace(/\s*\[Rà soát\] Công thức cũ ghi đơn vị "[^"]*", NVL dùng "(kg|g)"\./g, '')
  .trim();

async function main() {
  const materials = await getCollection<any>('NGUYEN_VAT_LIEU');
  const bomLines = await getCollection<any>('CHI_TIET_BOM');
  const legacy = await getCollection<any>('CONG_THUC_SAN_PHAM');
  const backup = await getCollection<any>(BACKUP);

  const matFilter = { NGUYEN_VAT_LIEU_ID: { $in: MATERIAL_IDS }, DON_VI_TINH: { $in: OLD_UNITS } };
  const lineFilter = { NGUYEN_VAT_LIEU_ID: { $in: MATERIAL_IDS }, DON_VI_TINH: { $in: OLD_UNITS } };
  const [matRows, lineRows, legacyRows] = await Promise.all([
    materials.find(matFilter).toArray(), bomLines.find(lineFilter).toArray(), legacy.find(lineFilter).toArray(),
  ]);
  console.log(`NVL cần sửa: ${matRows.length} | Dòng BOM: ${lineRows.length} | Dòng công thức cũ: ${legacyRows.length}`);
  for (const m of matRows) console.log(`  ${m.NGUYEN_VAT_LIEU_ID} ${m.TEN_NGUYEN_VAT_LIEU}: ${m.SO_LUONG_TON} ${m.DON_VI_TINH} → ${m.SO_LUONG_TON} ${NEW_UNIT}`);
  if (!apply) { console.log('Chạy thử: chưa ghi gì. Thêm --apply để ghi.'); return; }

  // Sao lưu bản gốc (chỉ lần đầu cho mỗi bản ghi).
  const now = new Date();
  const docs = [
    ...matRows.map(d => ({ _id: `NGUYEN_VAT_LIEU:${JSON.stringify(d._id)}`, collection: 'NGUYEN_VAT_LIEU', original: d, backedUpAt: now })),
    ...lineRows.map(d => ({ _id: `CHI_TIET_BOM:${JSON.stringify(d._id)}`, collection: 'CHI_TIET_BOM', original: d, backedUpAt: now })),
    ...legacyRows.map(d => ({ _id: `CONG_THUC_SAN_PHAM:${JSON.stringify(d._id)}`, collection: 'CONG_THUC_SAN_PHAM', original: d, backedUpAt: now })),
  ];
  for (const doc of docs) await backup.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  console.log(`Đã sao lưu ${docs.length} bản ghi vào ${BACKUP}.`);

  let matUpdated = 0, lineUpdated = 0, legacyUpdated = 0;
  for (const m of matRows) {
    const mota = String(m.MO_TA || '').replace(/Quy cách\/bó:[^;]*/i, 'Quy cách: tính theo cành');
    const r = await materials.updateOne({ _id: m._id, DON_VI_TINH: { $in: OLD_UNITS } }, { $set: { DON_VI_TINH: NEW_UNIT, MO_TA: mota, DON_VI_CU: m.DON_VI_TINH, SUA_DON_VI_LUC: now } });
    matUpdated += r.modifiedCount;
  }
  for (const l of lineRows) {
    const rules = Array.isArray(l.QUY_TAC_THAY_THE)
      ? l.QUY_TAC_THAY_THE.map((rule: any) => ({ ...rule, DIEU_KIEN: String(rule.DIEU_KIEN || '').replace(/\((kg|g)\)/g, `(${NEW_UNIT})`) }))
      : l.QUY_TAC_THAY_THE;
    const r = await bomLines.updateOne({ _id: l._id, DON_VI_TINH: { $in: OLD_UNITS } }, { $set: {
      DON_VI_TINH: NEW_UNIT, GHI_CHU: cleanNote(l.GHI_CHU), ...(rules ? { QUY_TAC_THAY_THE: rules } : {}), SUA_DON_VI_LUC: now,
    } });
    lineUpdated += r.modifiedCount;
  }
  for (const l of legacyRows) {
    const r = await legacy.updateOne({ _id: l._id, DON_VI_TINH: { $in: OLD_UNITS } }, { $set: { DON_VI_TINH: NEW_UNIT, SUA_DON_VI_LUC: now } });
    legacyUpdated += r.modifiedCount;
  }
  console.log(`Đã cập nhật: NVL ${matUpdated} | BOM ${lineUpdated} | Công thức cũ ${legacyUpdated}.`);
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
