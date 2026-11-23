import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Subscription, switchMap } from 'rxjs';
import { apiBaseUrl } from '../../services/api-config';
@Component({ selector: 'app-blog', standalone: true, imports: [CommonModule, FormsModule, RouterLink], templateUrl: './blog.html', styleUrl: './blog.css' })
export class BlogComponent implements OnInit, OnDestroy {
    private http = inject(HttpClient);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private cdr = inject(ChangeDetectorRef);
    private sub?: Subscription;
    posts: any[] = [];
    categories: string[] = [];
    keyword = '';
    category = '';
    page = 1;
    total = 0;
    /** 1 bài lớn + 9 bài (lưới 3x3) mỗi trang. */
    readonly pageSize = 10;
    loading = false;
    error = '';
    ngOnInit() { this.http.get<string[]>(`${apiBaseUrl()}/blogs/categories`).subscribe({ next: r => { this.categories = r; this.cdr.markForCheck(); } }); this.sub = this.route.queryParamMap.pipe(switchMap(p => { this.keyword = p.get('keyword') || ''; this.category = p.get('category') || ''; this.page = Math.max(1, Number(p.get('page')) || 1); this.loading = true; this.error = ''; return this.http.get<any>(`${apiBaseUrl()}/blogs`, { params: new HttpParams().set('keyword', this.keyword).set('category', this.category).set('page', this.page).set('pageSize', this.pageSize) }); })).subscribe({ next: r => { this.posts = r.blogs; this.total = r.total; this.loading = false; this.cdr.markForCheck(); }, error: () => { this.error = 'Chưa tải được bài viết. Vui lòng tải lại trang.'; this.loading = false; this.cdr.markForCheck(); } }); }
    ngOnDestroy() { this.sub?.unsubscribe(); }
    filter(category = this.category) { this.router.navigate(['/blog'], { queryParams: { keyword: this.keyword || null, category: category || null, page: 1 } }); }
    turn(page: number) { this.router.navigate(['/blog'], { queryParams: { keyword: this.keyword || null, category: this.category || null, page } }); }
    excerpt(s: string, max = 140) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) + '…'; }
    /** Bài đầu mỗi trang hiện dạng thẻ lớn; nhãn "Bài nổi bật" chỉ ở trang 1 chưa lọc. */
    get featured() { return this.posts.length ? this.posts[0] : null; }
    get isTopFeatured() { return this.page === 1 && !this.keyword && !this.category; }
    get gridPosts() { return this.featured ? this.posts.slice(1) : this.posts; }
    get totalPages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); }
    get pageNumbers() { const last = this.totalPages, start = Math.max(1, Math.min(this.page - 2, last - 4)); return Array.from({ length: Math.min(5, last) }, (_, i) => start + i); }
    image(url: string) { return url?.startsWith('/') ? apiBaseUrl().replace(/\/api$/, '') + url : url || 'assets/images/blog.png'; }
    fallback(e: Event) { const img = e.target as HTMLImageElement; if (!img.src.endsWith('/assets/images/blog.png'))
        img.src = 'assets/images/blog.png'; }
}
