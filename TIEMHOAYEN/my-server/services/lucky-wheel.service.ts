import {randomInt,randomUUID} from 'node:crypto';
import type {ClientSession} from 'mongodb';
import {col,InventoryError,withTransaction as inventoryTransaction,vnDateKey,roundQty} from './inventory/helpers.js';
import {reserveMaterialNeeds,releaseReservations} from './inventory/stock.service.js';
import {RESERVATION_STATUS,INVENTORY_CONFIG} from './inventory/constants.js';

export const LUCKY={program:'VQ_CHUONG_TRINH',spin:'VQ_LUOT_QUAY',result:'VQ_KET_QUA',reward:'VQ_PHAN_THUONG',quota:'VQ_HAN_MUC',audit:'VQ_NHAT_KY',notice:'VQ_THONG_BAO'};
export const REWARD_STATUS={waiting:'Chờ kích hoạt',available:'Có thể dùng',held:'Đang giữ chỗ',used:'Đã dùng',expired:'Hết hạn',revoked:'Đã thu hồi'};
const DAY=86400000;
async function withTransaction<T>(work:(s:ClientSession)=>Promise<T>):Promise<T>{
  for(let attempt=0;;attempt++)try{return await inventoryTransaction(work);}catch(e:any){if(e.code!==11000||attempt>=4)throw e;}
}
const canonical=(value:any)=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().trim();
const cancelled=(order:any)=>/huy|cancel/.test(canonical(order?.TRANG_THAI));
const completed=(order:any)=>canonical(order?.TRANG_THAI)==='hoan thanh';
const paidStates=['Thành công','Thanh toán thành công','Đã thanh toán','Đã cọc'];
const number=(value:any,label:string,min=0,max=1e9)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new InventoryError(400,`${label} không hợp lệ.`);return n;};
const date=(value:any,label:string)=>{const d=new Date(value);if(!value||!Number.isFinite(d.getTime()))throw new InventoryError(400,`${label} không hợp lệ.`);return d;};
const audit=async(session:ClientSession,actor:string,action:string,data:any)=> (await col(LUCKY.audit)).insertOne({_id:randomUUID(),at:new Date(),actor,action,...data},{session});
const notice=async(session:ClientSession,id:string,customerId:string,text:string)=> (await col(LUCKY.notice)).updateOne({_id:id as any},{$setOnInsert:{customerId,text,at:new Date(),read:false}},{upsert:true,session});
async function revokeGiftAttachment(session:ClientSession,r:any){
  if(r.prize.kind!=='gift'||!r.usedOrderId)return;
  const target=await (await col('DON_HANG')).findOne({DON_HANG_ID:r.usedOrderId},{session});
  const delivered=target&&(/giao.*thanh cong|hoan thanh/.test(canonical(target.TRANG_THAI)));
  if(delivered||target?.DA_XUAT_NVL){
    if(!r.needsGiftReview){await (await col(LUCKY.reward)).updateOne({_id:r._id},{$set:{needsGiftReview:true}},{session});await audit(session,'SYSTEM','Quà đã xuất/giao cần đối soát thủ công',{rewardId:r.id,orderId:r.usedOrderId,reason:'Đơn gốc hủy; không tự hoàn hiện vật.'});}
    return;
  }
  const holds=await (await col('GIU_TON')).find({VQ_PHAN_THUONG_ID:r.id,TRANG_THAI:{$in:['TAM_CHO_QR','CHINH_THUC']}},{session}).toArray();
  if(holds.length)await releaseReservations({reservationIds:holds.map(h=>h.MA_GIU_TON)},{id:'SYSTEM',role:'system'},'Thu hồi quyền nhận quà do hủy đơn gốc',session);
  await (await col('DON_HANG_CHI_TIET')).updateMany({DON_HANG_ID:r.usedOrderId,SAN_PHAM_ID:'SPGIFT_'+r.id},{$set:{VQ_QUA_DA_HUY:true}},{session});
  await (await col('NHU_CAU_NVL_DU_KIEN')).updateMany({DON_HANG_ID:r.usedOrderId,SAN_PHAM_ID:'SPGIFT_'+r.id,TRANG_THAI:{$in:['Chờ giữ','Đã giữ']}},{$set:{TRANG_THAI:'Đã hủy'}},{session});
  await (await col(LUCKY.reward)).updateOne({_id:r._id},{$set:{giftStatus:'Đã hủy'}},{session});
}

export const defaultLuckyProgram=()=>({name:'Vòng quay may mắn Tiệm Hoa Yên',status:'Nháp',startAt:new Date().toISOString(),endAt:new Date(Date.now()+30*DAY).toISOString(),threshold:200000,minimumOrder:150000,spinDays:7,rewardDays:30,reminderDays:3,terms:'Đơn từ 200.000đ trước voucher, không gồm phí giao hàng. Mỗi đơn đủ điều kiện nhận một lượt sau khi cọc/thanh toán thành công. Phần thưởng dùng cho đơn sau khi đơn gốc hoàn thành.',prizes:[
  {id:'P5',name:'Giảm 5%',kind:'percent',value:5,maxDiscount:20000,weight:30,active:true},
  {id:'P10',name:'Giảm 10%',kind:'percent',value:10,maxDiscount:40000,weight:20,active:true},
  {id:'C20',name:'Giảm 20.000đ',kind:'cash',value:20000,maxDiscount:20000,weight:20,active:true},
  {id:'SHIP',name:'Freeship tối đa 30.000đ',kind:'shipping',value:30000,maxDiscount:30000,weight:15,active:true},
  {id:'P15',name:'Giảm 15%',kind:'percent',value:15,maxDiscount:60000,weight:5,active:true,totalLimit:20},
  {id:'GIFT',name:'Quà tặng kèm',kind:'gift',value:0,maxDiscount:0,weight:5,active:true,totalLimit:30,giftMaterialId:'',giftQuantity:1,giftCost:0},
  {id:'NONE',name:'Chúc bạn may mắn lần sau',kind:'none',value:0,maxDiscount:0,weight:5,active:true}
]});

