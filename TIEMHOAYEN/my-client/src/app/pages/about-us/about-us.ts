import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-about-us',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './about-us.html',
  styleUrl: './about-us.css'
})
export class AboutUs implements AfterViewInit, OnDestroy {

  private observer?: IntersectionObserver;
  private reviewIndex = 0;

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
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  /** Các bước khớp với quy trình thật trên website (lịch chuẩn bị T, ảnh bàn giao, hỗ trợ 1 giờ sau giao). */
  journey = [
    { icon: 'bi-flower1', title: 'Chọn mẫu hoặc tự thiết kế',
      text: 'Chọn bó hoa có sẵn, hoặc tự phối loại hoa, màu và số cành trên mô hình 3D.' },
    { icon: 'bi-calendar2-check', title: 'Xác nhận và lên lịch',
      text: 'Tiệm kiểm tra hoa, nguyên liệu và chốt giờ bắt đầu cắm theo giờ giao bạn chọn.' },
    { icon: 'bi-camera', title: 'Cắm hoa và gửi ảnh',
      text: 'Bó hoa được cắm đúng giờ; bạn xem ảnh, video bó hoa thật trước khi giao.' },
    { icon: 'bi-truck', title: 'Giao tận tay',
      text: 'Giao trong khung 06:30–22:00, trạng thái đơn cập nhật ngay trên website.' },
    { icon: 'bi-chat-heart', title: 'Hỗ trợ sau khi nhận',
      text: 'Trong 1 giờ sau khi nhận, gửi ảnh nếu hoa có vấn đề để tiệm đổi hoặc hoàn tiền theo chính sách.' },
  ];

  values = [
    { icon: 'bi-droplet', title: 'Tươi',
      text: 'Hoa được cắm sát giờ giao và kiểm tra lại trước khi rời tiệm.' },
    { icon: 'bi-clock-history', title: 'Đúng hẹn',
      text: 'Chỉ nhận đơn khi chuẩn bị kịp; đơn gấp hay thiếu hoa được nhân viên gọi xác nhận trước.' },
    { icon: 'bi-eye', title: 'Minh bạch',
      text: 'Giá, tiền cọc và phí giao hiện rõ trước khi đặt; ảnh bó hoa thật trước khi giao.' },
    { icon: 'bi-heart', title: 'Tận tâm',
      text: 'Tư vấn hoa theo dịp và thông điệp, hướng dẫn giữ hoa tươi lâu sau khi nhận.' },
  ];

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
    const visibleCount = width <= 768 ? 2 : width <= 1024 ? 3 : 4;
    return Array.from({ length: Math.min(visibleCount, this.reviews.length) }, (_, offset) =>
      this.reviews[(this.reviewIndex + offset) % this.reviews.length]
    );
  }

  @HostListener('window:resize')
  onResize(): void {}

  previousReview(): void {
    this.reviewIndex = (this.reviewIndex - 1 + this.reviews.length) % this.reviews.length;
  }

  nextReview(): void {
    this.reviewIndex = (this.reviewIndex + 1) % this.reviews.length;
  }
}
