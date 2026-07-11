import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-about-us',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './about-us.html',
  styleUrl: './about-us.css'
})
export class AboutUs implements AfterViewInit, OnDestroy {

  private observer?: IntersectionObserver;
  private reviewIndex = 0;
  private reviewTimer: ReturnType<typeof setInterval> | null = null;
  private reviewPaused = false;

  constructor(private hostRef: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    const elements = this.hostRef.nativeElement.querySelectorAll('.reveal');

    if (!('IntersectionObserver' in window)) {
      elements.forEach(el => el.classList.add('is-visible'));
      return;
    }

    this.observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            this.observer?.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
    );

    elements.forEach(el => this.observer?.observe(el));
    this.startReviewAutoSlide();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    if (this.reviewTimer) {
      clearInterval(this.reviewTimer);
    }
  }

  teamMembers = [
    {
      image: 'assets/images/about-us-trinh.jpg',
      name: 'Trinh Phạm',
      role: 'Manager'
    },
    {
      image: 'assets/images/about-us-thu.jpg',
      name: 'Thượng Thư',
      role: 'Floral Designer'
    },
    {
      image: 'assets/images/about-us-thoa.jpg',
      name: 'Anh Thoa',
      role: 'Floral Assistant'
    },
    {
      image: 'assets/images/about-us-diem.jpg',
      name: 'Phúc Diễm',
      role: 'Social Media Executive'
    },
    {
      image: 'assets/images/about-us-vinh.jpg',
      name: 'Vinh Trần',
      role: 'Customer Experience Executive'
    },
    {
      image: 'assets/images/about-us-huy.jpg',
      name: 'Thiên Huy',
      role: 'Logistics Assistant'
    }
  ];

  partners = [
    'assets/images/about-us-grab.png',
    'assets/images/about-us-momo.webp',
    'assets/images/about-us-vnpay.webp',
    'assets/images/about-us-ahamove.png',
    'assets/images/about-us-dalatfarm.jpeg',
    'assets/images/about-us-farmcaudat.png'
  ];

  reviews = [
    {
      name: 'Hoàng Nam',
      date: '12/01/2026',
      content: 'Hoa tươi rất đẹp, giao đúng giờ, bạn gái mình rất thích.'
    },
    {
      name: 'An Hà',
      date: '11/01/2026',
      content: 'Thiết kế tinh tế, tư vấn nhiệt tình. Mỗi bó hoa đều mang ý nghĩa riêng.'
    },
    {
      name: 'Minh Tuấn',
      date: '11/02/2026',
      content: 'Dịch vụ nhanh chóng, giao hàng đúng giờ, rất hài lòng.'
    },
    {
      name: 'Lan Anh',
      date: '26/03/2026',
      content: 'Đặt hoa tặng mẹ, đẹp vô cùng. Sẽ ủng hộ lâu dài.'
    },
    {
      name: 'Tuấn Tú',
      date: '20/03/2026',
      content: 'Hoa tươi không bị héo, hay dập. Giao hàng cẩn thận.'
    }
  ];

  get visibleReviews() {
    const width = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const visibleCount = width <= 640 ? 1 : width <= 1024 ? 2 : 3;
    return Array.from({ length: Math.min(visibleCount, this.reviews.length) }, (_, offset) =>
      this.reviews[(this.reviewIndex + offset) % this.reviews.length]
    );
  }

  @HostListener('window:resize')
  onResize(): void {}

  previousReview(): void {
    this.reviewIndex = (this.reviewIndex - 1 + this.reviews.length) % this.reviews.length;
    this.restartReviewAutoSlide();
  }

  nextReview(manual = true): void {
    this.reviewIndex = (this.reviewIndex + 1) % this.reviews.length;
    if (manual) {
      this.restartReviewAutoSlide();
    }
  }

  pauseReviewSlider(): void { this.reviewPaused = true; }
  resumeReviewSlider(): void { this.reviewPaused = false; }

  private startReviewAutoSlide(): void {
    if (typeof window === 'undefined' || this.reviewTimer || this.reviews.length < 2) {
      return;
    }
    this.reviewTimer = setInterval(() => {
      if (!this.reviewPaused && document.visibilityState === 'visible') {
        this.nextReview(false);
      }
    }, 5000);
  }

  private restartReviewAutoSlide(): void {
    if (this.reviewTimer) {
      clearInterval(this.reviewTimer);
      this.reviewTimer = null;
    }
    this.startReviewAutoSlide();
  }
}
