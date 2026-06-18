import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface BlogPost {
  id: number;
  title: string;
  excerpt: string;
  date: string;
  image: string;
}

interface RelatedProduct {
  name: string;
  price: number;
  image: string;
}

interface CommentItem {
  name: string;
  content: string;
}

@Component({
  selector: 'app-blog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './blog.html',
  styleUrl: './blog.css'
})
export class BlogComponent {
  currentView: 'list' | 'detail' = 'list';

  posts: BlogPost[] = [
    {
      id: 1,
      title: 'Ý nghĩa về hoa hồng: Màu sắc và số lượng bạn đã biết chưa?',
      excerpt: 'Hoa hồng là loài hoa được yêu thích nhất. Mỗi màu sắc và số lượng hoa lại mang một ý nghĩa riêng biệt...',
      date: '20/02/2026',
      image: 'assets/images/blog.png'
    },
    {
      id: 2,
      title: 'Cách chọn hoa sinh nhật ý nghĩa và tinh tế',
      excerpt: 'Một bó hoa sinh nhật không chỉ đẹp mà còn thể hiện sự quan tâm của bạn. Cùng khám phá cách chọn hoa phù hợp...',
      date: '10/02/2026',
      image: 'assets/images/blog.png'
    },
    {
      id: 3,
      title: 'Gợi ý lời chúc 20/10 hay và ý nghĩa kèm hoa tặng mẹ, vợ, bạn gái',
      excerpt: 'Tổng hợp những lời chúc 20/10 ngọt ngào, ý nghĩa nhất để gửi kèm bó hoa tươi thắm thay lời muốn nói.',
      date: '10/08/2025',
      image: 'assets/images/blog.png'
    },
    {
      id: 4,
      title: 'Gợi ý chọn hoa tốt nghiệp, kèm lời chúc ý nghĩa',
      excerpt: 'Việc tặng một bó hoa nhân ngày tốt nghiệp kèm lời chúc ý nghĩa mang lại nhiều cảm xúc khó quên và trân trọng.',
      date: '21/03/2026',
      image: 'assets/images/blog.png'
    }
  ];

  latestPosts: BlogPost[] = [
    {
      id: 2,
      title: 'Cách chọn hoa tặng sinh nhật ý nghĩa và tinh tế',
      excerpt: '',
      date: '21/01/2026',
      image: 'assets/images/blog.png'
    },
    {
      id: 4,
      title: 'Gợi ý chọn hoa tốt nghiệp kèm lời chúc ý nghĩa',
      excerpt: '',
      date: '21/03/2026',
      image: 'assets/images/blog.png'
    },
    {
      id: 5,
      title: 'Gợi ý lời chúc 8/3 hay và ý nghĩa',
      excerpt: '',
      date: '10/02/2026',
      image: 'assets/images/blog.png'
    },
    {
      id: 6,
      title: 'Xu hướng hoa 2026: Những tone được yêu thích',
      excerpt: '',
      date: '10/05/2025',
      image: 'assets/images/blog.png'
    }
  ];

  relatedProducts: RelatedProduct[] = [
    {
      name: 'Tình yêu',
      price: 730000,
      image: 'assets/images/blog.png'
    },
    {
      name: 'Tươi mát',
      price: 460000,
      image: 'assets/images/blog.png'
    },
    {
      name: 'Hộp hoa lãng mạn',
      price: 1200000,
      image: 'assets/images/blog.png'
    }
  ];

  comments: CommentItem[] = [
    {
      name: 'Anh Thoa',
      content: 'Bài viết rất hay và có ý nghĩa'
    }
  ];

  openFirstBlog(post: BlogPost): void {
    if (post.id === 1) {
      this.currentView = 'detail';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  backToList(): void {
    this.currentView = 'list';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  formatPrice(price: number): string {
    return price.toLocaleString('vi-VN') + 'đ';
  }
}