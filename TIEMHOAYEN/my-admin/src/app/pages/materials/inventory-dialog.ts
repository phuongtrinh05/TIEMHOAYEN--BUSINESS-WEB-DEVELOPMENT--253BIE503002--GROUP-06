import { Component, ElementRef, OnDestroy, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

/** Native dialog gives keyboard focus trapping; content follows the inventory design. */
@Component({
  selector: 'app-inventory-dialog', standalone: true, imports: [FormsModule],
  styleUrls: ['./inventory.css'],
  styles: [`.inv-dialog:not([open]) { display: none; }
    .inv-dialog { border: 0; padding: 0; margin: auto; width: min(460px, calc(100vw - 32px)); }
    .inv-dialog::backdrop { background: rgba(17,24,39,.42); }
    .inv-dialog p { margin: 0; white-space: pre-line; }
    .inv-dialog textarea { margin-top: 12px; }`],
  template: `
<dialog #dialog class="inv-modal inv-dialog" aria-labelledby="inventory-dialog-title" aria-describedby="inventory-dialog-description" (cancel)="$event.preventDefault(); finish(null)" (close)="onClose()">
  <form (ngSubmit)="accept()">
    <div class="inv-modal-head"><h3 id="inventory-dialog-title">{{state()?.title}}</h3><button type="button" class="inv-icon-btn" aria-label="Đóng" (click)="finish(null)"><i class="bi bi-x-lg"></i></button></div>
    <div class="inv-modal-body"><p id="inventory-dialog-description">{{state()?.message}}</p>
      @if(state()?.prompt) {
        @if(state()?.type === 'textarea') {<textarea class="inv-textarea" rows="3" maxlength="1000" [attr.aria-label]="state()?.message" [(ngModel)]="value" name="value"></textarea>}
        @else {<input class="inv-input" style="margin-top:12px" [type]="state()?.type || 'text'" [attr.aria-label]="state()?.message" [(ngModel)]="value" name="value" [attr.min]="state()?.min ?? null" [attr.max]="state()?.max ?? null" [required]="true">}
      }
    </div>
    <div class="inv-modal-foot"><button type="button" class="inv-btn" autofocus (click)="finish(null)">Quay lại</button><button type="submit" class="inv-btn primary">{{state()?.label}}</button></div>
  </form>
</dialog>`
})
export class InventoryDialogComponent implements OnDestroy {
  @ViewChild('dialog', {static: true}) private dialog!: ElementRef<HTMLDialogElement>;
  readonly state = signal<{message: string; title: string; label: string; prompt: boolean; type: string; min?: number; max?: number} | null>(null);
  value = '';
  private resolve?: (value: string | null) => void;

  async confirm(message: string, title = 'Xác nhận', label = 'Xác nhận'): Promise<boolean> {
    return (await this.open(message, title, label, false, '', {})) !== null;
  }
  prompt(message: string, defaultValue = '', options: {title?: string; label?: string; type?: 'textarea' | 'text' | 'number' | 'datetime-local'; min?: number; max?: number} = {}): Promise<string | null> {
    return this.open(message, options.title || 'Nhập thông tin', options.label || 'Xác nhận', true, defaultValue, options);
  }
  private open(message: string, title: string, label: string, prompt: boolean, defaultValue: string, options: {type?: string; min?: number; max?: number}): Promise<string | null> {
    if (this.resolve) return Promise.resolve(null);
    this.value = defaultValue;
    this.state.set({message, title, label, prompt, type: options.type || 'textarea', min: options.min, max: options.max});
    return new Promise(resolve => { this.resolve = resolve; this.dialog.nativeElement.showModal(); });
  }
  accept(): void {
    if (!this.dialog.nativeElement.querySelector('form')?.reportValidity()) return;
    this.finish(this.value);
  }
  finish(value: string | null): void {
    const resolve = this.resolve;
    this.resolve = undefined;
    if (this.dialog.nativeElement.open) this.dialog.nativeElement.close();
    this.state.set(null);
    resolve?.(value);
  }
  onClose(): void { if (!this.dialog.nativeElement.open) this.finish(null); }
  ngOnDestroy(): void { this.finish(null); }
}
