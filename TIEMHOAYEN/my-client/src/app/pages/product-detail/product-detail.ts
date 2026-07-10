import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import {
  ProductDetailService,
  ProductDetailData,
  ProductDetailImage,
  ProductReviewData,
  ProductReviewStats
} from '../../services/product-detail.service';

import {
  CategoryProductService,
  CategoryProduct
} from '../../services/category-product.service';

import {
  CartService,
} from '../../services/cart.service';
import { CustomerService } from '../../services/customer.service';

interface ProductView {
  id: string;
  name: string;
  sku: string;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  sold: number;
  salePrice: number;
  oldPrice: number | null;
  discount: number;
  description: string;
  status: string;
  quantity: number;
  topicId: string;
  topicName: string;
}

interface ProductReviewView {
  reviewId: string;
  orderId: string;
  productId: string;
  name: string;
  avatar: string;
  time: string;
  rating: number;
  content: string;
  images: string[];
  createdAt: string;
  shopReply: string | null;
  shopReplyDate: string | null;
  shopReplyStaffId?: string | null;
}

interface RelatedProduct {
  id: string;
  name: string;
  price: number;
  originalPrice: number | null;
  image: string;
  maxQuantity: number;
  status: string;
  topicName: string;
  isFavorite?: boolean;
  isWishlistPending?: boolean;
}

interface ProductPreviewState {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  salePrice: number | null;
  image: string;
  maxQuantity?: number;
  breadcrumbGroup?: string;
  breadcrumbReturnUrl?: string;
  filters?: {
    chuDe?: string[];
    kieuDang?: string[];
    hoaTuoi?: string[];
    doiTuong?: string[];
  };
}

interface ReviewImageViewer {
  images: string[];
  index: number;
}

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './product-detail.html',
  styleUrls: ['./product-detail.css']
})
export class ProductDetailComponent implements OnInit, AfterViewInit, OnDestroy {
  quantity = 1;
  selectedImage = '';
  isLoading = false;

  readonly defaultImage = 'assets/images/hoa.jpg';
  readonly stars = [1, 2, 3, 4, 5];

  product: ProductView = {
    id: '',
    name: '',
    sku: '',
    image: this.defaultImage,
    images: [this.defaultImage],
    rating: 0,
    reviewCount: 0,
    sold: 0,
    salePrice: 0,
    oldPrice: null,
    discount: 0,
    description: '',
    status: 'Hiện đang có sẵn',
    quantity: 1,
    topicId: '',
    topicName: ''
  };

