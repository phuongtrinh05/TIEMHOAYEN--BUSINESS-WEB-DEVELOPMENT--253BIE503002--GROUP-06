import { CommonModule } from '@angular/common';
import { Component, OnInit, ChangeDetectorRef, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BlogService, Blog } from '../../services/blog.service';

interface BlogPost {
  id: string;
  title: string;
  date: string;
  image: string;
}

@Component({
  selector: 'app-blog-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './blog-detail.html',
  styleUrl: './blog-detail.css',
  encapsulation: ViewEncapsulation.None
})
export class BlogDetailComponent implements OnInit {
  post: {
    id: string;
    title: string;
    date: string;
    image: string;
    content: string;
  } | null = null;

  latestPosts: BlogPost[] = [];
  loading = true;

  constructor(
    private route: ActivatedRoute,
    private blogService: BlogService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.scrollToTopInstant();

      const id = params.get('id');

      if (!id) {
        this.post = null;
        this.loading = false;
        this.cdr.detectChanges();
        return;
      }

      this.loadPostDetail(id);
      this.loadLatestPosts(id);
    });
  }

  private loadPostDetail(id: string): void {
    this.loading = true;
    this.post = null;
    this.cdr.detectChanges();

    this.scrollToTopInstant();

    this.blogService.getById(id).subscribe({
      next: (data: Blog) => {
        this.post = {
          id: data.BAI_VIET_ID,
          title: data.TIEU_DE,
          date: this.formatDate(data.NGAY_DANG),
          image: data.ANH_BIA,
          content: data.NOI_DUNG
        };

        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err: unknown) => {
        console.error('Lỗi load chi tiết blog:', err);

        this.post = null;
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  private loadLatestPosts(currentId: string): void {
    this.blogService.getAll().subscribe({
      next: (data: Blog[]) => {
        this.latestPosts = data
          .filter((item: Blog) => item.BAI_VIET_ID !== currentId)
          .sort((a: Blog, b: Blog) => {
            return new Date(b.NGAY_DANG).getTime() - new Date(a.NGAY_DANG).getTime();
          })
          .slice(0, 4)
          .map((item: Blog) => ({
            id: item.BAI_VIET_ID,
            title: item.TIEU_DE,
            date: this.formatDate(item.NGAY_DANG),
            image: item.ANH_BIA
          }));

        this.cdr.detectChanges();
      },
      error: (err: unknown) => {
        console.error('Lỗi load bài mới nhất:', err);
      }
    });
  }

  private formatDate(date: string): string {
    return new Date(date).toLocaleDateString('vi-VN');
  }

  private scrollToTopInstant(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const html = document.documentElement;
    const body = document.body;

    const oldHtmlScrollBehavior = html.style.scrollBehavior;
    const oldBodyScrollBehavior = body.style.scrollBehavior;

    html.style.scrollBehavior = 'auto';
    body.style.scrollBehavior = 'auto';

    window.scrollTo(0, 0);
    html.scrollTop = 0;
    body.scrollTop = 0;

    html.style.scrollBehavior = oldHtmlScrollBehavior;
    body.style.scrollBehavior = oldBodyScrollBehavior;
  }
}