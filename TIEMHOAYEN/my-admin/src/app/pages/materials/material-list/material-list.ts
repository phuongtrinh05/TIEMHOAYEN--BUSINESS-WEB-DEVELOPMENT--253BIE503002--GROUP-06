import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AdminApiService, AdminMaterial } from '../../../services/admin-api.service';

interface MaterialItem extends AdminMaterial {}

interface MaterialSearchIndex {
  name: string;
  code: string;
  unit: string;
  importPrice: string;
  sellPrice: string;
  quantity: string;
}

@Component({
  selector: 'app-material-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    RouterLinkActive
  ],
  templateUrl: './material-list.html',
  styleUrls: ['./material-list.css']
})
export class MaterialListComponent implements OnInit {
  readonly allUnitsOption = '__all__';
  searchKeyword = '';
  selectedUnit = this.allUnitsOption;

  isFilterMenuOpen = false;
  isSortMenuOpen = false;
  isExportMenuOpen = false;
  isEditModalOpen = false;
  isAddModalOpen = false;
  isDetailModalOpen = false;
  isUploadingMaterialImage = false;

  currentPage = 1;
  pageSize = 10;

  editingMaterial: MaterialItem | null = null;
  newMaterial: MaterialItem | null = null;
  detailMaterial: MaterialItem | null = null;

  colorOptions = [
    'Màu đỏ',
    'Màu trắng',
    'Màu hồng',
    'Màu vàng',
    'Màu xanh',
    'Màu tím'
  ];

  unitOptions = [
    'Bông',
    'Bó',
    'Cành',
    'Cuộn',
    'Miếng',
    'Cái'
  ];

  statusOptions = [
    'Còn hàng',
    'Sắp hết hàng',
    'Hết hàng',
    'Tạm ngưng'
  ];

  materials: MaterialItem[] = [];
  filteredMaterials: MaterialItem[] = [];
  private pagedMaterialsValue: MaterialItem[] = [];
  private pagesValue: Array<number | string> = [1];
  private availableUnitOptionsValue: string[] = [];
  private materialSearchIndex = new Map<string, MaterialSearchIndex>();

