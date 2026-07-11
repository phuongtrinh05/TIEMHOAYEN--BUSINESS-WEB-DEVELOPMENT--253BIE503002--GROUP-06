import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { adminAuthInterceptor } from './services/admin-auth.interceptor';
import { TINYMCE_SCRIPT_SRC } from '@tinymce/tinymce-angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([adminAuthInterceptor])),

    provideClientHydration(),

    provideCharts(withDefaultRegisterables()),
    { provide: TINYMCE_SCRIPT_SRC, useValue: '/tinymce/tinymce.min.js' }
  ]
};
