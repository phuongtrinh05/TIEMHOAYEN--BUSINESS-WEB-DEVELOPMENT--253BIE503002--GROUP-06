import { Component, HostListener } from '@angular/core';
import { NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-page-header-1',
  standalone: true,
  imports: [
    NgIf,
    RouterLink
  ],
  templateUrl: './page-header-1.html',
  styleUrl: './page-header-1.css'
})
export class PageHeader1 {

  isScrolled = false;

  showSearch = false;

  showAccountMenu = false;

  showLanguageMenu = false;

  showMobileMenu = false;

  isLoggedIn = false;

  currentLanguage = 'vi';

  @HostListener('window:scroll')
  onScroll() {

    this.isScrolled = window.scrollY > 100;

  }

  toggleSearch() {

    this.showSearch = !this.showSearch;

  }

  toggleAccountMenu() {

    this.showAccountMenu = !this.showAccountMenu;

  }

  toggleLanguageMenu() {

    this.showLanguageMenu = !this.showLanguageMenu;

  }

  toggleMobileMenu() {

    this.showMobileMenu = !this.showMobileMenu;

  }

  changeLanguage(lang: string) {

    this.currentLanguage = lang;

    localStorage.setItem('language', lang);

  }

  logout() {

    this.isLoggedIn = false;

    this.showAccountMenu = false;

  }

}