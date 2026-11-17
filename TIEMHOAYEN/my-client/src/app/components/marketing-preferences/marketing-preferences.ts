import { Component, ChangeDetectorRef, HostListener, Input, inject, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { apiBaseUrl, orderAccessSession } from '../../services/api-config';

@Component({ selector: 'app-marketing-preferences', standalone: true, imports: [FormsModule], template: `
  @if(!prompt){<button class="settings-link" type="button" (click)="openSettings()"><i class="bi bi-envelope-heart"></i> Bật thông báo nhận ưu đãi</button>}
  @if(visible){<div class="consent-overlay"><section class="consent-dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="prompt?'marketing-welcome-title':'marketing-settings-title'" (keydown)="dialogKey($event)">
    <div class="dialog-top"><span class="flower"><i class="bi bi-envelope-heart"></i></span><button class="close" type="button" [disabled]="busy" aria-label="Đóng" (click)="dismiss()">×</button></div>
    @if(!challengeId){
      <span class="eyebrow">TIỆM HOA YÊN</span><h2 [id]="prompt?'marketing-welcome-title':'marketing-settings-title'">Bật thông báo nhận ưu đãi</h2>
      <p>Nhận voucher, mẫu hoa mới và lời chúc từ Tiệm Hoa Yên qua email.</p>
      <small>Bạn có thể đổi lựa chọn trong tài khoản bất cứ lúc nào.</small>
      @if(ready&&hasEmail){<div class="email-summary"><i class="bi bi-envelope-check"></i><span>Email nhận ưu đãi<strong>{{email}}</strong></span></div>}
      @if(ready&&!hasEmail){<label class="email-field" for="marketing-preference-email"><span>Email nhận thông báo</span><input id="marketing-preference-email" name="marketingPreferenceEmail" type="email" [(ngModel)]="emailInput" (input)="syncEmailInput($event)" [disabled]="busy" autocomplete="email" placeholder="vidu@email.com" (keyup.enter)="requestOtp()"></label>}
    } @else {
      <h2>Mã OTP</h2>
      <label class="email-field otp-only" for="marketing-preference-otp"><input id="marketing-preference-otp" type="text" inputmode="numeric" maxlength="6" [(ngModel)]="otp" [disabled]="busy" autocomplete="one-time-code" placeholder="Nhập mã OTP" (keyup.enter)="verifyOtp()"></label>
    }
    @if(message){<div class="message" role="status">{{message}}</div>}
    @if(challengeId){<div class="dialog-actions otp-actions"><button class="primary" type="button" [disabled]="busy||!ready" (click)="verifyOtp()">{{busy?'Đang xác nhận…':'Xác nhận'}}</button></div>}
    @else {<div class="dialog-actions"><button class="secondary" type="button" [id]="prompt?'marketing-consent-decline':'marketing-settings-decline'" [disabled]="busy||!ready" (click)="save(false)">{{prompt?'Không, cảm ơn':'Tắt thông báo'}}</button><button class="primary" type="button" [disabled]="busy||!ready" (click)="hasEmail?save(true):requestOtp()">{{busy?'Đang xử lý…':hasEmail?'Bật thông báo':'Gửi mã OTP'}}</button></div>
    @if(!prompt&&ready){<small class="current-status">Hiện tại: {{allowed?'Đang bật thông báo ưu đãi':'Chưa bật thông báo ưu đãi'}}</small>}}
  </section></div>}
  @if(!prompt&&notice){<small class="settings-notice" role="status">{{notice}}</small>}
  `, styles: [`
  :host{font-family:inherit}.settings-link{display:flex;align-items:center;gap:9px;border:0;background:transparent;color:#8a656a;font:inherit;font-size:14px;padding:0;cursor:pointer;text-align:left}.settings-link:hover{color:#781b20}.consent-overlay{position:fixed;inset:0;z-index:2147483000;isolation:isolate;background:#32182166;backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px}.consent-dialog{position:relative;z-index:1;width:410px;max-width:100%;border:1px solid #efd6d1;border-radius:20px;background:#fffaf7;padding:26px;box-shadow:0 24px 90px #35162333;text-align:left;color:#77565d}.dialog-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:17px}.flower{display:flex;align-items:center;justify-content:center;width:45px;height:45px;border-radius:14px;background:#fce3e5;color:#8e3342;font-size:22px}.close{border:0;background:transparent;font-size:25px;color:#ac858d;cursor:pointer;padding:0 4px}.eyebrow{font-size:9px;letter-spacing:2px;color:#b58c8b}.consent-dialog h2{font-family:inherit;font-size:22px;line-height:1.4;font-weight:700;color:#781b20;margin:8px 0 12px}.consent-dialog p{font-size:14px;line-height:1.8;margin:0 0 9px}.consent-dialog small{display:block;font-size:12px;line-height:1.7;color:#ab8a8f}.email-summary{display:flex;align-items:center;gap:10px;margin-top:17px;padding:11px 12px;border:1px solid #efd6d1;border-radius:10px;background:#fff}.email-summary i{font-size:20px;color:#8e3342}.email-summary span{font-size:12px;color:#9b747a;min-width:0}.email-summary strong{display:block;margin-top:2px;color:#69383f;overflow-wrap:anywhere}.email-field{display:block;margin-top:17px}.email-field>span{display:block;margin-bottom:7px;font-size:12px;font-weight:600;color:#7d4e55}.email-field input{box-sizing:border-box;width:100%;border:1px solid #dfbfbd;border-radius:9px;background:#fff;padding:11px 12px;font:inherit;font-size:14px;color:#592f36;outline:0}.email-field input:focus{border-color:#9f4654;box-shadow:0 0 0 3px #9f46541a}.email-field small{margin-top:6px}.otp-only{margin-top:16px}.dialog-actions{display:flex;gap:9px;margin-top:24px}.dialog-actions button{flex:1;border:1px solid #e8ccca;border-radius:9px;padding:11px 9px;font:inherit;font-size:13px;cursor:pointer}.otp-actions .primary{width:100%}.secondary{background:#fff;color:#9b6b73}.primary{background:#781b20;color:white;border-color:#781b20!important}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid #b96878;outline-offset:3px}.current-status{margin-top:12px;text-align:center}.message{background:#fff0ef;color:#9e4656;border-radius:7px;padding:10px;font-size:12px;margin-top:12px}.settings-notice{display:block;font-size:11px;color:#9e6871;margin-top:6px}
  `] })
export class MarketingPreferences implements OnInit, OnDestroy {
  @Input() prompt = false;
  private http = inject(HttpClient); private cdr = inject(ChangeDetectorRef); private router = inject(Router);
  private navigation?: Subscription; private checkedToken = ''; private dismissedToken = ''; private generation = 0; private previousFocus: HTMLElement | null = null;
  allowed = false; ready = false; busy = false; visible = false; message = ''; notice = ''; email = ''; emailInput = ''; hasEmail = false;
  challengeId = ''; emailMasked = ''; otp = '';
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
      this.allowed = r.allowed; this.email = String(r.email || ''); this.hasEmail = Boolean(r.hasEmail && this.email); this.emailInput = this.hasEmail ? this.email : ''; this.challengeId = ''; this.otp = ''; this.ready = true;
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
    if (this.busy || !token) return;
    if (allowed && !this.hasEmail) { this.requestOtp(); return; }
    this.busy = true; this.message = '';
    const generation = this.generation;
    this.http.put<any>(apiBaseUrl() + '/marketing/preferences', { allowed }, { headers: { 'x-order-access': token } }).subscribe({ next: r => {
      this.busy = false;
      if (generation !== this.generation || orderAccessSession()?.accessToken !== token) return;
      this.allowed = r.allowed; this.email = String(r.email || this.email); this.hasEmail = Boolean(r.hasEmail && this.email); this.emailInput = this.email;
      if (this.email) { try { const saved = JSON.parse(localStorage.getItem('khachHang') || 'null'); if (saved) { saved.EMAIL = this.email; localStorage.setItem('khachHang', JSON.stringify(saved)); } } catch {} }
      this.dismiss(); this.notice = r.allowed ? 'Đã bật thông báo nhận ưu đãi qua email.' : 'Đã tắt thông báo nhận ưu đãi.';
      window.dispatchEvent(new Event('marketing-preferences-changed')); this.cdr.markForCheck();
    }, error: e => { this.busy = false; if (generation !== this.generation) return; this.message = e?.error?.message || 'Chưa lưu được lựa chọn. Vui lòng thử lại.'; this.cdr.markForCheck(); } });
  }
  syncEmailInput(event: Event) { this.emailInput = (event.target as HTMLInputElement)?.value || ''; this.message = ''; }
  requestOtp() {
    const token = orderAccessSession()?.accessToken;
    const input = document.getElementById('marketing-preference-email') as HTMLInputElement | null;
    const submittedEmail = String(input?.value || this.emailInput || '').replace(/[\s\u200B-\u200D\uFEFF]+/g, '').toLowerCase();
    this.emailInput = submittedEmail;
    if (this.busy || !token) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedEmail)) { this.message = 'Vui lòng nhập email hợp lệ để nhận thông báo ưu đãi.'; return; }
    this.busy = true; this.message = '';
    this.http.post<any>(apiBaseUrl() + '/marketing/preferences/email-otp', { email: submittedEmail }, { headers: { 'x-order-access': token } }).subscribe({ next: r => {
      this.busy = false; this.challengeId = r.challengeId; this.emailMasked = r.emailMasked; this.message = ''; this.cdr.markForCheck();
      setTimeout(() => document.getElementById('marketing-preference-otp')?.focus());
    }, error: e => { this.busy = false; this.message = e?.error?.message || 'Chưa gửi được mã OTP. Vui lòng thử lại.'; this.cdr.markForCheck(); } });
  }
  verifyOtp() {
    const token = orderAccessSession()?.accessToken;
    if (this.busy || !token || !this.challengeId) return;
    if (!/^\d{6}$/.test(this.otp.trim())) { this.message = 'Mã OTP phải gồm 6 chữ số.'; return; }
    this.busy = true; this.message = '';
    this.http.post<any>(apiBaseUrl() + '/marketing/preferences/email-otp/verify', { challengeId: this.challengeId, otp: this.otp.trim() }, { headers: { 'x-order-access': token } }).subscribe({ next: r => {
      this.busy = false; this.allowed = true; this.email = r.email; this.emailInput = r.email; this.hasEmail = true; this.challengeId = ''; this.otp = '';
      try { const saved = JSON.parse(localStorage.getItem('khachHang') || 'null'); if (saved) { saved.EMAIL = this.email; localStorage.setItem('khachHang', JSON.stringify(saved)); } } catch {}
      this.dismiss(); this.notice = 'Đã xác nhận email và bật thông báo nhận ưu đãi.'; window.dispatchEvent(new Event('marketing-preferences-changed')); this.cdr.markForCheck();
    }, error: e => { this.busy = false; this.message = e?.error?.message || 'Mã OTP chưa đúng hoặc đã hết hạn.'; this.cdr.markForCheck(); } });
  }
}
