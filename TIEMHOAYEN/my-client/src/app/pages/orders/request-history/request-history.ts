import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OrderAccessService } from '../../../services/order-access.service';
import { OrderService } from '../../../services/order.service';

@Component({ selector: 'app-request-history', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  template: `<main><a routerLink="/">Trang chủ</a><h1>Tra cứu đơn hàng và yêu cầu tư vấn</h1>
    @if (error) { <p class="error" role="alert">{{error}}</p> }
    @if (pendingRequestId && !access.session) { <section role="status"><strong>Shop đã nhận yêu cầu {{pendingRequestId}}.</strong><p>Yêu cầu chưa phải đơn đã xác nhận; bạn chưa cần thanh toán. Xác minh SĐT người đặt bên dưới để mở cuộc tư vấn với nhân viên.</p></section> }
    @if (!access.session) {
      <section><h2>Xác minh số điện thoại người đặt</h2><p>Nhập số điện thoại đã dùng khi đặt hoa. Xác nhận OTP trước khi xem đơn hoặc nội dung tư vấn.</p>
      <label>Số điện thoại người đặt<input type="tel" autocomplete="tel" [(ngModel)]="phone" [disabled]="!!challengeId" placeholder="Nhập số điện thoại đã đặt hoa"></label>
      @if (!challengeId) { <button (click)="sendOtp()" [disabled]="busy || !phone.trim()">{{busy ? 'Đang gửi…' : 'Gửi mã OTP'}}</button> }
      @else {
        <p role="status">{{notice}}</p><label>Mã OTP<input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" [(ngModel)]="code" (keyup.enter)="verify()" placeholder="6 chữ số"></label>
        <button (click)="verify()" [disabled]="busy || !validCode">Xác nhận và xem đơn</button>
        <button class="secondary" (click)="sendOtp()" [disabled]="busy || resendSeconds>0">{{resendSeconds>0 ? 'Gửi lại sau '+resendSeconds+' giây' : 'Gửi lại mã'}}</button>
        <button class="secondary" (click)="changePhone()" [disabled]="busy">Đổi số điện thoại</button>
      }</section>
    } @else {
      <div class="toolbar"><p>Đã xác minh: {{access.session?.phone}} · Phiên tra cứu có hạn 30 phút.</p><button class="secondary" (click)="end()">Kết thúc tra cứu / Đổi số</button><button (click)="load()" [disabled]="busy">Cập nhật</button></div>
      <h2>Yêu cầu tư vấn</h2>
      @for(r of requests; track r.requestId) { <section><strong>{{r.requestId}}</strong><span class="badge">{{r.status}}</span>@for(i of r.items; track i.productId) { <p>{{i.name}} × {{i.quantity}}</p> }<p>Giao dự kiến: {{r.delivery?.date}} · {{r.delivery?.time}}</p><button (click)="open(r)">Xem yêu cầu / Trao đổi với shop</button></section> }
      @if(!busy && !requests.length) { <p>Chưa có yêu cầu tư vấn cho số điện thoại này.</p> }
      <h2>Đơn hàng</h2>
      @for(o of orders; track o.DON_HANG_ID) { <section><strong>{{o.DON_HANG_ID}}</strong><span class="badge">{{o.TRANG_THAI}}</span><p>Ngày đặt: {{o.NGAY_TAO | date:'dd/MM/yyyy HH:mm'}} · Tổng: {{o.TONG_TIEN | number:'1.0-0'}}đ</p><a [routerLink]="['/order-detail',o.DON_HANG_ID]">Xem chi tiết đơn</a></section> }
      @if(!busy && !orders.length) { <p>Chưa có đơn hàng cho số điện thoại này.</p> }
      <div class="toolbar"><button (click)="page=page-1;load()" [disabled]="busy || page===1">Trước</button><span>Trang {{page}}</span><button (click)="page=page+1;load()" [disabled]="busy || page*20>=total">Sau</button></div>
    }
  </main>`,
  styles: [`main{max-width:960px;margin:24px auto;padding:24px;color:#304737}h1{font-size:29px}h2{font-size:21px}p{line-height:1.7}section{padding:24px;border:1px solid #d6dfd1;background:#fff;border-radius:14px;margin:18px 0}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.badge{display:inline-block;background:#e7efdf;color:#345739;padding:7px 12px;border-radius:20px;margin-left:12px}button{background:#426b4d;color:white;border:0;border-radius:8px;padding:11px 16px;margin:8px 12px 4px 0;cursor:pointer}button:disabled{opacity:.5;cursor:default}.secondary{background:#e4ebde;color:#35523c}label{display:block;margin:14px 0}input{display:block;box-sizing:border-box;width:100%;max-width:440px;padding:12px;border:1px solid #b9c8b1;border-radius:8px;margin:8px 0}.error{color:#a1332e}strong{overflow-wrap:anywhere}`] })
