import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ChangeDetectorRef,
  Inject,
  PLATFORM_ID,
  HostListener
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink, NavigationStart } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

import { CollectionService, Collection } from '../../services/collection.service';
import { CartService } from '../../services/cart.service';
import { BlogService, Blog } from '../../services/blog.service';
import { CustomerService } from '../../services/customer.service';

import {
  CategoryProductService,
  CategoryProduct
} from '../../services/category-product.service';

interface HomeProduct {
  id: string;
  name: string;
  price: string;
  oldPrice?: string;
  image: string;
  link: string;
  priceValue: number;
  originalPriceValue: number;
  salePriceValue: number | null;
  discountPercent: number | null;
  style: string;
  occasion: string;
  maxQuantity?: number;
}

interface HomeBlog {
  id: string;
  title: string;
  image: string;
  date: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './homepage.html',
  styleUrl: './homepage.css'
})
export class Homepage implements OnInit, AfterViewInit, OnDestroy {
  private readonly guestCartStorageKey = 'tiemHoaYenCart';
  private readonly checkoutItemsStorageKey = 'tiemHoaYenCheckoutItems';

  collections: Collection[] = [];

  newCollectionId = 'BST003';

  newCollection: HomeProduct[] = [];
  saleProducts: HomeProduct[] = [];

  allNewCollection: HomeProduct[] = [];
  allSaleProducts: HomeProduct[] = [];

  private newCollectionIndex = 0;
  private saleProductIndex = 0;

  private newCollectionTimer: ReturnType<typeof setInterval> | null = null;
  private saleProductTimer: ReturnType<typeof setInterval> | null = null;

  newCollectionChanging = false;
  saleProductsChanging = false;

  private groupSize = 5;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private routerEventsSub: Subscription | null = null;

  private readonly slideDelay = 14000;
  private readonly fadeDuration = 750;

  private newCollectionFadeTimer: ReturnType<typeof setTimeout> | null = null;
  private saleProductFadeTimer: ReturnType<typeof setTimeout> | null = null;

  bestSellerProducts: HomeProduct[] = [];
  allBestSellerProducts: HomeProduct[] = [];

  bestSellerProductsChanging = false;

  private bestSellerProductIndex = 0;
  private bestSellerProductTimer: ReturnType<typeof setInterval> | null = null;
  private bestSellerProductFadeTimer: ReturnType<typeof setTimeout> | null = null;

  wishlistIds = new Set<string>();

  customerReviews = [
    {
      image: 'assets/images/homepage-fb1.png',
      content: 'Đánh giá sản phẩm của khách hàng',
    },
    {
      image: 'assets/images/homepage-fb2.png',
      content: 'Đánh giá sản phẩm của khách hàng',
    },
    {
      image: 'assets/images/homepage-fb3.png',
      content: 'Đánh giá sản phẩm của khách hàng',
    }
  ];
  private customerReviewIndex = 0;
  private customerReviewTimer: ReturnType<typeof setInterval> | null = null;
  private customerReviewPaused = false;

  get visibleCustomerReviews() {
    const visibleCount = isPlatformBrowser(this.platformId) && window.innerWidth <= 640 ? 1 : 2;
    return Array.from({ length: Math.min(visibleCount, this.customerReviews.length) }, (_, offset) =>
      this.customerReviews[(this.customerReviewIndex + offset) % this.customerReviews.length]
    );
  }

  blogs: HomeBlog[] = [];
  loadingBlogs = false;

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    private collectionService: CollectionService,
    private categoryProductService: CategoryProductService,
    private cartService: CartService,
    private customerService: CustomerService,
    private blogService: BlogService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.groupSize = this.computeGroupSize();

    this.routerEventsSub = this.router.events
      .pipe(filter((routerEvent) => routerEvent instanceof NavigationStart))
      .subscribe(() => {
        this.scrollToTop();
      });

