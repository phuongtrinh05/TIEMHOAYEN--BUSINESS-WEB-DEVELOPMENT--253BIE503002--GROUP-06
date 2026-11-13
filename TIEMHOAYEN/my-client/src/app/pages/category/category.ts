import {
  AfterViewInit,
  Component,
  Inject,
  OnDestroy,
  PLATFORM_ID,
  ViewEncapsulation
} from '@angular/core';

import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest, Subscription } from 'rxjs';

import {
  CategoryProductService,
  CategoryProduct,
  ProductSearchQuery
} from '../../services/category-product.service';
import { CartService } from '../../services/cart.service';
import { CustomerService } from '../../services/customer.service';

type FilterGroup = 'chuDe' | 'kieuDang' | 'hoaTuoi' | 'doiTuong' | 'mauSac';
type SortValue = 'newest' | 'oldest' | 'bestSeller' | 'priceAsc' | 'priceDesc' | 'nameAsc' | 'nameDesc';

interface Product {
  id: string;
  name: string;
  price: number; // giá dùng để sắp xếp
  originalPrice: number;
  salePrice: number | null;
  image: string;
  icon: string;
  filters: Record<FilterGroup, string[]>;
  maxQuantity?: number;
  breadcrumbGroup?: string;
  badges?: { new: boolean; discount: boolean; sold: number | null; fastDelivery: boolean };
}

@Component({
  selector: 'app-category',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './category.html',
  styleUrl: './category.css',
  encapsulation: ViewEncapsulation.None,
})
export class CategoryComponent implements AfterViewInit, OnDestroy {
  private readonly guestCartStorageKey = 'tiemHoaYenCart';
  private readonly checkoutItemsStorageKey = 'tiemHoaYenCheckoutItems';

  pageTitle = 'Sản phẩm';
  breadcrumbLabels: string[] = [];

  private readonly PAGE_SIZE = 20;
  private readonly PRODUCT_IMAGES = 'assets/images/category/';

  private currentPage = 1;
  private currentSort: SortValue = 'newest';
  private serverTotal = 0;
  private serverTotalPages = 1;
  private serverPaged = false;
  private requestVersion = 0;
  private currentCollectionId = '';
  private breadcrumbFallbackLabels: string[] = [];

  private categoryBreadcrumb!: HTMLElement;
  private productGrid!: HTMLDivElement;
  private selectedFilterRow!: HTMLElement;
  private selectedFilterList!: HTMLDivElement;
  private pagination!: HTMLDivElement;
  private resultCount!: HTMLParagraphElement;
  private emptyMessage!: HTMLParagraphElement;
  private sortSelect!: HTMLSelectElement;
  private sortDropdown!: HTMLDivElement;
  private sortDropdownToggle!: HTMLButtonElement;
  private sortDropdownLabel!: HTMLSpanElement;
  private sortDropdownMenu!: HTMLDivElement;
  private mobileFilterSelect!: HTMLSelectElement;
  private clearAllFiltersButton!: HTMLButtonElement;
  private filterSidebar!: HTMLElement;
  private filterDrawerOverlay!: HTMLElement;
  private openFilterDrawerButton!: HTMLButtonElement;
  private closeFilterDrawerButton!: HTMLButtonElement;
  private priceRangeOptions: HTMLInputElement[] = [];

  private routeSubscription?: Subscription;
  private productRequestSubscription?: Subscription;
  private lastProductRouteKey = '';
  private revealObserver?: IntersectionObserver;
  private readonly pendingWishlistProductIds = new Set<string>();
  private readonly priceMinLimit = 0;
  private readonly priceMaxLimit = 7000000;
  private selectedPriceMin = 0;
  private selectedPriceMax = 7000000;
  private readonly popStateHandler = () => this.restoreServerStateFromLocation();
  private readonly authChangedHandler = () => this.loadCustomerWishlist();
  private readonly wishlistChangedHandler = () => this.loadCustomerWishlist();

  private readonly selectedFilters: Record<FilterGroup, Set<string>> = {
    chuDe: new Set<string>(),
    kieuDang: new Set<string>(),
    hoaTuoi: new Set<string>(),
    doiTuong: new Set<string>(),
    mauSac: new Set<string>(),
  };

  private readonly baseProducts: Product[] = [
    this.createProduct(1, 'Serenity Rose', 699000, 'serenity-rose.jpg', '🌸', ['Hoa sinh nhật'], ['Bó hoa'], ['Hoa hồng'], ['Bạn gái', 'Người yêu'], ['Hồng']),
    this.createProduct(2, 'Pink Blossom', 799000, 'pink-blossom.jpg', '💐', ['Hoa sinh nhật'], ['Bó hoa'], ['Hoa hồng'], ['Bạn gái', 'Mẹ'], ['Hồng']),
    this.createProduct(3, 'Golden Sunshine', 899000, 'golden-sunshine.jpg', '🌻', ['Hoa sinh nhật', 'Hoa chúc mừng'], ['Bó hoa'], ['Hoa hướng dương'], ['Sếp'], ['Vàng']),
    this.createProduct(4, 'Crimson Love', 999000, 'crimson-love.jpg', '🌹', ['Hoa sinh nhật', 'Hoa tình yêu'], ['Bó hoa'], ['Hoa hồng'], ['Người yêu', 'Vợ'], ['Đỏ']),
    this.createProduct(5, 'White Elegance', 899000, 'white-elegance.jpg', '🤍', ['Hoa sinh nhật', 'Hoa cưới'], ['Bó hoa'], ['Hoa ly'], ['Mẹ', 'Vợ'], ['Trắng']),
    this.createProduct(6, 'Lavender Dream', 899000, 'lavender-dream.jpg', '💜', ['Hoa sinh nhật'], ['Bó hoa'], ['Hoa hồng'], ['Bạn gái'], ['Tím']),
    this.createProduct(7, 'Tulip Romance', 1099000, 'tulip-romance.jpg', '🌷', ['Hoa sinh nhật', 'Hoa tình yêu'], ['Bó hoa'], ['Hoa tulip'], ['Người yêu', 'Vợ'], ['Hồng']),
    this.createProduct(8, 'Sweet Garden', 999000, 'sweet-garden.jpg', '🌺', ['Hoa sinh nhật'], ['Giỏ hoa'], ['Hoa hồng', 'Hoa cúc'], ['Mẹ'], ['Hồng']),
    this.createProduct(9, 'Ocean Bloom', 1199000, 'ocean-bloom.jpg', '🩵', ['Hoa sinh nhật'], ['Bó hoa'], ['Hoa baby'], ['Bạn gái'], ['Xanh']),
    this.createProduct(10, 'Peach Melody', 799000, 'peach-melody.jpg', '🍑', ['Hoa sinh nhật'], ['Giỏ hoa'], ['Hoa hồng'], ['Mẹ'], ['Cam', 'Hồng']),
    this.createProduct(11, 'Royal Orchid', 1499000, 'royal-orchid.jpg', '💜', ['Hoa sinh nhật', 'Hoa khai trương'], ['Hộp hoa'], ['Hoa Lan'], ['Sếp'], ['Tím']),
    this.createProduct(12, 'Golden Wish', 899000, 'golden-wish.jpg', '🎁', ['Hoa sinh nhật', 'Hoa chúc mừng'], ['Hộp hoa'], ['Hoa hồng'], ['Sếp', 'Mẹ'], ['Xanh', 'Trắng']),
    this.createProduct(13, 'Baby Cloud', 599000, 'baby-cloud.jpg', '☁️', ['Hoa sinh nhật'], ['Giỏ hoa'], ['Hoa baby', 'Hoa hồng'], ['Bạn gái'], ['Hồng', 'Trắng']),
    this.createProduct(14, 'Dreamy Pink', 1099000, 'dreamy-pink.jpg', '🌸', ['Hoa sinh nhật', 'Hoa tình yêu'], ['Giỏ hoa'], ['Hoa hồng'], ['Người yêu', 'Vợ'], ['Hồng']),
    this.createProduct(15, 'Burgundy Luxury', 1299000, 'burgundy-luxury.jpg', '🍷', ['Hoa sinh nhật', 'Hoa tình yêu'], ['Hộp hoa'], ['Hoa hồng'], ['Người yêu'], ['Đỏ']),
    this.createProduct(16, 'Orchid Grace', 1599000, 'orchid-grace.jpg', '🌺', ['Hoa sinh nhật'], ['Hoa hộp Mica'], ['Hoa Lan'], ['Mẹ', 'Sếp'], ['Tím']),
    this.createProduct(17, 'Sunflower Joy', 649000, 'sunflower-joy.jpg', '🌻', ['Hoa sinh nhật'], ['Bó hoa'], ['Hoa hướng dương'], ['Bạn gái', 'Sếp'], ['Vàng']),
    this.createProduct(18, 'Cherry Delight', 749000, 'cherry-delight.jpg', '🌸', ['Hoa sinh nhật'], ['Bó hoa'], ['Hoa hồng', 'Hoa baby'], ['Bạn gái'], ['Hồng', 'Trắng']),
  ];

