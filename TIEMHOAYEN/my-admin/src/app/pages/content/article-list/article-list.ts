import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AdminApiService, AdminBlogRow } from '../../../services/admin-api.service';

// ===== BLOG TYPES =====
export type ArticleCategory = string;

export interface Article {
  id: string;
  title: string;
  updatedAt: string;
  category: ArticleCategory;
  author: string;
  views: number;
  selected: boolean;
}

// ===== WEB CONTENT TYPES =====
export type WebContentType = 'Chính sách' | 'Giới thiệu' | 'Hướng dẫn' | 'FAQ';
export type FileType = 'PDF' | 'DOCX';
export type WebContentStatus = 'Hiển thị' | 'Ẩn';

export interface WebContent {
  id: string;
  name: string;
  contentType: WebContentType;
  fileType: FileType;
  updatedAt: string;
  status: WebContentStatus;
  note: string;
  fileName: string;
  fileSize: string;
  selected: boolean;
}

export interface WebContentForm {
  name: string;
  contentType: WebContentType | '';
  note: string;
  updatedAt: string;
  status: WebContentStatus | '';
  fileName: string;
  fileSize: string;
  fileType: FileType | '';
}

export type ArticleTab = 'Blog' | 'Thông tin website';

type DateFilter = 'Tất cả' | 'Hôm nay' | '7 ngày gần đây' | '30 ngày gần đây' | 'Tháng này';
type ViewFilter = 'Tất cả' | 'Dưới 100 lượt' | '100 - 500 lượt' | 'Trên 500 lượt';
type CategoryFilter = 'Tất cả danh mục' | ArticleCategory;
type SortOption =
  | 'Mặc định'
  | 'Ngày mới nhất'
  | 'Ngày cũ nhất'
  | 'Lượt xem nhiều nhất'
  | 'Lượt xem ít nhất'
  | 'Mã bài A-Z'
  | 'Mã bài Z-A';

type WcContentTypeFilter = 'Tất cả loại' | WebContentType;
type WcStatusFilter = 'Tất cả trạng thái' | WebContentStatus;
type WcSortOption = 'Mặc định' | 'Ngày mới nhất' | 'Ngày cũ nhất' | 'Tên A-Z' | 'Tên Z-A';

@Component({
  selector: 'app-article-list',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule
  ],
  templateUrl: './article-list.html',
  styleUrl: './article-list.css',
})
export class ArticleList implements OnInit {
  constructor(
    private router: Router,
    private adminApi: AdminApiService,
    private cdr: ChangeDetectorRef
  ) {}

  allArticles: Article[] = [];

  ngOnInit(): void {
    this.allArticles = [];
    this.loadArticles();
  }

  allWebContents: WebContent[] = [
    { id: 'WC001', name: 'Chính sách giao hàng', contentType: 'Chính sách', fileType: 'PDF', updatedAt: '01/06/2026', status: 'Hiển thị', note: '', fileName: 'giaohang_v1.0.pdf', fileSize: '2.3 MB', selected: false },
    { id: 'WC002', name: 'Chính sách bán hàng', contentType: 'Chính sách', fileType: 'DOCX', updatedAt: '01/06/2026', status: 'Hiển thị', note: '', fileName: 'banhang_v1.0.docx', fileSize: '1.1 MB', selected: false },
    { id: 'WC003', name: 'Về chúng tôi', contentType: 'Giới thiệu', fileType: 'DOCX', updatedAt: '01/06/2026', status: 'Hiển thị', note: '', fileName: 'vechungtoi.docx', fileSize: '0.8 MB', selected: false },
    { id: 'WC004', name: 'Hướng dẫn đặt hàng', contentType: 'Hướng dẫn', fileType: 'PDF', updatedAt: '15/05/2026', status: 'Hiển thị', note: '', fileName: 'huongdan_dathang.pdf', fileSize: '1.5 MB', selected: false },
    { id: 'WC005', name: 'Chính sách đổi trả', contentType: 'Chính sách', fileType: 'PDF', updatedAt: '10/05/2026', status: 'Ẩn', note: '', fileName: 'doitra_v2.pdf', fileSize: '0.9 MB', selected: false },
    { id: 'WC006', name: 'Câu hỏi thường gặp', contentType: 'FAQ', fileType: 'DOCX', updatedAt: '05/05/2026', status: 'Hiển thị', note: '', fileName: 'faq_v1.docx', fileSize: '0.6 MB', selected: false },
    { id: 'WC007', name: 'Điều khoản sử dụng', contentType: 'Chính sách', fileType: 'PDF', updatedAt: '01/05/2026', status: 'Hiển thị', note: '', fileName: 'dieukhoan.pdf', fileSize: '1.2 MB', selected: false },
    { id: 'WC008', name: 'Hướng dẫn thanh toán', contentType: 'Hướng dẫn', fileType: 'DOCX', updatedAt: '20/04/2026', status: 'Ẩn', note: '', fileName: 'huongdan_tt.docx', fileSize: '0.7 MB', selected: false },
  ];