    this.loadCollections();
    this.loadNewCollectionProducts(this.newCollectionId);
    this.loadSaleProducts();
    this.loadBestSellerProducts();
    this.loadLatestBlogs();
    this.loadCustomerWishlist();
    this.startCustomerReviewAutoSlide();
  }

  previousCustomerReviews(): void {
    this.customerReviewIndex = (this.customerReviewIndex - 1 + this.customerReviews.length) % this.customerReviews.length;
    this.restartCustomerReviewAutoSlide();
  }

  nextCustomerReviews(manual = true): void {
    this.customerReviewIndex = (this.customerReviewIndex + 1) % this.customerReviews.length;
    if (manual) {
      this.restartCustomerReviewAutoSlide();
    }
  }

  pauseCustomerReviewSlider(): void {
    this.customerReviewPaused = true;
  }

  resumeCustomerReviewSlider(): void {
    this.customerReviewPaused = false;
  }

  private startCustomerReviewAutoSlide(): void {
    if (!isPlatformBrowser(this.platformId) || this.customerReviewTimer || this.customerReviews.length < 2) {
      return;
    }

    this.customerReviewTimer = setInterval(() => {
      if (!this.customerReviewPaused && document.visibilityState === 'visible') {
        this.nextCustomerReviews(false);
        this.cdr.detectChanges();
      }
    }, 5000);
  }

  private restartCustomerReviewAutoSlide(): void {
    if (this.customerReviewTimer) {
      clearInterval(this.customerReviewTimer);
      this.customerReviewTimer = null;
    }
    this.startCustomerReviewAutoSlide();
  }

  private computeGroupSize(): number {
    if (!isPlatformBrowser(this.platformId)) {
      return 5;
    }

    const width = window.innerWidth;

    if (width <= 640) {
      return 4; 
    }

    if (width <= 1024) {
      return 6; 
    }

    return 5; 
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }

    this.resizeTimer = setTimeout(() => {
      const newGroupSize = this.computeGroupSize();

      if (newGroupSize === this.groupSize) {
        return;
      }

      this.groupSize = newGroupSize;

      this.startNewCollectionAutoSlide();
      this.startSaleProductAutoSlide();
      this.startBestSellerProductAutoSlide();
    }, 200);
  }

  ngAfterViewInit(): void {

    document.querySelectorAll('video').forEach(video => {
      const forceMute = () => {
        video.muted = true;
        video.defaultMuted = true;
        video.volume = 0;
        video.setAttribute('muted', '');
      };

      forceMute();

      video.addEventListener('volumechange', forceMute);
      video.addEventListener('loadedmetadata', forceMute);
      video.addEventListener('play', forceMute);
      video.addEventListener('playing', forceMute);

      video.play().catch(() => {
        forceMute();
        video.play().catch(() => {});
      });
    });

    const reveals = document.querySelectorAll('.reveal');

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('active');
          }
        });
      },
      {
        threshold: 0.15
      }
    );

    reveals.forEach(item => {
      observer.observe(item);
    });
  }


  ngOnDestroy(): void {
    if (this.customerReviewTimer) {
      clearInterval(this.customerReviewTimer);
    }
    if (this.newCollectionTimer) {
      clearInterval(this.newCollectionTimer);
    }

    if (this.saleProductTimer) {
      clearInterval(this.saleProductTimer);
    }

    if (this.newCollectionFadeTimer) {
      clearTimeout(this.newCollectionFadeTimer);
    }

    if (this.saleProductFadeTimer) {
      clearTimeout(this.saleProductFadeTimer);
    }
    if (this.bestSellerProductTimer) {
      clearInterval(this.bestSellerProductTimer);
    }

    if (this.bestSellerProductFadeTimer) {
      clearTimeout(this.bestSellerProductFadeTimer);
    }

    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }

    if (this.routerEventsSub) {
      this.routerEventsSub.unsubscribe();
    }
  }

  private loadLatestBlogs(): void {
    this.loadingBlogs = true;

    this.blogService.getAll().subscribe({
      next: (data: Blog[]) => {
        const posts = Array.isArray(data) ? [...data] : [];

        this.blogs = posts
          .sort((a, b) => {
            const dateA = new Date(a.NGAY_DANG || 0).getTime();
            const dateB = new Date(b.NGAY_DANG || 0).getTime();

            return dateB - dateA;
          })
          .slice(0, 4)
          .map((item) => ({
            id: String(item.BAI_VIET_ID || ''),
            title: String(item.TIEU_DE || 'Bài viết Tiệm Hoa Yên'),
            image: this.normalizeBlogImageUrl(item.ANH_BIA),
            date: this.formatBlogDate(item.NGAY_DANG),
          }))
          .filter((item) => !!item.id);

        this.loadingBlogs = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi load 3 bài viết mới nhất:', err);
        this.blogs = [];
        this.loadingBlogs = false;
        this.cdr.detectChanges();
      }
    });
  }

  private loadCollections(): void {
    this.collectionService.getAll().subscribe({
      next: (data) => {
        this.collections = data;
      },
      error: (err) => {
        console.error('Lỗi load collections:', err);
        this.collections = [];
      }
    });
  }

  private loadNewCollectionProducts(collectionId: string): void {
    this.categoryProductService.getProductsByCollection(collectionId).subscribe({
      next: (res) => {
        const products = Array.isArray(res.products) ? res.products : [];

        this.allNewCollection = products.map((item) =>
          this.mapProductToHomeProduct(item)
        );

        this.startNewCollectionAutoSlide();

        console.log('Tất cả sản phẩm bộ sưu tập mới:', this.allNewCollection);
      },
      error: (err) => {
        console.error('Lỗi load sản phẩm bộ sưu tập mới:', err);
        this.allNewCollection = [];
        this.newCollection = [];
        this.cdr.detectChanges();
      }
    });
  }

  private loadSaleProducts(): void {
    this.categoryProductService.getSaleProducts().subscribe({
      next: (res) => {
        const products = Array.isArray(res.products) ? res.products : [];

        this.allSaleProducts = products.map((item) =>
          this.mapProductToHomeProduct(item)
        );

        console.log('Tổng sản phẩm giảm giá:', this.allSaleProducts.length);

        this.startSaleProductAutoSlide();

        console.log('Tất cả sản phẩm giảm giá:', this.allSaleProducts);
      },
      error: (err) => {
        console.error('Lỗi load sản phẩm giảm giá:', err);
        this.allSaleProducts = [];
        this.saleProducts = [];
        this.cdr.detectChanges();
      }
    });
  }

  private loadBestSellerProducts(): void {
  this.categoryProductService.getBestSellerProducts().subscribe({
    next: (res) => {
      const products = Array.isArray(res.products) ? res.products : [];

      this.allBestSellerProducts = products.map((item) =>
        this.mapProductToHomeProduct(item)
      );

      console.log('Tổng sản phẩm bán chạy:', this.allBestSellerProducts.length);

      this.startBestSellerProductAutoSlide();
    },
    error: (err) => {
      console.error('Lỗi load sản phẩm bán chạy:', err);

      this.allBestSellerProducts = [];
      this.bestSellerProducts = [];
      this.bestSellerProductsChanging = false;

      this.cdr.detectChanges();
    }
  });
}

