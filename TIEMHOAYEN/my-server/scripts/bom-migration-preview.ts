/**
 * Read-only BOM migration preview.
 * This script deliberately has no write mode. Atlas changes require a separate approval.
 */
import { getCollection } from '../mongo.js';

const key = (row: any) => `${row.SAN_PHAM_ID}|${row.NGUYEN_VAT_LIEU_ID}`;
const normalizedUnit = (value: unknown) => String(value || '').normalize('NFC').trim().toLocaleLowerCase('vi');

async function main(){
const products = await (await getCollection<any>('SAN_PHAM')).find({}, { projection: { _id:0,SAN_PHAM_ID:1,TEN_SAN_PHAM:1 } }).toArray();
const headers = await (await getCollection<any>('BOM_SAN_PHAM')).find({}, { projection: { _id:0,BOM_ID:1,SAN_PHAM_ID:1,PHIEN_BAN:1,TRANG_THAI:1 } }).toArray();
const active = headers.filter(row => row.TRANG_THAI === 'Hiệu lực');
const activeIds = active.map(row => row.BOM_ID);
const [bomLines, legacy] = await Promise.all([
  (await getCollection<any>('CHI_TIET_BOM')).find({ BOM_ID: { $in: activeIds } }).toArray(),
  (await getCollection<any>('CONG_THUC_SAN_PHAM')).find({}).toArray(),
]);
const headerById = new Map(active.map(row => [row.BOM_ID, row]));
const activeByProduct = new Map(active.map(row => [row.SAN_PHAM_ID, row]));
const bomRows = bomLines.map(line => ({ ...line, SAN_PHAM_ID: headerById.get(line.BOM_ID)?.SAN_PHAM_ID }));
const bomMap = new Map(bomRows.map(row => [key(row), row]));
const legacyMap = new Map(legacy.map(row => [key(row), row]));

const missingBomProducts = products.filter(product => !activeByProduct.has(product.SAN_PHAM_ID));
const candidates = missingBomProducts.map(product => ({
  productId: product.SAN_PHAM_ID,
  productName: product.TEN_SAN_PHAM,
  source: 'CONG_THUC_SAN_PHAM',
  proposedVersion: 1,
  lines: legacy.filter(row => row.SAN_PHAM_ID === product.SAN_PHAM_ID).map(row => ({
    materialId: row.NGUYEN_VAT_LIEU_ID,
    quantity: row.SO_LUONG_CAN,
    unit: row.DON_VI_TINH,
    role: 'Chính',
    required: true,
    allowSubstitution: false,
    sourceId: key(row),
  })),
}));

const differences:any[]=[];
for(const [rowKey, oldRow] of legacyMap){
  const newRow:any=bomMap.get(rowKey);
  if(!newRow){differences.push({type:'MISSING_IN_ACTIVE_BOM',key:rowKey,legacy:{quantity:oldRow.SO_LUONG_CAN,unit:oldRow.DON_VI_TINH}});continue;}
  const quantityChanged=Number(oldRow.SO_LUONG_CAN)!==Number(newRow.DINH_LUONG);
  const unitChanged=normalizedUnit(oldRow.DON_VI_TINH)!==normalizedUnit(newRow.DON_VI_TINH);
  if(quantityChanged||unitChanged)differences.push({type:quantityChanged&&unitChanged?'QUANTITY_AND_UNIT':quantityChanged?'QUANTITY':'UNIT',key:rowKey,
    legacy:{quantity:oldRow.SO_LUONG_CAN,unit:oldRow.DON_VI_TINH},activeBom:{bomId:newRow.BOM_ID,quantity:newRow.DINH_LUONG,unit:newRow.DON_VI_TINH}});
}
for(const [rowKey,newRow] of bomMap)if(!legacyMap.has(rowKey))differences.push({type:'ONLY_IN_ACTIVE_BOM',key:rowKey,activeBom:{bomId:newRow.BOM_ID,quantity:newRow.DINH_LUONG,unit:newRow.DON_VI_TINH}});

console.log(JSON.stringify({readOnly:true,generatedAt:new Date().toISOString(),summary:{products:products.length,activeBoms:active.length,activeBomLines:bomRows.length,legacyLines:legacy.length,
  productsWithoutActiveBom:missingBomProducts.length,migrationCandidates:candidates.filter(row=>row.lines.length).length,manualReview:candidates.filter(row=>!row.lines.length).length,differences:differences.length},
  migrationCandidates:candidates.filter(row=>row.lines.length),productsNeedingManualFormula:candidates.filter(row=>!row.lines.length),differences},null,2));
}

main().catch(error=>{console.error(error);process.exitCode=1});
