import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, tap, timeout } from 'rxjs';

export interface AdminOrder {
  id: string;
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
  status: string;
  selected: boolean;
}

export interface AdminStaffAccountsResponse {
  total: number;
  accounts: AdminStaffAccount[];
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
  actions: AdminPermissionAction[];
  modules: AdminPermissionModule[];
  roles: AdminRolePermission[];
}

export interface AdminLoginResponse {
  employee: {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
  };
  permissions: AdminRolePermissionSet;
}

export interface AdminOrderProduct {
  id: string;
  name: string;
  image: string;
  qty: number;
  price: number;
}

export interface AdminOrderDetail {
  id: string;
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
  id: number;
  code: string;
  name: string;
  avatarText: string;
  phone: string;
  email: string;
  point: number;
  membershipTier?: string;
  createdAt: string;
  birthDate?: string;
  gender?: string;
  selected: boolean;
}

export interface AdminCustomerDetail extends AdminCustomer {
  birthDate?: string;
  gender?: string;
  totalOrders: number;
  totalSpent: number;
  averageRating: number;
  reviewCount: number;
  latestOrderDate: string;
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
  paymentStatus: string;
  status: string;
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
}

export interface AdminCustomerDetailResponse {
  customer: AdminCustomerDetail;
  addresses: AdminCustomerAddress[];
  orders: AdminCustomerOrder[];
  favorites: AdminCustomerFavoriteProduct[];
}

export interface AdminCustomersResponse {
  total: number;
  customers: AdminCustomer[];
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
  featured: boolean;
  sale: boolean;
  status: string;
  statusClass: string;
  selected: boolean;
}

export interface AdminProductDetailForm {
  name: string;
  code: string;
  note: string;
  color: string;
  style: string;
  target: string;
  topic: string;
  flower: string;
  quantity: number;
  status: string;
  isPublished: boolean;
  images: string[];
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
}

export interface AdminCampaign {
  id: number;
  code: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  status: string;
  selected: boolean;
}

export interface AdminVoucher {
  id: number;
  code: string;
  voucherCode: string;
  campaignCode: string;
  discountType: string;
  discountValue: number;
  startDate: string;
  endDate: string;
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
  private readonly apiBaseUrl = 'https://tiem-hoa-yen-api.onrender.com/api';
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
  private materialsCache: AdminMaterialsResponse | null = null;
  private materialsCacheAt = 0;
  private readonly materialsCacheTtlMs = 15000;

  constructor(private readonly http: HttpClient) {}

  getDashboard(): Observable<AdminDashboardResponse> {
    return this.http.get<AdminDashboardResponse>(`${this.apiUrl}/dashboard`);
  }

  loginAdmin(email: string, password: string): Observable<AdminLoginResponse> {
    return this.http.post<AdminLoginResponse>(`${this.apiUrl}/auth/login`, { email, password });
  }

