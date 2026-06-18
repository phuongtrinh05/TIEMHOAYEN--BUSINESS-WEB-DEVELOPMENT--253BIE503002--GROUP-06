import {
  AfterViewInit,
  Component,
  Inject,
  OnDestroy,
  PLATFORM_ID,
  ViewEncapsulation
} from '@angular/core';

import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import {
  CategoryProductService,
  CategoryProduct
} from '../../services/category-product.service';

type FilterGroup = 'chuDe' | 'kieuDang' | 'hoaTuoi' | 'doiTuong' | 'mauSac';
type SortValue = 'default' | 'priceAsc' | 'priceDesc' | 'nameAsc' | 'nameDesc';

interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
  icon: string;
  filters: Record<FilterGroup, string[]>;
}

@Component({
  selector: 'app-category',
  standalone: true,
  templateUrl: './category.html',
  styleUrl: './category.css',
  encapsulation: ViewEncapsulation.None,
})
export class CategoryComponent implements AfterViewInit, OnDestroy {
  pageTitle = 'Sản phẩm';

  private readonly PAGE_SIZE = 16;
  private readonly PRODUCT_IMAGES = 'assets/images/category/';

  private currentPage = 1;
  private currentSort: SortValue = 'default';

  private productGrid!: HTMLDivElement;
  private selectedFilterRow!: HTMLElement;
  private selectedFilterList!: HTMLDivElement;
  private pagination!: HTMLDivElement;
  private resultCount!: HTMLParagraphElement;
  private emptyMessage!: HTMLParagraphElement;
  private sortSelect!: HTMLSelectElement;

