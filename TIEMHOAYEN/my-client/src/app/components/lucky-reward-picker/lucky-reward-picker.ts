import {Component,Input,Output,EventEmitter,OnInit,OnChanges,inject,signal,PLATFORM_ID} from '@angular/core';
import {CommonModule,isPlatformBrowser} from '@angular/common';
import {RouterLink} from '@angular/router';
import {LuckyWheelService} from '../../services/lucky-wheel.service';
import {orderAccessSession} from '../../services/api-config';
@Component({selector:'app-lucky-reward-picker',standalone:true,imports:[CommonModule,RouterLink],template:`
  @if(member && !headless){<section class="lucky-picker"><div class="heading"><i class="bi bi-ticket-perforated"></i><strong>Ưu đãi vòng quay</strong><button type="button" class="refresh" [disabled]="busy()" (click)="reload()" aria-label="Tải lại phần thưởng"><i class="bi bi-arrow-clockwise"></i></button><a routerLink="/lucky-wheel">Kho thưởng</a></div>
  <select aria-label="Chọn phần thưởng vòng quay" [disabled]="blocked||busy()" [value]="selectedId" (change)="choose($any($event.target).value)"><option value="">Không dùng phần thưởng</option>@for(r of rewards();track r.id){<option [value]="r.id">{{r.prize.name}} · {{r.code}}</option>}</select>
  @if(blocked){<p>Bỏ voucher khác trước khi chọn ưu đãi vòng quay.</p>}@else if(!rewards().length){<p>@if(waiting()>0){Có {{waiting()}} thưởng chờ kích hoạt. Đơn gốc phải Hoàn thành mới dùng được.}@else{Chưa có thưởng có thể dùng. Bạn có thể tải lại sau khi đơn gốc hoàn thành.}</p>}
  @if(error()){<p class="error" role="alert">{{error()}}</p>}@if(discount()>0){<p class="saving">Đã giảm {{discount()|number}}đ</p>}@if(giftName()){<p class="saving">Quà kèm: {{giftName()}}</p>}</section>}
  `,styles:[`:host{display:block}.lucky-picker{padding:16px;border:1px solid #eadbd5;border-radius:10px;background:#fffcf9;margin:16px 0}.heading{display:flex;align-items:center;gap:8px;color:#731919;font-size:13px;margin-bottom:12px}.heading .refresh{margin-left:auto;border:0;background:none;color:#731919;padding:3px;cursor:pointer}.heading a{margin-left:4px;font-size:12px;color:#967166}.lucky-picker select{width:100%;padding:10px;background:white;border:1px solid #ddcbc4;border-radius:7px;color:#493832;font:inherit;font-size:13px}.lucky-picker p{font-size:12px;color:#8c7970;margin:9px 0 0}.lucky-picker .error{color:#b03939}.lucky-picker .saving{color:#277247}`]})
export class LuckyRewardPicker implements OnInit,OnChanges{
  @Output() codeError=new EventEmitter<string>();
  @Input() subtotal=0;@Input() shippingFee=0;@Input() blocked=false;
  /** Ẩn khung riêng: ưu đãi vòng quay được chọn trong danh sách "Voucher có sẵn". */
  @Input() headless=false;
  @Output() rewardChange=new EventEmitter<{id:string;discount:number}|null>();
  private api=inject(LuckyWheelService);private browser=isPlatformBrowser(inject(PLATFORM_ID));
  waiting=signal(0);rewards=signal<any[]>([]);error=signal('');busy=signal(false);discount=signal(0);giftName=signal('');selectedId='';member=false;private version=0;
  ngOnInit(){if(!this.browser)return;this.member=orderAccessSession()?.authType==='member';if(this.member)this.reload();}
  reload(){this.api.wallet({availableOnly:true}).subscribe({next:d=>{this.waiting.set(d.waitingRewards||0);this.rewards.set(d.rewards.filter((r:any)=>r.status==='Có thể dùng'));},error:e=>this.error.set(e.error?.message||'Chưa tải được phần thưởng.')});}
  applyCode(code:string){
    if(!this.member){this.codeError.emit('Đăng nhập để dùng thưởng vòng quay.');return;}
    const version=++this.version;this.selectedId='';this.discount.set(0);this.giftName.set('');this.error.set('');this.codeError.emit('');this.rewardChange.emit(null);this.busy.set(true);
    this.api.previewCode(code,this.subtotal,this.shippingFee).subscribe({next:q=>{if(version!==this.version)return;this.busy.set(false);this.selectedId=q.rewardId;this.discount.set(q.discount);this.giftName.set(q.prize.kind==='gift'?q.prize.name:'');if(!this.rewards().some(r=>r.id===q.rewardId))this.rewards.update(rows=>[{id:q.rewardId,code:q.code,prize:q.prize},...rows]);this.rewardChange.emit({id:q.rewardId,discount:q.discount});},error:e=>{if(version!==this.version)return;this.busy.set(false);const message=e.error?.message||'Chưa áp dụng được thưởng vòng quay.';this.error.set(message);this.codeError.emit(message);}});
  }
  ngOnChanges(){if(this.blocked&&this.selectedId)this.choose('');else if(this.selectedId)this.choose(this.selectedId);}
  choose(id:string){const version=++this.version;this.selectedId=id;this.error.set('');this.codeError.emit('');this.discount.set(0);this.giftName.set('');this.rewardChange.emit(null);this.busy.set(false);if(!id)return;this.busy.set(true);
    this.api.preview(id,this.subtotal,this.shippingFee).subscribe({next:q=>{if(version!==this.version)return;this.busy.set(false);this.discount.set(q.discount);this.giftName.set(q.prize.kind==='gift'?q.prize.name:'');this.rewardChange.emit({id,discount:q.discount});},error:e=>{if(version!==this.version)return;this.busy.set(false);this.selectedId='';this.error.set(e.error?.message||'Phần thưởng chưa dùng được.');}});
  }
}
