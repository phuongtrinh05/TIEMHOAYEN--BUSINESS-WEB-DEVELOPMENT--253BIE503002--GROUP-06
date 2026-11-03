import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CompareMode } from '../../../services/analytics-api.service';

export interface RangeValue {
  from: string;
  to: string;
  compare: CompareMode;
}

/**
 * Bộ lọc dùng chung cho 3 trang: Từ ngày – Đến ngày (+ Áp dụng) và kỳ so sánh.
 * Trang cha giữ giá trị; component chỉ phát sự kiện khi người dùng bấm Áp dụng / đổi kỳ so sánh.
 */
@Component({
  selector: 'app-range-filter',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="rf" [class.rf-compact]="compact">
      <div class="rf-dates">
        <label>
          <span>Từ ngày</span>
          <input type="date" aria-label="Từ ngày" title="Từ ngày" [max]="to" [(ngModel)]="from" />
        </label>
        <span class="rf-sep">→</span>
        <label>
          <span>Đến ngày</span>
          <input type="date" aria-label="Đến ngày" title="Đến ngày" [min]="from" [(ngModel)]="to" />
        </label>
        <button class="rf-apply" type="button" (click)="apply()" [disabled]="busy">Áp dụng</button>
        @if (error) {
          <span class="rf-error">{{ error }}</span>
        }
      </div>
      @if (showCompare) {
        <div class="rf-seg" title="Kỳ dùng để so sánh">
          <button type="button" [class.active]="compare === 'previous'" (click)="setCompare('previous')">Kỳ liền trước</button>
          <button type="button" [class.active]="compare === 'lastYear'" (click)="setCompare('lastYear')">Cùng kỳ năm trước</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .rf { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
    .rf-dates { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: #7a6f6b; }
    input { height: 38px; box-sizing: border-box; border: 1px solid #ece6e3; border-radius: 8px; padding: 0 10px; font: inherit; font-size: 14px; color: #2b2321; background: #fff; min-width: 150px; }
    input:focus { outline: none; border-color: #731919; box-shadow: 0 0 0 3px rgba(115, 25, 25, .1); }
    .rf-sep { padding-bottom: 8px; color: #7a6f6b; }
    .rf-apply { height: 38px; box-sizing: border-box; background: #731919; color: #fff; border: 1px solid #731919; border-radius: 8px; padding: 0 14px; font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; }
    .rf-apply:disabled { opacity: .5; cursor: default; }
    .rf-error { color: #b42318; font-size: 13px; padding-bottom: 8px; }
    .rf-seg { display: inline-flex; height: 38px; box-sizing: border-box; border: 1px solid #ece6e3; border-radius: 8px; overflow: hidden; }
    .rf-seg button { height: 100%; border: 0; background: #fff; padding: 0 12px; font: inherit; font-size: 13px; cursor: pointer; color: #2b2321; }
    .rf-seg button + button { border-left: 1px solid #ece6e3; }
    .rf-seg button.active { background: #fbf6f3; color: #731919; font-weight: 700; }
    /* Bản gọn: nằm cùng hàng với thanh công cụ, cao bằng các nút (38px) */
    .rf-compact, .rf-compact .rf-dates { flex-wrap: nowrap; align-items: center; gap: 8px; }
    .rf-compact label span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .rf-compact input { height: 38px; padding: 0 8px; min-width: 0; width: 140px; font-size: 13px; border-color: #ebe4e0; border-radius: 9px; }
    .rf-compact .rf-sep { padding-bottom: 0; }
    .rf-compact .rf-apply { height: 38px; padding: 0 14px; font-size: 13px; border-radius: 9px; white-space: nowrap; }
    .rf-compact .rf-error { padding-bottom: 0; white-space: nowrap; }
    @media print { :host { display: none; } }
  `],
})
export class RangeFilter implements OnChanges {
  @Input() value!: RangeValue;
  @Input() busy = false;
  @Input() showCompare = true;
  /** Hiện gọn trên một hàng (không nhãn phía trên) để đặt trong thanh công cụ. */
  @Input() compact = false;
  @Output() changed = new EventEmitter<RangeValue>();

  from = '';
  to = '';
  compare: CompareMode = 'previous';
  error = '';

  ngOnChanges(): void {
    if (!this.value) return;
    this.from = this.value.from;
    this.to = this.value.to;
    this.compare = this.value.compare;
  }

  apply(): void {
    this.error = '';
    if (!this.from || !this.to) {
      this.error = 'Chọn đủ Từ ngày và Đến ngày.';
      return;
    }
    if (this.from > this.to) {
      this.error = 'Từ ngày phải trước hoặc bằng Đến ngày.';
      return;
    }
    if ((new Date(this.to).getTime() - new Date(this.from).getTime()) / 86_400_000 > 731) {
      this.error = 'Khoảng ngày tối đa 2 năm.';
      return;
    }
    this.changed.emit({ from: this.from, to: this.to, compare: this.compare });
  }

  setCompare(c: CompareMode): void {
    if (c === this.compare) return;
    this.compare = c;
    if (this.from && this.to && this.from <= this.to) this.changed.emit({ from: this.from, to: this.to, compare: c });
  }
}
