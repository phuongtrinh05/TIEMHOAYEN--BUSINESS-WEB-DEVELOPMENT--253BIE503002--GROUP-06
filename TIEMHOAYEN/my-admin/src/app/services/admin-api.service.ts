import { Injectable } from '@angular/core';
import { mapPromotionCampaign, mapPromotionVoucher } from './promotion-mappers';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, switchMap, tap, timeout } from 'rxjs';
import { apiBaseUrl } from './api-config';

export interface AdminOrder {
  senderName?: string; receiverName?: string; deliveryDate?: string; deliverySlot?: string;
  products?: {name: string; qty: number}[]; deposit?: number; paid?: number; remaining?: number; allowedStatuses?: string[]; adminNote?: string;
  id: string;
  requestId?: string | null;
  customerId: string;
  createdAt: string;
  total: number;
  paymentStatus: string;
  orderStatus: string;
  selected: boolean;
}

export interface AdminOrdersResponse {
  total: number;
  orders: AdminOrder[];
}

export interface AdminStaffAccount {
  code: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  createdAt: string;
  createdDate: string;
  /** Hoạt động | Bị khóa | Nghỉ việc */
  status: string;
  lastLogin?: AdminLastLogin | null;
  loginLockedUntil?: string | null;
  selected: boolean;
}

export interface AdminStaffAccountsResponse {
  total: number;
  accounts: AdminStaffAccount[];
}

export interface AdminAuditLog {
  _id?: string;
  NHAT_KY_ID: string;
  NGUOI_THUC_HIEN_ID: string | null;
  LOAI_NGUOI_THUC_HIEN: string;
  HANH_DONG: string;
  DOI_TUONG_ID: string;
  THOI_GIAN: string;
  KET_QUA: string;
  NOI_DUNG_THAY_DOI: any;
  /** Tên và vai trò người thực hiện do server ghép thêm (AD55). */
  TEN_NGUOI_THUC_HIEN?: string;
  VAI_TRO_NGUOI_THUC_HIEN?: string;
}

export interface AdminAuditLogsResponse {
  total: number;
  page: number;
  limit: number;
  logs: AdminAuditLog[];
  /** Danh sách mã hành động đang có trong nhật ký, dùng cho bộ lọc. */
  actions?: string[];
}

export interface AdminAuditLogQuery {
  page?: number;
  limit?: number;
  action?: string;
  search?: string;
  actor?: string;
  target?: string;
  /** yyyy-mm-dd, theo giờ Việt Nam */
  from?: string;
  to?: string;
  result?: 'success' | 'fail' | '';
}

export type AdminPermissionAction = 'view' | 'create' | 'update' | 'delete' | 'grant';

export interface AdminPermissionModule {
  key: string;
  name: string;
}

export type AdminModulePermission = Record<AdminPermissionAction, boolean>;
export type AdminRolePermissionSet = Record<string, AdminModulePermission>;

export interface AdminRolePermission {
  name: string;
  total: number;
  permissions: AdminRolePermissionSet;
}

export interface AdminRolePermissionsResponse {
  /** AD53: chỉ quản trị viên cao nhất (Admin) được sửa ma trận quyền. */
  canEdit?: boolean;
  actions: AdminPermissionAction[];
  modules: AdminPermissionModule[];
  roles: AdminRolePermission[];
}

export interface AdminLoginResponse {
  adminSessionToken?: string;
  accessToken: string;
  expiresAt: string;
  employee: {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
  };
  permissions: AdminRolePermissionSet;
  lastLogin?: AdminLastLogin | null;
}

export interface AdminLastLogin {
  time: string;
  ip: string;
  device: string;
}

export interface AdminOrderProduct {
  id: string;
  name: string;
  image: string;
  qty: number;
  price: number;
}

