import { Component, ChangeDetectorRef, HostListener, Input, inject, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { apiBaseUrl, orderAccessSession } from '../../services/api-config';

@Component({ selector: 'app-marketing-preferences', standalone: true, template: `
  @if(!prompt){<button class="settings-link" type="button" (click)="openSettings()"><i class="bi bi-envelope-heart"></i> Tùy chọn nhận ưu đãi</button>}
  @if(visible){<div class="consent-overlay"><section class="consent-dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="prompt?'marketing-welcome-title':'marketing-settings-title'" (keydown)="dialogKey($event)">
    <div class="dialog-top"><span class="flower"><i class="bi bi-envelope-heart"></i></span><button class="close" type="button" [disabled]="busy" aria-label="Đóng" (click)="dismiss()">×</button></div>
    <span class="eyebrow">TIỆM HOA YẾN</span><h2 [id]="prompt?'marketing-welcome-title':'marketing-settings-title'">{{prompt?'Bạn muốn nhận tin ưu đãi?':'Tùy chọn nhận ưu đãi'}}</h2>
    <p>Nhận voucher, mẫu hoa mới và lời chúc qua thông báo website hoặc email.</p>
    <small>Bạn có thể đổi lựa chọn trong tài khoản bất cứ lúc nào.</small>
    @if(message){<div class="message" role="status">{{message}}</div>}
    <div class="dialog-actions"><button class="secondary" type="button" [id]="prompt?'marketing-consent-decline':'marketing-settings-decline'" [disabled]="busy||!ready" (click)="save(false)">{{prompt?'Không, cảm ơn':'Ngừng nhận tin'}}</button><button class="primary" type="button" [disabled]="busy||!ready" (click)="save(true)">{{busy?'Đang lưu…':prompt?'Đồng ý nhận tin':'Bật nhận tin'}}</button></div>
    @if(!prompt&&ready){<small class="current-status">Hiện tại: {{allowed?'Đang nhận ưu đãi':'Chưa nhận ưu đãi'}}</small>}
  </section></div>}
  @if(!prompt&&notice){<small class="settings-notice" role="status">{{notice}}</small>}
  `, styles: [`
  :host{font-family:inherit}.settings-link{display:flex;align-items:center;gap:9px;border:0;background:transparent;color:#8a656a;font:inherit;font-size:14px;padding:0;cursor:pointer;text-align:left}.settings-link:hover{color:#781b20}.consent-overlay{position:fixed;inset:0;z-index:12000;background:#32182166;backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px}.consent-dialog{width:410px;max-width:100%;border:1px solid #efd6d1;border-radius:20px;background:#fffaf7;padding:26px;box-shadow:0 24px 90px #35162333;text-align:left;color:#77565d}.dialog-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:17px}.flower{display:flex;align-items:center;justify-content:center;width:45px;height:45px;border-radius:14px;background:#fce3e5;color:#8e3342;font-size:22px}.close{border:0;background:transparent;font-size:25px;color:#ac858d;cursor:pointer;padding:0 4px}.eyebrow{font-size:9px;letter-spacing:2px;color:#b58c8b}.consent-dialog h2{font-family:inherit;font-size:22px;line-height:1.4;font-weight:700;color:#781b20;margin:8px 0 12px}.consent-dialog p{font-size:14px;line-height:1.8;margin:0 0 9px}.consent-dialog small{display:block;font-size:12px;line-height:1.7;color:#ab8a8f}.dialog-actions{display:flex;gap:9px;margin-top:24px}.dialog-actions button{flex:1;border:1px solid #e8ccca;border-radius:9px;padding:11px 9px;font:inherit;font-size:13px;cursor:pointer}.secondary{background:#fff;color:#9b6b73}.primary{background:#781b20;color:white;border-color:#781b20!important}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid #b96878;outline-offset:3px}.current-status{margin-top:12px;text-align:center}.message{background:#fff0ef;color:#9e4656;border-radius:7px;padding:10px;font-size:12px;margin-top:12px}.settings-notice{display:block;font-size:11px;color:#9e6871;margin-top:6px}
  `] })
export class MarketingPreferences implements OnInit, OnDestroy {
  @Input() prompt = false;
  private http = inject(HttpClient); private cdr = inject(ChangeDetectorRef); private router = inject(Router);
  private navigation?: Subscription; private checkedToken = ''; private dismissedToken = ''; private generation = 0; private previousFocus: HTMLElement | null = null;
  allowed = false; ready = false; busy = false; visible = false; message = ''; notice = '';
  ngOnInit() {
    if (!this.prompt) return;
    this.navigation = this.router.events.subscribe(e => { if (e instanceof NavigationEnd) this.check(); });
    this.check();
  }
  ngOnDestroy() { this.navigation?.unsubscribe(); this.generation++; }
  @HostListener('window:auth-changed') authChanged() { this.checkedToken = ''; this.generation++; this.visible = false; this.busy = false; if (this.prompt) this.check(); }
  @HostListener('window:marketing-preferences-changed') preferencesChanged() { this.visible = false; this.checkedToken = ''; if (this.prompt) this.check(); }
  private check(force = false) {
    const session = orderAccessSession();
    if (!session || session.authType !== 'member') { this.visible = false; this.checkedToken = ''; if (force) this.notice = 'Đăng nhập lại để cập nhật tùy chọn nhận tin.'; return; }
    const token = session.accessToken;
    try { this.dismissedToken = sessionStorage.getItem('marketingWelcomeDismissed') || this.dismissedToken; } catch {}
    if (!force && (this.router.url.startsWith('/login') || this.router.url.startsWith('/register') || this.checkedToken === token || this.dismissedToken === token)) return;
    this.checkedToken = token; const generation = ++this.generation; this.ready = false;
    this.http.get<any>(apiBaseUrl() + '/marketing/preferences', { headers: { 'x-order-access': token } }).subscribe({ next: r => {
      if (generation !== this.generation || orderAccessSession()?.accessToken !== token) return;
      this.allowed = r.allowed; this.ready = true;
      if (force || !r.answered) this.show(); this.cdr.markForCheck();
    }, error: () => {
      if (generation !== this.generation) return;
      this.checkedToken = ''; this.message = 'Chưa tải được tùy chọn. Vui lòng thử lại.'; if (force) this.notice = this.message; this.cdr.markForCheck();
    } });
  }
  openSettings() { this.message = ''; this.notice = ''; this.check(true); }
  private show() {
    if (!this.visible) this.previousFocus = document.activeElement as HTMLElement;
    this.visible = true;
    setTimeout(() => document.getElementById(this.prompt?'marketing-consent-decline':'marketing-settings-decline')?.focus());
  }
  dismiss() { if (this.busy) return; this.dismissedToken = orderAccessSession()?.accessToken || ''; try { sessionStorage.setItem('marketingWelcomeDismissed', this.dismissedToken); } catch {} this.visible = false; this.previousFocus?.focus(); }
  dialogKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); this.dismiss(); }
    if (e.key === 'Tab') {
      const buttons = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (!buttons.length) return;
      if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === buttons.at(-1)) { e.preventDefault(); buttons[0].focus(); }
    }
  }
  save(allowed: boolean) {
    const token = orderAccessSession()?.accessToken;
    if (this.busy || !token) return; this.busy = true; this.message = '';
    const generation = this.generation;
    this.http.put<any>(apiBaseUrl() + '/marketing/preferences', { allowed }, { headers: { 'x-order-access': token } }).subscribe({ next: r => {
      this.busy = false;
      if (generation !== this.generation || orderAccessSession()?.accessToken !== token) return;
      this.allowed = r.allowed; this.dismiss(); this.notice = r.allowed ? 'Đã bật nhận tin ưu đãi.' : 'Đã ngừng nhận tin ưu đãi.';
      window.dispatchEvent(new Event('marketing-preferences-changed')); this.cdr.markForCheck();
    }, error: e => { this.busy = false; if (generation !== this.generation) return; this.message = e?.error?.message || 'Chưa lưu được lựa chọn. Vui lòng thử lại.'; this.cdr.markForCheck(); } });
  }
}