function validateProgram(body:any){
  const status=String(body.status||'Nháp');
  if(!['Nháp','Đã lên lịch','Đang diễn ra','Tạm dừng','Đã kết thúc'].includes(status))throw new InventoryError(400,'Trạng thái chương trình không hợp lệ.');
  const startAt=date(body.startAt,'Ngày bắt đầu'),endAt=date(body.endAt,'Ngày kết thúc');
  if(endAt<=startAt)throw new InventoryError(400,'Ngày kết thúc phải sau ngày bắt đầu.');
  const name=String(body.name||'').trim(),terms=String(body.terms||'').trim();
  if(!name||name.length>150||!terms||terms.length>10000)throw new InventoryError(400,'Nhập tên và thể lệ chương trình.');
  if(!Array.isArray(body.prizes)||body.prizes.length!==7)throw new InventoryError(400,'Chương trình cần đúng 7 ô giải thưởng.');
  const ids=new Set<string>();
  const prizes=body.prizes.map((raw:any)=>{
    const id=String(raw.id||''),kind=String(raw.kind||'');
    if(!/^[\w-]{1,40}$/.test(id)||ids.has(id)||!['percent','cash','shipping','gift','none'].includes(kind))throw new InventoryError(400,'Mã/loại giải bị trùng hoặc không hợp lệ.');
    ids.add(id);
    const p:any={id,kind,name:String(raw.name||'').trim().slice(0,150),active:raw.active===true,weight:number(raw.weight,'Tỷ lệ',0,100),value:number(raw.value||0,'Giá trị'),maxDiscount:number(raw.maxDiscount||0,'Giảm tối đa')};
    for(const field of ['totalLimit','dailyLimit','monthlyLimit'])p[field]=raw[field]==null||raw[field]===''?null:number(raw[field],'Hạn mức',0);
    if(!p.name || kind==='percent'&&(p.value<1||p.value>100||p.maxDiscount<1)||['cash','shipping'].includes(kind)&&p.value<1)throw new InventoryError(400,'Giá trị giải và mức giảm tối đa không hợp lệ.');
    if(kind==='none'&&(!p.active||p.weight<=0||p.totalLimit!=null||p.dailyLimit!=null||p.monthlyLimit!=null))throw new InventoryError(400,'Ô may mắn lần sau phải luôn bật, có tỷ lệ và không có hạn mức.');
    if(kind==='gift'){p.giftMaterialId=String(raw.giftMaterialId||'');p.giftQuantity=roundQty(raw.giftQuantity||1);p.giftCost=number(raw.giftCost||0,'Giá vốn quà');if(p.giftQuantity<=0)throw new InventoryError(400,'Số lượng quà không hợp lệ.');}
    return p;
  });
  if(prizes.filter((p:any)=>p.kind==='none').length!==1||prizes.filter((p:any)=>p.active).reduce((n:number,p:any)=>n+p.weight,0)!==100)throw new InventoryError(400,'Tổng tỷ lệ các ô bật phải bằng 100%, có đúng một ô may mắn lần sau.');
  return {name,terms,status,startAt,endAt,prizes,threshold:number(body.threshold,'Ngưỡng nhận lượt',1),minimumOrder:number(body.minimumOrder,'Đơn tối thiểu',1),spinDays:number(body.spinDays,'Hạn lượt',1,365),rewardDays:number(body.rewardDays,'Hạn thưởng',1,365),reminderDays:number(body.reminderDays??3,'Nhắc hạn',0,30)};
}

