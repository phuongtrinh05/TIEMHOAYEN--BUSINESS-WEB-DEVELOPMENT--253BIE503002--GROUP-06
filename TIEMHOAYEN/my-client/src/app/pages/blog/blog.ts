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
    selector: 'app-blog',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './blog.html',
    styleUrl: './blog.css'
})
export class BlogComponent {
    posts: BlogPost[] = [
        {
            id: 1,
            title: 'Ý nghĩa về hoa hồng: Màu sắc và số lượng bạn đã biết chưa ?',
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
}