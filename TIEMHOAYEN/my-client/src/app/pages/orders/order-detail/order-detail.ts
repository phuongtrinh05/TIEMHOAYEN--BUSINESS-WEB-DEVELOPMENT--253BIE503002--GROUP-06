import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.css'
})
export class OrderDetail {

  currentStep = 1;

  order = {
    id: 'YEN1000',
    date: '11/05/2026',

    receiver: 'Trần Minh Anh',
    phone: '0987 489 733',

    deliveryDate: '14/05/2026',
    deliveryTime: '8:00 - 12:00',

    address:
      '123 Đường Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP Hồ Chí Minh',

    cardMessage:
      'Mong em luôn xinh đẹp, hạnh phúc và luôn mỉm cười mỗi ngày. Yêu em!',

    paymentMethod:
      'Chuyển khoản MOMO'
  };

  products = [
    {
      image:'assets/images/order-detail-saydam.png',
      name:'Say đắm',
      price:500000,
      quantity:1
    },
    {
      image:'assets/images/order-detail-thiep.png',
      name:'Thiệp chúc mừng',
      price:20000,
      quantity:1
    }
  ];

  status = 'preparing';
  // preparing
  // delivering
  // delivered
  // refund_requested
  // refunded
  // refund_rejected
  // failed
  // cancelled

  steps: any[] = [];

  ngOnInit() {
    this.loadSteps();
  }

  loadSteps() {

    const flows: any = {

      preparing: [
        { icon:'bi-receipt', text:'Đặt hàng thành công', done:true },
        { icon:'bi-gift', text:'Đang chuẩn bị', current:true },
        { icon:'bi-truck', text:'Đang giao' },
        { icon:'bi-clipboard-check', text:'Giao hàng thành công' }
      ],

      delivering: [
        { icon:'bi-receipt', text:'Đặt hàng thành công', done:true },
        { icon:'bi-gift', text:'Đang chuẩn bị', done:true },
        { icon:'bi-truck', text:'Đang giao', current:true },
        { icon:'bi-clipboard-check', text:'Giao hàng thành công' }
      ],

      delivered: [
        { icon:'bi-receipt', text:'Đặt hàng thành công', done:true },
        { icon:'bi-gift', text:'Đang chuẩn bị', done:true },
        { icon:'bi-truck', text:'Đang giao', done:true },
        { icon:'bi-clipboard-check', text:'Giao hàng thành công', current:true }
      ],

      refund_requested: [
        { icon:'bi-receipt', text:'Đặt hàng thành công', done:true },
        { icon:'bi-gift', text:'Đang chuẩn bị', done:true },
        { icon:'bi-truck', text:'Đang giao', done:true },
        { icon:'bi-clipboard-check', text:'Giao hàng thành công', done:true },
        { icon:'bi-arrow-counterclockwise', text:'Yêu cầu trả hàng & hoàn tiền', current:true },
        { icon:'bi-x-lg', text:'Từ chối hoàn trả' }
      ],

      refunded: [
        { icon:'bi-receipt', text:'Đặt hàng thành công', done:true },
        { icon:'bi-gift', text:'Đang chuẩn bị', done:true },
        { icon:'bi-truck', text:'Đang giao', done:true },
        { icon:'bi-clipboard-check', text:'Giao hàng thành công', done:true },
        { icon:'bi-arrow-counterclockwise', text:'Yêu cầu trả hàng & hoàn tiền', done:true },
        { icon:'bi-check-lg', text:'Xác nhận trả hàng', done:true },
        { icon:'bi-check2-all', text:'Trả hàng thành công', current:true }
      ],

      failed: [
        { icon:'bi-receipt', text:'Đặt hàng thành công', done:true },
        { icon:'bi-gift', text:'Đang chuẩn bị', done:true },
        { icon:'bi-truck', text:'Đang giao', done:true },
        { icon:'bi-exclamation-lg', text:'Giao hàng không thành công', current:true }
      ],

      cancelled: [
        { icon:'bi-receipt', text:'Đặt hàng thành công', done:true },
        { icon:'bi-gift', text:'Đang chuẩn bị', done:true },
        { icon:'bi-x-lg', text:'Đã hủy', current:true }
      ]

    };

    this.steps = flows[this.status];
  }

}