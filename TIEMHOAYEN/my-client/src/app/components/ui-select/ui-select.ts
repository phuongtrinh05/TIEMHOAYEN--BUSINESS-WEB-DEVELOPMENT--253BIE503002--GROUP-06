import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener,
  Input, OnChanges, Output, SimpleChanges, forwardRef, inject,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface UiSelectOption {
  value: any;
  label: string;
  disabled?: boolean;
  /** Nhóm hiển thị (tiêu đề in nhỏ phía trên các lựa chọn cùng nhóm). */
  group?: string;
}

let nextId = 0;

/**
 * Dropdown dùng chung cho trang khách, cùng kiểu với ô chọn Tỉnh/Quận/Phường ở trang đặt hàng:
 * nút trắng bo góc, danh sách thả xuống nền trắng, bóng đổ, có thanh cuộn.
 * Dùng được với [(ngModel)] (kể cả required trong form) hoặc [value] + (valueChange).
 */
@Component({
  selector: 'app-ui-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiSelect), multi: true }],
  template: `
    <button type="button" class="ui-select" [id]="inputId || null"
      [class.has-value]="hasValue" [class.is-invalid]="invalid" [class.is-open]="open" [class.compact]="compact"
      [disabled]="isDisabled" [attr.aria-haspopup]="'listbox'" [attr.aria-expanded]="open"
      [attr.aria-label]="ariaLabel || null" [attr.aria-controls]="listId"
      (click)="toggle()" (keydown)="onKeydown($event)" (blur)="onTouched()">
      <span class="ui-select__label">{{ selectedLabel }}</span>
      <i class="bi bi-chevron-down ui-select__arrow" [class.rotated]="open" aria-hidden="true"></i>
    </button>
    @if (open) {
      <div class="ui-select__options" [class.drop-up]="dropUp" role="listbox" [id]="listId">
        @for (opt of options; track trackValue($index, opt); let i = $index) {
          @if (opt.group && (i === 0 || options[i - 1].group !== opt.group)) {
            <div class="ui-select__group" role="presentation">{{ opt.group }}</div>
          }
          <button type="button" class="ui-select__option" role="option" tabindex="-1"
            [class.active]="isSelected(opt)" [class.highlighted]="i === highlight"
            [disabled]="opt.disabled" [attr.aria-selected]="isSelected(opt)"
            (mouseenter)="highlight = i" (click)="choose(opt, $event)">{{ opt.label }}</button>
        } @empty {
          <div class="ui-select__empty">{{ emptyText }}</div>
        }
      </div>
    }
  `,
  styles: [`
    :host { position: relative; display: block; width: 100%; min-width: 0; }
    .ui-select {
      display: flex; align-items: center; justify-content: space-between; width: 100%; height: 42px;
      padding: 0 12px 0 14px; box-sizing: border-box; background: #fff; border: 1.5px solid #D9D9D9;
      border-radius: 8px; font-family: var(--font-body); font-size: 0.88rem; color: var(--text-color);
      text-align: left; cursor: pointer; transition: border-color .2s;
    }
    .ui-select.compact { height: 34px; padding: 0 10px 0 12px; font-size: 0.82rem; }
    .ui-select:hover:not(:disabled), .ui-select:focus-visible, .ui-select.is-open { border-color: var(--accent-color); outline: none; }
    .ui-select.is-invalid { border-color: var(--color-scarlet-red); }
    .ui-select:disabled { background: #f6f3ef; cursor: not-allowed; }
    .ui-select__label { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #999; }
    .ui-select.has-value .ui-select__label { color: var(--text-color); font-weight: 500; }
    .ui-select__arrow { flex-shrink: 0; margin-left: 8px; color: var(--primary-color); transition: transform .2s; }
    .ui-select__arrow.rotated { transform: rotate(180deg); }
    .ui-select__options {
      position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 1000; min-width: 100%;
      max-height: 240px; overflow-y: auto; overscroll-behavior: contain; padding: 6px 0; box-sizing: border-box;
      border-radius: 12px; background: #fff; box-shadow: 0 8px 32px rgba(115, 25, 25, 0.14);
      scrollbar-width: thin; scrollbar-color: #c9a98a transparent;
    }
    .ui-select__options.drop-up { top: auto; bottom: calc(100% + 6px); }
    .ui-select__options::-webkit-scrollbar { width: 6px; }
    .ui-select__options::-webkit-scrollbar-thumb { background: #c9a98a; border-radius: 6px; }
    .ui-select__option {
      display: block; width: 100%; padding: 9px 16px; border: none; background: #fff; color: #1f1f1f;
      font-family: var(--font-body); font-size: 0.88rem; font-weight: 500; text-align: left; cursor: pointer;
    }
    .ui-select__option.highlighted, .ui-select__option.active { background: #f0e6d8; }
    .ui-select__option.active { color: var(--primary-color); font-weight: 700; }
    .ui-select__option:disabled { color: #b5aca4; background: #fff; cursor: not-allowed; }
    .ui-select__group { padding: 8px 16px 4px; font-size: 0.74rem; font-weight: 700; color: var(--primary-color); text-transform: uppercase; letter-spacing: .4px; }
    .ui-select__empty { padding: 9px 16px; font-size: 0.85rem; color: #999; }
  `],
})
export class UiSelect implements ControlValueAccessor, OnChanges {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly cdr = inject(ChangeDetectorRef);

