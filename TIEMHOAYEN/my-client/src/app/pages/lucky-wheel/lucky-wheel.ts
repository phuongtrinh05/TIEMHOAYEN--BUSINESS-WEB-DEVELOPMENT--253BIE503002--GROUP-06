import {Component,OnInit,OnDestroy,Input,Output,EventEmitter,inject,signal,PLATFORM_ID} from '@angular/core';
import {CommonModule,isPlatformBrowser} from '@angular/common';
import {RouterLink,ActivatedRoute} from '@angular/router';
import {LuckyWheelService} from '../../services/lucky-wheel.service';
import {orderAccessSession} from '../../services/api-config';
@Component({selector:'app-lucky-wheel',standalone:true,imports:[CommonModule,RouterLink],templateUrl:'./lucky-wheel.html',styleUrl:'./lucky-wheel.css'})
export class LuckyWheel implements OnInit,OnDestroy{
  @Input() embedded=false;
  @Input() initialSpinId='';
  @Output() deferred=new EventEmitter<void>();
  private resultTimer:ReturnType<typeof setTimeout>|null=null;
  ngOnDestroy(){if(this.resultTimer)clearTimeout(this.resultTimer);}
  private route=inject(ActivatedRoute);
  private api=inject(LuckyWheelService);private browser=isPlatformBrowser(inject(PLATFORM_ID));
  data=signal<any>(null);error=signal('');busy=signal(false);loading=signal(false);result=signal<any>(null);tab=signal('wheel');rotation=signal(0);spinning=signal(false);
  member=false;selectedSpin='';historyPage=1;rewardPage=1;
  ngOnInit(){if(!this.browser)return;this.selectedSpin=this.initialSpinId||this.route.snapshot.queryParamMap.get('spin')||'';this.member=orderAccessSession()?.authType==='member';this.load();}
  load(clearError=true){if(this.loading())return;this.loading.set(true);if(clearError)this.error.set('');
    (this.member?this.api.wallet({rewardPage:this.rewardPage,historyPage:this.historyPage}):this.api.program()).subscribe({next:d=>{this.data.set(this.member?d:{program:d,spins:[],rewards:[],history:[]});if(!this.selectedSpin)this.selectedSpin=this.availableSpins[0]?.id||'';this.loading.set(false);},error:e=>{this.loading.set(false);this.error.set(e.error?.message||'Không tải được chương trình.');}});
  }
  get program(){return this.data()?.spins?.find((s:any)=>s.id===this.selectedSpin)?.program||this.data()?.program;}
  get availableSpins(){return (this.data()?.spins||[]).filter((s:any)=>s.status==='Chưa quay'&&!s.paused&&(!this.embedded||s.id===this.initialSpinId));}
  get pendingCount(){return (this.data()?.spins||[]).filter((s:any)=>s.status==='Chưa quay'&&(!this.embedded||s.id===this.initialSpinId)).length;}
  get prizes(){return this.program?.prizes||[];}
  get wheelBackground(){const colors=['#f3cfc7','#fff2df','#e5b7ad','#f9e5df','#f1d9b6','#dca69a','#fbf1e8'];return 'conic-gradient('+colors.map((c,i)=>`${c} ${i*360/7}deg ${(i+1)*360/7}deg`).join(',')+')';}
  spin(){if(this.busy()||!this.selectedSpin)return;this.busy.set(true);this.spinning.set(true);this.error.set('');
    this.api.spin(this.selectedSpin).subscribe({next:r=>{const index=this.prizes.findIndex((p:any)=>p.id===r.prize.id);const target=(360-(index+.5)*360/7+360)%360;const current=this.rotation();this.rotation.set(current+1800+((target-current%360+360)%360));this.resultTimer=setTimeout(()=>{this.result.set(r);this.spinning.set(false);this.busy.set(false);this.selectedSpin='';this.load();},4200);},error:e=>{this.busy.set(false);this.spinning.set(false);this.error.set(e.error?.message||'Chưa nhận được kết quả. Bấm tải lại để xem kết quả đã lưu.');this.load(false);}});
  }
  get rewards(){return this.data()?.rewards||[];}
  get history(){return this.data()?.history||[];}
  pages(total:number,size:number){return Math.max(1,Math.ceil((total||0)/size));}
  spinLabel(s:any){return `${s.orderId} · hạn ${new Date(s.expiresAt).toLocaleDateString('vi-VN')}`;}
}
