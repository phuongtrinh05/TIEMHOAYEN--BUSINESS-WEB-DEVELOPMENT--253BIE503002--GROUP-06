import { getCollection } from '../mongo.js';

async function main() {
const boms = await (await getCollection<any>('BOM_SAN_PHAM')).find({ TRANG_THAI: 'Hiệu lực' }).toArray();
const ids = boms.map(row => row.BOM_ID);
const lines = await (await getCollection<any>('CHI_TIET_BOM')).find({ BOM_ID: { $in: ids } }).toArray();
const configured = lines.filter(line => line.CHO_PHEP_THAY_THE === true
  && ((Array.isArray(line.DS_THAY_THE) && line.DS_THAY_THE.length) || (Array.isArray(line.QUY_TAC_THAY_THE) && line.QUY_TAC_THAY_THE.length)));
const enabledHeaders = boms.filter(row => row.CHO_THAY_THE_NVL === true);
const materials = await (await getCollection<any>('NGUYEN_VAT_LIEU')).find({}, { projection: { _id: 0 } }).toArray();
const accessoryPattern = /giấy|ruy băng|ribbon|nơ|dây|xốp|mút|lưới|túi|hộp|giỏ|thiệp|băng keo|kẽm|lá phụ|phụ kiện/i;
const accessories = materials.filter(row => accessoryPattern.test(String(row.TEN_NGUYEN_VAT_LIEU || '')))
  .map(row => ({ id: row.NGUYEN_VAT_LIEU_ID, name: row.TEN_NGUYEN_VAT_LIEU, unit: row.DON_VI_TINH,
    type: row.LOAI_NGUYEN_VAT_LIEU || row.NHOM_NGUYEN_VAT_LIEU || row.NHOM || null, status: row.TRANG_THAI }));
console.log(JSON.stringify({ readOnly: true, activeBoms: boms.length, activeLines: lines.length,
  enabledHeaders: enabledHeaders.length, configuredSubstitutionLines: configured.length,
  configuredProducts: new Set(configured.map(line => boms.find(bom => bom.BOM_ID === line.BOM_ID)?.SAN_PHAM_ID).filter(Boolean)).size,
  usedMaterials: [...new Set(lines.map(line => line.NGUYEN_VAT_LIEU_ID))].map(id => {
    const material = materials.find(row => row.NGUYEN_VAT_LIEU_ID === id);
    return { id, name: material?.TEN_NGUYEN_VAT_LIEU || id, unit: material?.DON_VI_TINH || null,
      lineCount: lines.filter(line => line.NGUYEN_VAT_LIEU_ID === id).length };
  }).sort((a, b) => b.lineCount - a.lineCount),
  samples: configured.slice(0, 20).map(line => ({ bomId: line.BOM_ID, materialId: line.NGUYEN_VAT_LIEU_ID,
    substitutes: line.DS_THAY_THE || [], rules: line.QUY_TAC_THAY_THE || [] })),
  accessoryMaterials: accessories,
}, null, 2));
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
