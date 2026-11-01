import {createHash, randomBytes} from 'node:crypto';
import type {ClientSession} from 'mongodb';
import {COLLECTIONS, MATERIAL_STATUS} from './inventory/constants.js';
import {availableOf, col, InventoryError, roundQty, withTransaction, vnDateKey} from './inventory/helpers.js';

export const DESIGN_MODELS = ['rose','lily','sunflower','baby','gerbera','carnation','chrysanthemum','tuberose','tulip','lotus','lisianthus','orchid'];
export const DESIGN_MODEL_COLORS: Record<string,string[]> = {rose:['Đỏ','Hồng'],lily:['Hồng'],sunflower:['Vàng'],baby:['Trắng'],gerbera:['Đỏ'],carnation:['Hồng'],chrysanthemum:['Trắng'],tuberose:['Trắng'],tulip:['Hồng','Trắng'],lotus:['Hồng'],lisianthus:['Tím'],orchid:['Tím']};
export const designColorsOf = (m:any):string[] => Array.isArray(m.MAU_3D_CHO_PHEP) && m.MAU_3D_CHO_PHEP.length ? m.MAU_3D_CHO_PHEP : DESIGN_MODEL_COLORS[m.MODEL_3D_KEY] || (m.MAU_3D?[m.MAU_3D]:[]);
export const normalizeColorQuantities = (raw:any, quantity:number) => {
  if(raw===undefined)return undefined;
  if(!Array.isArray(raw)||!raw.length||raw.length>20)throw new InventoryError(400,'Phân bổ màu không hợp lệ.');
  const seen=new Set<string>();
  const colors=raw.map(c=>{
    const color=String(c.color || '').trim(),q=Number(c.quantity);
    if(!color || color.length>50 || seen.has(color) || !Number.isFinite(q) || q<=0 || roundQty(q)!==q)throw new InventoryError(400,'Màu hoặc định lượng màu không hợp lệ.');
    seen.add(color);return {color,quantity:q};
  }).sort((a,b)=>a.color.localeCompare(b.color));
  if(roundQty(colors.reduce((n,c)=>n+c.quantity,0))!==quantity)throw new InventoryError(400,'Tổng số lượng theo màu phải bằng định lượng NVL.');
  return colors;
};
export const isDesignProduct = (id: string) => /^SP3D_TK3D[a-f0-9]{32}$/.test(id);
export const designIdOf = (id: string) => isDesignProduct(id) ? id.slice(5) : id;
export const designFutureDay = (raw:any):boolean => {
  let date = raw instanceof Date ? vnDateKey(raw) : String(raw || '');
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(date))date=date.split('/').reverse().join('-');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T12:00:00+07:00')) || vnDateKey(new Date(date+'T12:00:00+07:00'))!==date || date<vnDateKey(new Date()))throw new InventoryError(400,'Ngày giao thiết kế không hợp lệ hoặc đã qua.');
  return date!==vnDateKey(new Date());
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const designFingerprint = (materials: any[], arrangement = 'auto') => hash({arrangement,
  materials: materials.map(l => ({materialId: String(l.materialId), quantity: Number(l.quantity),...(l.colors?{colors:normalizeColorQuantities(l.colors,Number(l.quantity))}:{})})).sort((a,b)=>a.materialId.localeCompare(b.materialId))});
