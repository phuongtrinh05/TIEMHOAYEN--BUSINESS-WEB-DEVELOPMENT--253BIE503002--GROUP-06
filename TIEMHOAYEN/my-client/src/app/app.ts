import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PageHeader } from './components/page-header/page-header';
import { PageHeader1 } from './components/page-header-1/page-header-1';
import { PageHeader2 } from './components/page-header-2/page-header-2';
import { PageFooter } from './components/page-footer/page-footer';
import { ChatbotWidget } from './components/chatbot-widget/chatbot-widget';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet,
            PageHeader,
            PageFooter,ChatbotWidget
          ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('my-client');
}