  getStaffAccounts(): Observable<AdminStaffAccountsResponse> {
    return this.http.get<AdminStaffAccountsResponse>(`${this.apiUrl}/staff-accounts`).pipe(
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

  getRolePermissions(): Observable<AdminRolePermissionsResponse> {
    return this.http.get<AdminRolePermissionsResponse>(`${this.apiUrl}/role-permissions`);
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

  getOrders(): Observable<AdminOrdersResponse> {
    if (this.ordersCache && Date.now() - this.ordersCacheAt < this.ordersCacheTtlMs) {
      return of(this.ordersCache);
    }

    return this.http.get<AdminOrdersResponse>(`${this.apiUrl}/orders`).pipe(
      tap((response) => {
        this.ordersCache = response;
        this.ordersCacheAt = Date.now();
      })
    );
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
    products: Array<{ id: string; qty: number; price: number }>;
    customerNote: string;
    cardMessage: string;
    adminNote: string;
    paymentMethod: string;
    orderStatus: string;
    shippingFee: number;
    tax: number;
    voucherDiscount: number;
    loyaltyDiscount: number;
  }): Observable<{ message: string; orderId: string }> {
    return this.http.post<{ message: string; orderId: string }>(`${this.apiUrl}/orders`, payload).pipe(
      tap(() => this.clearOrdersCache())
    );
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

  getCustomerDetail(customerId: string): Observable<AdminCustomerDetailResponse> {
    const cacheKey = customerId.trim().toUpperCase();
    const cached = this.customerDetailCache.get(cacheKey);

    if (cached) {
      return of(cached);
    }

    return this.http.get<AdminCustomerDetailResponse>(
      `${this.apiUrl}/customers/${encodeURIComponent(customerId)}`
    ).pipe(
      tap((response) => this.customerDetailCache.set(cacheKey, response))
    );
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
    payload: { name: string; phone: string; email: string; birthDate?: string; gender?: string }
  ): Observable<{ message: string; customer: AdminCustomer }> {
    return this.http.put<{ message: string; customer: AdminCustomer }>(
      `${this.apiUrl}/customers/${encodeURIComponent(customerId)}`,
      payload
    ).pipe(
      timeout(5000),
      tap(() => this.customerDetailCache.delete(customerId.trim().toUpperCase()))
    );
  }

  getTransactions(): Observable<AdminTransactionsResponse> {
    return this.http.get<AdminTransactionsResponse>(`${this.apiUrl}/transactions`);
  }

  createTransaction(payload: {
    orderCode: string;
    gateway: string;
    status: string;
    amount: number;
    referenceCode: string;
    transactionDate: string;
  }): Observable<{ message: string; transaction: AdminTransaction }> {
    return this.http.post<{ message: string; transaction: AdminTransaction }>(
      `${this.apiUrl}/transactions`,
      payload
    );
  }

  updateTransaction(
    transactionId: string,
    payload: { gateway: string; status: string; amount: number }
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

    return this.http.get<AdminProductsResponse>(`${this.apiUrl}/products`).pipe(
      tap((response) => {
        this.productsCache = response;
        this.productsCacheAt = Date.now();
      })
    );
  }

  createProduct(payload: {
    sku: string;
    name: string;
    description: string;
    color?: string;
    target?: string;
    flower?: string;
    topic?: string;
    importPrice?: number;
    salePrice: number;
    discountPrice: number;
    quantity: number;
    style: string;
    images: string[];
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

  getProductDetail(productId: string): Observable<AdminProductDetailResponse> {
    return this.http.get<AdminProductDetailResponse>(
      `${this.apiUrl}/products/${encodeURIComponent(productId)}`
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
    name: string
  ): Observable<{ message: string; category: AdminCategory }> {
    return this.http.post<{ message: string; category: AdminCategory }>(
      `${this.apiUrl}/categories/${encodeURIComponent(type)}`,
      { name }
    );
  }

  deleteCategory(type: string, categoryId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/categories/${encodeURIComponent(type)}/${encodeURIComponent(categoryId)}`
    );
  }

  getCampaigns(): Observable<AdminCampaignsResponse> {
    return this.http.get<AdminCampaignsResponse>(`${this.apiUrl}/campaigns`);
  }

  createCampaign(payload: {
    name: string;
    description: string;
    startDate: string;
    endDate: string;
    status: string;
  }): Observable<{ message: string; campaign: AdminCampaign }> {
    return this.http.post<{ message: string; campaign: AdminCampaign }>(
      `${this.apiUrl}/campaigns`,
      payload
    );
  }

  updateCampaign(
    campaignId: string,
    payload: {
      name: string;
      description: string;
      startDate: string;
      endDate: string;
      status: string;
    }
  ): Observable<{ message: string; campaign: AdminCampaign }> {
    return this.http.put<{ message: string; campaign: AdminCampaign }>(
      `${this.apiUrl}/campaigns/${encodeURIComponent(campaignId)}`,
      payload
    );
  }

  deleteCampaign(campaignId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/campaigns/${encodeURIComponent(campaignId)}`
    );
  }

  getVouchers(): Observable<AdminVouchersResponse> {
    return this.http.get<AdminVouchersResponse>(`${this.apiUrl}/vouchers`);
  }

  createVoucher(payload: {
    voucherCode: string;
    campaignCode: string;
    discountType: string;
    discountValue: number;
    startDate: string;
    endDate: string;
  }): Observable<{ message: string; voucher: AdminVoucher }> {
    return this.http.post<{ message: string; voucher: AdminVoucher }>(
      `${this.apiUrl}/vouchers`,
      payload
    );
  }

  updateVoucher(
    voucherId: string,
    payload: {
      voucherCode: string;
      campaignCode: string;
      discountType: string;
      discountValue: number;
      startDate: string;
      endDate: string;
    }
  ): Observable<{ message: string; voucher: AdminVoucher }> {
    return this.http.put<{ message: string; voucher: AdminVoucher }>(
      `${this.apiUrl}/vouchers/${encodeURIComponent(voucherId)}`,
      payload
    );
  }

  deleteVoucher(voucherId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/vouchers/${encodeURIComponent(voucherId)}`
    );
  }

  getMaterials(): Observable<AdminMaterialsResponse> {
    if (this.materialsCache && Date.now() - this.materialsCacheAt < this.materialsCacheTtlMs) {
      return of(this.materialsCache);
    }

    return this.http.get<AdminMaterialsResponse>(`${this.apiUrl}/materials`).pipe(
      tap((response) => {
        this.materialsCache = response;
        this.materialsCacheAt = Date.now();
      })
    );
  }

  createMaterial(payload: {
    name: string;
    unit: string;
    quantity: number;
    importPrice?: number;
    sellPrice?: number;
    description?: string;
    image?: string;
  }): Observable<{ message: string; material: AdminMaterial }> {
    return this.http.post<{ message: string; material: AdminMaterial }>(
      `${this.apiUrl}/materials`,
      payload
    ).pipe(
      tap(() => this.clearMaterialsCache())
    );
  }

  updateMaterial(
    materialId: string,
    payload: {
      name: string;
      unit: string;
      quantity: number;
      importPrice?: number;
      sellPrice?: number;
      description?: string;
      image?: string;
    }
  ): Observable<{ message: string; material: AdminMaterial }> {
    return this.http.put<{ message: string; material: AdminMaterial }>(
      `${this.apiUrl}/materials/${encodeURIComponent(materialId)}`,
      payload
    ).pipe(
      tap(() => this.clearMaterialsCache())
    );
  }

  uploadMaterialImage(file: File): Observable<{ message: string; imageUrl: string }> {
    const formData = new FormData();
    formData.append('image', file);

    return this.http.post<{ message: string; imageUrl: string }>(
      `${this.apiUrl}/materials/upload-image`,
      formData
    );
  }

  deleteMaterial(materialId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/materials/${encodeURIComponent(materialId)}`
    ).pipe(
      tap(() => this.clearMaterialsCache())
    );
  }

  private clearMaterialsCache(): void {
    this.materialsCache = null;
    this.materialsCacheAt = 0;
  }

  getSuppliers(filters: { search?: string; status?: string } = {}): Observable<AdminSuppliersResponse> {
    let params = new HttpParams();
    const search = filters.search?.trim();
    const status = filters.status?.trim();

    if (search) {
      params = params.set('search', search);
    }

    if (status) {
      params = params.set('status', status);
    }

    return this.http.get<AdminSuppliersResponse>(`${this.apiUrl}/suppliers`, { params });
  }

  createSupplier(payload: Partial<AdminSupplier>): Observable<{ message: string; supplier: AdminSupplier }> {
    return this.http.post<{ message: string; supplier: AdminSupplier }>(
      `${this.apiUrl}/suppliers`,
      payload
    );
  }

  updateSupplier(
    supplierId: string,
    payload: Partial<AdminSupplier>
  ): Observable<{ message: string; supplier: AdminSupplier }> {
    return this.http.put<{ message: string; supplier: AdminSupplier }>(
      `${this.apiUrl}/suppliers/${encodeURIComponent(supplierId)}`,
      payload
    );
  }

  deleteSupplier(supplierId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/suppliers/${encodeURIComponent(supplierId)}`
    );
  }

  getImports(): Observable<AdminImportsResponse> {
    return this.http.get<AdminImportsResponse>(`${this.apiUrl}/imports`);
  }

  createImport(payload: {
    supplier: string;
    importDate: string;
    note: string;
    details: Array<{ materialCode: string; quantity: number; unitPrice: number }>;
  }): Observable<{ message: string; code: string }> {
    return this.http.post<{ message: string; code: string }>(`${this.apiUrl}/imports`, payload);
  }

  updateImport(
    receiptId: string,
    payload: {
      supplier: string;
      importDate: string;
      note: string;
      details: Array<{ materialCode: string; quantity: number; unitPrice: number }>;
    }
  ): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      `${this.apiUrl}/imports/${encodeURIComponent(receiptId)}`,
      payload
    );
  }

  deleteImport(receiptId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/imports/${encodeURIComponent(receiptId)}`
    );
  }

  getExports(): Observable<AdminExportsResponse> {
    return this.http.get<AdminExportsResponse>(`${this.apiUrl}/exports`);
  }

  createExport(payload: {
    staff: string;
    exportDate: string;
    reason: string;
    note: string;
    details: Array<{ materialCode: string; quantity: number }>;
  }): Observable<{ message: string; code: string }> {
    return this.http.post<{ message: string; code: string }>(`${this.apiUrl}/exports`, payload);
  }

  updateExport(
    receiptId: string,
    payload: {
      staff: string;
      exportDate: string;
      reason: string;
      note: string;
      details: Array<{ materialCode: string; quantity: number }>;
    }
  ): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      `${this.apiUrl}/exports/${encodeURIComponent(receiptId)}`,
      payload
    );
  }

  deleteExport(receiptId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/exports/${encodeURIComponent(receiptId)}`
    );
  }
}