  reviews: ProductReviewView[] = [];
  relatedProducts: RelatedProduct[] = [];
  activeImageViewer: ReviewImageViewer | null = null;
  breadcrumbGroupLabel = 'Chủ đề';
  breadcrumbReturnUrl = '/category';
  isFavorite = false;
  isWishlistPending = false;
  isShowingAllReviews = false;
  private routeSubscription?: Subscription;
  private productRequestSubscription?: Subscription;
  private relatedProductsSubscription?: Subscription;
  private wishlistSubscription?: Subscription;
  private revealObserver?: IntersectionObserver;
  private wishlistProductIds = new Set<string>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productDetailService: ProductDetailService,
    private categoryProductService: CategoryProductService,
    private cartService: CartService,
    private customerService: CustomerService,
    private cdr: ChangeDetectorRef
  ) {}

  private getLoggedInCustomer(): any | null {
    const rawCustomer = localStorage.getItem('khachHang');

    if (!rawCustomer || rawCustomer === 'null' || rawCustomer === 'undefined') {
      return null;
    }

    try {
      const customer = JSON.parse(rawCustomer);

      if (!customer?.KHACH_HANG_ID) {
        return null;
      }

      return customer;
    } catch {
      return null;
    }
  }

  private getCustomerId(): string {
    const customer = this.getLoggedInCustomer();

    return customer?.KHACH_HANG_ID ? String(customer.KHACH_HANG_ID) : '';
  }

  ngOnInit(): void {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const productId = params.get('id');

      if (!productId) {
        this.router.navigate(['/homepage']);
        return;
      }

      this.resetRevealItems();
      this.breadcrumbGroupLabel = 'Chủ đề';
      this.breadcrumbReturnUrl = '/category';
      this.applyProductPreview(productId);
      this.loadWishlistState(productId);
      this.loadProductDetail(productId);
    });
  }

  ngAfterViewInit(): void {
    this.observeRevealItems();
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.productRequestSubscription?.unsubscribe();
    this.relatedProductsSubscription?.unsubscribe();
    this.wishlistSubscription?.unsubscribe();
    this.revealObserver?.disconnect();
  }

  get maxQuantity(): number {
    return Math.max(1, Number(this.product.quantity || 1));
  }

  private loadProductDetail(productId: string): void {
    this.productRequestSubscription?.unsubscribe();
    this.relatedProductsSubscription?.unsubscribe();

    this.isLoading = true;
    this.reviews = [];
    this.isShowingAllReviews = false;
    this.relatedProducts = [];
    this.activeImageViewer = null;

    this.productRequestSubscription = this.productDetailService.getProductById(productId).subscribe({
      next: (res) => {
        if (!res || !res.product) {
          this.isLoading = false;
          this.cdr.detectChanges();
          return;
        }

        this.product = this.mapDbProductToView(
          res.product,
          res.images || [],
          res.reviewStats
        );

        this.reviews = (res.reviews || []).map((review) => this.mapDbReviewToView(review));

        this.selectedImage = this.product.image;
        this.quantity = 1;
        this.isLoading = false;

        this.loadRelatedProducts(this.product.topicId, this.product.id);
        this.loadWishlistState(this.product.id);

        this.cdr.detectChanges();
        this.scheduleRevealObserver();
      },
      error: (err) => {
        console.error('Lỗi load chi tiết sản phẩm:', err);
        this.isLoading = false;
        this.reviews = [];
        this.product.rating = 0;
        this.product.reviewCount = 0;
        this.cdr.detectChanges();
      }
    });
  }

  private applyProductPreview(productId: string): void {
    const preview = history.state?.productPreview as ProductPreviewState | undefined;

    if (!preview || preview.id !== productId) {
      return;
    }

    const originalPrice = Number(preview.originalPrice ?? preview.price ?? 0);
    const salePrice = preview.salePrice !== null && preview.salePrice !== undefined
      ? Number(preview.salePrice)
      : null;
    const hasSalePrice =
      salePrice !== null &&
      !Number.isNaN(salePrice) &&
      salePrice > 0 &&
      salePrice < originalPrice;
    const finalPrice = hasSalePrice ? salePrice : Number(preview.price ?? originalPrice);

    this.product = {
      ...this.product,
      id: preview.id,
      name: preview.name,
      sku: preview.id,
      image: this.normalizeImageUrl(preview.image),
      images: [this.normalizeImageUrl(preview.image)],
      salePrice: finalPrice,
      oldPrice: hasSalePrice ? originalPrice : null,
      discount: hasSalePrice && originalPrice > 0
        ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
        : 0,
      quantity: Math.max(1, Number(preview.maxQuantity ?? 1)),
      topicName: preview.filters?.chuDe?.[0] || this.product.topicName,
    };

    this.breadcrumbGroupLabel = this.normalizeBreadcrumbGroup(preview.breadcrumbGroup);
    this.breadcrumbReturnUrl = preview.breadcrumbReturnUrl || this.breadcrumbReturnUrl;
    this.selectedImage = this.product.image;
    this.quantity = 1;
    this.cdr.detectChanges();
    this.scheduleRevealObserver();
  }

  private loadWishlistState(productId: string): void {
    const customerId = this.getCustomerId();

    this.wishlistSubscription?.unsubscribe();
    this.isFavorite = false;

    if (!customerId || !productId || !productId.startsWith('SP')) {
      return;
    }

    this.wishlistSubscription = this.customerService.getWishlist(customerId).subscribe({
      next: (items) => {
        this.wishlistProductIds = new Set(
          (Array.isArray(items) ? items : [])
            .map((item) => String(item.SAN_PHAM_ID || '').trim())
            .filter(Boolean)
        );
        this.isFavorite = this.wishlistProductIds.has(productId);
        this.syncRelatedWishlistState();
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi load trạng thái yêu thích:', err);
        this.isFavorite = false;
      },
    });
  }

  private loadRelatedProducts(topicId: string, currentProductId: string): void {
    if (!topicId) {
      this.loadFallbackRelatedProducts(currentProductId, []);
      return;
    }

    this.relatedProductsSubscription?.unsubscribe();

    this.relatedProductsSubscription = this.categoryProductService.getProductsByTopic(topicId).subscribe({
      next: (res) => {
        const products = Array.isArray(res.products) ? res.products : [];

        const sameTopicProducts = this.getSameTopicRelatedProducts(products, currentProductId);

        if (sameTopicProducts.length >= 5) {
          this.setRelatedProducts(sameTopicProducts, [], currentProductId);
          return;
        }

        this.loadFallbackRelatedProducts(currentProductId, sameTopicProducts);
      },
      error: (err) => {
        console.error('Lỗi load sản phẩm liên quan:', err);
        this.loadFallbackRelatedProducts(currentProductId, []);
      }
    });
  }

  private loadFallbackRelatedProducts(
    currentProductId: string,
    sameTopicProducts: CategoryProduct[]
  ): void {
    this.relatedProductsSubscription?.unsubscribe();

    this.relatedProductsSubscription = this.categoryProductService.getBestSellerProducts().subscribe({
      next: (res) => {
        const bestSellerProducts = Array.isArray(res.products) ? res.products : [];

        if (sameTopicProducts.length + bestSellerProducts.length >= 5) {
          this.setRelatedProducts(sameTopicProducts, bestSellerProducts, currentProductId);
          return;
        }

        this.loadSaleRelatedProducts(currentProductId, [
          ...sameTopicProducts,
          ...bestSellerProducts,
        ]);
      },
      error: (err) => {
        console.error('Lỗi load sản phẩm bổ sung:', err);
        this.loadSaleRelatedProducts(currentProductId, sameTopicProducts);
      },
    });
  }

  private loadSaleRelatedProducts(
    currentProductId: string,
    currentProducts: CategoryProduct[]
  ): void {
    this.relatedProductsSubscription?.unsubscribe();

    this.relatedProductsSubscription = this.categoryProductService.getSaleProducts().subscribe({
      next: (res) => {
        const saleProducts = Array.isArray(res.products) ? res.products : [];

        if (currentProducts.length + saleProducts.length >= 5) {
          this.setRelatedProducts(currentProducts, saleProducts, currentProductId);
          return;
        }

        this.loadAllProductsRelatedFallback(currentProductId, [
          ...currentProducts,
          ...saleProducts,
        ]);
      },
      error: (err) => {
        console.error('Lỗi load sản phẩm khuyến mãi bổ sung:', err);
        this.loadAllProductsRelatedFallback(currentProductId, currentProducts);
      },
    });
  }

  private loadAllProductsRelatedFallback(
    currentProductId: string,
    currentProducts: CategoryProduct[]
  ): void {
    this.relatedProductsSubscription?.unsubscribe();

    this.relatedProductsSubscription = this.productDetailService.getAllProducts().subscribe({
      next: (products) => {
        const fallbackProducts = (Array.isArray(products) ? products : [])
          .map((item) => this.mapProductDetailToCategoryProduct(item));

        this.setRelatedProducts(currentProducts, fallbackProducts, currentProductId);
      },
      error: (err) => {
        console.error('Lỗi load tất cả sản phẩm bổ sung:', err);
        this.setRelatedProducts(currentProducts, [], currentProductId);
      },
    });
  }

  private getSameTopicRelatedProducts(
    products: CategoryProduct[],
    currentProductId: string
  ): CategoryProduct[] {
    const currentIndex = products.findIndex((item) => item.SAN_PHAM_ID === currentProductId);

    if (currentIndex >= 0) {
      return [
        ...products.slice(currentIndex + 1),
        ...products.slice(0, currentIndex),
      ].filter((item) => item.SAN_PHAM_ID !== currentProductId);
    }

    const candidates = products.filter((item) => item.SAN_PHAM_ID !== currentProductId);
    const startIndex = candidates.length > 0
      ? this.getStableIndex(currentProductId, candidates.length)
      : 0;

    return [
      ...candidates.slice(startIndex),
      ...candidates.slice(0, startIndex),
    ];
  }

  private getStableIndex(value: string, length: number): number {
    if (length <= 0) {
      return 0;
    }

    const total = String(value)
      .split('')
      .reduce((sum, char) => sum + char.charCodeAt(0), 0);

    return total % length;
  }

  private setRelatedProducts(
    sameTopicProducts: CategoryProduct[],
    fallbackProducts: CategoryProduct[],
    currentProductId: string
  ): void {
    const relatedMap = new Map<string, RelatedProduct>();

    [...sameTopicProducts, ...fallbackProducts].forEach((item) => {
      if (!item.SAN_PHAM_ID || item.SAN_PHAM_ID === currentProductId || relatedMap.has(item.SAN_PHAM_ID)) {
        return;
      }

      relatedMap.set(item.SAN_PHAM_ID, this.mapCategoryProductToRelatedProduct(item));
    });

    this.relatedProducts = Array.from(relatedMap.values()).slice(0, 5);
    this.syncRelatedWishlistState();
    this.cdr.detectChanges();
    this.scheduleRevealObserver();
  }

  private mapDbProductToView(
    item: ProductDetailData,
    images: ProductDetailImage[],
    stats?: ProductReviewStats | null
  ): ProductView {
    const originalPrice = Number(item.GIA ?? 0);

    const salePriceRaw =
      item.GIA_KHUYEN_MAI === null || item.GIA_KHUYEN_MAI === undefined
        ? null
        : Number(item.GIA_KHUYEN_MAI);

    const hasSalePrice =
      salePriceRaw !== null &&
      !Number.isNaN(salePriceRaw) &&
      salePriceRaw > 0 &&
      salePriceRaw < originalPrice;

    const finalPrice = hasSalePrice ? salePriceRaw : originalPrice;

    const discount =
      hasSalePrice && originalPrice > 0
        ? Math.round(((originalPrice - salePriceRaw) / originalPrice) * 100)
        : 0;

    const imageList = images
      .map((image) => this.normalizeImageUrl(image.URL))
      .filter((url) => !!url);

    const fallbackImage = this.normalizeImageUrl(item.HINH_ANH);
    const finalImages = imageList.length > 0 ? imageList : [fallbackImage];

    const reviewCount = Math.max(0, Number(stats?.reviewCount ?? 0));
    const averageRating = reviewCount > 0
      ? this.roundRating(Number(stats?.averageRating ?? 0))
      : 0;

    return {
      id: item.SAN_PHAM_ID,
      name: item.TEN_SAN_PHAM,
      sku: item.SAN_PHAM_ID,
      image: finalImages[0],
      images: finalImages,
      rating: averageRating,
      reviewCount,
      sold: Number(item.DA_BAN ?? 0),
      salePrice: finalPrice,
      oldPrice: hasSalePrice ? originalPrice : null,
      discount,
      description: item.MO_TA || '',
      status: item.TRANG_THAI || 'Hiện đang có sẵn',
      quantity: Number(item.SO_LUONG ?? 1),
      topicId: item.CHU_DE_ID || '',
      topicName: item.TEN_CHU_DE || ''
    };
  }

  private mapDbReviewToView(item: ProductReviewData): ProductReviewView {
    const images = Array.isArray(item.images) ? item.images : [];

    return {
      reviewId: String(item.reviewId || ''),
      orderId: String(item.orderId || ''),
      productId: String(item.productId || ''),
      name: item.customerName || 'Khách hàng ẩn danh',
      avatar: this.normalizeImageUrl(item.avatar || this.defaultImage),
      time: this.formatRelativeTime(item.createdAt),
      rating: Math.max(0, Math.min(5, Number(item.rating || 0))),
      content: item.content || '',
      images: images.map((url) => this.normalizeImageUrl(url)).filter((url) => !!url),
      createdAt: item.createdAt || '',
      shopReply: item.shopReply || null,
      shopReplyDate: item.shopReplyDate || null,
      shopReplyStaffId: item.shopReplyStaffId || null
    };
  }

  private mapCategoryProductToRelatedProduct(item: CategoryProduct): RelatedProduct {
    const originalPrice = Number(item.GIA ?? 0);

    const salePrice =
      item.GIA_KHUYEN_MAI === null || item.GIA_KHUYEN_MAI === undefined
        ? null
        : Number(item.GIA_KHUYEN_MAI);

    const hasSalePrice =
      salePrice !== null &&
      !Number.isNaN(salePrice) &&
      salePrice > 0 &&
      salePrice < originalPrice;

    return {
      id: item.SAN_PHAM_ID,
      name: item.TEN_SAN_PHAM,
      price: hasSalePrice ? salePrice : originalPrice,
      originalPrice: hasSalePrice ? originalPrice : null,
      image: this.normalizeImageUrl(item.HINH_ANH),
      maxQuantity: Math.max(1, Number(item.SO_LUONG ?? 1)),
      status: item.TRANG_THAI || 'Sản phẩm',
      topicName: item.TEN_CHU_DE || this.product.topicName || 'Sản phẩm liên quan',
      isFavorite: this.wishlistProductIds.has(item.SAN_PHAM_ID),
      isWishlistPending: false
    };
  }

  private mapProductDetailToCategoryProduct(item: ProductDetailData): CategoryProduct {
    return {
      SAN_PHAM_ID: item.SAN_PHAM_ID,
      CHU_DE_ID: item.CHU_DE_ID || '',
      TEN_CHU_DE: item.TEN_CHU_DE || '',
      TEN_SAN_PHAM: item.TEN_SAN_PHAM,
      MO_TA: item.MO_TA || '',
      GIA: Number(item.GIA ?? 0),
      GIA_KHUYEN_MAI:
        item.GIA_KHUYEN_MAI === null || item.GIA_KHUYEN_MAI === undefined
          ? null
          : Number(item.GIA_KHUYEN_MAI),
      TRANG_THAI: item.TRANG_THAI || '',
      KIEU_DANG: item.KIEU_DANG || '',
      SO_LUONG: Number(item.SO_LUONG ?? 1),
      DA_BAN: Number(item.DA_BAN ?? 0),
      HINH_ANH: item.HINH_ANH || null,
    };
  }

  private syncRelatedWishlistState(): void {
    this.relatedProducts = this.relatedProducts.map((item) => ({
      ...item,
      isFavorite: this.wishlistProductIds.has(item.id),
      isWishlistPending: item.isWishlistPending || false
    }));
  }

  selectImage(image: string): void {
    this.selectedImage = image;
  }

  showPreviousImage(): void {
    this.showImageByStep(-1);
  }

  showNextImage(): void {
    this.showImageByStep(1);
  }

  private showImageByStep(step: -1 | 1): void {
    const images = this.product.images;

    if (images.length <= 1) {
      return;
    }

    const currentImage = this.selectedImage || this.product.image || images[0];
    const currentIndex = Math.max(0, images.indexOf(currentImage));
    const nextIndex = (currentIndex + step + images.length) % images.length;

    this.selectedImage = images[nextIndex];
  }

  goToRelatedProduct(item: RelatedProduct): void {
    this.router.navigate(['/product-detail', item.id], {
      state: {
        productPreview: this.createRelatedProductPreview(item)
      }
    });
  }

  private createRelatedProductPreview(item: RelatedProduct): ProductPreviewState {
    return {
      id: item.id,
      name: item.name,
      price: item.price,
      originalPrice: item.originalPrice ?? item.price,
      salePrice: item.originalPrice ? item.price : null,
      image: item.image,
      maxQuantity: item.maxQuantity,
      breadcrumbGroup: 'Chủ đề',
      filters: {
        chuDe: item.topicName ? [item.topicName] : []
      }
    };
  }

  private normalizeBreadcrumbGroup(label: string | undefined): string {
    const value = String(label || '').trim();
    const allowedLabels = new Set(['Chủ đề', 'Đối tượng', 'Kiểu dáng', 'Hoa tươi', 'Bộ sưu tập']);

    return allowedLabels.has(value) ? value : 'Chủ đề';
  }

  buyRelatedProduct(item: RelatedProduct): void {
    const checkoutItem = {
      id: item.id,
      name: item.name,
      style: item.topicName || 'Sản phẩm liên quan',
      occasion: item.status || 'Sản phẩm',
      price: item.price,
      originalPrice: item.originalPrice,
      quantity: 1,
      image: item.image || this.defaultImage,
      selected: true,
      maxQuantity: item.maxQuantity || 1
    };

    localStorage.setItem('tiemHoaYenCheckoutItems', JSON.stringify([checkoutItem]));

    const customerId = this.getCustomerId();

    if (customerId && item.id.startsWith('SP')) {
      this.cartService.addItem(customerId, item.id, 1).subscribe({
        next: () => {
          this.dispatchCartChanged();
          this.router.navigate(['/order-registrant']);
        },
        error: (err: unknown) => {
          console.error('Lỗi mua ngay sản phẩm liên quan:', err);
        }
      });

      return;
    }

    this.router.navigate(['/order-haunt']);
  }

  addRelatedToCart(item: RelatedProduct, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.playFlyToCartEffect(event);

    const customerId = this.getCustomerId();

    if (customerId && item.id.startsWith('SP')) {
      this.cartService.addItem(customerId, item.id, 1).subscribe({
        next: () => {
          this.dispatchCartChanged();
        },
        error: (err: unknown) => {
          console.error('Lỗi thêm sản phẩm liên quan vào giỏ hàng:', err);
        }
      });

      return;
    }

    const cartStorageKey = 'tiemHoaYenCart';
    const rawCart = localStorage.getItem(cartStorageKey);
    const cart = rawCart ? JSON.parse(rawCart) : [];
    const cartItem = {
      id: item.id,
      name: item.name,
      style: item.topicName || 'Sản phẩm liên quan',
      occasion: item.status || 'Sản phẩm',
      price: item.price,
      originalPrice: item.originalPrice,
      quantity: 1,
      image: item.image || this.defaultImage,
      selected: true,
      maxQuantity: item.maxQuantity || 1
    };
    const existingItem = cart.find((cartProduct: any) => cartProduct.id === item.id);

    if (existingItem) {
      const currentQuantity = Number(existingItem.quantity || 1);

      existingItem.quantity = Math.min(currentQuantity + 1, item.maxQuantity || 1);
      existingItem.name = cartItem.name;
      existingItem.style = cartItem.style;
      existingItem.occasion = cartItem.occasion;
      existingItem.price = cartItem.price;
      existingItem.originalPrice = cartItem.originalPrice;
      existingItem.image = cartItem.image;
      existingItem.selected = true;
      existingItem.maxQuantity = cartItem.maxQuantity;
    } else {
      cart.push(cartItem);
    }

    localStorage.setItem(cartStorageKey, JSON.stringify(cart));
    this.dispatchCartChanged();
  }

  toggleRelatedWishlist(item: RelatedProduct, event?: Event): void {
    event?.stopPropagation();

    const customerId = this.getCustomerId();

    if (!customerId) {
      this.router.navigate(['/login']);
      return;
    }

    if (!item.id || !item.id.startsWith('SP')) {
      return;
    }

    if (item.isWishlistPending) {
      return;
    }

    const previousFavorite = !!item.isFavorite;
    const nextFavorite = !previousFavorite;

    item.isWishlistPending = true;
    item.isFavorite = nextFavorite;

    if (nextFavorite) {
      this.wishlistProductIds.add(item.id);
    } else {
      this.wishlistProductIds.delete(item.id);
    }

    const request$ = nextFavorite
      ? this.customerService.addWishlistItem(customerId, item.id)
      : this.customerService.removeWishlistItem(customerId, item.id);

    request$.subscribe({
      error: (err) => {
        console.error('Lỗi cập nhật yêu thích sản phẩm liên quan:', err);
        item.isFavorite = previousFavorite;

        if (previousFavorite) {
          this.wishlistProductIds.add(item.id);
        } else {
          this.wishlistProductIds.delete(item.id);
        }

        item.isWishlistPending = false;
      },
      complete: () => {
        item.isWishlistPending = false;
        this.cdr.detectChanges();
      },
    });
  }

  goToCurrentTopic(): void {
    if (this.breadcrumbReturnUrl) {
      this.router.navigateByUrl(this.breadcrumbReturnUrl);
      return;
    }

    if (!this.product.topicId) {
      this.router.navigate(['/category']);
      return;
    }

    this.router.navigate(['/chu-de', this.product.topicId]);
  }

  increaseQuantity(): void {
    if (this.quantity < this.maxQuantity) {
      this.quantity++;
    }
  }

  decreaseQuantity(): void {
    if (this.quantity > 1) {
      this.quantity--;
    }
  }

  onQuantityInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);

    if (input.value === '') {
      return;
    }

    if (value < 1) {
      this.quantity = 1;
      input.value = '1';
      return;
    }

    if (value > this.maxQuantity) {
      this.quantity = this.maxQuantity;
      input.value = String(this.maxQuantity);
      return;
    }

    this.quantity = value;
  }

  validateQuantity(): void {
    if (!this.quantity || this.quantity < 1) {
      this.quantity = 1;
      return;
    }

    if (this.quantity > this.maxQuantity) {
      this.quantity = this.maxQuantity;
    }
  }

  toggleWishlist(): void {
    const customerId = this.getCustomerId();

    if (!customerId) {
      this.router.navigate(['/login']);
      return;
    }

    if (!this.product.id || !this.product.id.startsWith('SP')) {
      return;
    }

    if (this.isWishlistPending) {
      return;
    }

    const previousFavorite = this.isFavorite;
    const nextFavorite = !previousFavorite;

    this.isWishlistPending = true;
    this.isFavorite = nextFavorite;

    if (nextFavorite) {
      this.wishlistProductIds.add(this.product.id);
    } else {
      this.wishlistProductIds.delete(this.product.id);
    }
    this.syncRelatedWishlistState();

    const request$ = nextFavorite
      ? this.customerService.addWishlistItem(customerId, this.product.id)
      : this.customerService.removeWishlistItem(customerId, this.product.id);

    request$.subscribe({
      error: (err) => {
        console.error('Lỗi cập nhật yêu thích:', err);
        this.isFavorite = previousFavorite;
        if (previousFavorite) {
          this.wishlistProductIds.add(this.product.id);
        } else {
          this.wishlistProductIds.delete(this.product.id);
        }
        this.syncRelatedWishlistState();
        this.isWishlistPending = false;
      },
      complete: () => {
        this.isWishlistPending = false;
        this.loadWishlistState(this.product.id);
      },
    });
  }

  addToCart(event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.playFlyToCartEffect(event);
    this.saveProductToCart();
  }

  private playFlyToCartEffect(event?: Event): void {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !event) {
      return;
    }

    const targetEl = event.target as HTMLElement | null;
    const button = targetEl?.closest<HTMLButtonElement>('.add-cart-btn, .related-cart-btn');
    const relatedCard = targetEl?.closest('.related-card');
    const productContainer = targetEl?.closest('.product-container');
    const sourceImg = (
      relatedCard?.querySelector('.related-media img') ||
      productContainer?.querySelector('.main-image')
    ) as HTMLImageElement | null;

    button?.classList.add('is-cart-added');
    window.setTimeout(() => button?.classList.remove('is-cart-added'), 520);

    if (!sourceImg) {
      return;
    }

    const cartIcon = this.getVisibleCartIcon();

    const startRect = sourceImg.getBoundingClientRect();
    const endRect = cartIcon?.getBoundingClientRect();
    const endX = endRect ? endRect.left + endRect.width / 2 : window.innerWidth - 32;
    const endY = endRect ? endRect.top + endRect.height / 2 : 28;
    const flyer = sourceImg.cloneNode(true) as HTMLImageElement;

    flyer.style.position = 'fixed';
    flyer.style.left = `${startRect.left}px`;
    flyer.style.top = `${startRect.top}px`;
    flyer.style.width = `${startRect.width}px`;
    flyer.style.height = `${startRect.height}px`;
    flyer.style.margin = '0';
    flyer.style.borderRadius = '12px';
    flyer.style.objectFit = 'cover';
    flyer.style.zIndex = '2147483647';
    flyer.style.pointerEvents = 'none';
    flyer.style.boxShadow = '0 10px 24px rgba(115, 25, 25, .35)';
    flyer.style.willChange = 'transform, opacity';
    flyer.style.transform = 'translateZ(0)';

    document.body.appendChild(flyer);

    const startCenterX = startRect.left + startRect.width / 2;
    const startCenterY = startRect.top + startRect.height / 2;
    const deltaX = endX - startCenterX;
    const deltaY = endY - startCenterY;

    const animation = flyer.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
        {
          transform: `translate(${deltaX * 0.5}px, ${deltaY * 0.5 - 70}px) scale(.65)`,
          opacity: 1,
          offset: 0.55
        },
        { transform: `translate(${deltaX}px, ${deltaY}px) scale(.08)`, opacity: .3, offset: 1 }
      ],
      { duration: 700, easing: 'cubic-bezier(.4,.1,.25,1)' }
    );

    animation.onfinish = () => {
      flyer.remove();

      if (cartIcon) {
        cartIcon.animate(
          [
            { transform: 'scale(1)' },
            { transform: 'scale(1.35)' },
            { transform: 'scale(.92)' },
            { transform: 'scale(1)' }
          ],
          { duration: 420, easing: 'ease-out' }
        );
      }
    };
  }

  private getVisibleCartIcon(): HTMLElement | null {
    const selectors = [
      '[data-cart-icon]',
      '.cart-icon-button',
      '.navbar-cart-icon',
      '#navbar-cart-icon',
      '.cart-icon',
      'a[routerLink*="cart"] i',
      'a[routerLink*="gio-hang"] i'
    ].join(', ');

    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selectors));

    return candidates.find((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom >= 0 &&
        rect.top <= window.innerHeight &&
        rect.right >= 0 &&
        rect.left <= window.innerWidth &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity || 1) > 0;
    }) || null;
  }

  buyNow(): void {
    const checkoutItem = {
      id: this.product.id,
      name: this.product.name,
      style: this.product.topicName || 'Sản phẩm',
      occasion: this.product.status || 'Sản phẩm',
      price: this.product.salePrice,
      originalPrice: this.product.oldPrice,
      quantity: this.quantity,
      image: this.selectedImage || this.product.image,
      selected: true,
      maxQuantity: this.product.quantity
    };

    localStorage.setItem('tiemHoaYenCheckoutItems', JSON.stringify([checkoutItem]));

    if (this.getCustomerId()) {
      this.cartService.addItem(this.getCustomerId(), this.product.id, this.quantity).subscribe({
        next: () => {
          this.dispatchCartChanged();
          this.router.navigate(['/order-registrant']);
        },
        error: (err: unknown) => {
          console.error('Lỗi mua ngay:', err);
        }
      });

      return;
    }

    this.router.navigate(['/order-haunt']);
  }

  private saveProductToCart(): void {
    const customerId = this.getCustomerId();

    const cartItem = {
      id: this.product.id,
      name: this.product.name,
      style: this.product.topicName || 'Sản phẩm',
      occasion: this.product.status || 'Sản phẩm',
      price: this.product.salePrice,
      originalPrice: this.product.oldPrice,
      quantity: this.quantity,
      image: this.selectedImage || this.product.image,
      selected: true,
      maxQuantity: this.product.quantity
    };

    if (customerId && this.product.id.startsWith('SP')) {
      this.cartService.addItem(customerId, this.product.id, this.quantity).subscribe({
        next: () => {
          this.dispatchCartChanged();
        },
        error: (err: unknown) => {
          console.error('Lỗi thêm sản phẩm vào database giỏ hàng:', err);
        }
      });

      return;
    }

    const cartStorageKey = 'tiemHoaYenCart';

    const rawCart = localStorage.getItem(cartStorageKey);
    const cart = rawCart ? JSON.parse(rawCart) : [];

    const existingItem = cart.find((item: any) => item.id === cartItem.id);

    if (existingItem) {
      const currentQuantity = Number(existingItem.quantity || 1);
      const nextQuantity = currentQuantity + this.quantity;

      existingItem.quantity = Math.min(nextQuantity, this.product.quantity);
      existingItem.name = cartItem.name;
      existingItem.style = cartItem.style;
      existingItem.occasion = cartItem.occasion;
      existingItem.price = cartItem.price;
      existingItem.originalPrice = cartItem.originalPrice;
      existingItem.image = cartItem.image;
      existingItem.selected = true;
      existingItem.maxQuantity = cartItem.maxQuantity;
    } else {
      cart.push(cartItem);
    }

    localStorage.setItem(cartStorageKey, JSON.stringify(cart));
    this.dispatchCartChanged();
  }

  getStarIcon(star: number, rating: number): string {
    const value = Math.max(0, Math.min(5, Number(rating || 0)));

    if (value >= star) {
      return 'bi-star-fill';
    }

    if (value >= star - 0.5) {
      return 'bi-star-half';
    }

    return 'bi-star';
  }

  formatRating(rating: number): string {
    if (this.product.reviewCount <= 0) {
      return '0';
    }

    return this.roundRating(rating).toFixed(1);
  }

  get visibleReviews(): ProductReviewView[] {
    return this.isShowingAllReviews ? this.reviews : this.reviews.slice(0, 1);
  }

  get shouldShowMoreReviewsButton(): boolean {
    return this.reviews.length > 1 && !this.isShowingAllReviews;
  }

  showMoreReviews(): void {
    this.isShowingAllReviews = true;
  }

  visibleReviewImages(review: ProductReviewView): string[] {
    return review.images.slice(0, 4);
  }

  remainingImageCount(review: ProductReviewView): number {
    return Math.max(0, review.images.length - 4);
  }

  openReviewImage(review: ProductReviewView, index: number): void {
    if (!review.images.length) {
      return;
    }

    this.activeImageViewer = {
      images: review.images,
      index: Math.max(0, Math.min(index, review.images.length - 1))
    };
  }

  closeReviewImage(): void {
    this.activeImageViewer = null;
  }

  previousReviewImage(): void {
    if (!this.activeImageViewer) {
      return;
    }

    const total = this.activeImageViewer.images.length;
    this.activeImageViewer.index = (this.activeImageViewer.index - 1 + total) % total;
  }

  nextReviewImage(): void {
    if (!this.activeImageViewer) {
      return;
    }

    const total = this.activeImageViewer.images.length;
    this.activeImageViewer.index = (this.activeImageViewer.index + 1) % total;
  }

  private roundRating(value: number): number {
    return Math.round(Math.max(0, Math.min(5, Number(value || 0))) * 10) / 10;
  }

  formatRelativeTime(value: string): string {
    if (!value) {
      return 'vừa xong';
    }

    const createdAt = new Date(value);
    const now = new Date();
    const diffMs = now.getTime() - createdAt.getTime();

    if (Number.isNaN(createdAt.getTime()) || diffMs < 0) {
      return this.formatDate(value);
    }

    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diffMs < minute) {
      return 'vừa xong';
    }

    if (diffMs < hour) {
      return `${Math.floor(diffMs / minute)} phút trước`;
    }

    if (diffMs < day) {
      return `${Math.floor(diffMs / hour)} giờ trước`;
    }

    if (diffMs < 30 * day) {
      return `${Math.floor(diffMs / day)} ngày trước`;
    }

    return this.formatDate(value);
  }

  private formatDate(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value || '';
    }

    return date.toLocaleDateString('vi-VN');
  }

  private dispatchCartChanged(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('cart-changed'));
    }
  }

  private scheduleRevealObserver(): void {
    if (typeof window === 'undefined') {
      return;
    }

    setTimeout(() => this.observeRevealItems());
  }

  private observeRevealItems(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const items = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.product-section, .description-section, .review-section, .review-card, .related-section, .related-card'
      )
    );

    this.revealObserver?.disconnect();

    if (!('IntersectionObserver' in window)) {
      items.forEach((item) => item.classList.add('is-visible'));
      return;
    }

    this.revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          entry.target.classList.add('is-visible');
          this.revealObserver?.unobserve(entry.target);
        });
      },
      {
        root: null,
        rootMargin: '0px 0px -8% 0px',
        threshold: 0.12,
      }
    );

    items.forEach((item) => this.revealObserver?.observe(item));
  }

  private resetRevealItems(): void {
    if (typeof document === 'undefined') {
      return;
    }

    this.revealObserver?.disconnect();

    document
      .querySelectorAll<HTMLElement>(
        '.product-section, .description-section, .review-section, .review-card, .related-section, .related-card'
      )
      .forEach((item) => item.classList.remove('is-visible'));
  }

  private normalizeImageUrl(url: string | null | undefined): string {
    if (!url) return this.defaultImage;

    const value = String(url).trim();

    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }

    if (value.startsWith('/uploads/')) {
      return `http://localhost:3000${value}`;
    }

    if (value.startsWith('uploads/')) {
      return `http://localhost:3000/${value}`;
    }

    if (value.startsWith('/assets/')) {
      return value;
    }

    if (value.startsWith('assets/')) {
      return value;
    }

    if (value.startsWith('/')) {
      return `http://localhost:3000${value}`;
    }

    return `assets/images/products/${value}`;
  }
}
