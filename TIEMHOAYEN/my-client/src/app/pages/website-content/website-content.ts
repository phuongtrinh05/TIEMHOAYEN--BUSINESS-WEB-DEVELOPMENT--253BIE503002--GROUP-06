import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { apiBaseUrl } from '../../services/api-config';
@Component({ selector: 'app-website-content', standalone: true, imports: [CommonModule, RouterLink], template: `<main class="page"><a routerLink="/">← Trang chủ</a>@if(loading){<p>Đang tải nội dung…</p>}@else if(content){<h1>{{content.TEN_NOI_DUNG}}</h1><div class="body" [innerHTML]="content.NOI_DUNG_HTML"></div>@if(content.TEP_TIN){<a class="file" [href]="fileUrl(content.TEP_TIN.url)" target="_blank" rel="noopener noreferrer">{{content.TEP_TIN.name}} ↗</a>}}@else{<h1>Nội dung không khả dụng</h1><p>Nội dung chưa được công khai hoặc đã được ẩn.</p>}</main>`, styles: [`.page{max-width:900px;padding:45px 25px;margin:auto;color:#624642;min-height:50vh}.page a{color:#781b20;text-decoration:none;font-size:13px}.page h1{font-family:Georgia,serif;color:#781b20;margin:30px 0;font-size:32px}.body{font-size:16px;line-height:1.8;overflow-wrap:anywhere}.body img{max-width:100%;height:auto}.file{display:inline-block;padding:12px 15px;border:1px solid #e6c9c3;border-radius:7px;margin-top:20px}`] })
export class WebsiteContent implements OnInit {
    private route = inject(ActivatedRoute);
    private http = inject(HttpClient);
    private cdr = inject(ChangeDetectorRef);
    loading = true;
    content: any;
    fileUrl(s: string) { return s.startsWith('/') ? apiBaseUrl().replace(/\/api$/, '') + s : s; }
    ngOnInit() { this.route.paramMap.subscribe(p => { this.loading = true; this.content = null; this.http.get(`${apiBaseUrl()}/content/website/${encodeURIComponent(p.get('code') || '')}`).subscribe({ next: r => { this.content = r; this.loading = false; this.cdr.markForCheck(); }, error: () => { this.loading = false; this.cdr.markForCheck(); } }); }); }
}