export async function saveLuckyProgram(body:any,actor:string){
  const config=validateProgram(body);
  return withTransaction(async session=>{
    await (await col(LUCKY.quota)).updateOne({_id:'PROGRAM_CONFIG_LOCK' as any},{$inc:{revision:1}},{upsert:true,session});
    const programs=await col(LUCKY.program),old=body.id?await programs.findOne({_id:String(body.id) as any},{session}):null;
    if(body.id&&!old)throw new InventoryError(404,'Không tìm thấy chương trình.');
    if(old&&number(body.version,'Phiên bản')!==old.version)throw new InventoryError(409,'Cấu hình vừa thay đổi. Tải lại trước khi lưu.');
    if(old?.status==='Đã kết thúc')throw new InventoryError(409,'Chương trình đã kết thúc chỉ xem lịch sử.');
    if(config.status!=='Nháp'){
      for(const p of config.prizes.filter((p:any)=>p.active&&p.kind==='gift')){
        if(!p.giftMaterialId || !await (await col('NGUYEN_VAT_LIEU')).findOne({NGUYEN_VAT_LIEU_ID:p.giftMaterialId,TRANG_THAI:{$ne:'Ngừng sử dụng'}},{session}))throw new InventoryError(400,'Chọn NVL quà tặng còn sử dụng trước khi bật/lên lịch.');
      }
      const other=await programs.findOne({_id:{$ne:old?._id},status:{$in:['Đã lên lịch','Đang diễn ra','Tạm dừng']},startAt:{$lt:config.endAt},endAt:{$gt:config.startAt}},{session});
      if(other)throw new InventoryError(409,'Thời gian trùng chương trình đang bật/lên lịch.');
    }
    // Published revisions affect future grants; existing spins keep their rule/prize snapshot.
    if(old&&old.status!=='Nháp'){
      const fields=['name','startAt','endAt'];
      if(fields.some(k=>JSON.stringify(config[k as keyof typeof config])!==JSON.stringify(old[k])))throw new InventoryError(409,'Tên và lịch chương trình đã công bố được giữ nguyên. Tạo chương trình mới nếu cần đổi tên/lịch.');
      for(const p of config.prizes){
        const prior=old.prizes.find((x:any)=>x.id===p.id);
        if(!prior)throw new InventoryError(409,'Giữ mã 7 ô giải đã công bố; đổi giá trị/tỷ lệ tạo phiên bản mới.');
        for(const k of ['totalLimit','dailyLimit','monthlyLimit'])if(p[k]!=null&&(prior[k]==null||p[k]<prior[k]))throw new InventoryError(409,'Không giảm hạn mức đã công bố; lượt cũ vẫn được bảo vệ.');
      }
    }
    const now=new Date(),pauses=[...(old?.pauses||[])];
    if(config.status==='Tạm dừng'&&old?.status!=='Tạm dừng')pauses.push({start:now,end:null});
    if(old?.status==='Tạm dừng'&&config.status!=='Tạm dừng'&&pauses.length)pauses[pauses.length-1]={...pauses.at(-1),end:now};
    const id=old?._id||randomUUID();
    const row={...config,_id:id,id,version:(old?.version||0)+1,pauses,createdAt:old?.createdAt||now,updatedAt:now,updatedBy:actor,endedAt:config.status==='Đã kết thúc'?now:old?.endedAt||null};
    await programs.replaceOne({_id:id},row,{upsert:true,session});
    await audit(session,actor,'Lưu cấu hình',{programId:id,version:row.version,snapshot:row});
    return row;
  });
}

function publicProgram(p:any){if(!p)return null;return {id:p.id,name:p.name,status:effectiveStatus(p),startAt:p.startAt,endAt:p.endAt,threshold:p.threshold,minimumOrder:p.minimumOrder,spinDays:p.spinDays,rewardDays:p.rewardDays,terms:p.terms,prizes:p.prizes.map((x:any)=>({id:x.id,name:x.name,kind:x.kind,value:x.value,maxDiscount:x.maxDiscount,weight:x.weight,active:x.active,totalLimit:x.totalLimit,dailyLimit:x.dailyLimit,monthlyLimit:x.monthlyLimit}))};}
function effectiveStatus(p:any,now=new Date()){
  if(p.status==='Nháp')return p.status;
  if(p.status==='Tạm dừng')return 'Tạm dừng';
  if(p.status==='Đã kết thúc'||now>=p.endAt)return 'Đã kết thúc';
  return now<p.startAt?'Đã lên lịch':'Đang diễn ra';
}
function activeAt(p:any,at:Date){return p.status!=='Nháp'&&at>=p.startAt&&at<p.endAt&&(!p.endedAt||at<p.endedAt)&&!(p.pauses||[]).some((x:any)=>at>=x.start&&(!x.end||at<x.end));}
function spinDeadline(spin:any,program:any,now=new Date()){
  let expiry=new Date(spin.baseExpiresAt).getTime();
  for(const pause of program.pauses||[]){const start=Math.max(new Date(pause.start).getTime(),new Date(spin.grantedAt).getTime());if(start<expiry){const end=Math.min(new Date(pause.end||now).getTime(),now.getTime());if(end>start)expiry+=end-start;}}
  return new Date(expiry);
}

/** Persist expiration without reviving tickets that expired before a pause. */
export async function expireLuckySpins(now=new Date()){
  for await(const spin of (await col(LUCKY.spin)).find({status:'Chưa quay'})){
    const program=await (await col(LUCKY.program)).findOne({_id:spin.programId});
    if(program&&spinDeadline(spin,program,now)<=now)await (await col(LUCKY.spin)).updateOne({_id:spin._id,status:'Chưa quay'},{$set:{status:'Hết hạn'}});
  }
}

