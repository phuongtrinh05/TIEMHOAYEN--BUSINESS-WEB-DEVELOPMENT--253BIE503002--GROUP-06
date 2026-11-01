import { Component, inject, OnInit, OnDestroy, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { EditorModule } from '@tinymce/tinymce-angular';
import { apiBaseUrl } from '../../../services/api-config';
@Component({ selector: 'app-content-workspace', standalone: true, imports: [CommonModule, FormsModule, RouterLink, EditorModule], templateUrl: './content-workspace.html', styleUrl: './content-workspace.css' })
export class ContentWorkspace implements OnInit, OnDestroy {
    private http = inject(HttpClient);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private cdr = inject(ChangeDetectorRef);
    selected = new Set<string>();
    sort = 'newest';
    get allSelected(){return this.blogs.length>0&&this.blogs.every(b=>this.selected.has(b.BAI_VIET_ID));}
    toggleAll(checked:boolean){this.blogs.forEach(b=>checked?this.selected.add(b.BAI_VIET_ID):this.selected.delete(b.BAI_VIET_ID));}
    toggle(id:string,checked:boolean){checked?this.selected.add(id):this.selected.delete(id);}
    editBlog(id:string){this.loadBlog(id,true);}
    async removeSelected(){const targets=this.blogs.filter(b=>this.selected.has(b.BAI_VIET_ID));if(!targets.length||!await this.ask('Xóa bài viết đã chọn?', 'Bạn sắp xóa '+targets.length+' bài viết. Thao tác này không thể hoàn tác.', 'Xóa bài viết', true))return;this.busy=true;try{for(const b of targets)await new Promise((resolve,reject)=>this.http.delete(this.api+'/blogs/admin/'+b.BAI_VIET_ID,{body:{version:b.PHIEN_BAN||0}}).subscribe({next:resolve,error:reject}));this.selected.clear();this.load();}catch(e){this.fail(e);}finally{this.busy=false;this.cdr.markForCheck();}}
    coverFailed=false;
    displayContent = '';
    coverPreview = '';
    private objectUrls: string[] = [];
    readonly api = apiBaseUrl();
    categories: string[] = [];
    blogs: any[] = [];
    contents: any[] = [];
    history: any[] = [];
    tab = 'Blog';
    keyword = '';
    category = '';
    status = '';
    from = '';
    to = '';
    page = 1;
    total = 0;
    busy = false;
    error = '';
    notice = '';
    loading = false;
    editing = false;
    readOnly = false;
    preview = false;
    id = '';
    version = 0;
    saved = '';
    saveState = '';
    timer?: ReturnType<typeof setInterval>;
    schedule = '';
    autosavedId = '';
    form = { title: '', category: '', coverImage: '', content: '', status: 'Nháp' };
    website: any = null;
    websiteReadOnly = true;
    websiteSaved = '';
    editor: any = { base_url: '/tinymce', suffix: '.min', license_key: 'gpl', height: 450, menubar: false, branding: false, plugins: 'lists link image table code', toolbar: 'undo redo | blocks | bold italic | bullist numlist | link image table | code', automatic_uploads: true, setup: (editor: any) => { editor.on('SetContent', () => this.hydrateEditor(editor)); }, images_upload_handler: async (blob: any) => { const f = new File([blob.blob()], blob.filename()); const r = await this.upload(f); return this.absolute(r.url); }, convert_urls: false, content_style: 'body{font-family:Arial,sans-serif;font-size:16px;line-height:1.8;color:#483536} img{max-width:100%;height:auto}' };
    get dirty() { return this.editing && JSON.stringify(this.form) !== this.saved; }
    @HostListener('window:beforeunload', ['$event'])
    beforeUnload(e: BeforeUnloadEvent) { if (this.dirty || this.website && JSON.stringify(this.website) !== this.websiteSaved)
        e.preventDefault(); }
    ngOnInit() { this.http.get<string[]>(`${this.api}/blogs/categories`).subscribe({ next: r => { this.categories = r; this.cdr.markForCheck(); } }); this.route.paramMap.subscribe(p => { const id = p.get('id'); if (id) {
        this.loadBlog(id);
    }
    else if (this.router.url.includes('create-article'))
        this.newBlog();
    else
        this.load(); }); this.timer = setInterval(() => { if (this.editing && !this.readOnly && this.dirty && this.form.title.trim() && !this.busy && !this.confirmation)
        this.save('autosave'); }, 30000); }
    ngOnDestroy() { this.confirmationResult?.(false); if (this.timer)
        clearInterval(this.timer); this.objectUrls.forEach(u => URL.revokeObjectURL(u)); }
    absolute(url: string) { if(!url)return ''; if(url.startsWith('/api/'))return this.api.replace(/\/api$/,'')+url; if(/^(https?:|blob:|data:)/i.test(url))return url; return new URL(url.replace(/^\//,''),window.location.origin+'/').href; }
    load() { this.loading = true; this.http.get<any>(`${this.api}/blogs/admin`, { params: new HttpParams().set('sort',this.sort).set('page', this.page).set('keyword', this.keyword).set('category', this.category).set('status', this.status).set('from', this.from).set('to', this.to ? this.to + 'T23:59:59+07:00' : '') }).subscribe({ next: r => { this.blogs = r.blogs; this.selected.clear(); this.total = r.total; this.loading = false; this.cdr.markForCheck(); }, error: e => this.fail(e) }); }
    loadWebsite() { this.tab = 'Thông tin website'; this.status = ''; this.http.get<any[]>(`${this.api}/content/admin/website`).subscribe({ next: r => { this.contents = r; this.cdr.markForCheck(); }, error: e => this.fail(e) }); }
    async newBlog() { if (!await this.canLeave())
        return; this.editing = true; this.readOnly = false; this.id = ''; this.version = 0; this.coverPreview='';this.coverFailed=false;this.form = { title: '', category: '', coverImage: '', content: '', status: 'Nháp' }; this.saved = JSON.stringify(this.form); }
    loadBlog(id: string, edit=false) { this.loading = true; this.http.get<any>(`${this.api}/blogs/admin/${id}`).subscribe({ next: b => { this.apply(b); this.editing = true; this.readOnly = !edit; this.loading = false; this.cdr.markForCheck(); }, error: e => this.fail(e) }); }
    apply(b: any) { this.id = b.BAI_VIET_ID; this.version = b.PHIEN_BAN || 0; const d = b.BAN_LAM_VIEC || b; this.form = { title: d.TIEU_DE, category: d.DANH_MUC_BLOG || '', coverImage: d.ANH_BIA || '', content: d.NOI_DUNG || '', status: b.TRANG_THAI }; this.schedule = b.THOI_DIEM_HEN_DANG ? new Date(new Date(b.THOI_DIEM_HEN_DANG).getTime() + 7 * 3600000).toISOString().slice(0, 16) : ''; this.saved = JSON.stringify(this.form); this.preparePreview(); }
    async privateImage(url: string) { if (!url.includes('/api/content/files/'))
        return this.absolute(url); const blob = await new Promise<Blob>((resolve, reject) => this.http.get(this.absolute(url), { responseType: 'blob' }).subscribe({ next: resolve, error: reject })); const local = URL.createObjectURL(blob); this.objectUrls.push(local); return local; }
    async preparePreview(html = this.form.content) { if (typeof DOMParser === 'undefined')
        return; const doc = new DOMParser().parseFromString(html || '', 'text/html'); await Promise.all(Array.from(doc.images).map(async (img) => { try {
        img.src = await this.privateImage(img.getAttribute('src') || '');
    }
    catch { } })); this.displayContent = doc.body.innerHTML; try {
        this.coverFailed=false;this.coverPreview = await this.privateImage(this.form.coverImage);
    }
    catch {
        this.coverPreview = '';this.coverFailed=true;
    } this.cdr.markForCheck(); }
    async hydrateEditor(editor: any) { const images = Array.from(editor.getBody()?.querySelectorAll('img') || []) as HTMLImageElement[]; for (const img of images) {
        const source = img.getAttribute('data-mce-src') || img.getAttribute('src') || '';
        if (source.includes('/api/content/files/') && !img.src.startsWith('blob:'))
            try {
                img.setAttribute('data-mce-src', source);
                img.src = await this.privateImage(source);
            }
            catch { }
    } }
    canLeave(): boolean | Promise<boolean> { return (!this.dirty && (!this.website || JSON.stringify(this.website) === this.websiteSaved)) || this.ask('Rời trang chỉnh sửa?', 'Thay đổi chưa lưu sẽ bị mất nếu bạn rời trang.', 'Rời trang'); }
    confirmation: { title: string; message: string; action: string; danger: boolean } | null = null;
    private confirmationResult?: (accepted: boolean) => void;
    private previousFocus: HTMLElement | null = null;
    ask(title: string, message: string, action: string, danger = false): Promise<boolean> {
        if (this.confirmation) return Promise.resolve(false);
        this.previousFocus = document.activeElement as HTMLElement;
        this.confirmation = { title, message, action, danger };
        this.cdr.markForCheck();
        setTimeout(() => document.getElementById('content-confirm-cancel')?.focus());
        return new Promise(resolve => this.confirmationResult = resolve);
    }
    answer(accepted: boolean) {
        const resolve = this.confirmationResult;
        this.confirmation = null;
        this.confirmationResult = undefined;
        this.previousFocus?.focus();
        resolve?.(accepted);
        this.cdr.markForCheck();
    }
    dialogKey(event: KeyboardEvent) {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.answer(false); }
        if (event.key === 'Tab') {
            const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button'));
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    }
    async changeTab(tab: string) {
        if (tab === this.tab) return;
        if (!await this.canLeave()) return;
        this.editing = false; this.website = null; this.tab = tab; this.page = 1; this.keyword = ''; this.status = '';
        if (tab === 'Blog') this.load(); else this.router.navigate(['/content/website-information']);
    }
    save(action = 'save', status = this.form.status) { if (this.busy)
        return; this.busy = true; this.error = ''; this.saveState = 'Đang lưu…'; const sent = JSON.stringify(this.form); const payload = { ...this.form, status, action, version: this.version, scheduledAt: this.schedule ? this.schedule + ':00+07:00' : null }; const call = this.id ? this.http.put<any>(`${this.api}/blogs/admin/${this.id}`, payload) : this.http.post<any>(`${this.api}/blogs/admin`, payload); call.subscribe({ next: r => { if (action === 'autosave' && JSON.stringify(this.form) !== sent) {
            this.id = r.blog.BAI_VIET_ID;
            this.version = r.blog.PHIEN_BAN;
            this.saved = sent;
        }
        else
            this.apply(r.blog); this.busy = false; this.saveState = 'Đã lưu lúc ' + new Date().toLocaleTimeString('vi-VN'); if (action !== 'autosave')
            this.notice = status === 'Chờ đăng' ? 'Đã hẹn đăng bài viết.' : 'Đã lưu bài viết.'; this.cdr.markForCheck(); }, error: e => { this.saveState = 'Lưu thất bại'; this.fail(e); } }); }
    async closeEditor() { if (!await this.canLeave())
        return; this.editing = false; this.router.navigate(['/content/article-list']); this.load(); }
    async remove(b: any) { if (!await this.ask('Xóa bài viết?', `Bài “${b.TIEU_DE}” sẽ bị xóa. Thao tác này không thể hoàn tác.`, 'Xóa bài viết', true))
        return; this.http.delete(`${this.api}/blogs/admin/${b.BAI_VIET_ID}`, { body: { version: b.PHIEN_BAN || 0 } }).subscribe({ next: () => this.load(), error: e => this.fail(e) }); }
    async upload(file: File) { const form = new FormData(); form.append('file', file); return await new Promise<any>((resolve, reject) => this.http.post(`${this.api}/content/files`, form).subscribe({ next: resolve, error: reject })); }
    async cover(event: Event) { const input = event.target as HTMLInputElement; const f = input.files?.[0]; if (!f)
        return; if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024) {
        this.error = 'Ảnh JPG/PNG/WebP tối đa 5 MB.';
        return;
    } this.busy = true; try {
        const r = await this.upload(f);
        this.form.coverImage = this.absolute(r.url);
        this.preparePreview();
        this.notice = 'Đã tải ảnh bìa.';
    }
    catch (e) {
        this.fail(e);
    }
    finally {
        this.busy = false;
        this.cdr.markForCheck();
        input.value = '';
    } }
    openWebsite(row?: any) { this.website = row ? { id: row.NOI_DUNG_ID, name: row.TEN_NOI_DUNG, code: row.MA_NOI_DUNG, type: row.LOAI_NOI_DUNG, content: row.NOI_DUNG_HTML, file: row.TEP_TIN, status: row.TRANG_THAI, note: row.GHI_CHU || '', version: row.PHIEN_BAN } : { name: '', code: '', type: 'Chính sách', content: '', file: null, status: 'Ẩn', note: '', version: 0 }; this.websiteReadOnly = !!row; this.websiteSaved = JSON.stringify(this.website); this.preparePreview(this.website.content); this.history = []; if (row)
        this.http.get<any[]>(`${this.api}/content/admin/website/${row.NOI_DUNG_ID}/history`).subscribe({ next: r => { this.history = r; this.cdr.markForCheck(); }, error: e => this.fail(e) }); }
    async closeWebsite() { if (!await this.canLeave())
        return; this.website = null; }
    async attach(event: Event) { const input = event.target as HTMLInputElement, f = input.files?.[0]; if (!f)
        return; if (!/\.(pdf|docx)$/i.test(f.name) || f.size > 10 * 1024 * 1024) {
        this.error = 'Chọn PDF/DOCX tối đa 10 MB.';
        return;
    } this.busy = true; try {
        this.website.file = await this.upload(f);
    }
    catch (e) {
        this.fail(e);
    }
    finally {
        this.busy = false;
        this.cdr.markForCheck();
    } }
    saveWebsite() { if (this.busy)
        return; this.busy = true; const w = this.website; const call = w.id ? this.http.put<any>(`${this.api}/content/admin/website/${w.id}`, w) : this.http.post<any>(`${this.api}/content/admin/website`, w); call.subscribe({ next: r => { this.busy = false; this.openWebsite(r); this.loadWebsite(); this.notice = 'Đã lưu nội dung và lịch sử.'; this.cdr.markForCheck(); }, error: e => this.fail(e) }); }
    download(file: any) { this.http.get(this.absolute(file.url), { responseType: 'blob' }).subscribe({ next: blob => { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = file.name || 'tai-lieu'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, error: e => this.fail(e) }); }
    fail(e: any) { this.busy = false; this.loading = false; this.error = e?.error?.message || 'Chưa thực hiện được. Vui lòng thử lại.'; this.cdr.markForCheck(); }
}