  isPopupOpen = false;
  popupMode: 'view' | 'edit' | 'add' = 'view';
  selectedWebContent: WebContent | null = null;

  webContentTypes: WebContentType[] = ['Chính sách', 'Giới thiệu', 'Hướng dẫn', 'FAQ'];
  webContentStatuses: WebContentStatus[] = ['Hiển thị', 'Ẩn'];

  form: WebContentForm = this.emptyForm();
  formErrors = {
    name: false,
    contentType: false,
    updatedAt: false,
    status: false,
    file: false,
  };

  tabs: ArticleTab[] = ['Blog', 'Thông tin website'];
  activeTab: ArticleTab = 'Blog';

  articleCategories: ArticleCategory[] = ['Hoa hồng', 'Hoa cưới', 'Hoa sinh nhật', 'Hoa tang lễ', 'Hoa văn phòng', 'Mẹo cắm hoa', 'Tin tức'];
  editingArticleId: string | null = null;
  articleEditForm: { title: string; updatedAt: string; category: ArticleCategory | ''; author: string } = {
    title: '',
    updatedAt: '',
    category: '',
    author: '',
  };
  articleEditErrors = {
    title: false,
    updatedAt: false,
    category: false,
    author: false,
  };

  dateFilters: DateFilter[] = ['Tất cả', 'Hôm nay', '7 ngày gần đây', '30 ngày gần đây', 'Tháng này'];
  dateFilter: DateFilter = 'Tất cả';

  viewFilters: ViewFilter[] = ['Tất cả', 'Dưới 100 lượt', '100 - 500 lượt', 'Trên 500 lượt'];
  viewFilter: ViewFilter = 'Tất cả';

  categoryFilters: CategoryFilter[] = ['Tất cả danh mục', 'Hoa hồng', 'Hoa cưới', 'Hoa sinh nhật', 'Hoa tang lễ', 'Hoa văn phòng', 'Mẹo cắm hoa', 'Tin tức'];
  categoryFilter: CategoryFilter = 'Tất cả danh mục';

  sortOptions: SortOption[] = ['Mặc định', 'Ngày mới nhất', 'Ngày cũ nhất', 'Lượt xem nhiều nhất', 'Lượt xem ít nhất', 'Mã bài A-Z', 'Mã bài Z-A'];
  sortOption: SortOption = 'Mặc định';

  wcDateFilter: DateFilter = 'Tất cả';
  wcContentTypeFilter: WcContentTypeFilter = 'Tất cả loại';
  wcStatusFilter: WcStatusFilter = 'Tất cả trạng thái';
  wcContentTypeFilters: WcContentTypeFilter[] = ['Tất cả loại', 'Chính sách', 'Giới thiệu', 'Hướng dẫn', 'FAQ'];
  wcStatusFilters: WcStatusFilter[] = ['Tất cả trạng thái', 'Hiển thị', 'Ẩn'];
  wcSortOptions: WcSortOption[] = ['Mặc định', 'Ngày mới nhất', 'Ngày cũ nhất', 'Tên A-Z', 'Tên Z-A'];
  wcSortOption: WcSortOption = 'Mặc định';

  searchKeyword = '';
  currentPage = 1;
  pageSize = 10;

  isFilterMenuOpen = false;
  isSortMenuOpen = false;
  isMoreMenuOpen = false;
  isExportMenuOpen = false;

  editingWcId: string | null = null;
  inlineForm: { contentType: WebContentType | ''; updatedAt: string; fileName: string; fileType: FileType | '' } = {
    contentType: '',
    updatedAt: '',
    fileName: '',
    fileType: '',
  };

