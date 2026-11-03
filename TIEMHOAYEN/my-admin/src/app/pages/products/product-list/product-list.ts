import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, HostListener, Inject, OnInit, PLATFORM_ID, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AdminApiService, AdminProduct } from '../../../services/admin-api.service';

type ProductFilter = 'all' | 'featured' | 'sale' | 'stop';
type PaginationItem = number | 'ellipsis';
type ProductMultiField = 'colors' | 'targets' | 'flowers' | 'collections';
type ProductSingleField = 'style' | 'topic';
type ProductDropdownField = ProductMultiField | ProductSingleField;

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './product-list.html',
  styleUrl: './product-list.css'
})
export class ProductList implements OnInit {
  readonly fallbackProductImage = 'assets/images/logo-main.png';
  searchKeyword = '';
  selectedFilter: ProductFilter = 'all';
  filteredProducts: AdminProduct[] = [];
  originalProducts: AdminProduct[] = [];
  products: AdminProduct[] = [];
  private pagedProductsValue: AdminProduct[] = [];
  private pagesValue: PaginationItem[] = [1];
  private productPriceValues = new Map<string, number>();
  private productRatingStars = new Map<AdminProduct, number[]>();

  selectedProduct: AdminProduct | null = null;
  showMenu = false;
  showCreatePopup = false;
  showFilterMenu = false;
  showSortMenu = false;
  showPreview = false;

  selectedPrice = '';
  selectedQuantity = '';
  selectedStatus = '';
  currentPage = 1;
  itemsPerPage = 10;

  @ViewChild('fileInput')
  fileInput!: ElementRef<HTMLInputElement>;

  productImages: string[] = [];
  formError = '';
  savingProduct = false;
  categoryOptionsLoading = false;
  categoryOptionsError = '';
  colorOptions: string[] = [];
  styleOptions: string[] = [];
  targetOptions: string[] = [];
  flowerOptions: string[] = [];
  topicOptions: string[] = [];
  collectionOptions: string[] = [];
  serverNextSku = '';
  nextCodeReservation: { code: string; token: string } | null = null;
  private codeReservationLoading = false;
  productCodeError = '';
  openMultiSelect: ProductDropdownField | null = null;

  newProduct = this.createEmptyProduct();

  @HostListener('document:click')
  closeMultiSelect(): void {
    this.openMultiSelect = null;
  }

  toggleMultiSelect(field: ProductDropdownField, event: Event): void {
    event.stopPropagation();
    if (this.categoryOptionsLoading) return;
    this.openMultiSelect = this.openMultiSelect === field ? null : field;
  }