private startBestSellerProductAutoSlide(): void {
  if (this.bestSellerProductTimer) {
    clearInterval(this.bestSellerProductTimer);
  }

  if (this.bestSellerProductFadeTimer) {
    clearTimeout(this.bestSellerProductFadeTimer);
  }

  this.bestSellerProductIndex = 0;
  this.bestSellerProductsChanging = false;

  this.bestSellerProducts = this.getGroupProductsLoop(
    this.allBestSellerProducts,
    this.bestSellerProductIndex
  );

  this.cdr.detectChanges();

  if (this.allBestSellerProducts.length <= this.groupSize) {
    return;
  }

  this.bestSellerProductTimer = setInterval(() => {
    this.rotateBestSellerProducts();
  }, this.slideDelay);
}

  private rotateBestSellerProducts(): void {
    if (this.allBestSellerProducts.length <= this.groupSize) {
      return;
    }

    this.bestSellerProductsChanging = true;
    this.cdr.detectChanges();

    if (this.bestSellerProductFadeTimer) {
      clearTimeout(this.bestSellerProductFadeTimer);
    }

    this.bestSellerProductFadeTimer = setTimeout(() => {
      this.bestSellerProductIndex =
        (this.bestSellerProductIndex + this.groupSize) % this.allBestSellerProducts.length;

      this.bestSellerProducts = this.getGroupProductsLoop(
        this.allBestSellerProducts,
        this.bestSellerProductIndex
      );

      this.bestSellerProductsChanging = false;
      this.cdr.detectChanges();
    }, this.fadeDuration);
  }

  private startNewCollectionAutoSlide(): void {
    if (this.newCollectionTimer) {
      clearInterval(this.newCollectionTimer);
    }

    this.newCollectionIndex = 0;
    this.newCollection = this.getGroupProductsLoop(
      this.allNewCollection,
      this.newCollectionIndex
    );
    this.newCollectionChanging = false;
    this.cdr.detectChanges();

    if (this.allNewCollection.length <= this.groupSize) {
      return;
    }

    this.newCollectionTimer = setInterval(() => {
      this.rotateNewCollectionProducts();
    }, this.slideDelay);
  }

  private startSaleProductAutoSlide(): void {
    if (this.saleProductTimer) {
      clearInterval(this.saleProductTimer);
    }

    this.saleProductIndex = 0;
    this.saleProducts = this.getGroupProductsLoop(
      this.allSaleProducts,
      this.saleProductIndex
    );
    this.saleProductsChanging = false;
    this.cdr.detectChanges();

    if (this.allSaleProducts.length <= this.groupSize) {
      return;
    }

    this.saleProductTimer = setInterval(() => {
      this.rotateSaleProducts();
    }, this.slideDelay);
  }

  private rotateNewCollectionProducts(): void {
    if (this.allNewCollection.length <= this.groupSize) return;

    this.newCollectionChanging = true;
    this.cdr.detectChanges();

    if (this.newCollectionFadeTimer) {
      clearTimeout(this.newCollectionFadeTimer);
    }

    this.newCollectionFadeTimer = setTimeout(() => {
      this.newCollectionIndex =
        (this.newCollectionIndex + this.groupSize) % this.allNewCollection.length;

      this.newCollection = this.getGroupProductsLoop(
        this.allNewCollection,
        this.newCollectionIndex
      );

      this.newCollectionChanging = false;
      this.cdr.detectChanges();
    }, this.fadeDuration);
  }

  private rotateSaleProducts(): void {
    if (this.allSaleProducts.length <= this.groupSize) return;

    this.saleProductsChanging = true;
    this.cdr.detectChanges();

    if (this.saleProductFadeTimer) {
      clearTimeout(this.saleProductFadeTimer);
    }

    this.saleProductFadeTimer = setTimeout(() => {
      this.saleProductIndex =
        (this.saleProductIndex + this.groupSize) % this.allSaleProducts.length;

      this.saleProducts = this.getGroupProductsLoop(
        this.allSaleProducts,
        this.saleProductIndex
      );

      this.saleProductsChanging = false;
      this.cdr.detectChanges();
    }, this.fadeDuration);
  }
  get saleProductTotalPages(): number {
    return Math.ceil(this.allSaleProducts.length / this.groupSize);
  }

  get saleProductCurrentPage(): number {
    return Math.floor(this.saleProductIndex / this.groupSize);
  }

  get saleProductDots(): number[] {
    return Array.from(
      { length: this.saleProductTotalPages },
      (_, index) => index
    );
  }

  get bestSellerProductTotalPages(): number {
    return Math.ceil(this.allBestSellerProducts.length / this.groupSize);
  }

  get bestSellerProductCurrentPage(): number {
    return Math.floor(this.bestSellerProductIndex / this.groupSize);
  }

  get bestSellerProductDots(): number[] {
    return Array.from(
      { length: this.bestSellerProductTotalPages },
      (_, index) => index
    );
  }

  prevSaleProducts(event?: Event): void {
    event?.stopPropagation();
    this.goToSaleProductPage(this.saleProductCurrentPage - 1);
    this.restartSaleProductTimer();
  }

  nextSaleProducts(event?: Event): void {
    event?.stopPropagation();
    this.goToSaleProductPage(this.saleProductCurrentPage + 1);
    this.restartSaleProductTimer();
  }

  goToSaleProductPage(pageIndex: number, event?: Event): void {
    event?.stopPropagation();

    if (this.allSaleProducts.length <= this.groupSize || this.saleProductsChanging) {
      return;
    }

    const totalPages = this.saleProductTotalPages;
    const safePageIndex = (pageIndex + totalPages) % totalPages;

    this.saleProductsChanging = true;
    this.cdr.detectChanges();

    if (this.saleProductFadeTimer) {
      clearTimeout(this.saleProductFadeTimer);
    }

    this.saleProductFadeTimer = setTimeout(() => {
      this.saleProductIndex = safePageIndex * this.groupSize;

      this.saleProducts = this.getGroupProductsLoop(
        this.allSaleProducts,
        this.saleProductIndex
      );

      this.saleProductsChanging = false;
      this.cdr.detectChanges();
    }, this.fadeDuration);
  }

  prevBestSellerProducts(event?: Event): void {
    event?.stopPropagation();
    this.goToBestSellerProductPage(this.bestSellerProductCurrentPage - 1);
    this.restartBestSellerProductTimer();
  }

  nextBestSellerProducts(event?: Event): void {
    event?.stopPropagation();
    this.goToBestSellerProductPage(this.bestSellerProductCurrentPage + 1);
    this.restartBestSellerProductTimer();
  }

  goToBestSellerProductPage(pageIndex: number, event?: Event): void {
    event?.stopPropagation();

    if (
      this.allBestSellerProducts.length <= this.groupSize ||
      this.bestSellerProductsChanging
    ) {
      return;
    }

    const totalPages = this.bestSellerProductTotalPages;
    const safePageIndex = (pageIndex + totalPages) % totalPages;

    this.bestSellerProductsChanging = true;
    this.cdr.detectChanges();

    if (this.bestSellerProductFadeTimer) {
      clearTimeout(this.bestSellerProductFadeTimer);
    }

    this.bestSellerProductFadeTimer = setTimeout(() => {
      this.bestSellerProductIndex = safePageIndex * this.groupSize;

      this.bestSellerProducts = this.getGroupProductsLoop(
        this.allBestSellerProducts,
        this.bestSellerProductIndex
      );

      this.bestSellerProductsChanging = false;
      this.cdr.detectChanges();
    }, this.fadeDuration);
  }

  private restartSaleProductTimer(): void {
    if (this.saleProductTimer) {
      clearInterval(this.saleProductTimer);
    }

    if (this.allSaleProducts.length <= this.groupSize) {
      return;
    }

    this.saleProductTimer = setInterval(() => {
      this.rotateSaleProducts();
    }, this.slideDelay);
  }

  private restartBestSellerProductTimer(): void {
    if (this.bestSellerProductTimer) {
      clearInterval(this.bestSellerProductTimer);
    }

    if (this.allBestSellerProducts.length <= this.groupSize) {
      return;
    }

    this.bestSellerProductTimer = setInterval(() => {
      this.rotateBestSellerProducts();
    }, this.slideDelay);
  }

  private getGroupProductsLoop(products: HomeProduct[], startIndex: number): HomeProduct[] {
    if (products.length <= this.groupSize) {
      return products;
    }

    const result: HomeProduct[] = [];

    for (let i = 0; i < this.groupSize; i++) {
      const index = (startIndex + i) % products.length;
      result.push(products[index]);
    }

    return result;
  }

  private mapProductToHomeProduct(item: CategoryProduct): HomeProduct {
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

    const finalPrice = hasSalePrice && salePrice !== null ? salePrice : originalPrice;

    const discountPercent =
      hasSalePrice && salePrice !== null && originalPrice > 0
        ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
        : null;

    return {
      id: item.SAN_PHAM_ID,
      name: item.TEN_SAN_PHAM,
      oldPrice: hasSalePrice ? this.formatPrice(originalPrice) : undefined,
      price: this.formatPrice(finalPrice),
      image: this.normalizeImageUrl(item.HINH_ANH),
      link: `/product-detail/${item.SAN_PHAM_ID}`,
      priceValue: finalPrice,
      originalPriceValue: originalPrice,
      salePriceValue: hasSalePrice && salePrice !== null ? salePrice : null,
      discountPercent,
      style: item.KIEU_DANG || 'Sản phẩm',
      occasion: item.TEN_CHU_DE || 'Đang bán',
      maxQuantity: Number(item.SO_LUONG || 0) > 0 ? Number(item.SO_LUONG) : undefined
    };
  }

  goToProductDetail(product: HomeProduct, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.router.navigate(['/product-detail', product.id], {
      state: {
        productPreview: {
          id: product.id,
          name: product.name,
          price: product.priceValue,
          originalPrice: product.originalPriceValue,
          salePrice: product.salePriceValue,
          image: product.image,
          maxQuantity: product.maxQuantity,
          breadcrumbGroup: product.occasion || 'Chá»§ Ä‘á»',
          breadcrumbReturnUrl: '/',
          filters: {
            chuDe: product.occasion ? [product.occasion] : []
          }
        }
      }
    }).then(() => this.scrollToTop());
  }

  buyNow(product: HomeProduct, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();

    if (!this.isBrowser) {
      return;
    }

    const checkoutItem = this.createCartItem(product);
    localStorage.setItem(this.checkoutItemsStorageKey, JSON.stringify([checkoutItem]));
    this.dispatchCartChanged();
    this.router.navigate([this.getOrderRoute()]).then(() => this.scrollToTop());
  }

  addProductToCart(product: HomeProduct, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();

    if (!this.isBrowser) {
      return;
    }

    this.playFlyToCartEffect(event);

    const customerId = this.getCustomerId();

    if (customerId && String(product.id).startsWith('SP')) {
      this.cartService.addItem(customerId, product.id, 1).subscribe({
        next: () => {
          this.dispatchCartChanged();
        },
        error: (err) => {
          console.error('Lỗi thêm sản phẩm vào giỏ hàng database:', err);
        }
      });

      return;
    }

    this.saveProductToGuestCart(product);
  }

  private playFlyToCartEffect(event?: Event): void {
    if (!this.isBrowser || !event) {
      return;
    }

    const targetEl = event.target as HTMLElement | null;
    const card = targetEl?.closest('.product-card');
    const sourceImg = card?.querySelector('.product-card-media img') as HTMLImageElement | null;

    if (!sourceImg) {
      return;
    }

    const cartIcon = document.querySelector<HTMLElement>(
      '.navbar-cart-icon, #navbar-cart-icon, .cart-icon, [data-cart-icon], a[routerLink*="cart"] i, a[routerLink*="gio-hang"] i'
    );

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
    flyer.style.zIndex = '9999';
    flyer.style.pointerEvents = 'none';
    flyer.style.boxShadow = '0 10px 24px rgba(115, 25, 25, .35)';
    flyer.style.willChange = 'transform, opacity';

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


  isInWishlist(productId: string): boolean {
    return this.wishlistIds.has(productId);
  }

  private loadCustomerWishlist(): void {
    if (!this.isBrowser) {
      return;
    }

    const customerId = this.getCustomerId();
    this.wishlistIds.clear();

    if (!customerId) {
      this.cdr.detectChanges();
      return;
    }

    this.customerService.getWishlist(customerId).subscribe({
      next: (items) => {
        this.wishlistIds = new Set(
          (Array.isArray(items) ? items : [])
            .map((item: any) => String(item?.SAN_PHAM_ID || item?.sanPhamId || item?.id || '').trim())
            .filter((id: string) => !!id)
        );

        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi load danh sách yêu thích:', err);
        this.wishlistIds.clear();
        this.cdr.detectChanges();
      }
    });
  }

  toggleWishlist(product: HomeProduct, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();

    if (!this.isBrowser) {
      return;
    }

    const customerId = this.getCustomerId();

    if (!customerId) {
      alert('Vui lòng đăng nhập để sử dụng danh sách yêu thích.');
      this.router.navigate(['/login']);
      return;
    }

    if (!String(product.id).startsWith('SP')) {
      alert('Sản phẩm này chưa đồng bộ với database nên chưa thể thêm vào yêu thích.');
      return;
    }

    const isFavorite = this.wishlistIds.has(product.id);

    if (isFavorite) {
      this.customerService.removeWishlistItem(customerId, product.id).subscribe({
        next: () => {
          this.wishlistIds.delete(product.id);
          this.dispatchWishlistChanged();
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error('Lỗi xóa sản phẩm yêu thích:', err);
          alert('Chưa xóa được sản phẩm khỏi danh sách yêu thích. Vui lòng thử lại.');
        }
      });

      return;
    }

    this.customerService.addWishlistItem(customerId, product.id).subscribe({
      next: () => {
        this.wishlistIds.add(product.id);
        this.dispatchWishlistChanged();
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Lỗi thêm sản phẩm yêu thích:', err);
        alert('Chưa thêm được sản phẩm vào danh sách yêu thích. Vui lòng thử lại.');
      }
    });
  }

  private dispatchWishlistChanged(): void {
    if (!this.isBrowser) {
      return;
    }

    window.dispatchEvent(new Event('wishlist-changed'));
  }

  private get isBrowser(): boolean {
    return isPlatformBrowser(this.platformId) && typeof window !== 'undefined';
  }

  scrollToTop(): void {
    if (!this.isBrowser) {
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }

  private getLoggedInCustomer(): any | null {
    if (!this.isBrowser) {
      return null;
    }

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

  private getOrderRoute(): string {
    return this.getCustomerId() ? '/order-registrant' : '/order-haunt';
  }

  private createCartItem(product: HomeProduct) {
    return {
      id: product.id,
      name: product.name,
      style: product.style || 'Sản phẩm',
      occasion: product.occasion || 'Đang bán',
      price: product.priceValue,
      originalPrice: product.salePriceValue !== null ? product.originalPriceValue : null,
      quantity: 1,
      image: product.image,
      selected: true,
      maxQuantity: product.maxQuantity
    };
  }

  private getCartFromStorage(): any[] {
    const rawCart = localStorage.getItem(this.guestCartStorageKey);

    if (!rawCart) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawCart);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveProductToGuestCart(product: HomeProduct): void {
    const cart = this.getCartFromStorage();
    const cartItem = this.createCartItem(product);
    const existingItem = cart.find((item: any) => String(item?.id || '') === product.id);

    if (existingItem) {
      const currentQuantity = Number(existingItem.quantity || 1);
      const nextQuantity = currentQuantity + 1;
      const maxQuantity = product.maxQuantity || Number.MAX_SAFE_INTEGER;

      existingItem.quantity = Math.min(nextQuantity, maxQuantity);
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

    localStorage.setItem(this.guestCartStorageKey, JSON.stringify(cart));
    this.dispatchCartChanged();
  }

  private dispatchCartChanged(): void {
    if (!this.isBrowser) {
      return;
    }

    window.dispatchEvent(new Event('cart-changed'));
  }

  private formatPrice(price: number | string | null | undefined): string {
    const value = Number(price);

    if (Number.isNaN(value)) {
      return '0đ';
    }

    return value.toLocaleString('vi-VN') + 'đ';
  }

  private formatBlogDate(date: string | null | undefined): string {
    if (!date) {
      return '';
    }

    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
      return '';
    }

    return parsedDate.toLocaleDateString('vi-VN');
  }

  private normalizeBlogImageUrl(url: string | null | undefined): string {
    if (!url) {
      return 'assets/images/blog.png';
    }

    const value = String(url).trim();

    if (
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('assets/') ||
      value.startsWith('/')
    ) {
      return value;
    }

    return `assets/images/${value}`;
  }

  private normalizeImageUrl(url: string | null | undefined): string {
    if (!url) return '';

    const value = String(url).trim();

    if (
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('assets/') ||
      value.startsWith('/')
    ) {
      return value;
    }

    return `assets/images/products/${value}`;
  }

  
}
