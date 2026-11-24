import { ChangeDetectorRef, Component, HostBinding, Input, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { OrderAccessService } from '../../../services/order-access.service';
import { OrderService } from '../../../services/order.service';
import { Subscription, timeout } from 'rxjs';
import { requestStatusTone } from '../request-status-tone';
import { requestStage } from '../request-stage';
import { currentOrderAccountKey } from '../../../services/api-config';

type HistoryTab='all'|'shipping'|'completed'|'returns'|'cancelled'|'requests';

@Component({selector:'app-request-history',standalone:true,imports:[CommonModule,FormsModule,RouterLink],styleUrl:'../request-status-tone.css',template:`
<main class="page">
  @if(error){<div class="alert error" role="alert">{{error}}</div>}
  @if(pendingRequestId&&!access.session&&!hasAccount){<div class="alert"><b>Shop đã nhận yêu cầu {{pendingRequestId}}</b><br>Đây chưa phải đơn xác nhận và bạn chưa cần thanh toán.</div>}
  @if(!access.session){
    <section class="auth">
    @if(hasAccount){<div class="flower">✿</div><h2>Đăng nhập lại để xem đơn</h2><p>Đơn của thành viên chỉ hiển thị trong đúng tài khoản.</p><a class="primary link" routerLink="/login">Đăng nhập</a>}
    @else{<h2>Xác minh số điện thoại người đặt</h2><p>Khách vãng lai cần OTP hoặc liên kết riêng để bảo vệ lịch sử đặt hoa.</p><div class="auth-grid"><label>Mã đơn Guest (nếu có)<input [(ngModel)]="orderId" [disabled]="!!challengeId"></label><label>Số điện thoại<input type="tel" [(ngModel)]="phone" [disabled]="!!challengeId"></label></div>
      @if(!challengeId){<button class="primary" (click)="sendOtp()" [disabled]="busy||!phone.trim()">{{busy?'Đang gửi…':'Gửi mã OTP'}}</button>}
      @else{<p>{{notice}}</p><label>Mã OTP<input inputmode="numeric" maxlength="6" [(ngModel)]="code" (keyup.enter)="verify()"></label><button class="primary" (click)="verify()" [disabled]="busy||!validCode">Xác nhận</button><button class="ghost" (click)="sendOtp()" [disabled]="busy||resendSeconds>0">{{resendSeconds?'Gửi lại sau '+resendSeconds+' giây':'Gửi lại mã'}}</button><button class="ghost" (click)="changePhone()">Đổi số</button>}
    }</section>
  }@else{
    <header class="page-head">
      <div><h1>{{guestMode?'Đơn hàng đã tra cứu':'Đơn hàng của tôi'}}</h1><p>{{guestMode?'Các đơn hoa và yêu cầu đặt hàng theo số điện thoại bạn vừa xác minh.':'Theo dõi đơn hoa và các yêu cầu đặt hàng bạn đã gửi cho shop.'}}</p>@if(guestMode){<button type="button" class="end-lookup" (click)="end()"><i class="bi bi-box-arrow-right" aria-hidden="true"></i> Kết thúc tra cứu</button>}</div>
      <label class="search"><i class="bi bi-search" aria-hidden="true"></i><input [(ngModel)]="search" placeholder="Tìm mã đơn, mã yêu cầu hoặc tên hoa" aria-label="Tìm đơn hàng"></label>
    </header>
    <section class="summary" aria-label="Tóm tắt">
      <div><span><i class="bi bi-hourglass-split" aria-hidden="true"></i> Đơn đang xử lý</span><b>{{tabCount('shipping')}}</b></div>
      <div class="due"><span><i class="bi bi-wallet2" aria-hidden="true"></i> Còn phải thanh toán</span><b>{{totalRemaining|number:'1.0-0'}}đ</b><small>{{remainingOrders}} đơn chưa thanh toán đủ</small></div>
      <div><span><i class="bi bi-chat-heart" aria-hidden="true"></i> Yêu cầu đang tư vấn</span><b>{{tabCount('requests')}}</b></div>
    </section>
    <nav class="tabs" aria-label="Lọc đơn hàng">@for(tab of tabs;track tab.id){<button type="button" [class.active]="activeTab===tab.id" [attr.aria-current]="activeTab===tab.id?'page':null" (click)="selectTab(tab.id)"><span>{{tab.label}}</span><b>{{tabCount(tab.id)}}</b></button>}</nav>
    @if(busy){<div class="cards">@for(x of [1,2,3];track x){<div class="skeleton"></div>}</div>}
    @else if(activeTab==='requests'){<div class="cards">@for(r of filteredRequests;track r.requestId){<article class="card request" tabindex="0" (click)="open(r)" (keyup.enter)="open(r)">
      <div class="photo"><img [src]="r.items?.[0]?.image||'assets/images/logo-main.png'" alt=""></div>
      <div class="body"><div class="head"><b class="code">{{r.requestId}}</b><span class="request-status" [attr.data-tone]="requestStatusTone(r.status)">{{requestStatusLabel(r)}}</span></div><h3>{{r.items?.[0]?.name||'Yêu cầu đặt hoa'}} <small>× {{r.items?.[0]?.quantity||1}}</small></h3><p class="meta"><i class="bi bi-calendar3" aria-hidden="true"></i> Giao mong muốn <strong>{{r.delivery?.date||'Chưa chốt'}} · {{r.delivery?.time||'Chưa chốt'}}</strong></p>@if(r.quote){<em class="quote-note"><i class="bi bi-stars" aria-hidden="true"></i> Có phương án mới · {{r.quote.summary?.total|number:'1.0-0'}}đ</em>}</div>
      <div class="side request-actions"><button type="button" class="detail" (click)="$event.stopPropagation();open(r)">Xem chi tiết <i class="bi bi-arrow-right" aria-hidden="true"></i></button>@if(canCancelRequest(r)){<button type="button" class="cancel-request" (click)="$event.stopPropagation();cancelRequest(r)">Hủy yêu cầu</button>}</div>
    </article>}@empty{<ng-container *ngTemplateOutlet="empty"></ng-container>}</div>}
    @else{<div class="cards">
      @if(activeTab==='all'){@for(r of filteredRequests;track r.requestId){<article class="card request" tabindex="0" (click)="open(r)" (keyup.enter)="open(r)">
        <div class="photo"><img [src]="r.items?.[0]?.image||'assets/images/logo-main.png'" alt=""></div>
        <div class="body"><div class="head"><b class="code">{{r.requestId}}</b><span class="request-status" [attr.data-tone]="requestStatusTone(r.status)">{{requestStatusLabel(r)}}</span></div><h3>{{r.items?.[0]?.name||'Yêu cầu đặt hoa'}} <small>× {{r.items?.[0]?.quantity||1}}</small></h3><p class="meta"><i class="bi bi-calendar3" aria-hidden="true"></i> Giao mong muốn <strong>{{r.delivery?.date||'Chưa chốt'}} · {{r.delivery?.time||'Chưa chốt'}}</strong></p>@if(r.quote){<em class="quote-note"><i class="bi bi-stars" aria-hidden="true"></i> Phương án hiện tại · {{r.quote.summary?.total|number:'1.0-0'}}đ</em>}</div>
        <div class="side request-actions"><button type="button" class="detail" (click)="$event.stopPropagation();open(r)">Xem chi tiết <i class="bi bi-arrow-right" aria-hidden="true"></i></button>@if(canCancelRequest(r)){<button type="button" class="cancel-request" (click)="$event.stopPropagation();cancelRequest(r)">Hủy yêu cầu</button>}</div>
      </article>}}
      @for(o of filteredOrders;track o.DON_HANG_ID){<article class="card"><a class="cover" [routerLink]="['/order-detail',o.DON_HANG_ID]" [attr.aria-label]="'Xem đơn '+o.DON_HANG_ID"></a>
      <div class="photo"><img [src]="o.items?.[0]?.HINH_ANH_SNAPSHOT||'assets/images/logo-main.png'" alt=""></div>
      <div class="body"><div class="head"><b class="code">{{o.DON_HANG_ID}}</b><span class="order-status" [attr.data-tone]="orderTone(o)">{{o.TRANG_THAI}}</span></div><h3>{{o.items?.[0]?.TEN_SAN_PHAM_SNAPSHOT||'Đơn hoa Tiệm Hoa Yên'}} <small>× {{o.items?.[0]?.SO_LUONG||1}}</small></h3><p class="meta"><i class="bi bi-calendar3" aria-hidden="true"></i> Ngày giao <strong>{{o.NGAY_MUON_GIAO|date:'dd/MM/yyyy'}} · {{o.KHUNG_GIO_MUON_GIAO||'Chưa chốt'}}</strong></p>@if(o.YEU_CAU_DAT_HANG_ID){<a class="source-request" [routerLink]="['/order-request',o.YEU_CAU_DAT_HANG_ID]"><i class="bi bi-chat-dots" aria-hidden="true"></i> Từ yêu cầu đặt hàng · Xem trao đổi</a>}</div>
      <div class="side"><div class="money"><div class="money-total"><span>Tổng tiền</span><b>{{o.TONG_TIEN|number:'1.0-0'}}đ</b></div>@if(!isCompleted(o)){<dl><div><dt>Cọc</dt><dd>{{o.paymentSummary?.deposit|number:'1.0-0'}}đ</dd></div><div><dt>Đã thu</dt><dd>{{o.paymentSummary?.paid|number:'1.0-0'}}đ</dd></div><div class="due"><dt>Còn lại</dt><dd>{{o.paymentSummary?.remaining|number:'1.0-0'}}đ</dd></div></dl>}</div><a class="detail" [routerLink]="['/order-detail',o.DON_HANG_ID]">Xem chi tiết <i class="bi bi-arrow-right" aria-hidden="true"></i></a></div>
      @if(orderStep(o)>=0){<ol class="order-steps" [attr.aria-label]="'Tiến trình: '+steps[orderStep(o)]">@for(step of steps;track step;let i=$index){<li [class.done]="i<orderStep(o)" [class.current]="i===orderStep(o)"><span class="bar"></span><span class="label">{{step}}</span></li>}</ol>}
      @else{<p class="progress-note"><i class="bi bi-info-circle" aria-hidden="true"></i> {{progressNote(o)}}</p>}
    </article>}@empty{@if(activeTab!=='all'||!filteredRequests.length){<ng-container *ngTemplateOutlet="empty"></ng-container>}}</div>}
    <ng-template #empty><div class="empty"><div class="flower">❀</div><h2>Chưa có nội dung trong mục này</h2><p>Đơn hoặc yêu cầu mới sẽ xuất hiện tại đây.</p><a routerLink="/">Tiếp tục chọn hoa</a></div></ng-template>
    @if(total>20){<div class="pager"><button type="button" (click)="page=page-1;load()" [disabled]="page===1">← Trước</button><span>Trang {{page}}</span><button type="button" (click)="page=page+1;load()" [disabled]="page*20>=total">Sau →</button></div>}
  }
</main>`,styles:[`
:host(.embedded){min-height:0;background:transparent}
.end-lookup{display:inline-flex;align-items:center;gap:6px;margin-top:12px;padding:8px 16px;border:1px solid #d9b382;border-radius:999px;background:#fff;color:#731919;font:800 13px 'Nunito Sans',sans-serif;cursor:pointer}

:host{display:block;min-height:100vh;background:#fff8f5;color:#351919;font-family:'Nunito Sans',sans-serif}
.page{max-width:1120px;margin:auto;padding:32px 24px 64px}
/* Xác minh / cảnh báo (giữ như cũ) */
.alert,.auth{background:#fff;border:1px solid #ead5ca;border-radius:16px;padding:18px 20px;margin-bottom:20px;box-shadow:0 10px 30px #7319190b}
.alert{border-left:5px solid #d9b382}.error{color:#8f1717;border-left-color:#8f1717}
.auth{max-width:760px;margin:20px auto;text-align:center;padding:36px}.auth-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;text-align:left}
label{display:block;color:#653d37;font-weight:800}
input,select{box-sizing:border-box;width:100%;padding:12px 13px;border:1px solid #ddc7bb;border-radius:12px;background:#fff;font:inherit;margin-top:7px}
input:focus{outline:none;border-color:#b98a6f;box-shadow:0 0 0 3px #d9b38233}
.primary,.link{display:inline-block;background:#731919;color:#fff;border:0;border-radius:999px;padding:12px 22px;text-decoration:none;font-weight:900}
.ghost{background:#fff8f5;color:#731919;border:1px solid #d9b382;border-radius:999px;padding:10px 14px;margin-left:7px}

/* Tiêu đề + tìm kiếm */
.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:18px}
.page-head h1{margin:0;font:700 32px/1.2 'Playfair Display',serif;color:#731919}
.page-head p{margin:6px 0 0;color:#80635b;font-size:15px}
.search{position:relative;flex:0 1 380px;font-weight:400}
.search i{position:absolute;left:15px;top:50%;transform:translateY(-50%);color:#a07f74;font-size:15px}
.search input{margin:0;padding:11px 14px 11px 40px;border-radius:999px;font-size:14px}

/* Thanh tóm tắt */
.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:22px}
.summary>div{display:flex;flex-direction:column;gap:4px;padding:14px 18px;background:#fff;border:1px solid #ead5ca;border-radius:14px}
.summary span{display:flex;align-items:center;gap:7px;color:#80635b;font-size:13.5px;font-weight:700}
.summary span i{color:#a07f74}
.summary b{color:#48231f;font-size:24px;line-height:1.2}
.summary small{color:#9a8079;font-size:12px}
.summary .due{background:#fff6f2;border-color:#efc9bd}
.summary .due b{color:#a32f2f}

/* Tab gạch chân, cuộn ngang khi hẹp */
.tabs{display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid #ead5ca;overflow-x:auto;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tabs button{display:inline-flex;align-items:center;gap:7px;flex:none;margin-bottom:-1px;padding:11px 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:#7a5d56;font:inherit;font-size:14.5px;font-weight:700;cursor:pointer;white-space:nowrap}
.tabs button:hover{color:#731919}
.tabs b{min-width:22px;padding:1px 7px;border-radius:99px;background:#f3e6de;color:#7a5d56;font-size:12px;text-align:center}
.tabs .active{color:#731919;border-bottom-color:#731919}
.tabs .active b{background:#731919;color:#fff}

/* Thẻ đơn: ảnh | thông tin | tiền + hành động */
.cards{display:grid;gap:14px}
.card{position:relative;display:grid;grid-template-columns:96px minmax(0,1fr) 230px;align-items:center;gap:20px;padding:18px 20px;background:#fff;border:1px solid #ead5ca;border-radius:16px;box-shadow:0 6px 20px #7319190a;transition:border-color .18s,box-shadow .18s}
.card:hover{border-color:#d9b382;box-shadow:0 12px 30px #73191914}
.cover{position:absolute;inset:0;border-radius:inherit}
.photo{width:96px;height:96px;border-radius:12px;overflow:hidden;background:#f6ebe6}
.photo img{width:100%;height:100%;object-fit:cover}
.body{min-width:0}
.head{display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px}
.head .code{color:#9d6b5c;font-size:13px;letter-spacing:.03em}
.head span{font-size:12px;font-weight:500;border-radius:99px;padding:4px 10px;white-space:nowrap}
/* Mỗi nhóm trạng thái đơn một màu */
.head .order-status{background:#f1ece9;color:#5f5049}
.head .order-status[data-tone=pending]{background:#fff2c7;color:#805d00}
.head .order-status[data-tone=confirmed]{background:#e8eef8;color:#285b91}
.head .order-status[data-tone=preparing]{background:#efe6f7;color:#6a3d93}
.head .order-status[data-tone=shipping]{background:#dff2ef;color:#1d6a61}
.head .order-status[data-tone=success]{background:#e2f3e6;color:#26623a}
.head .order-status[data-tone=refund]{background:#fde9dc;color:#a1461b}
.head .order-status[data-tone=failed]{background:#fae2e2;color:#9d2424}
.head .order-status[data-tone=cancelled]{background:#eeeae7;color:#6b5f59}
.head span.request-cancelled{background:#a51f25;color:#fff;border:1px solid #8b171d}
.card h3{margin:8px 0 6px;font:700 19px/1.3 'Playfair Display',serif;color:#571717;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card h3 small{font:700 13px 'Nunito Sans',sans-serif;color:#8a746d}
.meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:0;color:#80635b;font-size:14px}
.meta i{color:#a07f74}.meta strong{color:#48231f}
.source-request{position:relative;z-index:2;display:inline-flex;align-items:center;gap:6px;margin-top:8px;color:#8a4a3e;font-size:12.5px;font-weight:800;text-decoration:none}
.source-request:hover{text-decoration:underline}
.side{position:relative;z-index:2;display:flex;flex-direction:column;align-items:stretch;gap:12px;padding-left:20px;border-left:1px dashed #ead5ca;pointer-events:none}
.side a,.side button{pointer-events:auto}
.money-total{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.money-total span{color:#8c7770;font-size:13px}
.money-total b{color:#731919;font-size:18px}
.money dl{display:grid;gap:3px;margin:6px 0 0}
.money dl div{display:flex;justify-content:space-between;gap:10px;font-size:13px}
.money dt{color:#8c7770}.money dd{margin:0;color:#48231f;font-weight:700}
.money .due dd{color:#a32f2f}
.detail{display:inline-flex;align-items:center;justify-content:center;gap:6px;color:#731919;background:#fff8f5;border:1px solid #d9b382;border-radius:99px;padding:9px 14px;text-decoration:none;font:inherit;font-size:14px;font-weight:800;white-space:nowrap;cursor:pointer}
.detail:hover{background:#731919;border-color:#731919;color:#fff}

/* Tiến trình đơn: 4 bước, trải hết chiều ngang thẻ */
.order-steps{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:2px 0 0;padding:14px 0 0;border-top:1px solid #f3e6df;list-style:none}
.order-steps li{display:flex;flex-direction:column;gap:6px;min-width:0}
.order-steps .bar{height:5px;border-radius:99px;background:#efe3dd}
.order-steps .label{color:#a5918a;font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.order-steps li.done .bar{background:#c98d86}
.order-steps li.done .label{color:#80635b}
.order-steps li.current .bar{background:#731919}
.order-steps li.current .label{color:#731919;font-weight:900}
.progress-note{grid-column:1/-1;display:flex;align-items:center;gap:7px;margin:0;padding-top:12px;border-top:1px solid #f3e6df;color:#8c7770;font-size:13px}

/* Thẻ yêu cầu */
.request{cursor:pointer}
.quote-note{display:inline-flex;align-items:center;gap:6px;margin-top:9px;padding:6px 11px;border-radius:10px;background:#f7e7ce;color:#731919;font-style:normal;font-size:13px;font-weight:800}
.request-actions{justify-content:center}
.confirm-proposal{background:#731919;color:#fff;border:1px solid #731919;border-radius:999px;padding:9px 14px;font:inherit;font-size:14px;font-weight:800;cursor:pointer}
.cancel-request{background:#fff;color:#9a2529;border:1px solid #e3b3b3;border-radius:999px;padding:8px 13px;font:inherit;font-size:13px;font-weight:800;white-space:nowrap;cursor:pointer}
.cancel-request:hover{background:#fff1f1}

/* Trống / tải / phân trang */
.empty{text-align:center;background:#fff;border:1px dashed #d9b382;border-radius:16px;padding:48px}
.empty h2{margin:6px 0;font-size:20px;color:#571717}.empty p{color:#80635b}
.flower{font-size:44px;color:#d9b382}.empty a{color:#731919;font-weight:900}
.skeleton{height:134px;border-radius:16px;background:linear-gradient(90deg,#f5eae5 25%,#fff 50%,#f5eae5 75%);background-size:200% 100%;animation:shine 1.3s infinite}
.pager{display:flex;justify-content:center;align-items:center;gap:15px;margin-top:24px;color:#80635b}
.pager button{padding:9px 16px;border:1px solid #d9b382;border-radius:99px;background:#fff;color:#731919;font:inherit;cursor:pointer}
@keyframes shine{to{background-position:-200% 0}}
button:disabled{opacity:.5;cursor:not-allowed}

@media(max-width:900px){
  .summary{grid-template-columns:1fr 1fr}.summary .due{grid-column:1/-1;order:-1}
  .page-head{flex-direction:column;align-items:stretch}.search{flex-basis:auto}
  .card{grid-template-columns:80px minmax(0,1fr)}
  .photo{width:80px;height:80px}
  .side{grid-column:1/-1;flex-direction:row;align-items:center;justify-content:space-between;padding:12px 0 0;border-left:0;border-top:1px dashed #ead5ca}
  .money{flex:1}.money dl{grid-template-columns:repeat(3,auto);justify-content:start;gap:4px 18px}
  .money dl div{flex-direction:column;gap:0}
  .money-total{justify-content:flex-start}
  .auth-grid{grid-template-columns:1fr}
}
@media(max-width:600px){
  .page{padding:20px 14px 40px}
  .page-head h1{font-size:26px}
  .summary b{font-size:20px}.summary>div{padding:12px 14px}
  .order-steps .label{font-size:11px}
  .card{grid-template-columns:64px minmax(0,1fr);gap:12px;padding:14px}
  .photo{width:64px;height:64px}
  .card h3{white-space:normal}
  .side{flex-direction:column;align-items:stretch}
  .detail{width:100%}
  .auth{padding:24px 15px}.ghost{margin:5px 2px}
}
`]})
export class RequestHistory implements OnInit,OnDestroy{
  /** Nhúng trong trang Tra cứu đơn của khách vãng lai: cùng giao diện với Đơn hàng của tôi. */
  @Input() guestMode = false;
  @HostBinding('class.embedded') get embedded() { return this.guestMode; }

 readonly access=inject(OrderAccessService);private service=inject(OrderService);private cdr=inject(ChangeDetectorRef);private route=inject(ActivatedRoute);private router=inject(Router);readonly tabs:{id:HistoryTab;label:string}[]=[{id:'all',label:'Tất cả'},{id:'shipping',label:'Chờ giao hàng'},{id:'completed',label:'Đã giao'},{id:'returns',label:'Đang hỗ trợ'},{id:'cancelled',label:'Đã hủy'},{id:'requests',label:'Yêu cầu đặt hàng'}];activeTab:HistoryTab='all';search='';pendingFilter='all';counts:any={};orderId='';requests:any[]=[];orders:any[]=[];phone='';code='';challengeId='';error='';notice='';busy=false;resendAt=0;now=Date.now();page=1;total=0;pendingRequestId='';private timer?:ReturnType<typeof setInterval>;private lastRefreshAt=0;private refreshing=false;
 private requestEvents?: Subscription;
 private historyLoad?: Subscription;
 private eventsToken = '';
 private refreshPending = false;
 get hasAccount(){return!!currentOrderAccountKey()}get validCode(){return/^\d{6}$/.test(this.code)}get resendSeconds(){return Math.max(0,Math.ceil((this.resendAt-this.now)/1000))}get filteredOrders(){const q=this.search.trim().toLocaleLowerCase('vi');return this.orders.filter(o=>this.activeTab==='all'||o.uiGroup===this.activeTab).filter(o=>!q||String(o.DON_HANG_ID).toLowerCase().includes(q)||o.items?.some((i:any)=>String(i.TEN_SAN_PHAM_SNAPSHOT||'').toLocaleLowerCase('vi').includes(q)))}get filteredRequests(){const q=this.search.trim().toLocaleLowerCase('vi');return this.requests.filter(r=>!q||String(r.requestId).toLowerCase().includes(q)||r.items?.some((i:any)=>String(i.name||'').toLocaleLowerCase('vi').includes(q)))}tabCount(id:HistoryTab){return Number(this.counts?.[id]||0)}
 readonly steps=['Đã đặt','Đang chuẩn bị','Đang giao','Hoàn tất'];
 /** Bước hiện tại trên thanh tiến trình; -1 = đơn hủy / hoàn tiền (không vẽ thanh). */
 orderStep(o:any){const t=String(o?.TRANG_THAI||'');if(/hủy|hoàn tiền|trả hàng|thất bại/i.test(t))return-1;if(/đã giao|hoàn thành/i.test(t))return 3;if(/đang giao/i.test(t))return 2;if(/chuẩn bị|chờ vận chuyển/i.test(t))return 1;return 0}
 /** Tổng còn phải trả: chỉ tính lại khi tải tab "Tất cả", để đổi tab không làm con số nhảy về 0. */
 totalRemaining=0;remainingOrders=0;
 private updateRemaining(){const unpaid=this.orders.filter(o=>this.orderStep(o)>=0&&Number(o.paymentSummary?.remaining||0)>0);this.totalRemaining=unpaid.reduce((sum,o)=>sum+Number(o.paymentSummary?.remaining||0),0);this.remainingOrders=unpaid.length}isCancelled(o:any){return/hủy/i.test(String(o.TRANG_THAI||''))}
  isPaymentFailed(o:any){return/thất bại/i.test(String(o.TRANG_THAI||''))}
  /** Ghi chú thay cho thanh tiến trình khi đơn không đi theo luồng giao thông thường. */
  progressNote(o:any){return this.isPaymentFailed(o)?'Thanh toán không thành công – đơn không được thực hiện':this.isCancelled(o)?'Đơn đã hủy':'Đơn đang được shop hỗ trợ hoàn tiền / đổi trả'}
 /** Nhóm màu cho nhãn trạng thái đơn. Thứ tự kiểm tra quan trọng: "Đã đặt hàng thành công" không phải "Giao thành công". */
 orderTone(o:any){const s=String(o?.TRANG_THAI||'').toLowerCase();
  if(/hủy/.test(s))return'cancelled';
  if(/thất bại|từ chối|hết hạn/.test(s))return'failed';
  if(/hoàn tiền|đổi trả|trả hàng/.test(s))return'refund';
  if(this.isCompleted(o)||/giao hàng thành công/.test(s))return'success';
  if(/đang giao|chờ giao|giao hàng/.test(s))return'shipping';
  if(/chuẩn bị/.test(s))return'preparing';
  if(/đặt hàng thành công|xác nhận/.test(s))return'confirmed';
  if(/chờ|thanh toán|cọc|xử lý/.test(s))return'pending';
  return'neutral'}isCompleted(o:any){return o?.uiGroup==='completed'||/hoàn thành|đã giao|giao thành công/i.test(String(o?.TRANG_THAI||''))}
 ngOnInit(){if(typeof window==='undefined')return;const tab=this.route.snapshot.queryParamMap.get('tab');if(tab==='requests')this.activeTab='requests';try{const p=JSON.parse(sessionStorage.getItem('pendingSalesLookup')||'null');if(/^YC[\da-f]+$/i.test(p?.requestId||'')&&/^0\d{9}$/.test(p?.phone||'')){this.pendingRequestId=p.requestId;this.phone=p.phone}}catch{}if(location.hash)history.replaceState(null,'',location.pathname+location.search);if(!this.access.session&&!this.hasAccount){const code=this.route.snapshot.queryParamMap.get('orderId')||this.pendingRequestId||'';this.router.navigate(['/order-list'],{replaceUrl:true,queryParams:code?{code}:{}});return;}if(this.access.session)this.load();
   this.timer = setInterval(() => {
     this.now = Date.now();
     this.syncRequestEvents();
     if (!this.access.session) { this.orders = []; this.requests = []; }
     else {
       if (!document.hidden && this.now - this.lastRefreshAt >= 15000) this.refreshPending = true;
       this.refreshIfReady();
     }
     this.cdr.markForCheck();
   }, 1000);
 }
 ngOnDestroy() {
   this.requestEvents?.unsubscribe();
   this.historyLoad?.unsubscribe();
   if (this.timer) clearInterval(this.timer);
 }
 private syncRequestEvents() {
   const token = this.access.session?.accessToken || '';
   if (token === this.eventsToken) return;
   this.requestEvents?.unsubscribe();
   this.eventsToken = token;
   this.refreshPending = false;
   if (token) this.requestEvents = this.access.watchRequests().subscribe(() => {
     this.refreshPending = true;
     this.refreshIfReady();
   });
 }
 private refreshIfReady() {
   if (!this.refreshPending || this.busy || this.refreshing) return;
   this.load(true);
 }
 // Nhãn và quyền thao tác lấy từ bảng chung request-stage.ts.
 canCancelRequest(r:any){return requestStage(r).canCancel}
  canConfirmRequest(r:any){return requestStage(r).awaitingConfirmation&&!!r?.quote?.id}
 requestStatusLabel(r:any){return requestStage(r).label}
 readonly requestStatusTone = requestStatusTone;
 selectTab(tab:HistoryTab){if(this.activeTab===tab)return;this.activeTab=tab;this.page=1;this.search='';this.load()}
 cancelRequest(r:any){if(this.busy||!this.canCancelRequest(r)||!this.access.session)return;this.busy=true;this.error='';this.service.updateSalesRequest(r.requestId,this.access.session.accessToken,{action:'cancel'}).subscribe({next:()=>{this.busy=false;this.load()},error:e=>this.fail(e)})}
  confirmRequest(r:any){if(this.busy||!this.canConfirmRequest(r)||!this.access.session)return;this.busy=true;this.error='';this.service.respondSalesRequest(r.requestId,this.access.session.accessToken,r.quote.id,'accept').subscribe({next:()=>{this.busy=false;this.load()},error:e=>this.fail(e)})}
 sendOtp(){if(this.busy||this.resendSeconds>0)return;this.busy=true;this.error='';this.access.requestOtp(this.phone,this.orderId.trim()||undefined).subscribe({next:r=>{this.challengeId=r.challengeId;this.code='';this.notice=r.message;this.resendAt=Date.now()+r.resendAfterSeconds*1000;this.busy=false;this.cdr.markForCheck()},error:e=>this.fail(e)})}verify(){if(this.busy||!this.validCode)return;this.busy=true;this.error='';this.access.verify(this.challengeId,this.code).subscribe({next:()=>{this.code='';this.challengeId='';this.busy=false;this.page=1;this.load();if(this.pendingRequestId){const id=this.pendingRequestId;this.service.getSalesRequest(id,this.access.session!.accessToken).subscribe({next:()=>{sessionStorage.removeItem('pendingSalesLookup');this.pendingRequestId='';this.service.openSalesChat(id);this.cdr.markForCheck()},error:()=>{this.error='Số vừa xác minh không có quyền mở yêu cầu này.';this.cdr.markForCheck()}})}},error:e=>this.fail(e)})}load(quiet = false) {
   const token = this.access.session?.accessToken;
   if (this.busy || (quiet && this.refreshing) || !token) return;
   this.syncRequestEvents();
   this.historyLoad?.unsubscribe();
   this.refreshPending = false;
   this.refreshing = quiet;
   this.busy = !quiet;
   this.lastRefreshAt = Date.now();
   if (!quiet) this.error = '';
   const requests = this.activeTab === 'requests';
   const all = this.activeTab === 'all';
   this.historyLoad = this.access.history(this.page, {
     pageSize: 20, scope: requests ? 'requests' : all ? 'all' : 'orders', group: requests || all ? '' : this.activeTab,
   }).pipe(timeout(20000)).subscribe({ // DB chậm thì báo lỗi sau 20 giây, không treo trang ở trạng thái đang tải
     next: result => {
       this.busy = false;
       this.refreshing = false;
       if (this.access.session?.accessToken !== token) return;
       this.requests = result.requests || [];
       this.orders = result.orders || [];
       this.counts = result.counts || {};
       if (all) this.updateRemaining();
       this.total = Number(requests ? result.totalRequests : all ? result.total : result.totalOrders) || 0;
       this.cdr.markForCheck();
     },
     error: error => {
       this.busy = false;
       this.refreshing = false;
       if (this.access.session?.accessToken !== token) return;
       if (error.status === 401) this.end();
       if (!quiet) this.fail(error?.name === 'TimeoutError' ? { error: { message: 'Máy chủ phản hồi chậm. Vui lòng tải lại trang.' } } : error);
       this.cdr.markForCheck();
     },
   });
 }
 open(r:any){void this.router.navigate(['/order-request',r.requestId])}changePhone(){this.challengeId='';this.code='';this.error=''}end(){this.access.logout();this.orders=[];this.requests=[];this.service.closeSalesChat();this.changePhone();this.cdr.markForCheck()}private fail(e:any){this.busy=false;this.refreshing=false;this.error=e?.error?.message||'Chưa thực hiện được. Vui lòng thử lại.';this.cdr.markForCheck()}
}