export interface AdminOrderDetail {
  snapshotAvailable?: boolean;
  allowedStatuses?: string[]; nextStep?: { nextStatus: string | null; blocked: boolean; reason: string; action: string }; history?: any[]; preparationAt?: string | null; preparationStartedAt?: string | null; preparationStartedBy?: string | null; materialIssued?: boolean; materialExportId?: string | null; preparationPriority?: { level: string; label: string; minutesToT: number | null };
  id: string;
  requestId?: string | null;
  orderVersion?: string | null;
  orderStatus: string;
  paymentStatus: string;
  createdAt: string;
  createdTime: string;
  estimatedDelivery: string;
  senderName: string;
  senderCustomerId: string;
  senderPhone: string;
  senderEmail: string;
  senderAvatar?: string;
  receiverName: string;
  receiverPhone: string;
  receiverEmail: string;
  deliveryDate: string;
  deliverySlot: string;
  deliveryAddress: string;
  shipperName: string;
  shipperPhone: string;
  shipperAvatar: string;
  products: AdminOrderProduct[];
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

export interface AdminOrderDetailResponse {
  order: AdminOrderDetail;
}

export interface AdminReviewReplyResponse {
  message: string;
  review: {
    reviewId: string;
    shopReply: string;
    shopReplyDate: string;
    shopReplyStaffId: string | null;
  };
}

export interface AdminCustomer {
  /** Server trả mã khách (KHACH_HANG_ID) dạng chuỗi. */
  id: number | string;
  code: string;
  name: string;
  avatarText: string;
  phone: string;
  email: string;
  point: number;
  points?: number;
  membershipTier?: string;
  createdAt: string;
  birthDate?: string;
  gender?: string;
  selected: boolean;
  /** Hoạt động | Bị khóa | Chờ xác minh */
  status?: string;
  locked?: boolean;
  lockReason?: string;
  /** AD33: số liệu tính ở server từ đơn/thanh toán, không sửa tay. */
  totalOrders?: number;
  completedOrders?: number;
  totalSpent?: number;
  debt?: number;
  latestOrderDate?: string;
  lastLogin?: AdminLastLogin | null;
}

export interface AdminCustomerDetail extends AdminCustomer {
  birthDate?: string;
  gender?: string;
  totalOrders: number;
  totalSpent: number;
  averageRating: number;
  reviewCount: number;
  latestOrderDate: string;
  internalNote?: string;
}

export interface AdminCustomerSummary {
  total: number;
  active: number;
  locked: number;
  pendingVerification: number;
  newThisMonth: number;
  withDebt: number;
  totalDebt: number;
  totalSpent: number;
}

export interface AdminCustomerNote {
  id: string;
  content: string;
  createdAt: string;
  staffId: string;
  staffName: string;
}

export interface AdminCustomerReview {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  productImage: string;
  rating: number;
  content: string;
  createdAt: string;
  hidden: boolean;
  hiddenReason: string;
  reply: string;
  replyDate: string;
}

export interface AdminCustomerAddress {
  id: string;
  name: string;
  phone: string;
  address: string;
  province?: string;
  district?: string;
  ward?: string;
  detailAddress?: string;
  isDefault: boolean;
  lastUsedAt: string;
}

export interface AdminCustomerAddressPayload {
  name: string;
  phone: string;
  address: string;
  province?: string;
  district?: string;
  ward?: string;
  detailAddress?: string;
  isDefault: boolean;
}

export interface AdminAddressWardOption {
  name: string;
}

export interface AdminAddressDistrictOption {
  name: string;
  wards: AdminAddressWardOption[];
}

export interface AdminAddressProvinceOption {
  name: string;
  districts: AdminAddressDistrictOption[];
}

export interface AdminAddressOptionsResponse {
  provinces: AdminAddressProvinceOption[];
}

export interface AdminCustomerOrder {
  id: number;
  code: string;
  createdAt: string;
  total: number;
  /** AD36: trạng thái thanh toán tách riêng trạng thái đơn. */
  paymentStatus: string;
  status: string;
  paid?: number;
  remaining?: number;
}

export interface AdminCustomerFavoriteProduct {
  id: number;
  code: string;
  name: string;
  image: string;
  price: number;
  originalPrice: number;
  salePrice: number;
  likedAt: string;
  /** AD37: Đang bán | Hết hàng | Ngừng bán | Đã xóa */
  availability?: string;
  canOpen?: boolean;
}

export interface AdminCustomerDetailResponse {
  customer: AdminCustomerDetail;
  addresses: AdminCustomerAddress[];
  orders: AdminCustomerOrder[];
  favorites: AdminCustomerFavoriteProduct[];
  reviews?: AdminCustomerReview[];
  notes?: AdminCustomerNote[];
}

export interface AdminCustomersResponse {
  total: number;
  customers: AdminCustomer[];
  summary?: AdminCustomerSummary;
}

export interface AdminChatProduct {
  id?: string;
  name: string;
  price: number;
  image?: string | null;
}

export interface AdminChatMessage {
  id?: string;
  type: 'text' | 'product' | 'date' | 'system' | 'handoff';
  text: string;
  isCustomer?: boolean;
  time?: string;
  status?: string;
  image?: string | null;
  imageName?: string | null;
  imageType?: string | null;
  product?: AdminChatProduct | null;
}

export interface AdminChatConversation {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  customerId: string;
  phone: string;
  isOnline: boolean;
  lastMessage: string;
  unread: number;
  isPending: boolean;
  pendingChatId?: string | null;
  pinnedProduct?: AdminChatProduct | null;
  messages: AdminChatMessage[];
}

export interface AdminChatConversationsResponse {
  total: number;
  conversations: AdminChatConversation[];
}

export interface AdminTransaction {
  kind?: 'full' | 'deposit' | 'balance' | 'refund';
  canRecordBalance?: boolean;
  total?: number; deposit?: number; paid?: number; remaining?: number; editable?: boolean; confirmedAt?: string; confirmedBy?: string; history?: any[];
  id: number;
  code: string;
  orderCode: string;
  gateway: string;
  status: string;
  amount: number;
  referenceCode: string;
  transactionDate: string;
  selected: boolean;
}

export interface AdminProduct {
  image: string;
  name: string;
  sku: string;
  price: string;
  rating: number;
  quantity: number;
  finishedAvailable?: number;
  buildable?: number;
  featured: boolean;
  sale: boolean;
  status: string;
  statusClass: string;
  selected: boolean;
}

export interface AdminProductImage {
  url: string;
  isPrimary: boolean;
  sortOrder: number;
}

export interface AdminProductDetailForm {
  name: string;
  code: string;
  note: string;
  color: string;
  colors: string[];
  style: string;
  target: string;
  targets: string[];
  topic: string;
  flower: string;
  flowers: string[];
  collections: string[];
  quantity: number;
  finishedAvailable?: number;
  buildable?: number;
  status: string;
  isPublished: boolean;
  images: AdminProductImage[];
  inventorySource?: string;
  importPrice: number;
  salePrice: number;
  discountPrice: number;
  recipe: string;
}

export interface AdminProductRecipeItem {
  id: number;
  code: string;
  name: string;
  image: string;
  quantity: number;
  unit: string;
  note: string;
  importPrice?: number;
}

export interface AdminProductReview {
  avatar: string;
  name: string;
  rating: number;
  content: string;
  date: string;
  images: string[];
}

export interface AdminProductDetailResponse {
  product: AdminProductDetailForm;
  options: {
    colors: string[];
    styles: string[];
    targets: string[];
    topics: string[];
    flowers: string[];
    collections: string[];
    materials: AdminProductRecipeItem[];
  };
  materials: AdminProductRecipeItem[];
  reviews: AdminProductReview[];
  ratingSummary: Array<{ star: number; count: number; percent: number }>;
  averageRating: number;
  reviewCount: number;
}

export interface AdminBlogRow {
  BAI_VIET_ID: string;
  NHAN_VIEN_ID: string | null;
  TEN_NHAN_VIEN: string | null;
  EMAIL_NHAN_VIEN: string | null;
  TIEU_DE: string;
  NOI_DUNG: string;
  ANH_BIA: string | null;
  DANH_MUC_BLOG: string | null;
  NGAY_DANG: string | null;
  TRANG_THAI: string | null;
  LUOT_XEM: number | null;
}

export interface AdminBlogPayload {
  title: string;
  content: string;
  category: string;
  author?: string;
  email?: string;
  staffId?: string;
  coverImage?: string;
  status?: string;
}

export interface AdminFAQRow {
  SO_LUOT_HOI?: number;
  CAU_HOI_ID: string;
  CAU_HOI: string;
  CAU_TRA_LOI: string;
  DANH_MUC_CAU_HOI: string;
  TRANG_THAI: string;
}

export interface AdminFAQPayload {
  question: string;
  answer: string;
  category: string;
  status: string;
}

export interface AdminCategory {
  code: string;
  name: string;
  total: number;
  selected: boolean;
  description?: string;
  image?: string;
  status?: string;
  source?: string;
}

export interface AdminCategoryDetailResponse {
  type: string;
  category: AdminCategory;
  products: AdminProduct[];
}

export interface AdminProductClassifications {
  found: boolean;
  primaryImage: string;
  colors: string[];
  targets: string[];
  flowers: string[];
  collections: string[];
  topic: string;
}

export interface AdminCampaign {
  id: number;
  code: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  status: string;
  active: boolean;
  approved: boolean;
  audience: string;
  membershipTiers: string[];
  totalLimit: number;
  perUserLimit: number;
  firstOrderOnly: boolean;
  selected: boolean;
}

export interface AdminOrderQuoteSummary {
  subtotal: number;
  shippingFee: number;
  baseShippingFee: number;
  cardFee: number;
  productDiscount: number;
  shippingDiscount: number;
  loyaltyPoints: number;
  loyaltyDiscount: number;
  depositAmount: number;
  total: number;
}

export interface AdminVoucher {
  id: number;
  code: string;
  voucherCode: string;
  campaignCode: string;
  customerId: string;
  customerName: string;
  discountType: string;
  discountValue: number;
  maxDiscount: number;
  minimumOrder: number;
  productIds: string[];
  categoryIds: string[];
  audience: string;
  membershipTiers: string[];
  totalLimit: number;
  perUserLimit: number;
  firstOrderOnly: boolean;
  active: boolean;
  status: string;
  usageCount: number;
  startDate: string;
  endDate: string;
  used: boolean;
  selected: boolean;
}

export interface AdminMaterial {
  id: number;
  code: string;
  name: string;
  image: string;
  color: string;
  unit: string;
  quantity: number;
  importPrice: number;
  sellPrice: number;
  selected: boolean;
  description?: string;
  status?: string;
}

export interface AdminSupplier {
  id: number;
  code: string;
  name: string;
  representative: string;
  phone: string;
  email: string;
  address: string;
  taxCode: string;
  status: string;
  selected: boolean;
  image: string;
}

export interface AdminImportDetail {
  id: number;
  materialCode: string;
  materialName: string;
  image: string;
  quantity: number;
  unitPrice: number;
}

export interface AdminImportReceipt {
  id: number;
  code: string;
  supplier: string;
  supplierName?: string;
  importDate: string;
  totalAmount: number;
  selected: boolean;
  note: string;
  details: AdminImportDetail[];
}

export interface AdminExportDetail {
  id: number;
  materialCode: string;
  materialName: string;
  image: string;
  quantity: number;
}

export interface AdminExportReceipt {
  id: number;
  code: string;
  staff: string;
  staffName?: string;
  exportDate: string;
  selected: boolean;
  reason: string;
  note: string;
  details: AdminExportDetail[];
}

export interface AdminTransactionsResponse {
  total: number;
  transactions: AdminTransaction[];
}

export interface AdminProductsResponse {
  total: number;
  products: AdminProduct[];
  nextCode?: string;
}

export interface AdminCategoriesResponse {
  type: string;
  categories: AdminCategory[];
}

export interface AdminCampaignsResponse {
  total: number;
  campaigns: AdminCampaign[];
}

export interface AdminVouchersResponse {
  total: number;
  vouchers: AdminVoucher[];
}

export interface AdminMaterialsResponse {
  total: number;
  materials: AdminMaterial[];
}

export interface AdminSuppliersResponse {
  total: number;
  suppliers: AdminSupplier[];
}

export interface AdminImportsResponse {
  total: number;
  imports: AdminImportReceipt[];
}

export interface AdminExportsResponse {
  total: number;
  exports: AdminExportReceipt[];
}

export interface AdminDashboardOrder {
  id: string;
  customer: string;
  date: string;
  total: string;
  payment: string;
  status: string;
}

export interface AdminDelivery {
  time: string;
  orderId: string;
  quantity: string;
  price: string;
  customer: string;
  address: string;
}

export interface AdminProductSummary {
  image: string;
  name: string;
  id: string;
  price: string;
  totalOrders: number;
  status: string;
}

export interface AdminMaterialWarning {
  image: string;
  name: string;
  id: string;
  quantity: number;
  unit?: string;
}

export interface AdminDashboardResponse {
  summary: {
    totalOrders: number;
    newOrders: number;
    completedOrders: number;
    cancelledOrders: number;
    revenue: number;
    newCustomers: number;
    productsSold: number;
    warningMaterials: number;
  };
  chart: Array<{
    date: string;
    orders: number;
    revenue: number;
  }>;
  orders: AdminDashboardOrder[];
  deliveries: AdminDelivery[];
  bestProducts: AdminProductSummary[];
  warningMaterials: AdminMaterialWarning[];
}

@Injectable({
  providedIn: 'root',
})
export class AdminApiService {
  private readonly apiBaseUrl = apiBaseUrl();
  private readonly apiUrl = `${this.apiBaseUrl}/admin`;
  private readonly employeeApiUrl = `${this.apiBaseUrl}/employees`;
  private readonly chatApiUrl = `${this.apiBaseUrl}/chats`;
  private readonly blogApiUrl = `${this.apiBaseUrl}/blogs`;
  private readonly faqApiUrl = `${this.apiBaseUrl}/faqs`;
  private readonly reviewApiUrl = `${this.apiBaseUrl}/reviews`;
  private readonly customerDetailCache = new Map<string, AdminCustomerDetailResponse>();
  private ordersCache: AdminOrdersResponse | null = null;
  private ordersCacheAt = 0;
  private readonly ordersCacheTtlMs = 15000;
  private productsCache: AdminProductsResponse | null = null;
  private productsCacheAt = 0;
  private readonly productsCacheTtlMs = 15000;

