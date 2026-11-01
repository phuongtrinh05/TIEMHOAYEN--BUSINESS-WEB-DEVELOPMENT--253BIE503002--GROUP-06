import {Router} from 'express';
import * as lucky from '../services/lucky-wheel.service.js';
import {lookupAccess} from '../services/order-access.service.js';
import {col,InventoryError} from '../services/inventory/helpers.js';
import {hasPermission} from '../services/role-permission.service.js';
import {createHash,randomUUID} from 'node:crypto';
const router=Router();
const handle=(fn:any)=>async(req:any,res:any)=>{try{res.json(await fn(req));}catch(e:any){if(!(e instanceof InventoryError))console.error('[lucky]',e);res.status(e instanceof InventoryError?e.status:500).json({message:e instanceof InventoryError?e.message:'Không xử lý được vòng quay. Bạn thử lại nhé.'});}};
const member=async(req:any,res:any,next:any)=>{try{const a=await lookupAccess(req.headers['x-order-access']);if(a.authType!=='member'||!a.customerId)throw new InventoryError(401,'Đăng nhập tài khoản để tham gia vòng quay.');req.luckyCustomerId=a.customerId;next();}catch(e:any){res.status(e.status||401).json({message:e.message});}};
const staff=(action:any)=>async(req:any,res:any,next:any)=>{try{
  const token=String(req.headers['x-admin-session']||'');
  if(!/^as_[a-f0-9]{64}$/.test(token))throw new InventoryError(401,'Đăng nhập lại Admin để quản lý vòng quay.');
  const access=await (await col('PHIEN_DANG_NHAP_ADMIN')).findOne({_id:createHash('sha256').update(token).digest('hex') as any,expiresAt:{$gt:new Date()}});
  if(!access)throw new InventoryError(401,'Phiên Admin đã hết hạn. Đăng nhập lại để tiếp tục.');
  const id=access.employeeId,e=await (await col('NHAN_VIEN')).findOne({NHAN_VIEN_ID:id});
  if(!e||/khóa|ngừng/i.test(String(e.TRANG_THAI||''))||!hasPermission(e.VAI_TRO,'promotions',action))throw new InventoryError(403,'Bạn không có quyền quản lý vòng quay.');req.luckyActor=id;next();
}catch(e:any){res.status(e.status||403).json({message:e.message});}};
router.get('/program',handle(()=>lucky.publicLuckyProgram()));
router.get('/wallet',member,handle((r:any)=>lucky.getLuckyWallet(r.luckyCustomerId,r.query)));
router.post('/spins/:id',member,handle(async(r:any)=>{
  const log={_id:randomUUID(),customerId:r.luckyCustomerId,spinId:String(r.params.id),at:new Date(),technicalFailure:false,status:200};
  try{return await lucky.spinLucky(r.luckyCustomerId,String(r.params.id));}catch(e:any){log.status=e.status||500;log.technicalFailure=log.status>=500;throw e;}
  finally{await (await col('VQ_YEU_CAU_QUAY')).insertOne(log).catch(e=>console.warn('[lucky] attempt log:',e.message));}
}));
router.post('/preview',member,handle(async(r:any)=>{
  await lucky.getLuckyWallet(r.luckyCustomerId);
  let id=String(r.body.rewardId||'');
  if(r.body.rewardCode){const code=String(r.body.rewardCode).trim().toUpperCase();const reward=await (await col(lucky.LUCKY.reward)).findOne({customerId:r.luckyCustomerId,code});if(!reward)throw new InventoryError(404,'Không tìm thấy mã thưởng vòng quay trong tài khoản của bạn.');await lucky.synchronizeLuckyOrder(reward.sourceOrderId);id=reward.id;}
  const q=await lucky.quoteLuckyReward(undefined,r.luckyCustomerId,id,Number(r.body.subtotal),Number(r.body.shippingFee||0));
  return {rewardId:q.reward.id,code:q.reward.code,discount:q.discount,prize:q.reward.prize};
}));
router.get('/admin',staff('view'),handle((r:any)=>lucky.luckyAdminOverview(r.query)));
router.post('/admin/programs',staff('create'),handle((r:any)=>lucky.saveLuckyProgram(r.body,r.luckyActor)));
router.put('/admin/programs/:id',staff('update'),handle((r:any)=>lucky.saveLuckyProgram({...r.body,id:String(r.params.id)},r.luckyActor)));
router.post('/admin/rewards/:id/revoke',staff('update'),handle((r:any)=>lucky.revokeLuckyReward(String(r.params.id),r.body.reason,r.luckyActor)));
export default router;