  private products: Product[] = [];
  private isLoadingProducts = false;
  private wishlistProductIds = new Set<string>();
  private readonly topicNameById: Record<string, string> = {
    CD001: 'Hoa tình yêu',
    CD002: 'Hoa sinh nhật',
    CD003: 'Hoa khai trương',
    CD004: 'Hoa chúc mừng',
    CD005: 'Hoa Tết',
    CD006: 'Hoa Chia Buồn',
    CD007: 'Hoa cưới',
    CD008: 'Hoa sự kiện',
    CD009: 'Hoa tốt nghiệp',
  };

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    private route: ActivatedRoute,
    private router: Router,
    private categoryProductService: CategoryProductService,
    private cartService: CartService,
    private customerService: CustomerService
  ) {}

  ngAfterViewInit(): void {
    if (
      !isPlatformBrowser(this.platformId) ||
      typeof window === 'undefined' ||
      typeof document === 'undefined'
    ) {
      return;
    }

    setTimeout(() => {
      this.getElements();

      if (
        !this.categoryBreadcrumb ||
        !this.productGrid ||
        !this.selectedFilterRow ||
        !this.selectedFilterList ||
        !this.pagination ||
        !this.resultCount ||
        !this.emptyMessage ||
        !this.sortSelect ||
        this.priceRangeOptions.length === 0 ||
        !this.mobileFilterSelect
      ) {
        return;
      }

      this.initFilterInputs();
      this.initFilterCollapse();
      this.initSort();
      this.initPriceFilter();
      this.initMobileFilterControls();
      this.initClearAllFilters();
      this.initFilterDrawer();
      window.addEventListener('popstate', this.popStateHandler);
      window.addEventListener('auth-changed', this.authChangedHandler);
      window.addEventListener('wishlist-changed', this.wishlistChangedHandler);
      this.loadCustomerWishlist();
      this.loadDataFromRoute();
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.productRequestSubscription?.unsubscribe();
    this.revealObserver?.disconnect();
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('popstate', this.popStateHandler);
      window.removeEventListener('auth-changed', this.authChangedHandler);
      window.removeEventListener('wishlist-changed', this.wishlistChangedHandler);
    }
  }

  private loadCustomerWishlist(): void {
    if (!this.isBrowser()) {
      return;
    }

    const customerId = this.getCustomerId();

    this.wishlistProductIds.clear();

    if (!customerId) {
      if (this.productGrid && this.products.length > 0) this.syncWishlistButtons();
      return;
    }

    this.customerService.getWishlist(customerId).subscribe({
      next: (response) => {
        const items = response.items;
        this.wishlistProductIds = new Set(
          (Array.isArray(items) ? items : [])
            .map((item) => String(item.SAN_PHAM_ID || '').trim())
            .filter((id) => !!id)
        );

        if (this.productGrid && this.products.length > 0) {
          this.syncWishlistButtons();
        }
      },
      error: (err) => {
        console.error('Lỗi load danh sách yêu thích:', err);
        this.wishlistProductIds.clear();
      },
    });
  }

  private loadDataFromRoute(): void {
    this.routeSubscription = combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(([params, queryParams]) => {
      const id = params.get('id');
      const path = this.route.snapshot.routeConfig?.path || '';
      const routeKey = `${path}|${id || ''}|${queryParams.toString()}`;

      if (routeKey === this.lastProductRouteKey) {
        return;
      }

      this.lastProductRouteKey = routeKey;
      this.isLoadingProducts = true;
      if (this.emptyMessage) this.emptyMessage.hidden = true;

      this.clearSelectedFilters();
      this.uncheckAllCheckboxes();
      this.productRequestSubscription?.unsubscribe();
      this.currentPage = 1;
      this.serverPaged = false;
      this.currentCollectionId = path.startsWith('bo-suu-tap') ? String(id || '') : '';

      if (queryParams.get('view') === 'server') {
        (Object.keys(this.selectedFilters) as FilterGroup[]).forEach((group) => {
          String(queryParams.get(`f_${group}`) || '').split('|').map((value) => value.trim()).filter(Boolean)
            .forEach((value) => this.selectedFilters[group].add(value));
        });
        this.selectedPriceMin = Math.max(this.priceMinLimit, Number(queryParams.get('minPrice') || this.priceMinLimit));
        this.selectedPriceMax = Math.min(this.priceMaxLimit, Number(queryParams.get('maxPrice') || this.priceMaxLimit));
        this.currentSort = (queryParams.get('sort') as SortValue) || 'newest';
        this.currentPage = Math.max(1, Number(queryParams.get('page') || 1));
        this.currentCollectionId = path.startsWith('bo-suu-tap') ? String(id || '') : '';
        this.syncPriceFilterUi();
        this.requestServerProducts(false);
        return;
      }

      const selectedTopicIds = this.getTopicIdsFromQuery(queryParams.get('topics'));
      selectedTopicIds.forEach((topicId) => {
        const topicName = this.topicNameById[topicId];
        if (topicName) this.selectedFilters.chuDe.add(topicName);
      });

      if (id && path.startsWith('chu-de')) {
        const value = this.topicNameById[id];
        if (value) this.selectedFilters.chuDe.add(value);
        this.pageTitle = value || 'Chủ đề';
        this.setBreadcrumb('Chủ đề');
      } else if (id && path.startsWith('hoa-tuoi')) {
        const value = this.getFilterValueById('hoaTuoi', id);
        if (value) this.selectedFilters.hoaTuoi.add(value);
        this.pageTitle = value || 'Hoa tươi';
        this.setBreadcrumb('Hoa tươi');
      } else if (id && path.startsWith('kieu-dang')) {
        const value = decodeURIComponent(id);
        this.selectedFilters.kieuDang.add(value);
        this.pageTitle = value;
        this.setBreadcrumb('Kiểu dáng');
      } else if (id && path.startsWith('doi-tuong')) {
        const value = this.getFilterValueById('doiTuong', id);
        if (value) this.selectedFilters.doiTuong.add(value);
        this.pageTitle = value || 'Đối tượng';
        this.setBreadcrumb('Đối tượng');
      } else if (id && path.startsWith('mau-sac')) {
        const value = this.getFilterValueById('mauSac', id);
        if (value) this.selectedFilters.mauSac.add(value);
        this.pageTitle = value || 'Màu sắc';
        this.setBreadcrumb('Màu sắc');
      } else if (id && path.startsWith('bo-suu-tap')) {
        this.pageTitle = 'Bộ sưu tập';
        this.setBreadcrumb('Bộ sưu tập');
      } else {
        this.pageTitle = 'Sản phẩm';
        this.setBreadcrumb(selectedTopicIds.length ? 'Chủ đề' : '');
      }

      this.requestServerProducts(true);
    });
  }

  private getFilterValueById(group: FilterGroup, id: string): string {
    const checkbox = document.querySelector<HTMLInputElement>(`input[data-group="${group}"][data-id="${CSS.escape(id)}"]`);
    return checkbox ? this.getCheckboxValue(checkbox) : '';
  }

  private setBreadcrumb(mainLabel = ''): void {
    this.breadcrumbFallbackLabels = mainLabel ? [mainLabel] : [];
    this.updateBreadcrumbLabels();
  }

  private updateBreadcrumbLabels(): void {
    this.breadcrumbLabels = this.breadcrumbFallbackLabels;

    this.renderBreadcrumb();
  }

  private renderBreadcrumb(): void {
    if (!this.categoryBreadcrumb) {
      return;
    }

    const extraItems = this.breadcrumbLabels
      .map((label, index) => `
        ${index > 0 ? '<span class="breadcrumb-separator" aria-hidden="true">›</span>' : ''}
        <span class="breadcrumb-current">${this.escapeHtml(label)}</span>
      `)
      .join('');

    this.categoryBreadcrumb.innerHTML = extraItems || '<span class="breadcrumb-current">Sản phẩm</span>';
  }

  private loadAllProducts(selectedTopicIds: string[] = []): void {
    this.pageTitle = 'Sản phẩm';
    this.setBreadcrumb(selectedTopicIds.length > 0 ? 'Chủ đề' : '');
    this.products = [];

    this.productRequestSubscription = this.categoryProductService.getAllProducts().subscribe({
      next: (res) => {
        this.isLoadingProducts = false;
        this.products = res.products.map((item) => this.mapDbProductToProduct(item));

        selectedTopicIds.forEach((topicId) => {
          const topicName = this.topicNameById[topicId];

          if (topicName) {
            this.selectedFilters.chuDe.add(topicName);
          }
        });

        this.currentPage = 1;
        this.requestServerProducts();
      },
      error: (err) => {
        this.isLoadingProducts = false;
        console.error('Lỗi lấy tất cả sản phẩm:', err);

        this.pageTitle = 'Sản phẩm';
        this.setBreadcrumb(selectedTopicIds.length > 0 ? 'Chủ đề' : '');
        this.products = [];
        this.render();
      }
    });
  }

  private loadProductsByTopic(topicId: string): void {
    const topicNameFromId = this.topicNameById[topicId] || 'Chủ đề';

    this.clearSelectedFilters();
    this.uncheckAllCheckboxes();

    this.pageTitle = topicNameFromId;
    this.setBreadcrumb('Chủ đề');
    this.products = [];
    this.selectedFilters.chuDe.add(topicNameFromId);
    this.syncTopicCheckboxById(topicId, true);
    this.productRequestSubscription = this.categoryProductService.getProductsByTopic(topicId).subscribe({
      next: (res) => {
        this.isLoadingProducts = false;
        const topicName = res.topic?.TEN_CHU_DE || topicNameFromId;

        this.clearSelectedFilters();
        this.uncheckAllCheckboxes();

        this.pageTitle = topicName;
        this.setBreadcrumb('Chủ đề');

        this.products = res.products.map((item) =>
          this.mapDbProductToProduct({
            ...item,
            TEN_CHU_DE: topicName
          })
        );

        this.selectedFilters.chuDe.add(topicName);

        this.syncTopicCheckboxById(topicId, true);
        this.currentPage = 1;
        this.requestServerProducts();
      },
      error: (err) => {
        this.isLoadingProducts = false;
        console.error('Lỗi lấy sản phẩm theo chủ đề:', err);

        this.pageTitle = 'Không tìm thấy chủ đề';
        this.setBreadcrumb('Chủ đề');
        this.products = [];
        this.clearSelectedFilters();
        this.uncheckAllCheckboxes();
        this.render();
      }
    });
  }
  private loadProductsByFlower(flowerId: string): void {
    this.clearSelectedFilters();
    this.uncheckAllCheckboxes();
    this.currentPage = 1;
    this.products = [];
    this.pageTitle = 'Sản phẩm hoa tươi';
    this.setBreadcrumb('Hoa tươi');
    this.productRequestSubscription = this.categoryProductService.getProductsByFlower(flowerId).subscribe({
      next: (res) => {
        this.isLoadingProducts = false;
        const flowerName = res.flower?.TEN_HOA_TUOI || 'Hoa tươi';

        this.clearSelectedFilters();
        this.uncheckAllCheckboxes();

        this.pageTitle = 'Sản phẩm';
        this.setBreadcrumb('Hoa tươi');

        this.products = res.products.map((item) =>
          this.mapDbProductToProduct({
            ...item,
            TEN_HOA_TUOI: flowerName
          })
        );

        this.selectedFilters.hoaTuoi.add(flowerName);

        this.syncCheckbox('hoaTuoi', flowerName, true);
        this.currentPage = 1;
        this.requestServerProducts();
      },
      error: (err) => {
        this.isLoadingProducts = false;
        console.error('Lỗi lấy sản phẩm theo hoa tươi:', err);

        this.pageTitle = 'Không tìm thấy hoa tươi';
        this.setBreadcrumb('Hoa tươi');
        this.products = [];
        this.clearSelectedFilters();
        this.uncheckAllCheckboxes();
        this.render();
      }
    });
  }
  private loadProductsByStyle(style: string): void {
    const decodedStyle = decodeURIComponent(style);

    this.clearSelectedFilters();
    this.uncheckAllCheckboxes();
    this.currentPage = 1;
    this.products = [];
    this.pageTitle = decodedStyle;
    this.setBreadcrumb('Kiểu dáng');
    this.selectedFilters.kieuDang.add(decodedStyle);
    this.syncCheckbox('kieuDang', decodedStyle, true);
    this.productRequestSubscription = this.categoryProductService.getProductsByStyle(decodedStyle).subscribe({
      next: (res) => {
        this.isLoadingProducts = false;
        const styleName = res.style?.KIEU_DANG || decodedStyle;

        this.clearSelectedFilters();
        this.uncheckAllCheckboxes();

        this.pageTitle = 'Sản phẩm';
        this.setBreadcrumb('Kiểu dáng');

        this.products = res.products.map((item) =>
          this.mapDbProductToProduct({
            ...item,
            KIEU_DANG: styleName
          })
        );

        this.selectedFilters.kieuDang.add(styleName);

        this.syncCheckbox('kieuDang', styleName, true);
        this.currentPage = 1;
        this.requestServerProducts();
      },
      error: (err) => {
        this.isLoadingProducts = false;
        console.error('Lỗi lấy sản phẩm theo kiểu dáng:', err);

        this.pageTitle = 'Không tìm thấy kiểu dáng';
        this.setBreadcrumb('Kiểu dáng');
        this.products = [];
        this.clearSelectedFilters();
        this.uncheckAllCheckboxes();
        this.render();
      }
    });
  }
  private loadProductsByTarget(targetId: string): void {
    this.clearSelectedFilters();
    this.uncheckAllCheckboxes();

    this.currentPage = 1;
    this.products = [];
    this.pageTitle = 'Đối tượng';
    this.setBreadcrumb('Đối tượng');
    this.productRequestSubscription = this.categoryProductService.getProductsByTarget(targetId).subscribe({
      next: (res) => {
        this.isLoadingProducts = false;
        const targetName = res.target?.TEN_DOI_TUONG || 'Đối tượng';

        this.clearSelectedFilters();
        this.uncheckAllCheckboxes();

        this.pageTitle = targetName;
        this.setBreadcrumb('Đối tượng');
        
        this.products = res.products.map((item) =>
          this.mapDbProductToProduct({
            ...item,
            TEN_DOI_TUONG: targetName
          })
        );

        this.selectedFilters.doiTuong.add(targetName);

        this.syncCheckbox('doiTuong', targetName, true);
        this.currentPage = 1;
        this.requestServerProducts();
      },
      error: (err) => {
        this.isLoadingProducts = false;
        console.error('Lỗi lấy sản phẩm theo đối tượng:', err);

        this.pageTitle = 'Không tìm thấy đối tượng';
        this.setBreadcrumb('Đối tượng');
        this.products = [];
        this.clearSelectedFilters();
        this.uncheckAllCheckboxes();
        this.render();
      }
    });
  }

  private loadProductsByColor(colorId: string): void {
    this.clearSelectedFilters();
    this.uncheckAllCheckboxes();

    this.currentPage = 1;
    this.products = [];
    this.pageTitle = 'Sản phẩm theo màu sắc';
    this.setBreadcrumb('Màu sắc');
    this.productRequestSubscription = this.categoryProductService.getProductsByColor(colorId).subscribe({
      next: (res) => {
        this.isLoadingProducts = false;
        const colorName = res.color?.TEN_MAU_SAC || 'Màu sắc';

        this.clearSelectedFilters();
        this.uncheckAllCheckboxes();

        this.pageTitle = 'Sản phẩm';
        this.setBreadcrumb('Màu sắc');

        this.products = res.products.map((item) =>
          this.mapDbProductToProduct({
            ...item,
            TEN_MAU_SAC: colorName
          })
        );

        this.selectedFilters.mauSac.add(colorName);

        this.syncCheckbox('mauSac', colorName, true);
        this.currentPage = 1;
        this.requestServerProducts();
      },
      error: (err) => {
        this.isLoadingProducts = false;
        console.error('Lỗi lấy sản phẩm theo màu sắc:', err);

        this.pageTitle = 'Không tìm thấy màu sắc';
        this.setBreadcrumb('Màu sắc');
        this.products = [];
        this.clearSelectedFilters();
        this.uncheckAllCheckboxes();
        this.render();
      }
    });
  }
  private loadProductsByCollection(collectionId: string): void {
    this.clearSelectedFilters();
    this.uncheckAllCheckboxes();

    this.currentPage = 1;
    this.products = [];
    this.pageTitle = 'Bộ sưu tập';
    this.setBreadcrumb('Bộ sưu tập');
    this.productRequestSubscription = this.categoryProductService.getProductsByCollection(collectionId).subscribe({
      next: (res) => {
        this.isLoadingProducts = false;
        const collectionName = res.collection?.TEN_BO_SUU_TAP || 'Bộ sưu tập';

        this.clearSelectedFilters();
        this.uncheckAllCheckboxes();

        // Chỉ Bộ sưu tập mới đổi title thành tên bộ sưu tập.
        this.pageTitle = collectionName;
        this.setBreadcrumb('Bộ sưu tập');

        this.products = res.products.map((item) =>
          this.mapDbProductToProduct({
            ...item,
            TEN_BO_SUU_TAP: collectionName
          })
        );

        this.currentPage = 1;
        this.requestServerProducts();
      },
      error: (err) => {
        this.isLoadingProducts = false;
        console.error('Lỗi lấy sản phẩm theo bộ sưu tập:', err);

        this.pageTitle = 'Không tìm thấy bộ sưu tập';
        this.setBreadcrumb('Bộ sưu tập');
        this.products = [];
        this.clearSelectedFilters();
        this.uncheckAllCheckboxes();
        this.render();
      }
    });
  }
  private mapDbProductToProduct(item: CategoryProduct): Product {
    const productId = String(item.SAN_PHAM_ID || '').trim();
    const originalPrice = Number(item.GIA ?? 0);
    const rawSalePrice = item.GIA_KHUYEN_MAI;

    const salePriceNumber =
      rawSalePrice === null || rawSalePrice === undefined
        ? null
        : Number(rawSalePrice);

    const hasSalePrice =
      salePriceNumber !== null &&
      !Number.isNaN(salePriceNumber) &&
      salePriceNumber > 0 &&
      salePriceNumber < originalPrice;

    const finalPrice = hasSalePrice && salePriceNumber !== null ? salePriceNumber : originalPrice;

    return {
      id: productId,
      name: item.TEN_SAN_PHAM,
      price: finalPrice,
      originalPrice: originalPrice,
      salePrice: hasSalePrice && salePriceNumber !== null ? salePriceNumber : null,
      image: this.getProductImage(item.TEN_SAN_PHAM, item.HINH_ANH),
      icon: '🌸',
      filters: {
        chuDe: item.TEN_CHU_DE ? [item.TEN_CHU_DE] : [],
        kieuDang: item.KIEU_DANG ? [item.KIEU_DANG] : [],
        hoaTuoi: this.parseFilterList(item.TEN_HOA_TUOI_LIST),
        doiTuong: this.parseFilterList(item.TEN_DOI_TUONG_LIST),
        mauSac: this.parseFilterList(item.TEN_MAU_SAC_LIST)
      },
      maxQuantity: Number(item.TON_KHA_DUNG ?? item.SO_LUONG ?? 0)
    };
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

  private getElements(): void {
    this.categoryBreadcrumb = document.querySelector<HTMLElement>('#categoryBreadcrumb')!;
    this.productGrid = document.querySelector<HTMLDivElement>('#productGrid')!;
    this.selectedFilterRow = document.querySelector<HTMLElement>('#selectedFilterRow')!;
    this.selectedFilterList = document.querySelector<HTMLDivElement>('#selectedFilterList')!;
    this.pagination = document.querySelector<HTMLDivElement>('#pagination')!;
    this.resultCount = document.querySelector<HTMLParagraphElement>('#resultCount')!;
    this.emptyMessage = document.querySelector<HTMLParagraphElement>('#emptyMessage')!;
    this.sortSelect = document.querySelector<HTMLSelectElement>('#sortSelect')!;
    this.sortDropdown = document.querySelector<HTMLDivElement>('#sortDropdown')!;
    this.sortDropdownToggle = document.querySelector<HTMLButtonElement>('#sortDropdownToggle')!;
    this.sortDropdownLabel = document.querySelector<HTMLSpanElement>('#sortDropdownLabel')!;
    this.sortDropdownMenu = document.querySelector<HTMLDivElement>('#sortDropdownMenu')!;
    this.mobileFilterSelect = document.querySelector<HTMLSelectElement>('#mobileFilterSelect')!;
    this.clearAllFiltersButton = document.querySelector<HTMLButtonElement>('#clearAllFilters')!;
    this.filterSidebar = document.querySelector<HTMLElement>('#filterSidebar')!;
    this.filterDrawerOverlay = document.querySelector<HTMLElement>('#filterDrawerOverlay')!;
    this.openFilterDrawerButton = document.querySelector<HTMLButtonElement>('#openFilterDrawer')!;
    this.closeFilterDrawerButton = document.querySelector<HTMLButtonElement>('#closeFilterDrawer')!;
    this.priceRangeOptions = Array.from(document.querySelectorAll<HTMLInputElement>('.price-range-option-input'));
  }

  private createProduct(
    id: number,
    name: string,
    price: number,
    fileName: string,
    icon: string,
    chuDe: string[],
    kieuDang: string[],
    hoaTuoi: string[],
    doiTuong: string[],
    mauSac: string[]
  ): Product {
    return {
      id: String(id),
      name,
      price,
      originalPrice: price,
      salePrice: null,
      image: this.PRODUCT_IMAGES + fileName,
      icon,
      filters: { chuDe, kieuDang, hoaTuoi, doiTuong, mauSac },
      maxQuantity: undefined,
    };
  }

  private createProductData(): Product[] {
    const result: Product[] = [...this.baseProducts];

    const extraNames = [
      'Morning Blush', 'Rosy Promise', 'Warm Memory', 'Pure Lily', 'Happy Daisy', 'Soft Velvet',
      'Sunny Basket', 'Love Whisper', 'Graceful Bloom', 'Gentle Tulip', 'Moonlight Rose', 'Amber Garden',
      'Spring Smile', 'Pearl Bouquet', 'Lovely Aura', 'Dream Basket', 'Blooming Day', 'Pink Aura',
    ];

    let id = result.length + 1;

    while (result.length < 72) {
      const seed = result[(id - 1) % this.baseProducts.length];
      const name = `${extraNames[(id - 19) % extraNames.length]} ${Math.ceil((id - 18) / extraNames.length)}`;

      const newPrice = seed.price + ((id % 5) * 50000);

      result.push({
        ...seed,
        id: String(id),
        name,
        price: newPrice,
        originalPrice: newPrice,
        salePrice: null,
      });

      id++;
    }

    return result;
  }

  private formatPrice(price: number | string | null | undefined): string {
    const value = Number(price);

    if (Number.isNaN(value)) {
      return '0đ';
    }

    return value.toLocaleString('vi-VN') + 'đ';
  }
  private getSelectedCount(): number {
    return Object.values(this.selectedFilters).reduce((total, group) => total + group.size, 0) +
      (this.isPriceFilterActive() ? 1 : 0);
  }

  private getFilteredProducts(): Product[] {
    return this.products.filter((item) => {
      if (item.price < this.selectedPriceMin || item.price > this.selectedPriceMax) {
        return false;
      }

      return (Object.keys(this.selectedFilters) as FilterGroup[]).every((group) => {
        const chosen = this.selectedFilters[group];

        if (chosen.size === 0) return true;

        return item.filters[group].some((value) => chosen.has(value));
      });
    });
  }

  private requestServerProducts(syncUrl = true): void {
    const version = ++this.requestVersion;
    this.productRequestSubscription?.unsubscribe();
    this.isLoadingProducts = true;
    this.emptyMessage.hidden = true;
    const query: ProductSearchQuery = {
      search: new URLSearchParams(window.location.search).get('q') || new URLSearchParams(window.location.search).get('search') || '',
      topics: [...this.selectedFilters.chuDe], styles: [...this.selectedFilters.kieuDang],
      flowers: [...this.selectedFilters.hoaTuoi], targets: [...this.selectedFilters.doiTuong], colors: [...this.selectedFilters.mauSac],
      collections: this.currentCollectionId ? [this.currentCollectionId] : [],
      minPrice: this.selectedPriceMin, maxPrice: this.selectedPriceMax,
      sort: this.currentSort, page: this.currentPage, pageSize: this.PAGE_SIZE
    };
    this.productRequestSubscription = this.categoryProductService.searchProducts(query).subscribe({
      next: (response) => {
        if (version !== this.requestVersion) return;
        this.products = (response.products || []).map((item) => this.mapDbProductToProduct(item));
        this.serverTotal = Number(response.total || 0);
        this.serverTotalPages = Number(response.totalPages || 1);
        this.currentPage = Number(response.page || this.currentPage);
        this.serverPaged = true;
        this.isLoadingProducts = false;
        this.render();
        if (syncUrl) this.syncServerStateUrl();
      },
      error: (error) => {
        if (version !== this.requestVersion) return;
        console.error('Không thể tải sản phẩm theo bộ lọc:', error);
        this.products = [];
        this.serverTotal = 0;
        this.serverTotalPages = 1;
        this.serverPaged = true;
        this.isLoadingProducts = false;
        this.render();
      }
    });
  }

  private syncServerStateUrl(): void {
    const queryParams: Record<string, string | number | null> = {
      view: 'server', sort: this.currentSort, page: this.currentPage,
      minPrice: this.selectedPriceMin > this.priceMinLimit ? this.selectedPriceMin : null,
      maxPrice: this.selectedPriceMax < this.priceMaxLimit ? this.selectedPriceMax : null,
    };
    (Object.keys(this.selectedFilters) as FilterGroup[]).forEach((group) => {
      queryParams[`f_${group}`] = this.selectedFilters[group].size ? [...this.selectedFilters[group]].join('|') : null;
    });
    const tree = this.router.createUrlTree([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
    window.history.pushState({}, '', this.router.serializeUrl(tree));
  }

  private restoreServerStateFromLocation(): void {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') !== 'server') {
      window.location.reload();
      return;
    }
    this.clearSelectedFilters();
    (Object.keys(this.selectedFilters) as FilterGroup[]).forEach((group) => {
      String(params.get(`f_${group}`) || '').split('|').map((value) => value.trim()).filter(Boolean)
        .forEach((value) => this.selectedFilters[group].add(value));
    });
    this.selectedPriceMin = Math.max(this.priceMinLimit, Number(params.get('minPrice') || this.priceMinLimit));
    this.selectedPriceMax = Math.min(this.priceMaxLimit, Number(params.get('maxPrice') || this.priceMaxLimit));
    this.currentSort = (params.get('sort') as SortValue) || 'newest';
    this.currentPage = Math.max(1, Number(params.get('page') || 1));
    this.sortSelect.value = this.currentSort;
    this.syncSortDropdown();
    this.syncPriceFilterUi();
    this.uncheckAllCheckboxes();
    (Object.keys(this.selectedFilters) as FilterGroup[]).forEach((group) => {
      this.selectedFilters[group].forEach((value) => this.syncCheckbox(group, value, true));
    });
    this.requestServerProducts(false);
  }

  private initClearAllFilters(): void {
    this.clearAllFiltersButton.addEventListener('click', () => {
      this.clearSelectedFilters();
      this.currentCollectionId = '';
      this.resetPriceFilter();
      this.uncheckAllCheckboxes();
      const allTopics = document.querySelector<HTMLInputElement>('input[data-all-topics="true"]');
      if (allTopics) allTopics.checked = true;
      this.currentPage = 1;
      this.currentSort = 'newest';
      this.pageTitle = 'Sản phẩm';
      this.setBreadcrumb();
      this.lastProductRouteKey = '';
      this.router.navigateByUrl('/category?view=server&sort=newest&page=1');
    });
  }

  private initFilterDrawer(): void {
    const close = () => {
      this.filterSidebar.classList.remove('is-mobile-open');
      this.filterDrawerOverlay.hidden = true;
      document.body.classList.remove('filter-drawer-open');
    };
    this.openFilterDrawerButton.addEventListener('click', () => {
      this.filterSidebar.classList.add('is-mobile-open');
      this.filterDrawerOverlay.hidden = false;
      document.body.classList.add('filter-drawer-open');
    });
    this.closeFilterDrawerButton.addEventListener('click', close);
    this.filterDrawerOverlay.addEventListener('click', close);
  }

  private isPriceFilterActive(): boolean {
    return this.selectedPriceMin > this.priceMinLimit || this.selectedPriceMax < this.priceMaxLimit;
  }

  private sortProducts(list: Product[]): Product[] {
    const sorted = [...list];

    if (this.currentSort === 'priceAsc') sorted.sort((a, b) => a.price - b.price);
    if (this.currentSort === 'priceDesc') sorted.sort((a, b) => b.price - a.price);
    return sorted;
  }

  private render(): void {
    if (this.serverPaged) {
      this.updateBreadcrumbLabels();
      this.renderSelectedFilters();
      this.syncAllFilterCheckboxes();
      this.syncFilterAccordion();
      this.renderProducts(this.products);
      this.renderPagination(this.serverTotalPages);
      const start = (this.currentPage - 1) * this.PAGE_SIZE;
      this.renderResultCount(this.serverTotal, start, this.products.length);
      return;
    }
    const filtered = this.sortProducts(this.getFilteredProducts());
    const totalPages = Math.max(1, Math.ceil(filtered.length / this.PAGE_SIZE));

    if (this.currentPage > totalPages) this.currentPage = totalPages;

    const startIndex = (this.currentPage - 1) * this.PAGE_SIZE;
    const pageItems = filtered.slice(startIndex, startIndex + this.PAGE_SIZE);

    this.updateBreadcrumbLabels();
    this.renderSelectedFilters();
    this.syncAllFilterCheckboxes();
    this.syncFilterAccordion();
    this.renderProducts(pageItems);
    this.renderPagination(totalPages);
    this.renderResultCount(filtered.length, startIndex, pageItems.length);
  }

  private renderProducts(items: Product[]): void {
    this.emptyMessage.hidden = this.isLoadingProducts || items.length > 0;

    this.productGrid.innerHTML = items.map((item, index) => {
      const safeId = this.escapeHtml(item.id);
      const safeName = this.escapeHtml(item.name);
      const safeImage = this.escapeHtml(item.image);
      const safeIcon = this.escapeHtml(item.icon);
      const detailHref = `/product-detail/${encodeURIComponent(item.id)}`;
      const priceHtml = `
        <div class="product-price-row">
          <p class="product-price">
            ${this.formatPrice(item.salePrice !== null ? item.salePrice : item.originalPrice)}
          </p>
          <p class="product-old-price${item.salePrice !== null ? '' : ' is-empty'}">
            ${item.salePrice !== null ? this.formatPrice(item.originalPrice) : ''}
          </p>
        </div>
      `;

      const discountPercent =
        item.salePrice !== null && item.originalPrice > 0
          ? Math.round(((item.originalPrice - item.salePrice) / item.originalPrice) * 100)
          : 0;

      const discountBadgeHtml =
        discountPercent > 0
          ? `<span class="badge-sale">-${discountPercent}%</span>`
          : '';
      const dataBadges = [
        item.badges?.new ? '<span class="product-data-badge badge-new">Mới</span>' : '',
        item.badges?.sold !== null && item.badges?.sold !== undefined
          ? `<span class="product-data-badge badge-sold">Đã bán ${item.badges.sold}</span>` : '',
        item.badges?.fastDelivery ? '<span class="product-data-badge badge-fast">Giao nhanh</span>' : ''
      ].filter(Boolean).join('');

      const isFavorite = this.wishlistProductIds.has(item.id);
      const favoriteClass = isFavorite ? ' is-active' : '';
      const favoriteIcon = isFavorite
        ? '<i class="bi bi-heart-fill"></i>'
        : '<i class="bi bi-heart"></i>';
      const favoriteLabel = isFavorite
        ? `Bỏ ${safeName} khỏi yêu thích`
        : `Thêm ${safeName} vào yêu thích`;

      return `
        <article class="product-card">
          <div class="product-media">
            <a
              class="product-image-link"
              href="${detailHref}"
              data-action="detail"
              data-product-id="${safeId}"
              aria-label="Xem chi tiết ${safeName}">
              <div class="product-image-wrap">
                ${discountBadgeHtml}
                <div class="product-data-badges">${dataBadges}</div>
                ${
                  item.image
                    ? `<img src="${safeImage}" alt="${safeName}" loading="${index < 4 ? 'eager' : 'lazy'}" fetchpriority="${index < 4 ? 'high' : 'auto'}" decoding="async">`
                    : ''
                }
                <div class="product-image-fallback" style="${item.image ? '' : 'display:flex'}">${safeIcon}</div>
              </div>
            </a>
            <button class="wishlist-btn${favoriteClass}" type="button" data-action="wishlist" data-product-id="${safeId}" aria-label="${favoriteLabel}">${favoriteIcon}</button>
          </div>

          <a
            class="product-name-link"
            href="${detailHref}"
            data-action="detail"
            data-product-id="${safeId}">
            <h2 class="product-name">${safeName}</h2>
          </a>
          ${priceHtml}

          <div class="card-actions">
            <button class="buy-btn" type="button" data-action="buy" data-product-id="${safeId}">
              MUA NGAY
            </button>

            <button
              class="cart-btn"
              type="button"
              data-action="cart"
              data-product-id="${safeId}"
              aria-label="Thêm ${safeName} vào giỏ hàng"
            >
              <i class="bi bi-cart3"></i>
            </button>
          </div>
        </article>
      `;
    }).join('');

    this.productGrid.querySelectorAll<HTMLElement>('[data-action="detail"]').forEach((element) => {
      element.addEventListener('click', (event) => {
        event.preventDefault();
        const productId = element.dataset['productId'];
        const product = items.find((item) => item.id === productId);

        if (productId) {
          this.router.navigate(['/product-detail', productId], {
            state: {
              productPreview: {
                ...product,
                breadcrumbGroup: this.getProductBreadcrumbGroup(),
                breadcrumbReturnUrl: this.getProductBreadcrumbReturnUrl()
              }
            }
          });
        }
      });
    });

    this.productGrid.querySelectorAll<HTMLButtonElement>('[data-action="buy"]').forEach((button) => {
      button.addEventListener('click', () => {
        const productId = button.dataset['productId'];
        const product = items.find((item) => item.id === productId);

        if (product) {
          this.buyNow(product);
        }
      });
    });

    this.productGrid.querySelectorAll<HTMLButtonElement>('[data-action="cart"]').forEach((button) => {
      button.addEventListener('click', (event) => {
        const productId = button.dataset['productId'];
        const product = items.find((item) => item.id === productId);

        if (product) {
          this.addProductToCart(product, event);
        }
      });
    });

    this.productGrid.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
      img.addEventListener('error', () => {
        img.style.display = 'none';
        const fallback = img.nextElementSibling as HTMLElement | null;
        if (fallback) fallback.style.display = 'flex';
      });
    });

    this.productGrid.querySelectorAll<HTMLButtonElement>('[data-action="wishlist"]').forEach((button) => {
      button.addEventListener('click', () => {
        const productId = button.dataset['productId'];
        const product = items.find((item) => item.id === productId);

        if (product) {
          this.toggleWishlist(product, button);
        }
      });
    });

    this.observeProductCards();
  }

  private observeProductCards(): void {
    const cards = Array.from(this.productGrid.querySelectorAll<HTMLElement>('.product-card'));

    this.revealObserver?.disconnect();

    if (!('IntersectionObserver' in window)) {
      cards.forEach((card) => card.classList.add('is-visible'));
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

    cards.forEach((card) => this.revealObserver?.observe(card));
  }

  private getProductImage(name: string | null | undefined, url: string | null | undefined): string {
    if (String(name || '').trim().toLocaleLowerCase('vi-VN') === 'túi quà cao cấp') {
      return 'assets/images/tui-qua-cao-cap.png';
    }

    return this.normalizeImageUrl(url);
  }

  private syncWishlistButtons(): void {
    if (!this.productGrid) return;

    this.productGrid
      .querySelectorAll<HTMLButtonElement>('[data-action="wishlist"]')
      .forEach((button) => {
        const productId = String(button.dataset['productId'] || '');
        const isFavorite = this.wishlistProductIds.has(productId);
        const product = this.products.find((item) => item.id === productId);

        button.classList.toggle('is-active', isFavorite);
        button.innerHTML = isFavorite
          ? '<i class="bi bi-heart-fill"></i>'
          : '<i class="bi bi-heart"></i>';

        if (product) {
          button.setAttribute(
            'aria-label',
            `${isFavorite ? 'Bá»' : 'ThÃªm'} ${product.name} ${isFavorite ? 'khá»i' : 'vÃ o'} yÃªu thÃ­ch`
          );
        }
      });
  }

  private renderSelectedFilters(): void {
    const chips: string[] = [];

    (Object.keys(this.selectedFilters) as FilterGroup[]).forEach((group) => {
      this.selectedFilters[group].forEach((value) => {
        const safeValue = this.escapeHtml(value);

        chips.push(`
          <span class="selected-chip">
            ${safeValue}
            <button type="button" data-group="${group}" data-value="${safeValue}" aria-label="Gỡ ${safeValue}">×</button>
          </span>
        `);
      });
    });

    if (this.isPriceFilterActive()) {
      const priceLabel = this.getPriceRangeLabel();

      chips.push(`
          <span class="selected-chip">
            ${priceLabel}
            <button type="button" data-action="clear-price" aria-label="Gỡ ${priceLabel}">×</button>
          </span>
        `);
    }

    this.selectedFilterRow.hidden = false;
    this.selectedFilterList.innerHTML = chips.length
      ? chips.join('')
      : '<span class="selected-chip all-products-label">Tất cả sản phẩm</span>';
    this.clearAllFiltersButton.hidden = chips.length === 0 && !this.currentCollectionId;

    this.selectedFilterList.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset['action'] === 'clear-price') {
          this.resetPriceFilter();
          this.currentPage = 1;
          this.requestServerProducts();
          return;
        }

        const group = button.dataset['group'] as FilterGroup;
        const value = button.dataset['value'] ?? '';

        this.selectedFilters[group].delete(value);
        this.syncCheckbox(group, value, false);

        this.currentPage = 1;

        if (group === 'chuDe') {
          const path = this.route.snapshot.routeConfig?.path || '';

          if (path.startsWith('chu-de')) {
            this.navigateToCategoryWithSelectedTopics();
            return;
          }

          if (path === 'category') {
            this.navigateToCategoryWithSelectedTopics();
          }
        }

        this.requestServerProducts();
      });
    });
  }

  private renderPagination(totalPages: number): void {
    if (totalPages <= 1) {
      this.pagination.innerHTML = '';
      return;
    }

    const pages = this.getVisiblePages(totalPages);

    this.pagination.innerHTML = `
      <button class="page-btn" type="button" data-action="prev" ${this.currentPage === 1 ? 'disabled' : ''}>‹</button>
      ${pages.map((page) => page === '...'
        ? '<span class="page-ellipsis">...</span>'
        : `<button class="page-btn ${page === this.currentPage ? 'is-active' : ''}" type="button" data-page="${page}">${page}</button>`
      ).join('')}
      <button class="page-btn" type="button" data-action="next" ${this.currentPage === totalPages ? 'disabled' : ''}>›</button>
    `;

    this.pagination.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset['action'];
        const page = button.dataset['page'];

        if (action === 'prev' && this.currentPage > 1) this.currentPage--;
        if (action === 'next' && this.currentPage < totalPages) this.currentPage++;
        if (page) this.currentPage = Number(page);

        if (this.serverPaged) this.requestServerProducts(); else this.render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  private getVisiblePages(totalPages: number): Array<number | '...'> {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1);

    if (this.currentPage <= 3) return [1, 2, 3, '...', totalPages];
    if (this.currentPage >= totalPages - 2) return [1, '...', totalPages - 2, totalPages - 1, totalPages];

    return [1, '...', this.currentPage, '...', totalPages];
  }

  private renderResultCount(total: number, startIndex: number, pageLength: number): void {
    if (total === 0) {
      this.resultCount.textContent = 'Hiển thị 0/0 sản phẩm';
      return;
    }

    this.resultCount.textContent = `Hiển thị ${startIndex + 1}-${startIndex + pageLength}/${total} sản phẩm`;
  }
  private syncTopicCheckboxById(topicId: string, checked: boolean): void {
    document
      .querySelectorAll<HTMLInputElement>('input[data-group="chuDe"]')
      .forEach((checkbox) => {
        checkbox.checked =
          !this.isAllTopicsCheckbox(checkbox) && checkbox.dataset['id'] === topicId
            ? checked
            : false;
      });
  }

  private syncTopicFilterCheckboxes(): void {
    const selectedTopics = this.selectedFilters.chuDe;

    document
      .querySelectorAll<HTMLInputElement>('input[data-group="chuDe"]')
      .forEach((checkbox) => {
        if (this.isAllTopicsCheckbox(checkbox)) {
          checkbox.checked = selectedTopics.size === 0;
          return;
        }

        checkbox.checked = selectedTopics.has(this.getCheckboxValue(checkbox));
      });
  }

  private syncAllFilterCheckboxes(): void {
    document.querySelectorAll<HTMLInputElement>('.filter-content input[type="checkbox"][data-group]').forEach((checkbox) => {
      const group = checkbox.dataset['group'] as FilterGroup;
      if (group === 'chuDe' && this.isAllTopicsCheckbox(checkbox)) {
        checkbox.checked = this.selectedFilters.chuDe.size === 0;
        return;
      }
      checkbox.checked = this.selectedFilters[group].has(this.getCheckboxValue(checkbox));
    });
  }

  private uncheckSpecificTopicCheckboxes(): void {
    document
      .querySelectorAll<HTMLInputElement>('input[data-group="chuDe"]')
      .forEach((checkbox) => {
        if (!this.isAllTopicsCheckbox(checkbox)) {
          checkbox.checked = false;
        }
      });
  }

  private isAllTopicsCheckbox(checkbox: HTMLInputElement): boolean {
    return checkbox.dataset['allTopics'] === 'true';
  }

  private getTopicIdsFromQuery(rawTopics: string | null): string[] {
    if (!rawTopics) {
      return [];
    }

    return Array.from(
      new Set(
        rawTopics
          .split(',')
          .map((topicId) => topicId.trim())
          .filter((topicId) => !!this.topicNameById[topicId])
      )
    );
  }

  private getSelectedTopicIdsFromCheckboxes(): string[] {
    const selectedTopicIds = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[data-group="chuDe"]:checked')
    )
      .filter((checkbox) => !this.isAllTopicsCheckbox(checkbox))
      .map((checkbox) => checkbox.dataset['id'] || '')
      .filter((topicId) => !!topicId);

    return Array.from(new Set(selectedTopicIds));
  }

  private navigateToCategoryWithSelectedTopics(): void {
    const selectedTopicIds = this.getSelectedTopicIdsFromCheckboxes();

    this.router.navigate(['/category'], {
      queryParams: selectedTopicIds.length > 0
        ? { topics: selectedTopicIds.join(',') }
        : {},
    });
  }

  private syncCheckbox(group: FilterGroup, value: string, checked: boolean): void {
    const normalizedValue = this.normalizeText(value);

    document.querySelectorAll<HTMLInputElement>('.filter-content input[type="checkbox"]').forEach((checkbox) => {
      const checkboxGroup = checkbox.dataset['group'];
      const checkboxValue = this.getCheckboxValue(checkbox);
      const normalizedCheckboxValue = this.normalizeText(checkboxValue);

      if (
        checkboxGroup === group &&
        normalizedCheckboxValue === normalizedValue
      ) {
        checkbox.checked = checked;
      }
    });
  }

  private uncheckAllCheckboxes(): void {
    document.querySelectorAll<HTMLInputElement>('.filter-content input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = false;
    });
  }

  private clearSelectedFilters(): void {
    (Object.keys(this.selectedFilters) as FilterGroup[]).forEach((group) => {
      this.selectedFilters[group].clear();
    });
  }

  private initFilterInputs(): void {
    document.querySelectorAll<HTMLInputElement>('.filter-content input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const group = checkbox.dataset['group'] as FilterGroup;
        const value = this.getCheckboxValue(checkbox);
        if (group === 'chuDe' && this.isAllTopicsCheckbox(checkbox)) {
          this.selectedFilters.chuDe.clear();
          this.uncheckSpecificTopicCheckboxes();
          checkbox.checked = true;
        } else {
          if (group === 'chuDe') {
            const allTopics = document.querySelector<HTMLInputElement>('input[data-all-topics="true"]');
            if (allTopics) allTopics.checked = false;
          }
          if (checkbox.checked) this.selectedFilters[group].add(value);
          else this.selectedFilters[group].delete(value);
        }
        this.currentPage = 1;
        this.requestServerProducts();
      });
    });
  }

  private getCheckboxValue(checkbox: HTMLInputElement): string {
    const label = checkbox.closest('label');
    const labelText = label?.textContent?.trim();

    return labelText || checkbox.value;
  }

  private normalizeText(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private initFilterCollapse(): void {
    document.querySelectorAll<HTMLButtonElement>('.filter-title').forEach((button) => {
      button.addEventListener('click', () => {
        const content = button.nextElementSibling as HTMLElement | null;
        const icon = button.querySelector<HTMLElement>('.chevron');
        const isExpanded = button.getAttribute('aria-expanded') === 'true';
        const nextExpanded = !isExpanded;

        button.setAttribute('aria-expanded', String(nextExpanded));
        icon?.classList.toggle('bi-chevron-up', nextExpanded);
        icon?.classList.toggle('bi-chevron-down', !nextExpanded);
        content?.classList.toggle('is-hidden', isExpanded);
      });
    });
    this.syncFilterAccordion();
  }

  private syncFilterAccordion(): void {
    document.querySelectorAll<HTMLElement>('.filter-group').forEach((groupElement) => {
      const button = groupElement.querySelector<HTMLButtonElement>('.filter-title');
      const content = groupElement.querySelector<HTMLElement>('.filter-content');
      if (!button || !content) return;
      const checkboxes = Array.from(content.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      const hasSelectedCheckbox = checkboxes.some((checkbox) => checkbox.checked && !this.isAllTopicsCheckbox(checkbox));
      const isPriceGroup = groupElement.classList.contains('price-filter-group');
      const expanded = hasSelectedCheckbox || (isPriceGroup && this.isPriceFilterActive());
      button.setAttribute('aria-expanded', String(expanded));
      button.querySelector('.chevron')?.classList.toggle('bi-chevron-up', expanded);
      button.querySelector('.chevron')?.classList.toggle('bi-chevron-down', !expanded);
      content.classList.toggle('is-hidden', !expanded);
    });
  }

  private initSort(): void {
    this.sortSelect.addEventListener('change', () => {
      this.currentSort = this.sortSelect.value as SortValue;
      this.currentPage = 1;
      this.syncSortDropdown();
      this.requestServerProducts();
    });

    this.sortDropdownToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleSortDropdown();
    });

    this.sortDropdownMenu.querySelectorAll<HTMLButtonElement>('.sort-option').forEach((option) => {
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        const nextSort = option.dataset['sortValue'] as SortValue | undefined;

        if (!nextSort) {
          return;
        }

        this.currentSort = nextSort;
        this.sortSelect.value = nextSort;
        this.currentPage = 1;
        this.syncSortDropdown();
        this.closeSortDropdown();
        this.requestServerProducts();
      });
    });

    document.addEventListener('click', (event) => {
      if (!this.sortDropdown.contains(event.target as Node)) {
        this.closeSortDropdown();
      }
    });

    this.sortDropdown.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.closeSortDropdown();
        this.sortDropdownToggle.focus();
      }
    });

    this.syncSortDropdown();
  }

  private toggleSortDropdown(): void {
    const shouldOpen = !this.sortDropdown.classList.contains('is-open');

    this.sortDropdown.classList.toggle('is-open', shouldOpen);
    this.sortDropdownToggle.setAttribute('aria-expanded', String(shouldOpen));
  }

  private closeSortDropdown(): void {
    this.sortDropdown.classList.remove('is-open');
    this.sortDropdownToggle.setAttribute('aria-expanded', 'false');
  }

  private syncSortDropdown(): void {
    const selectedOption = this.sortSelect.selectedOptions[0];
    const selectedText = selectedOption?.textContent?.trim() || 'Mặc định';

    this.sortDropdownLabel.textContent = selectedText;

    this.sortDropdownMenu.querySelectorAll<HTMLButtonElement>('.sort-option').forEach((option) => {
      const isSelected = option.dataset['sortValue'] === this.currentSort;

      option.classList.toggle('is-selected', isSelected);
      option.setAttribute('aria-selected', String(isSelected));
    });
  }

  private initPriceFilter(): void {
    this.priceRangeOptions.forEach((input) => {
      input.addEventListener('change', () => this.onPriceRangeChange(input));
    });

    this.syncPriceFilterUi();
  }

  private onPriceRangeChange(input: HTMLInputElement): void {
    const minValue = Number(input.dataset['priceMin']);
    const maxValue = Number(input.dataset['priceMax']);

    if (
      !Number.isFinite(minValue) ||
      !Number.isFinite(maxValue) ||
      minValue < this.priceMinLimit ||
      maxValue > this.priceMaxLimit ||
      minValue > maxValue
    ) {
      console.error('Khoảng giá bộ lọc không hợp lệ.');
      return;
    }

    this.selectedPriceMin = minValue;
    this.selectedPriceMax = maxValue;
    this.currentPage = 1;
    this.syncPriceFilterUi();
    this.requestServerProducts();
  }

  private resetPriceFilter(): void {
    this.selectedPriceMin = this.priceMinLimit;
    this.selectedPriceMax = this.priceMaxLimit;
    this.syncPriceFilterUi();
  }

  private syncPriceFilterUi(): void {
    this.priceRangeOptions.forEach((input) => {
      input.checked =
        Number(input.dataset['priceMin']) === this.selectedPriceMin &&
        Number(input.dataset['priceMax']) === this.selectedPriceMax;
    });
  }

  private getPriceRangeLabel(): string {
    const selectedOption = this.priceRangeOptions.find((input) =>
      Number(input.dataset['priceMin']) === this.selectedPriceMin &&
      Number(input.dataset['priceMax']) === this.selectedPriceMax
    );

    return selectedOption?.dataset['priceLabel'] ||
      `${this.formatPrice(this.selectedPriceMin)} - ${this.formatPrice(this.selectedPriceMax)}`;
  }

  private getProductBreadcrumbGroup(): string {
    const label = this.breadcrumbLabels[0] || this.breadcrumbFallbackLabels[0] || 'Chủ đề';
    const allowedLabels = new Set(['Chủ đề', 'Đối tượng', 'Kiểu dáng', 'Hoa tươi', 'Bộ sưu tập']);

    return allowedLabels.has(label) ? label : 'Chủ đề';
  }

  private getProductBreadcrumbReturnUrl(): string {
    return this.router.url || '/category';
  }

  private initMobileFilterControls(): void {
    this.populateMobileFilterOptions();

    this.mobileFilterSelect.addEventListener('change', () => {
      const [group, value] = this.mobileFilterSelect.value.split('::') as [FilterGroup | '', string | undefined];

      if (!group || !value) {
        return;
      }

      const checkbox = this.findFilterCheckbox(group, value);

      if (!checkbox) {
        return;
      }

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      this.mobileFilterSelect.value = '';
    });
  }

  private populateMobileFilterOptions(): void {
    const groups: Array<{ key: FilterGroup; label: string }> = [
      { key: 'chuDe', label: 'Chủ đề' },
      { key: 'doiTuong', label: 'Đối tượng' },
      { key: 'kieuDang', label: 'Kiểu dáng' },
      { key: 'hoaTuoi', label: 'Hoa tươi' },
      { key: 'mauSac', label: 'Màu sắc' },
    ];

    const optionGroups = groups.map(({ key, label }) => {
      const options = Array.from(
        document.querySelectorAll<HTMLInputElement>(`.filter-content input[data-group="${key}"]`)
      )
        .map((checkbox) => this.getCheckboxValue(checkbox))
        .filter((value, index, list) => value && list.indexOf(value) === index)
        .map((value) => {
          const optionValue = `${key}::${value}`;
          return `<option value="${this.escapeHtml(optionValue)}">${this.escapeHtml(value)}</option>`;
        });

      if (!options.length) {
        return '';
      }

      return `<optgroup label="${this.escapeHtml(label)}">${options.join('')}</optgroup>`;
    });

    this.mobileFilterSelect.innerHTML = [
      '<option value="" selected>Chọn mục lọc</option>',
      ...optionGroups,
    ].join('');
  }

  private findFilterCheckbox(group: FilterGroup, value: string): HTMLInputElement | null {
    const normalizedValue = this.normalizeText(value);

    return Array.from(
      document.querySelectorAll<HTMLInputElement>(`.filter-content input[data-group="${group}"]`)
    ).find((checkbox) => this.normalizeText(this.getCheckboxValue(checkbox)) === normalizedValue) || null;
  }

  private buyNow(product: Product): void {
    if (!this.isBrowser()) {
      return;
    }

    const checkoutItem = this.createCartItem(product);
    localStorage.setItem(this.checkoutItemsStorageKey, JSON.stringify([checkoutItem]));
    this.dispatchCartChanged();
    this.router.navigate([this.getOrderRoute()]);
  }

  private toggleWishlist(product: Product, button?: HTMLButtonElement): void {
    if (!this.isBrowser()) {
      return;
    }

    const customerId = this.getCustomerId();

    if (!customerId) {
      this.router.navigate(['/login']);
      return;
    }

    if (!String(product.id || '').trim()) {
      return;
    }

    if (this.pendingWishlistProductIds.has(product.id)) {
      return;
    }

    const isFavorite = this.wishlistProductIds.has(product.id);
    const nextIsFavorite = !isFavorite;

    this.pendingWishlistProductIds.add(product.id);

    if (nextIsFavorite) {
      this.wishlistProductIds.add(product.id);
    } else {
      this.wishlistProductIds.delete(product.id);
    }

    this.updateWishlistButton(product, nextIsFavorite, button);

    if (isFavorite) {
      this.customerService.removeWishlistItem(customerId, product.id).subscribe({
        error: (err) => {
          console.error('Lỗi xóa sản phẩm yêu thích:', err);
          this.wishlistProductIds.add(product.id);
          this.updateWishlistButton(product, true, button);
        },
        complete: () => {
          this.pendingWishlistProductIds.delete(product.id);
        },
      });

      return;
    }

    this.customerService.addWishlistItem(customerId, product.id).subscribe({
      error: (err) => {
        console.error('Lỗi thêm sản phẩm yêu thích:', err);
        this.wishlistProductIds.delete(product.id);
        this.updateWishlistButton(product, false, button);
      },
      complete: () => {
        this.pendingWishlistProductIds.delete(product.id);
      },
    });
  }

  private updateWishlistButton(
    product: Product,
    isFavorite: boolean,
    button?: HTMLButtonElement
  ): void {
    const targetButton =
      button ||
      Array.from(this.productGrid.querySelectorAll<HTMLButtonElement>('[data-action="wishlist"]'))
        .find((wishlistButton) => wishlistButton.dataset['productId'] === product.id);

    if (!targetButton) {
      return;
    }

    const safeName = this.escapeHtml(product.name);

    targetButton.classList.toggle('is-active', isFavorite);
    targetButton.innerHTML = isFavorite
      ? '<i class="bi bi-heart-fill"></i>'
      : '<i class="bi bi-heart"></i>';
    targetButton.setAttribute(
      'aria-label',
      isFavorite
        ? `Bỏ ${safeName} khỏi yêu thích`
        : `Thêm ${safeName} vào yêu thích`
    );
  }

  private addProductToCart(product: Product, event?: Event): void {
    if (!this.isBrowser()) {
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
    if (!this.isBrowser() || !event) {
      return;
    }

    const targetEl = event.target as HTMLElement | null;
    const button = targetEl?.closest<HTMLButtonElement>('.cart-btn');
    const card = targetEl?.closest('.product-card');
    const sourceImg = card?.querySelector('.product-image-wrap img') as HTMLImageElement | null;

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

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId) && typeof window !== 'undefined';
  }

  private getLoggedInCustomer(): any | null {
    if (!this.isBrowser()) {
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

  private createCartItem(product: Product) {
    return {
      id: product.id,
      name: product.name,
      style: product.filters.kieuDang[0] || 'Sản phẩm',
      occasion: product.filters.chuDe[0] || 'Đang bán',
      price: product.price,
      originalPrice: product.salePrice !== null ? product.originalPrice : null,
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

  private saveProductToGuestCart(product: Product): void {
    const cart = this.getCartFromStorage();
    const cartItem = this.createCartItem(product);
    const existingItem = cart.find((item: any) => String(item?.id || '') === product.id);

    if (existingItem) {
      const currentQuantity = Number(existingItem.quantity || 1);
      const nextQuantity = currentQuantity + 1;
      existingItem.quantity = nextQuantity;
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
    if (!this.isBrowser()) {
      return;
    }

    window.dispatchEvent(new Event('cart-changed'));
  }

  private escapeHtml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private parseFilterList(value: string | null | undefined): string[] {
    if (!value) return [];

    return value
      .split('|')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}
