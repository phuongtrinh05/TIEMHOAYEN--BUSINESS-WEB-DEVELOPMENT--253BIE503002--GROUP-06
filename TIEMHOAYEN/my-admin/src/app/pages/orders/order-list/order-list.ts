import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, interval, Subscription } from 'rxjs';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AdminApiService } from '../../../services/admin-api.service';

export type PaymentStatus =
  | 'Đã thanh toán'
  | 'Chờ thanh toán'
  | 'Đã cọc'
  | 'Thanh toán thất bại';

export type OrderStatus =
  | 'Đã giao'
  | 'Đang giao'
  | 'Hoàn thành'
  | 'Chờ xử lý'
  | 'Chờ thanh toán'
  | 'Đang chuẩn bị hàng'
  | 'Chờ vận chuyển'
  | 'Đã hủy';

export interface Order {
  id: string;
  customerId: string;
  createdAt: string;
  total: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  selected: boolean;
}

type TabFilter = 'Tất cả' | 'Đã hoàn thành' | 'Chờ xử lý' | 'Đã hủy';
type PaymentFilter = 'Tất cả thanh toán' | PaymentStatus;
type OrderStatusFilter = 'Tất cả trạng thái' | OrderStatus;

type DateFilter =
  | 'Tất cả'
  | 'Hôm nay'
  | '7 ngày gần đây'
  | '30 ngày gần đây'
  | 'Tháng này';

type TotalFilter =
  | 'Tất cả'
  | 'Dưới 300.000đ'
  | '300.000đ - 600.000đ'
  | 'Trên 600.000đ';

type SortOption =
  | 'Mặc định'
  | 'Ngày mới nhất'
  | 'Ngày cũ nhất'
  | '7 ngày gần nhất'
  | '30 ngày gần nhất'
  | 'Tổng tiền tăng dần'
  | 'Tổng tiền giảm dần'
  | 'Mã đơn A-Z'
  | 'Mã đơn Z-A';

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule
  ],
  templateUrl: './order-list.html',
  styleUrl: './order-list.css',
})
export class OrderList implements OnInit, OnDestroy {
  constructor(
    private readonly router: Router,
    private readonly adminApi: AdminApiService,
    private readonly cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private readonly platformId: object
  ) {}

  allOrders: Order[] = [];
  private filteredOrdersCache: Order[] = [];
  private totalOrderCountValue = 0;
  private newOrderCountValue = 0;
  private completedOrderCountValue = 0;
  private cancelledOrderCountValue = 0;

  tabs: TabFilter[] = ['Tất cả', 'Đã hoàn thành', 'Chờ xử lý', 'Đã hủy'];
  activeTab: TabFilter = 'Tất cả';

  paymentFilters: PaymentFilter[] = [
    'Tất cả thanh toán',
    'Đã thanh toán',
    'Chờ thanh toán',
    'Đã cọc',
    'Thanh toán thất bại',
  ];

  paymentFilter: PaymentFilter = 'Tất cả thanh toán';

  orderStatusFilters: OrderStatusFilter[] = [
    'Tất cả trạng thái',
    'Đã giao',
    'Đang giao',
    'Hoàn thành',
    'Chờ xử lý',
    'Chờ thanh toán',
    'Đang chuẩn bị hàng',
    'Chờ vận chuyển',
    'Đã hủy',
  ];

  orderStatusFilter: OrderStatusFilter = 'Tất cả trạng thái';

  dateFilters: DateFilter[] = [
    'Tất cả',
    'Hôm nay',
    '7 ngày gần đây',
    '30 ngày gần đây',
    'Tháng này',
  ];

  dateFilter: DateFilter = 'Tất cả';

  totalFilters: TotalFilter[] = [
    'Tất cả',
    'Dưới 300.000đ',
    '300.000đ - 600.000đ',
    'Trên 600.000đ',
  ];

  totalFilter: TotalFilter = 'Tất cả';

  sortOptions: SortOption[] = [
    'Mặc định',
    'Ngày mới nhất',
    'Ngày cũ nhất',
    '7 ngày gần nhất',
    '30 ngày gần nhất',
    'Tổng tiền tăng dần',
    'Tổng tiền giảm dần',
    'Mã đơn A-Z',
    'Mã đơn Z-A',
  ];