export class RequestHistory implements OnInit, OnDestroy {
  readonly access = inject(OrderAccessService); private service = inject(OrderService); private cdr = inject(ChangeDetectorRef);
  requests: any[] = []; orders: any[] = []; phone = ''; code = ''; challengeId = ''; error = ''; notice = ''; busy = false; resendAt = 0; now = Date.now(); page = 1; total = 0;
  private timer?: ReturnType<typeof setInterval>;
  pendingRequestId = '';
  get validCode() { return /^\d{6}$/.test(this.code); }
  get resendSeconds() { return Math.max(0, Math.ceil((this.resendAt-this.now)/1000)); }
  ngOnInit() {
    if(typeof window==='undefined') return;
    try {
      const pending = JSON.parse(sessionStorage.getItem('pendingSalesLookup') || 'null');
      if (/^YC[\da-f]+$/i.test(pending?.requestId || '') && /^0\d{9}$/.test(pending?.phone || '')) { this.pendingRequestId = pending.requestId; this.phone = pending.phone; }
    } catch {}
    if(location.hash) history.replaceState(null,'',location.pathname);
    if(this.access.session) this.load();
    this.timer=setInterval(()=>{this.now=Date.now(); if(!this.access.session) { this.orders=[]; this.requests=[]; } this.cdr.markForCheck();},1000);
  }
  ngOnDestroy() { if(this.timer) clearInterval(this.timer); }
  sendOtp() {
    if(this.busy || this.resendSeconds>0) return; this.busy=true;this.error='';
    this.access.requestOtp(this.phone).subscribe({next:r=>{this.challengeId=r.challengeId;this.code='';this.notice=r.message;this.resendAt=Date.now()+r.resendAfterSeconds*1000;this.busy=false;this.cdr.markForCheck();},error:e=>this.fail(e)});
  }
  verify() {
    if(this.busy || !this.validCode) return;this.busy=true;this.error='';
    this.access.verify(this.challengeId,this.code).subscribe({next:()=>{
      this.code='';this.challengeId='';this.busy=false;this.page=1;this.load();
      if (this.pendingRequestId) {
        const id = this.pendingRequestId;
        this.service.getSalesRequest(id, this.access.session!.accessToken).subscribe({next:()=>{
          sessionStorage.removeItem('pendingSalesLookup'); this.pendingRequestId=''; this.service.openSalesChat(id); this.cdr.markForCheck();
        },error:()=>{ this.error='Số vừa xác minh không có quyền mở yêu cầu này. Hãy dùng SĐT người đặt đã gửi yêu cầu.'; this.cdr.markForCheck(); }});
      }
    },error:e=>this.fail(e)});
  }
  load() {
    if(this.busy || !this.access.session) return; this.busy=true;this.error='';
    this.access.history(this.page).subscribe({next:r=>{this.requests=r.requests;this.orders=r.orders;this.total=Math.max(r.totalOrders,r.totalRequests);this.busy=false;this.cdr.markForCheck();},error:e=>{if(e.status===401)this.end();this.fail(e);}});
  }
  open(r:any) { this.service.openSalesChat(r.requestId); }
  changePhone() { this.challengeId='';this.code='';this.error=''; }
  end() { this.access.logout();this.orders=[];this.requests=[];this.service.closeSalesChat();this.changePhone();this.cdr.markForCheck(); }
  private fail(e:any) { this.busy=false;this.error=e?.error?.message || 'Chưa thực hiện được. Vui lòng thử lại.';this.cdr.markForCheck(); }
}