  private routeSubscription?: Subscription;

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

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    private route: ActivatedRoute,
    private router: Router,
    private categoryProductService: CategoryProductService
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
        !this.productGrid ||
        !this.selectedFilterRow ||
        !this.selectedFilterList ||
        !this.pagination ||
        !this.resultCount ||
        !this.emptyMessage ||
        !this.sortSelect
      ) {
        return;
      }

      this.initFilterInputs();
      this.initFilterCollapse();
      this.initSort();
      this.loadDataFromRoute();
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  private loadDataFromRoute(): void {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      const path = this.route.snapshot.routeConfig?.path || '';

      this.clearSelectedFilters();
      this.uncheckAllCheckboxes();
      this.currentPage = 1;

      if (!id) {
        this.pageTitle = 'Sản phẩm';
        this.products = this.createProductData();
        this.render();
        return;
      }

      if (path.startsWith('chu-de')) {
        this.loadProductsByTopic(id);
        return;
      }

      this.pageTitle = 'Sản phẩm';
      this.products = this.createProductData();
      this.render();
    });
  }

  private loadProductsByTopic(topicId: string): void {
    this.categoryProductService.getProductsByTopic(topicId).subscribe({
      next: (res) => {
        const topicName = res.topic?.TEN_CHU_DE || 'Sản phẩm';

        this.pageTitle = topicName;

        this.products = res.products.map((item) =>
          this.mapDbProductToProduct(item)
        );

        this.selectedFilters.chuDe.add(topicName);

        setTimeout(() => {
          this.syncCheckbox('chuDe', topicName, true);
          this.currentPage = 1;
          this.render();
        });
      },
      error: (err) => {
        console.error('Lỗi lấy sản phẩm theo chủ đề:', err);

        this.pageTitle = 'Không tìm thấy chủ đề';
        this.products = [];
        this.render();
      }
    });
  }

  private mapDbProductToProduct(item: CategoryProduct): Product {
    return {
      id: item.SAN_PHAM_ID,
      name: item.TEN_SAN_PHAM,
      price: item.GIA_KHUYEN_MAI || item.GIA || 0,
      image: this.normalizeImageUrl(item.HINH_ANH),
      icon: '🌸',
      filters: {
        chuDe: item.TEN_CHU_DE ? [item.TEN_CHU_DE] : [],
        kieuDang: item.KIEU_DANG ? [item.KIEU_DANG] : [],
        hoaTuoi: [],
        doiTuong: [],
        mauSac: []
      }
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
    this.productGrid = document.querySelector<HTMLDivElement>('#productGrid')!;
    this.selectedFilterRow = document.querySelector<HTMLElement>('#selectedFilterRow')!;
    this.selectedFilterList = document.querySelector<HTMLDivElement>('#selectedFilterList')!;
    this.pagination = document.querySelector<HTMLDivElement>('#pagination')!;
    this.resultCount = document.querySelector<HTMLParagraphElement>('#resultCount')!;
    this.emptyMessage = document.querySelector<HTMLParagraphElement>('#emptyMessage')!;
    this.sortSelect = document.querySelector<HTMLSelectElement>('#sortSelect')!;
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
      image: this.PRODUCT_IMAGES + fileName,
      icon,
      filters: { chuDe, kieuDang, hoaTuoi, doiTuong, mauSac },
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

      result.push({
        ...seed,
        id: String(id),
        name,
        price: seed.price + ((id % 5) * 50000),
      });

      id++;
    }

    return result;
  }

  private formatPrice(price: number): string {
    return price.toLocaleString('vi-VN') + 'đ';
  }

  private getSelectedCount(): number {
    return Object.values(this.selectedFilters).reduce((total, group) => total + group.size, 0);
  }

  private getFilteredProducts(): Product[] {
    return this.products.filter((item) => {
      return (Object.keys(this.selectedFilters) as FilterGroup[]).every((group) => {
        const chosen = this.selectedFilters[group];

        if (chosen.size === 0) return true;

        return item.filters[group].some((value) => chosen.has(value));
      });
    });
  }

  private sortProducts(list: Product[]): Product[] {
    const sorted = [...list];

    if (this.currentSort === 'priceAsc') sorted.sort((a, b) => a.price - b.price);
    if (this.currentSort === 'priceDesc') sorted.sort((a, b) => b.price - a.price);
    if (this.currentSort === 'nameAsc') sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (this.currentSort === 'nameDesc') sorted.sort((a, b) => b.name.localeCompare(a.name));

    return sorted;
  }

  private render(): void {
    const filtered = this.sortProducts(this.getFilteredProducts());
    const totalPages = Math.max(1, Math.ceil(filtered.length / this.PAGE_SIZE));

    if (this.currentPage > totalPages) this.currentPage = totalPages;

    const startIndex = (this.currentPage - 1) * this.PAGE_SIZE;
    const pageItems = filtered.slice(startIndex, startIndex + this.PAGE_SIZE);

    this.renderSelectedFilters();
    this.renderProducts(pageItems);
    this.renderPagination(totalPages);
    this.renderResultCount(filtered.length, startIndex, pageItems.length);
  }

  private renderProducts(items: Product[]): void {
    this.emptyMessage.hidden = items.length > 0;

    this.productGrid.innerHTML = items.map((item) => {
      const safeName = this.escapeHtml(item.name);
      const safeImage = this.escapeHtml(item.image);
      const safeIcon = this.escapeHtml(item.icon);

      return `
        <article class="product-card">
          <div class="product-image-wrap">
            ${
              item.image
                ? `<img src="${safeImage}" alt="${safeName}" loading="lazy">`
                : ''
            }
            <div class="product-image-fallback" style="${item.image ? '' : 'display:flex'}">${safeIcon}</div>
            <button class="wishlist-btn" type="button" aria-label="Thêm ${safeName} vào yêu thích">♡</button>
          </div>

          <h2 class="product-name">${safeName}</h2>
          <p class="product-price">${this.formatPrice(item.price)}</p>

          <div class="card-actions">
            <button class="buy-btn" type="button">MUA NGAY</button>
            <button class="cart-btn" type="button" aria-label="Thêm ${safeName} vào giỏ hàng">🛒</button>
          </div>
        </article>
      `;
    }).join('');

    this.productGrid.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
      img.addEventListener('error', () => {
        img.style.display = 'none';
        const fallback = img.nextElementSibling as HTMLElement | null;
        if (fallback) fallback.style.display = 'flex';
      });
    });

    this.productGrid.querySelectorAll<HTMLButtonElement>('.wishlist-btn').forEach((button) => {
      button.addEventListener('click', () => {
        button.classList.toggle('is-active');
        button.textContent = button.classList.contains('is-active') ? '♥' : '♡';
      });
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

    const hasFilter = this.getSelectedCount() > 0;

    this.selectedFilterRow.hidden = !hasFilter;
    this.selectedFilterList.innerHTML = chips.join('');

    this.selectedFilterList.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('click', () => {
        const group = button.dataset['group'] as FilterGroup;
        const value = button.dataset['value'] ?? '';

        // Không cho xóa chip Chủ đề, vì trang category luôn cần đúng 1 chủ đề.
        if (group === 'chuDe') {
          this.syncCheckbox(group, value, true);
          return;
        }

        this.selectedFilters[group].delete(value);
        this.syncCheckbox(group, value, false);

        this.currentPage = 1;
        this.render();
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

        this.render();
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

        // Nhóm Chủ đề: chỉ được chọn 1 và phải chuyển route để gọi API mới.
        if (group === 'chuDe') {
          if (!checkbox.checked) {
            checkbox.checked = true;
            return;
          }

          document
            .querySelectorAll<HTMLInputElement>('input[data-group="chuDe"]')
            .forEach((topicCheckbox) => {
              if (topicCheckbox !== checkbox) {
                topicCheckbox.checked = false;
              }
            });

          this.selectedFilters.chuDe.clear();
          this.selectedFilters.chuDe.add(value);

          const topicId = checkbox.dataset['id'];

          if (topicId) {
            this.router.navigate(['/chu-de', topicId]);
            return;
          }

          this.currentPage = 1;
          this.render();
          return;
        }

        // Các nhóm khác vẫn được chọn nhiều.
        if (checkbox.checked) {
          this.selectedFilters[group].add(value);
        } else {
          this.selectedFilters[group].delete(value);
        }

        this.currentPage = 1;
        this.render();
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
        const isExpanded = button.getAttribute('aria-expanded') === 'true';

        button.setAttribute('aria-expanded', String(!isExpanded));
        content?.classList.toggle('is-hidden', isExpanded);
      });
    });
  }

  private initSort(): void {
    this.sortSelect.addEventListener('change', () => {
      this.currentSort = this.sortSelect.value as SortValue;
      this.currentPage = 1;
      this.render();
    });
  }

  private escapeHtml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}