/** Called after verified payment writes, and by a catch-up worker for Atlas-side transitions. */
export async function syncLuckyOrder(session:ClientSession,orderId:string,observedAt=new Date()){
  const order=await (await col('DON_HANG')).findOne({DON_HANG_ID:orderId},{session});
  if(!order)return;
  const spins=await col(LUCKY.spin),rewards=await col(LUCKY.reward);
  if(cancelled(order)){
    await spins.updateMany({orderId,status:'Chưa quay'},{$set:{status:'Không hợp lệ',reason:'Đơn gốc đã hủy'}},{session});
    const pending=await rewards.find({sourceOrderId:orderId,status:{$in:[REWARD_STATUS.waiting,REWARD_STATUS.available,REWARD_STATUS.held]}},{session}).toArray();
    for(const r of pending){await revokeGiftAttachment(session,r);await rewards.updateOne({_id:r._id},{$set:{status:REWARD_STATUS.revoked,revokedAt:observedAt,reason:'Đơn gốc đã hủy'}},{session});await audit(session,'SYSTEM','Thu hồi phần thưởng',{rewardId:r._id,orderId,reason:'Đơn gốc đã hủy'});await notice(session,'revoke:'+r._id,r.customerId,'Phần thưởng đã thu hồi vì đơn gốc bị hủy.');}
    for(const r of await rewards.find({sourceOrderId:orderId,status:REWARD_STATUS.used,sourceCancelledReview:{$ne:true}},{session}).toArray()){
      await revokeGiftAttachment(session,r);
      await rewards.updateOne({_id:r._id},{$set:{sourceCancelledReview:true,...(r.prize.kind==='gift'?{status:REWARD_STATUS.revoked}:{})}},{session});
      await audit(session,'SYSTEM','Đơn gốc hủy sau khi thưởng đã dùng',{rewardId:r.id,orderId,reason:'Cần đối soát quyền lợi đã sử dụng.'});
    }
    const used=await rewards.find({usedOrderId:orderId,status:{$in:[REWARD_STATUS.used,REWARD_STATUS.held]}},{session}).toArray();
    for(const r of used){
      const source=await (await col('DON_HANG')).findOne({DON_HANG_ID:r.sourceOrderId},{session});
      const state=cancelled(source)?REWARD_STATUS.revoked:r.expiresAt<=observedAt?REWARD_STATUS.expired:REWARD_STATUS.available;
      await rewards.updateOne({_id:r._id},{$set:{status:state,usedOrderId:null,restoredAt:observedAt,heldUntil:null}},{session});
      await audit(session,'SYSTEM','Đối soát hủy đơn dùng thưởng',{rewardId:r._id,orderId,status:state});
      await notice(session,'restore:'+r._id+':'+orderId,r.customerId,state===REWARD_STATUS.available?'Đơn dùng thưởng đã hủy; phần thưởng được khôi phục với hạn cũ.':'Đơn dùng thưởng đã hủy; phần thưởng không còn hiệu lực.');
    }
    return;
  }
  if(order.KHACH_HANG_ID&&!await spins.findOne({_id:orderId as any},{session})){
    const payments=await (await col('THANH_TOAN')).find({DON_HANG_ID:orderId,TRANG_THAI_THANH_TOAN:{$in:paidStates},SO_TIEN:{$gt:0}},{session}).sort({NGAY_THANH_TOAN:1}).toArray();
    const required=Number(order.TIEN_COC)>0?Number(order.TIEN_COC):Number(order.TONG_TIEN);
    let sum=0,at:Date|null=null;
    for(const p of payments){sum+=Number(p.SO_TIEN);if(sum>=required&&required>0){at=new Date(p.NGAY_THANH_TOAN);break;}}
    if(at&&Number.isFinite(at.getTime())){
      const programs=await (await col(LUCKY.program)).find({status:{$ne:'Nháp'},startAt:{$lte:at},endAt:{$gt:at}},{session}).toArray();
      const program=programs.find(p=>activeAt(p,at!));
      if(program){
        const published=await (await col(LUCKY.audit)).find({programId:program.id,action:'Lưu cấu hình',at:{$lte:at}},{session}).sort({at:-1}).limit(1).next();
        const rules=published?.snapshot||program;
        const details=await (await col('DON_HANG_CHI_TIET')).find({DON_HANG_ID:orderId},{session}).toArray();
        const value=Number(order.GIA_TRI_SAN_PHAM_DA_CHOT ?? details.reduce((n,l)=>n+Number(l.GIA||0)*Number(l.SO_LUONG||0),0));
        if(value>=rules.threshold){
          await spins.insertOne({_id:orderId as any,id:orderId,orderId,customerId:order.KHACH_HANG_ID,programId:program.id,programVersion:rules.version,grantedAt:at,baseExpiresAt:new Date(at.getTime()+rules.spinDays*DAY),status:'Chưa quay',qualifyingValue:value,rules:{minimumOrder:rules.minimumOrder,rewardDays:rules.rewardDays,reminderDays:rules.reminderDays,prizes:rules.prizes,terms:rules.terms}},{session});
          await notice(session,'spin:'+orderId,order.KHACH_HANG_ID,`Đơn ${orderId} được cấp một lượt quay may mắn.`);
        }
      }
    }
  }
  if(completed(order)){
    if(!order.VQ_HOAN_THANH_LUC){order.VQ_HOAN_THANH_LUC=new Date(order.NGAY_HOAN_THANH||order.HOAN_THANH_LUC||observedAt);await (await col('DON_HANG')).updateOne({DON_HANG_ID:orderId,VQ_HOAN_THANH_LUC:{$exists:false}},{$set:{VQ_HOAN_THANH_LUC:order.VQ_HOAN_THANH_LUC}},{session});}
    const waiting=await rewards.find({sourceOrderId:orderId,status:REWARD_STATUS.waiting},{session}).toArray();
    const at=order.NGAY_HOAN_THANH||order.HOAN_THANH_LUC||order.VQ_HOAN_THANH_LUC;
    for(const r of waiting){
      const activatedAt=new Date(at),expiresAt=new Date(activatedAt.getTime()+r.rewardDays*DAY);
      await rewards.updateOne({_id:r._id,status:REWARD_STATUS.waiting},{$set:{status:expiresAt<=observedAt?REWARD_STATUS.expired:REWARD_STATUS.available,activatedAt,expiresAt,...(r.prize.kind==='gift'?{giftStatus:'Chờ gắn đơn'}:{})}},{session});
      await audit(session,'SYSTEM','Kích hoạt thưởng',{rewardId:r._id,orderId,activatedAt,expiresAt});
      await notice(session,'active:'+r._id,r.customerId,'Phần thưởng đã kích hoạt vì đơn gốc hoàn thành.');
    }
  }
  const paid=await (await col('THANH_TOAN')).findOne({DON_HANG_ID:orderId,TRANG_THAI_THANH_TOAN:{$in:paidStates},SO_TIEN:{$gt:0}},{session});
  if(paid||Number(order.TONG_TIEN)===0&&order.TRANG_THAI==='Chờ xử lý')await rewards.updateMany({usedOrderId:orderId,status:REWARD_STATUS.held},{$set:{status:REWARD_STATUS.used,usedAt:observedAt,heldUntil:null}},{session});
  else{
    for(const r of await rewards.find({usedOrderId:orderId,status:REWARD_STATUS.held,$or:[{heldUntil:{$lte:observedAt}},...(order.TRANG_THAI==='Thanh toán thất bại'?[{}]:[])]},{session}).toArray()){
      await rewards.updateOne({_id:r._id,status:REWARD_STATUS.held},{$set:{status:r.expiresAt<=observedAt?REWARD_STATUS.expired:REWARD_STATUS.available,usedOrderId:null,heldUntil:null}},{session});
      await audit(session,'SYSTEM','Nhả thưởng khi thanh toán hết hạn/thất bại',{rewardId:r.id,orderId});
    }
  }
  if(/giao.*thanh cong|hoan thanh/.test(canonical(order.TRANG_THAI))){
    for(const r of await rewards.find({usedOrderId:orderId,'prize.kind':'gift',status:REWARD_STATUS.used,giftStatus:{$ne:'Đã giao'}},{session}).toArray()){
      const px=await (await col('PHIEU_XUAT_NVL')).findOne({DON_HANG_ID:orderId,TRANG_THAI:'Đã ghi nhận',DA_DAO:{$ne:true}},{session});
      const line=px&&await (await col('CHI_TIET_PHIEU_XUAT_NVL')).findOne({PHIEU_XUAT_ID:px.PHIEU_XUAT_ID,NGUYEN_VAT_LIEU_ID:r.prize.giftMaterialId},{session});
      await rewards.updateOne({_id:r._id},{$set:{giftStatus:'Đã giao',deliveredAt:observedAt,...(line?{actualGiftCost:Math.round(Number(line.DON_GIA_VON)*r.prize.giftQuantity),giftExportId:px!.PHIEU_XUAT_ID}:{needsGiftReview:true})}},{session});
      await audit(session,'SYSTEM','Giao quà cùng đơn',{rewardId:r.id,orderId});
    }
  }
}
export const synchronizeLuckyOrder=(id:string,at?:Date)=>withTransaction(s=>syncLuckyOrder(s,id,at));

