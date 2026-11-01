import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  AdminApiService,
  AdminProductDetailForm,
  AdminProductRecipeItem,
  AdminProductReview
} from '../../../services/admin-api.service';

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
        alert('Không thể lấy chi tiết sản phẩm từ SQL.');
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
        alert('Kh\u00f4ng th\u1ec3 c\u1eadp nh\u1eadt tr\u1ea1ng th\u00e1i s\u1ea3n ph\u1ea9m. Vui l\u00f2ng th\u1eed l\u1ea1i.');
        this.cdr.detectChanges();
      }
    });
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;

    Array.from(input.files).forEach((file) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        alert('Chỉ chấp nhận ảnh JPG, PNG, WEBP và tối đa 5 MB mỗi ảnh.');
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

  searchMaterial(): void {
    const key = this.removeVietnameseTones(this.searchKeyword.toLowerCase().trim());
    if (!key) {
      this.filteredMaterials = [...this.materials];
      return;
    }

    this.filteredMaterials = this.materials.filter((item) => {
      const name = this.removeVietnameseTones((item.name || '').toLowerCase());
      const code = (item.code || '').toLowerCase();
      return name.includes(key) || code.includes(key);
    });
  }

  addMaterial(): void {
    const key = this.removeVietnameseTones(this.searchKeyword.toLowerCase().trim());
    const option = this.materialOptions.find((item) => {
      const name = this.removeVietnameseTones((item.name || '').toLowerCase());
      const code = (item.code || '').toLowerCase();
      return key ? name.includes(key) || code.includes(key) : true;
    });

    const nextId = this.materials.length > 0
      ? Math.max(...this.materials.map((item) => item.id || 0)) + 1
      : 1;

    this.materials.push({
      id: nextId,
      image: option?.image || '',
      name: option?.name || '',
      code: option?.code || '',
      quantity: 1,
      unit: option?.unit || '',
      note: '',
      importPrice: option?.importPrice || 0
    });
    this.searchKeyword = '';
    this.filteredMaterials = [...this.materials];
    this.recalculateImportPrice();
  }

  removeMaterial(index: number): void {
    const item = this.filteredMaterials[index];
    this.materials = this.materials.filter((material) => material !== item);
    this.filteredMaterials = [...this.materials];
    this.recalculateImportPrice();
  }

  saveProduct(): void {
    if (!this.product.code) {
      alert('Không tìm thấy mã sản phẩm để lưu.');
      return;
    }

    const validationError = this.validateProduct();
    if (validationError) {
      alert(validationError);
      return;
    }

    this.recalculateImportPrice();
    this.product.status = this.product.isPublished
      ? this.publishedStatus
      : this.unpublishedStatus;
    this.adminApi.updateProductDetail(this.product.code, {
      product: this.product,
      materials: this.materials
    }).subscribe({
      next: () => {
        this.isEditing = false;
        this.loadProductDetail(this.product.code);
      },
      error: (error) => {
        console.error('Cannot save product detail', error);
        alert('Không thể lưu chi tiết sản phẩm. Vui lòng thử lại.');
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
