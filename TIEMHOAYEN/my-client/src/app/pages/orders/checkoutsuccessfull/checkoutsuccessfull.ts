import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-checkoutsuccessfull',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './checkoutsuccessfull.html',
  styleUrl: './checkoutsuccessfull.css',
})
export class CheckoutsuccessfullComponent {
  private readonly completedOrderStorageKey = 'tiemHoaYenCompletedOrder';
  private readonly createdOrderStorageKey = 'tiemHoaYenCreatedOrder';

  orderId = '';

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    private route: ActivatedRoute,
    private router: Router,
  ) {
    this.orderId = this.resolveOrderId();
  }

  closePopup(): void {
    this.router.navigate(['/homepage']);
  }

  viewOrderDetail(): void {
    const orderId = this.orderId || this.resolveOrderId();

    if (!orderId) {
      alert('Không tìm thấy mã đơn hàng để xem chi tiết.');
      this.router.navigate(['/homepage']);
      return;
    }

    this.router.navigate(['/order-detail', orderId]);
  }

  private resolveOrderId(): string {
    const stateOrderId = this.getStateOrderId();
    const queryOrderId = String(this.route.snapshot.queryParamMap.get('orderId') || '').trim();

    if (stateOrderId) {
      return stateOrderId;
    }

    if (queryOrderId) {
      return queryOrderId;
    }

    if (!isPlatformBrowser(this.platformId)) {
      return '';
    }

    return this.getOrderIdFromStorage(this.completedOrderStorageKey) ||
      this.getOrderIdFromStorage(this.createdOrderStorageKey);
  }

  private getStateOrderId(): string {
    if (typeof history === 'undefined') {
      return '';
    }

    return String(history.state?.orderId || '').trim();
  }

  private getOrderIdFromStorage(storageKey: string): string {
    try {
      const raw = localStorage.getItem(storageKey);
      const data = raw ? JSON.parse(raw) : null;

      return String(data?.orderId || data?.orderCode || '').trim();
    } catch {
      return '';
    }
  }
}
