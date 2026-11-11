import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, Inject, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  AdminApiService,
  AdminProductDetailForm,
  AdminProductRecipeItem,
  AdminProductReview
} from '../../../services/admin-api.service';
import { InventoryApiService } from '../../../services/inventory-api.service';

type ProductMultiField = 'colors' | 'targets' | 'flowers' | 'collections';
type ProductSingleField = 'style' | 'topic';
type ProductDropdownField = ProductMultiField | ProductSingleField;

@Component({
  selector: 'app-product-detail',
  imports: [CommonModule, FormsModule],
  standalone: true,
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.css',
})
export class ProductDetail implements OnInit {
  private readonly publishedStatus = '\u0110ang b\u00e1n';
  private readonly unpublishedStatus = 'Ng\u1eebng b\u00e1n';
  private readonly deletedStatus = 'Đã xóa';

  isPublished = true;
  isEditing = false;
  statusSaving = false;
  productImages: string[] = [];
  selectedRating = 'all';
  selectedPeriod = 'all';
  sortType = 'newest';
  currentReviewPage = 1;
  currentPage = 1;
  itemsPerPage = 3;
  searchKeyword = '';
  loading = false;
  openCategorySelect: ProductDropdownField | null = null;

  colors: string[] = [];
  styles: string[] = [];
  targets: string[] = [];
  topics: string[] = [];
  flowers: string[] = [];
  collections: string[] = [];
  materialOptions: AdminProductRecipeItem[] = [];

  materials: AdminProductRecipeItem[] = [];
  filteredMaterials: AdminProductRecipeItem[] = [];

  product: AdminProductDetailForm = this.emptyProduct();

  @HostListener('document:click')
  closeCategorySelect(): void {
    this.openCategorySelect = null;
  }

  toggleCategorySelect(field: ProductDropdownField, event: Event): void {
    event.stopPropagation();
    this.openCategorySelect = this.openCategorySelect === field ? null : field;
  }

