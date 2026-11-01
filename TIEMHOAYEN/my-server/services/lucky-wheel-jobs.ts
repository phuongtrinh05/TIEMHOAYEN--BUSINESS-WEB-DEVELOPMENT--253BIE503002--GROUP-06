import {getDb} from '../mongo.js';
import {col,withTransaction} from './inventory/helpers.js';
import {LUCKY,REWARD_STATUS,synchronizeLuckyOrder,expireLuckySpins} from './lucky-wheel.service.js';

let running=false,started=false;
/** Catch-up also observes updates made directly by the group's Atlas completion trigger. */
export async function catchUpLucky(){
  if(running)return;
  running=true;
  try{
    const programs=await (await col(LUCKY.program)).find({status:{$ne:'Nháp'}}).toArray();
    if(!programs.length)return;
    const earliest=new Date(Math.min(...programs.map(p=>new Date(p.startAt).getTime())));
    const ids=new Set<string>();
    for await(const p of (await col('THANH_TOAN')).find({NGAY_THANH_TOAN:{$gte:earliest},TRANG_THAI_THANH_TOAN:{$in:['Thành công','Thanh toán thành công','Đã thanh toán','Đã cọc']}}).project({DON_HANG_ID:1}))if(p.DON_HANG_ID)ids.add(p.DON_HANG_ID);
    for await(const r of (await col(LUCKY.reward)).find({status:{$in:[REWARD_STATUS.waiting,REWARD_STATUS.held,REWARD_STATUS.used]}}).project({sourceOrderId:1,usedOrderId:1})){ids.add(r.sourceOrderId);if(r.usedOrderId)ids.add(r.usedOrderId);}
    for(const id of ids)await synchronizeLuckyOrder(id);
    const now=new Date();
    await expireLuckySpins(now);
    await (await col(LUCKY.reward)).updateMany({status:REWARD_STATUS.available,expiresAt:{$lte:now}},{$set:{status:REWARD_STATUS.expired}});
    // Reminders use immutable issuance rules and a unique key, so repeated jobs do not spam.
    for await(const r of (await col(LUCKY.reward)).find({status:REWARD_STATUS.available,expiresAt:{$gt:now}})){
      if(r.expiresAt.getTime()-now.getTime()<=r.reminderDays*86400000)await (await col(LUCKY.notice)).updateOne({_id:('expiry:'+r.id) as any},{$setOnInsert:{customerId:r.customerId,text:`Phần thưởng ${r.code} sắp hết hạn.`,at:now,read:false}},{upsert:true});
    }
  }finally{running=false;}
}
export function startLuckyJobs(){
  if(started)return;started=true;
  const run=()=>catchUpLucky().catch(e=>console.error('[lucky] catch-up',e.message));
  void run();const timer=setInterval(run,30000);timer.unref();
  // Live database events preserve the actual completion event time when Atlas changes an order.
  void getDb().then(db=>{
    void Promise.all([
      db.collection(LUCKY.spin).createIndex({customerId:1,grantedAt:-1}),db.collection(LUCKY.result).createIndex({customerId:1,at:-1}),
      db.collection(LUCKY.reward).createIndex({customerId:1,issuedAt:-1}),db.collection(LUCKY.reward).createIndex({sourceOrderId:1,status:1}),
      db.collection(LUCKY.audit).createIndex({programId:1,at:-1}),db.collection('PHIEN_DANG_NHAP_ADMIN').createIndex({expiresAt:1},{expireAfterSeconds:0})
    ]).catch(e=>console.warn('[lucky] indexes:',e.message));
    for(const name of ['DON_HANG','THANH_TOAN']){
      void (async()=>{
        const saved=await db.collection('VQ_DONG_BO_META').findOne({_id:name as any});
        const stream=db.collection(name).watch([{$match:{operationType:{$in:['insert','update','replace']}}}],{fullDocument:'updateLookup',...(saved?.token?{resumeAfter:saved.token}:{})});
        let queue=Promise.resolve();
        stream.on('change',(event:any)=>{queue=queue.then(async()=>{
          const id=event.fullDocument?.DON_HANG_ID;if(id)await synchronizeLuckyOrder(id,event.wallTime||new Date());
          await db.collection('VQ_DONG_BO_META').updateOne({_id:name as any},{$set:{token:event._id,at:new Date()}},{upsert:true});
        }).catch(e=>{console.error('[lucky] event',e.message);void stream.close();});});
        stream.on('error',e=>{console.warn('[lucky] change stream unavailable; 30-second catch-up remains active:',e.message);void stream.close();});
      })().catch(e=>console.warn('[lucky] start stream:',e.message));
    }
  }).catch(e=>console.warn('[lucky] cannot start change streams:',e.message));
}
