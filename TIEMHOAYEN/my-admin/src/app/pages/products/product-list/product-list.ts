import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, Inject, OnInit, PLATFORM_ID, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AdminApiService, AdminProduct } from '../../../services/admin-api.service';

type ProductFilter = 'all' | 'featured' | 'sale' | 'stop';
type PaginationItem = number | 'ellipsis';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './product-list.html',
  styleUrl: './product-list.css'
})
export class ProductList implements OnInit {
  private readonly fallbackProductImage = 'assets/images/logo-main.png';

  searchKeyword = '';
  selectedFilter: ProductFilter = 'all';
  filteredProducts: AdminProduct[] = [];
  originalProducts: AdminProduct[] = [];
  products: AdminProduct[] = [];
  private pagedProductsValue: AdminProduct[] = [];
  private pagesValue: PaginationItem[] = [1];
  private productPriceValues = new Map<string, number>();
  private productRatingStars = new Map<string, boolean[]>();

  selectedProduct: AdminProduct | null = null;
  showMenu = false;
  showCreatePopup = false;
  showFilterMenu = false;
  showSortMenu = false;

  selectedPrice = '';
  selectedQuantity = '';
  selectedStatus = '';
  currentPage = 1;
  itemsPerPage = 10;

  @ViewChild('fileInput')
  fileInput!: ElementRef<HTMLInputElement>;

  productImages: string[] = [];

  newProduct = this.createEmptyProduct();

  materials = [
    {
      name: '',
      quantity: 1,
      unit: '',
      note: ''
    }
  ];