  get articleEditNativeUpdatedAt(): string {
    if (!this.isValidDateString(this.articleEditForm.updatedAt)) return '';
    const [dd, mm, yyyy] = this.articleEditForm.updatedAt.trim().split('/');
    return `${yyyy}-${mm}-${dd}`;
  }

  get selectedArticles(): Article[] {
    return this.allArticles.filter(a => a.selected);
  }

  get selectedWebContents(): WebContent[] {
    return this.allWebContents.filter(w => w.selected);
  }

  get allWebSelected(): boolean {
    return this.pagedWebContents.length > 0 && this.pagedWebContents.every(w => w.selected);
  }

  get allSelected(): boolean {
    return this.pagedArticles.length > 0 && this.pagedArticles.every(a => a.selected);
  }

  get hasActiveFilter(): boolean {
    if (this.activeTab === 'Blog') {
      return this.dateFilter !== 'Tất cả' || this.viewFilter !== 'Tất cả' || this.categoryFilter !== 'Tất cả danh mục';
    }

    return this.wcDateFilter !== 'Tất cả' || this.wcContentTypeFilter !== 'Tất cả loại' || this.wcStatusFilter !== 'Tất cả trạng thái';
  }

  get filteredArticles(): Article[] {
    let list = [...this.allArticles];

    if (this.categoryFilter !== 'Tất cả danh mục') {
      list = list.filter(a => a.category === this.categoryFilter);
    }

    if (this.viewFilter !== 'Tất cả') {
      list = list.filter(a => {
        if (this.viewFilter === 'Dưới 100 lượt') return a.views < 100;
        if (this.viewFilter === '100 - 500 lượt') return a.views >= 100 && a.views <= 500;
        if (this.viewFilter === 'Trên 500 lượt') return a.views > 500;
        return true;
      });
    }

    list = this.filterByDate(list);

    const kw = this.normalize(this.searchKeyword.trim());
    if (kw) {
      list = list.filter(a =>
        this.normalize(a.id).includes(kw) ||
        this.normalize(a.title).includes(kw) ||
        this.normalize(a.author).includes(kw) ||
        this.normalize(a.category).includes(kw)
      );
    }

    return this.sortArticles(list);
  }

  get filteredWebContents(): WebContent[] {
    let list = [...this.allWebContents];

    if (this.wcContentTypeFilter !== 'Tất cả loại') {
      list = list.filter(w => w.contentType === this.wcContentTypeFilter);
    }

    if (this.wcStatusFilter !== 'Tất cả trạng thái') {
      list = list.filter(w => w.status === this.wcStatusFilter);
    }

    if (this.wcDateFilter !== 'Tất cả') {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      list = list.filter(w => {
        const d = new Date(this.parseDate(w.updatedAt));
        const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());

        if (this.wcDateFilter === 'Hôm nay') return s.getTime() === today.getTime();
        if (this.wcDateFilter === '7 ngày gần đây') {
          const p = new Date(today);
          p.setDate(today.getDate() - 7);
          return s >= p && s <= today;
        }
        if (this.wcDateFilter === '30 ngày gần đây') {
          const p = new Date(today);
          p.setDate(today.getDate() - 30);
          return s >= p && s <= today;
        }
        if (this.wcDateFilter === 'Tháng này') {
          return s.getMonth() === today.getMonth() && s.getFullYear() === today.getFullYear();
        }

        return true;
      });
    }

    const kw = this.normalize(this.searchKeyword.trim());
    if (kw) {
      list = list.filter(w =>
        this.normalize(w.name).includes(kw) ||
        this.normalize(w.contentType).includes(kw) ||
        this.normalize(w.fileType).includes(kw)
      );
    }

