import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminApiService } from '../../../services/admin-api.service';
import { CustomerServiceTabs } from '../customer-service-tabs/customer-service-tabs';

@Component({ selector:'app-after-sales', standalone:true, imports:[CommonModule,FormsModule,RouterLink,CustomerServiceTabs], templateUrl:'./after-sales.html', styleUrl:'./after-sales.css' })
export class AfterSales implements OnInit {
  private api=inject(AdminApiService); private route=inject(ActivatedRoute); private cdr=inject(ChangeDetectorRef);
  rows:any[]=[]; selected:any=null; loading=false; busy=false; error=''; search=''; status=''; type=''; issueType=''; total=0;
  summary:any={count:0,totalApproved:0,totalRefunded:0};
  reason=''; reasonCode=''; maxRefund=0; deviationReason=''; refundAmount=0; refundReference=''; transferred=false;
  statuses=['Đã gửi yêu cầu','Chờ tiếp nhận','Đang xem xét','Cần bổ sung thông tin','Chờ Admin duyệt','Chờ hoàn tiền','Đang thực hiện phương án','Hoàn tất','Đã từ chối'];
  issueTypes=[
    {value:'wrong_item',label:'Giao sai mẫu'}, {value:'damaged',label:'Hoa hư hỏng nghiêm trọng'},
    {value:'partial_damage',label:'Hoa hỏng một phần'}, {value:'missing_item',label:'Thiếu sản phẩm'}, {value:'missing_accessory',label:'Thiếu thiệp/phụ kiện'},
    {value:'wrong_address',label:'Giao sai địa chỉ do shop'}, {value:'overpayment',label:'Thanh toán dư'},
    {value:'other',label:'Vấn đề khác'},
  ];
  get isAdmin(){return String(localStorage.getItem('adminRole')||'').trim().toLowerCase()==='admin';}
  get activeCount(){return this.rows.filter(row=>row.active).length;}
  ngOnInit(){this.search=this.route.snapshot.queryParamMap.get('orderId')||this.route.snapshot.queryParamMap.get('requestId')||'';this.load();}
  load(){const selectedId=this.selected?.requestId;this.loading=true;this.error='';this.api.getAfterSales({search:this.search.trim(),status:this.status,type:this.type,issueType:this.issueType,limit:'50'}).subscribe({next:r=>{this.rows=r.requests||[];this.total=Number(r.total||0);this.summary=r.summary||{count:this.total,totalApproved:0,totalRefunded:0};this.loading=false;const requested=this.route.snapshot.queryParamMap.get('requestId')||selectedId;if(requested)this.select(this.rows.find((x:any)=>x.requestId===requested)||this.rows[0]);else if(this.search&&this.rows.length===1)this.select(this.rows[0]);else if(!this.rows.length)this.selected=null;this.cdr.markForCheck();},error:e=>this.fail(e)});}
  typeLabel(value:string){return value==='exchange'?'Đổi hoặc giao bổ sung':value==='return'?'Trả lại sản phẩm':value==='refund'?'Hoàn tiền':value||'Chưa xác định';}
  issueLabel(value:string,row?:any){if(row?.refundContext?.source)return 'Đơn hủy đã thu tiền';return this.issueTypes.find(x=>x.value===value)?.label||value||'Chưa phân loại';}
  resolutionGuidance(row:any){
    if(row?.refundContext?.source)return 'Hủy trước khi chuẩn bị: hoàn toàn bộ khoản shop đã thực thu; không cần duyệt lần hai.';
    if(row?.type==='return')return 'Trả hàng: CSKH duyệt phạm vi xử lý, xác nhận hàng thực nhận và tình trạng hàng trước khi Admin chuyển khoản hoàn.';
    if(row?.issueType==='missing_item')return 'Thiếu sản phẩm: ưu tiên giao bù. Nếu khách chọn hoàn tiền hoặc không thể giao bù, hoàn giá trị sản phẩm còn thiếu sau giảm giá.';
    if(row?.issueType==='missing_accessory')return 'Thiếu phụ kiện: ưu tiên giao bù; nếu không thực hiện được thì hoàn đúng giá trị phụ kiện.';
    if(row?.issueType==='partial_damage')return 'Hư hỏng một phần: thỏa thuận theo mức độ thực tế, tối thiểu 30% giá trị phần sản phẩm bị ảnh hưởng.';
    if(['damaged','wrong_item','wrong_address'].includes(row?.issueType))return 'Lỗi từ shop: đổi/giao lại hoặc hoàn 100% giá trị sản phẩm bị ảnh hưởng và phí giao hàng theo mức gợi ý.';
    if(row?.issueType==='overpayment')return 'Thanh toán dư: hoàn đúng phần tiền shop đã thu vượt tổng giá trị đơn.';
    return 'CSKH kiểm tra bằng chứng, xác định trách nhiệm và ghi rõ căn cứ trước khi duyệt phương án.';
  }
  select(row:any){this.selected=row;this.reason='';this.reasonCode='';this.deviationReason='';this.maxRefund=Number(row?.suggestion?.amount||row?.decision?.maxRefund||0);this.refundAmount=Number(row?.decision?.maxRefund||0);this.refundReference='';this.transferred=false;}
  act(action:string){const r=this.selected;if(!r||this.busy)return;this.busy=true;this.error='';this.api.changeAfterSales(r.requestId,{version:r.version,action,reason:this.reason|| (action==='claim'?'Tiếp nhận hồ sơ hậu mãi':''),reasonCode:this.reasonCode||(action==='reject'?'OTHER':''),maxRefund:Number(this.maxRefund),deviationReason:this.deviationReason,amount:Number(this.refundAmount),reference:this.refundReference,transferred:this.transferred}).subscribe({next:()=>{this.busy=false;this.load();},error:e=>this.fail(e)});}
  receiveReturn(){const r=this.selected;if(!r||this.busy)return;const items=(r.items||[]).map((x:any)=>({productId:x.productId,receivedQuantity:Number(x.receivedQuantity||0),sellableQuantity:Number(x.sellableQuantity||0)})).filter((x:any)=>x.receivedQuantity>0);if(!items.length||!this.reason.trim()){this.error='Nhập số lượng thực nhận và kết quả kiểm tra.';return;}this.busy=true;this.api.changeAfterSales(r.requestId,{version:r.version,action:'receive-return',reason:this.reason.trim(),items}).subscribe({next:()=>{this.busy=false;this.load();},error:e=>this.fail(e)});}
  openRefundCase(){const orderId=this.search.trim();if(!orderId||this.busy)return;this.busy=true;this.error='';this.api.openAfterSalesRefundCase(orderId).subscribe({next:r=>{this.busy=false;this.api.getAfterSales({search:String(r.requestId||orderId),limit:'50'}).subscribe({next:list=>{this.rows=list.requests||[];this.total=Number(list.total||0);this.select(this.rows[0]||null);this.cdr.markForCheck();},error:e=>this.fail(e)});},error:e=>this.fail(e)});}
  private fail(e:any){this.busy=false;this.loading=false;this.error=e?.error?.message||'Chưa tải hoặc xử lý được hồ sơ.';this.cdr.markForCheck();}
}
