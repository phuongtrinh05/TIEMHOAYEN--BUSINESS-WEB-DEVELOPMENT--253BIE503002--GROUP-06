import {Component,OnInit,inject,signal,PLATFORM_ID} from '@angular/core';
import {CommonModule,isPlatformBrowser} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {HttpClient,HttpParams} from '@angular/common/http';
import {apiBaseUrl} from '../../../services/api-config';
@Component({selector:'app-lucky-wheel-admin',standalone:true,imports:[CommonModule,FormsModule,RouterLink],templateUrl:'./lucky-wheel.html',styleUrl:'./lucky-wheel.css'})
export class LuckyWheelAdmin implements OnInit{
  private http=inject(HttpClient);private browser=isPlatformBrowser(inject(PLATFORM_ID));private base=apiBaseUrl()+'/lucky/admin';
  data=signal<any>(null);error=signal('');notice=signal('');busy=signal(false);tab='programs';form:any=null;modalError=signal('');revoke:any=null;reason='';
  filters={customerId:'',orderId:'',prizeId:'',from:'',to:''};page=1;rewardPage=1;logPage=1;
  ngOnInit(){if(this.browser)this.load();}
  load(){this.error.set('');let params=new HttpParams().set('page',this.page).set('rewardPage',this.rewardPage).set('logPage',this.logPage);for(const[k,v]of Object.entries<string>(this.appliedFilters?JSON.parse(this.appliedFilters):{}))if(v)params=params.set(k,k==='from'?v+'T00:00:00+07:00':k==='to'?v+'T23:59:59.999+07:00':v);this.http.get<any>(this.base,{params}).subscribe({next:d=>this.data.set(d),error:e=>this.error.set(e.error?.message||'Không tải được vòng quay.')});}
  private appliedFilters = '';
  get hasFilters(){return Object.values(this.filters).some(v=>v.trim()!=='')||!!this.appliedFilters;}
  get filtersChanged(){return this.filterKey()!==this.appliedFilters;}
  private filterKey(){return Object.values(this.filters).some(v=>v.trim()!=='')?JSON.stringify(this.filters):'';}
  applyFilters(){if(this.filters.from&&this.filters.to&&this.filters.from>this.filters.to){this.error.set('Ngày kết thúc phải từ ngày bắt đầu trở đi.');return;}this.page=1;this.appliedFilters=this.filterKey();this.load();}
  clearFilters(){this.filters={customerId:'',orderId:'',prizeId:'',from:'',to:''};this.appliedFilters='';this.page=1;this.load();}
  edit(p?:any){this.form=structuredClone(p||this.data().defaults);this.form.startAt=this.localDate(this.form.startAt);this.form.endAt=this.localDate(this.form.endAt);this.modalError.set('');}
  localDate(value:any){const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
  save(){if(this.busy())return;if(!this.form.startAt||!this.form.endAt||!Number.isFinite(new Date(this.form.startAt).getTime())||!Number.isFinite(new Date(this.form.endAt).getTime())){this.modalError.set('Chọn thời gian bắt đầu và kết thúc hợp lệ.');return;}this.busy.set(true);this.modalError.set('');const body={...this.form,startAt:new Date(this.form.startAt).toISOString(),endAt:new Date(this.form.endAt).toISOString()};
    const req=this.form.id?this.http.put<any>(this.base+'/programs/'+encodeURIComponent(this.form.id),body):this.http.post<any>(this.base+'/programs',body);
    req.subscribe({next:()=>{this.busy.set(false);this.form=null;this.notice.set('Đã lưu chương trình và lịch sử cấu hình.');this.load();},error:e=>{this.busy.set(false);this.modalError.set(e.error?.message||'Không lưu được chương trình.');}});
  }
  revokeReward(){if(!this.revoke||this.busy())return;this.busy.set(true);this.modalError.set('');this.http.post<any>(this.base+'/rewards/'+encodeURIComponent(this.revoke.id)+'/revoke',{reason:this.reason}).subscribe({next:()=>{this.busy.set(false);this.revoke=null;this.notice.set('Đã thu hồi phần thưởng.');this.load();},error:e=>{this.busy.set(false);this.modalError.set(e.error?.message||'Không thu hồi được.');}});}
  get prizeOptions(){const options=new Map<string,string>();for(const p of this.data()?.programs||[])for(const prize of p.prizes||[])options.set(prize.id,prize.name);return [...options].map(([id,name])=>({id,name}));}
  pages(total:number,size=20){return Math.max(1,Math.ceil((total||0)/size));}
  get weight(){return (this.form?.prizes||[]).filter((p:any)=>p.active).reduce((n:number,p:any)=>n+Number(p.weight||0),0);}
  statusCount(state:string){return this.data()?.stats?.find((r:any)=>r._id===state)?.count||0;}
  get totalPages(){return Math.max(1,Math.ceil((this.data()?.total||0)/20));}
  get actualDiscount(){return this.data()?.stats?.find((r:any)=>r._id==='Đã dùng')?.discount||0;}
  next(delta:number){this.page+=delta;this.load();}
}
