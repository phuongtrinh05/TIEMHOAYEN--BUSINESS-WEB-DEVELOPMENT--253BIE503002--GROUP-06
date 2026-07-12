import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

interface ReviewProduct {
  productId: string;
  productName: string;
  image: string | null;
  quantity: number;
  price: number;
  reviewed: boolean;
}

interface ReviewOrder {
  orderId: string;
  createdAt: string;
  total: number;
  status: string;
  receiverPhone?: string;
  items: ReviewProduct[];
}

interface ProductReview {
  reviewId: string;
  orderId: string;
  productId: string;
  productName?: string;
  productImage?: string | null;
  customerId: string | null;
  customerName: string;
  rating: number;
  content: string;
  createdAt: string;
  images: string[];
  shopReply?: string | null;
  shopReplyDate?: string | null;
}

@Component({
  selector: 'app-order-review',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './order-review.html',
  styleUrl: './order-review.css',
})
export class OrderReview implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly apiUrl = 'https://tiem-hoa-yen-api.onrender.com/api/reviews';
  private readonly orderCacheTtlMs = 5 * 60 * 1000;

  public readonly defaultImage = 'assets/images/hoa.jpg';

  isLoggedIn = false;
  currentCustomerId = '';
  currentCustomerName = '';

  showPicker = false;
  pickerStep: 'guest-lookup' | 'order' | 'product' = 'guest-lookup';
  loadingOrders = false;
  loadingGuestLookup = false;
  loadingReviews = false;
  submitting = false;

  guestOrderCode = '';
  guestPhone = '';
  pickerError = '';
  submitMessage = '';

  orders: ReviewOrder[] = [];
  selectedOrder: ReviewOrder | null = null;
  selectedProduct: ReviewProduct | null = null;

  selectedRating = 0;
  reviewText = '';
  hideReviewer = false;

  selectedFiles: File[] = [];
  imagePreviewUrls: string[] = [];

  previousReviews: ProductReview[] = [];

  private routeOrderId = '';
  private routePhone = '';


  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.loadCustomerFromStorage();
    this.readRouteSelection();

    if (this.isLoggedIn && this.currentCustomerId) {
      this.pickerStep = 'order';
      this.showPicker = true;
      this.loadCustomerReviewHistory();
      this.loadReviewableOrdersForCustomer(this.routeOrderId);
      return;
    }

    this.pickerStep = 'guest-lookup';
    this.previousReviews = [];

    if (this.routeOrderId) {
      this.guestOrderCode = this.routeOrderId;
      this.guestPhone = this.formatPhoneInput(this.routePhone);

      if (this.routePhone) {
        this.lookupGuestOrder(true);
      } else {
        this.showPicker = true;
        this.pickerError = 'Vui lòng nhập số điện thoại người nhận để tiếp tục đánh giá đơn này.';
      }
    }
  }

  ngOnDestroy(): void {
    this.revokeImagePreviews();
  }

  closePicker(): void {
    this.showPicker = false;
    this.pickerError = '';
  }

  goBack(): void {
    this.pickerError = '';

    if (this.pickerStep === 'product') {
      this.pickerStep = this.isLoggedIn ? 'order' : 'guest-lookup';
      return;
    }

    if (this.selectedOrder && this.selectedProduct) {
      this.showPicker = false;
    }
  }

  onChangeProductClick(): void {
    this.openPicker();
  }

  goBackToOrderPicker(): void {
    this.showPicker = true;
    this.pickerError = '';
    this.selectedOrder = null;
    this.selectedProduct = null;
    this.pickerStep = this.isLoggedIn ? 'order' : 'guest-lookup';

    if (this.isLoggedIn && this.orders.length === 0 && !this.loadingOrders) {
      this.loadReviewableOrdersForCustomer();
    }
  }

  private readRouteSelection(): void {
    const orderId = String(
      this.route.snapshot.paramMap.get('id') ||
      this.route.snapshot.queryParamMap.get('orderId') ||
      this.route.snapshot.queryParamMap.get('orderCode') ||
      ''
    ).trim();

    this.routeOrderId = orderId.toUpperCase();

    this.routePhone = String(this.route.snapshot.queryParamMap.get('phone') || '')
      .replace(/\D/g, '')
      .slice(0, 10);
  }

  private isSameOrder(a: string, b: string): boolean {
    return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
  }

  private focusOrderFromRoute(orderId: string): void {
    if (!orderId) {
      return;
    }

    const order = this.orders.find(item => this.isSameOrder(item.orderId, orderId));

    if (!order) {
      this.showPicker = true;
      this.pickerStep = 'order';
      this.pickerError = `Không tìm thấy đơn ${orderId} trong danh sách đơn có thể đánh giá.`;
      return;
    }

    this.selectedOrder = order;
    this.selectedProduct = null;
    this.pickerError = '';
    this.pickerStep = 'product';
    this.pickProductForSelectedOrder();
  }

  private pickProductForSelectedOrder(): void {
    if (!this.selectedOrder) {
      return;
    }

    const availableProducts = this.selectedOrder.items.filter(item => !item.reviewed);

    if (availableProducts.length === 0) {
      this.showPicker = true;
      this.pickerStep = 'product';
      this.pickerError = 'Tất cả sản phẩm trong đơn này đã được đánh giá.';
      return;
    }

    if (availableProducts.length === 1) {
      this.selectProduct(availableProducts[0]);
      return;
    }

    this.showPicker = true;
    this.pickerStep = 'product';
    this.pickerError = 'Vui lòng chọn sản phẩm trong đơn này để đánh giá.';
  }


  private loadCustomerFromStorage(): void {
    const raw = localStorage.getItem('khachHang');

    if (!raw || raw === 'null' || raw === 'undefined') {
      this.isLoggedIn = false;
      return;
    }

    try {
      const customer = JSON.parse(raw);
      this.currentCustomerId = String(
        customer?.KHACH_HANG_ID ||
        customer?.khachHangId ||
        customer?.id ||
        ''
      );

      this.currentCustomerName = String(customer?.TEN || customer?.name || '');
      this.isLoggedIn = !!this.currentCustomerId;
    } catch {
      this.isLoggedIn = false;
      this.currentCustomerId = '';
      this.currentCustomerName = '';
    }
  }

  private refreshView(): void {
    this.cdr.detectChanges();
  }

  private fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit = {},
    timeoutMs = 15000
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    return fetch(input, {
      ...init,
      signal: controller.signal,
    }).finally(() => window.clearTimeout(timeoutId));
  }

  private normalizePhone(phone: string): string {
    return String(phone || '').replace(/\D/g, '').slice(0, 10);
  }

  formatPhoneInput(value: string): string {
    const digits = this.normalizePhone(value);

    if (digits.length <= 4) {
      return digits;
    }

    if (digits.length <= 7) {
      return `${digits.slice(0, 4)} ${digits.slice(4)}`;
    }

    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }

  onGuestPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.guestPhone = this.formatPhoneInput(input.value);
  }

  private get reviewableOrdersCacheKey(): string {
    return `tiemHoaYen:reviewable-orders:${this.currentCustomerId}`;
  }

  private restoreReviewableOrders(): boolean {
    try {
      const raw = localStorage.getItem(this.reviewableOrdersCacheKey);
      if (!raw) return false;

      const cache = JSON.parse(raw) as { expiresAt?: number; orders?: ReviewOrder[] };
      if (!cache.expiresAt || cache.expiresAt <= Date.now() || !Array.isArray(cache.orders)) {
        localStorage.removeItem(this.reviewableOrdersCacheKey);
        return false;
      }

      this.orders = cache.orders;
      return true;
    } catch {
      return false;
    }
  }

  private cacheReviewableOrders(): void {
    try {
      localStorage.setItem(
        this.reviewableOrdersCacheKey,
        JSON.stringify({ expiresAt: Date.now() + this.orderCacheTtlMs, orders: this.orders })
      );
    } catch {
      // Cache is optional and must not block the review flow.
    }
  }

  private loadReviewableOrdersForCustomer(preferredOrderId = ''): void {
    const hasCachedOrders = this.restoreReviewableOrders();
    this.loadingOrders = !hasCachedOrders;
    this.pickerError = '';

    if (hasCachedOrders) {
      this.refreshView();
      if (preferredOrderId) this.focusOrderFromRoute(preferredOrderId);
    }

    this.fetchWithTimeout(
      `${this.apiUrl}/customer/${encodeURIComponent(this.currentCustomerId)}/reviewable-orders`
    )
      .then(async response => {
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.message || 'Không thể lấy đơn hàng có thể đánh giá.');
        }

        return data as { orders?: ReviewOrder[] };
      })
      .then(data => {
        this.orders = Array.isArray(data.orders) ? data.orders : [];
        this.cacheReviewableOrders();

        if (preferredOrderId && !this.selectedOrder) {
          this.focusOrderFromRoute(preferredOrderId);
          return;
        }

        if (this.orders.length === 0) {
          this.pickerError = 'Bạn chưa có đơn hàng giao thành công nào để đánh giá.';
        }
      })
      .catch(error => {
        console.error('Lỗi load đơn hàng đánh giá:', error);
        this.orders = [];
        this.pickerError = error?.name === 'AbortError'
          ? 'Máy chủ phản hồi quá lâu. Vui lòng kiểm tra backend tại cổng 3000.'
          : (error?.message || 'Không thể lấy đơn hàng.');
      })
      .finally(() => {
        this.loadingOrders = false;
        this.refreshView();
      });
  }

  lookupGuestOrder(fromRoute = false): void {
    const orderCode = this.guestOrderCode.trim().toUpperCase();
    const phone = this.normalizePhone(this.guestPhone);

    if (!orderCode) {
      this.pickerError = 'Vui lòng nhập mã đơn hàng.';
      return;
    }

    if (!/^0\d{9}$/.test(phone)) {
      this.pickerError = 'Vui lòng nhập số điện thoại nhận hàng hợp lệ.';
      return;
    }

    this.loadingGuestLookup = true;
    this.pickerError = '';

    this.fetchWithTimeout(`${this.apiUrl}/guest/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: orderCode, phone }),
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.message || 'Mã đơn hàng hoặc số điện thoại không đúng.');
        }

        return data as { order?: ReviewOrder };
      })
      .then(data => {
        this.loadingGuestLookup = false;

        if (!data.order) {
          this.pickerError = 'Không tìm thấy đơn hàng phù hợp.';
          return;
        }

        this.orders = [data.order];
        this.selectedOrder = data.order;
        this.pickerStep = 'product';
        this.loadGuestReviewHistory(phone);

        if (fromRoute) {
          this.pickProductForSelectedOrder();
        }

        this.refreshView();
      })
      .catch(error => {
        console.error('Lỗi tra cứu đơn hàng khách vãng lai:', error);
        this.loadingGuestLookup = false;
        this.pickerError = error?.name === 'AbortError'
          ? 'Máy chủ phản hồi quá lâu. Vui lòng kiểm tra backend tại cổng 3000.'
          : (error?.message || 'Không thể tra cứu đơn hàng.');
        this.refreshView();
      });
  }

  selectOrder(order: ReviewOrder): void {
    this.selectedOrder = order;
    this.selectedProduct = null;
    this.pickerError = '';
    this.pickerStep = 'product';
  }

  backToOrderList(): void {
    this.selectedOrder = null;
    this.selectedProduct = null;
    this.pickerError = '';
    this.pickerStep = this.isLoggedIn ? 'order' : 'guest-lookup';
  }

  selectProduct(product: ReviewProduct): void {
    if (product.reviewed) {
      this.pickerError = 'Sản phẩm này trong đơn đã được đánh giá rồi.';
      return;
    }

    this.selectedProduct = product;
    this.showPicker = false;
    this.pickerError = '';
    this.submitMessage = '';
    this.resetForm(false);

    if (this.isLoggedIn && this.currentCustomerId) {
      this.loadCustomerReviewHistory();
    } else {
      const phone = this.normalizePhone(
        this.guestPhone || this.selectedOrder?.receiverPhone || ''
      );
      this.loadGuestReviewHistory(phone);
    }
  }

  openPicker(): void {
    this.showPicker = true;
    this.pickerError = '';

    if (this.isLoggedIn) {
      this.pickerStep = this.selectedOrder ? 'product' : 'order';

      if (this.orders.length === 0 && !this.loadingOrders) {
        this.loadReviewableOrdersForCustomer();
      }
    } else {
      this.pickerStep = this.selectedOrder ? 'product' : 'guest-lookup';
    }
  }

  setRating(star: number): void {
    this.selectedRating = star;
  }

  onReviewImagesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);

    if (files.length === 0) {
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const maxFileSize = 5 * 1024 * 1024;
    const maxFiles = 5;

    for (const file of files) {
      if (this.selectedFiles.length >= maxFiles) {
        this.submitMessage = 'Bạn chỉ có thể chọn tối đa 5 ảnh cho một đánh giá.';
        break;
      }

      if (!allowedTypes.includes(file.type)) {
        this.submitMessage = 'Ảnh đánh giá chỉ hỗ trợ JPG, PNG hoặc WEBP.';
        continue;
      }

      if (file.size > maxFileSize) {
        this.submitMessage = `Ảnh "${file.name}" vượt quá 5MB.`;
        continue;
      }

      this.selectedFiles.push(file);
      this.imagePreviewUrls.push(URL.createObjectURL(file));
    }

    input.value = '';
  }

  removeReviewImage(index: number): void {
    const previewUrl = this.imagePreviewUrls[index];

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    this.selectedFiles.splice(index, 1);
    this.imagePreviewUrls.splice(index, 1);
  }

  private revokeImagePreviews(): void {
    this.imagePreviewUrls.forEach(url => URL.revokeObjectURL(url));
    this.imagePreviewUrls = [];
  }

  private clearSelectedImages(): void {
    this.revokeImagePreviews();
    this.selectedFiles = [];
  }

  private get customerReviewsCacheKey(): string {
    return `tiemHoaYen:review-history:${this.currentCustomerId}`;
  }

  private restoreCustomerReviewHistory(): boolean {
    try {
      const raw = localStorage.getItem(this.customerReviewsCacheKey);
      if (!raw) return false;

      const cache = JSON.parse(raw) as { expiresAt?: number; reviews?: ProductReview[] };
      if (!cache.expiresAt || cache.expiresAt <= Date.now() || !Array.isArray(cache.reviews)) {
        localStorage.removeItem(this.customerReviewsCacheKey);
        return false;
      }

      this.previousReviews = cache.reviews;
      return true;
    } catch {
      return false;
    }
  }

  private cacheCustomerReviewHistory(): void {
    if (!this.currentCustomerId) return;

    try {
      localStorage.setItem(
        this.customerReviewsCacheKey,
        JSON.stringify({
          expiresAt: Date.now() + this.orderCacheTtlMs,
          reviews: this.previousReviews,
        })
      );
    } catch {
      // Cache is optional and must not block the review page.
    }
  }

  private loadCustomerReviewHistory(): void {
    if (!this.currentCustomerId) {
      this.previousReviews = [];
      return;
    }

    const hasCachedReviews = this.restoreCustomerReviewHistory();
    this.loadingReviews = !hasCachedReviews;

    this.fetchWithTimeout(
      `${this.apiUrl}/customer/${encodeURIComponent(this.currentCustomerId)}/history`
    )
      .then(async response => {
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.message || 'Không thể lấy lịch sử đánh giá của bạn.');
        }

        return data as { reviews?: ProductReview[] };
      })
      .then(data => {
        this.previousReviews = Array.isArray(data.reviews) ? data.reviews : [];
        this.cacheCustomerReviewHistory();
        this.loadingReviews = false;
        this.refreshView();
      })
      .catch(error => {
        console.error('Lỗi load lịch sử đánh giá của khách hàng:', error);
        if (!hasCachedReviews) this.previousReviews = [];
        this.loadingReviews = false;
        this.refreshView();
      });
  }

  private loadGuestReviewHistory(phone: string): void {
    const normalizedPhone = this.normalizePhone(phone);

    if (!/^0\d{9}$/.test(normalizedPhone)) {
      this.previousReviews = [];
      return;
    }

    this.loadingReviews = true;

    this.fetchWithTimeout(`${this.apiUrl}/guest/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: normalizedPhone }),
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.message || 'Không thể lấy lịch sử đánh giá.');
        }

        return data as { reviews?: ProductReview[] };
      })
      .then(data => {
        this.previousReviews = Array.isArray(data.reviews) ? data.reviews : [];
        this.loadingReviews = false;
        this.refreshView();
      })
      .catch(error => {
        console.error('Lỗi load lịch sử đánh giá khách vãng lai:', error);
        this.previousReviews = [];
        this.loadingReviews = false;
        this.refreshView();
      });
  }

  private buildLocalSubmittedReview(reviewId: string, imageUrls: string[]): ProductReview | null {
    if (!this.selectedOrder || !this.selectedProduct) {
      return null;
    }

    return {
      reviewId: reviewId || `local-${Date.now()}`,
      orderId: this.selectedOrder.orderId,
      productId: this.selectedProduct.productId,
      productName: this.selectedProduct.productName,
      productImage: this.selectedProduct.image || this.defaultImage,
      customerId: this.hideReviewer ? null : (this.isLoggedIn ? this.currentCustomerId : null),
      customerName: this.hideReviewer
        ? 'Khách hàng ẩn danh'
        : (this.currentCustomerName || 'Khách hàng'),
      rating: this.selectedRating,
      content: this.reviewText.trim(),
      createdAt: new Date().toISOString(),
      images: imageUrls || [],
    };
  }

  private prependSubmittedReview(review: ProductReview | null): void {
    if (!review) {
      return;
    }

    this.previousReviews = [
      review,
      ...this.previousReviews.filter(item => item.reviewId !== review.reviewId),
    ];

    if (this.isLoggedIn) this.cacheCustomerReviewHistory();
  }

  private loadProductReviews(productId: string): void {
    this.loadingReviews = true;

    this.fetchWithTimeout(`${this.apiUrl}/product/${encodeURIComponent(productId)}`)
      .then(async response => {
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.message || 'Không thể lấy đánh giá trước đây.');
        }

        return data as { reviews?: ProductReview[] };
      })
      .then(data => {
        this.previousReviews = Array.isArray(data.reviews) ? data.reviews : [];
        this.loadingReviews = false;
        this.refreshView();
      })
      .catch(error => {
        console.error('Lỗi load đánh giá sản phẩm:', error);
        this.previousReviews = [];
        this.loadingReviews = false;
        this.refreshView();
      });
  }

  submitReview(): void {
    if (!this.selectedOrder || !this.selectedProduct) {
      this.showPicker = true;
      this.submitMessage = 'Vui lòng chọn đơn hàng và sản phẩm cần đánh giá.';
      return;
    }

    if (this.selectedRating <= 0) {
      this.submitMessage = 'Vui lòng chọn số sao đánh giá.';
      return;
    }

    const phone = this.normalizePhone(this.guestPhone || this.selectedOrder.receiverPhone || '');
    const formData = new FormData();

    formData.append('orderId', this.selectedOrder.orderId);
    formData.append('productId', this.selectedProduct.productId);
    formData.append('actorCustomerId', this.isLoggedIn ? this.currentCustomerId : '');
    formData.append('phone', this.isLoggedIn ? '' : phone);
    formData.append('hideReviewer', String(this.hideReviewer));
    formData.append('rating', String(this.selectedRating));
    formData.append('content', this.reviewText.trim());

    this.selectedFiles.forEach(file => {
      formData.append('images', file);
    });

    this.submitting = true;
    this.submitMessage = '';

    this.fetchWithTimeout(`${this.apiUrl}`, {
      method: 'POST',
      body: formData,
    }, 30000)
      .then(async response => {
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.message || 'Không thể lưu đánh giá.');
        }

        return data as { reviewId?: string; imageUrls?: string[]; orderStatus?: string };
      })
      .then((data) => {
        const submittedReview = this.buildLocalSubmittedReview(
          data.reviewId || '',
          Array.isArray(data.imageUrls) ? data.imageUrls : []
        );

        this.submitting = false;
        this.submitMessage = 'Đánh giá đã được gửi thành công. Đơn hàng đã chuyển sang Hoàn thành.';

        if (this.selectedOrder) {
          this.selectedOrder.status = data.orderStatus || 'Hoàn thành';
          this.selectedOrder.items.forEach(item => item.reviewed = true);
          if (this.isLoggedIn) this.cacheReviewableOrders();
        }

        this.prependSubmittedReview(submittedReview);
        this.resetForm(true);
        this.refreshView();
      })
      .catch(error => {
        console.error('Lỗi gửi đánh giá:', error);
        this.submitting = false;
        this.submitMessage = error?.name === 'AbortError'
          ? 'Máy chủ phản hồi quá lâu. Vui lòng kiểm tra backend tại cổng 3000.'
          : (error?.message || 'Không thể lưu đánh giá.');
        this.refreshView();
      });
  }

  private resetForm(keepSelection: boolean): void {
    this.selectedRating = 0;
    this.reviewText = '';
    this.hideReviewer = false;
    this.clearSelectedImages();

    if (!keepSelection) {
      return;
    }
  }

  formatPrice(value: number): string {
    return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
  }

  formatDate(value: string): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString('vi-VN');
  }

  get selectedOrderCode(): string {
    return this.selectedOrder?.orderId || 'Chưa chọn đơn';
  }

  get selectedProductName(): string {
    return this.selectedProduct?.productName || 'Chưa chọn sản phẩm';
  }

  get canSubmit(): boolean {
    return !!this.selectedOrder &&
      !!this.selectedProduct &&
      !this.selectedProduct.reviewed &&
      this.selectedRating > 0 &&
      !this.submitting;
  }
}
