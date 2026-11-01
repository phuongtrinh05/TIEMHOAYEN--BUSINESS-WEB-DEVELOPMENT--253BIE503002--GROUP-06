import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminApiService, AdminCategory, AdminProduct } from '../../../services/admin-api.service';

type CategoryTab = 'topic' | 'target' | 'style' | 'color' | 'collection';

@Component({
  selector: 'app-category-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './category-list.html',
  styleUrl: './category-list.css'
})
export class CategoryList implements OnInit {
  searchKeyword = '';
  activeTab: CategoryTab = 'topic';
  categories: AdminCategory[] = [];
  filteredCategories: AdminCategory[] = [];
  originalCategories: AdminCategory[] = [];
  sortType = 'sku';
  showAddPopup = false;
  showDeletePopup = false;
  selectedCategory: AdminCategory | null = null;
  newCategoryName = '';
  newCategoryDescription = '';
  newCategoryImage = '';
  showDetailPopup = false;
  detailLoading = false;
  savingDetail = false;
  detailError = '';
  detailCategory: AdminCategory | null = null;
  detailProducts: AdminProduct[] = [];
  allProducts: AdminProduct[] = [];
  selectedProductIds = new Set<string>();
  detailProductSearch = '';
  showAllProductsInDetail = false;
  sortAscending = true;
  showSortMenu = false;
  currentPage = 1;
  itemsPerPage = 10;

