import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, NgZone, PLATFORM_ID } from '@angular/core';

export type AppLanguage = 'vi' | 'en';

declare global {
  interface Window {
    googleTranslateElementInit?: () => void;
    google?: {
      translate?: {
        TranslateElement?: new (
          options: { pageLanguage: string; includedLanguages: string; autoDisplay: boolean },
          elementId: string
        ) => void;
      };
    };
  }
}

@Injectable({
  providedIn: 'root',
})
export class LanguageService {
  private readonly storageKey = 'language';
  private readonly scriptId = 'google-translate-script';
  private readonly elementId = 'google_translate_element';
  private readonly hideBannerStyleId = 'google-translate-hide-banner-style';
  private ready = false;
  private loading = false;
  private pendingLanguage: AppLanguage | null = null;
  private enforceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PLATFORM_ID) private platformId: object,
    @Inject(DOCUMENT) private document: Document,
    private ngZone: NgZone
  ) {}

  init(): void {
    if (!this.isBrowser()) {
      return;
    }

    this.injectHideBannerStyle();
    this.ensureContainer();
    this.loadScript();
    this.applyStoredLanguage();
    this.startEnforcingHiddenBanner();
  }

  getCurrentLanguage(): AppLanguage {
    if (!this.isBrowser()) {
      return 'vi';
    }

    return this.normalizeLanguage(localStorage.getItem(this.storageKey));
  }

  changeLanguage(language: string): AppLanguage {
    const nextLanguage = this.normalizeLanguage(language);

    if (!this.isBrowser()) {
      return nextLanguage;
    }

    localStorage.setItem(this.storageKey, nextLanguage);
    this.document.documentElement.lang = nextLanguage;
    this.pendingLanguage = nextLanguage;
    this.loadScript();
    this.applyLanguage(nextLanguage);
    window.dispatchEvent(new CustomEvent('language-changed', { detail: nextLanguage }));

    return nextLanguage;
  }

  private applyStoredLanguage(): void {
    const language = this.getCurrentLanguage();

    if (language !== 'vi') {
      this.changeLanguage(language);
    }
  }

  private loadScript(): void {
    if (!this.isBrowser() || this.loading || this.ready) {
      return;
    }

    this.loading = true;
    window.googleTranslateElementInit = () => {
      this.ngZone.runOutsideAngular(() => {
        new window.google!.translate!.TranslateElement!(
          {
            pageLanguage: 'vi',
            includedLanguages: 'vi,en',
            autoDisplay: false,
          },
          this.elementId
        );

        this.ready = true;
        this.loading = false;

        if (this.pendingLanguage) {
          window.setTimeout(() => this.applyLanguage(this.pendingLanguage!), 300);
        }
      });
    };

    if (this.document.getElementById(this.scriptId)) {
      return;
    }

    const script = this.document.createElement('script');
    script.id = this.scriptId;
    script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    script.async = true;
    this.document.body.appendChild(script);
  }

  private applyLanguage(language: AppLanguage): void {
    if (!this.ready) {
      return;
    }

    this.setGoogleTranslateCookie(language);
    this.setGoogleTranslateCombo(language);
    this.forceHideBannerNow();
  }

  private setGoogleTranslateCombo(language: AppLanguage): void {
    const combo = this.document.querySelector<HTMLSelectElement>('.goog-te-combo');

    if (!combo) {
      window.setTimeout(() => this.setGoogleTranslateCombo(language), 250);
      return;
    }

    combo.value = language;
    combo.dispatchEvent(new Event('change'));

    // Google chèn banner + đẩy body xuống bằng inline style ngay sau khi combo
    // đổi, và có thể lặp lại vài lần trong lúc dịch xong, nên phải đè lại nhiều lần.
    [50, 100, 200, 400, 800, 1500, 3000].forEach((delay) => {
      window.setTimeout(() => this.forceHideBannerNow(), delay);
    });
  }

  private setGoogleTranslateCookie(language: AppLanguage): void {
    const cookieValue = language === 'vi' ? '/vi/vi' : `/vi/${language}`;
    this.document.cookie = `googtrans=${cookieValue};path=/`;
    this.document.cookie = `googtrans=${cookieValue};domain=${location.hostname};path=/`;
  }

  private ensureContainer(): void {
    if (this.document.getElementById(this.elementId)) {
      return;
    }

    const element = this.document.createElement('div');
    element.id = this.elementId;
    element.style.position = 'fixed';
    element.style.left = '-9999px';
    element.style.top = '-9999px';
    element.style.width = '1px';
    element.style.height = '1px';
    element.style.overflow = 'hidden';
    this.document.body.appendChild(element);
    this.document.documentElement.lang = this.getCurrentLanguage();
  }

  // Ẩn banner "Được dịch sang..." bằng stylesheet, để hạn chế nó hiện ra dù
  // chỉ trong tích tắc trước khi JS kịp can thiệp.
  private injectHideBannerStyle(): void {
    if (this.document.getElementById(this.hideBannerStyleId)) {
      return;
    }

    const style = this.document.createElement('style');
    style.id = this.hideBannerStyleId;
    style.textContent = `
      iframe.skiptranslate,
      .goog-te-banner-frame {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
      }

      html body {
        top: 0px !important;
        position: static !important;
      }

      .goog-tooltip,
      .goog-tooltip:hover,
      .goog-text-highlight {
        background-color: transparent !important;
        box-shadow: none !important;
        border: none !important;
      }

      #goog-gt-tt,
      .goog-te-balloon-frame {
        display: none !important;
      }

      #google_translate_element {
        display: none !important;
      }
    `;
    this.document.head.appendChild(style);
  }

  // Google Translate set các style này bằng inline style + !important qua JS,
  // nên CSS thường trong stylesheet không thắng nổi. Phải chủ động ghi đè lại
  // bằng setProperty(..., 'important') mỗi khi phát hiện nó xuất hiện.
  private forceHideBannerNow(): void {
    if (!this.isBrowser()) {
      return;
    }

    this.document.body.style.setProperty('top', '0px', 'important');
    this.document.body.style.setProperty('position', 'static', 'important');

    const frames = this.document.querySelectorAll<HTMLElement>(
      'iframe.skiptranslate, .goog-te-banner-frame'
    );

    frames.forEach((frame) => {
      frame.style.setProperty('display', 'none', 'important');
      frame.style.setProperty('visibility', 'hidden', 'important');
      frame.style.setProperty('height', '0px', 'important');
    });
  }

  private startEnforcingHiddenBanner(): void {
    if (this.enforceTimer) {
      return;
    }

    this.enforceTimer = setInterval(() => this.forceHideBannerNow(), 700);
  }

  private normalizeLanguage(language: string | null): AppLanguage {
    return language === 'en' ? 'en' : 'vi';
  }

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }
}