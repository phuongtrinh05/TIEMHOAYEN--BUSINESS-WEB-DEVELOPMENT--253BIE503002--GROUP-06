import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PageHeader } from '../../../components/page-header/page-header';
import { PageFooter } from '../../../components/page-footer/page-footer';

interface CartItem {
  id: number;
  name: string;
  style: string;
  occasion: string;
  price: number;
  originalPrice?: number;
  quantity: number;
  image: string;
  selected: boolean;
}

interface SuggestedProduct {
  id: number;
  name: string;
  price: number;
  image: string;
}

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageFooter, PageHeader],
  templateUrl: './cart.html',
  styleUrl: './cart.css',
})
export class CartComponent {

  // Phí ship cố định
  shippingFee = 30000;

  // Voucher giảm giá
  voucherDiscount = 20000;
  shippingDiscount = 30000;

  // Giả lập dữ liệu giỏ hàng
  cartItems: CartItem[] = [
    {
      id: 1,
      name: 'Melodious',
      style: 'Bó hoa',
      occasion: 'Sinh nhật',
      price: 699000,
      originalPrice: 850000,
      quantity: 1,
      image: 'assets/images/cart-melodious.png',
      selected: true,
    },
    {
      id: 2,
      name: 'Khai trương hồng phát',
      style: 'Lẵng hoa',
      occasion: 'Khai trương',
      price: 1450000,
      quantity: 1,
      image: 'assets/images/cart-khaitruonghongphat.png',
      selected: true,
    },
    {
      id: 3,
      name: 'Say đắm',
      style: 'Bó hoa',
      occasion: 'Sinh nhật',
      price: 420000,
      quantity: 1,
      image: 'assets/images/cart-saydam.png',
      selected: true,
    },
  ];

  // Giả lập sản phẩm gợi ý mua kèm
  suggestedProducts: SuggestedProduct[] = [
    {
      id: 1,
      name: 'Gấu bông',
      price: 160000,
      image: 'assets/images/cart-gaubong.png',
    },
    {
      id: 2,
      name: 'Nến thơm',
      price: 220000,
      image: 'assets/images/cart-nenthom.png',
    },
    {
      id: 3,
      name: 'Thiệp',
      price: 20000,
      image: 'assets/images/cart-anhthiep.png',
    },
    {
      id: 4,
      name: 'Túi quà cao cấp',
      price: 100000,
      image: 'assets/images/cart-tuiquacaocap.png',
    },
  ];

  /** Lấy số sản phẩm đã chọn */
  getSelectedCount(): number {
    return this.cartItems.filter(item => item.selected).length;
  }

  /** Kiểm tra đã chọn tất cả chưa */
  isAllSelected(): boolean {
    return this.cartItems.length > 0 && this.cartItems.every(item => item.selected);
  }

  /** Chọn/bỏ chọn tất cả */
  toggleSelectAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.cartItems.forEach(item => item.selected = checked);
  }

  /** Tăng số lượng */
  increaseQty(item: CartItem): void {
    item.quantity++;
  }

  /** Giảm số lượng */
  decreaseQty(item: CartItem): void {
    if (item.quantity > 1) {
      item.quantity--;
    }
  }

  /** Xóa sản phẩm khỏi giỏ */
  removeItem(item: CartItem): void {
    this.cartItems = this.cartItems.filter(i => i.id !== item.id);
  }

  /** Tính tạm tính (chỉ sản phẩm đã chọn) */
  getSubtotal(): number {
    return this.cartItems
      .filter(item => item.selected)
      .reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  /** Tính tổng cộng */
  getTotal(): number {
    return this.getSubtotal() + this.shippingFee - this.voucherDiscount - this.shippingDiscount;
  }

  /** Lấy danh sách gợi ý */
  getSuggestedProducts(): SuggestedProduct[] {
    return this.suggestedProducts;
  }

  /** Thêm sản phẩm gợi ý vào giỏ */
  addToCart(product: SuggestedProduct): void {
    // TODO: Gọi API thêm giỏ hàng khi có backend
    console.log('Thêm vào giỏ:', product.name);
    alert(`Đã thêm "${product.name}" vào giỏ hàng! (Giả lập)`);
  }

  /** Slide gợi ý - prev */
  prevSlide(): void {
    // TODO: Implement slide nếu cần
  }

  /** Slide gợi ý - next */
  nextSlide(): void {
    // TODO: Implement slide nếu cần
  }

  /** Format tiền VND */
  formatPrice(price: number): string {
    return price.toLocaleString('vi-VN') + 'đ';
  }
}
