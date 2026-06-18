import {
  AfterViewInit,
  Component,
  Inject,
  OnDestroy,
  PLATFORM_ID,
  ViewEncapsulation
} from '@angular/core';

import { isPlatformBrowser } from '@angular/common';

type FilterGroup = 'chuDe' | 'kieuDang' | 'hoaTuoi' | 'doiTuong' | 'mauSac';
type SortValue = 'default' | 'priceAsc' | 'priceDesc' | 'nameAsc' | 'nameDesc';

interface Product {
  id: number;
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
  constructor(@Inject(PLATFORM_ID) private platformId: object) {}
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

  private readonly selectedFilters: Record<FilterGroup, Set<string>> = {
    chuDe: new Set<string>(),
    kieuDang: new Set<string>(),
    hoaTuoi: new Set<string>(),
    doiTuong: new Set<string>(),
    mauSac: new Set<string>(),
  };

  private readonly baseProducts: Product[] = [
    this.createProduct(1, 'Serenity Rose', 699000, 'serenity-rose.jpg', '🌸', ['Sinh nhật'], ['Bó hoa'], ['Hoa hồng'], ['Bạn gái', 'Người yêu'], ['Hồng']),
    this.createProduct(2, 'Pink Blossom', 799000, 'pink-blossom.jpg', '💐', ['Sinh nhật'], ['Bó hoa'], ['Hoa hồng'], ['Bạn gái', 'Mẹ'], ['Hồng']),
    this.createProduct(3, 'Golden Sunshine', 899000, 'golden-sunshine.jpg', '🌻', ['Sinh nhật', 'Chúc mừng'], ['Bó hoa'], ['Hoa hướng dương'], ['Sếp'], ['Vàng']),
    this.createProduct(4, 'Crimson Love', 999000, 'crimson-love.jpg', '🌹', ['Sinh nhật', 'Tình yêu'], ['Bó hoa'], ['Hoa hồng'], ['Người yêu', 'Vợ'], ['Đỏ']),
    this.createProduct(5, 'White Elegance', 899000, 'white-elegance.jpg', '🤍', ['Sinh nhật', 'Cưới'], ['Bó hoa'], ['Hoa ly'], ['Mẹ', 'Vợ'], ['Trắng']),
    this.createProduct(6, 'Lavender Dream', 899000, 'lavender-dream.jpg', '💜', ['Sinh nhật'], ['Bó hoa'], ['Hoa hồng'], ['Bạn gái'], ['Tím']),
    this.createProduct(7, 'Tulip Romance', 1099000, 'tulip-romance.jpg', '🌷', ['Sinh nhật', 'Tình yêu'], ['Bó hoa'], ['Hoa tulip'], ['Người yêu', 'Vợ'], ['Hồng']),
    this.createProduct(8, 'Sweet Garden', 999000, 'sweet-garden.jpg', '🌺', ['Sinh nhật'], ['Giỏ hoa'], ['Hoa hồng', 'Hoa cúc'], ['Mẹ'], ['Hồng']),
    this.createProduct(9, 'Ocean Bloom', 1199000, 'ocean-bloom.jpg', '🩵', ['Sinh nhật'], ['Bó hoa'], ['Hoa baby'], ['Bạn gái'], ['Xanh']),
    this.createProduct(10, 'Peach Melody', 799000, 'peach-melody.jpg', '🍑', ['Sinh nhật'], ['Giỏ hoa'], ['Hoa hồng'], ['Mẹ'], ['Cam', 'Hồng']),
    this.createProduct(11, 'Royal Orchid', 1499000, 'royal-orchid.jpg', '💜', ['Sinh nhật', 'Khai trương'], ['Hộp hoa'], ['Hoa Lan'], ['Sếp'], ['Tím']),
    this.createProduct(12, 'Golden Wish', 899000, 'golden-wish.jpg', '🎁', ['Sinh nhật', 'Chúc mừng'], ['Hộp hoa'], ['Hoa hồng'], ['Sếp', 'Mẹ'], ['Xanh', 'Trắng']),
    this.createProduct(13, 'Baby Cloud', 599000, 'baby-cloud.jpg', '☁️', ['Sinh nhật'], ['Giỏ hoa'], ['Hoa baby', 'Hoa hồng'], ['Bạn gái'], ['Hồng', 'Trắng']),
    this.createProduct(14, 'Dreamy Pink', 1099000, 'dreamy-pink.jpg', '🌸', ['Sinh nhật', 'Tình yêu'], ['Giỏ hoa'], ['Hoa hồng'], ['Người yêu', 'Vợ'], ['Hồng']),
    this.createProduct(15, 'Burgundy Luxury', 1299000, 'burgundy-luxury.jpg', '🍷', ['Sinh nhật', 'Tình yêu'], ['Hộp hoa'], ['Hoa hồng'], ['Người yêu'], ['Đỏ']),
    this.createProduct(16, 'Orchid Grace', 1599000, 'orchid-grace.jpg', '🌺', ['Sinh nhật'], ['Hoa hộp Mica'], ['Hoa Lan'], ['Mẹ', 'Sếp'], ['Tím']),
    this.createProduct(17, 'Sunflower Joy', 649000, 'sunflower-joy.jpg', '🌻', ['Sinh nhật'], ['Bó hoa'], ['Hoa hướng dương'], ['Bạn gái', 'Sếp'], ['Vàng']),
    this.createProduct(18, 'Cherry Delight', 749000, 'cherry-delight.jpg', '🌸', ['Sinh nhật'], ['Bó hoa'], ['Hoa hồng', 'Hoa baby'], ['Bạn gái'], ['Hồng', 'Trắng']),
  ];

  private readonly products: Product[] = this.createProductData();

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
      this.render();
    });
  }

  ngOnDestroy(): void {}

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
      id,
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
        id,
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

    this.productGrid.innerHTML = items.map((item) => `
      <article class="product-card">
        <div class="product-image-wrap">
          <img src="${item.image}" alt="${item.name}" loading="lazy">
          <div class="product-image-fallback">${item.icon}</div>
          <button class="wishlist-btn" type="button" aria-label="Thêm ${item.name} vào yêu thích">♡</button>
        </div>

        <h2 class="product-name">${item.name}</h2>
        <p class="product-price">${this.formatPrice(item.price)}</p>

        <div class="card-actions">
          <button class="buy-btn" type="button">MUA NGAY</button>
          <button class="cart-btn" type="button" aria-label="Thêm ${item.name} vào giỏ hàng">🛒</button>
        </div>
      </article>
    `).join('');

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
        chips.push(`
          <span class="selected-chip">
            ${value}
            <button type="button" data-group="${group}" data-value="${value}" aria-label="Gỡ ${value}">×</button>
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
    document.querySelectorAll<HTMLInputElement>('.filter-content input[type="checkbox"]').forEach((checkbox) => {
      const checkboxGroup = checkbox.dataset['group'];

      if (checkboxGroup === group && checkbox.value === value) {
        checkbox.checked = checked;
      }
    });
  }

  private initFilterInputs(): void {
    document.querySelectorAll<HTMLInputElement>('.filter-content input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const group = checkbox.dataset['group'] as FilterGroup;
        const value = checkbox.value;

        if (checkbox.checked) this.selectedFilters[group].add(value);
        else this.selectedFilters[group].delete(value);

        this.currentPage = 1;
        this.render();
      });
    });
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
}