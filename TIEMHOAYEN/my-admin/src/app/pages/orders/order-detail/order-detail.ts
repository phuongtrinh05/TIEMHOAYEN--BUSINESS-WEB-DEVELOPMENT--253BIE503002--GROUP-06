import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AdminApiService, AdminOrderDetail } from '../../../services/admin-api.service';
import { combineLatest, Subscription } from 'rxjs';

// ===== TYPES =====
export type OrderStatus =
  | 'Chờ xử lý'
  | 'Đang chuẩn bị hàng'
  | 'Chờ vận chuyển'
  | 'Đang giao'
  | 'Giao thành công'
  | 'Yêu cầu hoàn tiền/trả hàng'
  | 'Chấp nhận hoàn tiền'
  | 'Đang hoàn tiền'
  | 'Đã hoàn tiền'
  | 'Từ chối hoàn tiền/trả hàng'
  | 'Hoàn thành'
  | 'Đã hủy';

export type PaymentStatus = 'Đã thanh toán' | 'Chờ thanh toán' | 'Đã cọc' | 'Thanh toán thất bại';

export interface OrderProduct {
  id: string;
  name: string;
  image: string;
  qty: number;
  price: number;
}

export interface Shipper {
  name: string;
  phone: string;
  avatar: string;
}

export interface IOrderDetail {
  id: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
  createdTime: string;
  estimatedDelivery: string;
  senderName: string;
  senderCustomerId: string;
  senderPhone: string;
  senderEmail: string;
  receiverName: string;
  receiverPhone: string;
  receiverEmail: string;
  deliveryDate: string;
  deliverySlot: string;
  deliveryAddress: string;
  shipperName: string;
  shipperPhone: string;
  shipperAvatar: string;
  products: OrderProduct[];
  customerNote: string;
  cardTemplate: string;
  cardMessage: string;
  subtotal: number;
  shippingFee: number;
  voucher: string | null;
  voucherDiscount: number;
  loyaltyPoints: number;
  loyaltyDiscount: number;
  tax: number;
  total: number;
  paid: number;
  remaining: number;
  paymentMethod: string;
  adminNote: string;
  adminNoteTime: string;
  reviewId: string;
  rating: number;
  reviewText: string;
  reviewTime: string;
  adminReplyText: string;
  adminReplyTime: string;
  refundReason: string;
}

export interface TimelineStep {
  status: OrderStatus;
  time: string;
  done: boolean;
  icon: string;
}

interface RoutedOrder {
  id?: string;
  customerId?: string;
  createdAt?: string;
  total?: number;
  paymentStatus?: string;
  orderStatus?: string;
}

type ToastType = 'success' | 'error';

const ALL_STATUSES: OrderStatus[] = [
  'Chờ xử lý',
  'Đang chuẩn bị hàng',
  'Chờ vận chuyển',
  'Đang giao',
  'Giao thành công',
  'Yêu cầu hoàn tiền/trả hàng',
  'Chấp nhận hoàn tiền',
  'Đang hoàn tiền',
  'Đã hoàn tiền',
  'Từ chối hoàn tiền/trả hàng',
  'Hoàn thành',
  'Đã hủy',
];

const BASE_STATUS_OPTIONS: OrderStatus[] = [
  ALL_STATUSES[0],
  ALL_STATUSES[1],
  ALL_STATUSES[2],
  ALL_STATUSES[3],
  ALL_STATUSES[4],
  ALL_STATUSES[10],
  ALL_STATUSES[11],
];

const REFUND_REQUEST_STATUS = ALL_STATUSES[5];
const REFUND_ACCEPTED_STATUS = ALL_STATUSES[6];
const REFUND_REJECTED_STATUS = ALL_STATUSES[9];
const REFUND_STATUS_OPTIONS: OrderStatus[] = [
  ALL_STATUSES[6],
  ALL_STATUSES[7],
  ALL_STATUSES[8],
  ALL_STATUSES[9],
];


