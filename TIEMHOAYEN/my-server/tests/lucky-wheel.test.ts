import {after,before,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import crypto,{randomUUID,createHash,randomBytes} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
const uri=process.env.TEST_MONGO_URI;
if(!uri)test('Lucky wheel requires isolated replica set TEST_MONGO_URI',{skip:true},()=>{});
else{
  process.env.MONGO_URI=uri;process.env.MONGO_DATABASE='YEN_LUCKY_TEST_'+randomUUID().replaceAll('-','');
  let mongo:typeof import('../mongo.js'),lucky:typeof import('../services/lucky-wheel.service.js');
  let program:any,firstReward:any;
  const c=async(name:string)=>mongo.getCollection<any>(name);
  const actor='NV_ADMIN';
  async function saveNew(overrides:any={}){
    if(program&&program.status!=='Đã kết thúc')program=await lucky.saveLuckyProgram({...program,status:'Đã kết thúc'},actor);
    const p=lucky.defaultLuckyProgram();p.prizes.find(x=>x.kind==='gift')!.giftMaterialId='GIFT';
    program=await lucky.saveLuckyProgram({...p,startAt:new Date(Date.now()-1000),endAt:new Date(Date.now()+86400000),status:'Đang diễn ra',...overrides},actor);return program;
  }
  async function order(id:string,opts:any={}){
    const value=opts.value??250000,customer=opts.customer===undefined?'KH1':opts.customer;
    await (await c('DON_HANG')).insertOne({_id:id,DON_HANG_ID:id,KHACH_HANG_ID:customer,TRANG_THAI:opts.status||'Chờ xử lý',NGAY_TAO:new Date(),TAM_TINH:value,GIA_TRI_SAN_PHAM_DA_CHOT:value,PHI_VAN_CHUYEN:30000,TONG_TIEN:opts.total??value,TIEN_COC:opts.deposit||0});
    await (await c('DON_HANG_CHI_TIET')).insertOne({_id:id,DON_HANG_ID:id,SAN_PHAM_ID:'SP1',SO_LUONG:1,GIA:value});
    if(opts.paid!==false)await (await c('THANH_TOAN')).insertOne({_id:'TT'+id,DON_HANG_ID:id,SO_TIEN:opts.amount??opts.total??value,TRANG_THAI_THANH_TOAN:'Thành công',NGAY_THANH_TOAN:new Date()});
    await lucky.synchronizeLuckyOrder(id);
  }
  async function complete(id:string){await (await c('DON_HANG')).updateOne({DON_HANG_ID:id},{$set:{TRANG_THAI:'Hoàn thành',NGAY_HOAN_THANH:new Date()}});await lucky.synchronizeLuckyOrder(id);}
  before(async()=>{
    mock.method(crypto,'randomInt',()=>0);syncBuiltinESMExports();
    mongo=await import('../mongo.js');lucky=await import('../services/lucky-wheel.service.js');
    await (await c('KHACH_HANG')).insertMany([{_id:'KH1',KHACH_HANG_ID:'KH1'},{_id:'KH2',KHACH_HANG_ID:'KH2'}]);
    await (await c('NGUYEN_VAT_LIEU')).insertOne({_id:'GIFT',NGUYEN_VAT_LIEU_ID:'GIFT',TEN_NGUYEN_VAT_LIEU:'Thiệp',NHOM_NVL:'IT_HU',TON_THUC:20,TON_DANG_GIU:0,TON_KHONG_DAT:0,DON_VI_TINH:'cái',GIA_BAN:10000});
    await saveNew();
  });
  after(async()=>{mock.restoreAll();syncBuiltinESMExports();if(mongo){await (await mongo.getDb()).dropDatabase();await (await mongo.getMongoClient()).close();}});
  test('only members with verified paid/deposit orders and pre-voucher product value qualify',async()=>{
    await order('UNPAID',{paid:false});await order('GUEST',{customer:null});await order('LOW',{value:199999});
    for(const id of ['UNPAID','GUEST','LOW'])assert.equal(await (await c(lucky.LUCKY.spin)).countDocuments({_id:id}),0);
    await order('AFTER-VOUCHER',{value:220000,total:100000});
    assert.equal((await (await c(lucky.LUCKY.spin)).findOne({_id:'AFTER-VOUCHER'})).qualifyingValue,220000);
    await order('DEPOSIT',{deposit:50000,amount:25000});assert.equal(await (await c(lucky.LUCKY.spin)).countDocuments({_id:'DEPOSIT'}),0);
    await (await c('THANH_TOAN')).insertOne({_id:'TT2DEP',DON_HANG_ID:'DEPOSIT',SO_TIEN:25000,TRANG_THAI_THANH_TOAN:'Thành công',NGAY_THANH_TOAN:new Date()});
    await Promise.all([lucky.synchronizeLuckyOrder('DEPOSIT'),lucky.synchronizeLuckyOrder('DEPOSIT')]);
    assert.equal(await (await c(lucky.LUCKY.spin)).countDocuments({_id:'DEPOSIT'}),1);
  });
  test('concurrent/retried requests yield one immutable result and one waiting reward',async()=>{
    await order('DOUBLE');const results=await Promise.all([lucky.spinLucky('KH1','DOUBLE'),lucky.spinLucky('KH1','DOUBLE')]);
    assert.equal(results[0].id,results[1].id);assert.equal(results[0].prize.id,'P5');
    assert.equal(await (await c(lucky.LUCKY.result)).countDocuments({_id:'DOUBLE'}),1);
    firstReward=await (await c(lucky.LUCKY.reward)).findOne({spinId:'DOUBLE'});assert.equal(firstReward.status,'Chờ kích hoạt');assert.equal(firstReward.expiresAt,null);
    await assert.rejects(lucky.spinLucky('KH2','DOUBLE'),/của bạn/);
    await assert.rejects(lucky.quoteLuckyReward(undefined,'KH1',firstReward.id,200000,30000),/chưa kích hoạt/);
  });
  test('Atlas-style completion activates once for 30 days; cancel before spin invalidates it',async()=>{
    await complete('DOUBLE');const r=await (await c(lucky.LUCKY.reward)).findOne({_id:firstReward.id});
    assert.equal(r.status,'Có thể dùng');assert.equal(r.expiresAt.getTime()-r.activatedAt.getTime(),30*86400000);
    await lucky.synchronizeLuckyOrder('DOUBLE');assert.equal((await (await c(lucky.LUCKY.reward)).findOne({_id:r.id})).expiresAt.getTime(),r.expiresAt.getTime());
    await order('CANCEL');await (await c('DON_HANG')).updateOne({DON_HANG_ID:'CANCEL'},{$set:{TRANG_THAI:'Đã hủy'}});
    await assert.rejects(lucky.spinLucky('KH1','CANCEL'),/không còn hợp lệ/);
  });
  test('caps, minimum order, ownership and same-source timing are checked in backend',async()=>{
    await assert.rejects(lucky.quoteLuckyReward(undefined,'KH2',firstReward.id,200000,30000),/của bạn/);
    await assert.rejects(lucky.quoteLuckyReward(undefined,'KH1',firstReward.id,149999,30000),/tối thiểu/);
    await assert.rejects(lucky.quoteLuckyReward(undefined,'KH1',firstReward.id,200000,30000,new Date(0)),/đơn tạo sau/);
    const q=await lucky.quoteLuckyReward(undefined,'KH1',firstReward.id,1000000,30000);assert.equal(q.discount,20000);
    assert.equal(lucky.luckyDiscount({kind:'shipping',value:30000,maxDiscount:30000},200000,12000),12000);
    assert.equal(lucky.luckyDiscount({kind:'cash',value:20000},15000,30000),15000);
  });
  test('same reward cannot reserve two concurrent orders; failed checkout rolls back',async()=>{
    const {withTransaction}=await import('../services/inventory/helpers.js');
    const payload=()=>({summary:{subtotal:200000,shippingFee:30000,total:220000,loyaltyDiscount:0},items:[]});
    const attempts=await Promise.allSettled(['USE1','USE2'].map(id=>withTransaction(s=>lucky.holdLuckyReward(s,'KH1',firstReward.id,id,payload()))));
    assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
    const held=await (await c(lucky.LUCKY.reward)).findOne({_id:firstReward.id});assert.equal(held.status,'Đang giữ chỗ');
    await order(held.usedOrderId,{status:'Thanh toán thất bại',paid:false});
    assert.equal((await (await c(lucky.LUCKY.reward)).findOne({_id:firstReward.id})).status,'Có thể dùng');
    await assert.rejects(withTransaction(async s=>{await lucky.holdLuckyReward(s,'KH1',firstReward.id,'ROLLBACK',payload());throw new Error('injected');}),/injected/);
    assert.equal((await (await c(lucky.LUCKY.reward)).findOne({_id:firstReward.id})).status,'Có thể dùng');
  });
  test('paid reward use and cancellation restore old expiry without extending it',async()=>{
    const {withTransaction}=await import('../services/inventory/helpers.js');
    await withTransaction(s=>lucky.holdLuckyReward(s,'KH1',firstReward.id,'PAID-USE',{summary:{subtotal:200000,shippingFee:0,total:190000},items:[]}));
    await order('PAID-USE',{value:200000,total:190000});let r=await (await c(lucky.LUCKY.reward)).findOne({_id:firstReward.id});assert.equal(r.status,'Đã dùng');const expiry=r.expiresAt.getTime();
    await (await c('DON_HANG')).updateOne({DON_HANG_ID:'PAID-USE'},{$set:{TRANG_THAI:'Đã hủy'}});await lucky.synchronizeLuckyOrder('PAID-USE');
    r=await (await c(lucky.LUCKY.reward)).findOne({_id:firstReward.id});assert.equal(r.status,'Có thể dùng');assert.equal(r.expiresAt.getTime(),expiry);
  });
  test('cancel original after spin revokes waiting reward and records reason',async()=>{
    await order('REVOKE');await lucky.spinLucky('KH1','REVOKE');await (await c('DON_HANG')).updateOne({DON_HANG_ID:'REVOKE'},{$set:{TRANG_THAI:'Đã hủy'}});await lucky.synchronizeLuckyOrder('REVOKE');
    assert.equal((await (await c(lucky.LUCKY.reward)).findOne({spinId:'REVOKE'})).status,'Đã thu hồi');
    assert.ok(await (await c(lucky.LUCKY.audit)).findOne({orderId:'REVOKE',action:'Thu hồi phần thưởng'}));
  });
  test('prize cap remains atomic when different customers compete for the final prize',async()=>{
    const config=lucky.defaultLuckyProgram();config.prizes.find(p=>p.kind==='gift')!.giftMaterialId='GIFT';config.prizes[0].totalLimit=1;await saveNew({prizes:config.prizes});
    await Promise.all(Array.from({length:8},(_,i)=>order('CAP'+i)));
    const results=await Promise.all(Array.from({length:8},(_,i)=>lucky.spinLucky('KH1','CAP'+i)));
    assert.equal(results.filter(r=>r.prize.id==='P5').length,1);
    for(const r of results.filter(r=>r.prize.id!=='P5'))assert.equal(r.weights.some((w:any)=>w.id==='P5'),false);
  });
  test('published revision does not change old spin prizes or voucher rights',async()=>{
    await order('OLD-RULE');const oldVersion=program.version;
    const next=structuredClone(program);next.prizes[1].value=7;next.terms+=' Phiên bản mới.';
    program=await lucky.saveLuckyProgram(next,actor);
    const result=await lucky.spinLucky('KH1','OLD-RULE');assert.equal(result.programVersion,oldVersion);assert.equal(result.prize.value,10);
  });
  test('pause blocks grant/spin, preserves unused expiry; ended campaign still honors valid spins',async()=>{
    await order('PAUSE');program=await lucky.saveLuckyProgram({...program,status:'Tạm dừng'},actor);
    await assert.rejects(lucky.spinLucky('KH1','PAUSE'),/tạm dừng/);
    await order('NO-GRANT-PAUSED');assert.equal(await (await c(lucky.LUCKY.spin)).countDocuments({_id:'NO-GRANT-PAUSED'}),0);
    program=await lucky.saveLuckyProgram({...program,status:'Đang diễn ra'},actor);
    const wallet=await lucky.getLuckyWallet('KH1');assert.ok(wallet.spins.find((s:any)=>s.id==='PAUSE').expiresAt>new Date());
    program=await lucky.saveLuckyProgram({...program,status:'Đã kết thúc'},actor);
    assert.ok((await lucky.spinLucky('KH1','PAUSE')).id);
    await order('NO-GRANT-ENDED');assert.equal(await (await c(lucky.LUCKY.spin)).countDocuments({_id:'NO-GRANT-ENDED'}),0);
  });
  test('none prize creates no voucher; expired spins cannot be redrawn',async()=>{
    const p=lucky.defaultLuckyProgram();for(const x of p.prizes){x.active=x.kind==='none';x.weight=x.kind==='none'?100:0;}
    await saveNew({prizes:p.prizes});await order('NONE');const r=await lucky.spinLucky('KH1','NONE');assert.equal(r.rewardId,null);assert.equal(await (await c(lucky.LUCKY.reward)).countDocuments({spinId:'NONE'}),0);
    await order('EXPIRED');await (await c(lucky.LUCKY.spin)).updateOne({_id:'EXPIRED'},{$set:{baseExpiresAt:new Date(0)}});await assert.rejects(lucky.spinLucky('KH1','EXPIRED'),/hết hạn/);
  });

  test('gift entitlement reserves separately and source cancellation releases only gift stock',async()=>{
    const stock=await import('../services/inventory/stock.service.js');
    const {withTransaction}=await import('../services/inventory/helpers.js');
    await (await c('NHA_CUNG_CAP')).insertOne({_id:'SUP',NHA_CUNG_CAP_ID:'SUP',TEN_NHA_CUNG_CAP:'Test',TRANG_THAI:'Hoạt động'});
    await (await c('NGUYEN_VAT_LIEU')).updateOne({_id:'GIFT'},{$set:{TON_THUC:0}});
    const pn:any=await stock.createImport({supplierId:'SUP',details:[{materialId:'GIFT',receivedQty:20,unitPrice:1000}]},{id:actor,role:'Admin'});
    await stock.postImport(pn.PHIEU_NHAP_ID,{id:actor,role:'Admin'});
    const config=lucky.defaultLuckyProgram();for(const p of config.prizes){p.active=['gift','none'].includes(p.kind);p.weight=p.kind==='gift'?95:p.kind==='none'?5:0;if(p.kind==='gift')p.giftMaterialId='GIFT';}
    await saveNew({prizes:config.prizes});await order('GIFT-SOURCE');const result=await lucky.spinLucky('KH1','GIFT-SOURCE');await complete('GIFT-SOURCE');
    const payload:any={checkoutSessionId:'GIFT-CHECKOUT',summary:{subtotal:200000,total:200000},items:[]};
    await order('GIFT-TARGET',{paid:false});
    await withTransaction(async session=>{
      await stock.reserveMaterialNeeds(session,new Map([['GIFT',2]]),{status:'TAM_CHO_QR',orderId:'GIFT-TARGET',paymentSessionId:'NORMAL-HOLD',actor:{id:'KH1',role:'customer'}});
      await lucky.holdLuckyReward(session,'KH1',result.rewardId,'GIFT-TARGET',payload);
      await (await c('DON_HANG_CHI_TIET')).insertOne({DON_HANG_ID:'GIFT-TARGET',SAN_PHAM_ID:payload.items[0].id,BOM_SNAPSHOT:payload.items[0].bom,SO_LUONG:1},{session});
    });
    assert.equal((await (await c('NGUYEN_VAT_LIEU')).findOne({_id:'GIFT'})).TON_DANG_GIU,3);
    assert.equal(await (await c('GIU_TON')).countDocuments({VQ_PHAN_THUONG_ID:result.rewardId}),1);
    await (await c('DON_HANG')).updateOne({DON_HANG_ID:'GIFT-SOURCE'},{$set:{TRANG_THAI:'Đã hủy'}});await lucky.synchronizeLuckyOrder('GIFT-SOURCE');
    assert.equal((await (await c('NGUYEN_VAT_LIEU')).findOne({_id:'GIFT'})).TON_DANG_GIU,2);
    assert.equal((await (await c(lucky.LUCKY.reward)).findOne({_id:result.rewardId})).status,'Đã thu hồi');
    assert.equal((await (await c('DON_HANG_CHI_TIET')).findOne({DON_HANG_ID:'GIFT-TARGET',SAN_PHAM_ID:payload.items[0].id})).VQ_QUA_DA_HUY,true);
  });
  test('completion catch-up uses original completion timestamp and persists spin expiry',async()=>{
    await order('OLD-COMPLETION');const r=await lucky.spinLucky('KH1','OLD-COMPLETION');
    const at=new Date(Date.now()-31*86400000);
    await (await c('DON_HANG')).updateOne({DON_HANG_ID:'OLD-COMPLETION'},{$set:{TRANG_THAI:'Hoàn thành',NGAY_HOAN_THANH:at}});await lucky.synchronizeLuckyOrder('OLD-COMPLETION');
    const reward=await (await c(lucky.LUCKY.reward)).findOne({_id:r.rewardId});assert.equal(reward.status,'Hết hạn');assert.equal(reward.activatedAt.getTime(),at.getTime());
    await order('PERSIST-EXPIRY');await (await c(lucky.LUCKY.spin)).updateOne({_id:'PERSIST-EXPIRY'},{$set:{baseExpiresAt:new Date(0)}});await lucky.expireLuckySpins();assert.equal((await (await c(lucky.LUCKY.spin)).findOne({_id:'PERSIST-EXPIRY'})).status,'Hết hạn');
  });
  test('HTTP routes reject guest lookup and forged Admin headers; member sees only own wallet',async()=>{
    const express=(await import('express')).default;const routes=(await import('../routes/lucky-wheel.js')).default;
    const access=await import('../services/order-access.service.js');const token=(await access.createCustomerOrderAccess({KHACH_HANG_ID:'KH1',SDT:'0901234567'})).accessToken;
    const guest='oa_'+randomBytes(32).toString('hex');await (await c('XAC_THUC_TRA_CUU_DON')).insertOne({_id:createHash('sha256').update(guest).digest('hex'),kind:'lookup',phone:'0901234567',expiresAt:new Date(Date.now()+60000)});
    const app=express();app.use(express.json());app.use('/api/lucky',routes);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port+'/api/lucky';
    try{
      assert.equal((await fetch(base+'/wallet')).status,401);
      assert.equal((await fetch(base+'/wallet',{headers:{'x-order-access':guest}})).status,401);
      assert.equal((await fetch(base+'/admin',{headers:{'x-admin-role':'Admin','x-admin-id':actor}})).status,401);
      const response=await fetch(base+'/wallet',{headers:{'x-order-access':token}});assert.equal(response.status,200);const wallet:any=await response.json();assert.ok(wallet.rewards.every((r:any)=>r.customerId==='KH1'));
      assert.equal((await fetch(base+'/spins/DOUBLE',{method:'POST',headers:{'x-order-access':guest}})).status,401);
    }finally{await new Promise<void>(r=>server.close(()=>r()));}
  });

  test('checkout writer rejects forged catalog price and persists held reward with exact total',async()=>{
    const {withTransaction}=await import('../services/inventory/helpers.js');const {writeCheckoutOrder}=await import('../services/checkout-order-writer.service.js');
    const config=lucky.defaultLuckyProgram();for(const p of config.prizes){p.active=['P5','NONE'].includes(p.id);p.weight=p.id==='P5'?95:p.id==='NONE'?5:0;}
    await saveNew({prizes:config.prizes});await order('WRITE-SOURCE');const r=await lucky.spinLucky('KH1','WRITE-SOURCE');await complete('WRITE-SOURCE');
    await (await c('SAN_PHAM')).insertOne({_id:'SP_WRITE',SAN_PHAM_ID:'SP_WRITE',GIA:250000});
    const payload=()=>({customerId:'KH1',checkoutSessionId:'WRITER',luckyRewardId:r.rewardId,inventoryMode:'FUTURE_DEMAND',sender:{name:'Test',phone:'0901234567'},receiver:{name:'Test',phone:'0901234567',address:'Test'},delivery:{date:'2026-12-31'},payment:{method:'bank'},flags:{},summary:{subtotal:250000,shippingFee:0,total:237500},items:[{id:'SP_WRITE',qty:1,price:250000}]});
    const forged=payload();forged.items[0].price=200000;forged.summary.subtotal=200000;forged.summary.total=190000;
    await assert.rejects(withTransaction(s=>writeCheckoutOrder(s,'YENWRITEBAD',forged)),/Giá sản phẩm/);
    assert.equal(await (await c('DON_HANG')).countDocuments({DON_HANG_ID:'YENWRITEBAD'}),0);
    await withTransaction(s=>writeCheckoutOrder(s,'YENWRITEGOOD',payload()));
    const o=await (await c('DON_HANG')).findOne({DON_HANG_ID:'YENWRITEGOOD'});assert.equal(o.TONG_TIEN,237500);assert.equal(o.GIA_TRI_SAN_PHAM_DA_CHOT,250000);assert.equal(o.VQ_PHAN_THUONG_ID,r.rewardId);
    assert.equal((await (await c(lucky.LUCKY.reward)).findOne({_id:r.rewardId})).status,'Đang giữ chỗ');
  });

  test('reward code preview distinguishes waiting, activation, ownership and expiry',async()=>{
    await order('CODE-SOURCE');const result=await lucky.spinLucky('KH1','CODE-SOURCE');const reward=await (await c(lucky.LUCKY.reward)).findOne({_id:result.rewardId});
    const express=(await import('express')).default;const routes=(await import('../routes/lucky-wheel.js')).default;const access=await import('../services/order-access.service.js');
    const token=(await access.createCustomerOrderAccess({KHACH_HANG_ID:'KH1'})).accessToken,foreign=(await access.createCustomerOrderAccess({KHACH_HANG_ID:'KH2'})).accessToken;
    const app=express();app.use(express.json());app.use('/api/lucky',routes);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
    const base='http://127.0.0.1:'+(server.address() as any).port+'/api/lucky/preview';
    const preview=(auth=token)=>fetch(base,{method:'POST',headers:{'content-type':'application/json','x-order-access':auth},body:JSON.stringify({rewardCode:' '+reward.code.toLowerCase()+' ',subtotal:250000,shippingFee:0})});
    try{
      let response=await preview();assert.equal(response.status,409);assert.match((await response.json() as any).message,/CODE-SOURCE.*Hoàn thành/);
      await complete('CODE-SOURCE');response=await preview();assert.equal(response.status,200);const q:any=await response.json();assert.equal(q.rewardId,reward.id);assert.equal(q.discount,12500);
      assert.equal((await preview(foreign)).status,404);
      await (await c(lucky.LUCKY.reward)).updateOne({_id:reward.id},{$set:{expiresAt:new Date(0)}});assert.equal((await preview()).status,410);
    }finally{await new Promise<void>(r=>server.close(()=>r()));}
  });
}