  constructor(private readonly http: HttpClient) {}

  getDashboard(): Observable<AdminDashboardResponse> {
    return this.http.get<AdminDashboardResponse>(`${this.apiUrl}/dashboard`);
  }

  loginAdmin(email: string, password: string): Observable<AdminLoginResponse> {
    return this.http.post<AdminLoginResponse>(`${this.apiUrl}/auth/login`, { email, password });
  }

  getStaffAccounts(): Observable<AdminStaffAccountsResponse> {
    return this.http.get<any>(`${this.apiUrl}/staff-accounts`).pipe(
      map(response => ({ total: response.total, accounts: response.accounts || (response.staff || []).map((row: any) => this.mapLegacyEmployee(row)) })),
      catchError(() =>
        this.http.get<any[]>(this.employeeApiUrl).pipe(
          map((rows) => ({
            total: rows.length,
            accounts: rows.map((row) => this.mapLegacyEmployee(row)),
          }))
        )
      )
    );
  }

  getDeliveryStaff(): Observable<AdminStaffAccountsResponse> {
    return this.http.get<AdminStaffAccountsResponse>(`${this.apiUrl}/staff-accounts`, { params:{ scope:'delivery' } });
  }

  getRolePermissions(): Observable<AdminRolePermissionsResponse> {
    return this.http.get<AdminRolePermissionsResponse>(`${this.apiUrl}/role-permissions`);
  }
  saveStaff(code: string | null, data: object): Observable<any> {
    return code ? this.http.patch(`${this.apiUrl}/staff-accounts/${encodeURIComponent(code)}`, data)
      : this.http.post(`${this.apiUrl}/staff-accounts`, data);
  }
  saveRolePermissions(role: string, matrix: AdminRolePermissionSet): Observable<any> {
    return this.http.put(`${this.apiUrl}/role-permissions/${encodeURIComponent(role)}`, { QUYEN: matrix });
  }

