import {
  Component,
  HostListener,
  ElementRef
} from '@angular/core';

import { NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [
    NgIf,
    RouterLink
  ],
  templateUrl: './page-header.html',
  styleUrl: './page-header.css',
})
export class PageHeader {
  isScrolled = false;
  showSearch = false;
  showAccountMenu = false;
  showLanguageMenu = false;
  isLoggedIn = false;
  currentLanguage = 'vi';
  constructor(
    private elementRef: ElementRef
  ) {}

  @HostListener('window:scroll')
  onScroll() {
    this.isScrolled = window.scrollY > 100;
  }

  @HostListener('document:click', ['$event'])
  clickOutside(event: MouseEvent) {
    const clickedInside =
      this.elementRef.nativeElement.contains(event.target);

    if (!clickedInside) {
      this.showAccountMenu = false;
      this.showLanguageMenu = false;
    }
  }

  toggleSearch() {
    this.showSearch = !this.showSearch;
  }

  toggleAccountMenu() {
    this.showAccountMenu = !this.showAccountMenu;
    if (!this.showAccountMenu) {
      this.showLanguageMenu = false;
    }
  }

  toggleLanguageMenu() {
    this.showLanguageMenu = !this.showLanguageMenu;
  }

  changeLanguage(lang: string) {
    this.currentLanguage = lang;
    localStorage.setItem('language', lang);
    console.log('Language:', lang);
  }

  logout() {
    this.isLoggedIn = false;
    this.showAccountMenu = false;
    this.showLanguageMenu = false;
  }
}