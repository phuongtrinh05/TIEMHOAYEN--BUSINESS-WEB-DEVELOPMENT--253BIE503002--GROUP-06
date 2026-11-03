import { Component, inject, OnDestroy, OnInit, ChangeDetectorRef, AfterViewChecked, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { apiBaseUrl } from '../../../services/api-config';
@Component({selector:'app-support-inbox',standalone:true,imports:[CommonModule,FormsModule,RouterLink],templateUrl:'./support-inbox.html',styleUrl:'./support-inbox.css'})
export class SupportInbox implements OnInit, OnDestroy, AfterViewChecked {
    @ViewChild('messageList') private messageList?: ElementRef<HTMLElement>;
    private stickToBottom = true;
    private scrollKey = '';
    onMessageScroll() {
        const el = this.messageList?.nativeElement;
        if (el) this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    }
    ngAfterViewChecked() {
        const key = `${this.active?.id}:${this.messages.at(-1)?.id}`;
        if (this.messageList && key !== this.scrollKey) {
            this.scrollKey = key;
            if (this.stickToBottom) this.messageList.nativeElement.scrollTop = this.messageList.nativeElement.scrollHeight;
        }
    }
    private http = inject(HttpClient);
    private cdr = inject(ChangeDetectorRef);
    private route = inject(ActivatedRoute);
    private timer?: ReturnType<typeof setInterval>;
    tickets: any[] = [];
    active: any;
    messages: any[] = [];
    staff: any[] = [];
    page = 1;
    total = 0;
    pending = 0;
    status = '';
    source = '';
    search = '';
    reply = '';
    replyImageDataUrl = '';
    replyImageName = '';
    note = '';
    targetStaff = '';
    error = '';
    busy = false;
    testOpen = false;
    testText = '';
    testProduct = '';
    testResult: any;
    testBusy = false;
    infoOpen = false;
    private selectedId = '';
    initials(name: string) { return (name || 'Khách').trim().split(/\s+/).slice(-2).map(s => s[0]).join('').toUpperCase(); }
    modeLabel(mode: string) { return mode === 'AI' ? 'Trợ lý AI' : mode === 'WAITING' ? 'Chờ tiếp nhận' : 'Nhân viên hỗ trợ'; }
    private get url() { return `${apiBaseUrl()}/support/admin`; }
    get visibleTickets() { const k = this.search.trim().toLowerCase(); return this.tickets.filter(t => !k || `${t.name} ${t.phone} ${t.id}`.toLowerCase().includes(k)); }
    get canHandle() { return this.active?.assignedTo === localStorage.getItem('adminEmployeeId') || localStorage.getItem('adminRole') === 'Admin'; }
    ngOnInit() { if (typeof window === 'undefined')
        return; this.testOpen = this.route.snapshot.queryParamMap.get('test') === '1'; this.load(); const id = this.route.snapshot.queryParamMap.get('ticketId'); if (id)
        this.open(id); this.http.get<any[]>(`${this.url}/staff`).subscribe({ next: r => { this.staff = r; this.cdr.markForCheck(); }, error: e => this.fail(e) }); this.timer = setInterval(() => { if (!document.hidden && !this.busy) {
        this.load();
        if (this.active)
            this.open(this.active.id, true);
    } }, 5000); }
    ngOnDestroy() { if (this.timer)
        clearInterval(this.timer); }
    load() { this.http.get<any>(`${this.url}/tickets`, { params: new HttpParams().set('page', this.page).set('status', this.status).set('source', this.source) }).subscribe({ next: r => { this.tickets = r.tickets; this.total = r.total; this.pending = r.pending; this.cdr.markForCheck(); }, error: e => this.fail(e) }); }
    open(id: string, quiet = false) { if (quiet && id !== this.selectedId) return; if (!quiet) { this.selectedId = id; this.stickToBottom = true;
        this.error = '';
        this.reply = '';
        this.clearReplyImage();
        this.note = '';
    } const latest = quiet && this.messages.length ? this.messages[this.messages.length - 1]?.at : '';
      const params = latest ? new HttpParams().set('after', latest) : undefined;
      this.http.get<any>(`${this.url}/tickets/${id}`, { params }).subscribe({ next: r => { if (id !== this.selectedId) return; this.active = r.ticket; this.messages = r.incremental ? this.mergeMessages(this.messages, r.messages) : r.messages; this.cdr.markForCheck(); }, error: e => this.fail(e) }); }
    imageUrl(url: string) { return url?.startsWith('/') ? `${apiBaseUrl().replace(/\/api$/, '')}${url}` : url; }
    private mergeMessages(current: any[], incoming: any[]) { const byId = new Map(current.map(m => [m.id, m])); for (const message of incoming || []) byId.set(message.id, message); return [...byId.values()].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()); }
    act(action: string, text = '') { if (this.busy || !this.active)
        return; this.busy = true; this.error = ''; const id = this.active.id; this.http.post(`${this.url}/tickets/${id}/actions`, { action, text, version: this.active.version, employeeId: this.targetStaff, ...(action === 'reply' && this.replyImageDataUrl ? { imageDataUrl: this.replyImageDataUrl } : {}) }).subscribe({ next: () => { this.busy = false; if (action === 'reply') {
            this.reply = '';
            this.clearReplyImage();
        } if (action === 'note')
            this.note = ''; this.open(id, true); this.load(); }, error: e => { this.fail(e); this.open(id, true); } }); }
    onReplyFileSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file)
            return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            this.error = 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WEBP.';
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            this.error = 'Ảnh không được vượt quá 5MB.';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            this.replyImageDataUrl = String(reader.result || '');
            this.replyImageName = file.name;
            this.error = '';
            this.cdr.markForCheck();
        };
        reader.onerror = () => this.fail({ error: { message: 'Không đọc được ảnh. Vui lòng chọn lại.' } });
        reader.readAsDataURL(file);
    }
    clearReplyImage() { this.replyImageDataUrl = ''; this.replyImageName = ''; }
    test() { if (this.testBusy)
        return; this.testBusy = true; this.error = ''; this.http.post<any>(`${this.url}/test`, { chatInput: this.testText, productId: this.testProduct }).subscribe({ next: r => { this.testResult = r; this.testBusy = false; this.cdr.markForCheck(); }, error: e => { this.testBusy = false; this.fail(e); } }); }
    private fail(e: any) { this.busy = false; this.error = e?.error?.message || 'Chưa tải/lưu được dữ liệu.'; this.cdr.markForCheck(); }
}
