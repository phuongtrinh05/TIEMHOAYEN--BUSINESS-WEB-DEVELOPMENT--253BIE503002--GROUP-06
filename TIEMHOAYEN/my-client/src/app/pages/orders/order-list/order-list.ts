import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OrderAccessService } from '../../../services/order-access.service';
import { currentOrderAccountKey } from '../../../services/api-config';
import { OrderService } from '../../../services/order.service';

type LookupTab = 'all'|'shipping'|'completed'|'returns'|'cancelled'|'requests';

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './order-list.html',
  styleUrl: './order-list.css',
})
export class OrderList implements OnInit, OnDestroy {
  readonly access = inject(OrderAccessService);
  private readonly ordersService = inject(OrderService);
  private readonly cdr = inject(ChangeDetectorRef);
  phone = ''; lookupCode = ''; orderId = ''; requestId = ''; code = ''; challengeId = ''; notice = ''; error = ''; busy = false;
  otpValues = Array(6).fill('');
  otpDelivery = '';
  phoneTouched = false; orderIdTouched = false; requestIdTouched = false; otpTouched = false;
  resendAt = 0; now = Date.now(); orders: any[] = []; requests: any[] = []; statuses: string[] = []; counts: any = {};
  private allOrders: any[] = [];
  private allRequests: any[] = [];
  search = ''; status = ''; date = ''; page = 1; pageSize = 12; total = 0;
  activeTab: LookupTab = 'all';
  readonly tabs: {id:LookupTab;label:string}[] = [
    {id:'all',label:'Tất cả'},{id:'shipping',label:'Chờ giao hàng'},
    {id:'completed',label:'Đã giao'},{id:'returns',label:'Đang hỗ trợ'},{id:'cancelled',label:'Đã hủy'},
    {id:'requests',label:'Yêu cầu đặt hàng'},
  ];
  private timer?: ReturnType<typeof setInterval>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private lastAutoRefreshAt = 0;
  get isMember() { return !!currentOrderAccountKey(); }
  get validPhone() { return /^0\d{9}$/.test(this.phone.replace(/[\s().-]/g, '')); }
  get validOrderId() { return !this.orderId || /^YEN[A-Z0-9]{8,32}$/.test(this.orderId); }
  get validRequestId() { return !this.requestId || /^YC[A-Z0-9]{8,32}$/.test(this.requestId); }
  get validLookupCode() { return !this.lookupCode || /^(?:YEN[A-Z0-9]{8,32}|YC[A-Z0-9]{8,32})$/.test(this.lookupCode); }
  get validCode() { return /^\d{6}$/.test(this.code); }
  get phoneError(){return!this.phone?'Vui lòng nhập số điện thoại.':!this.validPhone?'Số điện thoại không hợp lệ.':''}
  get orderIdError(){return this.orderId&&!this.validOrderId?'Mã đơn hàng không hợp lệ.':''}
  get requestIdError(){return this.requestId&&!this.validRequestId?'Mã yêu cầu không hợp lệ.':''}
  get lookupCodeError(){return this.lookupCode&&!this.validLookupCode?'Mã đơn hàng hoặc mã yêu cầu không hợp lệ.':''}
  get otpValidationError(){return!this.code?'Vui lòng nhập mã OTP.':!this.validCode?'Mã OTP phải gồm 6 chữ số.':''}
  get maskedPhone(){return this.phone.length===10?`${this.phone.slice(0,4)} *** ${this.phone.slice(-3)}`:this.phone}
  get resendSeconds() { return Math.max(0, Math.ceil((this.resendAt - this.now) / 1000)); }
  get totalPages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); }
  ngOnInit() {
    if (typeof window === 'undefined') return;
    const session = this.access.session;
    if (session?.requestId) {
      this.requestId = session.requestId;
      this.lookupCode = session.requestId;
      this.activeTab = 'requests';
    } else if (session?.orderId) {
      this.orderId = session.orderId;
      this.lookupCode = session.orderId;
    }
    if (session) this.load();
    this.timer = setInterval(() => {
      this.now = Date.now();
      if (this.access.session && !this.busy && !document.hidden && this.now - this.lastAutoRefreshAt >= 15000) {
        this.lastAutoRefreshAt = this.now;
        this.load();
      }
      this.cdr.markForCheck();
    }, 1000);
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); if (this.searchTimer) clearTimeout(this.searchTimer); }
  phoneInput(value:string){this.phone=String(value||'').replace(/\D/g,'').slice(0,10);this.error=''}
  lookupCodeInput(value:string){this.lookupCode=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,35);this.orderId=this.lookupCode.startsWith('YEN')?this.lookupCode:'';this.requestId=this.lookupCode.startsWith('YC')?this.lookupCode:'';this.error=''}
  otpDigit(event:Event,index:number){const input=event.target as HTMLInputElement;const digit=input.value.replace(/\D/g,'').slice(-1);this.otpValues[index]=digit;input.value=digit;this.code=this.otpValues.join('');this.error='';if(digit&&index<5)document.getElementById(`lookup-otp-${index+1}`)?.focus()}
  otpKeydown(event:KeyboardEvent,index:number){if(event.key==='Backspace'&&!this.otpValues[index]&&index>0){event.preventDefault();this.otpValues[index-1]='';this.code=this.otpValues.join('');const previous=document.getElementById(`lookup-otp-${index-1}`) as HTMLInputElement|null;previous?.focus();previous?.select()}else if(event.key==='ArrowLeft'&&index>0){event.preventDefault();document.getElementById(`lookup-otp-${index-1}`)?.focus()}else if(event.key==='ArrowRight'&&index<5){event.preventDefault();document.getElementById(`lookup-otp-${index+1}`)?.focus()}else if(event.key==='Enter')this.verify()}
  otpPaste(event:ClipboardEvent){event.preventDefault();const digits=(event.clipboardData?.getData('text')||'').replace(/\D/g,'').slice(0,6);if(!digits)return;this.otpValues=Array.from({length:6},(_,i)=>digits[i]||'');this.code=this.otpValues.join('');this.error='';this.cdr.markForCheck();setTimeout(()=>document.getElementById(`lookup-otp-${Math.min(digits.length,6)-1}`)?.focus())}
  sendOtp() { this.phoneTouched=true;this.orderIdTouched=true;this.requestIdTouched=true;if(this.busy||this.resendSeconds||!this.validPhone||!this.validLookupCode)return;this.busy=true;this.error='';this.access.requestOtp(this.phone,this.orderId||undefined,this.requestId||undefined).subscribe({next:r=>{this.challengeId=r.challengeId;this.otpDelivery=String(r.delivery||'');this.notice=r.message||'';this.resendAt=Date.now()+Number(r.resendAfterSeconds||60)*1000;this.code='';this.otpValues.fill('');this.busy=false;this.cdr.markForCheck();setTimeout(()=>document.getElementById('lookup-otp-0')?.focus())},error:e=>this.fail(e)}); }
  verify() { this.otpTouched=true;if(this.busy||!this.validCode)return;this.busy=true;this.error='';this.access.verify(this.challengeId,this.code).subscribe({next:()=>{this.busy=false;this.challengeId='';this.code='';this.page=1;if(this.requestId)this.activeTab='requests';this.load()},error:e=>this.fail(e)}); }
  changePhone() { this.challengeId='';this.code='';this.otpValues.fill('');this.otpDelivery='';this.notice='';this.error='';this.resendAt=0;this.phoneTouched=false;this.orderIdTouched=false;this.requestIdTouched=false;this.otpTouched=false; }
  searchChanged() { if(this.searchTimer)clearTimeout(this.searchTimer);this.searchTimer=setTimeout(()=>{this.page=1;this.applyLocalView()},120); }
  filterChanged(){this.page=1;this.applyLocalView()}
  selectTab(tab:LookupTab){if(this.activeTab===tab)return;this.activeTab=tab;this.page=1;this.status='';this.date='';this.search='';this.applyLocalView()}
  tabCount(tab:LookupTab){return Number(this.counts?.[tab]||0)}
  clearFilters(){this.search='';this.status='';this.date='';this.page=1;this.applyLocalView()}
  goToPage(next:number){if(next<1||next>this.totalPages||next===this.page)return;this.page=next;this.applyLocalView()}
  canCancelRequest(request:any){return !['Đã lên đơn','Đã từ chối','Đã tư vấn','Khách đã hủy','Hết hạn thanh toán'].includes(String(request?.status||''))}
  canConfirmRequest(request:any){return String(request?.status||'')==='Chờ khách xác nhận'&&!!request?.quote?.id}
  requestStatusLabel(status:any){const value=String(status||'');if(['Khách đã hủy','Hết hạn thanh toán'].includes(value))return'Đã hủy yêu cầu';if(value==='Chờ khách xác nhận')return'Chờ xác nhận';return value}
  requestStatusTone(status:any){const value=String(status||'');if(value==='Đã lên đơn')return'success';if(['Chờ khách xác nhận','Chờ khách thanh toán','Chờ thanh toán'].includes(value))return'waiting';if(['Đã từ chối','Khách đã hủy','Hết hạn thanh toán'].includes(value))return'danger';return value==='Chờ xử lý'||value==='Chờ Sales tiếp nhận'?'new':'processing'}
  linkedOrderId(request:any){return String(request?.linkedOrder?.DON_HANG_ID||request?.orderId||request?.orderResult?.orderId||'')}
  hasLinkedOrder(request:any){return request?.status==='Đã lên đơn'&&!!this.linkedOrderId(request)}
  cancelRequest(request:any){const session=this.access.session;if(this.busy||!session||!this.canCancelRequest(request))return;this.busy=true;this.error='';this.ordersService.updateSalesRequest(request.requestId,session.accessToken,{action:'cancel'}).subscribe({next:()=>{this.busy=false;this.load()},error:e=>this.fail(e)})}
  confirmRequest(request:any){const session=this.access.session;if(this.busy||!session||!this.canConfirmRequest(request))return;this.busy=true;this.error='';this.ordersService.respondSalesRequest(request.requestId,session.accessToken,request.quote.id,'accept').subscribe({next:()=>{this.busy=false;this.load()},error:e=>this.fail(e)})}
  chatWithSales(request:any){this.ordersService.openSalesChat(request.requestId)}
  load(){if(!this.access.session||this.busy)return;this.busy=true;this.lastAutoRefreshAt=Date.now();this.error='';this.access.history(1,{pageSize:500,scope:'all'}).subscribe({next:r=>{this.allOrders=r.orders||[];this.allRequests=r.requests||[];this.statuses=r.statuses||[];this.counts=r.counts||{};this.busy=false;this.applyLocalView();this.cdr.markForCheck()},error:e=>{if(e?.status===401)this.end();this.fail(e)}})}
  private applyLocalView(){
    const keyword=this.normalize(this.search); const day=this.date;
    let orderRows=this.allOrders.filter(order=>this.activeTab==='all'||this.activeTab==='requests'?this.activeTab==='all':order.uiGroup===this.activeTab);
    let requestRows=(this.activeTab==='all'||this.activeTab==='requests')?[...this.allRequests]:[];
    if(this.status){orderRows=orderRows.filter(row=>String(row.TRANG_THAI||'')===this.status);requestRows=requestRows.filter(row=>String(row.status||'')===this.status)}
    if(keyword){orderRows=orderRows.filter(row=>this.normalize([row.DON_HANG_ID,row.TEN_NGUOI_DAT,row.TEN_NGUOI_NHAN,...(row.items||[]).map((i:any)=>i.TEN_SAN_PHAM_SNAPSHOT)].join(' ')).includes(keyword));requestRows=requestRows.filter(row=>this.normalize([row.requestId,row.orderId,...(row.items||[]).map((i:any)=>i.name)].join(' ')).includes(keyword))}
    if(day){const match=(value:any)=>{const d=new Date(value);return Number.isFinite(d.getTime())&&d.toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'})===day};orderRows=orderRows.filter(row=>match(row.NGAY_TAO)||match(row.NGAY_MUON_GIAO));requestRows=requestRows.filter(row=>String(row.delivery?.date||'').includes(day)||match(row.createdAt))}
    const combinedTotal=orderRows.length+requestRows.length;this.total=this.activeTab==='requests'?requestRows.length:this.activeTab==='all'?combinedTotal:orderRows.length;
    const start=(this.page-1)*this.pageSize;this.orders=orderRows.slice(start,start+this.pageSize);this.requests=requestRows.slice(start,start+this.pageSize);this.cdr.markForCheck();
  }
  private normalize(value:any){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().trim()}
  end(){this.access.logout();this.orders=[];this.requests=[];this.allOrders=[];this.allRequests=[];this.counts={};this.total=0;this.page=1;this.search='';this.status='';this.date='';this.phone='';this.lookupCode='';this.orderId='';this.requestId='';this.changePhone();this.cdr.markForCheck()}
  statusTone(value:unknown){const s=String(value||'').toLowerCase();if(/hủy|thất bại|từ chối/.test(s))return'danger';if(/hoàn thành|đã giao|thành công/.test(s))return'success';if(/đang giao|chờ giao|chuẩn bị/.test(s))return'shipping';if(/thanh toán|cọc/.test(s))return'payment';return'pending'}
  isCompleted(order:any){return order?.uiGroup==='completed'||/hoàn thành|đã giao|giao thành công/i.test(String(order?.TRANG_THAI||''))}
  itemCount(order:any){return(order.items||[]).reduce((sum:number,item:any)=>sum+Number(item.SO_LUONG||0),0)}
  private fail(e:any){this.busy=false;this.error=e?.error?.message||'Không thể thực hiện lúc này. Vui lòng thử lại.';this.cdr.markForCheck()}
}
