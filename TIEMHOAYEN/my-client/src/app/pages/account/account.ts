import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PageHeader } from '../../components/page-header/page-header';
import { PageFooter } from '../../components/page-footer/page-footer';

// ===== INTERFACES =====
interface UserInfo {
  fullName: string;
  gender: string;
  email: string;
  birthDate: string;
  phone: string;
  avatar: string;
}

interface Order {
  id: string;
  date: string;
  total: number;
  status: 'Đang xử lý' | 'Đang giao' | 'Đã hủy' | 'Hoàn thành';
}

interface WishlistItem {
  id: number;
  name: string;
  price: number;
  image: string;
}

interface Address {
  id: number;
  label: string;
  isDefault: boolean;
  name: string;
  phone: string;
  detail: string;
}

interface Voucher {
  code: string;
  description: string;
  condition: string;
  expiry: string;
}

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageFooter, PageHeader],
  templateUrl: './account.html',
  styleUrl: './account.css',
})
export class AccountComponent {

  // ===== ACTIVE SECTION =====
  activeSection = 'thongtin';

  // ===== TODO: replace with API call GET /api/user/profile =====
  userInfo: UserInfo = {
    fullName: 'Nguyễn Hoàng Ngọc',
    gender: 'Nam',
    email: 'ngocng@gmail.com',
    birthDate: '14/03/2005',
    phone: '0987 489 733',
    avatar: 'assets/images/account-avt.png',
  };

  // ===== TODO: replace with API call GET /api/orders =====
  orders: Order[] = [
    { id: '#YENI000', date: '11/05/2026', total: 2730000, status: 'Đang xử lý' },
    { id: '#YENI001', date: '08/03/2026', total: 1130000, status: 'Đang giao' },
    { id: '#YENI002', date: '22/02/2026', total: 2430000, status: 'Đã hủy' },
    { id: '#YENI003', date: '14/01/2026', total: 730000,  status: 'Hoàn thành' },
  ];
  showAllOrders = false;

  get displayedOrders(): Order[] {
    return this.showAllOrders ? this.orders : this.orders.slice(0, 4);
  }

  // ===== TODO: replace with API call GET /api/user/membership =====
  membershipTier = 'Kim cương';
  rewardPoints = 1250;
  rewardValue = 125000;

  // ===== TODO: replace with API call GET /api/user/wishlist =====
  wishlistItems: WishlistItem[] = [
    { id: 1, name: 'Chung thủy', price: 1220000, image: 'assets/images/account-chungthuy.png' },
    { id: 2, name: 'Thành công', price: 830000,  image: 'assets/images/account-thanhcong.png' },
    { id: 3, name: 'Thuận lợi',  price: 2670000, image: 'assets/images/account-thuanloi.png' },
    { id: 4, name: 'Đong đầy',   price: 1370000, image: 'assets/images/account-dongday.png' },
  ];

  // ===== TODO: replace with API call GET /api/user/addresses =====
  addresses: Address[] = [
    {
      id: 1, label: 'Nhà riêng', isDefault: true,
      name: 'Nguyễn Hoàng Ngọc', phone: '0987 489 733',
      detail: '123 Đường Nguyễn Huệ, Phường Bến Nghé, Quận 1, Tp.Hồ Chí Minh',
    },
    {
      id: 2, label: 'Cơ quan', isDefault: false,
      name: 'Nguyễn Hoàng Tú', phone: '0987 489 469',
      detail: '72 Đường Lê Thánh Tôn, Phường Bến Nghé, Quận 1, Tp.Hồ Chí Minh',
    },
    {
      id: 3, label: 'Nhà bố mẹ', isDefault: false,
      name: 'Hoàng Đặc Mai', phone: '0987 687 001',
      detail: '10 Đường 3/2, Phường 11, Quận 10, TP. Hồ Chí Minh',
    },
  ];
  currentAddressIndex = 0;

  // ===== TODO: replace with API call GET /api/user/vouchers =====
  vouchers: Voucher[] = [
    { code: 'YEN10', description: 'Giảm 10% đơn hàng', condition: 'Đơn tối thiểu 500.000đ', expiry: '30/10/2026' },
    { code: 'YEN20', description: 'Giảm 20% đơn hàng', condition: 'Đơn tối thiểu 500.000đ', expiry: '30/10/2026' },
  ];
  showAllVouchers = false;

  get displayedVouchers(): Voucher[] {
    return this.showAllVouchers ? this.vouchers : this.vouchers.slice(0, 2);
  }

  // ===== MODAL SỬA HỒ SƠ =====
  showEditModal = false;

  editData = {
    fullName: '',
    phone: '',
    email: '',
    birthDate: '',
    gender: '',
  };

  /** Mở modal, copy dữ liệu hiện tại vào form, cuộn lên đầu trang */
  openEditModal(): void {
    this.editData = { ...this.userInfo };
    this.showEditModal = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Đóng modal khi bấm "Để sau" */
  closeModal(): void {
    this.showEditModal = false;
  }

  /** Đóng modal khi click ra ngoài overlay */
  closeEditModal(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.showEditModal = false;
    }
  }

  /** Lưu thông tin đã sửa */
  saveProfile(): void {
    this.userInfo = { ...this.userInfo, ...this.editData };
    this.showEditModal = false;
    // / Nếu có lỗi validation thì không lưu
    if (!this.editData.fullName || this.editData.fullName.length < 2) return;
    if (!this.editData.phone) return;

    this.userInfo = { ...this.userInfo, ...this.editData };
    this.showEditModal = false;
    // TODO: gọi API khi có backend
  }

  // ===== METHODS =====
  setActiveSection(section: string): void {
    this.activeSection = section;
  }

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      'Đang xử lý': 'status-processing',
      'Đang giao':  'status-shipping',
      'Đã hủy':     'status-cancelled',
      'Hoàn thành': 'status-done',
    };
    return map[status] || '';
  }

  formatPrice(price: number): string {
    return price.toLocaleString('vi-VN') + 'đ';
  }

  removeFromWishlist(id: number): void {
    // TODO: replace with API call DELETE /api/user/wishlist/:id
    this.wishlistItems = this.wishlistItems.filter(item => item.id !== id);
  }

  addToCart(item: WishlistItem): void {
    // TODO: replace with API call POST /api/cart
    alert(`Đã thêm "${item.name}" vào giỏ hàng!`);
  }

  prevAddress(): void {
    if (this.currentAddressIndex > 0) this.currentAddressIndex--;
  }

  nextAddress(): void {
    if (this.currentAddressIndex < this.addresses.length - 1) this.currentAddressIndex++;
  }

  setDefaultAddress(id: number): void {
    // TODO: replace with API call PUT /api/user/addresses/:id/default
    this.addresses = this.addresses.map(a => ({ ...a, isDefault: a.id === id }));
  }

  deleteAddress(id: number): void {
    // TODO: replace with API call DELETE /api/user/addresses/:id
    this.addresses = this.addresses.filter(a => a.id !== id);
  }

  useVoucher(code: string): void {
    // TODO: replace with API call POST /api/cart/voucher
    alert(`Đã áp dụng voucher: ${code}`);
  }

  logout(): void {
    // TODO: replace with API call POST /api/auth/logout + clear token
    alert('Đã đăng xuất!');
  }

  redeemPoints(): void {
    // TODO: replace with API call POST /api/user/rewards/redeem
    alert('Mở trang đổi thưởng');
  }
}
