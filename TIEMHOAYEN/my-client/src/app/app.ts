import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PageHeader } from './components/page-header/page-header';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet,
            PageHeader
          ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('my-client');
}
