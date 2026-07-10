import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BlogService, Blog } from '../../services/blog.service';

interface BlogPost {
  id: string;
  title: string;
  excerpt: string;
  date: string;
  image: string;
}

@Component({
  selector: 'app-blog',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './blog.html',
  styleUrl: './blog.css'
})
export class BlogComponent implements OnInit, AfterViewInit, OnDestroy {
  allPosts: BlogPost[] = [];
  posts: BlogPost[] = [];

  pageSize = 4;
  currentPage = 1;
  totalPages = 1;
  private revealObserver?: IntersectionObserver;

  constructor(
    private blogService: BlogService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.blogService.getAll().subscribe({
      next: (data) => {
        try {
          this.allPosts = data
            .sort((a: Blog, b: Blog) => {
              return new Date(b.NGAY_DANG).getTime() - new Date(a.NGAY_DANG).getTime();
            })
            .map((item: Blog) => ({
              id: item.BAI_VIET_ID,
              title: item.TIEU_DE,
              excerpt: this.getBlogExcerpt(item.NOI_DUNG),
              date: this.formatDate(item.NGAY_DANG),
              image: item.ANH_BIA
            }));

          this.totalPages = Math.ceil(this.allPosts.length / this.pageSize) || 1;
          this.goToPage(1);
          this.cdr.detectChanges();
        } catch (e) {
          console.error('LỖI MAP:', e);
        }
      },
      error: (err) => {
        console.error('Lỗi load blog:', err);
      }
    });
  }

  ngAfterViewInit(): void {
    this.muteBlogVideos();
  }

  ngOnDestroy(): void {
    this.revealObserver?.disconnect();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) {
      return;
    }

    this.currentPage = page;

    const start = (page - 1) * this.pageSize;
    const end = start + this.pageSize;
    this.posts = this.allPosts.slice(start, end);

    this.cdr.detectChanges();
    setTimeout(() => this.observeBlogItems());
  }

  private observeBlogItems(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const items = Array.from(document.querySelectorAll<HTMLElement>('.blog-item'));

    this.revealObserver?.disconnect();

    if (!('IntersectionObserver' in window)) {
      items.forEach((item) => item.classList.add('is-visible'));
      return;
    }

    this.revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          entry.target.classList.add('is-visible');
          this.revealObserver?.unobserve(entry.target);
        });
      },
      {
        root: null,
        rootMargin: '0px 0px -8% 0px',
        threshold: 0.12,
      }
    );

    items.forEach((item) => this.revealObserver?.observe(item));
  }

  private muteBlogVideos(): void {
    if (typeof document === 'undefined') {
      return;
    }

    document.querySelectorAll<HTMLVideoElement>('.blog-page video').forEach((video) => {
      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;
      video.setAttribute('muted', '');
    });
  }

  prevPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  nextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  get pageNumbers(): (number | string)[] {
    const total = this.totalPages;
    const current = this.currentPage;
    const pages: (number | string)[] = [];

    if (total <= 7) {
      for (let i = 1; i <= total; i++) {
        pages.push(i);
      }

      return pages;
    }

    pages.push(1);

    if (current > 3) {
      pages.push('...');
    }

    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (current < total - 2) {
      pages.push('...');
    }

    pages.push(total);

    return pages;
  }

  get showingText(): string {
    if (this.allPosts.length === 0) {
      return '';
    }

    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, this.allPosts.length);

    return `Hiển thị ${start}-${end}/${this.allPosts.length} bài viết`;
  }

  private getBlogExcerpt(content: string): string {
    const contentWithoutFirstHeading = content
      ? content.replace(/^\s*<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>\s*/i, '')
      : '';

    return this.removeHtml(contentWithoutFirstHeading);
  }

  private removeHtml(html: string): string {
    return html
      ? html
          .replace(/<[^>]*>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  }

  private formatDate(date: string): string {
    return new Date(date).toLocaleDateString('vi-VN');
  }
}
