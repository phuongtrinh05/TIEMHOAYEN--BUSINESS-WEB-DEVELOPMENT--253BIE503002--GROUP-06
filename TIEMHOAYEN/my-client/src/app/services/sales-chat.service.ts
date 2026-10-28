import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { orderAccessSession } from './api-config';
import { Router } from '@angular/router';

/** Opens the existing floating chat with a verified order-request context, including after refresh. */
@Injectable({ providedIn: 'root' })
export class SalesChatService {
  constructor(private router: Router) {}
  private readonly selected = new BehaviorSubject<string>(this.restore());
  readonly request$ = this.selected.asObservable();
  private restore(): string {
    try {
      if (!orderAccessSession()) { sessionStorage.removeItem('tiemHoaYenActiveSalesChat'); return ''; }
      return sessionStorage.getItem('tiemHoaYenActiveSalesChat') || '';
    } catch { return ''; }
  }
  open(requestId: string) {
    if (!orderAccessSession()) { this.assistant(); this.router.navigate(['/order-requests']); return; }
    try { sessionStorage.setItem('tiemHoaYenActiveSalesChat', requestId); } catch {}
    this.selected.next(requestId);
  }
  assistant() {
    try { sessionStorage.removeItem('tiemHoaYenActiveSalesChat'); } catch {}
    this.selected.next('');
  }
}
