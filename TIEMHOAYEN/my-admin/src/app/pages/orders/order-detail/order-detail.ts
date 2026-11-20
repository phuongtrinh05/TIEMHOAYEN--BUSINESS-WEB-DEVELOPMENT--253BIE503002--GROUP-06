import { formatDateTime24 } from '../../../shared/date-time';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminApiService, AdminOrderDetail, CashCollection } from '../../../services/admin-api.service';
import { combineLatest, firstValueFrom, interval, Subscription } from 'rxjs';

// ===== TYPES =====
export type OrderStatus =
  | 'Đã xác nhận đơn hàng'
  | 'Đã đặt hàng thành công'
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
  | 'Đã hủy'
  | 'Chờ thanh toán'
  | 'Thanh toán thất bại'
  | 'Giao không thành công';

export type PaymentStatus = 'Đã thanh toán' | 'Chờ thanh toán' | 'Đã cọc' | 'Thanh toán thất bại';

export interface OrderProduct {
  id: string;
  name: string;
  image: string;
  qty: number;
  price: number;
}

export interface Shipper {
  id: string;
  name: string;
  phone: string;
  avatar: string;
}

export interface IOrderDetail {
  snapshotAvailable?: boolean;
  allowedStatuses?: string[]; nextStep?: { nextStatus: string | null; blocked: boolean; reason: string; action: string }; history?: any[]; preparationHistory?: any[]; preparationAt?: string | null; preparationStartedAt?: string | null; preparationStartedBy?: string | null; materialIssued?: boolean; materialExportId?: string | null; preparationPriority?: { level: string; label: string; minutesToT: number | null };
  id: string;
  requestId?: string | null;
  orderVersion?: string | null;
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
  giftCard?: any;
  handoverMedia?: string[];
  supportDeadline?: string | null;
  supportException?: { until: string; reason: string; actor: string; at: string } | null;
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
  refunded: number;
  pendingCollection?: { amount: number; items: CashCollection[] };
  paymentSummary?: { totalPayable:number; requiredDeposit:number; successfulReceiptsTotal:number; actualRefundsTotal:number; netCollected:number; remainingAmount:number; paymentStatus:string };
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
  adminRejectReason?: string;
}

export interface TimelineStep {
  action?: string;
  actor?: string;
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
  'Đã xác nhận đơn hàng',
  'Đã đặt hàng thành công',
  'Chờ xử lý',
  'Đang chuẩn bị hàng',
  'Chờ vận chuyển',
  'Đang giao',
  'Giao thành công',
  'Giao không thành công',
  'Yêu cầu hoàn tiền/trả hàng',
  'Chấp nhận hoàn tiền',
  'Đang hoàn tiền',
  'Đã hoàn tiền',
  'Từ chối hoàn tiền/trả hàng',
  'Hoàn thành',
  'Đã hủy',
];

const BASE_STATUS_OPTIONS: OrderStatus[] = ['Đã đặt hàng thành công','Đang chuẩn bị hàng','Chờ vận chuyển','Đang giao','Giao thành công','Hoàn thành','Đã hủy'];

const REFUND_REQUEST_STATUS: OrderStatus = 'Yêu cầu hoàn tiền/trả hàng';
const REFUND_ACCEPTED_STATUS: OrderStatus = 'Chấp nhận hoàn tiền';
const REFUND_REJECTED_STATUS: OrderStatus = 'Từ chối hoàn tiền/trả hàng';
const REFUND_STATUS_OPTIONS: OrderStatus[] = [
  'Chấp nhận hoàn tiền','Đang hoàn tiền','Đã hoàn tiền','Từ chối hoàn tiền/trả hàng',
];


