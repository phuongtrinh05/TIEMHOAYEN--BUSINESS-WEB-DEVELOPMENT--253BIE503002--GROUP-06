import { getCollection } from '../mongo.js';
import { withTransaction } from '../services/inventory/helpers.js';

const groups = [
  {
    name: 'Hoa phụ dạng chùm (kg)',
    ids: ['NVL007', 'NVL014', 'NVL022', 'NVL024'],
  },
] as const;

async function main() {
  const apply = process.argv.includes('--apply');
  const materials = await getCollection<any>('NGUYEN_VAT_LIEU');
  const bomHeaders = await getCollection<any>('BOM_SAN_PHAM');
  const bomLines = await getCollection<any>('CHI_TIET_BOM');
  const activeBoms = await bomHeaders.find({ TRANG_THAI: 'Hiệu lực' }, { projection: { BOM_ID: 1, SAN_PHAM_ID: 1 } }).toArray();
  const activeIds = activeBoms.map(row => row.BOM_ID);
  const managedMaterialIds = groups.flatMap(group => [...group.ids]);
  const managedSource = 'SALES_BOM_ACCESSORY_RULE_2026_11';
  const plans: any[] = [];
  for (const group of groups) {
    const rows = await materials.find({ NGUYEN_VAT_LIEU_ID: { $in: [...group.ids] }, TRANG_THAI: 'Đang sử dụng' }).toArray();
    if (rows.length !== group.ids.length) throw new Error(`${group.name}: thiếu NVL đang sử dụng.`);
    const units = new Set(rows.map(row => String(row.DON_VI_TINH || '').trim().toLocaleLowerCase('vi')));
    if (units.size !== 1) throw new Error(`${group.name}: các NVL không cùng đơn vị.`);
    for (const materialId of group.ids) {
      const substitutes = group.ids.filter(id => id !== materialId);
      const count = await bomLines.countDocuments({
        BOM_ID: { $in: activeIds },
        NGUYEN_VAT_LIEU_ID: materialId,
        VAI_TRO: 'Phụ',
      });
      if (count) plans.push({ group: group.name, materialId, substitutes, affectedLines: count });
    }
  }
  const revokedLines = await bomLines.countDocuments({
    BOM_ID: { $in: activeIds },
    NGUYEN_VAT_LIEU_ID: { $in: managedMaterialIds },
    VAI_TRO: { $ne: 'Phụ' },
    NGUON_CAP_NHAT: managedSource,
    CHO_PHEP_THAY_THE: true,
  });
  const summary = { mode: apply ? 'APPLY' : 'PREVIEW', groups: groups.length,
    affectedLines: plans.reduce((sum, row) => sum + row.affectedLines, 0), revokedLines, plans };
  if (!apply) { console.log(JSON.stringify(summary, null, 2)); process.exit(0); }
  await withTransaction(async session => {
    for (const plan of plans) {
      await bomLines.updateMany({
        BOM_ID: { $in: activeIds },
        NGUYEN_VAT_LIEU_ID: plan.materialId,
        VAI_TRO: 'Phụ',
      }, { $set: {
        CHO_PHEP_THAY_THE: true,
        DS_THAY_THE: plan.substitutes,
        QUY_TAC_THAY_THE: plan.substitutes.map((id: string) => ({ NGUYEN_VAT_LIEU_ID: id, TY_LE_QUY_DOI: 1,
          DIEU_KIEN: `Chỉ thay trong nhóm ${plan.group}; Sales phải xác nhận màu/kiểu phù hợp với mẫu và khách đồng ý phương án.` })),
        CAP_NHAT_LUC: new Date(), NGUON_CAP_NHAT: managedSource,
      } }, { session });
    }
    await bomLines.updateMany({
      BOM_ID: { $in: activeIds },
      NGUYEN_VAT_LIEU_ID: { $in: managedMaterialIds },
      VAI_TRO: { $ne: 'Phụ' },
      NGUON_CAP_NHAT: managedSource,
    }, {
      $set: {
        CHO_PHEP_THAY_THE: false,
        DS_THAY_THE: [],
        QUY_TAC_THAY_THE: [],
        CAP_NHAT_LUC: new Date(),
        NGUON_CAP_NHAT: managedSource,
      },
    }, { session });
  });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