  constructor(
    private adminApi: AdminApiService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.selectedUnit = this.allUnitsOption;
      this.loadMaterials();
    }
  }

  private loadMaterials(): void {
    this.adminApi.getMaterials().subscribe({
      next: (response) => {
        this.materials = response.materials.map((item) => ({
          ...item,
          selected: false
        }));
        this.rebuildMaterialCaches();
        this.filteredMaterials = [...this.materials];
        this.currentPage = 1;
        this.rebuildPagedMaterials();
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Cannot load admin materials', error);
        this.materials = [];
        this.filteredMaterials = [];
        this.rebuildMaterialCaches();
        this.rebuildPagedMaterials();
        this.cdr.detectChanges();
      }
    });
  }

  private createEmptyMaterial(id: number): MaterialItem {
    return {
      id,
      code: `NVL${id.toString().padStart(4, '0')}`,
      name: '',
      image: '',
      color: '',
      unit: '',
      quantity: 0,
      importPrice: 0,
      sellPrice: 0,
      selected: false,
      description: '',
      status: ''
    };
  }

  get totalPages(): number {
    return Math.ceil(this.filteredMaterials.length / this.pageSize) || 1;
  }

  get pages(): (number | string)[] {
    return this.pagesValue;
  }

  get pagedMaterials(): MaterialItem[] {
    return this.pagedMaterialsValue;
  }

  private buildPages(total: number): Array<number | string> {
    if (total <= 7) {
      return Array.from({ length: total }, (_, index) => index + 1);
    }

    if (this.currentPage <= 4) {
      return [1, 2, 3, 4, 5, '...', total];
    }

    if (this.currentPage >= total - 3) {
      return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
    }

    return [1, '...', this.currentPage - 1, this.currentPage, this.currentPage + 1, '...', total];
  }

  private rebuildPagedMaterials(): void {
    const total = this.totalPages;

    if (this.currentPage > total) {
      this.currentPage = total;
    }

    if (this.currentPage < 1) {
      this.currentPage = 1;
    }

    const start = (this.currentPage - 1) * this.pageSize;
    this.pagedMaterialsValue = this.filteredMaterials.slice(start, start + this.pageSize);
    this.pagesValue = this.buildPages(total);
  }

  private normalizeFilterValue(value: string): string {
    return this.removeVietnameseTones(String(value || '').trim().toLowerCase());
  }

  get availableUnitOptions(): string[] {
    return this.availableUnitOptionsValue;
  }

  private rebuildMaterialCaches(): void {
    const units = new Set<string>();
    this.materialSearchIndex.clear();

    this.materials.forEach((item) => {
      const unit = item.unit?.trim();
      if (unit) {
        units.add(unit);
      }

      this.materialSearchIndex.set(item.code, {
        name: this.normalizeFilterValue(item.name),
        code: this.normalizeFilterValue(item.code),
        unit: this.normalizeFilterValue(item.unit),
        importPrice: this.formatPrice(item.importPrice),
        sellPrice: this.formatPrice(item.sellPrice),
        quantity: item.quantity.toString()
      });
    });

    this.availableUnitOptionsValue = Array.from(units).sort((a, b) => a.localeCompare(b, 'vi'));
  }

  applyFilters(): void {
    const keyword = this.removeVietnameseTones(this.searchKeyword.trim().toLowerCase());
    const selectedUnit = this.normalizeFilterValue(this.selectedUnit);
    const isAllUnits = this.selectedUnit === this.allUnitsOption;

    this.filteredMaterials = this.materials.filter((item) => {
      const index = this.materialSearchIndex.get(item.code);

      const matchesKeyword =
        !keyword ||
        Boolean(index && (
          index.name.includes(keyword) ||
          index.code.includes(keyword) ||
          index.unit.includes(keyword) ||
          index.importPrice.includes(keyword) ||
          index.sellPrice.includes(keyword) ||
          index.quantity.includes(keyword)
        ));

      const matchesUnit = isAllUnits || index?.unit === selectedUnit;

      return matchesKeyword && matchesUnit;
    });

    this.currentPage = 1;
    this.rebuildPagedMaterials();
  }

  onUnitFilterChange(): void {
    this.applyFilters();
    this.isFilterMenuOpen = false;
  }

  sortMaterials(field: string): void {
    this.filteredMaterials.sort((a, b) => {
      if (field === 'name') {
        return a.name.localeCompare(b.name, 'vi');
      }

      if (field === 'code') {
        return a.code.localeCompare(b.code, 'vi');
      }

      if (field === 'quantity') {
        return b.quantity - a.quantity;
      }

      if (field === 'importPrice') {
        return b.importPrice - a.importPrice;
      }

      if (field === 'sellPrice') {
        return b.sellPrice - a.sellPrice;
      }

      return 0;
    });

    this.isSortMenuOpen = false;
    this.rebuildPagedMaterials();
  }

  toggleFilterMenu(): void {
    this.isFilterMenuOpen = !this.isFilterMenuOpen;
    this.isSortMenuOpen = false;
    this.isExportMenuOpen = false;
  }

  toggleSortMenu(): void {
    this.isSortMenuOpen = !this.isSortMenuOpen;
    this.isFilterMenuOpen = false;
    this.isExportMenuOpen = false;
  }

  toggleExportMenu(): void {
    this.isExportMenuOpen = !this.isExportMenuOpen;
    this.isFilterMenuOpen = false;
    this.isSortMenuOpen = false;
  }

  toggleSelectAll(event: Event): void {
    const input = event.target as HTMLInputElement;

    this.pagedMaterials.forEach((item) => {
      item.selected = input.checked;
    });
  }

  isAllSelected(): boolean {
    return this.pagedMaterials.length > 0 &&
      this.pagedMaterials.every((item) => item.selected);
  }

  openAddModal(): void {
    const nextId = this.materials.length > 0
      ? Math.max(...this.materials.map((item) => item.id)) + 1
      : 1;

    this.isFilterMenuOpen = false;
    this.isSortMenuOpen = false;
    this.isExportMenuOpen = false;
    this.isEditModalOpen = false;
    this.isDetailModalOpen = false;
    this.editingMaterial = null;
    this.detailMaterial = null;
    this.newMaterial = this.createEmptyMaterial(nextId);
    this.isAddModalOpen = true;
  }

  saveNewMaterial(): void {
    if (!this.newMaterial) {
      return;
    }

    if (!this.newMaterial.name.trim()) {
      alert('Vui lòng nhập tên nguyên vật liệu.');
      return;
    }

    if (!this.newMaterial.unit.trim()) {
      alert('Vui lòng nhập đơn vị tính.');
      return;
    }

    this.adminApi.createMaterial({
      name: this.newMaterial.name.trim(),
      unit: this.newMaterial.unit.trim(),
      quantity: Number(this.newMaterial.quantity || 0),
      importPrice: Number(this.newMaterial.importPrice || 0),
      sellPrice: Number(this.newMaterial.sellPrice || 0),
      description: this.newMaterial.description || '',
      image: this.newMaterial.image || ''
    }).subscribe({
      next: () => {
        this.closeAddModal();
        this.loadMaterials();
      },
      error: (error) => {
        console.error('Cannot create material', error);
        alert('Không thể thêm nguyên vật liệu. Vui lòng thử lại.');
      }
    });
  }

  closeAddModal(): void {
    this.isAddModalOpen = false;
    this.newMaterial = null;
  }

  closeAddModalFromBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeAddModal();
    }
  }

  openDetailModal(material: MaterialItem): void {
    this.detailMaterial = { ...material };
    this.isDetailModalOpen = true;
    this.isAddModalOpen = false;
    this.isEditModalOpen = false;
    this.newMaterial = null;
    this.editingMaterial = null;
  }

  closeDetailModal(): void {
    this.isDetailModalOpen = false;
    this.detailMaterial = null;
  }

  closeDetailModalFromBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeDetailModal();
    }
  }

  editMaterial(material: MaterialItem): void {
    this.editingMaterial = {
      ...material,
      description: material.description || '',
      color: material.color || '',
      status: material.status || ''
    };

    this.isEditModalOpen = true;
    this.isAddModalOpen = false;
    this.isDetailModalOpen = false;
    this.detailMaterial = null;
  }

  saveMaterial(): void {
    if (!this.editingMaterial) {
      return;
    }

    if (!this.editingMaterial.name.trim()) {
      alert('Vui lòng nhập tên nguyên vật liệu.');
      return;
    }

    if (!this.editingMaterial.unit.trim()) {
      alert('Vui lòng nhập đơn vị tính.');
      return;
    }

    this.adminApi.updateMaterial(this.editingMaterial.code, {
      name: this.editingMaterial.name.trim(),
      unit: this.editingMaterial.unit.trim(),
      quantity: Number(this.editingMaterial.quantity || 0),
      importPrice: Number(this.editingMaterial.importPrice || 0),
      sellPrice: Number(this.editingMaterial.sellPrice || 0),
      description: this.editingMaterial.description || '',
      image: this.editingMaterial.image || ''
    }).subscribe({
      next: () => {
        this.closeEditModal();
        this.loadMaterials();
      },
      error: (error) => {
        console.error('Cannot update material', error);
        alert('Không thể lưu nguyên vật liệu. Vui lòng thử lại.');
      }
    });
  }

  closeEditModal(): void {
    this.isEditModalOpen = false;
    this.editingMaterial = null;
  }

  closeEditModalFromBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeEditModal();
    }
  }

  selectMaterialImage(material: MaterialItem | null): void {
    if (!material || this.isUploadingMaterialImage) {
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif';
    input.onchange = () => {
      const file = input.files?.[0];

      if (!file) {
        return;
      }

      this.uploadMaterialImageFile(file, material);
    };
    input.click();
  }

  private uploadMaterialImageFile(file: File, material: MaterialItem): void {
    this.isUploadingMaterialImage = true;
    this.adminApi.uploadMaterialImage(file).subscribe({
      next: (response) => {
        material.image = response.imageUrl;
        this.isUploadingMaterialImage = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Cannot upload material image', error);
        alert('Không thể tải ảnh lên. Vui lòng chọn ảnh JPG, PNG, WEBP hoặc GIF dưới 5MB.');
        this.isUploadingMaterialImage = false;
        this.cdr.detectChanges();
      }
    });
  }

  onMaterialImageError(event: Event): void {
    const image = event.target as HTMLImageElement;
    image.style.display = 'none';
  }

  deleteMaterial(material: MaterialItem): void {
    if (!confirm('Bạn có chắc muốn xóa nguyên vật liệu này?')) {
      return;
    }

    this.adminApi.deleteMaterial(material.code).subscribe({
      next: () => {
        this.materials = this.materials.filter((item) => item.code !== material.code);
        this.rebuildMaterialCaches();
        this.applyFilters();
      },
      error: (error) => {
        console.error('Cannot delete material', error);
        alert('Không thể xóa nguyên vật liệu này. Có thể đang được dùng trong phiếu nhập/xuất.');
      }
    });
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.rebuildPagedMaterials();
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.rebuildPagedMaterials();
    }
  }

  goToPage(page: number | string): void {
    if (typeof page !== 'number') {
      return;
    }

    this.currentPage = page;
    this.rebuildPagedMaterials();
  }

  formatPrice(value: number): string {
    return value.toLocaleString('vi-VN') + 'đ';
  }

  removeVietnameseTones(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  trackByMaterialCode(_index: number, item: MaterialItem): string {
    return item.code;
  }

  trackByPage(_index: number, page: number | string): number | string {
    return page;
  }

  trackByText(_index: number, value: string): string {
    return value;
  }
}
