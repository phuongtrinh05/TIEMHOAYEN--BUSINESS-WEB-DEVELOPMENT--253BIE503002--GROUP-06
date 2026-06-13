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


  showMobileMenu = false;

  showTopic = false;

  showTarget = false;

  showStyle = false;

  showFlower = false;

  showCollection = false;

  showSupport = false;

  showAbout = false;

  constructor(
    private elementRef: ElementRef
  ) {}


  @HostListener('window:scroll')
  onScroll() {

    this.isScrolled = window.scrollY > 100;

  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent) {

    const target = event.target as HTMLElement;

    const clickedInsideHeader =
      this.elementRef.nativeElement.contains(target);

    const clickedDrawer =
      target.closest('.mobile-menu');

    const clickedButton =
      target.closest('.mobile-menu-btn');

    if (!clickedInsideHeader) {

      this.showAccountMenu = false;

      this.showLanguageMenu = false;

    }

    if (!clickedDrawer && !clickedButton) {

      this.showMobileMenu = false;

      this.closeAllSubMenus();

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

  toggleMobileMenu() {

    this.showMobileMenu = !this.showMobileMenu;

    if (!this.showMobileMenu) {

      this.closeAllSubMenus();

    }

  }

  closeAllSubMenus() {

    this.showTopic = false;

    this.showTarget = false;

    this.showStyle = false;

    this.showFlower = false;

    this.showCollection = false;

    this.showSupport = false;

    this.showAbout = false;

  }


  toggleTopic() {

    const current = this.showTopic;

    this.closeAllSubMenus();

    this.showTopic = !current;

  }

  toggleTarget() {

    const current = this.showTarget;

    this.closeAllSubMenus();

    this.showTarget = !current;

  }

  toggleStyle() {

    const current = this.showStyle;

    this.closeAllSubMenus();

    this.showStyle = !current;

  }

  toggleFlower() {

    const current = this.showFlower;

    this.closeAllSubMenus();

    this.showFlower = !current;

  }

  toggleCollection() {

    const current = this.showCollection;

    this.closeAllSubMenus();

    this.showCollection = !current;

  }

  toggleSupport() {

    const current = this.showSupport;

    this.closeAllSubMenus();

    this.showSupport = !current;

  }

  toggleAbout() {

    const current = this.showAbout;

    this.closeAllSubMenus();

    this.showAbout = !current;

  }

}