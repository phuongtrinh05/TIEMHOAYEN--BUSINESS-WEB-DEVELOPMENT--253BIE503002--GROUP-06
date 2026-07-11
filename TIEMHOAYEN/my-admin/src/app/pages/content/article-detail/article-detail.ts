import { ChangeDetectorRef, Component, ElementRef, Inject, OnInit, PLATFORM_ID, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorModule } from '@tinymce/tinymce-angular';
import { ActivatedRoute, Router } from '@angular/router';
import { timeout } from 'rxjs';
import type { Article, ArticleCategory } from '../article-list/article-list';
import { AdminApiService, AdminBlogRow } from '../../../services/admin-api.service';

// ===== TYPES =====
export interface ArticleData {
  id: string;
  staffId?: string;
  title: string;
  author: string;
  email: string;
  updatedAt: string;
  category: ArticleCategory;
  avatarUrl: string | null;
  coverImage?: string;
  status?: string;
  content: string;
}

@Component({
  selector: 'app-article-detail',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    EditorModule
  ],
  templateUrl: './article-detail.html',
  styleUrl: './article-detail.css',
})
export class ArticleDetail implements OnInit {
  @ViewChild('dateNative') dateNativeInput?: ElementRef<HTMLInputElement>;

  article: ArticleData | null = null;
  editorContent = '';
  editorKey = '';
  isEditorReady = false;
  isEditing = false;
  isSaving = false;
  isLoadingArticle = false;

  private setArticle(article: ArticleData): void {
    this.isEditorReady = false;
    this.cdr.detectChanges();

    this.article = article;
    this.editorContent = article.content;
    this.editorKey = `${article.id}-${Date.now()}`;
    this.isEditorReady = true;
    this.cdr.detectChanges();
  }

  private loadArticle(articleId: string): void {
    this.isLoadingArticle = true;
    this.cdr.detectChanges();

    this.adminApi.getBlog(articleId).pipe(timeout(8000)).subscribe({
      next: (blog) => {
        this.setArticle(this.mapBlogRow(blog));
        this.isLoadingArticle = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Cannot load blog detail', error);
        if (!this.article) {
          this.editorContent = '';
        }
        this.isLoadingArticle = false;
        this.cdr.detectChanges();
      }
    });
  }

  private mapBlogRow(row: AdminBlogRow): ArticleData {
    return {
      id: row.BAI_VIET_ID,
      staffId: row.NHAN_VIEN_ID || '',
      title: row.TIEU_DE || '',
      author: row.TEN_NHAN_VIEN || row.NHAN_VIEN_ID || '',
      email: row.EMAIL_NHAN_VIEN || '',
      updatedAt: this.formatSqlDate(row.NGAY_DANG),
      category: row.DANH_MUC_BLOG || '',
      avatarUrl: null,
      coverImage: row.ANH_BIA || '',
      status: row.TRANG_THAI || '',
      content: row.NOI_DUNG || '',
    };
  }

