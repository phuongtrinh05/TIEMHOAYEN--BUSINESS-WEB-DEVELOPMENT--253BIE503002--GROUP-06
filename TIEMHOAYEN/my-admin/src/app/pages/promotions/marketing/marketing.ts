import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { apiBaseUrl } from '../../../services/api-config';

@Component({ selector: 'app-marketing', standalone: true, imports: [CommonModule, FormsModule, RouterLink], templateUrl: './marketing.html', styleUrls: ['./marketing.css', './marketing-tabs.css'] })
export class Marketing implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  readonly api = apiBaseUrl() + '/marketing/admin';
  section = 'templates'; search = ''; purpose = ''; channel = ''; status = '';
  templates: any[] = []; configs: any[] = []; history: any[] = []; total = 0; page = 1;
  options: any = { purposes: [], variables: [], vouchers: [], products: [], campaigns: [], customers: [], ranks: [] };
  busy = false; loading = false; error = ''; notice = ''; detail: any = null; kind = 'template'; readOnly = true;
  preview: any = null; customerId = ''; historyConfig = ''; historyStatus = '';
  confirmation: { config: any; status: string } | null = null;
  readonly labels: any = { schedule: 'Theo lịch · một lần', order: 'Đơn hoàn thành', birthday: 'Sinh nhật · hằng năm', annual: 'Dịp đặc biệt · hằng năm', website: 'Thông báo website', email: 'Email' };
  ngOnInit() { this.load(); }
  load() {
    this.loading = true;
    this.http.get<any>(this.api + '/options').subscribe({ next: r => { this.options = r; this.cdr.markForCheck(); }, error: e => this.fail(e) });
    this.http.get<any[]>(this.api + '/templates').subscribe({ next: r => { this.templates = r; this.loading = false; this.cdr.markForCheck(); }, error: e => this.fail(e) });
    this.loadConfigs();
  }
  loadConfigs() { this.http.get<any[]>(this.api + '/configs').subscribe({ next: r => { this.configs = r; this.cdr.markForCheck(); }, error: e => this.fail(e) }); }
  get rows() {
    const list = this.section === 'templates' ? this.templates : this.configs;
    return list.filter(x => {
      const t = this.section === 'templates' ? x : this.templates.find(t => t.MAU_ID === x.MAU_ID);
      return (!this.search || String(x.TEN_MAU || x.TEN_CAU_HINH).toLocaleLowerCase('vi').includes(this.search.toLocaleLowerCase('vi')))
        && (!this.purpose || t?.MUC_DICH === this.purpose) && (!this.channel || t?.KENH_GUI === this.channel) && (!this.status || x.TRANG_THAI === this.status);
    });
  }
  template(id: string) { return this.templates.find(t => t.MAU_ID === id); }
  switchSection(section: string) { this.section = section; this.search = ''; this.purpose = ''; this.channel = ''; this.status = ''; if (section === 'history') this.loadHistory(); }
  open(row?: any) {
    this.kind = this.section === 'configs' ? 'config' : 'template'; this.readOnly = !!row; this.preview = null; this.error = '';
    this.detail = row ? { ...row, THOI_DIEM_GUI: row.THOI_DIEM_GUI ? this.localDate(row.THOI_DIEM_GUI) : '' } : this.kind === 'template'
      ? { TEN_MAU: '', MUC_DICH: 'Quảng cáo', KENH_GUI: 'website', TIEU_DE: '', NOI_DUNG: '', TRANG_THAI: 'Tạm dừng' }
      : { TEN_CAU_HINH: '', MAU_ID: '', SU_KIEN_KICH_HOAT: 'schedule', LOAI_THANH_VIEN: '', VOUCHER_ID: '', SAN_PHAM_ID: '', CHIEN_DICH_ID: '', THOI_DIEM_GUI: '', DO_TRE_PHUT: 1440, NGAY: 1, THANG: 1 };
  }
  localDate(value: string) { return new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 16); }
  close() { if (this.busy) return; this.detail = null; this.preview = null; }
  addVariable(name: string) { this.detail.NOI_DUNG += '{{' + name + '}}'; }
  save() {
    if (this.busy) return; this.busy = true; this.error = '';
    const d = { ...this.detail }; const id = this.kind === 'template' ? d.MAU_ID : d.CAU_HINH_ID;
    if (d.THOI_DIEM_GUI) d.THOI_DIEM_GUI += ':00+07:00';
    const url = this.api + (this.kind === 'template' ? '/templates' : '/configs') + (id ? '/' + id : '');
    (id ? this.http.put<any>(url, d) : this.http.post<any>(url, d)).subscribe({ next: r => {
      this.busy = false; this.detail = { ...r, THOI_DIEM_GUI: r.THOI_DIEM_GUI ? this.localDate(r.THOI_DIEM_GUI) : '' }; this.readOnly = true;
      this.notice = this.kind === 'config' ? 'Đã lưu cấu hình ở trạng thái tạm dừng.' : 'Đã lưu mẫu.'; this.preview = null; this.load(); this.cdr.markForCheck();
    }, error: e => this.fail(e) });
  }
  previewConfig() { this.perform('preview'); }
  testConfig() { this.perform('test'); }
  private perform(action: string) {
    if (this.busy) return; this.busy = true; this.error = '';
    this.http.post<any>(this.api + '/configs/' + this.detail.CAU_HINH_ID + '/' + action, { customerId: this.customerId }).subscribe({ next: r => {
      this.preview = r; this.busy = false; this.notice = r.message || 'Bản xem trước dùng dữ liệu minh họa, chưa gửi đến khách.'; this.loadConfigs(); this.cdr.markForCheck();
    }, error: e => this.fail(e) });
  }
  requestStatus(c: any) { this.confirmation = { config: c, status: c.TRANG_THAI === 'Đang bật' ? 'Tạm dừng' : 'Đang bật' }; }
  changeStatus() {
    if (!this.confirmation || this.busy) return; this.busy = true;
    const { config, status } = this.confirmation;
    this.http.post<any>(this.api + '/configs/' + config.CAU_HINH_ID + '/status', { TRANG_THAI: status, PHIEN_BAN: config.PHIEN_BAN }).subscribe({ next: r => {
      this.busy = false; this.confirmation = null; this.notice = r.message; if (this.detail?.CAU_HINH_ID === config.CAU_HINH_ID) this.detail.TRANG_THAI = status; this.loadConfigs(); this.cdr.markForCheck();
    }, error: e => { this.confirmation = null; this.fail(e); } });
  }
  loadHistory() {
    this.loading = true;
    const params = new HttpParams().set('page', this.page).set('configId', this.historyConfig).set('status', this.historyStatus);
    this.http.get<any>(this.api + '/history', { params }).subscribe({ next: r => { this.history = r.items; this.total = r.total; this.loading = false; this.cdr.markForCheck(); }, error: e => this.fail(e) });
  }
  fail(e: any) { this.busy = false; this.loading = false; this.error = e?.error?.message || 'Chưa kết nối được. Vui lòng thử lại.'; this.cdr.markForCheck(); }
}
