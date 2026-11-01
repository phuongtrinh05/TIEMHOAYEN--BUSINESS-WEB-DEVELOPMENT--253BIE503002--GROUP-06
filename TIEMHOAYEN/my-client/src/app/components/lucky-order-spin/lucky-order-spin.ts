import {Component,Input,Output,EventEmitter,OnInit,inject,signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterLink} from '@angular/router';
import {timeout} from 'rxjs';
import {LuckyWheelService} from '../../services/lucky-wheel.service';
import {orderAccessSession} from '../../services/api-config';
import {LuckyWheel} from '../../pages/lucky-wheel/lucky-wheel';
@Component({selector:'app-lucky-order-spin',standalone:true,imports:[CommonModule,RouterLink,LuckyWheel],template:`
@if(spin();as s){<aside class="spin-earned"><i class="bi bi-stars"></i><div><strong>{{s.status==='Chưa quay'?'Đơn này đã nhận một lượt quay':'Lượt quay của đơn này: '+s.status}}</strong><p>Hạn lượt: {{s.expiresAt|date:'dd/MM/yyyy HH:mm'}}</p></div>@if(s.status==='Chưa quay'&&!s.paused){<button type="button" (click)="open()">Quay ngay <i class="bi bi-arrow-right"></i></button>}@else{<a routerLink="/lucky-wheel">Xem kho thưởng</a>}</aside>}
@if(error()){<aside class="spin-earned"><p>{{error()}}</p><button type="button" (click)="load(false)">Kiểm tra lượt quay</button></aside>}
@if(visible()){<div class="spin-overlay"><section class="spin-dialog" role="dialog" aria-modal="true" aria-label="Vòng quay cho đơn vừa thanh toán"><app-lucky-wheel [embedded]="true" [initialSpinId]="orderId" (deferred)="defer()" /><footer class="checkout-next"><button type="button" (click)="leave('order')"><i class="bi bi-receipt"></i> Xem đơn hàng</button><button type="button" (click)="leave('shopping')">Tiếp tục mua sắm <i class="bi bi-arrow-right"></i></button></footer></section></div>}
`,styles:[`
.spin-earned{display:flex;align-items:center;gap:14px;padding:18px 20px;border:1px solid #e7cec3;background:#fff6eb;border-radius:12px;color:#731919;margin:20px 0}.spin-earned>i{font-size:26px}.spin-earned strong{font-size:14px}.spin-earned p{font-size:12px;color:#927567;margin:6px 0 0}.spin-earned a,.spin-earned button{margin-left:auto;color:#731919;font-size:13px;text-decoration:none;white-space:nowrap}.spin-earned button{border:1px solid #731919;border-radius:8px;background:white;padding:10px 14px;cursor:pointer}.spin-overlay{position:fixed;inset:0;background:#25161580;z-index:100010;display:grid;place-items:center;padding:20px}.spin-dialog{display:flex;flex-direction:column;width:min(820px,100%);max-height:92dvh;overflow:hidden;border-radius:18px;background:#fffdf9;box-shadow:0 20px 70px #0003}.spin-dialog app-lucky-wheel{display:block;min-height:0;overflow:auto}.checkout-next{display:flex;justify-content:flex-end;gap:12px;padding:16px 28px;background:#fffdf9;border-top:1px solid #eddfd7;flex-shrink:0}.checkout-next button{padding:11px 16px;border:1px solid #dcc9c1;border-radius:8px;background:white;color:#731919;font:inherit;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px}.checkout-next button:last-child{background:#fcf0eb;color:#731919;border-color:#e5c9bd}.checkout-next button:hover{background:#f8e8df}.checkout-next button:focus-visible{outline:2px solid #731919;outline-offset:3px}@media(max-width:600px){.spin-earned{flex-wrap:wrap}.spin-earned a,.spin-earned button{margin-left:40px}.spin-overlay{padding:12px}.spin-dialog{max-height:94dvh}.checkout-next{padding:13px 16px;gap:8px}.checkout-next button{flex:1;justify-content:center;padding:10px 8px;font-size:12px}}
`]})
export class LuckyOrderSpin implements OnInit{
  @Input() orderId='';
  @Output() opened=new EventEmitter<void>();
  @Output() checked=new EventEmitter<void>();
  @Output() viewOrder=new EventEmitter<void>();
  @Output() shopping=new EventEmitter<void>();
  spin=signal<any>(null);visible=signal(false);error=signal('');private api=inject(LuckyWheelService);
  ngOnInit(){if(orderAccessSession()?.authType==='member')this.load(true);else this.checked.emit();}
  load(auto=false){this.error.set('');this.api.wallet().pipe(timeout(15000)).subscribe({next:d=>{
    const spin=d.spins.find((s:any)=>s.orderId===this.orderId)||null;this.spin.set(spin);
    let postponed=false;try{postponed=sessionStorage.getItem('yenLuckyDeferred:'+this.orderId)==='1';}catch{}
    if(auto&&spin?.status==='Chưa quay'&&!spin.paused&&!postponed)this.open();
    this.checked.emit();
  },error:()=>{this.error.set('Chưa kiểm tra được lượt quay. Bạn có thể kiểm tra lại mà không cần rời trang.');this.checked.emit();}});}
  open(){this.visible.set(true);this.opened.emit();}
  leave(action:'order'|'shopping'){this.defer(false);if(action==='order')this.viewOrder.emit();else this.shopping.emit();}
  defer(refresh=true){this.visible.set(false);try{sessionStorage.setItem('yenLuckyDeferred:'+this.orderId,'1');}catch{}if(refresh)this.load(false);}
}
