import {TestBed} from '@angular/core/testing';
import {provideRouter,Router} from '@angular/router';
import {By} from '@angular/platform-browser';
import {LuckyWheel} from '../../pages/lucky-wheel/lucky-wheel';
import {of} from 'rxjs';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {LuckyOrderSpin} from './lucky-order-spin';
import {LuckyRewardPicker} from '../lucky-reward-picker/lucky-reward-picker';
import {LuckyWheelService} from '../../services/lucky-wheel.service';
import {CheckoutComponent} from '../../pages/orders/checkout/checkout';
import {OrderService} from '../../services/order.service';
function signIn(){localStorage.setItem('khachHang',JSON.stringify({KHACH_HANG_ID:'KH1'}));sessionStorage.setItem('orderLookupAccess',JSON.stringify({authType:'member',customerId:'KH1',accountKey:'KH1',accessToken:'oa_'+ 'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString()}));}
const program={status:'Đang diễn ra',threshold:200000,prizes:Array.from({length:7},(_,i)=>({id:'P'+i,name:'Giải '+i,weight:i===0?40:10}))};
describe('Lucky wheel after successful payment',()=>{
  let api:any;
  beforeEach(async()=>{
    sessionStorage.clear();signIn();
    api={wallet:vi.fn(()=>of({program,spins:[{id:'YEN1',orderId:'YEN1',status:'Chưa quay',paused:false,expiresAt:new Date(Date.now()+86400000),program}],rewards:[],history:[]})),spin:vi.fn()};
    await TestBed.configureTestingModule({imports:[LuckyOrderSpin,CheckoutComponent,LuckyRewardPicker],providers:[provideRouter([]),{provide:LuckyWheelService,useValue:api},{provide:OrderService,useValue:{}}]}).compileComponents();
  });
  afterEach(()=>{TestBed.resetTestingModule();sessionStorage.clear();localStorage.clear();});
  it('opens eligible order wheel automatically, permits defer and reopen in place',()=>{
    const fixture=TestBed.createComponent(LuckyOrderSpin);fixture.componentRef.setInput('orderId','YEN1');const opened=vi.fn();fixture.componentInstance.opened.subscribe(opened);fixture.detectChanges();
    expect(fixture.componentInstance.visible()).toBe(true);expect(opened).toHaveBeenCalledOnce();expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
    fixture.componentInstance.defer();fixture.detectChanges();expect(fixture.componentInstance.visible()).toBe(false);expect(sessionStorage.getItem('yenLuckyDeferred:YEN1')).toBe('1');expect(fixture.nativeElement.textContent).toContain('Quay ngay');
    fixture.componentInstance.open();fixture.detectChanges();expect(fixture.componentInstance.visible()).toBe(true);expect(api.spin).not.toHaveBeenCalled();
  });
  it('does not auto-open a deferred order again, another order, a paused or used spin',()=>{
    sessionStorage.setItem('yenLuckyDeferred:YEN1','1');const a=TestBed.createComponent(LuckyOrderSpin);a.componentRef.setInput('orderId','YEN1');a.detectChanges();expect(a.componentInstance.visible()).toBe(false);a.destroy();
    const b=TestBed.createComponent(LuckyOrderSpin);b.componentRef.setInput('orderId','YEN2');b.detectChanges();expect(b.componentInstance.visible()).toBe(false);b.destroy();
    sessionStorage.clear();signIn();api.wallet.mockReturnValue(of({spins:[{id:'YEN1',orderId:'YEN1',status:'Chưa quay',paused:true}]}));const c=TestBed.createComponent(LuckyOrderSpin);c.componentRef.setInput('orderId','YEN1');c.detectChanges();expect(c.componentInstance.visible()).toBe(false);
  });
  it('accepts an activated wheel code and clears it when customer removes it',()=>{
    api.previewCode=vi.fn(()=>of({rewardId:'R1',code:'YEN-123456789ABC',discount:10000,prize:{name:'Giảm 5%',kind:'percent'}}));
    const fixture=TestBed.createComponent(LuckyRewardPicker);fixture.componentRef.setInput('subtotal',200000);fixture.detectChanges();const changed=vi.fn();fixture.componentInstance.rewardChange.subscribe(changed);
    fixture.componentInstance.applyCode('YEN-123456789ABC');expect(api.previewCode).toHaveBeenCalledWith('YEN-123456789ABC',200000,0);expect(fixture.componentInstance.selectedId).toBe('R1');expect(changed).toHaveBeenLastCalledWith({id:'R1',discount:10000});
    fixture.componentInstance.choose('');expect(fixture.componentInstance.discount()).toBe(0);expect(changed).toHaveBeenLastCalledWith(null);
  });
  it('signals eligibility check completion even when this order has no spin',()=>{
    api.wallet.mockReturnValue(of({spins:[]}));const fixture=TestBed.createComponent(LuckyOrderSpin);fixture.componentRef.setInput('orderId','NO-SPIN');const checked=vi.fn();fixture.componentInstance.checked.subscribe(checked);fixture.detectChanges();expect(checked).toHaveBeenCalledOnce();expect(fixture.componentInstance.visible()).toBe(false);
  });
  it('a repeated successful payment response does not restart the wheel eligibility wait',()=>{
    const fixture=TestBed.createComponent(CheckoutComponent);const page=fixture.componentInstance as any;page.order={source:'registrant'};vi.spyOn(page.cdr,'detectChanges').mockImplementation(()=>{});vi.spyOn(page,'saveCompletedOrderInfo').mockImplementation(()=>{});vi.spyOn(page,'removeFailedOrderInfo').mockImplementation(()=>{});
    page.handlePaymentSuccess();expect(page.luckyCheckPending).toBe(true);page.luckyCheckPending=false;page.checkoutResultDismissed=true;page.handlePaymentSuccess();expect(page.luckyCheckPending).toBe(false);expect(page.checkoutResultDismissed).toBe(true);
  });
  it('uses one payment-and-wheel popup, keeps next actions after result, and defers on navigation',()=>{
    const fixture=TestBed.createComponent(LuckyOrderSpin);fixture.componentRef.setInput('orderId','YEN1');const viewOrder=vi.fn();fixture.componentInstance.viewOrder.subscribe(viewOrder);fixture.detectChanges();
    let dialog=fixture.nativeElement.querySelector('.spin-dialog');expect(dialog.textContent).toContain('Thanh toán thành công');expect(dialog.textContent).toContain('Mã đơn: YEN1');expect(dialog.querySelectorAll('.checkout-next button').length).toBe(2);
    const wheel=fixture.debugElement.query(By.directive(LuckyWheel)).componentInstance as LuckyWheel;
    wheel.result.set({rewardId:'R1',prize:{name:'Giảm 5%',kind:'percent',maxDiscount:20000},minimumOrder:150000,rewardDays:30,reward:{status:'Chờ kích hoạt'}});fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[role="dialog"]').length).toBe(1);expect(fixture.nativeElement.querySelector('.result-backdrop')).toBeNull();expect(dialog.textContent).toContain('Giảm 5%');expect(dialog.textContent).toContain('Thưởng kích hoạt khi đơn YEN1 hoàn thành');
    dialog.querySelector('.checkout-next button').click();fixture.detectChanges();expect(viewOrder).toHaveBeenCalledOnce();expect(fixture.componentInstance.visible()).toBe(false);expect(sessionStorage.getItem('yenLuckyDeferred:YEN1')).toBe('1');
  });
  it('continue shopping emits its own action and keeps the unused spin for later',()=>{
    const fixture=TestBed.createComponent(LuckyOrderSpin);fixture.componentRef.setInput('orderId','YEN1');const shopping=vi.fn();fixture.componentInstance.shopping.subscribe(shopping);fixture.detectChanges();fixture.nativeElement.querySelectorAll('.checkout-next button')[1].click();expect(shopping).toHaveBeenCalledOnce();expect(sessionStorage.getItem('yenLuckyDeferred:YEN1')).toBe('1');expect(api.spin).not.toHaveBeenCalled();
  });
  it('closing payment confirmation stays on checkout instead of navigating home',()=>{
    const fixture=TestBed.createComponent(CheckoutComponent);const router=TestBed.inject(Router);const navigate=vi.spyOn(router,'navigate');fixture.componentInstance.closeCheckoutResultPopup();expect(fixture.componentInstance.checkoutResultDismissed).toBe(true);expect(navigate).not.toHaveBeenCalled();
  });
});