  /** AD52: vô hiệu mật khẩu cũ + đăng xuất nhân viên; nhân viên tự đặt lại bằng "Gửi mã xác thực". */
  resetStaffPassword(code: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/staff-accounts/${encodeURIComponent(code)}/reset-password`, {});
  }

  getAuditLogs(params?: AdminAuditLogQuery): Observable<AdminAuditLogsResponse> {
    let httpParams = new HttpParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') httpParams = httpParams.set(key, String(value));
    });
    return this.http.get<AdminAuditLogsResponse>(`${this.apiUrl}/audit-logs`, { params: httpParams });
  }

  private mapLegacyEmployee(row: any): AdminStaffAccount {
    return {
      code: row.NHAN_VIEN_ID || '',
      name: row.HO_TEN || '',
      email: row.EMAIL || '',
      phone: row.SDT ? String(row.SDT) : '',
      role: row.VAI_TRO || '',
      createdAt: this.formatApiDate(row.NGAY_TAO),
      createdDate: this.toApiIsoDate(row.NGAY_TAO),
      status: row.TRANG_THAI || '',
      selected: false,
    };
  }

  private formatApiDate(value: unknown): string {
    if (!value) return '';

    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  private toApiIsoDate(value: unknown): string {
    if (!value) return '';

    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';

    return date.toISOString().slice(0, 10);
  }

  can(module: string, action: string): boolean {
    try { return typeof localStorage !== 'undefined' && JSON.parse(localStorage.getItem('adminPermissions') || '{}')?.[module]?.[action] === true; } catch { return false; }
  }

  uploadHandoverImage(orderId: string, file: File): Observable<{ url: string }> {
    const form = new FormData();
    form.append('image', file);
    return this.http.post<{ url: string }>(`${this.apiUrl}/orders/${encodeURIComponent(orderId)}/handover-image`, form);
  }

  updateOrderMetadata(orderId: string, body: { action: 'note' | 'preparation' | 'start-preparation' | 'handover-media' | 'delivery' | 'assign-shipper' | 'support-exception'; expectedVersion?:string|null; adminNote?: string; preparationAt?: string; reason?: string; media?: string[]; receiverName?: string; receiverPhone?: string; deliveryAddress?: string; deliveryDate?: string; deliverySlot?: string; shipperId?: string }): Observable<AdminOrderDetailResponse> {
    return this.http.put<AdminOrderDetailResponse>(`${this.apiUrl}/orders/${encodeURIComponent(orderId)}/status`, body).pipe(tap(() => this.clearOrdersCache()));
  }

  getOrders(options: { forceRefresh?: boolean } = {}): Observable<AdminOrdersResponse> {
    if (!options.forceRefresh && this.ordersCache && Date.now() - this.ordersCacheAt < this.ordersCacheTtlMs) {
      return of(this.ordersCache);
    }

    return this.http.get<AdminOrdersResponse>(`${this.apiUrl}/orders`).pipe(
      tap((response) => {
        this.ordersCache = response;
        this.ordersCacheAt = Date.now();
      })
    );
  }

  refreshOrdersFromDatabase(): Observable<AdminOrdersResponse> {
    return this.getOrders({ forceRefresh: true });
  }

  getOrderDetail(orderId: string): Observable<AdminOrderDetailResponse> {
    return this.http.get<AdminOrderDetailResponse>(
      `${this.apiUrl}/orders/${encodeURIComponent(orderId)}`
    );
  }

  createOrder(payload: {
    senderName: string;
    senderPhone: string;
    senderEmail: string;
    senderCustomerId: string;
    receiverName: string;
    receiverPhone: string;
    receiverEmail: string;
    deliveryDate: string;
    deliverySlot: string;
    deliveryAddress: string;
    districtName: string;
    provinceName: string;
    shippingMethod: 'standard' | 'fast';
    products: Array<{ id: string; qty: number; price: number }>;
    customerNote: string;
    cardMessage: string;
    giftCard?: { templateId: string; writingMode: 'customer' | 'shop'; message?: string } | null;
    adminNote: string;
    paymentMethod: string;
    orderStatus: string;
    voucher?: { id?: string; code?: string } | null;
    loyaltyPoints?: number;
  }): Observable<{ message: string; orderId: string; kind?: string; requestId?: string; summary?: AdminOrderQuoteSummary; paymentAmount?: number }> {
    const fingerprint = JSON.stringify(payload);
    let pending: { fingerprint: string; key: string } | null = null;
    try { pending = JSON.parse(sessionStorage.getItem('adminPendingOrder') || 'null'); } catch {}
    if (pending?.fingerprint !== fingerprint) {
      pending = { fingerprint, key: crypto.randomUUID() };
      sessionStorage.setItem('adminPendingOrder', JSON.stringify(pending));
    }
    return this.http.post<{ message: string; orderId: string; kind?: string; requestId?: string }>(`${this.apiUrl}/orders`, { ...payload, checkoutSessionId: pending!.key }).pipe(
      tap(() => this.clearOrdersCache())
    );
  }

  /** Báo giá đơn Admin: backend dùng cùng bảng giá/phí giao/voucher với trang Khách, không giữ hàng. */
  quoteOrder(payload: Record<string, unknown>): Observable<{ summary: AdminOrderQuoteSummary }> {
    return this.http.post<{ summary: AdminOrderQuoteSummary }>(`${this.apiUrl}/orders/quote`, payload);
  }

  getCardTemplates(): Observable<{ templates: Array<{ id: string; code: string; name: string; image?: string; fee: number }> }> {
    return this.http.get<{ templates: Array<{ id: string; code: string; name: string; image?: string; fee: number }> }>(`${this.apiBaseUrl}/orders/card-templates`);
  }

  updateOrderStatus(orderId: string, status: string, rejectReason?: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      `${this.apiUrl}/orders/${encodeURIComponent(orderId)}/status`,
      { status, rejectReason }
    ).pipe(
      tap(() => this.clearOrdersCache())
    );
  }

  updateOrderPaymentStatus(
    orderId: string,
    status: string,
    paymentMethod: string
  ): Observable<AdminOrderDetailResponse> {
    return this.http.put<AdminOrderDetailResponse>(
      `${this.apiUrl}/orders/${encodeURIComponent(orderId)}/payment-status`,
      { status, paymentMethod }
    ).pipe(
      tap(() => this.clearOrdersCache())
    );
  }

  private clearOrdersCache(): void {
    this.ordersCache = null;
    this.ordersCacheAt = 0;
  }

  replyToReview(reviewId: string, reply: string, staffId?: string): Observable<AdminReviewReplyResponse> {
    return this.http.patch<AdminReviewReplyResponse>(
      `${this.reviewApiUrl}/${encodeURIComponent(reviewId)}/reply`,
      { reply, staffId }
    );
  }

  getCustomers(): Observable<AdminCustomersResponse> {
    return this.http.get<AdminCustomersResponse>(`${this.apiUrl}/customers`);
  }

  // AD35/AD36: luôn tải mới để lịch sử đơn/thanh toán khớp module Đơn hàng (không giữ cache cũ).
  getCustomerDetail(customerId: string): Observable<AdminCustomerDetailResponse> {
    return this.http.get<AdminCustomerDetailResponse>(
      `${this.apiUrl}/customers/${encodeURIComponent(customerId)}`
    );
  }

  /** AD33: khóa (bắt buộc lý do) hoặc mở khóa tài khoản khách. Khóa sẽ đăng xuất khách khỏi mọi thiết bị. */
  setCustomerLock(customerId: string, locked: boolean, reason = ''): Observable<{ message: string; customer: AdminCustomer }> {
    return this.http.patch<{ message: string; customer: AdminCustomer }>(
      `${this.apiUrl}/customers/${encodeURIComponent(customerId)}/lock`, { locked, reason });
  }

  /** AD35: ghi chú nội bộ, chỉ nhân viên xem. */
  addCustomerNote(customerId: string, content: string): Observable<{ message: string; note: AdminCustomerNote }> {
    return this.http.post<{ message: string; note: AdminCustomerNote }>(
      `${this.apiUrl}/customers/${encodeURIComponent(customerId)}/notes`, { content });
  }

  /** AD38: ẩn (bắt buộc lý do) / hiện lại đánh giá trên trang sản phẩm. */
  setReviewVisibility(reviewId: string, hidden: boolean, reason = ''): Observable<{ message: string; hidden: boolean }> {
    return this.http.patch<{ message: string; hidden: boolean }>(
      `${this.apiUrl}/reviews/${encodeURIComponent(reviewId)}/visibility`, { hidden, reason });
  }

  getAddressOptions(): Observable<AdminAddressOptionsResponse> {
    return this.http.get<AdminAddressOptionsResponse>(`${this.apiUrl}/address-options`);
  }

  createCustomerAddress(
    customerId: string,
    payload: AdminCustomerAddressPayload
  ): Observable<{ message: string; address: AdminCustomerAddress }> {
    return this.http.post<{ message: string; address: AdminCustomerAddress }>(
      `${this.apiUrl}/customers/${encodeURIComponent(customerId)}/addresses`,
      payload
    ).pipe(
      tap(() => this.customerDetailCache.delete(customerId.trim().toUpperCase()))
    );
  }

  updateCustomerAddress(
    customerId: string,
    addressId: string,
    payload: AdminCustomerAddressPayload
  ): Observable<{ message: string; address: AdminCustomerAddress }> {
    return this.http.put<{ message: string; address: AdminCustomerAddress }>(
      `${this.apiUrl}/customers/${encodeURIComponent(customerId)}/addresses/${encodeURIComponent(addressId)}`,
      payload
    ).pipe(
      tap(() => this.customerDetailCache.delete(customerId.trim().toUpperCase()))
    );
  }

  setDefaultCustomerAddress(
    customerId: string,
    addressId: string
  ): Observable<{ message: string; address: AdminCustomerAddress }> {
    return this.http.patch<{ message: string; address: AdminCustomerAddress }>(
      `${this.apiUrl}/customers/${encodeURIComponent(customerId)}/addresses/${encodeURIComponent(addressId)}/default`,
      {}
    ).pipe(
      tap(() => this.customerDetailCache.delete(customerId.trim().toUpperCase()))
    );
  }

  deleteCustomerAddress(
    customerId: string,
    addressId: string
  ): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/customers/${encodeURIComponent(customerId)}/addresses/${encodeURIComponent(addressId)}`
    ).pipe(
      tap(() => this.customerDetailCache.delete(customerId.trim().toUpperCase()))
    );
  }

