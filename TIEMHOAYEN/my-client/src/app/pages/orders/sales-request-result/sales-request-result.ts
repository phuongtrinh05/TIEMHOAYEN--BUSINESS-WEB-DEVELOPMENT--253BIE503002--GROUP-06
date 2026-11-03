import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { OrderService } from '../../../services/order.service';

@Component({
  selector:'app-sales-request-result', standalone:true, imports:[CommonModule],
  template:`
  <div class="backdrop" role="presentation" (click)="close()">
    <section class="result" role="dialog" aria-modal="true" aria-labelledby="sales-result-title" (click)="$event.stopPropagation()">
      <button class="dialog-close" type="button" aria-label="Đóng" (click)="close()">×</button>
      <div class="success-head"><div class="mark">❀</div><div><h2 id="sales-result-title">Shop đã nhận yêu cầu của bạn</h2><p>Yêu cầu #{{requestId}} · Chờ nhân viên kiểm tra</p></div></div>
      <div class="divider"></div>
      <div class="product"><img [src]="primaryItem?.image || 'assets/images/logo-main.png'" alt=""><div><h3>{{primaryItem?.name || 'Yêu cầu đặt hoa'}}</h3><p>Số lượng: {{primaryItem?.qty || primaryItem?.quantity || 1}} bó · {{deliveryLabel}}</p><p>{{reasonText}}</p></div></div>
      @if(items.length>1){<p class="more">Và {{items.length-1}} sản phẩm khác trong yêu cầu.</p>}
      <div class="payment-note"><span>ⓘ</span><div><strong>Bạn chưa cần thanh toán</strong><p>Sales sẽ kiểm tra khả năng đáp ứng và gửi phương án để bạn xác nhận. Shop chưa giữ hàng và chưa cam kết lịch giao ở bước này.</p></div></div>
      <p class="tracking">Vui lòng theo dõi trạng thái trong mục <strong>Yêu cầu đặt hàng</strong>. Phương án mới và phản hồi của Sales sẽ được cập nhật tại đó.</p>
      <div class="actions"><button class="primary" (click)="chat()">Chat với Sales</button><button class="secondary" (click)="view()">Xem yêu cầu</button></div>
      <p class="privacy">Cuộc trao đổi được lưu theo đúng mã yêu cầu và chỉ người đã xác minh mới xem được.</p>
    </section>
  </div>`,
  styles:[`
  .backdrop{position:fixed;inset:0;z-index:20000;display:grid;place-items:center;padding:clamp(88px,12vh,142px) 18px 18px;background:#24110f7a;backdrop-filter:blur(4px);font-family:'Nunito Sans',sans-serif}.result{position:relative;box-sizing:border-box;width:min(640px,100%);max-height:calc(100dvh - clamp(106px,14vh,160px));overflow:auto;background:#fffdfb;border:1px solid #e5d4ca;border-radius:22px;padding:22px 24px;box-shadow:0 26px 80px #32110f3d;color:#39211e}.dialog-close{position:absolute;z-index:2;top:12px;right:14px;display:grid;place-items:center;width:34px;height:34px;border:0;border-radius:50%;background:#f8efeb;color:#731919;font:500 25px/1 sans-serif;cursor:pointer}.dialog-close:hover{background:#731919;color:#fff}.success-head{display:flex;align-items:center;gap:12px;padding-right:34px}.mark{display:grid;place-items:center;flex:0 0 46px;height:46px;border-radius:50%;background:#f3e8e3;color:#731919;font-size:24px}.success-head h2{font:700 24px 'Playfair Display',serif;color:#321616;margin:0 0 4px}.success-head p{margin:0;color:#7c6862;font-size:13px}.divider{height:1px;background:#eadfd9;margin:17px 0}.product{display:grid;grid-template-columns:92px 1fr;gap:15px;align-items:center}.product img{width:92px;height:112px;object-fit:cover;border-radius:14px;background:#f5ece7}.product h3{font:700 19px 'Playfair Display',serif;margin:0 0 6px;color:#4e1d1d}.product p{margin:4px 0;color:#78645e;line-height:1.45;font-size:14px}.more{font-size:12px;color:#806a63}.payment-note{display:flex;gap:10px;margin:18px 0 9px;padding:13px 14px;background:#fff7e6;border-left:4px solid #d9b382;border-radius:11px}.payment-note>span{color:#731919;font-size:18px}.payment-note strong{font-size:15px}.payment-note p{margin:4px 0 0;line-height:1.45;color:#604d47;font-size:13px}.tracking{margin:0 0 15px;padding:2px 4px;color:#725d56;line-height:1.45;font-size:13px}.tracking strong{color:#731919}.actions{display:grid;grid-template-columns:1fr 1fr;gap:11px}.actions button{border-radius:999px;padding:11px 16px;font:800 14px 'Nunito Sans';cursor:pointer}.primary{background:#731919;color:#fff;border:1px solid #731919}.secondary{background:#fff;color:#731919;border:1px solid #d9b382}.privacy{text-align:center;color:#8b7770;font-size:11px;margin:11px 0 0}@media(max-width:560px){.backdrop{padding:76px 0 0;align-items:end}.result{width:100%;max-height:calc(100dvh - 76px);border-radius:22px 22px 0 0;padding:18px 15px}.success-head h2{font-size:21px}.product{grid-template-columns:76px 1fr}.product img{width:76px;height:92px}.actions{grid-template-columns:1fr}.primary{order:0}.secondary{order:1}}
  `]
})
export class SalesRequestResultComponent{
  @Input() requestId=''; @Input() loading=false; @Input() message=''; @Input() items:any[]=[]; @Input() deliveryDate=''; @Input() deliveryTime='';
  @Output() openedChat=new EventEmitter<void>();
  @Output() closed=new EventEmitter<void>();
  private router=inject(Router);private orders=inject(OrderService);
  get primaryItem(){return this.items[0]||null}
  get deliveryLabel(){return this.deliveryDate||this.deliveryTime?`Giao mong muốn: ${this.deliveryDate||'chưa chốt'}${this.deliveryTime?' · '+this.deliveryTime:''}`:'Ngày giao theo yêu cầu'}
  get reasonText(){return this.message||'Shop cần kiểm tra nguyên liệu và lịch giao trước khi xác nhận.'}
  view(){this.router.navigate(['/order-request',this.requestId])}
  chat(){this.orders.openSalesChat(this.requestId);this.openedChat.emit()}
  close(){this.closed.emit()}
}
