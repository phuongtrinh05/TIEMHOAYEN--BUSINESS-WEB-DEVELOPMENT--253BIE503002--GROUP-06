import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-design3d',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './design3d.html',
  styleUrl: './design3d.css',
})
export class Design3d {
  showInfo = false;

  openInfo(): void {
    this.showInfo = true;
  }
  
  isSidebarCollapsed = false;

  toggleSidebar(): void {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
  }
  flowers = [
    {
      name: 'Hoa Hồng',
      image: 'assets/images/design3d_hoahong.png',
      colors: ['Đỏ', 'Hồng', 'Trắng', 'Vàng']
    },
    {
      name: 'Hoa Ly',
      image: 'assets/images/design3d_ly.png',
      colors: ['Trắng', 'Hồng', 'Vàng']
    },
    {
      name: 'Hoa Hướng Dương',
      image: 'assets/images/design3d_huongduong.png',
      colors: ['Vàng']
    },
    {
      name: 'Hoa Baby',
      image: 'assets/images/design3d_baby.png',
      colors: ['Trắng']
    },
    {
      name: 'Hoa Đồng Tiền',
      image: 'assets/images/design3d_dongtien.png',
      colors: ['Đỏ', 'Hồng', 'Vàng', 'Trắng']
    },
    {
      name: 'Hoa Cẩm Chướng',
      image: 'assets/images/design3d_camchuong.png',
      colors: ['Hồng', 'Đỏ', 'Trắng']
    },
    {
      name: 'Hoa Cúc',
      image: 'assets/images/design3d_cuc.png',
      colors: ['Trắng', 'Vàng']
    },
    {
      name: 'Hoa Huệ',
      image: 'assets/images/design3d_hue.png',
      colors: ['Trắng']
    },
    {
      name: 'Hoa Tulip',
      image: 'assets/images/design3d_tulip.png',
      colors: ['Hồng', 'Đỏ', 'Vàng', 'Tím', 'Trắng']
    },
    {
      name: 'Hoa Sen',
      image: 'assets/images/design3d_sen.png',
      colors: ['Hồng', 'Trắng']
    },
    {
      name: 'Hoa Cát Tường',
      image: 'assets/images/design3d_cattuong.png',
      colors: ['Tím', 'Trắng', 'Hồng']
    },
    {
      name: 'Hoa Lan',
      image: 'assets/images/design3d_lan.png',
      colors: ['Tím', 'Trắng', 'Vàng']
    }
  ];
  selectedFlowers: any[] = [];
  addFlower(flower: any): void {
    const existing = this.selectedFlowers.find(
      item => item.name === flower.name
    );

    if (existing) {
      existing.quantity++;
    } else {
      this.selectedFlowers.push({
        ...flower,
        quantity: 1,
        selectedColor: flower.colors[0]
      });
    }
  }
  increaseQuantity(flower: any): void {
    flower.quantity++;
  }

  decreaseQuantity(flower: any): void {
    if (flower.quantity > 1) {
      flower.quantity--;
    }
  }

  removeFlower(flower: any): void {
    this.selectedFlowers = this.selectedFlowers.filter(
      item => item !== flower
    );
  }
  getTotalFlowers(): number {
    return this.selectedFlowers.reduce(
      (total, flower) => total + flower.quantity,
      0
    );
  }

  getTotalTypes(): number {
    return this.selectedFlowers.length;
  }
  clearAllFlowers(): void {
    this.selectedFlowers = [];
  }
} 