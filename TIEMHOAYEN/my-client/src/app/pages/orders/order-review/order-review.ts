import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { apiBaseUrl, getCustomerOrderAccessToken } from '../../../services/api-config';

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
  private readonly apiUrl = `${apiBaseUrl()}/reviews`;
  private readonly orderCacheTtlMs = 5 * 60 * 1000;

  public readonly defaultImage = 'assets/images/hoa.jpg';

  isLoggedIn = false;
  currentCustomerId = '';
  currentCustomerName = '';

  showPicker = false;
  pickerStep: 'guest-lookup' | 'order' = 'guest-lookup';
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

  selectedRating = 0;
  reviewText = '';
  hideReviewer = false;

  selectedFiles: File[] = [];
  imagePreviewUrls: string[] = [];

  previousReviews: ProductReview[] = [];

  private routeOrderId = '';
  private routePhone = '';
  private drafts = new Map<string, { rating: number; text: string; hide: boolean; files: File[]; previews: string[] }>();


  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.loadCustomerFromStorage();
    this.readRouteSelection();

    if (this.isLoggedIn && this.currentCustomerId) {
      this.pickerStep = 'order';
      this.showPicker = true;
      if (this.isLoggedIn) this.loadCustomerReviewHistory();
      else this.loadGuestReviewHistory(this.normalizePhone(this.guestPhone || this.selectedOrder?.receiverPhone || ''));
      this.loadReviewableOrdersForCustomer(this.routeOrderId);
      return;
    }

    this.pickerStep = 'guest-lookup';
    this.previousReviews = [];

    if (this.routeOrderId) {
      this.guestOrderCode = this.routeOrderId;
      this.guestPhone = this.formatPhoneInput(this.routePhone);

      if (this.routePhone) {
        this.lookupGuestOrder();
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
    if (this.submitting) return;
    this.showPicker = false;
    this.pickerError = '';
  }

  onChangeOrderClick(): void {
    this.openPicker();
  }

  goBackToOrderPicker(): void {
    if (this.submitting) return;
    this.showPicker = true;
    this.pickerError = '';
    this.saveCurrentDraft();
    this.selectedOrder = null;
    this.resetForm(false);
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

    this.selectOrder(order);
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

  private sessionHeaders(json = false): Record<string, string> {
    const token = getCustomerOrderAccessToken();
    return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'x-order-access': token } : {}) };
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
    return `tiemHoaYen:reviewable-orders:v2:${this.currentCustomerId}`;
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

  onReviewImageError(event: Event): void {
    const image = event.target as HTMLImageElement;
    image.src = this.defaultImage;
  }

  private loadReviewableOrdersForCustomer(preferredOrderId = ''): void {
    const hasCachedOrders = this.restoreReviewableOrders();
    this.loadingOrders = !hasCachedOrders;
    this.pickerError = '';

    if (hasCachedOrders) {
      this.refreshView();
      if (preferredOrderId && this.orders.some(item => this.isSameOrder(item.orderId, preferredOrderId))) {
        this.focusOrderFromRoute(preferredOrderId);
      }
    }

    this.fetchWithTimeout(
      `${this.apiUrl}/customer/${encodeURIComponent(this.currentCustomerId)}/reviewable-orders`,
      { headers: this.sessionHeaders() }
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

        if (preferredOrderId) {
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

  lookupGuestOrder(): void {
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
      headers: this.sessionHeaders(true),
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
        this.selectOrder(data.order);

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
    if (this.submitting) return;
    this.saveCurrentDraft();
    this.selectedOrder = order;
    this.showPicker = false;
    this.pickerError = '';
    this.submitMessage = '';
    this.restoreDraft();

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
    if (this.submitting) return;
    this.showPicker = true;
    this.pickerError = '';
    this.saveCurrentDraft();

    if (this.isLoggedIn) {
      this.pickerStep = 'order';

      if (this.orders.length === 0 && !this.loadingOrders) {
        this.loadReviewableOrdersForCustomer();
      }
    } else {
      this.pickerStep = 'guest-lookup';
    }
  }

  setRating(star: number): void {
    this.selectedRating = star;
    this.saveCurrentDraft();
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
    this.saveCurrentDraft();
  }

  removeReviewImage(index: number): void {
    const previewUrl = this.imagePreviewUrls[index];

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    this.selectedFiles.splice(index, 1);
    this.imagePreviewUrls.splice(index, 1);
    this.saveCurrentDraft();
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
      `${this.apiUrl}/customer/${encodeURIComponent(this.currentCustomerId)}/history`,
      { headers: this.sessionHeaders() }
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
      headers: this.sessionHeaders(true),
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

  private buildLocalSubmittedReview(
    order: ReviewOrder,
    product: ReviewProduct,
    reviewId: string,
    imageUrls: string[],
    rating: number,
    content: string,
    hideReviewer: boolean,
  ): ProductReview {
    return {
      reviewId: reviewId || `local-${Date.now()}`,
      orderId: order.orderId,
      productId: product.productId,
      productName: product.productName,
      productImage: product.image || this.defaultImage,
      customerId: hideReviewer ? null : (this.isLoggedIn ? this.currentCustomerId : null),
      customerName: hideReviewer
        ? 'Khách hàng ẩn danh'
        : (this.currentCustomerName || 'Khách hàng'),
      rating,
      content,
      createdAt: new Date().toISOString(),
      images: imageUrls || [],
    };
  }

  private prependSubmittedReviews(reviews: ProductReview[]): void {
    this.previousReviews = [
      ...reviews,
      ...this.previousReviews.filter(item => !reviews.some(review => item.reviewId === review.reviewId)),
    ];

    if (this.isLoggedIn) this.cacheCustomerReviewHistory();
  }

  private async postOrderReview(
    order: ReviewOrder,
    productIds: string[],
    rating: number,
    content: string,
    hideReviewer: boolean,
    files: File[],
  ): Promise<{ reviews?: { reviewId: string; productId: string }[]; reviewId?: string; imageUrls?: string[] }> {
    const formData = new FormData();
    formData.append('orderId', order.orderId);
    formData.append('productIds', JSON.stringify(productIds));
    formData.append('actorCustomerId', this.isLoggedIn ? this.currentCustomerId : '');
    formData.append('phone', this.isLoggedIn ? '' : this.normalizePhone(this.guestPhone || order.receiverPhone || ''));
    formData.append('hideReviewer', String(hideReviewer));
    formData.append('rating', String(rating));
    formData.append('content', content);
    files.forEach(file => formData.append('images', file));

    const response = await this.fetchWithTimeout(this.apiUrl, {
      method: 'POST',
      headers: this.sessionHeaders(),
      body: formData,
    }, 30000);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.message || 'Không thể lưu đánh giá.');
    }

    return data as { reviews?: { reviewId: string; productId: string }[]; reviewId?: string; imageUrls?: string[] };
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
    const order = this.selectedOrder;
    if (!order) {
      this.showPicker = true;
      this.submitMessage = 'Vui lòng chọn đơn hàng cần đánh giá.';
      return;
    }

    if (this.isOrderReviewed(order)) {
      this.submitMessage = 'Đơn hàng này đã được đánh giá.';
      return;
    }

    if (this.selectedRating <= 0) {
      this.submitMessage = 'Vui lòng chọn số sao đánh giá.';
      return;
    }

    if (order.items.length === 0) {
      this.submitMessage = 'Đơn hàng này đã được đánh giá.';
      return;
    }

    this.submitting = true;
    this.submitMessage = 'Đang gửi đánh giá cho toàn bộ sản phẩm trong đơn...';
    void this.submitOrderReview(
      order,
      order.items,
      this.selectedRating,
      this.reviewText.trim(),
      this.hideReviewer,
      [...this.selectedFiles],
    );
  }

  private async submitOrderReview(
    order: ReviewOrder,
    products: ReviewProduct[],
    rating: number,
    content: string,
    hideReviewer: boolean,
    files: File[],
  ): Promise<void> {
    try {
      const response = await this.postOrderReview(
        order,
        products.map(product => product.productId),
        rating,
        content,
        hideReviewer,
        files,
      );
      const orderReviews = response.reviews || [];
      const reviewsByProduct = new Map(orderReviews.map(review => [review.productId, review]));
      if (products.some(product => !reviewsByProduct.has(product.productId))) {
        throw new Error('Máy chủ chưa hỗ trợ lưu đánh giá toàn đơn. Vui lòng cập nhật backend rồi thử lại.');
      }

      order.items.forEach(item => item.reviewed = true);
      this.finishOrderReview(
        order,
        order.items.map(product => ({
          ...reviewsByProduct.get(product.productId)!,
          imageUrls: Array.isArray(response.imageUrls) ? response.imageUrls : [],
        })),
        rating,
        content,
        hideReviewer,
      );
      this.submitMessage = 'Đánh giá cho toàn bộ đơn hàng đã được gửi thành công.';
      this.loadReviewHistoryForSelectedOrder(order);
    } catch (error) {
      console.error('Lỗi gửi đánh giá:', error);
      this.submitMessage = this.getReviewErrorMessage(error);
    } finally {
      this.submitting = false;
      this.refreshView();
    }
  }

  private finishOrderReview(
    order: ReviewOrder,
    savedReviews: { reviewId: string; productId: string; imageUrls: string[] }[],
    rating: number,
    content: string,
    hideReviewer: boolean,
  ): void {
    const reviewByProduct = new Map(savedReviews.map(review => [review.productId, review]));
    this.prependSubmittedReviews(order.items.map((product, index) => {
      const saved = reviewByProduct.get(product.productId);
      return this.buildLocalSubmittedReview(
        order,
        product,
        saved?.reviewId || `local-${Date.now()}-${index}`,
        saved?.imageUrls || [],
        rating,
        content,
        hideReviewer,
      );
    }));

    const completedDraftKey = this.draftKey();
    this.drafts.delete(completedDraftKey);
    localStorage.removeItem(`tiemHoaYen:review-draft:${completedDraftKey}`);
    this.resetForm(true);
    this.persistReviewableOrders();
  }

  private persistReviewableOrders(): void {
    if (this.isLoggedIn) this.cacheReviewableOrders();
  }

  private loadReviewHistoryForSelectedOrder(order: ReviewOrder): void {
    if (this.isLoggedIn) {
      this.loadCustomerReviewHistory();
    } else {
      this.loadGuestReviewHistory(this.normalizePhone(this.guestPhone || order.receiverPhone || ''));
    }
  }

  private getReviewErrorMessage(error: any): string {
    return error?.name === 'AbortError'
      ? 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.'
      : (error?.message || 'Không thể lưu đánh giá.');
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

  saveCurrentDraft(): void {
    const key = this.draftKey();
    if (!key) return;
    this.drafts.set(key, { rating: this.selectedRating, text: this.reviewText, hide: this.hideReviewer, files: [...this.selectedFiles], previews: [...this.imagePreviewUrls] });
    try {
      localStorage.setItem(`tiemHoaYen:review-draft:${key}`, JSON.stringify({ rating: this.selectedRating, text: this.reviewText, hide: this.hideReviewer }));
    } catch {}
  }

  private restoreDraft(): void {
    this.resetForm(false);
    const key = this.draftKey();
    if (!key) return;
    let draft = this.drafts.get(key);
    if (!draft) {
      try {
        const stored = JSON.parse(localStorage.getItem(`tiemHoaYen:review-draft:${key}`) || 'null');
        if (stored) draft = { rating: Number(stored.rating || 0), text: String(stored.text || ''), hide: Boolean(stored.hide), files: [], previews: [] };
      } catch {}
    }
    if (!draft) return;
    this.selectedRating = draft.rating; this.reviewText = draft.text; this.hideReviewer = draft.hide;
    this.selectedFiles = [...draft.files]; this.imagePreviewUrls = [...draft.previews];
  }

  private draftKey(): string {
    return this.selectedOrder?.orderId || '';
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

  isOrderReviewed(order: ReviewOrder): boolean {
    return order.items.length > 0 && order.items.every(item => item.reviewed);
  }

  get canSubmit(): boolean {
    return !!this.selectedOrder &&
      !this.isOrderReviewed(this.selectedOrder) &&
      this.selectedRating > 0 &&
      !!this.reviewText.trim() &&
      !this.submitting;
  }
}