  sortOption: SortOption = 'Mặc định';

  editableOrderStatuses: OrderStatus[] = [
    'Đã giao',
    'Đang giao',
    'Hoàn thành',
    'Chờ xử lý',
    'Đang chuẩn bị hàng',
    'Chờ vận chuyển',
    'Đã hủy',
  ];

  searchKeyword = '';
  currentPage = 1;
  pageSize = 10;

  isFilterMenuOpen = false;
  isSortMenuOpen = false;
  isMoreMenuOpen = false;
  isEditStatusMenuOpen = false;
  isExportMenuOpen = false;
  isLoading = false;
  loadError = '';
  private readonly liveRefreshMs = 10000;
  private liveRefreshSub?: Subscription;
  private isLiveRefreshInFlight = false;

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadOrders();
      this.startLiveDatabaseRefresh();
    }
  }

  ngOnDestroy(): void {
    this.liveRefreshSub?.unsubscribe();
  }

  private normalizePaymentStatusText(value: string): PaymentStatus {
    const raw = String(value || '');
    const lower = raw.toLowerCase();

    if (raw.includes('???? c???c') || lower.includes('c?c') || lower.includes('coc')) {
      return '\u0110\u00e3 c\u1ecdc';
    }

    if (raw.includes('Ch??a thanh to??n') || lower.includes('ch?a') || lower.includes('chua') || lower.includes('cho') || lower.includes('chờ')) {
      return 'Chờ thanh toán';
    }

    if (raw.includes('Thanh to??n th???t b???i') || lower.includes('th?t b?i') || lower.includes('that bai')) {
      return 'Thanh to\u00e1n th\u1ea5t b\u1ea1i';
    }

    if (raw.includes('???? thanh to??n') || lower.includes('?? thanh to?n') || lower.includes('da thanh toan')) {
      return '\u0110\u00e3 thanh to\u00e1n';
    }

    return raw as PaymentStatus;
  }

  private repairMojibakeText(value: string): string {
    const raw = String(value || '');
    if (!/[\u00c2\u00c3\u00c4\u00c6\u00e1]/.test(raw)) return raw;

    try {
      return decodeURIComponent(
        Array.from(raw, char => '%' + char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
      );
    } catch {
      return raw;
    }
  }

  private normalizeOrderStatusText(value: string): OrderStatus {
    const raw = this.repairMojibakeText(value).trim();
    const lower = raw.toLowerCase();

    if (!raw) return 'Ch\u1edd x\u1eed l\u00fd';
    if (lower.includes('thanh to') || lower.includes('thanh toán') || lower.includes('thanh toan')) return 'Ch\u1edd thanh to\u00e1n';
    if (lower.includes('h\u1ee7y') || lower.includes('huy')) return '\u0110\u00e3 h\u1ee7y';
    if (lower.includes('ho\u00e0n th\u00e0nh') || lower.includes('hoan thanh')) return 'Ho\u00e0n th\u00e0nh';
    if (lower.includes('\u0111\u00e3 giao') || lower.includes('da giao')) return '\u0110\u00e3 giao';
    if (lower.includes('\u0111ang giao') || lower.includes('dang giao')) return '\u0110ang giao';
    if (lower.includes('chu\u1ea9n b\u1ecb') || lower.includes('chuan bi')) return '\u0110ang chu\u1ea9n b\u1ecb h\u00e0ng';
    if (lower.includes('v\u1eadn chuy\u1ec3n') || lower.includes('van chuyen')) return 'Ch\u1edd v\u1eadn chuy\u1ec3n';

    return raw as OrderStatus;
  }

  displayCustomerId(order: Order): string {
    return order.customerId || 'Kh\u00e1ch l\u1ebb';
  }

  private loadOrders(forceRefresh = false, preservePage = false): void {
    if (preservePage && this.isLiveRefreshInFlight) {
      return;
    }

    const previousPage = this.currentPage;
    const selectedIds = preservePage
      ? new Set(this.selectedOrders.map(order => order.id))
      : new Set<string>();

    if (preservePage) {
      this.isLiveRefreshInFlight = true;
    } else {
      this.isLoading = true;
      this.loadError = '';
    }

    const ordersRequest = forceRefresh
      ? this.adminApi.refreshOrdersFromDatabase()
      : this.adminApi.getOrders();

    ordersRequest.subscribe({
      next: (response) => {
        this.allOrders = response.orders.map(order => ({
          id: order.id,
          customerId: order.customerId || '',
          createdAt: order.createdAt,
          total: Number(order.total || 0),
          paymentStatus: this.normalizePaymentStatusText(order.paymentStatus),
          orderStatus: this.normalizeOrderStatusText(order.orderStatus),
          selected: selectedIds.has(order.id),
        }));
        this.currentPage = preservePage ? previousPage : 1;
        this.rebuildOrderView();
        this.isLoading = false;
        this.isLiveRefreshInFlight = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Khong the tai danh sach don hang admin:', error);
        if (!preservePage) {
          this.loadError = 'Khong the tai danh sach don hang tu backend.';
        }
        this.isLoading = false;
        this.isLiveRefreshInFlight = false;
        this.cdr.detectChanges();
      },
    });
  }

  private startLiveDatabaseRefresh(): void {
    this.liveRefreshSub?.unsubscribe();
    this.liveRefreshSub = interval(this.liveRefreshMs).subscribe(() => {
      if (this.shouldPauseLiveRefresh()) {
        return;
      }

      this.loadOrders(true, true);
    });
  }

  private shouldPauseLiveRefresh(): boolean {
    return (
      this.selectedOrders.length > 0 ||
      this.isFilterMenuOpen ||
      this.isSortMenuOpen ||
      this.isMoreMenuOpen ||
      this.isEditStatusMenuOpen ||
      this.isExportMenuOpen
    );
  }

  get totalOrderCount(): number {
    return this.totalOrderCountValue;
  }

  get newOrderCount(): number {
    return this.newOrderCountValue;
  }

  get completedOrderCount(): number {
    return this.completedOrderCountValue;
  }

  get cancelledOrderCount(): number {
    return this.cancelledOrderCountValue;
  }

  get selectedOrders(): Order[] {
    return this.allOrders.filter(order => order.selected);
  }

  get allSelected(): boolean {
    return this.pagedOrders.length > 0 && this.pagedOrders.every(order => order.selected);
  }

  get hasActiveFilter(): boolean {
    return (
      this.paymentFilter !== 'Tất cả thanh toán' ||
      this.orderStatusFilter !== 'Tất cả trạng thái' ||
      this.dateFilter !== 'Tất cả' ||
      this.totalFilter !== 'Tất cả'
    );
  }

  get filteredOrders(): Order[] {
    return this.filteredOrdersCache;
  }

  private rebuildOrderView(): void {
    this.rebuildStats();
    this.filteredOrdersCache = this.buildFilteredOrders();
    this.ensureValidPage();
  }

  private rebuildStats(): void {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    this.totalOrderCountValue = this.allOrders.length;
    this.newOrderCountValue = 0;
    this.completedOrderCountValue = 0;
    this.cancelledOrderCountValue = 0;

    this.allOrders.forEach(order => {
      if (this.parseDate(order.createdAt) >= sevenDaysAgo) {
        this.newOrderCountValue++;
      }
      const normalizedStatus = this.normalize(order.orderStatus);
      if (normalizedStatus.includes('hoan thanh')) {
        this.completedOrderCountValue++;
      }
      if (normalizedStatus.includes('huy')) {
        this.cancelledOrderCountValue++;
      }
    });
  }

  private buildFilteredOrders(): Order[] {
    let list = [...this.allOrders];

    if (this.activeTab === 'Đã hoàn thành') {
      list = list.filter(order => order.orderStatus === 'Hoàn thành');
    } else if (this.activeTab === 'Chờ xử lý') {
      list = list.filter(order => order.orderStatus === 'Chờ xử lý');
    } else if (this.activeTab === 'Đã hủy') {
      list = list.filter(order => order.orderStatus === 'Đã hủy');
    }

    if (this.paymentFilter !== 'Tất cả thanh toán') {
      list = list.filter(order => order.paymentStatus === this.paymentFilter);
    }

    if (this.orderStatusFilter !== 'Tất cả trạng thái') {
      list = list.filter(order => order.orderStatus === this.orderStatusFilter);
    }

    list = this.filterByDate(list);
    list = this.filterByTotal(list);

    // Tìm kiếm bỏ dấu tiếng Việt, đồng bộ quy tắc với article-list.
    const keyword = this.normalize(this.searchKeyword.trim());
    if (keyword) {
      list = list.filter(order =>
        this.normalize(order.id).includes(keyword) ||
        this.normalize(order.customerId).includes(keyword) ||
        this.normalize(order.createdAt).includes(keyword) ||
        this.normalize(order.paymentStatus).includes(keyword) ||
        this.normalize(order.orderStatus).includes(keyword) ||
        this.normalize(this.formatCurrency(order.total)).includes(keyword)
      );
    }

    return this.sortOrders(list);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredOrders.length / this.pageSize));
  }

  get pagedOrders(): Order[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredOrders.slice(start, start + this.pageSize);
  }

  trackByOrderId(_index: number, order: Order): string {
    return order.id;
  }

  get pageNumbers(): (number | '...')[] {
    const total = this.totalPages;
    if (total <= 7) {
      return Array.from({ length: total }, (_, index) => index + 1);
    }
    return [1, 2, 3, 4, 5, '...', total];
  }

  // ===== ĐIỀU HƯỚNG TỚI TRANG CHI TIẾT ĐƠN HÀNG =====
  goToOrderDetail(order: Order): void {
    this.router.navigate(['/orders/order-detail', order.id], {
      state: { order },
    });
  }

  // ===== ĐIỀU HƯỚNG TỚI TRANG TẠO ĐƠN HÀNG MỚI =====
  goToCreateOrder(): void {
    this.router.navigate(['/orders/create-order']);
  }

  setTab(tab: TabFilter): void {
    this.activeTab = tab;
    this.currentPage = 1;
    this.rebuildOrderView();
    this.closeAllMenus();
  }

  applyFilter(): void {
    this.currentPage = 1;
    this.rebuildOrderView();
  }

  clearFilters(): void {
    this.paymentFilter = 'Tất cả thanh toán';
    this.orderStatusFilter = 'Tất cả trạng thái';
    this.dateFilter = 'Tất cả';
    this.totalFilter = 'Tất cả';
    this.currentPage = 1;
    this.rebuildOrderView();
  }

  setSortOption(option: SortOption): void {
    this.sortOption = option;
    this.currentPage = 1;
    this.rebuildOrderView();
    this.closeAllMenus();
  }

  onSearch(): void {
    this.currentPage = 1;
    this.rebuildOrderView();
  }

  setPage(page: number | '...'): void {
    if (page === '...') return;
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.closeAllMenus();
    }
  }

  prevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.closeAllMenus();
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.closeAllMenus();
    }
  }

  private ensureValidPage(): void {
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }
    if (this.currentPage < 1) {
      this.currentPage = 1;
    }
  }

  toggleSelectAll(checked: boolean): void {
    this.pagedOrders.forEach(order => {
      order.selected = checked;
    });
  }

  toggleFilterMenu(): void {
    this.isFilterMenuOpen = !this.isFilterMenuOpen;
    this.isSortMenuOpen = false;
    this.isMoreMenuOpen = false;
    this.isEditStatusMenuOpen = false;
    this.isExportMenuOpen = false;
  }

  toggleSortMenu(): void {
    this.isSortMenuOpen = !this.isSortMenuOpen;
    this.isFilterMenuOpen = false;
    this.isMoreMenuOpen = false;
    this.isEditStatusMenuOpen = false;
    this.isExportMenuOpen = false;
  }

  toggleMoreMenu(): void {
    this.isMoreMenuOpen = !this.isMoreMenuOpen;
    this.isEditStatusMenuOpen = false;
    this.isFilterMenuOpen = false;
    this.isSortMenuOpen = false;
    this.isExportMenuOpen = false;
  }

  toggleExportMenu(): void {
    this.isExportMenuOpen = !this.isExportMenuOpen;
    this.isFilterMenuOpen = false;
    this.isSortMenuOpen = false;
    this.isMoreMenuOpen = false;
    this.isEditStatusMenuOpen = false;
  }

  closeAllMenus(): void {
    this.isFilterMenuOpen = false;
    this.isSortMenuOpen = false;
    this.isMoreMenuOpen = false;
    this.isEditStatusMenuOpen = false;
    this.isExportMenuOpen = false;
  }

  openEditStatusMenu(): void {
    if (this.selectedOrders.length === 0) {
      alert('Vui lòng chọn ít nhất một đơn hàng để sửa trạng thái.');
      this.closeAllMenus();
      return;
    }
    this.isMoreMenuOpen = true;
    this.isEditStatusMenuOpen = true;
  }

  updateSelectedOrderStatus(status: OrderStatus): void {
    if (this.selectedOrders.length === 0) {
      alert('Vui lòng chọn ít nhất một đơn hàng để sửa trạng thái.');
      this.closeAllMenus();
      return;
    }

    const selectedIds = this.selectedOrders.map(order => order.id);
    const requests = selectedIds.map(orderId => this.adminApi.updateOrderStatus(orderId, status));

    this.allOrders = this.allOrders.map(order => {
      if (!selectedIds.includes(order.id)) return order;
      return { ...order, orderStatus: status, selected: false };
    });
    this.rebuildOrderView();

    forkJoin(requests).subscribe({
      next: () => this.loadOrders(true, true),
      error: (error) => {
        console.error('Khong the cap nhat trang thai don hang:', error);
        this.loadOrders(true);
      },
    });

    this.closeAllMenus();
  }

  deleteSelectedOrders(): void {
    if (this.selectedOrders.length === 0) {
      this.closeAllMenus();
      return;
    }

    this.allOrders = this.allOrders.filter(order => !order.selected);
    this.currentPage = 1;
    this.rebuildOrderView();
    this.closeAllMenus();
  }

  // ===== XUẤT DỮ LIỆU (đồng bộ quy tắc với article-list) =====
  private buildExportRows(): {
    header: string[];
    rows: (string | number)[][];
    fileBase: string;
  } {
    const stamp = new Date().toISOString().slice(0, 10);
    const source = this.selectedOrders.length ? this.selectedOrders : this.filteredOrders;
    const header = ['Mã đơn', 'Mã khách hàng', 'Ngày tạo', 'Tổng tiền', 'Thanh toán', 'Trạng thái'];
    const rows = source.map(order => [
      order.id,
      order.customerId,
      order.createdAt,
      this.formatCurrency(order.total),
      order.paymentStatus,
      order.orderStatus,
    ]);

    return {
      header,
      rows,
      fileBase: `don-hang_${stamp}`,
    };
  }

  private async saveOrDownload(blob: Blob, fileName: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async exportExcel(): Promise<void> {
    const { rows, header, fileBase } = this.buildExportRows();
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);

    ws['!cols'] = header.map(() => ({ wch: 20 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');

    const arrayBuffer: ArrayBuffer = XLSX.write(wb, {
      bookType: 'xlsx',
      type: 'array',
    });

    const blob = new Blob([arrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await this.saveOrDownload(blob, `${fileBase}.xlsx`);
    this.closeAllMenus();
  }

  async exportPdf(): Promise<void> {
    const { rows, header, fileBase } = this.buildExportRows();
    const doc = new jsPDF({ orientation: 'landscape' });

    autoTable(doc, {
      head: [header],
      body: rows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [115, 25, 25] },
    });

    const blob = doc.output('blob');

    await this.saveOrDownload(blob, `${fileBase}.pdf`);
    this.closeAllMenus();
  }

  paymentClass(status: PaymentStatus): string {
    const map: Record<PaymentStatus, string> = {
      'Đã thanh toán': 'payment--paid',
      'Chờ thanh toán': 'payment--unpaid',
      'Đã cọc': 'payment--deposit',
      'Thanh toán thất bại': 'payment--failed',
    };
    return map[status];
  }

  orderStatusClass(status: OrderStatus): string {
    const map: Record<OrderStatus, string> = {
      'Đã giao': 'status--delivered',
      'Đang giao': 'status--shipping',
      'Hoàn thành': 'status--completed',
      'Chờ xử lý': 'status--pending',
      'Chờ thanh toán': 'status--pending',
      'Đang chuẩn bị hàng': 'status--preparing',
      'Chờ vận chuyển': 'status--waiting',
      'Đã hủy': 'status--cancelled',
    };
    return map[status];
  }

  formatCurrency(value: number): string {
    return `${value.toLocaleString('vi-VN')}đ`;
  }

  private sortOrders(orders: Order[]): Order[] {
    const sorted = [...orders];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (this.sortOption) {
      case 'Ngày mới nhất':
        return sorted.sort((a, b) => this.parseDate(b.createdAt) - this.parseDate(a.createdAt));

      case 'Ngày cũ nhất':
        return sorted.sort((a, b) => this.parseDate(a.createdAt) - this.parseDate(b.createdAt));

      case '7 ngày gần nhất': {
        const past7 = new Date(today);
        past7.setDate(today.getDate() - 7);
        return sorted
          .filter(o => {
            const d = new Date(this.parseDate(o.createdAt));
            const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            return start >= past7 && start <= today;
          })
          .sort((a, b) => this.parseDate(b.createdAt) - this.parseDate(a.createdAt));
      }

      case '30 ngày gần nhất': {
        const past30 = new Date(today);
        past30.setDate(today.getDate() - 30);
        return sorted
          .filter(o => {
            const d = new Date(this.parseDate(o.createdAt));
            const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            return start >= past30 && start <= today;
          })
          .sort((a, b) => this.parseDate(b.createdAt) - this.parseDate(a.createdAt));
      }

      case 'Tổng tiền tăng dần':
        return sorted.sort((a, b) => a.total - b.total);

      case 'Tổng tiền giảm dần':
        return sorted.sort((a, b) => b.total - a.total);

      case 'Mã đơn A-Z':
        return sorted.sort((a, b) => a.id.localeCompare(b.id));

      case 'Mã đơn Z-A':
        return sorted.sort((a, b) => b.id.localeCompare(a.id));

      default:
        return sorted;
    }
  }

  private filterByTotal(orders: Order[]): Order[] {
    if (this.totalFilter === 'Tất cả') return orders;

    return orders.filter(order => {
      switch (this.totalFilter) {
        case 'Dưới 300.000đ':
          return order.total < 300000;
        case '300.000đ - 600.000đ':
          return order.total >= 300000 && order.total <= 600000;
        case 'Trên 600.000đ':
          return order.total > 600000;
        default:
          return true;
      }
    });
  }

  private filterByDate(orders: Order[]): Order[] {
    if (this.dateFilter === 'Tất cả') return orders;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return orders.filter(order => {
      const orderDate = new Date(this.parseDate(order.createdAt));
      const startOfOrderDate = new Date(
        orderDate.getFullYear(),
        orderDate.getMonth(),
        orderDate.getDate()
      );

      switch (this.dateFilter) {
        case 'Hôm nay':
          return startOfOrderDate.getTime() === today.getTime();

        case '7 ngày gần đây': {
          const past7Days = new Date(today);
          past7Days.setDate(today.getDate() - 7);
          return startOfOrderDate >= past7Days && startOfOrderDate <= today;
        }

        case '30 ngày gần đây': {
          const past30Days = new Date(today);
          past30Days.setDate(today.getDate() - 30);
          return startOfOrderDate >= past30Days && startOfOrderDate <= today;
        }

        case 'Tháng này':
          return (
            startOfOrderDate.getMonth() === today.getMonth() &&
            startOfOrderDate.getFullYear() === today.getFullYear()
          );

        default:
          return true;
      }
    });
  }

  private normalize(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private parseDate(date: string): number {
    const [day, month, year] = date.split(/[/-]/).map(Number);
    return new Date(year, month - 1, day).getTime();
  }
}