  constructor(
    private router: Router,
    private adminApi: AdminApiService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadProducts();
    }
  }

  private loadProducts(): void {
    this.adminApi.getProducts().subscribe({
      next: (response) => {
        this.products = response.products.map((product) => ({
          ...product,
          selected: false
        }));
        this.rebuildProductCaches();
        this.originalProducts = [...this.products];
        this.applyCurrentView();
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Cannot load admin products', error);
        this.products = [];
        this.originalProducts = [];
        this.filteredProducts = [];
        this.rebuildProductCaches();
        this.rebuildPagedProducts();
        this.cdr.detectChanges();
      }
    });
  }

  private createEmptyProduct() {
    return {
      name: '',
      sku: this.generateProductCode(),
      description: '',
      color: '',
      style: '',
      target: '',
      flower: '',
      topic: '',
      quantity: 1,
      images: [] as string[],
      importPrice: 0,
      salePrice: 0,
      discountPrice: 0,
      recipeDescription: ''
    };
  }

  private generateProductCode(): string {
    const random = Math.floor(Math.random() * 999999);
    return 'PRD' + random.toString().padStart(6, '0');
  }

  private getPriceValue(product: AdminProduct): number {
    const cached = this.productPriceValues.get(product.sku);

    if (cached !== undefined) {
      return cached;
    }

    const value = Number(String(product.price || '').replace(/\D/g, ''));
    this.productPriceValues.set(product.sku, value);
    return value;
  }

  private applyCurrentView(): void {
    this.filterProducts(this.selectedFilter);
    if (this.searchKeyword.trim()) {
      this.searchProducts();
    }
  }

  private rebuildProductCaches(): void {
    this.productPriceValues = new Map(
      this.products.map((product) => [
        product.sku,
        Number(String(product.price || '').replace(/\D/g, ''))
      ])
    );
    this.productRatingStars = new Map(
      this.products.map((product) => [
        product.sku,
        this.createRatingStars(product)
      ])
    );
  }

  private rebuildPagedProducts(): void {
    const totalPages = this.totalPages;

    if (this.currentPage > totalPages) {
      this.currentPage = totalPages;
    }

    if (this.currentPage < 1) {
      this.currentPage = 1;
    }

    const start = (this.currentPage - 1) * this.itemsPerPage;
    this.pagedProductsValue = this.filteredProducts.slice(start, start + this.itemsPerPage);
    this.pagesValue = this.buildPages(totalPages);
  }

  private buildPages(total: number): PaginationItem[] {
    if (total <= 7) {
      return Array.from({ length: total }, (_, index) => index + 1);
    }

    let start = Math.max(2, this.currentPage - 1);
    let end = Math.min(total - 1, this.currentPage + 1);

    if (this.currentPage <= 3) {
      start = 2;
      end = 4;
    }

    if (this.currentPage >= total - 2) {
      start = total - 3;
      end = total - 1;
    }

    const pages: PaginationItem[] = [1];

    if (start > 2) {
      pages.push('ellipsis');
    }

    for (let page = start; page <= end; page++) {
      pages.push(page);
    }

    if (end < total - 1) {
      pages.push('ellipsis');
    }

    pages.push(total);
    return pages;
  }

  filterProducts(type: ProductFilter): void {
    this.selectedFilter = type;
    let nextProducts: AdminProduct[];

    switch (type) {
      case 'featured':
        nextProducts = this.products.filter((product) => product.featured);
        break;
      case 'sale':
        nextProducts = this.products.filter((product) => product.sale);
        break;
      case 'stop':
        nextProducts = this.products.filter((product) => product.statusClass === 'stop');
        break;
      default:
        nextProducts = [...this.products];
    }

    this.filteredProducts = nextProducts;
    this.currentPage = 1;
    this.rebuildPagedProducts();
  }

  get productFilterCount(): number {
    return this.getProductsForFilter(this.selectedFilter).length;
  }

  searchProducts(): void {
    const keyword = this.searchKeyword.trim().toLowerCase();
    const source = this.getProductsForFilter(this.selectedFilter);

    if (!keyword) {
      this.filterProducts(this.selectedFilter);
      return;
    }

    this.filteredProducts = source.filter((product) => {
      return product.name.toLowerCase().includes(keyword)
        || product.sku.toLowerCase().includes(keyword);
    });
    this.currentPage = 1;
    this.rebuildPagedProducts();
  }

  private getProductsForFilter(type: ProductFilter): AdminProduct[] {
    switch (type) {
      case 'featured':
        return this.products.filter((product) => product.featured);
      case 'sale':
        return this.products.filter((product) => product.sale);
      case 'stop':
        return this.products.filter((product) => product.statusClass === 'stop');
      default:
        return this.products;
    }
  }

  setSelectedStatus(status: string): void {
    const selectedProducts = this.products.filter((product) => product.selected);

    if (selectedProducts.length === 0) {
      return;
    }

    selectedProducts.forEach((product) => {
      product.status = status;
      product.statusClass = status.includes('Đang') || status.includes('Äang')
        ? 'selling'
        : 'stop';
    });

    forkJoin(
      selectedProducts.map((product) => this.adminApi.updateProductStatus(product.sku, status))
    ).subscribe({
      next: () => {
        this.showMenu = false;
        this.applyCurrentView();
      },
      error: (error) => {
        console.error('Cannot update product status', error);
        this.loadProducts();
      }
    });
  }

  deleteSelected(): void {
    const selectedProducts = this.products.filter((product) => product.selected);

    if (selectedProducts.length === 0) {
      return;
    }

    forkJoin(
      selectedProducts.map((product) => this.adminApi.deleteProduct(product.sku))
    ).subscribe({
      next: () => {
        const selectedIds = new Set(selectedProducts.map((product) => product.sku));
        this.products = this.products.filter((product) => !selectedIds.has(product.sku));
        this.originalProducts = [...this.products];
        this.rebuildProductCaches();
        this.showMenu = false;
        this.applyCurrentView();
      },
      error: (error) => {
        console.error('Cannot delete selected products', error);
        this.loadProducts();
      }
    });
  }

  editProduct(product: AdminProduct): void {
    localStorage.setItem('selectedProduct', JSON.stringify(product));
    this.router.navigate(['/products/product-detail']);
  }

  openProductDetail(product: AdminProduct): void {
    this.editProduct(product);
  }

  onProductImageError(event: Event): void {
    const image = event.target as HTMLImageElement;
    if (image.src.includes(this.fallbackProductImage)) {
      return;
    }
    image.src = this.fallbackProductImage;
  }

  ratingStars(product: AdminProduct): boolean[] {
    const cached = this.productRatingStars.get(product.sku);

    if (cached) {
      return cached;
    }

    const stars = this.createRatingStars(product);
    this.productRatingStars.set(product.sku, stars);
    return stars;
  }

  private createRatingStars(product: AdminProduct): boolean[] {
    const rating = Math.max(0, Math.min(5, Math.round(Number(product.rating || 0))));
    return Array.from({ length: 5 }, (_, index) => index < rating);
  }

  exportExcel(): void {
    const header = ['Mã sản phẩm', 'Tên sản phẩm', 'Giá bán', 'Đánh giá', 'Số lượng', 'Trạng thái'];
    const rows = this.filteredProducts.map((product) => [
      product.sku,
      product.name,
      product.price,
      product.rating,
      product.quantity,
      product.status
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'san-pham.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  deleteProduct(): void {
    if (!this.selectedProduct) {
      return;
    }

    const sku = this.selectedProduct.sku;

    this.adminApi.deleteProduct(sku).subscribe({
      next: () => {
        this.products = this.products.filter((product) => product.sku !== sku);
        this.originalProducts = [...this.products];
        this.rebuildProductCaches();
        this.selectedProduct = null;
        this.applyCurrentView();
      },
      error: (error) => {
        console.error('Cannot delete product', error);
        this.loadProducts();
      }
    });
  }

  openDeletePopup(product: AdminProduct): void {
    this.selectedProduct = product;
    this.deleteProduct();
  }

  isAllSelected(): boolean {
    return this.filteredProducts.length > 0 &&
      this.filteredProducts.every((product) => product.selected);
  }

  toggleAll(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.filteredProducts.forEach((product) => {
      product.selected = input.checked;
    });
  }

  get selectedCount(): number {
    return this.filteredProducts.filter((product) => product.selected).length;
  }

  get totalPages(): number {
    return Math.ceil(this.filteredProducts.length / this.itemsPerPage) || 1;
  }

  get pagedProducts(): AdminProduct[] {
    return this.pagedProductsValue;
  }

  get pages(): PaginationItem[] {
    return this.pagesValue;
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) {
      return;
    }

    this.currentPage = page;
    this.rebuildPagedProducts();
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.rebuildPagedProducts();
    }
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.rebuildPagedProducts();
    }
  }

  addMaterial(): void {
    this.materials.push({
      name: '',
      quantity: 1,
      unit: '',
      note: ''
    });
  }

  openCreatePopup(): void {
    this.resetForm();
    this.showCreatePopup = true;
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (!files || files.length === 0) {
      return;
    }

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = String(reader.result || '');
        this.productImages = [...this.productImages, image];
        this.newProduct.images = [...this.productImages];
      };
      reader.readAsDataURL(file);
    });

    input.value = '';
  }

  removeImage(index: number): void {
    this.productImages.splice(index, 1);
    this.productImages = [...this.productImages];
    this.newProduct.images = [...this.productImages];
  }

  saveProduct(): void {
    if (!this.newProduct.name.trim()) {
      return;
    }

    if (Number(this.newProduct.salePrice) <= 0) {
      return;
    }

    this.adminApi.createProduct({
      sku: this.newProduct.sku,
      name: this.newProduct.name.trim(),
      description: this.newProduct.description.trim(),
      color: this.newProduct.color,
      target: this.newProduct.target,
      flower: this.newProduct.flower,
      topic: this.newProduct.topic,
      importPrice: Number(this.newProduct.importPrice || 0),
      salePrice: Number(this.newProduct.salePrice),
      discountPrice: Number(this.newProduct.discountPrice || 0),
      quantity: Number(this.newProduct.quantity || 0),
      style: this.newProduct.style,
      images: [...this.productImages],
      materials: this.materials
        .map((item) => ({
          name: item.name.trim(),
          quantity: Number(item.quantity || 0),
          unit: item.unit.trim(),
          note: item.note.trim()
        }))
        .filter((item) => item.name),
      recipeDescription: this.newProduct.recipeDescription.trim()
    }).subscribe({
      next: () => {
        this.resetForm();
        this.showCreatePopup = false;
        this.loadProducts();
      },
      error: (error) => {
        console.error('Cannot create product', error);
      }
    });
  }

  resetForm(): void {
    this.productImages = [];
    this.materials = [
      {
        name: '',
        quantity: 1,
        unit: '',
        note: ''
      }
    ];
    this.newProduct = this.createEmptyProduct();
  }

  closePopup(): void {
    this.resetForm();
    this.showCreatePopup = false;
  }

  toggleFilterMenu(): void {
    this.showFilterMenu = !this.showFilterMenu;
    this.showSortMenu = false;
  }

  toggleSortMenu(): void {
    this.showSortMenu = !this.showSortMenu;
    this.showFilterMenu = false;
  }

  applyFilter(): void {
    this.filteredProducts = this.products.filter((product) => {
      let ok = true;
      const price = this.getPriceValue(product);

      if (this.selectedPrice === 'lt1000') {
        ok = ok && price < 1000000;
      }

      if (this.selectedPrice === '1000-3000') {
        ok = ok && price >= 1000000 && price <= 3000000;
      }

      if (this.selectedPrice === 'gt3000') {
        ok = ok && price > 3000000;
      }

      if (this.selectedQuantity === 'low') {
        ok = ok && product.quantity <= 5;
      }

      if (this.selectedQuantity === 'many') {
        ok = ok && product.quantity > 5;
      }

      if (this.selectedStatus) {
        ok = ok && product.status === this.selectedStatus;
      }

      return ok;
    });
    this.currentPage = 1;
    this.rebuildPagedProducts();
    this.showFilterMenu = false;
  }

  resetFilter(): void {
    this.selectedPrice = '';
    this.selectedQuantity = '';
    this.selectedStatus = '';
    this.filterProducts(this.selectedFilter);
  }

  sortPriceAsc(): void {
    this.filteredProducts.sort((a, b) => this.getPriceValue(a) - this.getPriceValue(b));
    this.rebuildPagedProducts();
    this.showSortMenu = false;
  }

  sortPriceDesc(): void {
    this.filteredProducts.sort((a, b) => this.getPriceValue(b) - this.getPriceValue(a));
    this.rebuildPagedProducts();
    this.showSortMenu = false;
  }

  sortQuantityAsc(): void {
    this.filteredProducts.sort((a, b) => a.quantity - b.quantity);
    this.rebuildPagedProducts();
    this.showSortMenu = false;
  }

  sortQuantityDesc(): void {
    this.filteredProducts.sort((a, b) => b.quantity - a.quantity);
    this.rebuildPagedProducts();
    this.showSortMenu = false;
  }

  sortStatus(): void {
    this.filteredProducts.sort((a, b) => a.status.localeCompare(b.status, 'vi'));
    this.rebuildPagedProducts();
    this.showSortMenu = false;
  }

  resetSort(): void {
    this.filterProducts(this.selectedFilter);
    this.showSortMenu = false;
  }

  clearFilter(): void {
    this.resetFilter();
    this.showFilterMenu = false;
  }

  trackByProductSku(_index: number, product: AdminProduct): string {
    return product.sku;
  }

  trackByRatingIndex(index: number): number {
    return index;
  }

  trackByPage(_index: number, page: PaginationItem): PaginationItem {
    return page;
  }

  trackByIndex(index: number): number {
    return index;
  }
}