  getChatConversations(): Observable<AdminChatConversationsResponse> {
    return this.http.get<AdminChatConversationsResponse>(`${this.chatApiUrl}/admin/conversations`);
  }

  replyChatConversation(
    conversationId: string,
    payload: {
      message: string;
      staffId?: string;
      chatId?: string | null;
      imageDataUrl?: string | null;
      imageName?: string | null;
      imageType?: string | null;
    }
  ): Observable<{ message: string; chatId: string }> {
    return this.http.post<{ message: string; chatId: string }>(
      `${this.chatApiUrl}/admin/conversations/${encodeURIComponent(conversationId)}/replies`,
      payload
    );
  }

  updateCustomer(
    customerId: string,
    // AD34/AD40: server chỉ nhận họ tên, ngày sinh, giới tính, ghi chú nội bộ.
    // SĐT/email là thông tin đăng nhập; gửi giá trị khác hiện tại sẽ bị từ chối (400, field phone/email).
    payload: { name?: string; phone?: string; email?: string; birthDate?: string; gender?: string; internalNote?: string }
  ): Observable<{ message: string; customer: AdminCustomer }> {
    return this.http.put<{ message: string; customer: AdminCustomer }>(
      `${this.apiUrl}/customers/${encodeURIComponent(customerId)}`,
      payload
    ).pipe(
      timeout(15000),
      tap(() => this.customerDetailCache.delete(customerId.trim().toUpperCase()))
    );
  }

