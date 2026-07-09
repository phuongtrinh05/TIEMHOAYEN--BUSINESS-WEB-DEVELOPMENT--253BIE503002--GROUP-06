import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  OrderPaymentStatusResponse,
  OrderService,
} from '../../../services/order.service';

interface CheckoutProduct {
  id: string;
  name: string;
  qty: number;
  price: number;
  image: string;
}

type CheckoutSource = 'registrant' | 'guest';

interface CheckoutOrderView {
  orderId: string;
  paymentId: string;
  transactionCode: string;
  paymentDeadline: string;
  customerId: string;
  source: CheckoutSource;
  receiver: {
    name: string;
    phone: string;
    address: string;
  };
  sender: {
    name: string;
    phone: string;
    email: string;
  };
  delivery: {
    date: string;
    time: string;
    message: string;
    noteShop: string;
  };
  products: CheckoutProduct[];
  payment: {
    method: string;
    methodName: string;
    amountToPay: number;
    bank: string;
    accountNumber: string;
    accountName: string;
    content: string;
  };
  summary: {
    subtotal: number;
    baseShippingFee: number;
    shippingVoucherDiscount: number;
    shipping: number;
    productVoucherDiscount: number;
    loyaltyDiscount: number;
    discount: number;
    depositAmount: number;
    remainingAmount: number;
    total: number;
  };
  voucher: any | null;
  flags: {
    hideSender: boolean;
    requestVAT: boolean;
    sendZaloPhoto: boolean;
  };
}

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './checkout.html',
  styleUrl: './checkout.css',
})
export class CheckoutComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly orderService = inject(OrderService);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly registrantOrderStorageKey = 'tiemHoaYenRegistrantOrder';
  private readonly guestOrderStorageKey = 'tiemHoaYenGuestOrder';
  private readonly createdOrderStorageKey = 'tiemHoaYenCreatedOrder';
  private readonly completedOrderStorageKey = 'tiemHoaYenCompletedOrder';
  private readonly failedOrderStorageKey = 'tiemHoaYenFailedOrder';
  private readonly guestCartStorageKey = 'tiemHoaYenCart';
  private readonly checkoutItemsStorageKey = 'tiemHoaYenCheckoutItems';

  order: CheckoutOrderView | null = null;

  paymentStatus = 'Chờ thanh toán';
  orderStatus = 'Chờ thanh toán';
  remainingSeconds = 300;

  isPaymentSuccess = false;
  isPaymentFailed = false;
  checkoutResultError = '';
  isRetryingPayment = false;

  private countdownTimerId: number | null = null;
  private pollingTimerId: number | null = null;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.loadCreatedOrder();

    if (this.order) {
      this.startCountdown();
      this.checkPaymentStatus();
      this.startPaymentPolling();
    }
  }

  ngOnDestroy(): void {
    this.stopTimers();
  }

  private loadCreatedOrder(): void {
    const createdOrder = this.readStorage(this.createdOrderStorageKey);
    const registrantOrder = this.readStorage(this.registrantOrderStorageKey);
    const guestOrder = this.readStorage(this.guestOrderStorageKey);

    if (!createdOrder) {
      console.warn('Không tìm thấy mã thanh toán. Vui lòng quay lại đặt hàng.');
      this.router.navigate(['/cart']);
      return;
    }

    const source = this.resolveCheckoutSource(createdOrder, registrantOrder, guestOrder);
    const storedOrder = source === 'guest' ? guestOrder : registrantOrder;

    if (!storedOrder) {
      console.warn('Không tìm thấy thông tin đơn hàng. Vui lòng quay lại đặt hàng.');
      this.router.navigate([source === 'guest' ? '/order-haunt' : '/order-registrant']);
      return;
    }

    try {
      this.order = this.mapStoredOrderToCheckout(storedOrder, createdOrder, source);
      this.paymentStatus = String(createdOrder?.paymentStatus || 'Chờ thanh toán');
      this.orderStatus = String(createdOrder?.orderStatus || 'Chờ thanh toán');
      this.remainingSeconds = this.calculateRemainingSeconds(this.order.paymentDeadline);

      this.cdr.detectChanges();
    } catch (error) {
      console.error('Lỗi đọc dữ liệu checkout:', error);
      console.warn('Dữ liệu đơn hàng không hợp lệ. Vui lòng đặt hàng lại.');
      this.router.navigate(['/cart']);
    }
  }

  private resolveCheckoutSource(
    createdOrder: any,
    registrantOrder: any,
    guestOrder: any
  ): CheckoutSource {
    const createdOrderType = String(createdOrder?.orderType || createdOrder?.source || '').toLowerCase();
    const registrantCustomerId = String(registrantOrder?.customerId || '').trim();
    const createdCustomerId = String(createdOrder?.customerId || createdOrder?.KHACH_HANG_ID || '').trim();

    if (createdOrderType === 'guest' || createdOrder?.isGuest === true) {
      return 'guest';
    }

    if (createdOrderType === 'registrant' || createdOrder?.isGuest === false) {
      return 'registrant';
    }

    if (guestOrder && !createdCustomerId && !registrantCustomerId) {
      return 'guest';
    }

    if (registrantOrder) {
      return 'registrant';
    }

    if (guestOrder) {
      return 'guest';
    }

    return 'registrant';
  }

  private mapStoredOrderToCheckout(
    storedOrder: any,
    createdOrder: any,
    source: CheckoutSource
  ): CheckoutOrderView {
    const customerId = source === 'guest'
      ? ''
      : String(storedOrder?.customerId || createdOrder?.customerId || '');

    const form = storedOrder?.form || {};
    const selectedAddress = storedOrder?.selectedAddress || {};

    const receiver = storedOrder?.receiver || {
      name:
        form?.receiverName ||
        form?.recipientName ||
        selectedAddress?.name ||
        form?.fullName ||
        '',
      phone:
        form?.receiverPhone ||
        form?.recipientPhone ||
        selectedAddress?.phone ||
        form?.phone ||
        '',
      address:
        storedOrder?.receiverAddress ||
        selectedAddress?.fullAddress ||
        this.buildFullAddressFromForm(form),
    };

    const sender = storedOrder?.sender || this.getSenderFromStoredOrder(storedOrder, form, source);

    const products = this.mapProducts(storedOrder);

    const subtotal = Number(
      storedOrder?.subtotal ??
      storedOrder?.summary?.subtotal ??
      this.calculateSubtotal(products)
    );

    const baseShippingFee = Number(
      storedOrder?.baseShippingFee ??
      storedOrder?.summary?.baseShippingFee ??
      storedOrder?.shippingFee ??
      storedOrder?.summary?.shipping ??
      0
    );

    const shippingVoucherDiscount = Number(
      storedOrder?.shippingVoucherDiscount ??
      storedOrder?.summary?.shippingVoucherDiscount ??
      0
    );

    const shipping = Number(
      storedOrder?.shippingFee ??
      storedOrder?.summary?.shipping ??
      Math.max(0, baseShippingFee - shippingVoucherDiscount)
    );

    const productVoucherDiscount = Number(
      storedOrder?.productVoucherDiscount ??
      storedOrder?.discount ??
      storedOrder?.summary?.productVoucherDiscount ??
      0
    );

    const loyaltyDiscount = Number(
      storedOrder?.loyaltyDiscount ??
      storedOrder?.summary?.loyaltyDiscount ??
      0
    );

    const total = Number(
      storedOrder?.total ??
      storedOrder?.summary?.total ??
      Math.max(0, subtotal + shipping - productVoucherDiscount - loyaltyDiscount)
    );

    const paymentMethod = String(
      storedOrder?.paymentMethod ||
      storedOrder?.payment?.method ||
      form?.paymentMethod ||
      'cod'
    );

    const paymentMethodName = String(
      storedOrder?.paymentMethodName ||
      storedOrder?.payment?.methodName ||
      this.getPaymentMethodName(paymentMethod)
    );

    const depositAmount = paymentMethod === 'cod'
      ? Number(storedOrder?.depositAmount ?? storedOrder?.summary?.depositAmount ?? 0)
      : 0;

    const remainingAmount = paymentMethod === 'cod'
      ? Math.max(0, Number(storedOrder?.remainingAmount ?? storedOrder?.summary?.remainingAmount ?? total - depositAmount))
      : 0;

    const paymentAmount = Number(
      createdOrder?.paymentAmount ??
      createdOrder?.amountToPay ??
      storedOrder?.amountToPay ??
      this.getAmountToPay(paymentMethod, total, depositAmount)
    );

    const orderId = String(
      createdOrder?.orderId ||
      createdOrder?.orderCode ||
      storedOrder?.orderId ||
      storedOrder?.orderCode ||
      ''
    );

    const transactionCode = String(
      createdOrder?.transactionCode ||
      storedOrder?.transactionCode ||
      ''
    );

    return {
      orderId,
      paymentId: String(createdOrder?.paymentId || storedOrder?.paymentId || ''),
      transactionCode,
      paymentDeadline: String(
        createdOrder?.paymentDeadline ||
        storedOrder?.paymentDeadline ||
        new Date(Date.now() + 300000).toISOString()
      ),
      customerId,
      source,
      receiver: {
        name: String(receiver?.name || ''),
        phone: this.formatPhone(String(receiver?.phone || '')),
        address: String(receiver?.address || ''),
      },
      sender: {
        name: String(sender?.name || ''),
        phone: this.formatPhone(String(sender?.phone || '')),
        email: String(sender?.email || ''),
      },
      delivery: {
        date: String(storedOrder?.delivery?.date || form?.deliveryDate || ''),
        time: String(storedOrder?.delivery?.time || form?.deliveryTime || ''),
        message: String(
          storedOrder?.delivery?.message ||
          form?.noteReceiver ||
          form?.message ||
          ''
        ),
        noteShop: String(
          storedOrder?.delivery?.noteShop ||
          form?.noteShop ||
          ''
        ),
      },
      products,
      payment: {
        method: paymentMethod,
        methodName: paymentMethodName,
        amountToPay: paymentAmount,
        bank: 'MB Bank',
        accountNumber: '1234 5678 9x',
        accountName: 'Tiệm Hoa Yên',
        content: transactionCode || `Thanh toán đơn ${orderId}`,
      },
      summary: {
        subtotal,
        baseShippingFee,
        shippingVoucherDiscount,
        shipping,
        productVoucherDiscount,
        loyaltyDiscount,
        discount: productVoucherDiscount + shippingVoucherDiscount + loyaltyDiscount,
        depositAmount,
        remainingAmount,
        total,
      },
      voucher: storedOrder?.voucher || null,
      flags: {
        hideSender: !!(storedOrder?.flags?.hideSender ?? form?.hideSender),
        requestVAT: !!(storedOrder?.flags?.requestVAT ?? form?.requestVAT),
        sendZaloPhoto: !!(storedOrder?.flags?.sendZaloPhoto ?? form?.sendZaloPhoto),
      },
    };
  }

  private getSenderFromStoredOrder(
    storedOrder: any,
    form: any,
    source: CheckoutSource
  ): { name: string; phone: string; email: string } {
    if (source === 'guest') {
      return {
        name: String(form?.senderName || storedOrder?.senderName || ''),
        phone: String(form?.senderPhone || storedOrder?.senderPhone || ''),
        email: String(form?.senderEmail || storedOrder?.senderEmail || ''),
      };
    }

    return this.getCurrentCustomerSender();
  }

  private mapProducts(storedOrder: any): CheckoutProduct[] {
    const items = Array.isArray(storedOrder?.items)
      ? storedOrder.items
      : Array.isArray(storedOrder?.products)
        ? storedOrder.products
        : Array.isArray(storedOrder?.orderItems)
          ? storedOrder.orderItems
          : [];

    return items.map((item: any) => ({
      id: String(item.id || item.SAN_PHAM_ID || ''),
      name: String(item.name || item.TEN_SAN_PHAM || ''),
      qty: Math.max(1, Number(item.qty ?? item.quantity ?? item.SO_LUONG ?? 1)),
      price: Number(item.price ?? item.GIA_KHUYEN_MAI ?? item.GIA ?? 0),
      image: String(item.image || item.HINH_ANH || 'assets/images/hoa.jpg'),
    }));
  }

  private buildFullAddressFromForm(form: any): string {
    const parts = [
      form?.address,
      form?.wardName,
      form?.districtName,
      form?.provinceName,
    ]
      .map((part) => String(part || '').trim())
      .filter(Boolean);

    return parts.join(', ');
  }

  private calculateSubtotal(products: CheckoutProduct[]): number {
    return products.reduce((sum, item) => sum + item.price * item.qty, 0);
  }

  private getCurrentCustomerSender(): { name: string; phone: string; email: string } {
    if (!isPlatformBrowser(this.platformId)) {
      return { name: '', phone: '', email: '' };
    }

    try {
      const rawCustomer = localStorage.getItem('khachHang');
      const customer = rawCustomer ? JSON.parse(rawCustomer) : null;

      return {
        name: customer?.TEN || customer?.HO_TEN || customer?.name || '',
        phone: customer?.SDT || customer?.phone || '',
        email: customer?.EMAIL || customer?.email || '',
      };
    } catch {
      return { name: '', phone: '', email: '' };
    }
  }

  private getPaymentMethodName(method: string): string {
    switch (method) {
      case 'cod':
        return 'Thanh toán khi nhận hàng (COD)';
      case 'momo':
        return 'Momo';
      case 'vnpay':
        return 'VNPay';
      case 'bank':
        return 'Chuyển khoản ngân hàng';
      case 'card':
        return 'Thẻ ngân hàng';
      default:
        return method;
    }
  }

  private getAmountToPay(method: string, total: number, depositAmount: number): number {
    if (method === 'cod') {
      return Math.max(0, depositAmount);
    }

    return Math.max(0, total);
  }

  private calculateRemainingSeconds(deadline: string): number {
    const deadlineTime = new Date(deadline).getTime();

    if (!Number.isFinite(deadlineTime)) {
      return 300;
    }

    return Math.max(0, Math.ceil((deadlineTime - Date.now()) / 1000));
  }

  private startCountdown(): void {
    this.stopCountdown();

    this.countdownTimerId = window.setInterval(() => {
      if (!this.order || this.isPaymentSuccess || this.isPaymentFailed) {
        return;
      }

      this.remainingSeconds = this.calculateRemainingSeconds(this.order.paymentDeadline);

      if (this.remainingSeconds <= 0) {
        this.cdr.detectChanges();
        this.handlePaymentExpired();
        return;
      }

      this.cdr.detectChanges();
    }, 1000);
  }

  private startPaymentPolling(): void {
    this.stopPolling();

    this.pollingTimerId = window.setInterval(() => {
      this.checkPaymentStatus();
    }, 5000);
  }

  private checkPaymentStatus(): void {
    if (!this.order?.orderId || this.isPaymentSuccess || this.isPaymentFailed) {
      return;
    }

    this.orderService.getPaymentStatus(this.order.orderId).subscribe({
      next: (res: OrderPaymentStatusResponse) => {
        this.applyPaymentStatus(res);
      },
      error: (err: unknown) => {
        console.error('Lỗi kiểm tra trạng thái thanh toán:', err);
      },
    });
  }

  private applyPaymentStatus(res: OrderPaymentStatusResponse): void {
    this.paymentStatus = String(res.paymentStatus || this.paymentStatus);
    this.orderStatus = String(res.orderStatus || this.orderStatus);
    this.remainingSeconds = Math.max(0, Number(res.remainingSeconds ?? this.remainingSeconds));

    if (this.isSuccessText(this.paymentStatus) || this.normalizeStatus(this.orderStatus) === 'processing') {
      this.handlePaymentSuccess();
      return;
    }

    if (this.isFailedText(this.paymentStatus) || this.normalizeStatus(this.orderStatus) === 'payment_failed') {
      this.handlePaymentFailed();
      return;
    }

    this.cdr.detectChanges();
  }

  private handlePaymentExpired(): void {
    if (!this.order?.orderId || this.isPaymentSuccess || this.isPaymentFailed) {
      return;
    }

    this.orderService.expirePayment(this.order.orderId).subscribe({
      next: (res: OrderPaymentStatusResponse) => {
        this.applyPaymentStatus(res);
      },
      error: (err: unknown) => {
        console.error('Lỗi cập nhật hết hạn thanh toán:', err);
        this.handlePaymentFailed();
      },
    });
  }

  private handlePaymentSuccess(): void {
    if (!this.order) {
      return;
    }

    this.isPaymentSuccess = true;
    this.isPaymentFailed = false;
    this.paymentStatus = 'Thành công';
    this.orderStatus = 'Chờ xử lý';
    this.stopTimers();

    this.saveCompletedOrderInfo();
    this.removeFailedOrderInfo();

    if (this.order.source === 'guest') {
      this.cleanGuestCartAfterSuccess();
      localStorage.removeItem(this.guestOrderStorageKey);
    } else {
      localStorage.removeItem(this.registrantOrderStorageKey);
    }

    localStorage.removeItem(this.createdOrderStorageKey);

    this.cdr.detectChanges();
  }

  private handlePaymentFailed(): void {
    if (!this.order) {
      return;
    }

    this.isPaymentFailed = true;
    this.isPaymentSuccess = false;
    this.paymentStatus = 'Thất bại';
    this.orderStatus = 'Thanh toán thất bại';
    this.remainingSeconds = 0;
    this.stopTimers();

    this.saveFailedOrderInfo();

    this.cdr.detectChanges();
  }

  closeCheckoutResultPopup(): void {
    this.router.navigate(['/homepage']);
  }

  continueShopping(): void {
    this.router.navigate(['/homepage']);
  }

  viewOrderDetail(): void {
    const orderId = String(this.order?.orderId || '').trim();

    if (!orderId) {
      console.warn('Không tìm thấy mã đơn hàng để xem chi tiết.');
      this.router.navigate(['/homepage']);
      return;
    }

    this.router.navigate(['/order-detail', orderId]);
  }

  retryPayment(): void {
    this.checkoutResultError = '';

    const orderId = String(this.order?.orderId || '').trim();

    if (!orderId) {
      this.checkoutResultError = 'Không tìm thấy mã đơn hàng để thanh toán lại.';
      return;
    }

    this.isRetryingPayment = true;

    this.orderService.retryPayment(orderId).subscribe({
      next: (res) => {
        localStorage.setItem(this.createdOrderStorageKey, JSON.stringify(res));
        localStorage.removeItem(this.failedOrderStorageKey);

        this.isRetryingPayment = false;
        this.isPaymentFailed = false;
        this.isPaymentSuccess = false;
        this.checkoutResultError = '';
        this.paymentStatus = 'Chờ thanh toán';
        this.orderStatus = 'Chờ thanh toán';
        this.remainingSeconds = 300;

        this.loadCreatedOrder();

        if (this.order) {
          this.startCountdown();
          this.checkPaymentStatus();
          this.startPaymentPolling();
        }

        this.cdr.detectChanges();
      },
      error: (err: any) => {
        console.error('Lỗi tạo lại mã thanh toán:', err);
        this.isRetryingPayment = false;
        this.checkoutResultError = err?.error?.message || 'Không thể tạo lại mã thanh toán. Vui lòng thử lại.';
        this.cdr.detectChanges();
      },
    });
  }

  private saveCompletedOrderInfo(): void {
    if (!this.order) {
      return;
    }

    localStorage.setItem(
      this.completedOrderStorageKey,
      JSON.stringify({
        orderId: this.order.orderId,
        paymentId: this.order.paymentId,
        transactionCode: this.order.transactionCode,
        orderType: this.order.source,
        completedAt: new Date().toISOString(),
      })
    );
  }

  private saveFailedOrderInfo(): void {
    if (!this.order) {
      return;
    }

    localStorage.setItem(
      this.failedOrderStorageKey,
      JSON.stringify({
        orderId: this.order.orderId,
        paymentId: this.order.paymentId,
        transactionCode: this.order.transactionCode,
        orderType: this.order.source,
        failedAt: new Date().toISOString(),
      })
    );
  }

  private removeFailedOrderInfo(): void {
    localStorage.removeItem(this.failedOrderStorageKey);
  }

  private cleanGuestCartAfterSuccess(): void {
    if (!this.order || this.order.source !== 'guest') {
      return;
    }

    const orderedIds = new Set(
      this.order.products
        .map((item) => String(item.id || '').trim())
        .filter(Boolean)
    );

    if (orderedIds.size === 0) {
      localStorage.removeItem(this.checkoutItemsStorageKey);
      return;
    }

    const rawCart = localStorage.getItem(this.guestCartStorageKey);

    if (rawCart) {
      try {
        const cart = JSON.parse(rawCart);

        if (Array.isArray(cart)) {
          const remainingCart = cart.filter((item: any) => {
            const itemId = String(item?.id || item?.SAN_PHAM_ID || '').trim();
            return !orderedIds.has(itemId);
          });

          if (remainingCart.length > 0) {
            localStorage.setItem(this.guestCartStorageKey, JSON.stringify(remainingCart));
          } else {
            localStorage.removeItem(this.guestCartStorageKey);
          }
        }
      } catch {
        localStorage.removeItem(this.guestCartStorageKey);
      }
    }

    localStorage.removeItem(this.checkoutItemsStorageKey);
    window.dispatchEvent(new Event('cart-changed'));
  }

  private stopTimers(): void {
    this.stopCountdown();
    this.stopPolling();
  }

  private stopCountdown(): void {
    if (this.countdownTimerId !== null) {
      window.clearInterval(this.countdownTimerId);
      this.countdownTimerId = null;
    }
  }

  private stopPolling(): void {
    if (this.pollingTimerId !== null) {
      window.clearInterval(this.pollingTimerId);
      this.pollingTimerId = null;
    }
  }

  private normalizeStatus(value: string): string {
    const normalized = String(value || '').trim().toLowerCase();

    if (
      normalized.includes('chờ xử lý') ||
      normalized.includes('đang xử lý') ||
      normalized.includes('đang chuẩn bị')
    ) {
      return 'processing';
    }

    if (
      normalized.includes('thanh toán thất bại') ||
      normalized.includes('thất bại') ||
      normalized.includes('hết hạn')
    ) {
      return 'payment_failed';
    }

    return normalized;
  }

  private isSuccessText(value: string): boolean {
    const normalized = value.trim().toLowerCase();

    return [
      'thành công',
      'thanh toán thành công',
      'đã thanh toán',
      'success',
      'paid',
    ].includes(normalized);
  }

  private isFailedText(value: string): boolean {
    const normalized = value.trim().toLowerCase();

    return [
      'thất bại',
      'thanh toán thất bại',
      'failed',
      'expired',
      'hết hạn',
    ].includes(normalized);
  }

  private normalizePhone(phone: string): string {
    return String(phone || '').replace(/\D/g, '');
  }

  private formatPhone(phone: string): string {
    const digits = this.normalizePhone(phone).slice(0, 10);

    if (digits.length <= 4) {
      return digits;
    }

    if (digits.length <= 7) {
      return `${digits.slice(0, 4)} ${digits.slice(4)}`;
    }

    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }

  private readStorage(storageKey: string): any | null {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  get isCodPayment(): boolean {
    return this.order?.payment.method === 'cod';
  }

  get isOnlinePayment(): boolean {
    const method = this.order?.payment.method;

    return method === 'momo' || method === 'vnpay' || method === 'bank';
  }

  get formattedCountdown(): string {
    const minutes = Math.floor(this.remainingSeconds / 60)
      .toString()
      .padStart(2, '0');

    const seconds = Math.floor(this.remainingSeconds % 60)
      .toString()
      .padStart(2, '0');

    return `${minutes}:${seconds}`;
  }
}