const normalizeLines = (raw: any) => {
  if (!Array.isArray(raw) || !raw.length || raw.length > 40) throw new InventoryError(400,'Thiết kế cần từ 1–40 nguyên vật liệu.');
  const seen = new Set<string>();
  return raw.map(l => {
    const materialId = String(l.materialId || ''), quantity = Number(l.quantity);
    if (!materialId || seen.has(materialId) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000 || roundQty(quantity) !== quantity) throw new InventoryError(400,'Mã NVL/định lượng thiết kế không hợp lệ hoặc bị trùng.');
    seen.add(materialId); const colors=normalizeColorQuantities(l.colors,quantity);return {materialId, quantity,...(colors?{colors}:{})};
  }).sort((a,b)=>a.materialId.localeCompare(b.materialId));
};
export const listDesignMaterials = async () => {
  const rows = await (await col(COLLECTIONS.material)).find({DUNG_CHO_3D:true,TRANG_THAI:{$ne:MATERIAL_STATUS.hidden}}).sort({TEN_NGUYEN_VAT_LIEU:1}).toArray();
  return {models: DESIGN_MODELS, materials:rows.map(m=>({id:m.NGUYEN_VAT_LIEU_ID,name:m.TEN_NGUYEN_VAT_LIEU,unit:m.DON_VI_TINH,image:m.URL_HINH_ANH || '',
    price:Number(m.GIA_BAN || 0),available:availableOf(m),threshold:Number(m.NGUONG_CANH_BAO || 0),modelKey:m.MODEL_3D_KEY || '',color:m.MAU_3D || '',colors:designColorsOf(m)}))};
};
async function priceDesign(design: any, session?: ClientSession) {
  const materials = await (await col(COLLECTIONS.material)).find({NGUYEN_VAT_LIEU_ID:{$in:design.materials.map((l:any)=>l.materialId)}},{session}).toArray();
  const approval = await (await col('MAU_3D_DA_DUYET')).findOne({_id:design.fingerprint as any,TRANG_THAI:'Đã duyệt'},{session});
  const badges: string[] = [];
  if (!approval) badges.push('Mẫu chưa được shop duyệt khả năng thực hiện và phí hoàn thiện');
  const lines = design.materials.map((l:any)=>{
    const m = materials.find(m=>m.NGUYEN_VAT_LIEU_ID===l.materialId);
    if(l.colors?.some((c:any)=>!designColorsOf(m || {}).includes(c.color)))throw new InventoryError(400,`NVL ${l.materialId}: màu không được phép chọn.`);
    if (!m || m.TRANG_THAI===MATERIAL_STATUS.hidden || !m.DUNG_CHO_3D) badges.push(`NVL ${l.materialId} không còn dùng cho thiết kế`);
    const price=Number(m?.GIA_BAN || 0);
    if (!(price>0)) badges.push(`NVL ${l.materialId} chưa có giá bán hợp lệ`);
    if (availableOf(m)<l.quantity) badges.push(`Thiếu ${m?.TEN_NGUYEN_VAT_LIEU || l.materialId}`);
    if (m?.CAN_DUYET_3D) badges.push(`${m.TEN_NGUYEN_VAT_LIEU}: cần shop kiểm tra`);
    return {...l,name:m?.TEN_NGUYEN_VAT_LIEU || l.materialId,unit:m?.DON_VI_TINH || '',price,available:availableOf(m)};
  });
  const designFee=Number(approval?.designFee || 0),extraFee=Number(approval?.extraFee || 0);
  const price=Math.round(lines.reduce((n:number,l:any)=>n+l.quantity*l.price,0)+designFee+extraFee);
  return {designId:design.THIET_KE_3D_ID,productId:'SP3D_'+design.THIET_KE_3D_ID,name:design.name,image:design.image || '',arrangement:design.arrangement,
    fingerprint:design.fingerprint,price,designFee,extraFee,requiresReview:badges.length>0,badges:[...new Set(badges)],materials:lines};
}
export const getDesign = async (id:string,session?:ClientSession) => {
  const design=await (await col('THIET_KE_3D')).findOne({THIET_KE_3D_ID:designIdOf(id)},{session});
  if(!design)throw new InventoryError(404,'Không tìm thấy thiết kế 3D.');
  return priceDesign(design,session);
};
export const estimateDesign = async (body:any) => {
  const materials=normalizeLines(body.materials),arrangement=body.arrangement || 'auto';
  if(!['auto','radial','cluster'].includes(arrangement))throw new InventoryError(400,'Bố cục không hợp lệ.');
  return priceDesign({materials,arrangement,name:'Bó hoa tự thiết kế',fingerprint:designFingerprint(materials,arrangement)});
};
export const createDesign = async (body:any) => {
  const materials=normalizeLines(body.materials);
  const arrangement=body.arrangement || 'auto';
  if(!['auto','radial','cluster'].includes(arrangement))throw new InventoryError(400,'Bố cục không hợp lệ.');
  const image=String(body.image || '');
  if(image && (!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length>700000))throw new InventoryError(400,'Ảnh thiết kế phải là PNG/JPEG, tối đa 500 KB.');
  const id='TK3D'+randomBytes(16).toString('hex');
  const doc={_id:id,THIET_KE_3D_ID:id,name:String(body.name || 'Bó hoa tự thiết kế').trim().slice(0,150),image,materials,arrangement,fingerprint:designFingerprint(materials,arrangement),createdAt:new Date()};
  return withTransaction(async session=>{
    const quote=await priceDesign(doc,session);
    // Hidden or unrelated materials must not enter a new design even through a hand-crafted request.
    const allowed=await (await col(COLLECTIONS.material)).countDocuments({NGUYEN_VAT_LIEU_ID:{$in:materials.map(l=>l.materialId)},DUNG_CHO_3D:true,TRANG_THAI:{$ne:MATERIAL_STATUS.hidden}},{session});
    if(allowed!==materials.length)throw new InventoryError(400,'Có NVL không được dùng cho 3D.');
    await (await col('THIET_KE_3D')).insertOne(doc as any,{session});
    await (await col('THIET_KE_3D_CHI_TIET')).insertMany(materials.map(l=>({_id:{THIET_KE_3D_ID:id,NGUYEN_VAT_LIEU_ID:l.materialId},THIET_KE_3D_ID:id,NGUYEN_VAT_LIEU_ID:l.materialId,SO_LUONG:l.quantity,...(l.colors?{PHAN_BO_MAU:l.colors}:{})})),{session});
    return quote;
  });
};
/** Publish only the exact composition actually accepted by the customer and converted by staff. */
export const approveDesignFromProposal = async (item:any,request:any,employee:any,session:ClientSession) => {
  if(!item.designId || !item.custom)return;
  const original=request.items.find((l:any)=>l.designId===item.designId);
  if(!original)throw new InventoryError(409,'Thiết kế không thuộc yêu cầu này.');
  const design=await (await col('THIET_KE_3D')).findOne({THIET_KE_3D_ID:item.designId},{session});
  if(!design)throw new InventoryError(409,'Không tìm thấy thiết kế gốc.');
  const fingerprint=designFingerprint(item.bom.materials,design.arrangement);
  // A changed bouquet is an agreed proposal, but does not approve the customer's original geometry.
  if(fingerprint!==design.fingerprint)return;
  await (await col('MAU_3D_DA_DUYET')).updateOne({_id:fingerprint as any},{$set:{TRANG_THAI:'Đã duyệt',designFee:item.bom.designFee,extraFee:item.bom.extraFee,
    requestId:request.requestId,quoteId:request.quote.id,approvedBy:employee.NHAN_VIEN_ID,approvedAt:new Date()}},{upsert:true,session});
};
