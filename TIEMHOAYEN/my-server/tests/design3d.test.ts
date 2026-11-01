import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, randomBytes, createHash} from 'node:crypto';

const uri=process.env.TEST_MONGO_URI;
if(!uri) test('3D integration requires isolated TEST_MONGO_URI',{skip:true},()=>{});
else {
  process.env.MONGO_URI=uri;
  process.env.MONGO_DATABASE='YEN_3D_TEST_'+randomUUID().replaceAll('-','');
  let mongo:typeof import('../mongo.js'), design:typeof import('../services/design3d.service.js');
  let requests:typeof import('../services/order-request.service.js'), flow:typeof import('../services/sales-proposal.service.js');
  const collection=async(name:string)=>(await mongo.getCollection<any>(name));
  const invoke=async(handler:any,body:any,params:any={})=>{
    let code=200,data:any;
    await handler({body,params,headers:{}},{status(n:number){code=n;return this;},json(d:any){data=d;return this;}});
    return {code,data};
  };
  const image='data:image/png;base64,aGVsbG8=';
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const submit=async(d:any,date=today(),overrides:any={})=>{
    const {createOrder}=await import('../controllers/order.js');
    return invoke(createOrder,{sender:{name:'Khách thử',phone:'0901234567'},receiver:{name:'Người nhận',phone:'0912345678',address:'Test'},
      delivery:{date,time:'23:59'},items:[{id:d.productId,qty:1,price:d.price}],payment:{method:'bank',methodName:'Chuyển khoản'},
      summary:{subtotal:d.price,total:d.price,shippingFee:0},flags:{},checkoutSessionId:randomUUID(),...overrides});
  };
  const sales={NHAN_VIEN_ID:'NV_SALES',HO_TEN:'Tư vấn viên'};
  before(async()=>{
    mongo=await import('../mongo.js');design=await import('../services/design3d.service.js');
    requests=await import('../services/order-request.service.js');flow=await import('../services/sales-proposal.service.js');
    await (await collection('NGUYEN_VAT_LIEU')).insertMany([
      {NGUYEN_VAT_LIEU_ID:'ROSE',TEN_NGUYEN_VAT_LIEU:'Hồng',DUNG_CHO_3D:true,MODEL_3D_KEY:'rose',GIA_BAN:10000,TON_THUC:100,TON_DANG_GIU:0,TON_KHONG_DAT:0,NHOM_NVL:'IT_HU',DON_VI_TINH:'cành',NGUONG_CANH_BAO:150},
      {NGUYEN_VAT_LIEU_ID:'LAST',TEN_NGUYEN_VAT_LIEU:'Bó cuối',DUNG_CHO_3D:true,GIA_BAN:10000,TON_THUC:2,TON_DANG_GIU:0,TON_KHONG_DAT:0,NHOM_NVL:'IT_HU',DON_VI_TINH:'cành'},
      {NGUYEN_VAT_LIEU_ID:'OTHER',DUNG_CHO_3D:false,GIA_BAN:1,TON_THUC:100}
    ]);
  });
  after(async()=>{if(mongo){await (await mongo.getDb()).dropDatabase();await (await mongo.getMongoClient()).close();}});
  let original:any, approved:any;
  test('only flagged materials; save/estimate create no hold, reject malformed composition',async()=>{
    assert.equal((await design.listDesignMaterials()).materials.length,2);
    await assert.rejects(design.createDesign({materials:[{materialId:'OTHER',quantity:1}]}));
    await assert.rejects(design.createDesign({materials:[{materialId:'ROSE',quantity:-1}]}));
    await assert.rejects(design.createDesign({materials:[{materialId:'ROSE',quantity:1},{materialId:'ROSE',quantity:1}]}));
    original=await design.createDesign({materials:[{materialId:'ROSE',quantity:2,colors:[{color:'Đỏ',quantity:1},{color:'Hồng',quantity:1}]}],image,approved:true,designFee:0});
    assert.equal(original.price,20000);assert.equal(original.requiresReview,true);
    assert.equal(await (await collection('GIU_TON')).countDocuments(),0);
    assert.equal(await (await collection('THIET_KE_3D_CHI_TIET')).countDocuments(),1);
    assert.deepEqual((await design.listDesignMaterials()).materials.find(m=>m.id==='ROSE')!.colors,['Đỏ','Hồng']);
    assert.equal(original.materials[0].colors.length,2);
    await assert.rejects(design.createDesign({materials:[{materialId:'ROSE',quantity:2,colors:[{color:'Đỏ',quantity:3}]}]}),/Tổng/);
    await assert.rejects(design.createDesign({materials:[{materialId:'ROSE',quantity:2,colors:[{color:'Không tồn tại',quantity:2}]}]}),/màu/);
  });
  test('new design goes to Sales; consent and exact staff proposal approve pattern, future order has no hold',async()=>{
    const r=await submit(original,'2099-11-01');assert.equal(r.code,201,JSON.stringify(r));assert.equal(r.data.kind,'sales_request');
    assert.equal(await (await collection('THANH_TOAN')).countDocuments(),0);
    await requests.updateSalesRequest(r.data.requestId,{action:'claim',version:0},sales);
    const q=await flow.propose(r.data.requestId,{version:1,items:[{custom:true,designId:original.designId,name:'Bó khách thiết kế',qty:1,image,imageDescription:'Ảnh thiết kế',materials:[{materialId:'ROSE',quantity:2,colors:original.materials[0].colors}],designFee:30000,extraFee:5000}],date:'2099-11-01',time:'15:00',shippingFee:0,paymentMethod:'bank',note:'Đã kiểm tra bó thực hiện được.'},sales);
    assert.equal(q.summary.total,55000);
    await assert.rejects(flow.convertProposal(r.data.requestId,{quoteId:q.id,version:2},sales),/chưa đồng ý/);
    const token='oa_'+randomBytes(32).toString('hex');
    await (await collection('XAC_THUC_TRA_CUU_DON')).insertOne({_id:createHash('sha256').update(token).digest('hex'),kind:'lookup',phone:'0901234567',expiresAt:new Date(Date.now()+1800000)});
    await flow.respondToProposal(r.data.requestId,token,{action:'accept',quoteId:q.id});
    const row=await (await collection(requests.REQUESTS)).findOne({_id:r.data.requestId});
    const result=await flow.convertProposal(r.data.requestId,{quoteId:q.id,version:row.version},sales);
    assert.ok(result.orderId);
    assert.equal(await (await collection('GIU_TON')).countDocuments({DON_HANG_ID:result.orderId}),0);
    approved=await design.getDesign(original.designId);
    assert.equal(approved.price,55000);assert.equal(approved.requiresReview,false,'Below threshold still allowed');
    const changed=await design.createDesign({materials:[{materialId:'ROSE',quantity:3}]});assert.equal(changed.requiresReview,true);
    const recolored=await design.createDesign({materials:[{materialId:'ROSE',quantity:2,colors:[{color:'Đỏ',quantity:2}]}]});assert.equal(recolored.requiresReview,true,'Changing colors does not reuse approval for another layout');
  });
  test('approved today: hold before payment, immutable material snapshot, repeat confirmation no double hold',async()=>{
    const r=await submit(approved);assert.equal(r.code,201,JSON.stringify(r));assert.equal(r.data.kind,'order');
    const detail=await (await collection('DON_HANG_CHI_TIET')).findOne({DON_HANG_ID:r.data.orderId});
    assert.equal(detail.THIET_KE_3D_ID,approved.designId);assert.equal(detail.BOM_SNAPSHOT.materials[0].quantity,2);
    assert.equal(detail.BOM_SNAPSHOT.materials[0].colors.length,2);
    const held=await (await collection('NGUYEN_VAT_LIEU')).findOne({NGUYEN_VAT_LIEU_ID:'ROSE'});assert.equal(held.TON_DANG_GIU,2);
    const {updateAdminOrderPaymentStatus}=await import('../controllers/admin.js');
    for(let i=0;i<2;i++){const paid=await invoke(updateAdminOrderPaymentStatus,{status:'Thành công',amount:55000},{orderId:r.data.orderId});assert.equal(paid.code,200,JSON.stringify(paid));}
    assert.equal((await (await collection('NGUYEN_VAT_LIEU')).findOne({NGUYEN_VAT_LIEU_ID:'ROSE'})).TON_DANG_GIU,2);
  });
  test('approved future: no hold before/after payment; only verified payment creates frozen demand once',async()=>{
    const r=await submit(approved,'2099-11-01');assert.equal(r.code,201,JSON.stringify(r));assert.equal(r.data.kind,'order');
    assert.equal(await (await collection('GIU_TON')).countDocuments({DON_HANG_ID:r.data.orderId}),0);
    assert.equal(await (await collection('NHU_CAU_NVL_DU_KIEN')).countDocuments({DON_HANG_ID:r.data.orderId}),0);
    const {updateAdminOrderPaymentStatus}=await import('../controllers/admin.js');
    for(let i=0;i<2;i++){const paid=await invoke(updateAdminOrderPaymentStatus,{status:'Thành công',amount:55000},{orderId:r.data.orderId});assert.equal(paid.code,200,JSON.stringify(paid));}
    const demand=await (await collection('NHU_CAU_NVL_DU_KIEN')).find({DON_HANG_ID:r.data.orderId}).toArray();
    assert.equal(demand.length,1);assert.equal(demand[0].SO_LUONG,2);
    assert.equal(await (await collection('GIU_TON')).countDocuments({DON_HANG_ID:r.data.orderId}),0);
  });
  test('approved price/total tampering rejected before order/QR/hold',async()=>{
    const price=await submit({...approved,price:1});assert.ok(price.code>=400,JSON.stringify(price));
    const total=await submit(approved,today(),{summary:{subtotal:55000,total:1,shippingFee:0}});assert.ok(total.code>=400,JSON.stringify(total));
  });
  test('member cart resolves design and current price without reserving; quantity flags shortage',async()=>{
    const cart=await import('../controllers/cart.js');
    const before=(await (await collection('NGUYEN_VAT_LIEU')).findOne({NGUYEN_VAT_LIEU_ID:'ROSE'})).TON_DANG_GIU;
    const add=await invoke(cart.addCartItem,{customerId:'KH_3D',productId:approved.productId,quantity:1});assert.equal(add.code,200);
    const detail=await (await collection('GIO_HANG_CHI_TIET')).findOne({SAN_PHAM_ID:approved.productId});assert.equal(detail.THIET_KE_3D_ID,approved.designId);
    const read=await invoke(cart.getCartByCustomer,{}, {customerId:'KH_3D'});assert.equal(read.code,200);assert.equal(read.data.items[0].GIA,55000);
    await invoke(cart.updateCartItem,{customerId:'KH_3D',productId:approved.productId,quantity:100});
    const short=await invoke(cart.getCartByCustomer,{}, {customerId:'KH_3D'});assert.equal(short.data.items[0].CAN_SHOP_DUYET,true);
    assert.equal((await (await collection('NGUYEN_VAT_LIEU')).findOne({NGUYEN_VAT_LIEU_ID:'ROSE'})).TON_DANG_GIU,before);
  });
  test('future quantity beyond availability needs review despite single-bouquet approval',async()=>{
    const r=await submit(approved,'2099-11-01',{items:[{id:approved.productId,qty:100,price:55000}],summary:{subtotal:5500000,total:5500000,shippingFee:0}});
    assert.equal(r.code,201);assert.equal(r.data.kind,'sales_request');
    assert.equal(await (await collection('THANH_TOAN')).countDocuments({DON_HANG_ID:r.data.requestId}),0);
  });
  test('expired future QR cannot create demand; retry keeps future order unreserved',async()=>{
    const {retryOrderPayment}=await import('../controllers/order.js');
    const {updateAdminOrderPaymentStatus}=await import('../controllers/admin.js');
    const r=await submit(approved,'2099-11-01');assert.equal(r.code,201);
    await (await collection('THANH_TOAN')).updateMany({DON_HANG_ID:r.data.orderId},{$set:{NGAY_THANH_TOAN:new Date(0)}});
    assert.equal((await invoke(updateAdminOrderPaymentStatus,{status:'Thành công',amount:55000},{orderId:r.data.orderId})).code,410);
    assert.equal(await (await collection('NHU_CAU_NVL_DU_KIEN')).countDocuments({DON_HANG_ID:r.data.orderId}),0);
    const retry=await invoke(retryOrderPayment,{},{orderId:r.data.orderId});assert.equal(retry.code,200,JSON.stringify(retry));
    assert.equal(await (await collection('GIU_TON')).countDocuments({DON_HANG_ID:r.data.orderId}),0);
  });
  test('concurrent approved orders for final materials cannot oversell',async()=>{
    const d=await design.createDesign({materials:[{materialId:'LAST',quantity:2}]});
    await (await collection('MAU_3D_DA_DUYET')).insertOne({_id:d.fingerprint,TRANG_THAI:'Đã duyệt',designFee:0,extraFee:0});
    const q=await design.getDesign(d.designId);
    const results=await Promise.all([submit(q),submit(q)]);
    assert.deepEqual(results.map(r=>r.code),[201,201]);
    assert.equal(results.filter(r=>r.data.kind==='order').length,1,JSON.stringify(results));
    assert.equal(results.filter(r=>r.data.kind==='sales_request').length,1);
    assert.equal((await (await collection('NGUYEN_VAT_LIEU')).findOne({NGUYEN_VAT_LIEU_ID:'LAST'})).TON_DANG_GIU,2);
  });
}
