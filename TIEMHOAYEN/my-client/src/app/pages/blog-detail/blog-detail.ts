import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

interface BlogPost {
    id: number;
    title: string;
    excerpt: string;
    date: string;
    image: string;
}

@Component({
    selector: 'app-blog-detail',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './blog-detail.html',
    styleUrl: './blog-detail.css'
})
export class BlogDetailComponent {
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
}