    return this.sortWebContents(list);
  }

  get totalPages(): number {
    const count = this.activeTab === 'Blog'
      ? this.filteredArticles.length
      : this.filteredWebContents.length;

    return Math.max(1, Math.ceil(count / this.pageSize));
  }

  get pagedArticles(): Article[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredArticles.slice(start, start + this.pageSize);
  }

  get pagedWebContents(): WebContent[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredWebContents.slice(start, start + this.pageSize);
  }

  get pageNumbers(): (number | '...')[] {
    const total = this.totalPages;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    return [1, 2, 3, 4, 5, '...', total];
  }

  get attachedFileIcon(): string {
    return this.fileTypeIcon((this.form.fileType || 'PDF') as FileType);
  }

  get attachedFileIconClass(): string {
    return this.fileTypeIconClass((this.form.fileType || 'PDF') as FileType);
  }

  get nativeUpdatedAt(): string {
    if (!this.isValidDateString(this.form.updatedAt)) return '';
    const [dd, mm, yyyy] = this.form.updatedAt.trim().split('/');
    return `${yyyy}-${mm}-${dd}`;
  }

  goToArticleDetail(article: Article): void {
    if (this.editingArticleId === article.id) {
      return;
    }

    this.router.navigate(['/content/article-detail', article.id], {
      state: { article },
    });
  }

  onArticleEditDatePicked(iso: string): void {
    if (!iso) return;
    const [yyyy, mm, dd] = iso.split('-');
    this.articleEditForm.updatedAt = `${dd}/${mm}/${yyyy}`;
  }

  editArticle(article: Article): void {
    this.editingArticleId = article.id;
    this.articleEditForm = {
      title: article.title,
      updatedAt: article.updatedAt,
      category: article.category,
      author: article.author,
    };
    this.articleEditErrors = {
      title: false,
      updatedAt: false,
      category: false,
      author: false,
    };
  }

  cancelArticleEdit(): void {
    this.editingArticleId = null;
  }

  saveArticleEdit(article: Article): void {
    this.articleEditErrors = {
      title: !this.articleEditForm.title.trim(),
      updatedAt: !this.isValidDateString(this.articleEditForm.updatedAt),
      category: !this.articleEditForm.category,
      author: !this.articleEditForm.author.trim(),
    };

    if (
      this.articleEditErrors.title ||
      this.articleEditErrors.updatedAt ||
      this.articleEditErrors.category ||
      this.articleEditErrors.author
    ) {
      return;
    }

    this.adminApi.getBlog(article.id).subscribe({
      next: (blog) => {
        this.adminApi.updateBlog(article.id, {
          title: this.articleEditForm.title.trim(),
          content: blog.NOI_DUNG || '',
          category: this.articleEditForm.category,
          author: this.articleEditForm.author.trim(),
          email: blog.EMAIL_NHAN_VIEN || '',
          staffId: blog.NHAN_VIEN_ID || undefined,
          coverImage: blog.ANH_BIA || '',
          status: blog.TRANG_THAI || undefined,
        }).subscribe({
          next: (response) => {
            const updated = this.mapBlogRow(response.blog);
            this.allArticles = this.allArticles.map(a => a.id === article.id ? updated : a);
            this.editingArticleId = null;
          },
          error: (error) => {
            console.error('Cannot update blog', error);
          }
        });
      },
      error: (error) => {
        console.error('Cannot load blog before update', error);
      }
    });
  }

  onDatePicked(iso: string): void {
    if (!iso) return;
    const [yyyy, mm, dd] = iso.split('-');
    this.form.updatedAt = `${dd}/${mm}/${yyyy}`;
  }

  openViewPopup(wc: WebContent): void {
    this.selectedWebContent = wc;
    this.form = {
      name: wc.name,
      contentType: wc.contentType,
      note: wc.note,
      updatedAt: wc.updatedAt,
      status: wc.status,
      fileName: wc.fileName,
      fileSize: wc.fileSize,
      fileType: wc.fileType,
    };

    this.resetFormErrors();
    this.popupMode = 'view';
    this.isPopupOpen = true;
  }

  openAddPopup(): void {
    if (this.activeTab === 'Blog') {
      this.router.navigate(['/content/create-article']);
      return;
    }
    this.selectedWebContent = null;
    this.form = this.emptyForm();
    this.resetFormErrors();
    this.popupMode = 'add';
    this.isPopupOpen = true;
  }

  switchToEditMode(): void {
    this.popupMode = 'edit';
    this.resetFormErrors();
  }

  closePopup(): void {
    this.isPopupOpen = false;
    this.selectedWebContent = null;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.form.fileName = file.name;
    this.form.fileSize = this.formatFileSize(file.size);
    this.form.fileType = file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOCX';
  }

  savePopup(): void {
    this.formErrors = {
      name: !this.form.name.trim(),
      contentType: !this.form.contentType,
      updatedAt: !this.isValidDateString(this.form.updatedAt),
      status: !this.form.status,
      file: this.popupMode === 'add' && !this.form.fileName,
    };

    if (
      this.formErrors.name ||
      this.formErrors.contentType ||
      this.formErrors.updatedAt ||
      this.formErrors.status ||
      this.formErrors.file
    ) {
      return;
    }

    if (this.popupMode === 'add') {
      const newId = 'WC' + String(this.allWebContents.length + 1).padStart(3, '0');
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();

      this.allWebContents = [
        ...this.allWebContents,
        {
          id: newId,
          name: this.form.name,
          contentType: this.form.contentType as WebContentType,
          fileType: (this.form.fileType as FileType) || 'PDF',
          updatedAt: `${dd}/${mm}/${yyyy}`,
          status: this.form.status as WebContentStatus,
          note: this.form.note,
          fileName: this.form.fileName,
          fileSize: this.form.fileSize,
          selected: false,
        },
      ];
    }

    if (this.popupMode === 'edit' && this.selectedWebContent) {
      this.allWebContents = this.allWebContents.map(w => {
        if (w.id !== this.selectedWebContent!.id) return w;

        return {
          ...w,
          name: this.form.name,
          contentType: this.form.contentType as WebContentType,
          note: this.form.note,
          updatedAt: this.form.updatedAt,
          status: this.form.status as WebContentStatus,
          fileName: this.form.fileName,
          fileSize: this.form.fileSize,
          fileType: (this.form.fileType as FileType) || w.fileType,
        };
      });
    }

    this.closePopup();
  }

  async downloadAttachedFile(): Promise<void> {
    if (!this.form.fileName) {
      alert('Không có file để tải xuống.');
      return;
    }

    const fileNameWithoutExt = this.form.fileName.replace(/\.[^/.]+$/, '');
    const downloadFileName = `${fileNameWithoutExt}_mock-download.txt`;

    const mockContent = `Đây là file giả lập cho chức năng tải xuống.

Tên file gốc: ${this.form.fileName}
Loại file: ${this.form.fileType}
Dung lượng: ${this.form.fileSize}
Tên nội dung: ${this.form.name}
Loại nội dung: ${this.form.contentType}
Ngày cập nhật: ${this.form.updatedAt}
Trạng thái: ${this.form.status}
Ghi chú: ${this.form.note || 'Không có'}

Lưu ý: Đây là file giả lập được tạo ở phía frontend.
`;

    const blob = new Blob([mockContent], {
      type: 'text/plain;charset=utf-8',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = downloadFileName;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  editWebContent(wc: WebContent): void {
    this.openViewPopup(wc);
    this.switchToEditMode();
  }

  deleteWebContent(wc: WebContent): void {
    this.allWebContents = this.allWebContents.filter(w => w.id !== wc.id);
    this.ensureValidPage();
  }

  startInlineEdit(wc: WebContent): void {
    this.editingWcId = wc.id;
    this.inlineForm = {
      contentType: wc.contentType,
      updatedAt: wc.updatedAt,
      fileName: wc.fileName,
      fileType: wc.fileType,
    };
  }

  cancelInlineEdit(): void {
    this.editingWcId = null;
  }

  saveInlineEdit(wc: WebContent): void {
    this.allWebContents = this.allWebContents.map(w => {
      if (w.id !== wc.id) return w;

      return {
        ...w,
        contentType: (this.inlineForm.contentType as WebContentType) || w.contentType,
        updatedAt: this.inlineForm.updatedAt || w.updatedAt,
        fileName: this.inlineForm.fileName || w.fileName,
        fileType: (this.inlineForm.fileType as FileType) || w.fileType,
      };
    });

    this.editingWcId = null;
  }

  startInlineUpload(wc: WebContent): void {
    this.editingWcId = null;
  }

  onQuickUpload(event: Event, wc: WebContent): void {
    const input = event.target as HTMLInputElement;

    if (!input.files?.length) return;

    const file = input.files[0];
    const newFileType: FileType = file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOCX';
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');

    this.allWebContents = this.allWebContents.map(w =>
      w.id === wc.id
        ? {
            ...w,
            fileName: file.name,
            fileSize: this.formatFileSize(file.size),
            fileType: newFileType,
            updatedAt: `${dd}/${mm}/${now.getFullYear()}`,
          }
        : w
    );

    input.value = '';
  }

  onInlineFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files?.length) return;

    const file = input.files[0];
    this.inlineForm.fileName = file.name;
    this.inlineForm.fileType = file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOCX';
    input.value = '';
  }

  setTab(tab: ArticleTab): void {
    this.activeTab = tab;
    this.currentPage = 1;
    this.searchKeyword = '';
    this.editingArticleId = null;
    this.closeAllMenus();
  }

  applyFilter(): void {
    this.currentPage = 1;
  }

  clearFilters(): void {
    if (this.activeTab === 'Blog') {
      this.dateFilter = 'Tất cả';
      this.viewFilter = 'Tất cả';
      this.categoryFilter = 'Tất cả danh mục';
    } else {
      this.wcDateFilter = 'Tất cả';
      this.wcContentTypeFilter = 'Tất cả loại';
      this.wcStatusFilter = 'Tất cả trạng thái';
    }

    this.currentPage = 1;
  }

  setSortOption(option: SortOption): void {
    this.sortOption = option;
    this.currentPage = 1;
    this.closeAllMenus();
  }

  setWcSortOption(option: WcSortOption): void {
    this.wcSortOption = option;
    this.currentPage = 1;
    this.closeAllMenus();
  }

  onSearch(): void {
    this.currentPage = 1;
  }

  toggleSelectAll(checked: boolean): void {
    this.pagedArticles.forEach(a => (a.selected = checked));
  }

  toggleSelectAllWeb(checked: boolean): void {
    this.pagedWebContents.forEach(w => (w.selected = checked));
  }

  deleteArticle(article: Article): void {
    this.adminApi.deleteBlog(article.id).subscribe({
      next: () => {
        this.allArticles = this.allArticles.filter(a => a.id !== article.id);
        this.ensureValidPage();
      },
      error: (error) => {
        console.error('Cannot delete blog', error);
      }
    });
  }

  deleteSelectedArticles(): void {
    if (!this.selectedArticles.length) {
      this.closeAllMenus();
      return;
    }

    const selectedIds = this.selectedArticles.map(article => article.id);
    forkJoin(selectedIds.map(id => this.adminApi.deleteBlog(id))).subscribe({
      next: () => {
        this.allArticles = this.allArticles.filter(a => !selectedIds.includes(a.id));
        this.currentPage = 1;
        this.ensureValidPage();
        this.closeAllMenus();
      },
      error: (error) => {
        console.error('Cannot delete selected blogs', error);
        this.closeAllMenus();
      }
    });
  }

  deleteSelectedWebContents(): void {
    if (!this.selectedWebContents.length) return;

    this.allWebContents = this.allWebContents.filter(w => !w.selected);
    this.ensureValidPage();
  }

  async exportExcel(): Promise<void> {
    const { rows, header, fileBase } = this.buildExportRows();
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);

    ws['!cols'] = header.map(() => ({ wch: 20 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');

    const arrayBuffer: ArrayBuffer = XLSX.write(wb, {
      bookType: 'xlsx',
      type: 'array',
    });

    const blob = new Blob([arrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await this.saveOrDownload(blob, `${fileBase}.xlsx`);
    this.closeAllMenus();
  }

  async exportPdf(): Promise<void> {
    const { rows, header, fileBase } = this.buildExportRows();
    const doc = new jsPDF({ orientation: 'landscape' });

    autoTable(doc, {
      head: [header],
      body: rows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [115, 25, 25] },
    });

    const blob = doc.output('blob');

    await this.saveOrDownload(blob, `${fileBase}.pdf`);
    this.closeAllMenus();
  }

  setPage(page: number | '...'): void {
    if (typeof page !== 'number') return;
    if (page < 1 || page > this.totalPages) return;

    this.currentPage = page;
    this.editingArticleId = null;
    this.closeAllMenus();
  }

  prevPage(): void {
    if (this.currentPage <= 1) return;

    this.currentPage--;
    this.closeAllMenus();
  }

  nextPage(): void {
    if (this.currentPage >= this.totalPages) return;

    this.currentPage++;
    this.closeAllMenus();
  }

  toggleFilterMenu(): void {
    this.isFilterMenuOpen = !this.isFilterMenuOpen;
    this.isSortMenuOpen = false;
    this.isMoreMenuOpen = false;
    this.isExportMenuOpen = false;
  }

  toggleSortMenu(): void {
    this.isSortMenuOpen = !this.isSortMenuOpen;
    this.isFilterMenuOpen = false;
    this.isMoreMenuOpen = false;
    this.isExportMenuOpen = false;
  }

  toggleMoreMenu(): void {
    this.isMoreMenuOpen = !this.isMoreMenuOpen;
    this.isFilterMenuOpen = false;
    this.isSortMenuOpen = false;
    this.isExportMenuOpen = false;
  }

  toggleExportMenu(): void {
    this.isExportMenuOpen = !this.isExportMenuOpen;
    this.isFilterMenuOpen = false;
    this.isSortMenuOpen = false;
    this.isMoreMenuOpen = false;
  }

  closeAllMenus(): void {
    this.isFilterMenuOpen = false;
    this.isSortMenuOpen = false;
    this.isMoreMenuOpen = false;
    this.isExportMenuOpen = false;
  }

  categoryClass(category: ArticleCategory): string {
    const map: Record<ArticleCategory, string> = {
      'Hoa hồng': 'cat--rose',
      'Hoa cưới': 'cat--wedding',
      'Hoa sinh nhật': 'cat--birthday',
      'Hoa tang lễ': 'cat--funeral',
      'Hoa văn phòng': 'cat--office',
      'Mẹo cắm hoa': 'cat--tips',
      'Tin tức': 'cat--news',
      'Xu hướng': 'cat--trend',
      'Gợi ý quà tặng': 'cat--gift',
      'Kiến thức hoa': 'cat--knowledge',
      'Mẹo chăm sóc': 'cat--care',
    };

    return map[category] ?? '';
  }

  contentTypeClass(type: WebContentType): string {
    const map: Record<WebContentType, string> = {
      'Chính sách': 'wtype--policy',
      'Giới thiệu': 'wtype--about',
      'Hướng dẫn': 'wtype--guide',
      FAQ: 'wtype--faq',
    };

    return map[type] ?? '';
  }

  fileTypeIcon(fileType: FileType): string {
    return fileType === 'PDF'
      ? 'bi-file-earmark-pdf-fill'
      : 'bi-file-earmark-word-fill';
  }

  fileTypeIconClass(fileType: FileType): string {
    return fileType === 'PDF' ? 'icon--pdf' : 'icon--docx';
  }

  onAddClick(): void {
    if (this.activeTab === 'Blog') {
      this.router.navigate(['/content/create-article']);
    } else {
      this.openAddPopup();
    }
  }

  private loadArticles(): void {
    this.adminApi.getBlogs().subscribe({
      next: (blogs) => {
        this.allArticles = blogs.map((blog) => this.mapBlogRow(blog));
        this.currentPage = 1;
        this.ensureValidPage();
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Cannot load blogs from SQL', error);
      }
    });
  }

  private mapBlogRow(row: AdminBlogRow): Article {
    return {
      id: row.BAI_VIET_ID,
      title: row.TIEU_DE || '',
      updatedAt: this.formatSqlDate(row.NGAY_DANG),
      category: row.DANH_MUC_BLOG || '',
      author: row.TEN_NHAN_VIEN || row.NHAN_VIEN_ID || '',
      views: Number(row.LUOT_XEM || 0),
      selected: false,
    };
  }

  private formatSqlDate(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return [
      String(date.getDate()).padStart(2, '0'),
      String(date.getMonth() + 1).padStart(2, '0'),
      date.getFullYear(),
    ].join('/');
  }

  private emptyForm(): WebContentForm {
    return {
      name: '',
      contentType: '',
      note: '',
      updatedAt: '',
      status: '',
      fileName: '',
      fileSize: '',
      fileType: '',
    };
  }

  private resetFormErrors(): void {
    this.formErrors = {
      name: false,
      contentType: false,
      updatedAt: false,
      status: false,
      file: false,
    };
  }

  private isValidDateString(date: string): boolean {
    const trimmed = date.trim();
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);

    if (!match) return false;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);

    if (month < 1 || month > 12) return false;

    const daysInMonth = new Date(year, month, 0).getDate();

    return day >= 1 && day <= daysInMonth;
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }

    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  private ensureValidPage(): void {
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }

    if (this.currentPage < 1) {
      this.currentPage = 1;
    }
  }
  private normalize(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  private parseDate(date: string): number {
    const [day, month, year] = date.split('/').map(Number);
    return new Date(year, month - 1, day).getTime();
  }

  private filterByDate(list: Article[]): Article[] {
    if (this.dateFilter === 'Tất cả') return list;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return list.filter(article => {
      const d = new Date(this.parseDate(article.updatedAt));
      const current = new Date(d.getFullYear(), d.getMonth(), d.getDate());

      if (this.dateFilter === 'Hôm nay') {
        return current.getTime() === today.getTime();
      }

      if (this.dateFilter === '7 ngày gần đây') {
        const past = new Date(today);
        past.setDate(today.getDate() - 7);
        return current >= past && current <= today;
      }

      if (this.dateFilter === '30 ngày gần đây') {
        const past = new Date(today);
        past.setDate(today.getDate() - 30);
        return current >= past && current <= today;
      }

      if (this.dateFilter === 'Tháng này') {
        return current.getMonth() === today.getMonth() && current.getFullYear() === today.getFullYear();
      }

      return true;
    });
  }

  private sortWebContents(list: WebContent[]): WebContent[] {
    const sorted = [...list];

    if (this.wcSortOption === 'Ngày mới nhất') {
      return sorted.sort((a, b) => this.parseDate(b.updatedAt) - this.parseDate(a.updatedAt));
    }

    if (this.wcSortOption === 'Ngày cũ nhất') {
      return sorted.sort((a, b) => this.parseDate(a.updatedAt) - this.parseDate(b.updatedAt));
    }

    if (this.wcSortOption === 'Tên A-Z') {
      return sorted.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    }

    if (this.wcSortOption === 'Tên Z-A') {
      return sorted.sort((a, b) => b.name.localeCompare(a.name, 'vi'));
    }

    return sorted;
  }

  private sortArticles(list: Article[]): Article[] {
    const sorted = [...list];

    if (this.sortOption === 'Ngày mới nhất') {
      return sorted.sort((a, b) => this.parseDate(b.updatedAt) - this.parseDate(a.updatedAt));
    }

    if (this.sortOption === 'Ngày cũ nhất') {
      return sorted.sort((a, b) => this.parseDate(a.updatedAt) - this.parseDate(b.updatedAt));
    }

    if (this.sortOption === 'Lượt xem nhiều nhất') {
      return sorted.sort((a, b) => b.views - a.views);
    }

    if (this.sortOption === 'Lượt xem ít nhất') {
      return sorted.sort((a, b) => a.views - b.views);
    }

    if (this.sortOption === 'Mã bài A-Z') {
      return sorted.sort((a, b) => a.id.localeCompare(b.id));
    }

    if (this.sortOption === 'Mã bài Z-A') {
      return sorted.sort((a, b) => b.id.localeCompare(a.id));
    }

    return sorted;
  }

  private buildExportRows(): {
    header: string[];
    rows: (string | number)[][];
    fileBase: string;
  } {
    const stamp = new Date().toISOString().slice(0, 10);

    if (this.activeTab === 'Blog') {
      const source = this.selectedArticles.length ? this.selectedArticles : this.filteredArticles;
      const header = ['Mã bài', 'Tiêu đề', 'Ngày cập nhật', 'Danh mục', 'Tác giả', 'Lượt xem'];
      const rows = source.map(article => [
        article.id,
        article.title,
        article.updatedAt,
        article.category,
        article.author,
        article.views,
      ]);

      return {
        header,
        rows,
        fileBase: `bai-viet_${stamp}`,
      };
    }

    const source = this.selectedWebContents.length ? this.selectedWebContents : this.filteredWebContents;
    const header = ['Mã', 'Tên', 'Loại nội dung', 'Loại file', 'Ngày cập nhật', 'Trạng thái', 'Tên file', 'Dung lượng'];
    const rows = source.map(item => [
      item.id,
      item.name,
      item.contentType,
      item.fileType,
      item.updatedAt,
      item.status,
      item.fileName,
      item.fileSize,
    ]);

    return {
      header,
      rows,
      fileBase: `thong-tin-website_${stamp}`,
    };
  }

  private async saveOrDownload(blob: Blob, fileName: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