  toggleMultiValue(field: ProductMultiField, value: string, event: Event): void {
    event.stopPropagation();
    const selected = this.newProduct[field];
    this.newProduct[field] = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value];
  }

  isMultiValueSelected(field: ProductMultiField, value: string): boolean {
    return this.newProduct[field].includes(value);
  }

  selectSingleValue(field: ProductSingleField, value: string, event: Event): void {
    event.stopPropagation();
    this.newProduct[field] = value;
    this.openMultiSelect = null;
  }

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
      this.loadCategoryOptions();
    }
  }

  loadCategoryOptions(): void {
    this.categoryOptionsLoading = true;
    this.categoryOptionsError = '';
    forkJoin({
      colors: this.adminApi.getCategories('color'),
      styles: this.adminApi.getCategories('style'),
      targets: this.adminApi.getCategories('target'),
      flowers: this.adminApi.getCategories('flower'),
      topics: this.adminApi.getCategories('topic'),
      collections: this.adminApi.getCategories('collection')
    }).subscribe({
      next: (result) => {
        const names = (items: Array<{ name: string; status?: string }>) => Array.from(new Set(items
          .filter((item) => item.status !== 'Đang ẩn')
          .map((item) => item.name?.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'vi'));
        this.colorOptions = names(result.colors.categories);
        this.styleOptions = names(result.styles.categories);
        this.targetOptions = names(result.targets.categories);
        this.flowerOptions = names(result.flowers.categories);
        this.topicOptions = names(result.topics.categories);
        this.collectionOptions = names(result.collections.categories);
        this.categoryOptionsLoading = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Cannot load product category options', error);
        this.categoryOptionsLoading = false;
        this.categoryOptionsError = 'Không tải được danh mục từ database.';
        this.cdr.detectChanges();
      }
    });
  }

  private loadProducts(): void {
    this.adminApi.getProducts().subscribe({
      next: (response) => {
        this.products = response.products.filter(Boolean).map((product) => {
          const source = product as any;
          const originalPrice = Number(source.salePrice ?? source.GIA ?? 0);
          const discountPrice = Number(source.discountPrice ?? source.GIA_KHUYEN_MAI ?? 0);
          const finalPrice = discountPrice > 0 && discountPrice < originalPrice ? discountPrice : originalPrice;
          const status = String(source.status ?? source.TRANG_THAI ?? 'Ngừng bán');
          const quantity = Number(source.quantity ?? source.TON_THANH_PHAM ?? source.SO_LUONG ?? 0);
          return ({
          ...source,
          name: String(source.name ?? source.TEN_SAN_PHAM ?? ''),
          sku: String(source.sku ?? source.code ?? source.id ?? source.SAN_PHAM_ID ?? ''),
          price: source.price ?? `${finalPrice.toLocaleString('vi-VN')}đ`,
          rating: Number(source.rating ?? source.averageRating ?? source.avgRating ?? source.AVG_RATING ?? 0),
          quantity,
          status,
          statusClass: source.statusClass ?? (status === 'Đang bán' ? 'selling' : status === 'Đã xóa' ? 'deleted' : 'stop'),
          featured: Boolean(source.featured ?? Number(source.DA_BAN || 0) > 0),
          sale: Boolean(source.sale ?? (discountPrice > 0 && discountPrice < originalPrice)),
          image: String(source.name ?? source.TEN_SAN_PHAM ?? '').trim().toLocaleLowerCase('vi-VN') === 'túi quà cao cấp'
            ? 'assets/images/tui-qua-cao-cap.png'
            : String(source.image ?? source.HINH_ANH ?? ''),
          selected: false
        } as AdminProduct);
        });
        this.rebuildProductCaches();
        this.originalProducts = [...this.products];
        this.applyCurrentView();
        if (response.nextCode) {
          this.serverNextSku = response.nextCode;
        }
        this.prepareNextProductCode();
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
      sku: '',
      codeReservationToken: '',
      description: '',
      colors: [] as string[],
      style: '',
      targets: [] as string[],
      flowers: [] as string[],
      collections: [] as string[],
      topic: '',
      quantity: 0,
      images: [] as string[],
      importPrice: 0,
      salePrice: 0,
      discountPrice: 0,
      recipeDescription: ''
    };
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
        product,
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
        nextProducts = this.products.filter((product) => product.statusClass !== 'selling');
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
        return this.products.filter((product) => product.statusClass !== 'selling');
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
        this.showMenu = false;
        this.loadProducts();
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

  ratingStars(product: AdminProduct): number[] {
    const cached = this.productRatingStars.get(product);

    if (cached) {
      return cached;
    }

    const stars = this.createRatingStars(product);
    this.productRatingStars.set(product, stars);
    return stars;
  }

  private createRatingStars(product: AdminProduct): number[] {
    const rating = Math.max(0, Math.min(5, Number(product.rating || 0)));
    return Array.from({ length: 5 }, (_, index) => {
      return Math.max(0, Math.min(100, (rating - index) * 100));
    });
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
        this.selectedProduct = null;
        this.loadProducts();
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
    if (!this.nextCodeReservation) {
      this.productCodeError = 'Đang lấy mã sản phẩm từ database.';
      this.prepareNextProductCode();
      return;
    }
    this.resetForm();
    this.newProduct.sku = this.nextCodeReservation.code;
    this.newProduct.codeReservationToken = this.nextCodeReservation.token;
    this.nextCodeReservation = null;
    this.productCodeError = '';
    this.formError = '';
    this.showCreatePopup = true;
    if (this.categoryOptionsError) this.loadCategoryOptions();

    this.prepareNextProductCode();
  }

  private prepareNextProductCode(): void {
    if (this.nextCodeReservation || this.codeReservationLoading) return;
    this.codeReservationLoading = true;
    this.adminApi.reserveProductCode().subscribe({
      next: (res) => {
        this.codeReservationLoading = false;
        if (res?.code) {
          this.serverNextSku = res.code;
          this.nextCodeReservation = { code: res.code, token: res.token };
          this.productCodeError = '';
        }
      },
      error: () => { this.codeReservationLoading = false; this.productCodeError = 'Không lấy được mã sản phẩm từ database.'; }
    });
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (!files || files.length === 0) {
      return;
    }

    const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    Array.from(files).forEach((file) => {
      if (!acceptedTypes.has(file.type) || file.size > 5 * 1024 * 1024) {
        this.formError = 'Chỉ chấp nhận ảnh JPG, PNG, WEBP và tối đa 5 MB mỗi ảnh.';
        return;
      }
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

  moveCreateImage(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= this.productImages.length) return;
    [this.productImages[index], this.productImages[target]] = [this.productImages[target], this.productImages[index]];
    this.productImages = [...this.productImages];
    this.newProduct.images = [...this.productImages];
  }

  saveProduct(): void {
    this.formError = '';
    if (!this.newProduct.name.trim()) {
      this.formError = 'Tên sản phẩm là bắt buộc.';
      return;
    }

    if (Number(this.newProduct.salePrice) <= 0) {
      this.formError = 'Giá bán phải lớn hơn 0.';
      return;
    }
    if (Number(this.newProduct.discountPrice) > 0 && Number(this.newProduct.discountPrice) >= Number(this.newProduct.salePrice)) {
      this.formError = 'Giá khuyến mãi phải nhỏ hơn giá bán.';
      return;
    }
    if (!this.newProduct.topic && !this.newProduct.colors.length && !this.newProduct.targets.length && !this.newProduct.flowers.length && !this.newProduct.collections.length) {
      this.formError = 'Vui lòng chọn ít nhất một danh mục.';
      return;
    }
    if (!this.productImages.length) {
      this.formError = 'Vui lòng thêm ít nhất một ảnh.';
      return;
    }
    if (!/^SP\d+$/i.test(this.newProduct.sku)) {
      this.formError = 'Mã sản phẩm chưa sẵn sàng. Vui lòng đóng form và mở lại.';
      return;
    }

    this.savingProduct = true;
    this.adminApi.createProduct({
      sku: this.newProduct.sku,
      reservedCode: this.newProduct.sku,
      codeReservationToken: this.newProduct.codeReservationToken,
      name: this.newProduct.name.trim(),
      description: this.newProduct.description.trim(),
      colors: this.newProduct.colors,
      targets: this.newProduct.targets,
      flowers: this.newProduct.flowers,
      collections: this.newProduct.collections,
      topic: this.newProduct.topic,
      importPrice: Number(this.newProduct.importPrice || 0),
      salePrice: Number(this.newProduct.salePrice),
      discountPrice: Number(this.newProduct.discountPrice || 0),
      style: this.newProduct.style,
      images: this.productImages.map((url, index) => ({ url, isPrimary: index === 0, sortOrder: index })),
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
      next: (response) => {
        this.savingProduct = false;
        this.resetForm();
        this.showCreatePopup = false;
        this.serverNextSku = '';
        this.loadProducts();
      },
      error: (error) => {
        this.savingProduct = false;
        console.error('Cannot create product', error);
        this.formError = error?.error?.message || 'Không thể tạo sản phẩm.';
      }
    });
  }

  resetForm(): void {
    this.formError = '';
    this.savingProduct = false;
    this.productImages = [];
    this.openMultiSelect = null;
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

  sortRatingAsc(): void {
    this.filteredProducts.sort((a, b) => Number(a.rating || 0) - Number(b.rating || 0));
    this.rebuildPagedProducts();
    this.showSortMenu = false;
  }

  sortRatingDesc(): void {
    this.filteredProducts.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
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

  trackByProductSku(index: number, product: AdminProduct): string {
    return product.sku || `${product.name}-${index}`;
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