  getAfterSales(orderIdOrFilters?: string | Record<string,string>): Observable<any> {
    let params = new HttpParams();
    if (typeof orderIdOrFilters === 'string' && orderIdOrFilters) params = params.set('orderId', orderIdOrFilters);
    else if (orderIdOrFilters) Object.entries(orderIdOrFilters).forEach(([key,value]) => { if(value) params=params.set(key,value); });
    return this.http.get(`${this.apiUrl}/after-sales`, { params });
  }
  changeAfterSales(id: string,body: any): Observable<any> { return this.http.patch(`${this.apiUrl}/after-sales/${encodeURIComponent(id)}`,body); }
  getTransactions(): Observable<AdminTransactionsResponse> {
    return this.http.get<AdminTransactionsResponse>(`${this.apiUrl}/transactions`);
  }

  refreshTransactionsFromDatabase(): Observable<AdminTransactionsResponse> {
    return this.getTransactions();
  }

  createTransaction(payload: {
    orderCode: string;
    gateway: string;
    status: string;
    amount: number;
    referenceCode: string;
    transactionDate: string;
    balance?: boolean;
    reason?: string;
  }): Observable<{ message: string; transaction: AdminTransaction }> {
    return this.http.post<{ message: string; transaction: AdminTransaction }>(
      `${this.apiUrl}/transactions`,
      payload
    );
  }

  updateTransaction(
    transactionId: string,
    payload: { gateway: string; status: string; amount: number; referenceCode?: string; reason?: string; source?: string }
  ): Observable<{ message: string; transaction: AdminTransaction }> {
    return this.http.put<{ message: string; transaction: AdminTransaction }>(
      `${this.apiUrl}/transactions/${encodeURIComponent(transactionId)}`,
      payload
    );
  }

  getProducts(): Observable<AdminProductsResponse> {
    if (this.productsCache && Date.now() - this.productsCacheAt < this.productsCacheTtlMs) {
      return of(this.productsCache);
    }

    return this.http.get<AdminProductsResponse>(`${this.apiUrl}/products?includeDeleted=true`).pipe(
      tap((response) => {
        this.productsCache = response;
        this.productsCacheAt = Date.now();
      })
    );
  }

  createProduct(payload: {
    sku?: string;
    reservedCode?: string;
    codeReservationToken?: string;
    name: string;
    description: string;
    color?: string;
    colors?: string[];
    target?: string;
    targets?: string[];
    flower?: string;
    flowers?: string[];
    collections?: string[];
    topic?: string;
    importPrice?: number;
    salePrice: number;
    discountPrice: number;
    quantity?: number;
    style: string;
    images: AdminProductImage[];
    materials?: Array<{
      name: string;
      quantity: number;
      unit: string;
      note: string;
    }>;
    recipeDescription?: string;
  }): Observable<{ message: string; product: AdminProduct }> {
    return this.http.post<{ message: string; product: AdminProduct }>(
      `${this.apiUrl}/products`,
      payload
    ).pipe(
      tap(() => this.clearProductsCache())
    );
  }

  getNextProductCode(): Observable<{ code: string }> {
    return this.http.get<{ code: string }>(`${this.apiUrl}/products/next-code`);
  }

  reserveProductCode(): Observable<{ code: string; token: string; expiresInMinutes: number }> {
    return this.http.post<{ code: string; token: string; expiresInMinutes: number }>(
      `${this.apiUrl}/products/reserve-code`, {}
    );
  }

