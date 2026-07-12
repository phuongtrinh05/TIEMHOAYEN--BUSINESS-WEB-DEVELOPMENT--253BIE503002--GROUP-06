import { Component, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { PageHeader } from './components/page-header/page-header';
import { PageHeader1 } from './components/page-header-1/page-header-1';
import { PageHeader2 } from './components/page-header-2/page-header-2';
import { PageFooter } from './components/page-footer/page-footer';
import { PageFooter1 } from './components/page-footer-1/page-footer-1';
import { PageFooter2 } from './components/page-footer-2/page-footer-2';
import { ChatbotWidget } from './components/chatbot-widget/chatbot-widget';


@Component({
  selector: 'app-root',
  imports: [RouterOutlet,
            PageHeader,
            PageHeader1,
            PageHeader2,
            PageFooter,
            PageFooter1,
            PageFooter2,
            ChatbotWidget
          ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('my-client');
  protected readonly currentRoute = signal('');

  private readonly layoutOneRoutes = new Set([
    'design3d',
    'design-3d',
    'checkout',
    'order-haunt',
    'order-registrant',
  ]);

  private readonly authRoutes = new Set([
    'login',
    'register',
    'forgot-password',
  ]);

  constructor(private router: Router) {
    this.restoreLoginPersistence();
    this.currentRoute.set(this.getRoutePath(this.router.url));

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.currentRoute.set(this.getRoutePath(event.urlAfterRedirects));
      });
  }

  private restoreLoginPersistence(): void {
    if (typeof window === 'undefined') return;

    const remembered = localStorage.getItem('tiemHoaYenRememberLogin') === 'true';
    const activeSession = sessionStorage.getItem('tiemHoaYenSessionAuth') === 'true';

    if (!remembered && !activeSession) {
      localStorage.removeItem('khachHang');
      localStorage.removeItem('token');
    }
  }

  protected useLayoutOne(): boolean {
    return this.layoutOneRoutes.has(this.currentRoute());
  }

  protected useAuthLayout(): boolean {
    return this.authRoutes.has(this.currentRoute());
  }

  private getRoutePath(url: string): string {
    return url.split('?')[0].split('#')[0].replace(/^\/+/, '');
  }
}
