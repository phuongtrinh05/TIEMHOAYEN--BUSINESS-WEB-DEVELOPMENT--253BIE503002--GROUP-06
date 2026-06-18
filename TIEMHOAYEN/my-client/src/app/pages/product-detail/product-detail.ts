import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
    selector: 'app-product-detail',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './product-detail.html',
    styleUrls: ['./product-detail.css']
})
export class ProductDetailComponent {
    quantity: number = 1;

    product = {
        name: 'Hộp Hoa Sắc Cam Thịnh Vượng - HH66',
        sku: '47',
        image: 'assets/images/hoa.jpg',
        rating: 5.0,
        reviewCount: 130,
        sold: 224,
        salePrice: 990000,
        oldPrice: 1100000,
        discount: 10
    };

    reviews = [
        {
            name: 'Minh Anh Lê',
            avatar: 'assets/images/hoa.jpg',
            time: '2 ngày trước',
            content: 'Hoa rất tươi, đóng gói cẩn thận. Màu sắc y hệt như trên hình, bạn mình rất thích món quà này. Dịch vụ chăm sóc khách hàng cũng rất chu đáo.'
        },
        {
            name: 'Hoàng Nguyên',
            avatar: 'assets/images/hoa.jpg',
            time: '1 tuần trước',
            content: 'Giao hàng nhanh, đúng mẫu. Shop còn tặng kèm thiệp rất xinh xắn. Chắc chắn sẽ quay lại ủng hộ Tiệm Hoa Yên nhiều lần nữa.'
        }
    ];

    relatedProducts = [
        {
            name: 'Melodious',
            image: 'assets/images/hoa.jpg',
            price: 890000
        },
        {
            name: 'Orchid Dream',
            image: 'assets/images/hoa.jpg',
            price: 1290000
        },
        {
            name: 'Đong đầy',
            image: 'assets/images/hoa.jpg',
            price: 1290000
        },
        {
            name: 'Serenity Blossom',
            image: 'assets/images/hoa.jpg',
            price: 990000
        },
        {
            name: 'Chung thủy',
            image: 'assets/images/hoa.jpg',
            price: 850000
        }
    ];

    get maxQuantity(): number {
        return Number(this.product.sku);
    }

    increaseQuantity(): void {
        if (this.quantity < this.maxQuantity) {
            this.quantity++;
        }
    }

    decreaseQuantity(): void {
        if (this.quantity > 1) {
            this.quantity--;
        }
    }

    onQuantityInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        const value = Number(input.value);

        if (input.value === '') {
            return;
        }

        if (value < 1) {
            this.quantity = 1;
            input.value = '1';
            return;
        }

        if (value > this.maxQuantity) {
            this.quantity = this.maxQuantity;
            input.value = String(this.maxQuantity);
            return;
        }

        this.quantity = value;
    }

    validateQuantity(): void {
        if (!this.quantity || this.quantity < 1) {
            this.quantity = 1;
            return;
        }

        if (this.quantity > this.maxQuantity) {
            this.quantity = this.maxQuantity;
        }
    }

    addToCart(): void {
        alert(`Đã thêm ${this.quantity} sản phẩm vào giỏ hàng`);
    }

    buyNow(): void {
        alert(`Mua ngay ${this.quantity} sản phẩm`);
    }
}