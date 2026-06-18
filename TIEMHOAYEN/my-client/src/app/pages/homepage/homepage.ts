import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink
  ],
  templateUrl: './homepage.html',
  styleUrl: './homepage.css'
})
export class Homepage {

  newCollection = [
    {
      name:'Serenity Blossom',
      price:'699.000đ',
      image:'assets/images/homepage-SerenityBlossom.png',
      link: '/',
    },
    {
      name:'Burgundy Elegance',
      price:'1.299.000đ',
      image:'assets/images/homepage-BurgundyElegance.png',
      link: '/',
    },
    {
      name:'Pink Romance',
      price:'899.000đ',
      image:'assets/images/homepage-PinkRomance.png',
      link: '/',
    },
    {
      name:'Orchid Dream',
      price:'1.099.000đ',
      image:'assets/images/homepage-OrchidDream.png',
      link: '/',
    }
  ];
  saleProducts = [
    {
      name:'Sunny Day',
      oldPrice:'799.000đ',
      price:'499.000đ',
      image:'assets/images/homepage-SunnyDay.png',
      link: '/',
    },
    {
      name:'Red Passion',
      oldPrice:'749.000đ',
      price:'449.000đ',
      image:'assets/images/homepage-RedPassion.png',
      link: '/',
    },
    {
      name:'Pink Whisper',
      oldPrice:'899.000đ',
      price:'599.000đ',
      image:'assets/images/homepage-PinkWhisper.png',
      link: '/',
    },
    {
      name:'White Elegance',
      oldPrice:'749.000đ',
      price:'549.000đ',
      image:'assets/images/homepage-WhiteElegance.png',
      link: '/',
    }
  ];

  bestSellerProducts = [
    {
      name:'Pink Garden',
      price:'1.099.000đ',
      image:'assets/images/homepage-PinkGarden.png',
      link: '/',
    },
    {
      name:'White Elegance',
      price:'1.299.000đ',
      image:'assets/images/homepage-WhiteElegance.png',
      link: '/',
    },
    {
      name:'Tulip Romance',
      price:'999.000đ',
      image:'assets/images/homepage-TulipRomance.png',
      link: '/',
    },
    {
      name:'Orchid Luxury',
      price:'1.599.000đ',
      image:'assets/images/homepage-OrchidLuxury.png',
      link: '/',
    }
  ];

  customerReviews = [
    {
      image:'assets/images/homepage-fb1.png',
      content:'Đánh giá sản phẩm của khách hàng',
      link: '/',
    },
    {
      image:'assets/images/homepage-fb2.png',
      content:'Đánh giá sản phẩm của khách hàng',
      link: '/',
    },
    {
      image:'assets/images/homepage-fb3.png',
      content:'Đánh giá sản phẩm của khách hàng',
      link: '/',
    }
  ];

  blogs = [
    {
      image:'assets/images/homepage-xuhuong_2026.png',
      title:'Xu hướng hoa 2026',
      link: '/',
    },
    {
      image:'assets/images/homepage-chonhoasinhnhat.png',
      title:'Cách chọn hoa sinh nhật ý nghĩa và tinh tế',
      link: '/',
    },
    {
      image:'assets/images/homepage-99hoatangme.png',
      title:'99+ mẫu hoa tặng mẹ ý nghĩa',
      link: '/',
    }
  ];

}