function quotaKeys(programId:string,prize:any,now:Date){const day=vnDateKey(now);return [['total',prize.totalLimit],['day:'+day,prize.dailyLimit],['month:'+day.slice(0,7),prize.monthlyLimit]].filter(([,limit])=>limit!=null).map(([bucket,limit])=>({id:`${programId}:${prize.id}:${bucket}`,limit:Number(limit)}));}

export async function spinLucky(customerId:string,id:string){
  return withTransaction(async session=>{
    const spins=await col(LUCKY.spin),spin=await spins.findOne({_id:id as any,customerId},{session});
    if(!spin)throw new InventoryError(404,'Không tìm thấy lượt quay của bạn.');
    const saved=await (await col(LUCKY.result)).findOne({_id:id as any},{session});
    if(saved)return {...saved,reward:saved.rewardId?await (await col(LUCKY.reward)).findOne({_id:saved.rewardId},{session}):null};
    await syncLuckyOrder(session,spin.orderId);
    const current=await spins.findOne({_id:id as any},{session});
    const program=await (await col(LUCKY.program)).findOne({_id:spin.programId as any},{session}),now=new Date();
    if(!program||current?.status!=='Chưa quay')throw new InventoryError(409,'Lượt quay không còn hợp lệ.');
    if(['Nháp','Đã lên lịch','Tạm dừng'].includes(effectiveStatus(program)))throw new InventoryError(409,'Chương trình chưa mở hoặc đang tạm dừng; hạn lượt được bảo lưu khi tạm dừng.');
    if(spinDeadline(spin,program,now)<=now)throw new InventoryError(410,'Lượt quay đã hết hạn.');
    const quotas=await col(LUCKY.quota),available:any[]=[];
    for(const prize of (spin.rules.prizes||program.prizes).filter((p:any)=>p.active&&p.weight>0)){
      const keys=quotaKeys(program.id,prize,now);let eligible=true;
      for(const key of keys){const q=await quotas.findOne({_id:key.id as any},{session});if(Number(q?.count||0)>=key.limit)eligible=false;}
      if(eligible)available.push(prize);
    }
    const weight=available.reduce((n,p)=>n+p.weight,0);let ticket=randomInt(weight),prize=available.at(-1);
    for(const p of available){ticket-=p.weight;if(ticket<0){prize=p;break;}}
    for(const key of quotaKeys(program.id,prize,now))await quotas.updateOne({_id:key.id as any},{$inc:{count:1},$setOnInsert:{programId:program.id,prizeId:prize.id}},{upsert:true,session});
    const result={_id:id as any,id,spinId:id,orderId:spin.orderId,customerId,programId:program.id,programVersion:spin.programVersion,prize,at:now,rewardDays:spin.rules.rewardDays,minimumOrder:spin.rules.minimumOrder,weights:available.map(p=>({id:p.id,weight:p.weight,total:weight})),rewardId:prize.kind==='none'?null:'VQ-'+randomUUID()};
    await (await col(LUCKY.result)).insertOne(result,{session});
    await spins.updateOne({_id:id as any,status:'Chưa quay'},{$set:{status:'Đã quay',spunAt:now,resultId:id}},{session});
    if(result.rewardId){
      await (await col(LUCKY.reward)).insertOne({_id:result.rewardId as any,id:result.rewardId,code:'YEN-'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),customerId,spinId:id,sourceOrderId:spin.orderId,programId:program.id,prize,minimumOrder:spin.rules.minimumOrder,rewardDays:spin.rules.rewardDays,reminderDays:spin.rules.reminderDays,status:REWARD_STATUS.waiting,issuedAt:now,activatedAt:null,expiresAt:null,...(prize.kind==='gift'?{giftStatus:'Chờ kích hoạt'}:{})},{session});
      await syncLuckyOrder(session,spin.orderId,now);
    }
    await audit(session,customerId,'Quay thưởng',{spinId:id,result});
    return {...result,reward:result.rewardId?await (await col(LUCKY.reward)).findOne({_id:result.rewardId as any},{session}):null};
  });
}