const STEP_CONFIG: Record<OrderStatus, { icon: string }> = {
  'Chờ xử lý': { icon: 'bi-gift-fill' },
  'Đang chuẩn bị hàng': { icon: 'bi-box-seam' },
  'Chờ vận chuyển': { icon: 'bi-boxes' },
  'Đang giao': { icon: 'bi-truck' },
  'Giao thành công': { icon: 'icon-delivered-box' },
  'Yêu cầu hoàn tiền/trả hàng': { icon: 'bi-card-text' },
  'Chấp nhận hoàn tiền': { icon: 'bi-megaphone-fill' },
  'Đang hoàn tiền': { icon: 'bi-hourglass-split' },
  'Đã hoàn tiền': { icon: 'bi-cash-coin' },
  'Từ chối hoàn tiền/trả hàng': { icon: 'bi-x-lg' },
  'Hoàn thành': { icon: 'bi-flag-fill' },
  'Đã hủy': { icon: 'icon-cancelled-square' },
};

const STATUS_TIME: Record<OrderStatus, string> = {
  'Chờ xử lý': '02/01 10:34 AM',
  'Đang chuẩn bị hàng': '02/01 11:34 AM',
  'Chờ vận chuyển': '02/01 12:34 AM',
  'Đang giao': '02/01 13:34 AM',
  'Giao thành công': '02/01 17:34 AM',
  'Yêu cầu hoàn tiền/trả hàng': '02/01 17:34 AM',
  'Chấp nhận hoàn tiền': '00:00',
  'Đang hoàn tiền': '00:00',
  'Đã hoàn tiền': '00:00',
  'Từ chối hoàn tiền/trả hàng': '00:00',
  'Hoàn thành': '00:00',
  'Đã hủy': '00:00',
};

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule],
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.css',
})
export class OrderDetail implements OnInit, OnDestroy {
  constructor(
    private readonly route: ActivatedRoute,
    private readonly adminApi: AdminApiService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  order: IOrderDetail = this.createEmptyOrder();

  shippers: Shipper[] = [
    {
      name: 'Nguyễn Quang Huy',
      phone: '0553851470',
      avatar: 'assets/images/nguyen_quang_huy.jpg',
    },
    {
      name: 'Trần Minh Khang',
      phone: '0908123456',
      avatar: 'assets/images/logo-main.png',
    },
    {
      name: 'Lê Hoàng Nam',
      phone: '0934567890',
      avatar: 'assets/images/logo-main.png',
    },
  ];
  

  private createEmptyOrder(): IOrderDetail {
    return {
      id: '',
      orderStatus: ALL_STATUSES[0],
      paymentStatus: 'Chờ thanh toán',
      createdAt: '',
      createdTime: '',
      estimatedDelivery: '',
      senderName: '',
      senderCustomerId: '',
      senderPhone: '',
      senderEmail: '',
      receiverName: '',
      receiverPhone: '',
      receiverEmail: '',
      deliveryDate: '',
      deliverySlot: '',
      deliveryAddress: '',
      shipperName: '',
      shipperPhone: '',
      shipperAvatar: 'assets/images/logo-main.png',
      products: [],
      customerNote: '',
      cardTemplate: '',
      cardMessage: '',
      subtotal: 0,
      shippingFee: 0,
      voucher: null,
      voucherDiscount: 0,
      loyaltyPoints: 0,
      loyaltyDiscount: 0,
      tax: 0,
      total: 0,
      paid: 0,
      remaining: 0,
      paymentMethod: '',
      adminNote: '',
      adminNoteTime: '',
      reviewId: '',
      rating: 0,
      reviewText: '',
      reviewTime: '',
      adminReplyText: '',
      adminReplyTime: '',
      refundReason: '',
    };
  }

  showShipperDropdown = false;
  showStatusDropdown = false;
  selectedNextStatus: OrderStatus | '' = '';
  editingNote = false;
  noteTemp = '';
  isReplying = false;
  replyText = '';
  isLoadingOrder = false;
  orderLoadError = '';
  toastVisible = false;
  toastMessage = '';
  toastType: ToastType = 'success';
  private lastLoadedOrderId = '';
  private routeSub?: Subscription;
  private toastTimeoutId?: ReturnType<typeof setTimeout>;

  paymentStatusOptions: PaymentStatus[] = [
    'Đã thanh toán',
    'Chờ thanh toán',
    'Đã cọc',
    'Thanh toán thất bại',
  ];

  get senderCustomerCodeLabel(): string {
    return this.order.senderCustomerId
      ? 'M\u00e3 kh\u00e1ch h\u00e0ng: ' + this.order.senderCustomerId
      : 'Kh\u00f4ng c\u00f3 m\u00e3 kh\u00e1ch h\u00e0ng';
  }

  // ===== EDIT MODE =====
  isEditing = false;
  editSnapshot: IOrderDetail | null = null;

  ngOnInit(): void {
    this.routeSub = combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(([params, query]) => {
      const routeOrderId = params.get('id') || query.get('orderId');
      const stateOrder = (typeof history !== 'undefined' ? history.state?.order : null) as RoutedOrder | null;
      const orderId = routeOrderId || stateOrder?.id || '';

      if (stateOrder || orderId) {
        this.applyRoutedOrder(stateOrder || {}, orderId || null);
        this.cdr.detectChanges();
      }

      if (orderId) {
        this.fetchOrderDetailOnce(orderId);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
    }
  }

  private fetchOrderDetailOnce(orderId: string): void {
    if (this.lastLoadedOrderId === orderId && !this.orderLoadError) {
      return;
    }

    this.lastLoadedOrderId = orderId;
    this.loadOrderDetail(orderId);
  }

  private loadOrderDetail(orderId: string): void {
    this.isLoadingOrder = true;
    this.orderLoadError = '';

    this.adminApi.getOrderDetail(orderId).subscribe({
      next: (response) => {
        this.applyApiOrderDetail(response.order);
        this.isLoadingOrder = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Cannot load order detail', error);
        this.orderLoadError = 'Cannot load order detail from database.';
        this.isLoadingOrder = false;
        this.cdr.detectChanges();
      },
    });
  }

  private applyApiOrderDetail(source: AdminOrderDetail): void {
    this.order = {
      ...this.order,
      ...source,
      orderStatus: this.toDetailOrderStatus(source.orderStatus),
      paymentStatus: this.toDetailPaymentStatus(source.paymentStatus),
      products: source.products ?? [],
      voucher: source.voucher ?? null,
    };
    this.ensureDefaultShipper();
  }

  private applyRoutedOrder(source: RoutedOrder, routeOrderId: string | null): void {
    const orderId = source.id || routeOrderId || this.order.id;
    const total = Number(source.total ?? 0);
    const createdAt = source.createdAt || this.order.createdAt;
    const isPaid = this.isPaidStatus(source.paymentStatus);

    this.order = {
      ...this.order,
      id: orderId,
      senderCustomerId: source.customerId || this.order.senderCustomerId,
      createdAt: this.toDisplayDate(createdAt),
      orderStatus: this.toDetailOrderStatus(source.orderStatus),
      paymentStatus: this.toDetailPaymentStatus(source.paymentStatus),
      subtotal: total || this.order.subtotal,
      total: total || this.order.total,
      paid: total && isPaid ? total : this.order.paid,
      remaining: total ? (isPaid ? 0 : total) : this.order.remaining,
    };
    this.ensureDefaultShipper();
  }

  private toDisplayDate(value: string): string {
    if (!value) {
      return this.order.createdAt;
    }

    if (value.includes('-')) {
      const parts = value.split('-');
      if (parts.length === 3) {
        return `${parts[0]}/${parts[1]}/${parts[2]}`;
      }
    }

    return value;
  }

  private toDetailPaymentStatus(value?: string): PaymentStatus {
    const allowed: PaymentStatus[] = [
      'Đã thanh toán',
      'Chờ thanh toán',
      'Đã cọc',
      'Thanh toán thất bại'
    ];

    return allowed.includes(value as PaymentStatus)
      ? value as PaymentStatus
      : this.order.paymentStatus;
  }

  private toDetailOrderStatus(value?: string): OrderStatus {
    if (value === 'Đã giao') {
      return 'Giao thành công';
    }

    const allowed = ALL_STATUSES as readonly string[];
    return allowed.includes(value || '')
      ? value as OrderStatus
      : this.order.orderStatus;
  }

  private isPaidStatus(value?: string): boolean {
    return value === 'Đã thanh toán' || value === 'Đã cọc';
  }



  startEdit(): void {
    this.editSnapshot = JSON.parse(JSON.stringify(this.order));
    this.isEditing = true;
  }

  cancelEdit(): void {
    if (this.editSnapshot) {
      this.order = JSON.parse(JSON.stringify(this.editSnapshot));
    }
    this.isEditing = false;
  }

  saveEdit(): void {
    this.isEditing = false;
    this.editSnapshot = null;
  }


  // ===== TIMELINE =====
  get timeline(): TimelineStep[] {
    const currentIdx = ALL_STATUSES.indexOf(this.order.orderStatus);

    return ALL_STATUSES.map((status, index) => ({
      status,
      time: index <= currentIdx ? STATUS_TIME[status] : '00:00',
      done: index <= currentIdx,
      ...STEP_CONFIG[status],
    }));
  }

  timelineIconClass(status: OrderStatus): string {
    const map: Record<OrderStatus, string> = {
      'Chờ xử lý': 'timeline-icon--pending',
      'Đang chuẩn bị hàng': 'timeline-icon--preparing',
      'Chờ vận chuyển': 'timeline-icon--waiting-ship',
      'Đang giao': 'timeline-icon--shipping',
      'Giao thành công': 'timeline-icon--delivered',
      'Yêu cầu hoàn tiền/trả hàng': 'timeline-icon--refund-request',
      'Chấp nhận hoàn tiền': 'timeline-icon--refund-accepted',
      'Đang hoàn tiền': 'timeline-icon--refund-processing',
      'Đã hoàn tiền': 'timeline-icon--refund-paid',
      'Từ chối hoàn tiền/trả hàng': 'timeline-icon--refund-rejected',
      'Hoàn thành': 'timeline-icon--completed',
      'Đã hủy': 'timeline-icon--cancelled',
    };

    return map[status];
  }

  orderStatusIcon(status: OrderStatus): string {
    return STEP_CONFIG[status].icon;
  }

  orderStatusBadgeClass(status: OrderStatus): string {
    return this.timelineIconClass(status).replace('timeline-icon--', 'order-status-badge--');
  }

  get statusOptions(): OrderStatus[] {
    return this.isRefundFlow ? REFUND_STATUS_OPTIONS : BASE_STATUS_OPTIONS;
  }

  get nextAllowedStatus(): OrderStatus | '' {
    return this.statusOptions.find((status) => !this.isStatusOptionDisabled(status)) || '';
  }

  get canApplySelectedStatus(): boolean {
    return Boolean(this.selectedNextStatus && !this.isStatusOptionDisabled(this.selectedNextStatus));
  }

  isStatusOptionDisabled(status: OrderStatus): boolean {
    const currentIndex = this.statusOptions.indexOf(this.order.orderStatus);
    const statusIndex = this.statusOptions.indexOf(status);

    if (this.order.orderStatus === REFUND_REQUEST_STATUS) {
      return status !== REFUND_ACCEPTED_STATUS && status !== REFUND_REJECTED_STATUS;
    }

    if (this.isRefundFlow && status === REFUND_REJECTED_STATUS) {
      return true;
    }

    if (currentIndex === -1 || statusIndex === -1) {
      return true;
    }

    return statusIndex <= currentIndex;
  }

  get isRefundFlow(): boolean {
    return [
      'Yêu cầu hoàn tiền/trả hàng',
      'Chấp nhận hoàn tiền',
      'Đang hoàn tiền',
      'Đã hoàn tiền',
      'Từ chối hoàn tiền/trả hàng',
    ].includes(this.order.orderStatus);
  }

  get isCancelled(): boolean {
    return this.order.orderStatus === 'Đã hủy';
  }

  get canUpdateStatus(): boolean {
    return true;
  }

  private get hasUpdatablePaymentStatus(): boolean {
    return this.isPaidStatus(this.order.paymentStatus);
  }

  get canEdit(): boolean {
    return [ALL_STATUSES[0], ALL_STATUSES[1]].includes(this.order.orderStatus);
  }

  isOrderDelivering(): boolean {
    return this.order.orderStatus === ALL_STATUSES[3];
  }

  getDeliveryProgress(): number {
    const status = this.order.orderStatus;

    if (status === ALL_STATUSES[11]) {
      return 0;
    }

    if (this.isRefundFlow || status === ALL_STATUSES[10]) {
      return 100;
    }

    const deliveryStatuses = BASE_STATUS_OPTIONS.filter((item) => item !== ALL_STATUSES[11]);
    const currentIndex = deliveryStatuses.indexOf(status);

    if (currentIndex < 0) {
      return 0;
    }

    return Math.round((currentIndex / (deliveryStatuses.length - 1)) * 100);
  }

  getShipperPosition(): number {
    return 15 + this.getDeliveryProgress() * 0.7;
  }

  get hasCardInfo(): boolean {
    const template = this.order.cardTemplate.trim().toLowerCase();
    return Boolean(this.order.cardMessage || (template && !template.includes('kh\u00f4ng')));
  }

  // ===== PAYMENT COMPUTED VALUES =====
  get totalQty(): number {
    return this.order.products.reduce((sum, product) => sum + product.qty, 0);
  }

  get computedSubtotal(): number {
    const productSubtotal = this.order.products.reduce((sum, product) => sum + product.qty * product.price, 0);
    return this.order.subtotal || productSubtotal;
  }

  get computedVoucherDiscount(): number {
    return this.order.voucher ? this.order.voucherDiscount : 0;
  }

  get computedLoyaltyDiscount(): number {
    return this.order.loyaltyPoints ? this.order.loyaltyDiscount : 0;
  }

  get computedTotalBeforeTax(): number {
    if (this.order.total) {
      return Math.max(this.order.total - this.order.tax, 0);
    }

    return this.computedSubtotal + this.order.shippingFee - this.computedVoucherDiscount - this.computedLoyaltyDiscount;
  }

  get computedGrandTotal(): number {
    return this.order.total || (this.computedTotalBeforeTax + this.order.tax);
  }

  get computedPaid(): number {
    if (this.order.paid > 0) {
      return Math.min(this.order.paid, this.computedGrandTotal);
    }

    if (this.order.paymentStatus === '\u0110\u00e3 thanh to\u00e1n') {
      return this.computedGrandTotal;
    }

    return 0;
  }

  get computedRemaining(): number {
    if (this.order.total) {
      return Math.max(this.order.remaining, 0);
    }

    return Math.max(this.computedGrandTotal - this.computedPaid, 0);
  }

  // ===== STATUS UPDATE =====
  toggleStatusDropdown(): void {
    this.showStatusDropdown = !this.showStatusDropdown;
    this.selectedNextStatus = this.showStatusDropdown ? this.nextAllowedStatus : '';
  }

  closeStatusDropdown(): void {
    this.showStatusDropdown = false;
    this.selectedNextStatus = '';
  }

  applySelectedStatus(): void {
    if (!this.selectedNextStatus || !this.order.id || this.isStatusOptionDisabled(this.selectedNextStatus)) return;

    if (!this.hasUpdatablePaymentStatus) {
      this.showToast('Chỉ đơn đã cọc hoặc đã thanh toán thành công mới được cập nhật trạng thái.', 'error');
      this.closeStatusDropdown();
      return;
    }

    if (this.selectedNextStatus === REFUND_REJECTED_STATUS) {
      this.customerRefundReason = this.order.refundReason;
      this.openRejectPopup();
      return;
    }

    this.persistOrderStatus(this.selectedNextStatus);
  }

  private persistOrderStatus(status: OrderStatus, rejectReason?: string): void {
    const previousStatus = this.order.orderStatus;
    this.order.orderStatus = status;
    this.closeStatusDropdown();

    this.adminApi.updateOrderStatus(this.order.id, status, rejectReason).subscribe({
      next: () => {
        this.lastLoadedOrderId = '';
        this.fetchOrderDetailOnce(this.order.id);
      },
      error: (error) => {
        console.error('Cannot update order status', error);
        this.order.orderStatus = previousStatus;
        this.showToast(
          error?.error?.message || 'Không thể cập nhật trạng thái đơn hàng.',
          'error'
        );
      },
    });
  }

  private showToast(message: string, type: ToastType = 'success'): void {
    this.toastMessage = message;
    this.toastType = type;
    this.toastVisible = true;

    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
    }

    this.toastTimeoutId = setTimeout(() => {
      this.toastVisible = false;
    }, 2500);
  }

  // ===== SHIPPER =====
  private ensureDefaultShipper(): void {
    if (this.order.shipperName || this.order.shipperPhone) {
      return;
    }

    const defaultShipper = this.shippers[0];
    if (!defaultShipper) {
      return;
    }

    this.order.shipperName = defaultShipper.name;
    this.order.shipperPhone = defaultShipper.phone;
    this.order.shipperAvatar = defaultShipper.avatar;
  }

  toggleShipperDropdown(): void {
    this.showShipperDropdown = !this.showShipperDropdown;
  }

  selectShipper(shipper: Shipper): void {
    this.order.shipperName = shipper.name;
    this.order.shipperPhone = shipper.phone;
    this.order.shipperAvatar = shipper.avatar;
    this.showShipperDropdown = false;
  }

  // ===== ADMIN NOTE =====
  startEditNote(): void {
    this.noteTemp = this.order.adminNote;
    this.editingNote = true;
  }

  saveNote(): void {
    this.order.adminNote = this.noteTemp;
    this.editingNote = false;
  }

  cancelEditNote(): void {
    this.editingNote = false;
  }

  // ===== REPLY REVIEW =====
  submitReply(): void {
    const reply = this.replyText.trim();
    if (!reply || !this.order.reviewId) return;

    this.adminApi.replyToReview(this.order.reviewId, reply).subscribe({
      next: (response) => {
        this.order.adminReplyText = response.review.shopReply;
        this.order.adminReplyTime = response.review.shopReplyDate
          ? this.formatDateTime(new Date(response.review.shopReplyDate))
          : this.formatDateTime(new Date());
        this.replyText = '';
        this.isReplying = false;
      },
      error: (error) => console.error('Cannot reply to review', error),
    });
  }

  // ===== HELPERS =====
  lineTotal(product: { qty: number; price: number }): number {
    return product.qty * product.price;
  }

  formatVND(value: number): string {
    return value.toLocaleString('vi-VN') + 'đ';
  }

  formatDateTime(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }

  stars(count: number): number[] {
    return Array.from({ length: count });
  }

  goBack(): void {
    history.back();
  }

  printOrder(): void {
    window.print();
  }

  editOrder(): void {
    this.startEdit();
  }

  replyReview(): void {
    this.isReplying = true;
  }
  // ===== REFUND REJECT POPUP =====
  showRejectPopup = false;
  rejectReasonInput = '';
  rejectReasonError = '';

  rejectReasonOptions = [
    'Sản phẩm không có lỗi',
    'Đã quá thời hạn hoàn trả',
    'Không đủ bằng chứng',
    'Lý do không hợp lệ',
  ];

  customerRefundReason = '';
  adminRejectReason = '';
  openRejectPopup(): void {
  this.showRejectPopup = true;
  this.rejectReasonInput = '';
  this.rejectReasonError = '';
}

closeRejectPopup(): void {
  this.showRejectPopup = false;
  this.rejectReasonInput = '';
  this.rejectReasonError = '';
}

confirmReject(): void {
  if (!this.rejectReasonInput.trim()) {
    this.rejectReasonError = 'Vui l\u00f2ng nh\u1eadp l\u00fd do t\u1eeb ch\u1ed1i!';
    return;
  }

  this.adminRejectReason = this.rejectReasonInput.trim();
  this.closeRejectPopup();
  this.persistOrderStatus(REFUND_REJECTED_STATUS, this.adminRejectReason);
}


}