  @Input() options: UiSelectOption[] = [];
  @Input() placeholder = 'Chọn';
  @Input() invalid = false;
  @Input() disabled = false;
  @Input() compact = false;
  @Input() ariaLabel = '';
  @Input() inputId = '';
  @Input() emptyText = 'Không có lựa chọn';
  /** Dùng khi không có ngModel. */
  @Input() value: any = null;
  @Output() valueChange = new EventEmitter<any>();

  open = false;
  dropUp = false;
  highlight = -1;
  readonly listId = `ui-select-list-${++nextId}`;
  private formDisabled = false;
  private onChange: (v: any) => void = () => {};
  onTouched: () => void = () => {};

  get isDisabled() { return this.disabled || this.formDisabled; }
  get selected() { return this.options.find(o => this.same(o.value, this.value)); }
  get hasValue() { return !!this.selected && this.value !== '' && this.value != null; }
  get selectedLabel() { return this.hasValue ? this.selected!.label : this.placeholder; }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['disabled'] && this.isDisabled) this.close();
  }

  writeValue(v: any): void { this.value = v; this.cdr.markForCheck(); }
  registerOnChange(fn: (v: any) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.formDisabled = d; if (d) this.close(); this.cdr.markForCheck(); }

  trackValue = (_: number, o: UiSelectOption) => `${o.group ?? ''}::${o.value}`;
  isSelected(o: UiSelectOption) { return this.same(o.value, this.value); }
  private same(a: any, b: any) { return a === b || (a != null && b != null && String(a) === String(b)); }

  toggle(): void { this.open ? this.close() : this.openList(); }

  private openList(): void {
    if (this.isDisabled) return;
    const rect = this.host.nativeElement.getBoundingClientRect();
    const below = (typeof window !== 'undefined' ? window.innerHeight : 1000) - rect.bottom;
    this.dropUp = below < 260 && rect.top > below;
    this.highlight = Math.max(0, this.options.findIndex(o => this.isSelected(o)));
    this.open = true;
    this.cdr.markForCheck();
    setTimeout(() => this.scrollToHighlight());
  }

  close(): void { if (this.open) { this.open = false; this.cdr.markForCheck(); } }

  choose(o: UiSelectOption, event?: Event): void {
    event?.stopPropagation();
    if (o.disabled) return;
    this.value = o.value;
    this.onChange(o.value);
    this.valueChange.emit(o.value);
    this.onTouched();
    this.close();
    this.host.nativeElement.querySelector('button.ui-select')?.focus();
  }

  onKeydown(e: KeyboardEvent): void {
    const keys = ['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Escape', 'Home', 'End'];
    if (!keys.includes(e.key)) { if (e.key === 'Tab') this.close(); return; }
    if (e.key === 'Escape') { this.close(); return; }
    e.preventDefault();
    if (!this.open) { this.openList(); return; }
    if (e.key === 'Enter' || e.key === ' ') { const o = this.options[this.highlight]; if (o) this.choose(o); return; }
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    let i = e.key === 'Home' ? 0 : e.key === 'End' ? this.options.length - 1 : this.highlight;
    for (let n = 0; n < this.options.length; n++) {
      if (step) i = (i + step + this.options.length) % this.options.length;
      if (!this.options[i]?.disabled) break;
      if (!step) i = Math.min(this.options.length - 1, i + 1);
    }
    this.highlight = i;
    this.cdr.markForCheck();
    setTimeout(() => this.scrollToHighlight());
  }

  private scrollToHighlight(): void {
    const el = this.host.nativeElement.querySelectorAll('.ui-select__option')[this.highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: Event): void {
    if (this.open && !this.host.nativeElement.contains(e.target as Node)) this.close();
  }
}