export async function getLuckyWallet(customerId:string,query:any={}){
  const spins=await (await col(LUCKY.spin)).find({customerId}).sort({grantedAt:-1}).limit(200).toArray();
  const rewards=await (await col(LUCKY.reward)).find({customerId}).sort({issuedAt:-1}).limit(200).toArray();
  for(const id of new Set([...spins.map(s=>s.orderId),...rewards.map(r=>r.sourceOrderId),...rewards.map(r=>r.usedOrderId).filter(Boolean)]))await synchronizeLuckyOrder(id);
  const programs=await (await col(LUCKY.program)).find({status:{$ne:'Nháp'}}).sort({startAt:-1}).toArray();
  const current=programs.find(p=>effectiveStatus(p)==='Đang diễn ra')||programs.find(p=>p.status==='Tạm dừng')||programs[0];
  const latestSpins=await (await col(LUCKY.spin)).find({customerId}).sort({grantedAt:-1}).limit(200).toArray();
  const now=new Date();
  const mapped=latestSpins.map(s=>{const p=programs.find(p=>p.id===s.programId);const expiresAt=p?spinDeadline(s,p):s.baseExpiresAt;return {...s,expiresAt,status:s.status==='Chưa quay'&&expiresAt<=now?'Hết hạn':s.status,paused:p&&effectiveStatus(p)==='Tạm dừng',program:p?publicProgram({...p,prizes:s.rules.prizes||p.prizes,terms:s.rules.terms||p.terms,rewardDays:s.rules.rewardDays,minimumOrder:s.rules.minimumOrder}):null};});
  const rewardPage=Math.max(1,Number(query.rewardPage)||1),historyPage=Math.max(1,Number(query.historyPage)||1);
  const rewardFilter:any={customerId,...(query.availableOnly==='true'?{status:REWARD_STATUS.available}:{})};
  const rewardSize=query.availableOnly==='true'?200:6;
  const latestRewards=await (await col(LUCKY.reward)).find(rewardFilter).sort({issuedAt:-1}).skip((rewardPage-1)*rewardSize).limit(rewardSize).toArray();
  for(const r of latestRewards){
    if(r.status===REWARD_STATUS.available&&r.expiresAt<=now){await (await col(LUCKY.reward)).updateOne({_id:r._id,status:r.status},{$set:{status:REWARD_STATUS.expired}});r.status=REWARD_STATUS.expired;}
  }
  return {waitingRewards:await (await col(LUCKY.reward)).countDocuments({customerId,status:REWARD_STATUS.waiting}),program:publicProgram(current),spins:mapped,rewards:latestRewards,rewardTotal:await (await col(LUCKY.reward)).countDocuments(rewardFilter),historyTotal:await (await col(LUCKY.result)).countDocuments({customerId}),history:await (await col(LUCKY.result)).find({customerId}).sort({at:-1}).skip((historyPage-1)*10).limit(10).toArray(),notifications:await (await col(LUCKY.notice)).find({customerId}).sort({at:-1}).limit(30).toArray()};
}
export async function publicLuckyProgram(){const rows=await (await col(LUCKY.program)).find({status:{$ne:'Nháp'}}).sort({startAt:-1}).toArray();return publicProgram(rows.find(p=>effectiveStatus(p)==='Đang diễn ra')||rows.find(p=>p.status==='Tạm dừng')||rows[0]);}

export function luckyDiscount(prize:any,subtotal:number,shipping:number){
  if(prize.kind==='percent')return Math.min(subtotal,prize.maxDiscount,Math.floor(subtotal*prize.value/100));
  if(prize.kind==='cash')return Math.min(subtotal,prize.value);
  if(prize.kind==='shipping')return Math.min(shipping,prize.value,prize.maxDiscount);
  return 0;
}
export async function quoteLuckyReward(session:ClientSession|undefined,customerId:string,rewardId:string,subtotal:number,shipping:number,orderCreatedAt=new Date()){
  number(subtotal,'Tạm tính');number(shipping,'Phí giao hàng');
  const reward=await (await col(LUCKY.reward)).findOne({_id:rewardId as any,customerId},{session});
  if(!reward)throw new InventoryError(404,'Không tìm thấy phần thưởng của bạn.');
  const source=await (await col('DON_HANG')).findOne({DON_HANG_ID:reward.sourceOrderId},{session});
  if(reward.status===REWARD_STATUS.waiting||!completed(source)&&reward.status===REWARD_STATUS.available)throw new InventoryError(409,'Thưởng chưa kích hoạt. Đơn gốc '+reward.sourceOrderId+' phải Hoàn thành mới dùng được.');
  if(reward.status===REWARD_STATUS.expired)throw new InventoryError(410,'Phần thưởng đã hết hạn.');
  if(reward.status===REWARD_STATUS.used)throw new InventoryError(409,'Phần thưởng đã dùng cho đơn khác.');
  if(reward.status===REWARD_STATUS.held)throw new InventoryError(409,'Phần thưởng đang giữ cho một đơn chờ thanh toán.');
  if(!completed(source)||reward.status!==REWARD_STATUS.available)throw new InventoryError(409,'Phần thưởng đã thu hồi hoặc đơn gốc không còn hợp lệ.');
  if(!reward.expiresAt||reward.expiresAt<=new Date())throw new InventoryError(410,'Phần thưởng đã hết hạn.');
  if(orderCreatedAt<=reward.activatedAt)throw new InventoryError(409,'Chỉ áp dụng cho đơn tạo sau khi đơn gốc hoàn thành.');
  if(subtotal<reward.minimumOrder)throw new InventoryError(400,`Đơn tối thiểu ${reward.minimumOrder.toLocaleString('vi-VN')}đ, không gồm phí giao hàng.`);
  return {reward,discount:luckyDiscount(reward.prize,subtotal,shipping)};
}

