import { Component } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

import { AdminSidebar } from './components/admin-sidebar/admin-sidebar';
import { AdminHeader } from './components/admin-header/admin-header';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    AdminSidebar,
    AdminHeader
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  constructor(private router: Router) {}

  isLoginPage(): boolean {
      return this.router.url.startsWith('/login');
}
}