  toggleCategoryValue(field: ProductMultiField, value: string, event: Event): void {
    event.stopPropagation();
    const selected = this.product[field];
    this.product[field] = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value];
  }

  isCategoryValueSelected(field: ProductMultiField, value: string): boolean {
    return this.product[field].includes(value);
  }

  selectCategoryValue(field: ProductSingleField, value: string, event: Event): void {
    event.stopPropagation();
    this.product[field] = value;
    this.openCategorySelect = null;
  }

  reviews: AdminProductReview[] = [];
  filteredReviews: AdminProductReview[] = [];
  ratingSummary = [
    { star: 5, count: 0, percent: 0 },
    { star: 4, count: 0, percent: 0 },
    { star: 3, count: 0, percent: 0 },
    { star: 2, count: 0, percent: 0 },
    { star: 1, count: 0, percent: 0 }
  ];
  averageRating = 0;
  reviewCount = 0;

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly adminApi: AdminApiService,
    private readonly cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private readonly platformId: object
  ) {}

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const productId = this.getSelectedProductId();
    if (!productId) {
      return;
    }

    this.loadProductDetail(productId);
  }

  private emptyProduct(): AdminProductDetailForm {
    return {
      name: '',
      code: '',
      note: '',
      color: '',
      colors: [],
      style: '',
      target: '',
      targets: [],
      topic: '',
      flower: '',
      flowers: [],
      collections: [],
      quantity: 1,
      status: 'Đang bán',
      isPublished: true,
      images: [],
      importPrice: 0,
      salePrice: 0,
      discountPrice: 0,
      recipe: ''
    };
  }

  // ===== XUẤT BỎ THÀNH PHẨM HỎNG =====
  // Admin tự kiểm tra bó thực tế; bó héo/hỏng thì bấm "Xuất bỏ" để trừ khỏi tồn thành phẩm.
  // Chỉ xuất bỏ được phần khả dụng (bó đang giữ cho đơn không bị trừ).
  private readonly inventoryApi = inject(InventoryApiService);
  disposeTarget: { id: string; name: string; available: number } | null = null;
  disposeQty = 1;
  disposeNote = 'Bó héo/hỏng, không còn đạt chất lượng';
  disposeBusy = false;
  disposeError = '';
  disposeMessage = '';

  get canDisposeFinished(): boolean { return this.adminApi.can('materials', 'update'); }

  openDispose(id: string, name: string, available: number, event?: Event): void {
    event?.stopPropagation();
    this.disposeTarget = { id, name, available: Math.max(0, Math.floor(Number(available) || 0)) };
    this.disposeQty = 1;
    this.disposeNote = 'Bó héo/hỏng, không còn đạt chất lượng';
    this.disposeError = '';
  }

  closeDispose(): void {
    if (this.disposeBusy) return;
    this.disposeTarget = null;
  }

  confirmDispose(): void {
    const target = this.disposeTarget;
    if (!target || this.disposeBusy) return;
    const qty = Math.floor(Number(this.disposeQty));
    if (!Number.isInteger(qty) || qty < 1 || qty > target.available) { this.disposeError = `Nhập số bó từ 1 đến ${target.available}.`; return; }
    const note = String(this.disposeNote || '').trim();
    if (!note) { this.disposeError = 'Vui lòng nhập lý do xuất bỏ.'; return; }
    this.disposeBusy = true;
    this.disposeError = '';
    this.inventoryApi.disposeFinished(target.id, qty, note).subscribe({
      next: () => {
        this.disposeBusy = false;
        this.disposeTarget = null;
        this.disposeMessage = `Đã xuất bỏ ${qty} bó "${target.name}".`;
        this.afterDispose(target.id);
        this.cdr.detectChanges();
      },
      error: (error) => {
        this.disposeBusy = false;
        this.disposeError = error?.error?.message || 'Không xuất bỏ được. Vui lòng thử lại.';
        this.cdr.detectChanges();
      },
    });
  }

  private afterDispose(productId: string): void { this.loadProductDetail(productId); }

  private getSelectedProductId(): string {
    const queryProductId = this.route.snapshot.queryParamMap.get('id')?.trim();
    if (queryProductId) {
      return queryProductId;
    }

    const raw = localStorage.getItem('selectedProduct');
    if (!raw) {
      return '';
    }

    try {
      const selectedProduct = JSON.parse(raw);
      return selectedProduct?.sku || selectedProduct?.code || '';
    } catch {
      return '';
    }
  }

  private loadProductDetail(productId: string): void {
    this.loading = true;
    forkJoin({
      detail: this.adminApi.getProductDetail(productId),
      colors: this.adminApi.getCategories('color'),
      styles: this.adminApi.getCategories('style'),
      targets: this.adminApi.getCategories('target'),
      topics: this.adminApi.getCategories('topic'),
      flowers: this.adminApi.getCategories('flower'),
      collections: this.adminApi.getCategories('collection')
    }).subscribe({
      next: (result) => {
        const data = result.detail;
        const names = (items: Array<{ name: string; status?: string }>) => items
          .filter((item) => item.status !== 'Đang ẩn')
          .map((item) => item.name).filter(Boolean);
        const loadedProduct = data.product || this.emptyProduct();
        this.product = {
          ...this.emptyProduct(),
          ...loadedProduct,
          colors: [...(loadedProduct.colors || (loadedProduct.color ? [loadedProduct.color] : []))],
          targets: [...(loadedProduct.targets || (loadedProduct.target ? [loadedProduct.target] : []))],
          flowers: [...(loadedProduct.flowers || (loadedProduct.flower ? [loadedProduct.flower] : []))],
          collections: [...(loadedProduct.collections || [])],
          images: this.normalizeProductImages(loadedProduct.images || [])
        };
        this.product.status = this.normalizeProductStatus(this.product.status);
        this.product.isPublished = this.product.status === this.publishedStatus;

        this.colors = this.withCurrentValues(names(result.colors.categories), this.product.colors);
        this.styles = this.withCurrentValue(names(result.styles.categories), this.product.style);
        this.targets = this.withCurrentValues(names(result.targets.categories), this.product.targets);
        this.topics = this.withCurrentValue(names(result.topics.categories), this.product.topic);
        this.flowers = this.withCurrentValues(names(result.flowers.categories), this.product.flowers);
        this.collections = this.withCurrentValues(names(result.collections.categories), this.product.collections);
        this.materialOptions = data.options?.materials || [];

        this.materials = data.materials || [];
        this.filteredMaterials = [...this.materials];

        this.reviews = data.reviews || [];
        this.filteredReviews = [...this.reviews];
        this.ratingSummary = data.ratingSummary || this.ratingSummary;
        this.averageRating = Number(data.averageRating || 0);
        this.reviewCount = Number(data.reviewCount || 0);
        this.currentPage = 1;
        this.loading = false;
        this.cdr.detectChanges();

        this.adminApi.getProductClassifications(productId).subscribe({
          next: (classification) => {
            if (!classification.found) return;
            this.product.colors = [...classification.colors];
            this.product.targets = [...classification.targets];
            this.product.flowers = [...classification.flowers];
            this.product.collections = [...classification.collections];
            this.product.topic = classification.topic;
            if (classification.primaryImage) {
              const images = this.normalizeProductImages(this.product.images);
              const primaryIndex = images.findIndex((image) => image.url === classification.primaryImage);
              if (primaryIndex < 0) images.unshift({ url: classification.primaryImage, isPrimary: true, sortOrder: 0 });
              this.product.images = images.map((image, index) => ({
                ...image,
                isPrimary: image.url === classification.primaryImage,
                sortOrder: index
              })).sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.sortOrder - right.sortOrder);
            }
            this.colors = this.withCurrentValues(this.colors, this.product.colors);
            this.targets = this.withCurrentValues(this.targets, this.product.targets);
            this.flowers = this.withCurrentValues(this.flowers, this.product.flowers);
            this.collections = this.withCurrentValues(this.collections, this.product.collections);
            this.topics = this.withCurrentValue(this.topics, this.product.topic);
            this.cdr.detectChanges();
          }
        });
      },
      error: (error) => {
        console.error('Cannot load product detail', error);
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  private withCurrentValue(list: string[], value: string): string[] {
    const cleanList = Array.from(new Set((list || []).filter(Boolean)));
    if (value && !cleanList.includes(value)) {
      cleanList.unshift(value);
    }

    return cleanList;
  }

  private normalizeProductImages(images: AdminProductDetailForm['images']): AdminProductDetailForm['images'] {
    const unique = new Map<string, AdminProductDetailForm['images'][number]>();
    for (const image of images || []) {
      const url = String(image?.url || '').trim();
      if (!url || unique.has(url)) continue;
      unique.set(url, { url, isPrimary: Boolean(image.isPrimary), sortOrder: Number(image.sortOrder || 0) });
    }
    return [...unique.values()].sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.sortOrder - right.sortOrder);
  }

  private withCurrentValues(list: string[], values: string[]): string[] {
    return Array.from(new Set([...(list || []), ...(values || [])].filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'vi'));
  }

  formatReviewDate(value: string): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleDateString('vi-VN')} • ${date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  }

  deleteMaterial(index: number): void {
    this.materials.splice(index, 1);
    this.filteredMaterials = [...this.materials];
  }

  changePage(page: number): void {
    this.currentReviewPage = page;
  }

  toggleEdit(): void {
    this.isEditing = !this.isEditing;
    this.openCategorySelect = null;
  }

  toggleStatus(): void {
    const nextStatus = this.product.isPublished
      ? this.publishedStatus
      : this.unpublishedStatus;
    const previousStatus = this.product.status;
    const previousPublished = previousStatus === this.publishedStatus;

    this.product.status = nextStatus;

    if (!this.product.code) {
      return;
    }

    this.statusSaving = true;
    this.adminApi.updateProductStatus(this.product.code, nextStatus).subscribe({
      next: () => {
        this.product.status = nextStatus;
        this.product.isPublished = nextStatus === this.publishedStatus;
        this.statusSaving = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Cannot update product status', error);
        this.product.status = previousStatus;
        this.product.isPublished = previousPublished;
        this.statusSaving = false;
        this.cdr.detectChanges();
      }
    });
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;

    Array.from(input.files).forEach((file) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        this.product.images.push({
          url: reader.result as string,
          isPrimary: this.product.images.length === 0,
          sortOrder: this.product.images.length
        });
      };
      reader.readAsDataURL(file);
    });
  }

  removeImage(index: number): void {
    const wasPrimary = this.product.images[index]?.isPrimary;
    this.product.images.splice(index, 1);
    if (wasPrimary && this.product.images.length) this.product.images[0].isPrimary = true;
    this.product.images.forEach((image, imageIndex) => image.sortOrder = imageIndex);
  }

  setPrimaryImage(index: number): void {
    this.product.images.forEach((image, imageIndex) => image.isPrimary = imageIndex === index);
  }

  moveImage(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= this.product.images.length) return;
    [this.product.images[index], this.product.images[target]] = [this.product.images[target], this.product.images[index]];
    this.product.images.forEach((image, imageIndex) => image.sortOrder = imageIndex);
  }

  /* ===== Công thức hoa: ô tìm kiếm dùng để chọn NVL thêm vào BOM (chỉ khi Chỉnh sửa) ===== */
  pickerOpen = false;
  materialSuggestions: AdminProductRecipeItem[] = [];
  saveError = '';

  onMaterialSearch(): void {
    const key = this.removeVietnameseTones(this.searchKeyword.toLowerCase().trim());
    const used = new Set(this.materials.map(item => item.code));
    this.materialSuggestions = !key ? [] : this.materialOptions
      .filter(item => !used.has(item.code))
      .filter(item => this.removeVietnameseTones(`${item.name || ''} ${item.code || ''}`.toLowerCase()).includes(key))
      .slice(0, 8);
    this.pickerOpen = true;
  }

  closePickerSoon(): void {
    setTimeout(() => { this.pickerOpen = false; this.cdr.detectChanges(); }, 150);
  }

  addFirstSuggestion(event: Event): void {
    event.preventDefault();
    if (this.materialSuggestions.length) this.addMaterialOption(this.materialSuggestions[0]);
  }

  addMaterialOption(option: AdminProductRecipeItem): void {
    if (!this.isEditing || this.materials.some(item => item.code === option.code)) return;
    const nextId = this.materials.length ? Math.max(...this.materials.map(item => item.id || 0)) + 1 : 1;
    this.materials = [...this.materials, {
      id: nextId, image: option.image || '', name: option.name || '', code: option.code || '',
      quantity: 1, unit: option.unit || '', note: '', importPrice: option.importPrice || 0,
    }];
    this.filteredMaterials = [...this.materials];
    this.searchKeyword = '';
    this.materialSuggestions = [];
    this.pickerOpen = false;
    this.recalculateImportPrice();
  }

  onRecipeChanged(): void { this.recalculateImportPrice(); }

  removeMaterial(index: number): void {
    if (!this.isEditing) return;
    this.materials = this.materials.filter((_, i) => i !== index);
    this.filteredMaterials = [...this.materials];
    this.recalculateImportPrice();
  }

  saveProduct(): void {
    if (!this.product.code) {
      return;
    }

    const validationError = this.validateProduct();
    if (validationError) {
      this.saveError = validationError;
      return;
    }
    this.saveError = '';

    this.recalculateImportPrice();
    this.product.status = this.product.isPublished
      ? this.publishedStatus
      : this.unpublishedStatus;
    this.adminApi.updateProductDetail(this.product.code, {
      product: this.product,
      materials: this.materials
    }).subscribe({
      next: () => {
        this.saveError = '';
        this.isEditing = false;
        this.loadProductDetail(this.product.code);
      },
      error: (error) => {
        console.error('Cannot save product detail', error);
        const details = Array.isArray(error?.error?.details) ? ' ' + error.error.details.join(' ') : '';
        this.saveError = (error?.error?.message || 'Chưa lưu được sản phẩm.') + details;
        this.cdr.detectChanges();
      }
    });
  }

  private validateProduct(): string | null {
    if (!this.product.name.trim()) return 'Tên sản phẩm là bắt buộc.';
    if (!(Number(this.product.salePrice) > 0)) return 'Giá bán phải lớn hơn 0.';
    if (Number(this.product.discountPrice) > 0 && Number(this.product.discountPrice) >= Number(this.product.salePrice)) return 'Giá khuyến mãi phải nhỏ hơn giá bán.';
    if (!this.product.topic && !this.product.colors.length && !this.product.targets.length && !this.product.flowers.length && !this.product.collections.length) return 'Sản phẩm phải có ít nhất một danh mục.';
    if (!this.product.images.length) return 'Sản phẩm phải có ít nhất một ảnh.';
    if (this.product.images.filter((image) => image.isPrimary).length !== 1) return 'Sản phẩm phải có đúng một ảnh đại diện.';
    return null;
  }

  private recalculateImportPrice(): void {
    this.product.importPrice = this.materials.reduce((sum, item) => {
      return sum + Number(item.quantity || 0) * Number(item.importPrice || 0);
    }, 0);
  }

  replyReview(review: AdminProductReview): void {
    console.log(review);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredReviews.length / this.itemsPerPage) || 1;
  }

  get pages(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  get pagedReviews(): AdminProductReview[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredReviews.slice(start, start + this.itemsPerPage);
  }

  goToPage(page: number): void {
    this.currentPage = page;
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  filterReview(): void {
    if (this.selectedRating === 'all') {
      this.filteredReviews = [...this.reviews];
    } else {
      this.filteredReviews = this.reviews.filter(
        review => review.rating === Number(this.selectedRating)
      );
    }

    if (this.selectedPeriod !== 'all') {
      const threshold = Date.now() - Number(this.selectedPeriod) * 24 * 60 * 60 * 1000;
      this.filteredReviews = this.filteredReviews.filter((review) => new Date(review.date).getTime() >= threshold);
    }

    this.sortReviews(false);
    this.currentPage = 1;
  }

  sortReviews(resetPage = true): void {
    this.filteredReviews.sort((a, b) => {
      const left = new Date(a.date).getTime();
      const right = new Date(b.date).getTime();
      return this.sortType === 'newest' ? right - left : left - right;
    });

    if (resetPage) {
      this.currentPage = 1;
    }
  }

  goBack(): void {
    this.router.navigate(['/products/product-list']);
  }

  private removeVietnameseTones(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  private normalizeProductStatus(status: string): string {
    const key = this.removeVietnameseTones(String(status || '').trim()).toLowerCase();
    if (key.includes('xoa') || key.includes('deleted')) return this.deletedStatus;
    return key.includes('ngung') || key.includes('stop')
      ? this.unpublishedStatus
      : this.publishedStatus;
  }
}
