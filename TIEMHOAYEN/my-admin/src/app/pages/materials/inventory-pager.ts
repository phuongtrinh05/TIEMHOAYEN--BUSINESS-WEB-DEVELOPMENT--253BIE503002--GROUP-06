import { Component, computed, input, output } from '@angular/core';

@Component({
  selector: 'app-inventory-pager',
  standalone: true,
  template: `
    <nav class="pager" aria-label="Phân trang">
      <button type="button" class="nav-btn" [disabled]="page() <= 1" (click)="pageChange.emit(page() - 1)"><i class="bi bi-arrow-left" aria-hidden="true"></i> Trước</button>
      <div class="numbers">
        @for (n of numbers(); track $index) {
          @if (n === 0) { <span class="dots">…</span> }
          @else { <button type="button" [class.active]="n === page()" [attr.aria-current]="n === page() ? 'page' : null" [attr.aria-label]="'Trang ' + n" (click)="pageChange.emit(n)">{{ n }}</button> }
        }
      </div>
      <button type="button" class="nav-btn" [disabled]="page() >= totalPages()" (click)="pageChange.emit(page() + 1)">Sau <i class="bi bi-arrow-right" aria-hidden="true"></i></button>
    </nav>
  `,
  styles: [`
    :host { display: block; font-family: var(--font-body); }
    .pager { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; margin-top: 28px; }
    button, .dots { height: 36px; min-width: 36px; border: 1px solid #d9dee5; border-radius: 6px; background: white; color: #003c3c; font: inherit; font-size: 13px; padding: 0 8px; }
    button { cursor: pointer; } button:disabled { opacity: .45; cursor: default; }
    button:focus-visible { outline: 2px solid #731919; outline-offset: 2px; }
    button:hover:not(:disabled) { border-color: #731919; }
    .nav-btn { display: flex; align-items: center; justify-content: center; gap: 8px; min-width: 88px; justify-self: start; color: #111; box-shadow: 0 1px 4px rgb(0 0 0 / 8%); }
    .nav-btn:last-child { justify-self: end; }
    .numbers { display: flex; gap: 8px; align-items: center; justify-content: center; }
    .active { background: #ffd4d7; border-color: #ffd4d7; color: #731919; font-weight: 600; }
    .dots { display: grid; place-items: center; border-color: transparent; }
    @media(max-width:640px) { .pager { grid-template-columns: 1fr 1fr; } .numbers { grid-column: 1 / -1; grid-row: 1; flex-wrap: wrap; } }
  `],
})
export class InventoryPagerComponent {
  readonly count = input.required<number>();
  readonly page = input.required<number>();
  readonly pageChange = output<number>();
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.count() / 15)));
  readonly numbers = computed(() => {
    const total = this.totalPages(), page = this.page();
    const visible = total <= 7 ? Array.from({ length: total }, (_, i) => i + 1)
      : [...new Set([1, total, ...Array.from({ length: 5 }, (_, i) => Math.max(2, Math.min(page - 2, total - 5)) + i)])].sort((a, b) => a - b);
    const result: number[] = [];
    for (const n of visible) { if (result.length && n - result[result.length - 1] > 1) result.push(0); result.push(n); }
    return result;
  });
}
