import { CommonModule, isPlatformBrowser } 
from '@angular/common';
import { FormsModule } from '@angular/forms';
import addressData from '../../../../assets/address/vietnam-address-old.json';
import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  CreateOrderResponse,
  OrderDetailProductResponse,
  OrderDetailResponse,
  OrderDetailVoucherResponse,
  OrderService,
} from '../../../services/order.service';

interface OrderDetailView {
  id: string;
  customerId: string;
  date: string;
  status: string;
  receiver: string;
  phone: string;
  deliveryDate: string;
  deliveryTime: string;
  address: string;
  cardMessage: string;
  noteShop: string;
  paymentMethod: string;
  paymentStatus: string;
  paymentId: string;
  transactionCode: string;
  paymentAmount: number;
  hideSender: boolean;
  requestVAT: boolean;
  sendZaloPhoto: boolean;
  subtotal: number;
  shippingFee: number;
  discount: number;
  depositAmount: number;
  total: number;
  hasEditedShipping: boolean;
  cancelReason: string;
  returnRefundReason: string;
  rejectReason: string;
}

interface OrderDetailProduct {
  id: string;
  image: string;
  name: string;
  price: number;
  quantity: number;
  style: string;
  status: string;
}

interface OrderDetailVoucher {
  id: string;
  code: string;
  type: string;
  value: number;
  description: string;
}

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.css',
})
export class OrderDetail implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly orderService = inject(OrderService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ordersApiUrl = 'https://tiem-hoa-yen-api.onrender.com/api/orders';
  private readonly cartApiUrl = 'https://tiem-hoa-yen-api.onrender.com/api/cart';

  isLoading = false;
  errorMessage = '';

  order: OrderDetailView = this.getEmptyOrder();
  products: OrderDetailProduct[] = [];
  vouchers: OrderDetailVoucher[] = [];
  steps: any[] = [];
  private autoRefreshTimer: number | null = null;

  ngOnInit(): void {
    this.loadOrderDetail(true);
    this.startAutoRefreshStatus();
  }

  ngOnDestroy(): void {
    if (this.autoRefreshTimer !== null) {
      window.clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  private async loadOrderDetail(showLoading = true): Promise<void> {
    const orderId = this.getOrderIdFromRoute();

    if (!orderId) {
      this.errorMessage = 'Không tìm thấy mã đơn hàng.';
      this.isLoading = false;
      this.cdr.detectChanges();
      return;
    }

    if (showLoading) {
      this.isLoading = true;
      this.errorMessage = '';
      this.cdr.detectChanges();
    }

    try {
      const lookupPhone = this.getLookupPhoneFromRoute();
      const phoneQuery = lookupPhone ? `?phone=${encodeURIComponent(lookupPhone)}` : '';
      const apiUrl = `${this.ordersApiUrl}/${encodeURIComponent(orderId)}/detail${phoneQuery}`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || `Không thể tải chi tiết đơn hàng. Mã lỗi ${response.status}`);
      }

      const res: OrderDetailResponse = await response.json();

      this.order = this.mapOrder(res);
      this.products = this.mapProducts(res.products || []);
      this.vouchers = this.mapVouchers(res.vouchers || []);
      this.steps = this.buildSteps(this.order.status);

      this.errorMessage = '';
    } catch (error: any) {
      console.error('Lỗi lấy chi tiết đơn hàng:', error);

      if (showLoading) {
        this.errorMessage = error?.message || 'Không thể tải chi tiết đơn hàng.';
      }
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }
  private startAutoRefreshStatus(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.autoRefreshTimer = window.setInterval(() => {
      if (!this.order.id) {
        return;
      }

      this.loadOrderDetail(false);
    }, 5000);
  }

  private getOrderIdFromRoute(): string {
    return String(
      this.route.snapshot.paramMap.get('id') ||
      this.route.snapshot.queryParamMap.get('orderCode') ||
      this.route.snapshot.queryParamMap.get('orderId') ||
      this.getLatestCreatedOrderId() ||
      ''
    ).trim();
  }

  private getLookupPhoneFromRoute(): string {
    return String(this.route.snapshot.queryParamMap.get('phone') || '')
      .replace(/\D/g, '')
      .slice(0, 10);
  }

  private getLatestCreatedOrderId(): string {
    if (!isPlatformBrowser(this.platformId)) {
      return '';
    }

    try {
      const rawCreatedOrder = localStorage.getItem('tiemHoaYenCreatedOrder');
      const createdOrder = rawCreatedOrder ? JSON.parse(rawCreatedOrder) : null;
      return String(createdOrder?.orderId || '');
    } catch {
      return '';
    }
  }

  private mapOrder(res: OrderDetailResponse): OrderDetailView {
    const row = res.order || {};
    const payment = res.payment || {};
    const summary = res.summary || {};

    const subtotal = Number(summary.TAM_TINH ?? row.TAM_TINH ?? 0);
    const shippingFee = Number(summary.PHI_VAN_CHUYEN ?? row.PHI_VAN_CHUYEN ?? 0);
    const total = Number(summary.TONG_TIEN ?? row.TONG_TIEN ?? 0);
    const discount = Number(summary.GIAM_GIA ?? Math.max(0, subtotal + shippingFee - total));

    return {
      id: String(row.DON_HANG_ID || ''),
      customerId: String(row.KHACH_HANG_ID || ''),
      date: this.formatDateTime(row.NGAY_TAO),
      status: String(row.TRANG_THAI || 'Chờ thanh toán'),
      receiver: String(row.TEN_NGUOI_NHAN || ''),
      phone: this.formatPhone(String(row.SDT_NGUOI_NHAN || '')),
      deliveryDate: this.formatDate(row.NGAY_MUON_GIAO),
      deliveryTime: String(row.KHUNG_GIO_MUON_GIAO || ''),
      address: String(row.DIA_CHI_GIAO_HANG || ''),
      cardMessage: String(row.LOI_NHAN_THIEP || ''),
      noteShop: String(row.GHI_CHU || ''),
      paymentMethod: String(row.PHUONG_THUC_THANH_TOAN || payment.CONG_THANH_TOAN || ''),
      paymentStatus: String(payment.TRANG_THAI_THANH_TOAN || 'Chưa có'),
      paymentId: String(payment.THANH_TOAN_ID || ''),
      transactionCode: String(payment.MA_GIAO_DICH || ''),
      paymentAmount: Number(payment.SO_TIEN || 0),
      hideSender: !!row.AN_THONG_TIN,
      requestVAT: !!row.YEU_CAU_VAT,
      sendZaloPhoto: !!row.GUI_ANH_QUA_ZALO,
      subtotal,
      shippingFee,
      discount,
      depositAmount: Number(summary.TIEN_COC ?? row.TIEN_COC ?? 0),
      total,
      hasEditedShipping: !!row.DA_CHINH_SUA_GIAO_HANG,
      cancelReason: String(row.LY_DO_HUY || ''),
      returnRefundReason: String(row.LY_DO_HOAN_TIEN_TRA_HANG || ''),
      rejectReason: String(row.LY_DO_TU_CHOI || ''),
    };
  }

  private mapProducts(items: OrderDetailProductResponse[]): OrderDetailProduct[] {
    return items.map((item: OrderDetailProductResponse) => ({
      id: String(item.SAN_PHAM_ID || ''),
      image: String(item.HINH_ANH || 'assets/images/hoa.jpg'),
      name: String(item.TEN_SAN_PHAM || item.SAN_PHAM_ID || 'Sản phẩm'),
      price: Number(item.GIA || 0),
      quantity: Math.max(1, Number(item.SO_LUONG || 1)),
      style: String(item.KIEU_DANG || ''),
      status: String(item.TRANG_THAI_SAN_PHAM || ''),
    }));
  }

  private mapVouchers(items: OrderDetailVoucherResponse[]): OrderDetailVoucher[] {
    return items.map((item: OrderDetailVoucherResponse) => ({
      id: String(item.VOUCHER_ID || ''),
      code: String(item.MA_VOUCHER || item.VOUCHER_ID || ''),
      type: String(item.LOAI_GIAM_GIA || ''),
      value: Number(item.GIA_TRI_GIAM || 0),
      description: String(item.MO_TA || ''),
    }));
  }

  private buildSteps(status: string): any[] {
    const key = this.normalizeStatus(status);

    const normalKeys = [
      'created',
      'preparing',
      'waiting_shipping',
      'delivering',
      'delivered',
      'completed',
    ];

    const normalFlow = [
      {
        key: 'created',
        icon: 'bi-receipt',
        text: 'Chờ xử lý',
      },
      {
        key: 'preparing',
        icon: 'bi-gift',
        text: 'Đang chuẩn bị hàng',
      },
      {
        key: 'waiting_shipping',
        icon: 'bi-box-seam',
        text: 'Chờ vận chuyển',
      },
      {
        key: 'delivering',
        icon: 'bi-truck',
        text: 'Đang giao',
      },
      {
        key: 'delivered',
        icon: 'bi-clipboard-check',
        text: 'Giao hàng thành công',
      },
      {
        key: 'completed',
        icon: 'bi-check2-circle',
        text: 'Hoàn thành',
      },
    ];

    const buildNormalFlow = () => {
      const currentIndex = normalKeys.indexOf(key);

      return normalFlow.map((step, index) => ({
        ...step,
        done: currentIndex > index,
        current: currentIndex === index,
      }));
    };

    const buildRejectedReturnFlow = (completed = false) => {
      return [
        ...normalFlow.slice(0, 4).map(step => ({
          ...step,
          done: true,
          current: false,
        })),
        {
          icon: 'bi-arrow-counterclockwise',
          text: 'Yêu cầu hoàn tiền/trả hàng',
          done: true,
          current: false,
        },
        {
          icon: 'bi-x-lg',
          text: 'Từ chối hoàn tiền/trả hàng',
          done: completed,
          current: !completed,
        },
        {
          icon: 'bi-check2-circle',
          text: 'Hoàn thành',
          current: completed,
        },
      ];
    };

    if (key === 'payment') {
      return [
        {
          icon: 'bi-credit-card',
          text: 'Chờ thanh toán',
          current: true,
        },
      ];
    }

    if (key === 'payment_failed') {
      return [
        {
          icon: 'bi-receipt',
          text: 'Đơn hàng đã tạo',
          done: true,
        },
        {
          icon: 'bi-x-lg',
          text: 'Thanh toán thất bại',
          current: true,
        },
      ];
    }

    if (key === 'cancelled') {
      return [
        {
          icon: 'bi-receipt',
          text: 'Đơn hàng đã tạo',
          done: true,
        },
        {
          icon: 'bi-x-lg',
          text: 'Đã hủy',
          current: true,
        },
      ];
    }

    if (key === 'delivery_failed') {
      return [
        {
          icon: 'bi-receipt',
          text: 'Chờ xử lý',
          done: true,
        },
        {
          icon: 'bi-gift',
          text: 'Đang chuẩn bị hàng',
          done: true,
        },
        {
          icon: 'bi-box-seam',
          text: 'Chờ vận chuyển',
          done: true,
        },
        {
          icon: 'bi-truck',
          text: 'Đang giao',
          done: true,
        },
        {
          icon: 'bi-exclamation-lg',
          text: 'Giao hàng không thành công',
          current: true,
        },
      ];
    }

    if (key === 'return_rejected') {
      return buildRejectedReturnFlow(false);
    }

    if (key === 'completed' && this.hasReturnRefundHistory()) {
      return buildRejectedReturnFlow(true);
    }

    if (
      key === 'return_requested' ||
      key === 'return_accepted' ||
      key === 'refunding' ||
      key === 'refunded'
    ) {
      const returnKeys = [
        'return_requested',
        'return_accepted',
        'refunding',
        'refunded',
      ];

      const returnFlow = [
        {
          key: 'return_requested',
          icon: 'bi-arrow-counterclockwise',
          text: 'Yêu cầu hoàn tiền/trả hàng',
        },
        {
          key: 'return_accepted',
          icon: 'bi-check-lg',
          text: 'Chấp nhận hoàn tiền',
        },
        {
          key: 'refunding',
          icon: 'bi-cash-coin',
          text: 'Đang hoàn tiền',
        },
        {
          key: 'refunded',
          icon: 'bi-check2-all',
          text: 'Đã hoàn tiền',
        },
      ];

      const currentIndex = returnKeys.indexOf(key);

      return [
        ...normalFlow.slice(0, 4).map(step => ({
          ...step,
          done: true,
          current: false,
        })),
        ...returnFlow.map((step, index) => ({
          ...step,
          done: currentIndex > index,
          current: currentIndex === index,
        })),
      ];
    }

    return buildNormalFlow();
  }

  private hasReturnRefundHistory(): boolean {
    return !!String(this.order?.returnRefundReason || this.order?.rejectReason || '').trim();
  }

  shouldShowRejectReason(): boolean {
    return !!String(this.order?.rejectReason || '').trim();
  }

  private normalizeStatus(status: string): string {
    const value = String(status || '').trim().toLowerCase();

    if (
      value.includes('thanh toán thất bại') ||
      value.includes('thất bại thanh toán')
    ) {
      return 'payment_failed';
    }

    if (
      value.includes('chờ thanh toán') ||
      value.includes('đơn hàng đã tạo')
    ) {
      return 'payment';
    }

    if (
      value.includes('đã hủy') ||
      value.includes('hủy')
    ) {
      return 'cancelled';
    }

    if (
      value.includes('giao hàng không thành công') ||
      value.includes('giao thất bại')
    ) {
      return 'delivery_failed';
    }

    if (
      value.includes('từ chối hoàn tiền') ||
      value.includes('từ chối hoàn trả') ||
      value.includes('từ chối trả hàng')
    ) {
      return 'return_rejected';
    }

    if (
      value.includes('đã hoàn tiền') ||
      value.includes('hoàn tiền thành công') ||
      value.includes('trả hàng thành công')
    ) {
      return 'refunded';
    }

    if (value.includes('đang hoàn tiền')) {
      return 'refunding';
    }

    if (
      value.includes('chấp nhận hoàn tiền') ||
      value.includes('xác nhận trả hàng') ||
      value.includes('đã xác nhận trả hàng')
    ) {
      return 'return_accepted';
    }

    if (
      value.includes('yêu cầu trả hàng') ||
      value.includes('yêu cầu hoàn tiền') ||
      value.includes('trả hàng & hoàn tiền')
    ) {
      return 'return_requested';
    }

    if (value.includes('hoàn thành')) {
      return 'completed';
    }

    if (
      value.includes('giao hàng thành công') ||
      value.includes('giao thành công')
    ) {
      return 'delivered';
    }

    if (value.includes('đang giao')) {
      return 'delivering';
    }

    if (
      value.includes('chờ vận chuyển') ||
      value.includes('chờ giao hàng')
    ) {
      return 'waiting_shipping';
    }

    if (
      value.includes('đang chuẩn bị') ||
      value.includes('chuẩn bị')
    ) {
      return 'preparing';
    }

    if (
      value.includes('chờ xử lý') ||
      value.includes('đang xử lý')
    ) {
      return 'created';
    }

    return 'created';
  }

  retryPayment(): void {
    if (!this.order.id) return;

    this.orderService.retryPayment(this.order.id).subscribe({
      next: (res: CreateOrderResponse) => {
        if (isPlatformBrowser(this.platformId)) {
          localStorage.setItem('tiemHoaYenCreatedOrder', JSON.stringify(res));
          localStorage.setItem(
            'tiemHoaYenRegistrantOrder',
            JSON.stringify(this.mapCurrentOrderForCheckout())
          );
        }

        this.router.navigate(['/checkout']);
      },
      error: (err: any) => {
        console.error(err?.error?.message || 'Không thể tạo lại mã thanh toán.');
      },
    });
  }

  private mapCurrentOrderForCheckout(): any {
    return {
      customerId: '',
      selectedAddress: {
        name: this.order.receiver,
        phone: this.order.phone,
        fullAddress: this.order.address,
      },
      receiver: {
        name: this.order.receiver,
        phone: this.order.phone,
        address: this.order.address,
      },
      sender: {
        name: '',
        phone: '',
        email: '',
      },
      delivery: {
        date: this.order.deliveryDate,
        time: this.order.deliveryTime,
        message: this.order.cardMessage,
        noteShop: this.order.noteShop,
      },
      items: this.products.map(product => ({
        id: product.id,
        name: product.name,
        qty: product.quantity,
        price: product.price,
        image: product.image,
      })),
      subtotal: this.order.subtotal,
      baseShippingFee: this.order.shippingFee,
      shippingVoucherDiscount: 0,
      shippingFee: this.order.shippingFee,
      productVoucherDiscount: this.order.discount,
      loyaltyDiscount: 0,
      depositAmount: this.order.depositAmount,
      remainingAmount: Math.max(0, this.order.total - this.order.depositAmount),
      total: this.order.total,
      paymentMethod: this.detectPaymentMethod(this.order.paymentMethod),
      paymentMethodName: this.order.paymentMethod,
      flags: {
        hideSender: this.order.hideSender,
        requestVAT: this.order.requestVAT,
        sendZaloPhoto: this.order.sendZaloPhoto,
      },
    };
  }

  private detectPaymentMethod(methodName: string): string {
    const value = String(methodName || '').toLowerCase();
    if (value.includes('cod') || value.includes('nhận hàng')) return 'cod';
    if (value.includes('momo')) return 'momo';
    if (value.includes('vnpay')) return 'vnpay';
    if (value.includes('chuyển khoản') || value.includes('bank')) return 'bank';
    return 'bank';
  }

  cancelOrder(): void {
    this.openCancelReasonModal();
  }

  openCancelReasonModal(): void {
    if (!this.canCancel()) {
      return;
    }

    this.openReasonModal('cancel');
  }

  openReturnRefundReasonModal(): void {
    if (!this.canRequestReturnRefund()) {
      return;
    }

    this.openReasonModal('return-refund');
  }

  private openReasonModal(type: 'cancel' | 'return-refund'): void {
    this.reasonModalType = type;
    this.selectedReason = '';
    this.reasonSubmitError = '';
    this.isReasonModalOpen = true;

    if (this.autoRefreshTimer !== null) {
      window.clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }

    this.cdr.detectChanges();
  }

  closeReasonModal(): void {
    if (this.isSubmittingReason) {
      return;
    }

    this.isReasonModalOpen = false;
    this.selectedReason = '';
    this.reasonSubmitError = '';
    this.startAutoRefreshStatus();
    this.cdr.detectChanges();
  }

  submitReasonModal(): void {
    if (this.reasonModalType === 'cancel') {
      this.submitCancelReason();
      return;
    }

    this.submitReturnRefundReason();
  }

  private async submitCancelReason(): Promise<void> {
    if (!this.order.id || this.isSubmittingReason) {
      return;
    }

    if (!this.selectedReason) {
      this.reasonSubmitError = 'Vui lòng chọn lý do hủy đơn hàng.';
      return;
    }

    this.isSubmittingReason = true;
    this.reasonSubmitError = '';
    this.cdr.detectChanges();

    try {
      const response = await fetch(`${this.ordersApiUrl}/${encodeURIComponent(this.order.id)}/cancel`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: this.selectedReason,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.message || 'Không thể hủy đơn hàng.');
      }

      this.order.status = data?.orderStatus || 'Đã hủy';
      this.order.cancelReason = this.selectedReason;
      this.steps = this.buildSteps(this.order.status);
      this.isReasonModalOpen = false;
      this.selectedReason = '';
      this.startAutoRefreshStatus();
    } catch (error: any) {
      this.reasonSubmitError = error?.message || 'Không thể hủy đơn hàng.';
    } finally {
      this.isSubmittingReason = false;
      this.cdr.detectChanges();
    }
  }

  private async submitReturnRefundReason(): Promise<void> {
    if (!this.order.id || this.isSubmittingReason) {
      return;
    }

    if (!this.selectedReason) {
      this.reasonSubmitError = 'Vui lòng chọn lý do hoàn tiền/trả hàng.';
      return;
    }

    this.isSubmittingReason = true;
    this.reasonSubmitError = '';
    this.cdr.detectChanges();

    try {
      const response = await fetch(`${this.ordersApiUrl}/${encodeURIComponent(this.order.id)}/return-refund`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: this.selectedReason,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.message || 'Không thể gửi yêu cầu hoàn tiền/trả hàng.');
      }

      this.order.status = data?.orderStatus || 'Yêu cầu hoàn tiền/trả hàng';
      this.order.returnRefundReason = this.selectedReason;
      this.steps = this.buildSteps(this.order.status);
      this.isReasonModalOpen = false;
      this.selectedReason = '';
      this.startAutoRefreshStatus();
    } catch (error: any) {
      this.reasonSubmitError = error?.message || 'Không thể gửi yêu cầu hoàn tiền/trả hàng.';
    } finally {
      this.isSubmittingReason = false;
      this.cdr.detectChanges();
    }
  }

  async reorder(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const cartItems = this.products.map(product => ({
      id: product.id,
      name: product.name,
      style: product.style,
      occasion: product.status,
      price: product.price,
      originalPrice: null,
      quantity: product.quantity,
      image: product.image,
      selected: true,
    }));

    localStorage.setItem('tiemHoaYenCart', JSON.stringify(cartItems));

    const customerId = this.order.customerId || this.getLoggedInCustomerId();

    if (customerId) {
      try {
        await Promise.all(
          this.products
            .filter(product => String(product.id).startsWith('SP'))
            .map(product =>
              fetch(`${this.cartApiUrl}/add`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  customerId,
                  productId: product.id,
                  quantity: product.quantity,
                }),
              })
            )
        );
      } catch (error) {
        console.error('Lỗi thêm lại sản phẩm vào database giỏ hàng:', error);
      }
    }

    this.router.navigate(['/cart']);
  }

  readonly cancelReasons = [
    'Tôi muốn thay đổi địa chỉ/thông tin người nhận hàng',
    'Tôi muốn thay đổi hình thức thanh toán',
    'Tôi muốn thay đổi sản phẩm (số lượng, mẫu mã,...)',
    'Tôi muốn thêm/thay đổi mã giảm giá',
    'Tôi không còn muốn mua sản phẩm nữa',
  ];

  readonly returnRefundReasons = [
    'Hoa bị héo/dập/không còn tươi',
    'Hoa không đúng mẫu/thông điệp đã đặt',
    'Thiếu sản phẩm hoặc phụ kiện đi kèm',
    'Giao hàng trễ so với thời gian yêu cầu',
  ];

  isReasonModalOpen = false;
  reasonModalType: 'cancel' | 'return-refund' = 'cancel';
  selectedReason = '';
  reasonSubmitError = '';
  isSubmittingReason = false;

  canRetryPayment(): boolean {
    const status = this.normalizeStatus(this.order.status);
    return status === 'payment_failed' || status === 'payment';
  }

  goToReview(): void {
    if (!this.order.id) {
      return;
    }

    const phone = String(this.order.phone || '')
      .replace(/\D/g, '')
      .slice(0, 10);

    this.router.navigate(['/order-review'], {
      queryParams: {
        orderId: this.order.id,
        phone: phone || null,
      },
    });
  }

  canReview(): boolean {
    return this.normalizeStatus(this.order.status) === 'completed';
  }

  canCancel(): boolean {
    return this.normalizeStatus(this.order.status) === 'created';
  }

  canRequestReturnRefund(): boolean {
    return this.normalizeStatus(this.order.status) === 'delivered';
  }


  getDeliveryMapStatusText(): string {
    const status = this.normalizeStatus(this.order.status);

    if (status === 'delivering') return 'Đang giao';
    if (status === 'delivered') return 'Đã giao thành công';
    if (status === 'completed') return 'Hoàn thành';
    if (status === 'waiting_shipping') return 'Chờ vận chuyển';
    if (status === 'preparing') return 'Đang chuẩn bị';
    if (status === 'created') return 'Chờ xử lý';
    if (status === 'delivery_failed') return 'Giao không thành công';
    if (status === 'cancelled') return 'Đơn đã hủy';
    if (status === 'payment' || status === 'payment_failed') return 'Chờ thanh toán';

    return 'Đang cập nhật';
  }

  getDeliveryMapDescription(): string {
    const status = this.normalizeStatus(this.order.status);

    if (status === 'delivering') {
      return 'Shipper đang trên đường giao hoa đến địa chỉ của bạn.';
    }

    if (status === 'delivered' || status === 'completed') {
      return 'Đơn hàng đã được giao đến người nhận.';
    }

    if (status === 'waiting_shipping') {
      return 'Đơn hàng đã sẵn sàng và đang chờ shipper nhận đơn.';
    }

    if (status === 'preparing') {
      return 'Tiệm Hoa Yên đang chuẩn bị hoa và đóng gói đơn hàng.';
    }

    if (status === 'delivery_failed') {
      return 'Đơn giao không thành công. Shop sẽ liên hệ lại để hỗ trợ.';
    }

    if (status === 'cancelled') {
      return 'Đơn hàng đã hủy nên không có tuyến giao hàng.';
    }

    return 'Tuyến giao hàng sẽ được cập nhật khi đơn được xử lý.';
  }

  getDeliveryProgress(): number {
    const status = this.normalizeStatus(this.order.status);

    if (status === 'created' || status === 'payment' || status === 'payment_failed' || status === 'cancelled') return 0;
    if (status === 'preparing') return 18;
    if (status === 'waiting_shipping') return 34;
    if (status === 'delivering') return 62;
    if (status === 'delivered' || status === 'completed') return 100;
    if (status === 'delivery_failed') return 70;

    return 10;
  }

  getShipperPosition(): number {
    const progress = this.getDeliveryProgress();
    return 15 + (70 * progress / 100);
  }

  isOrderDelivering(): boolean {
    return this.normalizeStatus(this.order.status) === 'delivering';
  }

  getEstimatedDeliveryText(): string {
    const status = this.normalizeStatus(this.order.status);

    if (status === 'delivered' || status === 'completed') {
      return 'Đơn hàng đã giao thành công';
    }

    if (status === 'delivering') {
      return this.order.deliveryTime ? `Dự kiến giao trong khung ${this.order.deliveryTime}` : 'Đang giao đến người nhận';
    }

    if (status === 'cancelled') {
      return 'Đơn hàng đã hủy';
    }

    return this.order.deliveryTime ? `Khung giờ giao: ${this.order.deliveryTime}` : 'Đang cập nhật thời gian giao';
  }

  private formatDate(value: string | null | undefined): string {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleDateString('vi-VN');
  }

  private formatDateTime(value: string | null | undefined): string {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return `${date.toLocaleDateString('vi-VN')} ${date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  private getLoggedInCustomerId(): string {
    try {
      const rawCustomer = localStorage.getItem('khachHang');
      const customer = rawCustomer ? JSON.parse(rawCustomer) : null;

      return String(customer?.KHACH_HANG_ID || '');
    } catch {
      return '';
    }
  }
  private formatPhone(phone: string): string {
    const digits = String(phone || '').replace(/\D/g, '').slice(0, 10);

    if (digits.length <= 4) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }

  private getEmptyOrder(): OrderDetailView {
    return {
      id: '',
      customerId: '',
      date: '',
      status: '',
      receiver: '',
      phone: '',
      deliveryDate: '',
      deliveryTime: '',
      address: '',
      cardMessage: '',
      noteShop: '',
      paymentMethod: '',
      paymentStatus: '',
      paymentId: '',
      transactionCode: '',
      paymentAmount: 0,
      hideSender: false,
      requestVAT: false,
      sendZaloPhoto: false,
      subtotal: 0,
      shippingFee: 0,
      discount: 0,
      depositAmount: 0,
      total: 0,
      hasEditedShipping: false,
      cancelReason: '',
      returnRefundReason: '',
      rejectReason: '',
    };
  }
  isEditingShipping = false;
  isSavingShipping = false;
  saveShippingError = '';
  provinces: any[] = [];
  districts: any[] = [];
  wards: any[] = [];

  selectedProvince = '';
  selectedDistrict = '';
  selectedWard = '';
  specificAddress = '';
  editShipping = {
    receiver: '',
    phone: '',
    address: '',
    deliveryDate: '',        
    deliveryTime: '',
  };

  readonly timeSlots = [
    '8:00 - 12:00',
    '12:00 - 16:00',
    '16:00 - 20:00',
  ];

  canEditShipping(): boolean {
    if (this.order.hasEditedShipping) {
      return false;
    }
    const s = this.normalizeStatus(this.order.status);
    return s === 'created' || s === 'preparing';
  }

  openEditShipping(): void {
    if (this.autoRefreshTimer !== null) {
      window.clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }

    const inputDate = this.toInputDate(this.order.deliveryDate);
    this.editShipping = {
      receiver: this.order.receiver,
      phone: this.order.phone.replace(/\s/g, ''),
      address: this.order.address,
      deliveryDate: inputDate,
      deliveryTime: this.order.deliveryTime,
    };
    this.saveShippingError = '';

    this.provinces = (addressData as any[]) || [];

    const parts = this.order.address.split(',').map((s: string) => s.trim());
    const totalParts = parts.length;

    if (totalParts >= 3) {
      this.selectedProvince = parts[totalParts - 1] || '';
      this.selectedDistrict = parts[totalParts - 2] || '';
      this.selectedWard = parts[totalParts - 3] || '';
      this.specificAddress = parts.slice(0, totalParts - 3).join(', ');
    } else {
      this.selectedProvince = '';
      this.selectedDistrict = '';
      this.selectedWard = '';
      this.specificAddress = this.order.address;
    }

    const foundProvince = this.provinces.find((p: any) => p.name === this.selectedProvince);
    this.districts = foundProvince ? foundProvince.districts || [] : [];

    const foundDistrict = this.districts.find((d: any) => d.name === this.selectedDistrict);
    this.wards = foundDistrict ? foundDistrict.wards || [] : [];

    this.isEditingShipping = true;
    this.cdr.detectChanges();
  }
  closeEditShipping(): void {
    this.isEditingShipping = false;
    this.startAutoRefreshStatus();
  }

  saveShippingInfo(): void {
    if (this.isSavingShipping) return;

    if (!this.editShipping.receiver.trim()) {
      this.saveShippingError = 'Vui lòng nhập tên người nhận.';
      return;
    }
    if (!this.editShipping.phone.trim()) {
      this.saveShippingError = 'Vui lòng nhập số điện thoại.';
      return;
    }

    this.isSavingShipping = true;
    this.saveShippingError = '';

    this.orderService.updateShippingInfo(this.order.id, {
      receiver: this.editShipping.receiver.trim(),
      phone: this.editShipping.phone.trim(),
      address: this.editShipping.address.trim(),
      deliveryDate: this.editShipping.deliveryDate,
      deliveryTime: this.editShipping.deliveryTime,
    }).subscribe({
      next: () => {
        this.order.receiver = this.editShipping.receiver.trim();
        this.order.phone = this.formatPhone(this.editShipping.phone.trim());
        this.order.address = this.editShipping.address.trim();
        this.order.deliveryDate = this.formatDate(this.editShipping.deliveryDate);
        this.order.deliveryTime = this.editShipping.deliveryTime;
        this.order.hasEditedShipping = true;
        this.isSavingShipping = false;
        this.isEditingShipping = false;
        this.startAutoRefreshStatus(); 
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.saveShippingError = err?.error?.message || 'Không thể lưu. Vui lòng thử lại.';
        this.isSavingShipping = false;
        if (err?.status === 403) {
          this.order.hasEditedShipping = true;
          this.isEditingShipping = false;
          this.startAutoRefreshStatus();
        }
        this.cdr.detectChanges();
      },
    });
  }

  private toInputDate(viDate: string): string {
    if (!viDate) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(viDate)) return viDate;
    const parts = viDate.split('/');
    if (parts.length === 3) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2];
      return `${year}-${month}-${day}`;
    }
    return '';
  }

  onProvinceChange(): void {
    const found = this.provinces.find((p: any) => p.name === this.selectedProvince);
    this.districts = found ? found.districts || [] : [];
    this.selectedDistrict = '';
    this.wards = [];
    this.selectedWard = '';
    this.buildAddress();
  }

  onDistrictChange(): void {
    const foundProvince = this.provinces.find((p: any) => p.name === this.selectedProvince);
    const foundDistrict = foundProvince?.districts?.find((d: any) => d.name === this.selectedDistrict);
    this.wards = foundDistrict ? foundDistrict.wards || [] : [];
    this.selectedWard = '';
    this.buildAddress();
  }

  buildAddress(): void {
    const parts = [
      this.specificAddress,
      this.selectedWard,
      this.selectedDistrict,
      this.selectedProvince,
    ].filter(p => p && p.trim());
    this.editShipping.address = parts.join(', ');
  }
}