  getProductDetail(productId: string): Observable<AdminProductDetailResponse> {
    return this.http.get<AdminProductDetailResponse>(
      `${this.apiUrl}/products/${encodeURIComponent(productId)}`
    );
  }

  getProductClassifications(productId: string): Observable<AdminProductClassifications> {
    const splitList = (value: unknown): string[] => String(value || '').split('|').map((item) => item.trim()).filter(Boolean);
    return forkJoin({
      all: this.http.get<any>(`${this.apiBaseUrl}/category-products`).pipe(catchError(() => of({ products: [] }))),
      collections: this.http.get<any[]>(`${this.apiBaseUrl}/collections`).pipe(catchError(() => of([])))
    }).pipe(
      switchMap(({ all, collections }) => {
        const product = (all?.products || []).find((item: any) => String(item.SAN_PHAM_ID) === productId);
        const collectionRequests = (collections || []).map((collection: any) =>
          this.http.get<any>(`${this.apiBaseUrl}/category-products/collection/${encodeURIComponent(collection.BO_SUU_TAP_ID)}`).pipe(
            map((response) => (response?.products || []).some((item: any) => String(item.SAN_PHAM_ID) === productId)
              ? String(collection.TEN_BO_SUU_TAP || '').trim() : ''),
            catchError(() => of(''))
          )
        );
        const collectionNames$ = collectionRequests.length ? forkJoin(collectionRequests) : of([] as string[]);
        return collectionNames$.pipe(map((collectionNames) => ({
          found: Boolean(product),
          primaryImage: String(product?.HINH_ANH || '').trim(),
          colors: splitList(product?.TEN_MAU_SAC_LIST),
          targets: splitList(product?.TEN_DOI_TUONG_LIST),
          flowers: splitList(product?.TEN_HOA_TUOI_LIST),
          collections: collectionNames.filter(Boolean),
          topic: String(product?.TEN_CHU_DE || '').trim()
        })));
      }),
      catchError(() => of({ found: false, primaryImage: '', colors: [], targets: [], flowers: [], collections: [], topic: '' }))
    );
  }

