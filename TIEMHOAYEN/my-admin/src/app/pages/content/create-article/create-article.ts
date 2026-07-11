import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorModule } from '@tinymce/tinymce-angular';
import { Router } from '@angular/router';
import { ArticleCategory } from '../article-list/article-list';
import { AdminApiService } from '../../../services/admin-api.service';

// ===== TYPES =====
export interface CreateArticleForm {
  title: string;
  author: string;
  email: string;
  category: ArticleCategory | '';
  content: string;
}

@Component({
  selector: 'app-create-article',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    EditorModule],
  templateUrl: './create-article.html',
  styleUrl: './create-article.css',
})
export class CreateArticle implements OnInit {

  isSaving = false;
  today = '';
  submitted = false;

  // ===== TOAST THÔNG BÁO =====
  toastMessage = '';
  toastVisible = false;
  private toastTimeoutId?: ReturnType<typeof setTimeout>;

  // TODO: thay bằng API key thật lấy từ https://www.tiny.cloud/auth/signup/
  // Nhớ vào dashboard > Approved Domains, thêm "localhost" và domain deploy (nếu có)
  tinyMceApiKey = 'tnmscopp661zgr8581ytafirjrmngof4c1yknsleey6wxrvj';
  editorContent = '';

  form: CreateArticleForm = {
    title: '',
    author: '',
    email: '',
    category: '',
    content: '',
  };

  constructor(
    private readonly adminApi: AdminApiService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    this.today = `${dd}/${mm}/${yyyy}`;
  }

  // ===== KIỂM TRA NỘI DUNG RỖNG =====
  // TinyMCE có thể trả về "<p></p>" hoặc "<p><br></p>" dù chưa gõ gì,
  // nên phải bóc hết thẻ HTML rồi mới kiểm tra rỗng.
  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }

  get isContentEmpty(): boolean {
    return this.stripHtml(this.editorContent) === '';
  }

  // ===== TẠO BÀI VIẾT =====
  saveArticle(): void {
    if (this.isSaving) return; // chặn bấm nhiều lần liên tiếp khi đang lưu

    this.submitted = true;

    if (
      !this.form.title.trim() ||
      !this.form.author.trim() ||
      !this.form.email.trim() ||
      !this.form.category ||
      this.isContentEmpty
    ) {
      return;
    }

    this.isSaving = true;

    this.adminApi.createBlog({
      title: this.form.title.trim(),
      content: this.editorContent,
      category: this.form.category,
      author: this.form.author.trim(),
      email: this.form.email.trim(),
      status: 'Hiển thị',
    }).subscribe({
      next: (response) => {
        this.isSaving = false;
        this.showToast('Blog đã được tạo!');
        const blogId = response.blog?.BAI_VIET_ID;
        if (blogId) {
          this.router.navigate(['/content/article-detail', blogId]);
        }
      },
      error: (error) => {
        console.error('Cannot create blog', error);
        this.isSaving = false;
        alert('Không thể tạo bài viết. Vui lòng thử lại.');
      }
    });
    // Không reset form, không điều hướng — ở nguyên trang sau khi tạo thành công.
  }

  goBack(): void {
    this.router.navigate(['/content/article-list']);
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

  // ===== TINYMCE EDITOR =====
  tinyMceConfig = {
    height: 420,
    menubar: false,
    branding: false,
    promotion: false,
    resize: true,
    statusbar: false,
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
    this.form.content = this.editorContent;
  }
}
