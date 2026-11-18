import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
  selector:'app-sales-request-result', standalone:true, imports:[CommonModule],
  template:`
  <div class="backdrop" role="presentation" (click)="close()">
    <section class="result" role="dialog" aria-modal="true" aria-labelledby="sales-result-title" (click)="$event.stopPropagation()">
      <button class="dialog-close" type="button" aria-label="Đóng" (click)="close()">×</button>
      <div class="success-head"><div class="mark"><i class="bi bi-check-lg" aria-hidden="true"></i></div><div><h2 id="sales-result-title">Đã gửi yêu cầu đến shop</h2><p>Shop sẽ kiểm tra và phản hồi sớm</p></div></div>
      <div class="divider"></div>
      <div class="product"><img [src]="primaryItem?.image || 'assets/images/logo-main.png'" [alt]="primaryItem?.name || 'Sản phẩm đặt hoa'"><div><h3>{{primaryItem?.name || 'Yêu cầu đặt hoa'}}</h3><div class="product-meta"><span><i class="bi bi-bag" aria-hidden="true"></i>{{primaryItem?.qty || primaryItem?.quantity || 1}} bó</span><span><i class="bi bi-calendar3" aria-hidden="true"></i>{{deliveryLabel}}</span></div></div></div>
      @if(items.length>1){<p class="more">Và {{items.length-1}} sản phẩm khác trong yêu cầu.</p>}
      <div class="next-step"><i class="bi bi-hourglass-split" aria-hidden="true"></i><div><strong>Bước tiếp theo</strong><p>Chờ shop gửi phương án phù hợp. Bạn <b>chưa cần thanh toán</b> lúc này.</p></div></div>
      <div class="actions"><button class="primary" (click)="chat()"><i class="bi bi-chat-dots" aria-hidden="true"></i>Trao đổi với shop</button><button class="secondary" (click)="view()">Xem chi tiết</button></div>
    </section>
  </div>`,
  styles:[`
  .backdrop{position:fixed;inset:0;z-index:20000;display:grid;place-items:center;padding:clamp(88px,12vh,142px) 18px 18px;background:#24110f7a;backdrop-filter:blur(4px);font-family:'Nunito Sans',sans-serif}.result{position:relative;box-sizing:border-box;width:min(570px,100%);max-height:calc(100dvh - clamp(106px,14vh,160px));overflow:auto;background:#fff;border:1px solid #e5d4ca;border-radius:22px;padding:24px 26px 26px;box-shadow:0 26px 80px #32110f3d;color:#39211e}.dialog-close{position:absolute;z-index:2;top:14px;right:16px;display:grid;place-items:center;width:36px;height:36px;border:0;border-radius:50%;background:#f8efeb;color:#731919;font:500 25px/1 sans-serif;cursor:pointer}.dialog-close:hover{background:#731919;color:#fff}.success-head{display:flex;align-items:center;gap:13px;padding-right:40px}.mark{display:grid;place-items:center;flex:0 0 48px;height:48px;border-radius:50%;background:#f8ece8;color:#731919;font-size:23px}.success-head h2{font:700 24px 'Playfair Display',serif;color:#321616;margin:0 0 4px}.success-head p{margin:0;color:#7c6862;font-size:13px}.divider{height:1px;background:#eadfd9;margin:18px 0}.product{display:grid;grid-template-columns:88px 1fr;gap:16px;align-items:center;padding:12px;border:1px solid #f0e2dc;border-radius:15px;background:#fffaf8}.product img{width:88px;height:100px;object-fit:cover;border-radius:12px;background:#f5ece7}.product h3{font:700 19px 'Playfair Display',serif;margin:0 0 10px;color:#4e1d1d}.product-meta{display:grid;gap:7px;color:#78645e;font-size:13px}.product-meta span{display:flex;align-items:center;gap:7px}.product-meta i{width:16px;color:#9a554c}.more{margin:8px 3px 0;font-size:12px;color:#806a63}.next-step{display:flex;align-items:flex-start;gap:12px;margin:16px 0;padding:14px 15px;border-radius:13px;background:#fff6e5}.next-step>i{color:#9b5d22;font-size:20px}.next-step strong{font-size:14px}.next-step p{margin:4px 0 0;color:#604d47;font-size:13px;line-height:1.5}.actions{display:grid;grid-template-columns:1.15fr 1fr;gap:11px}.actions button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;border-radius:999px;padding:10px 16px;font:800 14px 'Nunito Sans';cursor:pointer}.primary{background:#731919;color:#fff;border:1px solid #731919}.secondary{background:#fff;color:#731919;border:1px solid #d9b382}.actions button:hover{transform:translateY(-1px);box-shadow:0 6px 14px #7319191f}@media(max-width:560px){.backdrop{padding:76px 0 0;align-items:end}.result{width:100%;max-height:calc(100dvh - 76px);border-radius:22px 22px 0 0;padding:20px 16px}.success-head h2{font-size:21px}.product{grid-template-columns:76px 1fr}.product img{width:76px;height:88px}.actions{grid-template-columns:1fr}.primary{order:0}.secondary{order:1}}
  `]
})
export class SalesRequestResultComponent{
  @Input() requestId=''; @Input() loading=false; @Input() message=''; @Input() items:any[]=[]; @Input() deliveryDate=''; @Input() deliveryTime='';
  @Output() openedChat=new EventEmitter<void>();
  @Output() closed=new EventEmitter<void>();
  private router=inject(Router);
  get primaryItem(){return this.items[0]||null}
  get deliveryLabel(){return this.deliveryDate||this.deliveryTime?`Giao mong muốn: ${this.deliveryDate||'chưa chốt'}${this.deliveryTime?' · '+this.deliveryTime:''}`:'Ngày giao theo yêu cầu'}
  view(){this.router.navigate(['/order-request',this.requestId])}
  chat(){this.openedChat.emit();this.router.navigate(['/order-request',this.requestId],{fragment:'trao-doi'})}
  close(){this.closed.emit()}
}
