import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { OrderService } from '../../../services/order.service';

@Component({
  selector: 'app-checkoutfail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './checkoutfail.html',
  styleUrl: './checkoutfail.css',
})
export class CheckoutfailComponent {
  private readonly createdOrderStorageKey = 'tiemHoaYenCreatedOrder';
  private readonly failedOrderStorageKey = 'tiemHoaYenFailedOrder';

  orderId = '';
  paymentId = '';
  transactionCode = '';
  errorMessage = '';
  isRetrying = false;

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    private route: ActivatedRoute,
    private router: Router,
    private orderService: OrderService,
  ) {
    this.loadFailedOrderInfo();
  }

  private loadFailedOrderInfo(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const stateOrderId = this.getStateOrderId();
    const queryOrderId = String(this.route.snapshot.queryParamMap.get('orderId') || '').trim();

    const failedInfo = this.readStorage(this.failedOrderStorageKey);
    const createdOrder = this.readStorage(this.createdOrderStorageKey);

    this.orderId = stateOrderId || queryOrderId ||
      String(failedInfo?.orderId || createdOrder?.orderId || createdOrder?.orderCode || '').trim();

    this.paymentId = String(failedInfo?.paymentId || createdOrder?.paymentId || '').trim();
    this.transactionCode = String(failedInfo?.transactionCode || createdOrder?.transactionCode || '').trim();
  }

  closePopup(): void {
    this.router.navigate(['/homepage']);
  }

  retryPayment(): void {
    this.errorMessage = '';

    if (!this.orderId) {
      this.errorMessage = 'Không tìm thấy mã đơn hàng để thanh toán lại.';
      return;
    }

    this.isRetrying = true;

    this.orderService.retryPayment(this.orderId).subscribe({
      next: (res) => {
        if (isPlatformBrowser(this.platformId)) {
          localStorage.setItem(this.createdOrderStorageKey, JSON.stringify(res));
          localStorage.removeItem(this.failedOrderStorageKey);
        }

        this.isRetrying = false;
        this.router.navigate(['/checkout']);
      },
      error: (err: any) => {
        console.error('Lỗi tạo lại mã thanh toán:', err);
        this.isRetrying = false;
        this.errorMessage = err?.error?.message || 'Không thể tạo lại mã thanh toán. Vui lòng thử lại.';
      },
    });
  }

  private getStateOrderId(): string {
    if (typeof history === 'undefined') {
      return '';
    }

    return String(history.state?.orderId || '').trim();
  }

  private readStorage(storageKey: string): any | null {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}