  constructor(
    private adminApi: AdminApiService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadCategories();
    }
  }

  get categoryTitle(): string {
    switch (this.activeTab) {
      case 'topic':
        return 'Chủ đề';
      case 'target':
        return 'Đối tượng';
      case 'style':
        return 'Kiểu dáng';
      case 'color':
        return 'Màu sắc';
      case 'collection':
        return 'Bộ sưu tập';
      default:
        return 'Chủ đề';
    }
  }

  private loadCategories(): void {
    this.adminApi.getCategories(this.activeTab).subscribe({
      next: (response) => {
        this.categories = response.categories.map((category) => ({
          ...category,
          selected: false
        }));
        this.originalCategories = [...this.categories];
        this.filteredCategories = [...this.categories];
        this.currentPage = 1;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Cannot load admin categories', error);
        this.filteredCategories = [...this.categories];
        this.cdr.detectChanges();
      }
    });
  }

  isAllSelected(): boolean {
    return this.filteredCategories.length > 0 &&
      this.filteredCategories.every((category) => category.selected);
  }

  toggleAll(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.filteredCategories.forEach((category) => {
      category.selected = input.checked;
    });
  }

  get selectedCount(): number {
    return this.filteredCategories.filter((category) => category.selected).length;
  }

  changeTab(tab: string): void {
    this.activeTab = tab as CategoryTab;
    this.searchKeyword = '';
    this.showSortMenu = false;
    this.loadCategories();
  }

  searchCategory(): void {
    const keyword = this.searchKeyword.trim().toLowerCase();

    if (!keyword) {
      this.filteredCategories = [...this.categories];
      return;
    }

    this.filteredCategories = this.categories.filter((category) => {
      return category.name.toLowerCase().includes(keyword)
        || category.code.toLowerCase().includes(keyword);
    });
    this.currentPage = 1;
  }

  sortCategory(): void {
    this.filteredCategories.sort((a, b) => {
      return this.sortAscending
        ? a.name.localeCompare(b.name, 'vi')
        : b.name.localeCompare(a.name, 'vi');
    });
    this.sortAscending = !this.sortAscending;
  }

  openAddPopup(): void {
    this.newCategoryName = '';
    this.newCategoryDescription = '';
    this.newCategoryImage = '';
    this.showAddPopup = true;
  }

  addCategory(): void {
    const name = this.newCategoryName.trim();

    if (!name) {
      return;
    }

    if (this.activeTab === 'style') {
      alert('Kiểu dáng được lấy từ sản phẩm. Bạn sửa kiểu dáng trong chi tiết sản phẩm nha.');
      return;
    }

    this.adminApi.createCategory(this.activeTab, {
      name,
      description: this.newCategoryDescription,
      image: this.newCategoryImage
    }).subscribe({
      next: (response) => {
        this.categories = [
          response.category,
          ...this.categories
        ];
        this.originalCategories = [...this.categories];
        this.filteredCategories = [...this.categories];
        this.showAddPopup = false;
        this.currentPage = 1;
      },
      error: (error) => {
        console.error('Cannot create category', error);
        alert('Không thể thêm danh mục. Vui lòng thử lại.');
      }
    });
  }

  openDetail(category: AdminCategory): void {
    this.showDetailPopup = true;
    this.detailLoading = true;
    this.detailError = '';
    this.detailProductSearch = '';
    this.showAllProductsInDetail = false;
    this.adminApi.getCategoryDetail(this.activeTab, category.code).subscribe({
      next: (detail) => {
        this.detailCategory = { ...detail.category };
        this.detailProducts = detail.products.map((product) => this.normalizeProduct(product));
        this.allProducts = [...this.detailProducts];
        this.selectedProductIds = new Set(this.detailProducts.map((product) => product.sku));
        this.detailLoading = false;
        this.cdr.detectChanges();
        this.adminApi.getProducts().subscribe({
          next: (products) => {
            const normalizedAll = products.products
              .map((product) => this.normalizeProduct(product))
              .filter((product) => product.status !== 'Đã xóa' && Boolean(product.sku));
            const merged = new Map(normalizedAll.map((product) => [product.sku, product]));
            this.detailProducts.forEach((product) => merged.set(product.sku, { ...merged.get(product.sku), ...product }));
            this.allProducts = [...merged.values()];
            this.cdr.detectChanges();
          }
        });
      },
      error: (error) => {
        this.detailLoading = false;
        this.detailError = error?.error?.message || 'Không thể tải chi tiết danh mục.';
        this.cdr.detectChanges();
      }
    });
  }

  private normalizeProduct(product: AdminProduct | any): AdminProduct {
    const sku = String(product?.sku || product?.code || product?.id || product?.SAN_PHAM_ID || '').trim();
    return {
      image: String(product?.image || product?.HINH_ANH || ''),
      name: String(product?.name || product?.TEN_SAN_PHAM || sku),
      sku,
      price: String(product?.price ?? product?.salePrice ?? product?.GIA ?? ''),
      rating: Number(product?.rating || 0),
      quantity: Number(product?.quantity ?? product?.SO_LUONG ?? 0),
      featured: Boolean(product?.featured),
      sale: Boolean(product?.sale || Number(product?.discountPrice || product?.GIA_KHUYEN_MAI || 0) > 0),
      status: String(product?.status || product?.TRANG_THAI || ''),
      statusClass: String(product?.statusClass || ''),
      selected: Boolean(product?.selected)
    };
  }

  get selectableProducts(): AdminProduct[] {
    const keyword = this.detailProductSearch.trim().toLowerCase();
    const source = this.showAllProductsInDetail
      ? this.allProducts
      : this.allProducts.filter((product) => this.selectedProductIds.has(product.sku));
    if (!keyword) return source;
    return source.filter((product) =>
      product.name.toLowerCase().includes(keyword) || product.sku.toLowerCase().includes(keyword));
  }

  toggleDetailProduct(productId: string, checked: boolean): void {
    if (checked) this.selectedProductIds.add(productId);
    else this.selectedProductIds.delete(productId);
  }

  saveDetail(): void {
    if (!this.detailCategory || this.savingDetail) return;
    this.savingDetail = true;
    this.detailError = '';
    this.adminApi.updateCategory(this.activeTab, this.detailCategory.code, {
      name: this.detailCategory.name,
      description: this.detailCategory.description || '',
      image: this.detailCategory.image || '',
      status: this.detailCategory.status || 'Đang hiển thị',
      productIds: [...this.selectedProductIds]
    }).subscribe({
      next: () => {
        this.savingDetail = false;
        this.showDetailPopup = false;
        this.loadCategories();
      },
      error: (error) => {
        this.savingDetail = false;
        this.detailError = error?.error?.message || 'Không thể lưu danh mục.';
      }
    });
  }

  openProduct(product: AdminProduct): void {
    this.router.navigate(['/products/product-detail'], { queryParams: { id: product.sku } });
  }

  openDeletePopup(category: AdminCategory): void {
    this.selectedCategory = category;
    this.showDeletePopup = true;
  }

  deleteCategory(): void {
    if (!this.selectedCategory) {
      return;
    }

    if (this.activeTab === 'style') {
      alert('Kiểu dáng được lấy từ sản phẩm nên không xóa trực tiếp tại đây.');
      this.showDeletePopup = false;
      return;
    }

    const categoryId = this.selectedCategory.code;

    this.adminApi.deleteCategory(this.activeTab, categoryId).subscribe({
      next: () => {
        this.showDeletePopup = false;
        this.selectedCategory = null;
        this.loadCategories();
      },
      error: (error) => {
        console.error('Cannot delete category', error);
        alert('Không thể xóa danh mục này. Có thể đang có sản phẩm sử dụng danh mục.');
        this.showDeletePopup = false;
      }
    });
  }

  get totalPages(): number {
    return Math.ceil(this.filteredCategories.length / this.itemsPerPage) || 1;
  }

  get pagedCategories(): AdminCategory[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredCategories.slice(start, start + this.itemsPerPage);
  }

  get pages(): number[] {
    return Array.from({ length: this.totalPages }, (_, index) => index + 1);
  }

  goToPage(page: number): void {
    this.currentPage = page;
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  toggleSortMenu(): void {
    this.showSortMenu = !this.showSortMenu;
  }

  sortSkuAsc(): void {
    this.filteredCategories.sort((a, b) => a.code.localeCompare(b.code, 'vi'));
    this.showSortMenu = false;
  }

  sortSkuDesc(): void {
    this.filteredCategories.sort((a, b) => b.code.localeCompare(a.code, 'vi'));
    this.showSortMenu = false;
  }

  sortQuantityAsc(): void {
    this.filteredCategories.sort((a, b) => a.total - b.total);
    this.showSortMenu = false;
  }

  sortQuantityDesc(): void {
    this.filteredCategories.sort((a, b) => b.total - a.total);
    this.showSortMenu = false;
  }

  resetSort(): void {
    this.filteredCategories = [...this.originalCategories];
    this.showSortMenu = false;
  }
}