/** Atomic reservation: the same reward cannot fund two simultaneous checkouts. */
export async function holdLuckyReward(session:ClientSession,customerId:string,id:string,orderId:string,payload:any){
  if(payload.voucher?.id||payload.voucher?.code)throw new InventoryError(400,'Không dùng thưởng vòng quay cùng voucher khác.');
  const subtotal=number(payload.summary.subtotal,'Tạm tính'),shipping=number(payload.summary.shippingFee||0,'Phí giao hàng');
  const q=await quoteLuckyReward(session,customerId,id,subtotal,shipping);
  const expected=Math.max(0,subtotal+shipping-q.discount-Number(payload.summary.loyaltyDiscount||0));
  if(Number(payload.summary.total)!==expected)throw new InventoryError(400,'Tổng tiền chưa khớp phần thưởng. Hãy tính lại trước khi đặt.');
  await (await col(LUCKY.reward)).updateOne({_id:id as any,status:REWARD_STATUS.available},{$set:{status:REWARD_STATUS.held,usedOrderId:orderId,heldAt:new Date(),heldUntil:new Date(Date.now()+INVENTORY_CONFIG.holdMinutes*60000),discount:q.discount}},{session});
  if(q.reward.prize.kind==='gift'){
    const p=q.reward.prize;
    if(!payload.inventoryMode){
      const holds=await reserveMaterialNeeds(session,new Map([[p.giftMaterialId,p.giftQuantity]]),{status:RESERVATION_STATUS.temporary,orderId,paymentSessionId:payload.checkoutSessionId,actor:{id:customerId,role:'customer'}});
      await (await col('GIU_TON')).updateMany({_id:{$in:holds.map(h=>h._id)}},{$set:{VQ_PHAN_THUONG_ID:id}},{session});
    }
    await (await col(LUCKY.reward)).updateOne({_id:id as any},{$set:{giftStatus:'Đã gắn đơn'}},{session});
    payload.items.push({id:'SPGIFT_'+id,qty:1,price:0,custom:true,name:p.name,image:'',bom:{materials:[{materialId:p.giftMaterialId,quantity:p.giftQuantity}],designFee:0,extraFee:0}});
  }
  await audit(session,customerId,'Giữ phần thưởng cho đơn',{rewardId:id,orderId,discount:q.discount});
  return q;
}

export async function renewLuckyHold(session:ClientSession,orderId:string){
  const order=await (await col('DON_HANG')).findOne({DON_HANG_ID:orderId},{session});
  if(!order?.VQ_PHAN_THUONG_ID)return;
  const rewards=await col(LUCKY.reward),r=await rewards.findOne({_id:order.VQ_PHAN_THUONG_ID},{session});
  const source=r&&await (await col('DON_HANG')).findOne({DON_HANG_ID:r.sourceOrderId},{session});
  if(!r||!completed(source)||r.expiresAt<=new Date()||![REWARD_STATUS.available,REWARD_STATUS.held].includes(r.status)||r.status===REWARD_STATUS.held&&r.usedOrderId!==orderId)throw new InventoryError(409,'Thưởng của đơn không còn dùng được. Cần đặt lại với ưu đãi hợp lệ.');
  await rewards.updateOne({_id:r._id},{$set:{status:REWARD_STATUS.held,usedOrderId:orderId,heldUntil:new Date(Date.now()+INVENTORY_CONFIG.holdMinutes*60000)}},{session});
}