  private mapArticleState(article: Article): ArticleData {
    return {
      id: article.id,
      title: article.title || '',
      author: article.author || '',
      email: '',
      updatedAt: article.updatedAt || '',
      category: article.category || '',
      avatarUrl: null,
      content: '',
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

  // ===== TOAST THÔNG BÁO =====
  toastMessage = '';
  toastVisible = false;
  private toastTimeoutId?: ReturnType<typeof setTimeout>;

  // ===== POPUP XÁC NHẬN XÓA =====
  isDeleteConfirmOpen = false;

  // TODO: thay bằng API key thật lấy từ https://www.tiny.cloud/auth/signup/
  // Nhớ vào dashboard > Approved Domains, thêm "localhost" và domain deploy (nếu có)


  // Draft dùng riêng khi edit, không sửa bài gốc cho tới khi bấm Lưu
  draft: Partial<ArticleData> = {};

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly adminApi: AdminApiService,
    private readonly cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private readonly platformId: object,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const articleId = params.get('id');

      if (!articleId) {
        this.article = null;
        this.editorContent = '';
        this.isEditorReady = false;
        return;
      }

      if (!isPlatformBrowser(this.platformId)) {
        this.isLoadingArticle = false;
        return;
      }

      const stateArticle = typeof history !== 'undefined'
        ? (history.state?.article as Article | undefined)
        : undefined;
      if (stateArticle?.id === articleId) {
        this.setArticle(this.mapArticleState(stateArticle));
      }

      setTimeout(() => this.loadArticle(articleId), 0);
    });
  }

  // ===== CATEGORY CSS CLASS =====
  categoryClass(cat: ArticleCategory): string {
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

    return map[cat] ?? '';
  }

  // ===== AUTHOR INITIALS =====
  get authorInitials(): string {
    if (!this.article?.author) return '';

    return this.article.author
      .trim()
      .split(/\s+/)
      .map(word => word[0])
      .slice(-2)
      .join('')
      .toUpperCase();
  }

  editSubmitted = false;

  // ===== EDIT MODE =====
  startEdit(): void {
    if (!this.article) return;
    this.draft = { ...this.article };
    this.editorContent = this.article.content;
    this.isEditing = true;
    this.editSubmitted = false;
  }

  cancelEdit(): void {
    this.draft = {};
    this.editorContent = this.article?.content ?? '';
    this.isEditing = false;
    this.editSubmitted = false;
  }

  saveArticle(): void {
    if (!this.article || this.isSaving) return;
    this.editSubmitted = true;

    if (!this.draft.title?.trim() || !this.draft.author?.trim() ||
        !this.draft.email?.trim() || !this.draft.updatedAt?.trim()) return;

    this.draft.content = this.editorContent;
    this.isSaving = true;

    const updatedArticle: ArticleData = {
      ...this.article,
      ...this.draft,
      content: this.draft.content ?? this.editorContent,
    } as ArticleData;

    this.adminApi.updateBlog(updatedArticle.id, {
      title: updatedArticle.title,
      content: updatedArticle.content,
      category: updatedArticle.category,
      author: updatedArticle.author,
      email: updatedArticle.email,
      staffId: updatedArticle.staffId,
      coverImage: updatedArticle.coverImage,
      status: updatedArticle.status || undefined,
    }).subscribe({
      next: (response) => {
        this.article = this.mapBlogRow(response.blog);
        this.editorContent = this.article.content;
        this.draft = {};
        this.isEditing = false;
        this.isSaving = false;
        this.editSubmitted = false;
        this.showToast('Blog saved!');
      },
      error: (error) => {
        console.error('Cannot save blog', error);
        this.isSaving = false;
        alert('Cannot save blog. Please try again.');
      }
    });
  }

  requestDeleteArticle(): void {
    if (!this.article) return;
    this.isDeleteConfirmOpen = true;
  }

  cancelDeleteArticle(): void {
    this.isDeleteConfirmOpen = false;
  }

  confirmDeleteArticle(): void {
    if (!this.article) return;

    const deletedId = this.article.id;
    this.adminApi.deleteBlog(deletedId).subscribe({
      next: () => {
        this.article = null;
        this.editorContent = '';
        this.isEditing = false;
        this.draft = {};
        this.isDeleteConfirmOpen = false;
        this.showToast('Blog deleted!');
        this.router.navigate(['/content/article-list']);
      },
      error: (error) => {
        console.error('Cannot delete blog', error);
        this.isDeleteConfirmOpen = false;
        alert('Cannot delete blog. Please try again.');
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/content/article-list']);
  }

  onDraftDatePicked(iso: string): void {
    if (!iso) return;
    const [yyyy, mm, dd] = iso.split('-');
    this.draft.updatedAt = `${dd}/${mm}/${yyyy}`;
  }

  openDatePicker(): void {
    const input = this.dateNativeInput?.nativeElement;
    if (!input) return;

    try {
      input.showPicker?.();
    } catch {
      // Trình duyệt không hỗ trợ showPicker(): focus vào input để người dùng
      // có thể mở lịch bằng bàn phím (phím mũi tên xuống) như phương án dự phòng.
      input.focus();
    }
  }

  // ===== TINYMCE EDITOR =====
  tinyMceConfig = {
    base_url: '/tinymce',
    suffix: '.min',
    license_key: 'gpl',
    height: 420,
    menubar: false,
    branding: false,
    promotion: false,
    resize: true,
    plugins: 'lists link image media table code charmap autoresize advlist',
    toolbar:
      'undo redo | blocks fontsize | bold italic underline strikethrough superscript subscript removeformat | ' +
      'bullist numlist outdent indent | forecolor backcolor | alignleft aligncenter alignright alignjustify | ' +
      'blockquote image media table charmap code',
    fontsize_formats: '8px 10px 12px 14px 16px 18px 24px 30px 36px 48px 60px 72px',
    block_formats:
      'Đoạn văn=p; Heading 1=h1; Heading 2=h2; Heading 3=h3; Heading 4=h4; Trích dẫn=blockquote; Khối code=pre',
    automatic_uploads: true,
    file_picker_types: 'image media',
    content_style: `
      body {
        font-family: Arial, sans-serif;
        font-size: 16px;
        line-height: 1.75;
        color: #2f2f2f;
        padding: 12px 18px;
      }
      h1, h2, h3, h4 {
        color: #731919;
        font-weight: 700;
      }
      p {
        margin: 0 0 12px;
      }
      blockquote {
        border-left: 3px solid #731919;
        margin: 12px 0;
        padding: 8px 16px;
        background: #fff7f7;
        color: #555;
        font-style: italic;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border: 1px solid #D1D5DB;
        padding: 8px 10px;
      }
      img, iframe {
        max-width: 100%;
      }
    `,
  };

  onTinyMceChange(): void {
    this.draft.content = this.editorContent;
  }

  // ===== TOAST THÔNG BÁO =====
  showToast(message: string): void {
    this.toastMessage = message;
    this.toastVisible = true;

    if (this.toastTimeoutId) clearTimeout(this.toastTimeoutId);
    this.toastTimeoutId = setTimeout(() => {
      this.toastVisible = false;
    }, 2500);
  }
}