  updateProductDetail(
    productId: string,
    payload: { product: AdminProductDetailForm; materials: AdminProductRecipeItem[] }
  ): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      `${this.apiUrl}/products/${encodeURIComponent(productId)}`,
      payload
    ).pipe(
      tap(() => this.clearProductsCache())
    );
  }

  updateProductStatus(productId: string, status: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      `${this.apiUrl}/products/${encodeURIComponent(productId)}/status`,
      { status }
    ).pipe(
      tap(() => this.clearProductsCache())
    );
  }

  deleteProduct(productId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/products/${encodeURIComponent(productId)}`
    ).pipe(
      tap(() => this.clearProductsCache())
    );
  }

  private clearProductsCache(): void {
    this.productsCache = null;
    this.productsCacheAt = 0;
  }

  getBlogs(): Observable<AdminBlogRow[]> {
    return this.http.get<AdminBlogRow[]>(this.blogApiUrl);
  }

  getBlog(blogId: string): Observable<AdminBlogRow> {
    return this.http.get<AdminBlogRow>(
      `${this.blogApiUrl}/${encodeURIComponent(blogId)}`
    );
  }

  createBlog(payload: AdminBlogPayload): Observable<{ message: string; blog: AdminBlogRow }> {
    return this.http.post<{ message: string; blog: AdminBlogRow }>(this.blogApiUrl, payload);
  }

  updateBlog(
    blogId: string,
    payload: AdminBlogPayload
  ): Observable<{ message: string; blog: AdminBlogRow }> {
    return this.http.put<{ message: string; blog: AdminBlogRow }>(
      `${this.blogApiUrl}/${encodeURIComponent(blogId)}`,
      payload
    );
  }

  deleteBlog(blogId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.blogApiUrl}/${encodeURIComponent(blogId)}`
    );
  }

  getFAQs(): Observable<AdminFAQRow[]> {
    return this.http.get<AdminFAQRow[]>(this.faqApiUrl);
  }

  getFAQ(faqId: string): Observable<AdminFAQRow> {
    return this.http.get<AdminFAQRow>(
      `${this.faqApiUrl}/${encodeURIComponent(faqId)}`
    );
  }

  createFAQ(payload: AdminFAQPayload): Observable<{ message: string; faq: AdminFAQRow }> {
    return this.http.post<{ message: string; faq: AdminFAQRow }>(this.faqApiUrl, payload);
  }

  updateFAQ(
    faqId: string,
    payload: AdminFAQPayload
  ): Observable<{ message: string; faq: AdminFAQRow }> {
    return this.http.put<{ message: string; faq: AdminFAQRow }>(
      `${this.faqApiUrl}/${encodeURIComponent(faqId)}`,
      payload
    );
  }

  deleteFAQ(faqId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.faqApiUrl}/${encodeURIComponent(faqId)}`
    );
  }

  getCategories(type: string): Observable<AdminCategoriesResponse> {
    return this.http.get<AdminCategoriesResponse>(
      `${this.apiUrl}/categories/${encodeURIComponent(type)}`
    );
  }

  createCategory(
    type: string,
    payload: string | { name: string; description?: string; image?: string }
  ): Observable<{ message: string; category: AdminCategory }> {
    return this.http.post<{ message: string; category: AdminCategory }>(
      `${this.apiUrl}/categories/${encodeURIComponent(type)}`,
      typeof payload === 'string' ? { name: payload } : payload
    );
  }

  getCategoryDetail(type: string, categoryId: string): Observable<AdminCategoryDetailResponse> {
    const publicId = type === 'style' && categoryId.startsWith('style:') ? categoryId.slice(6) : categoryId;
    const publicPath: Record<string, string> = {
      topic: 'topic', target: 'target', style: 'style', color: 'color', collection: 'collection', flower: 'flower'
    };
    return this.http.get<AdminCategoryDetailResponse>(
      `${this.apiUrl}/categories/${encodeURIComponent(type)}/${encodeURIComponent(categoryId)}`
    ).pipe(
      timeout(8000),
      catchError(() => this.http.get<any>(
        `${this.apiBaseUrl}/category-products/${publicPath[type] || type}/${encodeURIComponent(publicId)}`
      ).pipe(
        timeout(8000),
        map((response) => {
          const meta = response.topic || response.target || response.style || response.color || response.collection || response.flower || {};
          const name = meta.TEN_CHU_DE || meta.TEN_DOI_TUONG || meta.KIEU_DANG || meta.TEN_MAU_SAC || meta.TEN_BO_SUU_TAP || meta.TEN_HOA_TUOI || publicId;
          const products: AdminProduct[] = (response.products || []).map((row: any) => ({
            sku: String(row.SAN_PHAM_ID || ''),
            name: String(row.TEN_SAN_PHAM || ''),
            image: String(row.HINH_ANH || ''),
            price: Number(row.GIA_KHUYEN_MAI || row.GIA || 0).toLocaleString('vi-VN'),
            sale: Number(row.GIA_KHUYEN_MAI || 0) > 0,
            featured: false,
            quantity: Number(row.SO_LUONG || 0),
            rating: 0,
            status: String(row.TRANG_THAI || 'Đang bán'),
            statusClass: '',
            selected: false
          }));
          return {
            type,
            category: { code: categoryId, name, total: products.length, selected: false, description: meta.MO_TA || '', image: meta.HINH_ANH || '', status: 'Đang hiển thị' },
            products
          };
        })
      ))
    );
  }

  updateCategory(
    type: string,
    categoryId: string,
    payload: { name: string; description?: string; image?: string; status?: string; productIds?: string[] }
  ): Observable<AdminCategoryDetailResponse> {
    return this.http.put<AdminCategoryDetailResponse>(
      `${this.apiUrl}/categories/${encodeURIComponent(type)}/${encodeURIComponent(categoryId)}`,
      payload
    );
  }

  deleteCategory(type: string, categoryId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/categories/${encodeURIComponent(type)}/${encodeURIComponent(categoryId)}`
    );
  }


  getCampaigns(): Observable<AdminCampaignsResponse> {
    return this.http.get<any>(`${this.apiUrl}/campaigns`).pipe(map(r => ({ ...r, campaigns: (r.campaigns || []).map(mapPromotionCampaign) })));
  }
  createCampaign(payload: {
    name: string;
    description: string;
    startDate: string;
    endDate: string;
    status: string;
    active: boolean; approved: boolean; audience: string; membershipTiers: string[];
    totalLimit: number; perUserLimit: number; firstOrderOnly: boolean;
  }): Observable<{ message: string; campaign: AdminCampaign }> {
    return this.http.post<any>(
      `${this.apiUrl}/campaigns`,
      payload
    ).pipe(map(r => ({ ...r, campaign: mapPromotionCampaign(r.campaign) })));
  }

  updateCampaign(
    campaignId: string,
    payload: {
      name: string;
      description: string;
      startDate: string;
      endDate: string;
      status: string;
      active: boolean; approved: boolean; audience: string; membershipTiers: string[];
      totalLimit: number; perUserLimit: number; firstOrderOnly: boolean;
    }
  ): Observable<{ message: string; campaign: AdminCampaign }> {
    return this.http.put<any>(
      `${this.apiUrl}/campaigns/${encodeURIComponent(campaignId)}`,
      payload
    ).pipe(map(r => ({ ...r, campaign: mapPromotionCampaign(r.campaign) })));
  }
  deleteCampaign(campaignId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/campaigns/${encodeURIComponent(campaignId)}`);
  }
  getVouchers(): Observable<AdminVouchersResponse> {
    return this.http.get<any>(`${this.apiUrl}/vouchers`).pipe(map(r => ({ ...r, vouchers: (r.vouchers || []).map(mapPromotionVoucher) })));
  }
  getNextVoucherId(): Observable<{ voucherId: string }> {
    return this.http.get<{ voucherId: string }>(`${this.apiUrl}/vouchers-next-id`);
  }

  createVoucher(payload: {
    voucherCode: string;
    campaignCode: string;
    customerIds?: string[];
    quantity?: number;
    expectedVoucherId?: string;
    discountType: string;
    discountValue: number;
    maxDiscount: number; minimumOrder: number; productIds: string[]; categoryIds: string[];
    audience: string; membershipTiers: string[]; totalLimit: number; perUserLimit: number;
    firstOrderOnly: boolean; active: boolean;
    startDate: string;
    endDate: string;
  }): Observable<{ message: string; voucher: AdminVoucher; vouchers?: AdminVoucher[] }> {
    return this.http.post<any>(
      `${this.apiUrl}/vouchers`,
      payload
    ).pipe(map(r => ({
      ...r,
      voucher: mapPromotionVoucher(r.voucher),
      ...(Array.isArray(r.vouchers) ? { vouchers: r.vouchers.map(mapPromotionVoucher) } : {})
    })));
  }

  updateVoucher(
    voucherId: string,
    payload: {
      voucherCode: string;
      campaignCode: string;
      discountType: string;
      discountValue: number;
      maxDiscount: number; minimumOrder: number; productIds: string[]; categoryIds: string[];
      audience: string; membershipTiers: string[]; totalLimit: number; perUserLimit: number;
      firstOrderOnly: boolean; active: boolean;
      startDate: string;
      endDate: string;
    }
  ): Observable<{ message: string; voucher: AdminVoucher }> {
    return this.http.put<any>(
      `${this.apiUrl}/vouchers/${encodeURIComponent(voucherId)}`,
      payload
    ).pipe(map(r => ({ ...r, voucher: mapPromotionVoucher(r.voucher) })));
  }
  deleteVoucher(voucherId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/vouchers/${encodeURIComponent(voucherId)}`);
  }

  // API nguyên vật liệu / NCC / phiếu nhập / phiếu xuất: xem InventoryApiService (inventory-api.service.ts)
}