export async function luckyAdminOverview(query:any={}){
  const filter:any={};
  if(query.customerId)filter.customerId=String(query.customerId);
  if(query.orderId)filter.orderId=String(query.orderId);
  if(query.prizeId)filter['prize.id']=String(query.prizeId);
  if(query.from||query.to){filter.at={};if(query.from)filter.at.$gte=date(query.from,'Từ ngày');if(query.to)filter.at.$lte=date(query.to,'Đến ngày');}
  const page=Math.max(1,Number(query.page)||1),size=20;
  const rewardPage=Math.max(1,Number(query.rewardPage)||1),logPage=Math.max(1,Number(query.logPage)||1);
  const [programs,results,total,rewards,logs,quotas]=await Promise.all([
    (await col(LUCKY.program)).find({}).sort({createdAt:-1}).toArray(),(await col(LUCKY.result)).find(filter).sort({at:-1}).skip((page-1)*size).limit(size).toArray(),(await col(LUCKY.result)).countDocuments(filter),
    (await col(LUCKY.reward)).find({}).sort({issuedAt:-1}).skip((rewardPage-1)*20).limit(20).toArray(),(await col(LUCKY.audit)).find({}).sort({at:-1}).skip((logPage-1)*20).limit(20).toArray(),(await col(LUCKY.quota)).find({}).toArray()]);
  const stats=await (await col(LUCKY.reward)).aggregate([
    {$group:{_id:'$status',count:{$sum:1},discount:{$sum:{$ifNull:['$discount',0]}},giftCost:{$sum:{$ifNull:['$actualGiftCost',0]}}}}
  ]).toArray();
  const materialOptions=await (await col('NGUYEN_VAT_LIEU')).find({TRANG_THAI:{$ne:'Ngừng sử dụng'}}).project({_id:0,NGUYEN_VAT_LIEU_ID:1,TEN_NGUYEN_VAT_LIEU:1,DON_VI_TINH:1}).sort({TEN_NGUYEN_VAT_LIEU:1}).toArray();
  const report=await luckyReport(programs,stats);
  return {defaults:defaultLuckyProgram(),programs:programs.map(p=>({...p,effectiveStatus:effectiveStatus(p)})),results,total,page,size,rewards,logs,quotas,stats,materialOptions,report,rewardTotal:await (await col(LUCKY.reward)).countDocuments(),logTotal:await (await col(LUCKY.audit)).countDocuments(),spins:await (await col(LUCKY.spin)).countDocuments(),spun:await (await col(LUCKY.result)).countDocuments()};
}

async function luckyReport(programs:any[],stats:any[]){
  const published=programs.filter(p=>p.status!=='Nháp'),now=new Date();
  if(!published.length)return null;
  const from=new Date(Math.min(...published.map(p=>p.startAt.getTime())));
  const payments=await (await col('THANH_TOAN')).find({NGAY_THANH_TOAN:{$gte:from,$lte:now},TRANG_THAI_THANH_TOAN:{$in:paidStates},SO_TIEN:{$gt:0}}).toArray();
  const ids=[...new Set(payments.map(p=>p.DON_HANG_ID))];
  const orders=(await (await col('DON_HANG')).find({DON_HANG_ID:{$in:ids},KHACH_HANG_ID:{$nin:[null,'']}}).toArray()).filter(o=>!cancelled(o));
  const totalValue=orders.reduce((n,o)=>n+Number(o.TONG_TIEN||0),0);
  const allRewards=await (await col(LUCKY.reward)).find({}).toArray();
  const activated=allRewards.filter(r=>r.activatedAt&&r.prize.kind!=='gift'&&r.status!==REWARD_STATUS.revoked);
  const voucherUsed=activated.filter(r=>r.status===REWARD_STATUS.used).length;
  const customerStarts=new Map<string,Date>();
  for(const r of allRewards.filter(r=>r.activatedAt))if(!customerStarts.has(r.customerId)||r.activatedAt<customerStarts.get(r.customerId)!)customerStarts.set(r.customerId,r.activatedAt);
  let repeatCustomers=0;
  for(const [id,at]of customerStarts)if(orders.some(o=>o.KHACH_HANG_ID===id&&new Date(o.NGAY_TAO)>at&&new Date(o.NGAY_TAO).getTime()<=at.getTime()+30*DAY))repeatCustomers++;
  const cost=stats.filter(s=>s._id===REWARD_STATUS.used).reduce((n,s)=>n+Number(s.discount||0),0)+allRewards.reduce((n,r)=>n+Number(r.actualGiftCost||0),0);
  const spins=await (await col(LUCKY.spin)).countDocuments(),spun=await (await col(LUCKY.result)).countDocuments();
  const attempts=await (await col('VQ_YEU_CAU_QUAY')).countDocuments(),failures=await (await col('VQ_YEU_CAU_QUAY')).countDocuments({technicalFailure:true});
  return {from,to:now,eligiblePaidOrders:orders.length,grantedRate:orders.length?spins/orders.length:0,spinRate:spins?spun/spins:0,voucherUseRate:activated.length?voucherUsed/activated.length:0,repeatRate:customerStarts.size?repeatCustomers/customerStarts.size:0,averageOrderValue:orders.length?Math.round(totalValue/orders.length):0,promotionCost:cost,costRate:totalValue?cost/totalValue:0,transactionErrorRate:attempts?failures/attempts:0,attempts,failures};
}
export async function revokeLuckyReward(id:string,reason:string,actor:string){
  if(String(reason||'').trim().length<5)throw new InventoryError(400,'Nhập lý do tối thiểu 5 ký tự.');
  return withTransaction(async session=>{
    const r=await (await col(LUCKY.reward)).findOne({_id:id as any},{session});
    if(!r)throw new InventoryError(404,'Không tìm thấy phần thưởng.');
    if([REWARD_STATUS.used,REWARD_STATUS.held].includes(r.status))throw new InventoryError(409,'Thưởng đang gắn/đã dùng cần đối soát đơn trước khi thu hồi.');
    await (await col(LUCKY.reward)).updateOne({_id:id as any},{$set:{status:REWARD_STATUS.revoked,revokedAt:new Date(),reason}},{session});
    await audit(session,actor,'Thu hồi thủ công',{rewardId:id,orderId:r.sourceOrderId,reason});
    await notice(session,'manual-revoke:'+id,r.customerId,'Phần thưởng bị thu hồi: '+reason);
    return {message:'Đã thu hồi và lưu lịch sử.'};
  });
}
