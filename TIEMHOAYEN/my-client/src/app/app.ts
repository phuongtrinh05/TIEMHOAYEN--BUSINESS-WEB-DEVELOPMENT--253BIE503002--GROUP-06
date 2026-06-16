import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PageHeader } from './components/page-header/page-header';
import { PageHeader1 } from './components/page-header-1/page-header-1';
import { PageHeader2 } from './components/page-header-2/page-header-2';
import { PageFooter } from './components/page-footer/page-footer';
import { PageFooter1 } from './components/page-footer-1/page-footer-1';
import { PageFooter2 } from './components/page-footer-2/page-footer-2';


@Component({
  selector: 'app-root',
  imports: [RouterOutlet,
            PageHeader,
            PageHeader1,
            PageHeader2,
            PageFooter,
            PageFooter1,
            PageFooter2
          ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('my-client');
}
