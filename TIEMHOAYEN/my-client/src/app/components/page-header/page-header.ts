import {
  Component,
  HostListener,
  ElementRef,
  OnInit
} from '@angular/core';

import { NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

import {
  CollectionService,
  Collection
} from '../../services/collection.service'; 
// Nếu đường dẫn service của bạn khác thì sửa lại cho đúng.
// Ví dụ: '../services/collection.service' hoặc '../../../services/collection.service'

import {
  TopicService,
  Topic
} from '../../services/topic.service';
import {
  TargetService,
  Target
} from '../../services/target.service';

import {
  FlowerService,
  Flower
} from '../../services/flower.service';

import {
  StyleService,
  Style
} from '../../services/style.service';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [
    NgIf,
    RouterLink,
    FormsModule
  ],
  templateUrl: './page-header.html',
  styleUrl: './page-header.css',
})
export class PageHeader implements OnInit {
  showLookupPopup = false;
  orderCode: string = '';
  phone: string = '';

  openLookupPopup() {
    this.showLookupPopup = true;
  }

  closeLookupPopup() {
    this.showLookupPopup = false;
  }

  lookupOrder() {
    if (!this.orderCode.trim() || !this.phone.trim()) {
      alert('Vui lòng nhập mã đơn hàng và số điện thoại');
      return;
    }

    this.showLookupPopup = false;

    this.router.navigate(['/order-detail'], {
      queryParams: {
        orderCode: this.orderCode,
        phone: this.phone
      }
    });
  }

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

  collections: Collection[] = [];
  topics: Topic[] = [];
  targets: Target[] = [];
  flowers: Flower[] = [];
  styles: Style[] = [];


  constructor(
    private elementRef: ElementRef,
    private collectionService: CollectionService,
    private topicService: TopicService,
    private targetService: TargetService,
    private flowerService: FlowerService,
    private styleService: StyleService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.getCollections();
    this.getTopics();
    this.getTargets();
    this.getFlowers();
    this.getStyles();
  }

  getCollections(): void {
    this.collectionService.getAll().subscribe({
      next: (data) => {
        this.collections = data;
        console.log('Danh sách bộ sưu tập:', this.collections);
      },
      error: (err) => {
        console.error('Lỗi lấy bộ sưu tập:', err);
      }
    });
  }
  getTopics(): void {
    this.topicService.getAll().subscribe({
      next: (data) => {
        this.topics = data;
        console.log('Danh sách chủ đề:', this.topics);
      },
      error: (err) => {
        console.error('Lỗi lấy chủ đề:', err);
      }
    });
  }

  getTargets(): void {
    this.targetService.getAll().subscribe({
      next: (data) => {
        this.targets = data;
        console.log('Danh sách đối tượng:', this.targets);
      },
      error: (err) => {
        console.error('Lỗi lấy đối tượng:', err);
      }
    });
  }
  getFlowers(): void {
    this.flowerService.getAll().subscribe({
      next: (data) => {
        this.flowers = data;
        console.log('Danh sách hoa tươi:', this.flowers);
      },
      error: (err) => {
        console.error('Lỗi lấy hoa tươi:', err);
      }
    });
  }
  getStyles(): void {
    this.styleService.getAll().subscribe({
      next: (data) => {
        this.styles = data;
        console.log('Danh sách kiểu dáng:', this.styles);
      },
      error: (err) => {
        console.error('Lỗi lấy kiểu dáng:', err);
      }
    });
  }
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
  goToTopic(topicId: string): void {
    if (!topicId) return;

    this.closeAllSubMenus();
    this.showMobileMenu = false;
    this.showAccountMenu = false;
    this.showLanguageMenu = false;

    this.router.navigate(['/chu-de', topicId]);
  }
}
