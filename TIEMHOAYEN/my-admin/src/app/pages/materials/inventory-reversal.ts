import { Component, Input, Output, EventEmitter, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { InvDocument, InventoryApiService, inventoryErrorMessage } from '../../services/inventory-api.service';

@Component({
  selector: 'app-inventory-reversal', standalone: true, imports: [FormsModule, CommonModule],
  styleUrls: ['./inventory.css'],
  template: `
<div class="inv-backdrop"><section class="inv-modal" style="max-width:680px" role="dialog" aria-modal="true" [attr.aria-label]="mode === 'adjustment' ? 'Điều chỉnh tồn theo phiếu nhập' : 'Đảo phiếu ghi sai'">
  <div class="inv-modal-head"><h3>{{mode === 'adjustment' ? 'Điều chỉnh tồn' : 'Đảo phiếu'}} · {{documentId}}</h3><button class="inv-icon-btn" [disabled]="saving()" (click)="closed.emit()" aria-label="Đóng"><i class="bi bi-x-lg"></i></button></div>
  <div class="inv-modal-body">
    @if(mode === 'adjustment') {
      <p>Nhập chênh lệch sau kiểm đếm: số dương tăng tồn, số âm giảm tồn; để 0 nếu không đổi. Chỉ giảm phần khả dụng của nguồn này. Số thực nhận và lượng đã nhận trên PO được giữ nguyên.</p>
      <div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Nguyên vật liệu</th><th class="num">Khả dụng nguồn</th><th>Chênh lệch</th></tr></thead><tbody>
        @for(line of lines; track line.materialId) {<tr><td>{{line.materialId}} · {{line.name}}<div class="muted">{{line.unit}}</div></td><td class="num">{{line.available | number:'1.0-3'}}</td><td><input class="inv-input" style="min-width:100px" type="number" step="0.001" [(ngModel)]="line.quantity" [attr.aria-label]="'Chênh lệch ' + line.materialId"></td></tr>}
      </tbody></table></div>
    } @else {
      <p>{{reversalHint}}</p>
      @if(kind === 'imports' && reversalDeadline){<p class="muted">Có thể đảo đến: {{reversalDeadline | date:'dd/MM/yyyy HH:mm'}} (24 giờ từ lúc ghi nhận).</p>}
    }
    <label style="display:block">Lý do <span class="muted">(từ 5–1000 ký tự)</span><textarea class="inv-textarea" rows="3" minlength="5" maxlength="1000" [(ngModel)]="reason" aria-describedby="correction-reason-help" [attr.aria-invalid]="reason.length > 0 && reason.trim().length < 5" placeholder="Ví dụ: Kiểm đếm thực tế thừa 2 cành"></textarea></label>
    <div id="correction-reason-help" style="font-size:13px;margin-top:6px" [style.color]="reason.length > 0 && reason.trim().length < 5 ? '#b42318' : '#77808f'">@if(reason.length > 0 && reason.trim().length < 5){Lý do cần ít nhất 5 ký tự; hiện có {{reason.trim().length}} ký tự.}@else{Nhập lý do kiểm đếm hoặc sai sót để lưu lịch sử.}</div>
    <label style="display:flex;gap:8px;margin-top:16px"><input type="checkbox" [(ngModel)]="verified"> Tôi đã kiểm tra tồn thực tế; đây là sửa ghi nhận kho, không phải hủy đơn hoặc hoàn hàng.</label>
    @if(error()){<p class="inv-alert error" role="alert">{{error()}}</p>}
  </div>
  <div class="inv-modal-foot"><button class="inv-btn" [disabled]="saving()" (click)="closed.emit()">Hủy</button><button class="inv-btn primary" [disabled]="saving() || !verified || reason.trim().length < 5" (click)="submit()">{{saving() ? 'Đang xử lý…' : mode === 'adjustment' ? 'Ghi nhận điều chỉnh' : 'Xác nhận đảo phiếu'}}</button></div>
</section></div>`
})
export class InventoryReversalComponent {
  @Input({required:true}) kind!: 'imports' | 'exports';
  @Input({required:true}) documentId = '';
  @Input() mode: 'reverse' | 'adjustment' = 'reverse';
  reversalHint = 'Đảo toàn bộ biến động của phiếu và đối soát PO hoặc PX gốc nếu có. PN đã dùng, giữ hoặc điều chỉnh tồn cần lập điều chỉnh chênh lệch.';
  reversalDeadline: Date | null = null;
  @Input() set document(doc: InvDocument) {
    const postedAt = new Date(doc.NGAY_XAC_NHAN || '').getTime();
    this.reversalDeadline = Number.isFinite(postedAt) ? new Date(postedAt + 86400000) : null;
    if (doc.LOAI_XUAT === 'Làm hoa theo đơn') this.reversalHint = 'Đảo PX sẽ phục hồi NVL, khôi phục phần giữ còn hợp lệ và cho phép lập PX thay thế. Chỉ áp dụng khi đơn còn chờ xử lý/chuẩn bị; không tự hoàn cho đơn đã giao hoặc hủy.';
    else if (doc.LOAI_XUAT === 'Cắm bó sẵn') this.reversalHint = 'Đảo PX sẽ trừ lại số bó thành phẩm đã ghi tăng và phục hồi NVL. Chỉ thực hiện khi đã kiểm tra thực tế và còn đủ thành phẩm khả dụng.';
    this.lines = doc.details.map(d => ({materialId: d.NGUYEN_VAT_LIEU_ID, name: d.TEN_NGUYEN_VAT_LIEU || '', unit: d.DON_VI_TINH || '',
      available: Number(d.SL_CON_LAI || 0) - Number(d.SL_HONG || 0) - Number(d.SL_DANG_GIU || 0), quantity: 0}));
  }
  @Output() closed = new EventEmitter<void>();
  @Output() done = new EventEmitter<void>();
  private api = inject(InventoryApiService);
  private requestId = crypto.randomUUID();
  lines: Array<{materialId: string; name: string; unit: string; available: number; quantity: number | null}> = [];
  reason = ''; verified = false; saving = signal(false); error = signal('');
  submit(): void {
    if (this.saving()) return;
    if (this.reason.trim().length < 5 || this.reason.trim().length > 1000) { this.error.set('Nhập lý do từ 5–1000 ký tự.'); return; }
    if (!this.verified) { this.error.set('Tích xác nhận đã kiểm tra tồn thực tế.'); return; }
    const details = this.lines.filter(l => Number(l.quantity) !== 0).map(l => ({materialId: l.materialId, quantity: Number(l.quantity)}));
    if (this.mode === 'adjustment' && !details.length) { this.error.set('Nhập ít nhất một chênh lệch khác 0.'); return; }
    this.saving.set(true); this.error.set('');
    const request = this.mode === 'adjustment'
      ? this.api.adjustImport(this.documentId, { reason: this.reason, physicallyVerified: this.verified, requestId: this.requestId, details })
      : this.api.reverseDocument(this.kind, this.documentId, this.reason);
    request.subscribe({ next: () => { this.saving.set(false); this.done.emit(); }, error: e => { this.saving.set(false); this.error.set(inventoryErrorMessage(e)); } });
  }
}