const STEP_CONFIG: Record<OrderStatus, { icon: string }> = {
  'Đã xác nhận đơn hàng': { icon: 'bi-patch-check' },
  'Đã đặt hàng thành công': { icon: 'bi-check-circle-fill' },
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
  'Chờ thanh toán': { icon: 'bi-clock' },
  'Thanh toán thất bại': { icon: 'bi-x-lg' },
  'Giao không thành công': { icon: 'bi-truck' },
};

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, RouterLink],
  templateUrl: './order-detail.html',
  styleUrls: ['./order-detail.css', './order-detail-refinement.css'],
})
export class OrderDetail implements OnInit, OnDestroy {
  constructor(
    private readonly route: ActivatedRoute,
    private readonly adminApi: AdminApiService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  order: IOrderDetail = this.createEmptyOrder();

  shippers: Shipper[] = [];
  

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
      refunded: 0,
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
      adminRejectReason: '',
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
  private liveRefreshSub?: Subscription;
  private liveRefreshOrderId = '';
  private readonly liveRefreshMs = 10000;
  private isLiveRefreshInFlight = false;
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
  savingDelivery = false;
  editSnapshot: IOrderDetail | null = null;

  ngOnInit(): void {
    this.loadEligibleShippers();
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
        this.startLiveDatabaseRefresh(orderId);
      } else {
        this.stopLiveDatabaseRefresh();
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.stopLiveDatabaseRefresh();
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

  private loadOrderDetail(orderId: string, isLiveRefresh = false): void {
    if (isLiveRefresh && this.isLiveRefreshInFlight) {
      return;
    }

    if (isLiveRefresh) {
      this.isLiveRefreshInFlight = true;
    } else {
      this.isLoadingOrder = true;
      this.orderLoadError = '';
    }

    this.adminApi.getOrderDetail(orderId).subscribe({
      next: (response) => {
        this.applyApiOrderDetail(response.order);
        this.isLoadingOrder = false;
        this.isLiveRefreshInFlight = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Cannot load order detail', error);
        if (!isLiveRefresh) {
          this.orderLoadError = 'Cannot load order detail from database.';
        }
        this.isLoadingOrder = false;
        this.isLiveRefreshInFlight = false;
        this.cdr.detectChanges();
      },
    });
  }

  private startLiveDatabaseRefresh(orderId: string): void {
    if (this.liveRefreshOrderId === orderId && this.liveRefreshSub) {
      return;
    }

    this.stopLiveDatabaseRefresh();
    this.liveRefreshOrderId = orderId;
    this.liveRefreshSub = interval(this.liveRefreshMs).subscribe(() => {
      if (this.shouldPauseLiveRefresh()) {
        return;
      }

      this.loadOrderDetail(orderId, true);
    });
  }

  private stopLiveDatabaseRefresh(): void {
    this.liveRefreshSub?.unsubscribe();
    this.liveRefreshSub = undefined;
    this.liveRefreshOrderId = '';
    this.isLiveRefreshInFlight = false;
  }

  private shouldPauseLiveRefresh(): boolean {
    return (
      this.isEditing ||
      this.editingNote ||
      this.isReplying ||
      this.showShipperDropdown ||
      this.showStatusDropdown ||
      this.showRejectPopup ||
      this.showCashPopup
    );
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
    if (source.preparationAt) {
      const preparationAt = new Date(source.preparationAt);
      this.preparationInput = Number.isFinite(preparationAt.getTime()) && preparationAt.getTime() > Date.now()
        ? this.toLocalDateTimeInput(source.preparationAt)
        : '';
    } else this.preparationInput = '';
    this.ensureDefaultShipper();
    this.loadAfterSales();
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
      paid: 0,
      remaining: total || this.order.remaining,
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
    if (value === 'Đã giao' || value === 'Giao hàng thành công') {
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
    if (!this.canEdit || this.savingDelivery) return;
    const slot = String(this.order.deliverySlot || '').trim().replace(/\s*[-–]\s*/g, '–');
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(this.order.deliveryDate || '').trim())) { this.showToast('Ngày giao theo dạng dd/mm/yyyy.', 'error'); return; }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?:–(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(slot)) { this.showToast('Khung giờ theo dạng HH:mm hoặc HH:mm–HH:mm, trong 08:00–22:00.', 'error'); return; }
    this.order.deliverySlot = slot;
    this.savingDelivery = true;
    const parts = String(this.order.deliveryDate || '').split('/');
    const deliveryDate = parts.length === 3
      ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
      : String(this.order.deliveryDate || '');
    this.adminApi.updateOrderMetadata(this.order.id, {
      action: 'delivery',
      expectedVersion: this.order.orderVersion,
      receiverName: this.order.receiverName,
      receiverPhone: this.order.receiverPhone,
      deliveryAddress: this.order.deliveryAddress,
      deliveryDate,
      deliverySlot: this.order.deliverySlot,
    }).subscribe({
      next: response => {
        this.savingDelivery = false;
        this.applyApiOrderDetail(response.order);
        this.isEditing = false;
        this.editSnapshot = null;
        this.showToast('Đã lưu thông tin giao hàng.');
        this.cdr.detectChanges();
      },
      error: error => { this.savingDelivery = false; this.showToast(error?.error?.message || 'Chưa lưu được thay đổi.', 'error'); this.cdr.detectChanges(); },
    });
  }


  // ===== TIMELINE =====
  get timeline(): TimelineStep[] {
    const history = (this.order.history || []).filter(event => event.action !== 'preparation' && event.action !== 'assign-shipper');
    return history.length ? history.map(h => ({ status: this.toDetailOrderStatus(h.to), action: h.action === 'note' ? 'Cập nhật ghi chú nội bộ' : h.action === 'delivery' ? 'Cập nhật thông tin giao hàng' : h.action === 'handover-media' ? 'Cập nhật ảnh/video bàn giao' : '', actor: h.actor || '', time: formatDateTime24(h.at), done: true, icon: STEP_CONFIG[this.toDetailOrderStatus(h.to)]?.icon || 'bi-clock' }))
      : [{ status: this.order.orderStatus, time: this.order.createdAt ? 'Ngày tạo: ' + this.order.createdAt : '', done: true, icon: STEP_CONFIG[this.order.orderStatus]?.icon || 'bi-clock' }];
  }

  timelineIconClass(status: OrderStatus): string {
    const map: Partial<Record<OrderStatus, string>> = {
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

    return map[status] || 'timeline-icon--pending';
  }

  orderStatusIcon(status: OrderStatus): string {
    return STEP_CONFIG[status].icon;
  }

  orderStatusBadgeClass(status: OrderStatus): string {
    return this.timelineIconClass(status).replace('timeline-icon--', 'order-status-badge--');
  }

  get statusOptions(): OrderStatus[] {
    const allowed = (this.order.allowedStatuses || []).map(s => this.toDetailOrderStatus(s));
    return [...new Set([...BASE_STATUS_OPTIONS, ...allowed])];
  }

  get nextAllowedStatus(): OrderStatus | '' {
    return this.statusOptions.find((status) => !this.isStatusOptionDisabled(status)) || '';
  }

  get canApplySelectedStatus(): boolean {
    return Boolean(!this.preparationBusy && this.selectedNextStatus && !this.isStatusOptionDisabled(this.selectedNextStatus));
  }

  isStatusOptionDisabled(status: OrderStatus): boolean {
    const canonical = status === 'Giao thành công' ? 'Đã giao' : status;
    return this.isStatusCompleted(status) || !this.adminApi.can('orders', 'update') || !(this.order.allowedStatuses || []).includes(canonical);
  }

  isStatusCompleted(status: OrderStatus): boolean {
    const normalize = (value: OrderStatus) => value === 'Giao thành công' ? 'Giao thành công' : value;
    const current = BASE_STATUS_OPTIONS.indexOf(normalize(this.order.orderStatus));
    const target = BASE_STATUS_OPTIONS.indexOf(normalize(status));
    return current >= 0 && target >= 0 && target <= current;
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

  /** Sửa thông tin giao hàng: có quyền cập nhật đơn và đơn chưa bắt đầu chuẩn bị (server kiểm tra lại). */
  get canEdit(): boolean {
    return this.adminApi.can('orders', 'update')
      && ['Chờ thanh toán', 'Đã xác nhận đơn hàng', 'Chờ xử lý', 'Đã đặt hàng thành công'].includes(String(this.order.orderStatus))
      && !this.order.preparationStartedAt;
  }

  isOrderDelivering(): boolean {
    return this.order.orderStatus === 'Đang giao';
  }

  getDeliveryProgress(): number {
    const status = this.order.orderStatus;

    if (status === 'Đã hủy') {
      return 0;
    }

    if (this.isRefundFlow || status === 'Hoàn thành') {
      return 100;
    }

    const deliveryStatuses = BASE_STATUS_OPTIONS.filter((item) => item !== 'Đã hủy');
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

  get computedPaid(): number { return Math.max(0, Number(this.order.paid || 0)); }

  get computedRemaining(): number {
    if (this.order.total) {
      return Math.max(this.order.remaining, 0);
    }

    return Math.max(this.computedGrandTotal - this.computedPaid, 0);
  }

  // ===== STATUS UPDATE =====
  toggleStatusDropdown(): void {
    this.showStatusDropdown = !this.showStatusDropdown;
    // Chỉ chọn sẵn bước tiếp theo chính; không bao giờ chọn sẵn "Đã hủy".
    const main = this.statusOptions.find(status => status !== 'Đã hủy' && !this.isStatusOptionDisabled(status)) || '';
    this.selectedNextStatus = this.showStatusDropdown ? main : '';
  }

  closeStatusDropdown(): void {
    this.showStatusDropdown = false;
    this.selectedNextStatus = '';
  }

  applySelectedStatus(): void {
    if (!this.canApplySelectedStatus || !this.selectedNextStatus || !this.order.id) return;

    if (this.selectedNextStatus === 'Đang chuẩn bị hàng') {
      this.startPreparation();
      return;
    }

    if (['Đã giao', 'Giao thành công', 'Giao hàng thành công'].includes(this.selectedNextStatus) && this.outstandingAtDelivery > 0) {
      this.openCashPopup(this.selectedNextStatus);
      return;
    }

    if (this.selectedNextStatus === REFUND_REJECTED_STATUS) {
      this.customerRefundReason = this.order.refundReason;
      this.openRejectPopup();
      return;
    }

    this.persistOrderStatus(this.selectedNextStatus);
  }

  private persistOrderStatus(status: OrderStatus, rejectReason?: string, cashCollection?: { amount: number; method: string; note?: string; proof?: string }): void {
    const previousStatus = this.order.orderStatus;
    this.order.orderStatus = status;
    this.closeStatusDropdown();

    this.adminApi.updateOrderStatus(this.order.id, status, rejectReason, cashCollection).subscribe({
      next: (response) => {
        if (response?.message && response.message !== 'Order status updated.') this.showToast(response.message);
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
    this.cdr.markForCheck();

    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
    }

    this.toastTimeoutId = setTimeout(() => {
      this.toastVisible = false;
      this.cdr.markForCheck();
    }, 2500);
  }

  // ===== SHIPPER =====
  private ensureDefaultShipper(): void {}

  private loadEligibleShippers(): void {
    this.adminApi.getDeliveryStaff().subscribe({
      next: response => {
        const rows: any[] = (response as any).accounts || (response as any).staff || [];
        this.shippers = rows.filter(row => /giao|shipper|vận chuyển|van chuyen/i.test(String(row.role || row.VAI_TRO || ''))
          && !/khóa|nghỉ|inactive/i.test(String(row.status || row.TRANG_THAI || '')))
          .map(row => ({ id:row.code || row.NHAN_VIEN_ID, name:row.name || row.HO_TEN, phone:row.phone || row.SDT || '', avatar:row.avatar || 'assets/images/logo-main.png' }));
        this.cdr.markForCheck();
      },
      error: () => { this.shippers = []; this.cdr.markForCheck(); },
    });
  }

  openShipperAssignment(): void {
    this.closeStatusDropdown();
    const picker = document.getElementById('order-shipper-picker');
    picker?.scrollIntoView({ block: 'center' });
    picker?.focus({ preventScroll: true });
    if (!this.showShipperDropdown) this.toggleShipperDropdown();
  }

  toggleShipperDropdown(): void {
    if (!this.canEditNote) return;
    if (!this.shippers.length) { this.showToast('Chưa có nhân viên giao hàng đang hoạt động.', 'error'); return; }
    this.showShipperDropdown = !this.showShipperDropdown;
  }

  selectShipper(shipper: Shipper): void {
    this.adminApi.updateOrderMetadata(this.order.id, { action:'assign-shipper', shipperId:shipper.id, expectedVersion:this.order.orderVersion }).subscribe({
      next: response => { this.applyApiOrderDetail(response.order); this.showShipperDropdown=false; this.showToast('Đã phân công nhân viên giao hàng.'); this.cdr.detectChanges(); },
      error: error => this.showToast(error?.error?.message || 'Chưa phân công được nhân viên giao hàng.', 'error'),
    });
  }

  // ===== ADMIN NOTE =====
  afterSales: any[]=[]; afterSalesBusy=false; afterSalesError=''; afterSalesReason=''; afterSalesRejectCode=''; maxRefund=0; refundAmount=0; refundReference=''; transferred=false;
  deviationReason='';
  supportExceptionReason=''; supportExceptionBusy=false;
  /** Đơn đã giao/hoàn thành, hết hạn gửi hỗ trợ và không có hồ sơ đang mở: cho phép mở ngoại lệ có lý do. */
  get canOpenSupportException(): boolean {
    const deadline = this.order.supportDeadline ? new Date(this.order.supportDeadline).getTime() : NaN;
    const status = String(this.order.orderStatus || '');
    return this.canEditNote && Number.isFinite(deadline) && deadline < Date.now()
      && ['Đã giao', 'Giao thành công', 'Giao hàng thành công', 'Hoàn thành'].includes(status)
      && !this.afterSales.some((r: any) => r.active);
  }
  openSupportException(): void {
    const reason = this.supportExceptionReason.trim();
    if (this.supportExceptionBusy || reason.length < 10) return;
    this.supportExceptionBusy = true;
    this.adminApi.updateOrderMetadata(this.order.id, { action: 'support-exception', reason }).subscribe({
      next: r => { this.supportExceptionBusy = false; this.supportExceptionReason = ''; this.applyApiOrderDetail(r.order); this.showToast('Đã mở thêm 1 giờ cho khách gửi yêu cầu hỗ trợ.'); this.cdr.detectChanges(); },
      error: e => { this.supportExceptionBusy = false; this.showToast(e?.error?.message || 'Chưa mở được ngoại lệ.', 'error'); this.cdr.detectChanges(); },
    });
  }
  get isAdminRole(): boolean { return String(localStorage.getItem('adminRole') || '').trim().toLowerCase() === 'admin'; }
  /** Khớp server: hoàn trên 2 triệu hoặc trên 50% giá trị đơn cần Admin duyệt lần 2. */
  needsSecondApproval(amount: number): boolean { const total = Number(this.order.total || 0); return amount > 2_000_000 || (total > 0 && amount > total * 0.5); }
  loadAfterSales() { if(!this.order.id)return; this.adminApi.getAfterSales(this.order.id).subscribe({next:r=>{this.afterSales=r.requests||[];
    const reviewing=this.afterSales.find((x:any)=>x.active&&x.status==='Đang xem xét'&&x.suggestion);
    if(reviewing&&!this.maxRefund)this.maxRefund=Number(reviewing.suggestion.amount||0);
    const awaiting=this.afterSales.find((x:any)=>x.active&&['Chờ hoàn tiền','Cần đối soát hoàn tiền'].includes(x.status));
    if(awaiting&&!this.refundAmount)this.refundAmount=Number(awaiting.decision?.maxRefund||0);
    this.cdr.markForCheck();},error:e=>{this.afterSalesError=e?.error?.message||'Chưa tải được hồ sơ.';this.cdr.markForCheck();}}); }
  actAfterSales(r:any,action:string) { if(this.afterSalesBusy||!this.canEditNote)return;if(action==='refund'&&!this.transferred){this.afterSalesError='Chỉ xác nhận sau khi chuyển tiền và đối soát chứng từ.';return;}this.afterSalesBusy=true;this.adminApi.changeAfterSales(r.requestId,{version:r.version,action,reason:this.afterSalesReason,reasonCode:this.afterSalesRejectCode||(action==='reject'?'OTHER':''),maxRefund:Number(this.maxRefund),deviationReason:this.deviationReason,amount:Number(this.refundAmount),reference:this.refundReference,transferred:this.transferred}).subscribe({next:()=>{this.afterSalesBusy=false;this.afterSalesReason='';this.afterSalesRejectCode='';this.transferred=false;this.deviationReason='';this.loadAfterSales();this.lastLoadedOrderId='';this.fetchOrderDetailOnce(this.order.id);},error:e=>{this.afterSalesBusy=false;this.afterSalesError=e?.error?.message||'Chưa xử lý được.';this.cdr.markForCheck();}}); }
  receiveAfterSalesReturn(request: any): void {
    if (this.afterSalesBusy || !this.canEditNote) return;
    const items = (request.items || []).map((item: any) => ({
      productId: item.productId,
      receivedQuantity: Number(item.receivedQuantity || 0),
      sellableQuantity: Number(item.sellableQuantity || 0),
    })).filter((item: any) => item.receivedQuantity > 0);
    if (!items.length || !this.afterSalesReason.trim()) {
      this.afterSalesError = 'Nhập số lượng thực nhận, số lượng còn bán được và kết quả kiểm tra.';
      return;
    }
    this.afterSalesBusy = true;
    this.adminApi.changeAfterSales(request.requestId, { version: request.version, action: 'receive-return', reason: this.afterSalesReason.trim(), items }).subscribe({
      next: () => { this.afterSalesBusy = false; this.afterSalesReason = ''; this.loadAfterSales(); this.lastLoadedOrderId = ''; this.fetchOrderDetailOnce(this.order.id); },
      error: error => { this.afterSalesBusy = false; this.afterSalesError = error?.error?.message || 'Chưa ghi nhận được hàng trả.'; this.cdr.markForCheck(); },
    });
  }
  preparationInput = '';
  preparationReason = '';
  preparationBusy = false;
  get canSetPreparation(): boolean { return this.adminApi.can('orders', 'update') && ['Đã xác nhận đơn hàng', 'Đã đặt hàng thành công', 'Chờ xử lý'].includes(this.order.orderStatus); }
  get minimumPreparationInput(): string {
    const date = new Date(Date.now() + 60_000);
    date.setSeconds(0, 0);
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  get preparationInputInvalid(): boolean {
    if (!this.preparationInput) return true;
    const at = new Date(this.preparationInput);
    return !Number.isFinite(at.getTime()) || at.getTime() <= Date.now();
  }
  validatePreparationInput(): void {
    if (!this.preparationInput) return;
    const at = new Date(this.preparationInput);
    if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) {
      this.preparationInput = '';
      this.showToast('Không được nhập thời điểm chuẩn bị trong quá khứ.', 'error');
    }
  }
  savePreparation(): void {
    if (this.preparationBusy) return;
    const at = new Date(this.preparationInput);
    if (!Number.isFinite(at.getTime())) { this.showToast('Nhập thời điểm T hợp lệ.', 'error'); return; }
    if (at.getTime() <= Date.now()) { this.showToast('Thời điểm chuẩn bị phải sau thời điểm hiện tại.', 'error'); return; }
    if (!this.preparationReason.trim()) { this.showToast('Nhập lý do lập hoặc điều chỉnh lịch chuẩn bị.', 'error'); return; }
    this.preparationBusy = true;
    this.adminApi.updateOrderMetadata(this.order.id, { action: 'preparation', preparationAt: at.toISOString(), reason: this.preparationReason.trim() }).subscribe({ next: r => { this.preparationBusy = false; this.preparationReason = ''; this.applyApiOrderDetail(r.order); this.showToast('Đã lưu thời điểm chuẩn bị dự kiến T.'); this.cdr.detectChanges(); }, error: e => { this.preparationBusy = false; this.showToast(e?.error?.message || 'Chưa lưu được T.', 'error'); } });
  }
  startPreparation(): void {
    if (this.preparationBusy) return;
    this.preparationBusy = true;
    this.adminApi.updateOrderMetadata(this.order.id, { action: 'start-preparation' }).subscribe({
      next: r => { this.preparationBusy = false; this.applyApiOrderDetail(r.order); this.closeStatusDropdown(); this.showToast('Đã bắt đầu chuẩn bị đơn.'); this.cdr.detectChanges(); },
      error: e => { this.preparationBusy = false; this.showToast(e?.error?.message || 'Chưa thể bắt đầu chuẩn bị.', 'error'); },
    });
  }
  private toLocalDateTimeInput(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  handoverBusy = false;
  get handoverMediaList(): string[] { return this.order.handoverMedia || []; }

  /** Tải từng ảnh lên server rồi lưu danh sách URL vào đơn (tối đa 10 ảnh). */
  async onHandoverFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length || this.handoverBusy) return;
    const room = 10 - this.handoverMediaList.length;
    if (room <= 0) { this.showToast('Đã đủ 10 ảnh bàn giao.', 'error'); return; }
    const selected = files.slice(0, room);
    const tooLarge = selected.find(file => file.size > 5 * 1024 * 1024);
    if (tooLarge) { this.showToast(`Ảnh "${tooLarge.name}" vượt quá 5MB.`, 'error'); return; }
    this.handoverBusy = true;
    this.cdr.detectChanges();
    try {
      const uploaded: string[] = [];
      for (const file of selected) {
        const result = await firstValueFrom(this.adminApi.uploadHandoverImage(this.order.id, file));
        if (result?.url) uploaded.push(result.url);
      }
      this.saveHandoverMedia([...this.handoverMediaList, ...uploaded], `Đã đính kèm ${uploaded.length} ảnh bàn giao.`);
      if (files.length > selected.length) this.showToast('Chỉ lưu tối đa 10 ảnh bàn giao.', 'error');
    } catch (error: any) {
      this.handoverBusy = false;
      this.showToast(error?.error?.message || 'Chưa tải được ảnh bàn giao.', 'error');
      this.cdr.detectChanges();
    }
  }

  removeHandoverMedia(index: number): void {
    if (this.handoverBusy) return;
    this.handoverBusy = true;
    this.saveHandoverMedia(this.handoverMediaList.filter((_, i) => i !== index), 'Đã xóa ảnh bàn giao.');
  }

  private saveHandoverMedia(media: string[], successMessage: string): void {
    this.handoverBusy = true;
    this.adminApi.updateOrderMetadata(this.order.id, { action: 'handover-media', media }).subscribe({
      next: response => {
        this.handoverBusy = false;
        this.applyApiOrderDetail(response.order);
        this.showToast(successMessage);
        this.cdr.detectChanges();
      },
      error: error => {
        this.handoverBusy = false;
        this.showToast(error?.error?.message || 'Chưa cập nhật được ảnh bàn giao.', 'error');
        this.cdr.detectChanges();
      },
    });
  }
  get canEditNote(): boolean { return this.adminApi.can('orders','update'); }
  startEditNote(): void {
    if (!this.adminApi.can('orders', 'update')) return;
    this.noteTemp = this.order.adminNote;
    this.editingNote = true;
  }

  saveNote(): void {
    if (!this.canEditNote) return;
    this.adminApi.updateOrderMetadata(this.order.id, { action: 'note', adminNote: this.noteTemp, expectedVersion:this.order.orderVersion }).subscribe({
      next: response => {
        this.applyApiOrderDetail(response.order);
        this.editingNote = false;
        this.showToast('Đã lưu ghi chú nội bộ.');
        this.cdr.detectChanges();
      },
      error: error => this.showToast(error?.error?.message || 'Chưa lưu được ghi chú.', 'error'),
    });
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

  /**
   * In phiếu đơn hàng A4. In qua iframe ẩn trong chính trang (không mở cửa sổ mới) để không bị chặn popup
   * và không in nhầm giao diện quản trị.
   */
  printOrder(): void {
    const safe = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char] || char));
    const money = (value: unknown) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;
    const o = this.order;
    const rows = o.products.map((product, index) => `<tr><td class="center">${index + 1}</td><td>${safe(product.name)}</td><td class="center">${product.qty}</td><td class="right">${money(product.price)}</td><td class="right">${money(product.qty * product.price)}</td></tr>`).join('')
      || '<tr><td colspan="5" class="center">Không có sản phẩm</td></tr>';
    const printedAt = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Phiếu đơn hàng ${safe(o.id)}</title><style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#2d2421;font:12.5px Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{max-width:186mm;margin:auto}.head{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #7b1f24;padding-bottom:10px}
.brand h1{margin:0;color:#7b1f24;font:700 24px Georgia,serif;letter-spacing:1px}.brand p,.meta p{margin:3px 0}.meta{text-align:right}
.title{text-align:center;margin:16px 0 12px}.title h2{margin:0;color:#7b1f24;font-size:20px;letter-spacing:1px}.title p{margin:4px 0 0;color:#6b5a54}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}.box{border:1px solid #d8cbc5;border-radius:6px;padding:10px;break-inside:avoid}
.box h3{margin:0 0 6px;color:#7b1f24;font-size:12px;text-transform:uppercase}.box p{margin:3px 0;line-height:1.4}
table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #d8cbc5;padding:7px}th{background:#f6ece7;color:#6e1c21;font-size:12px}
.center{text-align:center}.right{text-align:right}.bottom{display:grid;grid-template-columns:1fr 300px;gap:14px;align-items:start}
.totals div{display:flex;justify-content:space-between;padding:3px 0}.totals .grand{border-top:2px solid #7b1f24;margin-top:4px;padding-top:7px;color:#7b1f24;font-size:15px;font-weight:bold}
.notes p{margin:3px 0;line-height:1.4}.sign{display:grid;grid-template-columns:1fr 1fr 1fr;text-align:center;margin-top:26px;gap:20px;break-inside:avoid}
.sign strong{display:block}.sign span{display:block;margin-top:58px;color:#888;font-size:11px}.foot{margin-top:18px;border-top:1px dashed #bda9a0;padding-top:6px;color:#8a7a74;font-size:11px;display:flex;justify-content:space-between}
</style></head><body><main class="sheet">
<header class="head"><div class="brand"><h1>TIỆM HOA YÊN</h1><p>Hotline: 0909 477 488</p></div><div class="meta"><p><b>Mã đơn:</b> ${safe(o.id)}</p><p><b>Ngày đặt:</b> ${safe(o.createdAt)} ${safe(o.createdTime)}</p><p><b>Trạng thái:</b> ${safe(o.orderStatus)}</p></div></header>
<section class="title"><h2>PHIẾU ĐƠN HÀNG</h2><p>Kiểm tra đầy đủ thông tin trước khi chuẩn bị và giao hoa</p></section>
<section class="grid"><div class="box"><h3>Người đặt</h3><p><b>Họ tên:</b> ${safe(o.senderName || '—')}</p><p><b>Điện thoại:</b> ${safe(o.senderPhone || '—')}</p><p><b>Email:</b> ${safe(o.senderEmail || '—')}</p></div>
<div class="box"><h3>Người nhận</h3><p><b>Họ tên:</b> ${safe(o.receiverName || '—')}</p><p><b>Điện thoại:</b> ${safe(o.receiverPhone || '—')}</p><p><b>Địa chỉ:</b> ${safe(o.deliveryAddress || '—')}</p></div></section>
<section class="grid"><div class="box"><h3>Giao hàng</h3><p><b>Ngày giao:</b> ${safe(o.deliveryDate || '—')}</p><p><b>Khung giờ:</b> ${safe(o.deliverySlot || '—')}</p><p><b>Nhân viên giao:</b> ${safe(o.shipperName || 'Chưa phân công')} ${o.shipperPhone ? '· ' + safe(o.shipperPhone) : ''}</p></div>
<div class="box"><h3>Thanh toán</h3><p><b>Phương thức:</b> ${safe(o.paymentMethod || '—')}</p><p><b>Tình trạng:</b> ${safe(o.paymentStatus || '—')}</p><p><b>Còn phải thu khi giao:</b> ${money(this.computedRemaining)}</p></div></section>
<table><thead><tr><th style="width:42px">STT</th><th>Sản phẩm</th><th style="width:52px">SL</th><th style="width:100px">Đơn giá</th><th style="width:110px">Thành tiền</th></tr></thead><tbody>${rows}</tbody></table>
<section class="bottom"><div class="box notes"><h3>Ghi chú</h3><p><b>Lời nhắn khách:</b> ${safe(o.customerNote || 'Không có')}</p><p><b>Thiệp:</b> ${safe(o.cardTemplate || 'Không chọn')}</p><p><b>Nội dung thiệp:</b> ${safe(o.cardMessage || 'Không có')}</p></div>
<div class="totals"><div><span>Tạm tính</span><b>${money(this.computedSubtotal)}</b></div><div><span>Phí giao hàng</span><b>${money(o.shippingFee)}</b></div><div><span>Giảm voucher</span><b>-${money(this.computedVoucherDiscount)}</b></div><div><span>Giảm điểm</span><b>-${money(this.computedLoyaltyDiscount)}</b></div><div class="grand"><span>Tổng cộng</span><span>${money(this.computedGrandTotal)}</span></div><div><span>Đã thanh toán</span><b>${money(this.computedPaid)}</b></div><div><span>Còn lại</span><b>${money(this.computedRemaining)}</b></div></div></section>
<section class="sign"><div><strong>Nhân viên lập phiếu</strong><span>Ký, ghi rõ họ tên</span></div><div><strong>Nhân viên giao hàng</strong><span>Ký, ghi rõ họ tên</span></div><div><strong>Người nhận hàng</strong><span>Ký, ghi rõ họ tên</span></div></section>
<footer class="foot"><span>Tiệm Hoa Yên · Phiếu đơn hàng ${safe(o.id)}</span><span>In lúc ${safe(printedAt)}</span></footer>
</main></body></html>`;
    document.getElementById('order-print-frame')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'order-print-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    if (!doc || !view) { frame.remove(); this.showToast('Chưa mở được bản in. Vui lòng thử lại.', 'error'); return; }
    doc.open();
    doc.write(html);
    doc.close();
    // Đợi trình duyệt dựng xong phiếu rồi mới gọi hộp thoại in.
    setTimeout(() => {
      try { view.focus(); view.print(); }
      catch { this.showToast('Trình duyệt chưa in được phiếu. Vui lòng thử lại.', 'error'); }
    }, 300);
  }

  printCard(): void {
    const card = this.order.giftCard || {};
    const popup = window.open('', '_blank', 'width=720,height=520');
    if (!popup) { this.showToast('Trình duyệt đang chặn cửa sổ in thiệp.', 'error'); return; }
    const safe = (value: unknown) => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
    popup.document.write(`<!doctype html><html><head><title>Thiệp tặng</title><style>body{font-family:Georgia,serif;background:#fff8f5;color:#731919;padding:42px}.card{max-width:560px;margin:auto;border:2px solid #d9b382;border-radius:24px;padding:42px;text-align:center}.name{font-size:28px;margin:0 0 24px}.message{font-size:21px;line-height:1.7;white-space:pre-wrap}.brand{margin-top:34px;letter-spacing:3px}</style></head><body><article class="card"><h1 class="name">${safe(card.name || this.order.cardTemplate)}</h1><div class="message">${safe(this.order.cardMessage)}</div><div class="brand">TIỆM HOA YÊN</div></article><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  }

  editOrder(): void {
    this.startEdit();
  }

  replyReview(): void {
    this.isReplying = true;
  }
  // ===== HOÀN TIỀN ĐƠN ĐÃ HỦY =====
  refundCaseBusy = false;
  /** Tiền shop đang giữ của đơn đã hủy (đã thu − đã hoàn). */
  get cancelledRefundDue(): number {
    if (this.order.orderStatus !== 'Đã hủy') return 0;
    return Math.max(0, Number(this.order.paymentSummary?.netCollected ?? (Number(this.order.paid || 0) - Number(this.order.refunded || 0))));
  }
  get canOpenRefundCase(): boolean {
    return this.canEditNote && this.cancelledRefundDue > 0 && !this.afterSales.some((r: any) => r.active);
  }
  openRefundCase(): void {
    if (this.refundCaseBusy || !this.canOpenRefundCase) return;
    this.refundCaseBusy = true;
    this.adminApi.updateOrderMetadata(this.order.id, { action: 'open-refund-case', reason: 'Mở hồ sơ hoàn tiền cho đơn hủy đã thu tiền' }).subscribe({
      next: r => { this.refundCaseBusy = false; this.applyApiOrderDetail(r.order); this.showToast('Đã mở hồ sơ hoàn tiền.'); this.cdr.detectChanges(); },
      error: e => { this.refundCaseBusy = false; this.showToast(e?.error?.message || 'Chưa mở được hồ sơ hoàn tiền.', 'error'); this.cdr.detectChanges(); },
    });
  }

  // ===== THU TIỀN KHI GIAO (phương án A) =====
  readonly cashMethods = ['Tiền mặt', 'Chuyển khoản'];
  showCashPopup = false;
  cashTargetStatus: OrderStatus | '' = '';
  cashMethod = 'Tiền mặt';
  cashNote = '';
  cashProof = '';
  cashProofUploading = false;
  cashConfirmed = false;
  cashError = '';
  get pendingCashAmount(): number { return Number(this.order.pendingCollection?.amount || 0); }
  /** Phần khách còn phải trả khi nhận hàng (chưa xác minh, chưa khai báo). */
  get outstandingAtDelivery(): number {
    return Math.max(0, Number(this.order.total || 0) - this.computedPaid - this.pendingCashAmount);
  }
  openCashPopup(status: OrderStatus | string): void {
    this.cashTargetStatus = status as OrderStatus;
    this.cashMethod = 'Tiền mặt'; this.cashNote = ''; this.cashProof = ''; this.cashConfirmed = false; this.cashError = '';
    this.showStatusDropdown = false;
    this.showCashPopup = true;
  }
  closeCashPopup(): void { this.showCashPopup = false; this.cashError = ''; this.selectedNextStatus = ''; }
  async onCashProofSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.cashProofUploading) return;
    if (file.size > 5 * 1024 * 1024) { this.cashError = 'Ảnh chứng từ không được vượt quá 5MB.'; return; }
    this.cashProofUploading = true; this.cashError = ''; this.cdr.detectChanges();
    try {
      const result = await firstValueFrom(this.adminApi.uploadHandoverImage(this.order.id, file));
      this.cashProof = result?.url || '';
      if (!this.cashProof) throw new Error('UPLOAD_EMPTY');
    } catch (error: any) {
      this.cashProof = '';
      this.cashError = error?.error?.message || 'Chưa tải được ảnh chứng từ.';
    } finally { this.cashProofUploading = false; this.cdr.detectChanges(); }
  }
  confirmCashCollection(): void {
    if (this.cashProofUploading) { this.cashError = 'Vui lòng chờ tải ảnh chứng từ xong.'; return; }
    if (!this.cashConfirmed) { this.cashError = 'Hãy xác nhận đã nhận đủ số tiền của khách.'; return; }
    const proof = this.cashProof.trim();
    const status = this.cashTargetStatus as OrderStatus;
    const payload = { amount: this.outstandingAtDelivery, method: this.cashMethod, note: this.cashNote.trim(), proof };
    this.showCashPopup = false;
    this.persistOrderStatus(status, undefined, payload);
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
