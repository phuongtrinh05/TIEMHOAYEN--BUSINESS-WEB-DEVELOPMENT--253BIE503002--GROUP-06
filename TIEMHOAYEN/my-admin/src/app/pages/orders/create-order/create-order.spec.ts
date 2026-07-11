import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { CreateOrder } from './create-order';

describe('CreateOrder', () => {
  let component: CreateOrder;
  let fixture: ComponentFixture<CreateOrder>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateOrder, CommonModule, FormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateOrder);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ===== KHỞI TẠO =====
  describe('Khởi tạo component', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('form khởi tạo với giá trị rỗng', () => {
      expect(component.form.senderName).toBe('');
      expect(component.form.senderPhone).toBe('');
      expect(component.form.receiverName).toBe('');
      expect(component.form.deliveryDate).toBe('');
      expect(component.form.deliverySlot).toBe('');
      expect(component.form.deliveryAddress).toBe('');
      expect(component.form.products).toEqual([]);
    });

    it('cardTemplate mặc định là "Không có thiệp"', () => {
      expect(component.form.cardTemplate).toBe('Không có thiệp');
    });

    it('paymentMethod mặc định là "Chuyển khoản full"', () => {
      expect(component.form.paymentMethod).toBe('Chuyển khoản full');
    });

    it('orderStatus mặc định là "Chờ xử lý"', () => {
      expect(component.form.orderStatus).toBe('Chờ xử lý');
    });

    it('selectedShipper mặc định là shipper đầu tiên', () => {
      expect(component.selectedShipper).toEqual(component.shippers[0]);
    });
  });

  // ===== COMPUTED =====
  describe('Computed getters', () => {
    it('totalQty = 0 khi chưa có sản phẩm', () => {
      expect(component.totalQty).toBe(0);
    });

    it('computedSubtotal = 0 khi chưa có sản phẩm', () => {
      expect(component.computedSubtotal).toBe(0);
    });

    it('totalQty cộng đúng qty nhiều sản phẩm', () => {
      component.form.products = [
        { id: 'P1', name: 'A', image: '', qty: 2, price: 100000 },
        { id: 'P2', name: 'B', image: '', qty: 3, price: 50000 },
      ];
      expect(component.totalQty).toBe(5);
    });

    it('computedSubtotal tính đúng tổng tiền sản phẩm', () => {
      component.form.products = [
        { id: 'P1', name: 'A', image: '', qty: 2, price: 100000 },
        { id: 'P2', name: 'B', image: '', qty: 1, price: 50000 },
      ];
      expect(component.computedSubtotal).toBe(250000);
    });

    it('computedGrandTotal = subtotal + shippingFee + tax khi không có voucher/loyalty', () => {
      component.form.products = [
        { id: 'P1', name: 'A', image: '', qty: 1, price: 200000 },
      ];
      component.form.voucher = null;
      component.useLoyalty = false;
      const expected = 200000 + component.shippingFee + component.tax;
      expect(component.computedGrandTotal).toBe(expected);
    });

    it('computedGrandTotal trừ voucher khi có voucher', () => {
      component.form.products = [
        { id: 'P1', name: 'A', image: '', qty: 1, price: 200000 },
      ];
      component.form.voucher = 'YEN10';
      component.voucherDiscount = 40000;
      component.useLoyalty = false;
      const expected = 200000 + component.shippingFee - 40000 + component.tax;
      expect(component.computedGrandTotal).toBe(expected);
    });

    it('computedGrandTotal trừ điểm loyalty khi useLoyalty = true', () => {
      component.form.products = [
        { id: 'P1', name: 'A', image: '', qty: 1, price: 200000 },
      ];
      component.form.voucher = null;
      component.useLoyalty = true;
      component.loyaltyDiscount = 70000;
      const expected = 200000 + component.shippingFee - 70000 + component.tax;
      expect(component.computedGrandTotal).toBe(expected);
    });

    it('computedRemaining = grandTotal khi paidInput rỗng', () => {
      component.form.products = [
        { id: 'P1', name: 'A', image: '', qty: 1, price: 100000 },
      ];
      component.paidInput = '';
      component.form.voucher = null;
      component.useLoyalty = false;
      expect(component.computedRemaining).toBe(component.computedGrandTotal);
    });

    it('computedRemaining = 0 khi paidInput >= grandTotal', () => {
      component.form.products = [
        { id: 'P1', name: 'A', image: '', qty: 1, price: 100000 },
      ];
      component.paidInput = '99999999';
      component.form.voucher = null;
      component.useLoyalty = false;
      expect(component.computedRemaining).toBe(0);
    });
  });

  // ===== LINE TOTAL =====
  describe('lineTotal()', () => {
    it('trả về đúng qty * price', () => {
      const p = { id: 'P1', name: 'A', image: '', qty: 3, price: 50000 };
      expect(component.lineTotal(p)).toBe(150000);
    });
  });

  // ===== PRODUCT =====
  describe('Quản lý sản phẩm', () => {
    const mockProduct = { id: 'PRD000001', name: 'Hoa hồng 99', image: 'assets/images/product-list-chungthuy.png', qty: 1, price: 230000 };

    it('addProduct thêm sản phẩm mới vào danh sách', () => {
      component.addProduct(mockProduct);
      expect(component.form.products.length).toBe(1);
      expect(component.form.products[0].id).toBe('PRD000001');
    });

    it('addProduct tăng qty nếu sản phẩm đã có trong danh sách', () => {
      component.addProduct(mockProduct);
      component.addProduct(mockProduct);
      expect(component.form.products.length).toBe(1);
      expect(component.form.products[0].qty).toBe(2);
    });

    it('addProduct reset productSearchQuery và đóng dropdown', () => {
      component.productSearchQuery = 'hoa';
      component.showProductSearch = true;
      component.addProduct(mockProduct);
      expect(component.productSearchQuery).toBe('');
      expect(component.showProductSearch).toBe(false);
    });

    it('removeProduct xóa đúng sản phẩm theo index', () => {
      component.form.products = [
        { ...mockProduct },
        { id: 'PRD000002', name: 'Thiệp', image: '', qty: 1, price: 10000 },
      ];
      component.removeProduct(0);
      expect(component.form.products.length).toBe(1);
      expect(component.form.products[0].id).toBe('PRD000002');
    });

    it('updateQty tăng qty đúng', () => {
      component.form.products = [{ ...mockProduct, qty: 1 }];
      component.updateQty(0, 1);
      expect(component.form.products[0].qty).toBe(2);
    });

    it('updateQty giảm qty đúng', () => {
      component.form.products = [{ ...mockProduct, qty: 3 }];
      component.updateQty(0, -1);
      expect(component.form.products[0].qty).toBe(2);
    });

    it('updateQty không cho qty xuống dưới 1', () => {
      component.form.products = [{ ...mockProduct, qty: 1 }];
      component.updateQty(0, -1);
      expect(component.form.products[0].qty).toBe(1);
    });
  });

  // ===== PRODUCT SEARCH =====
  describe('onProductSearch()', () => {
    it('trả về rỗng nếu query rỗng', () => {
      component.productSearchQuery = '';
      component.onProductSearch();
      expect(component.productSearchResults).toEqual([]);
      expect(component.showProductSearch).toBeFalse();
    });

    it('tìm theo tên sản phẩm (case-insensitive)', () => {
      component.productSearchQuery = 'hoa hồng';
      component.onProductSearch();
      expect(component.productSearchResults.length).toBeGreaterThan(0);
      expect(component.productSearchResults[0].name.toLowerCase()).toContain('hoa hồng');
    });

    it('tìm theo mã sản phẩm', () => {
      component.productSearchQuery = 'PRD000001';
      component.onProductSearch();
      expect(component.productSearchResults.some(p => p.id === 'PRD000001')).toBeTrue();
    });

    it('trả về rỗng nếu không tìm thấy', () => {
      component.productSearchQuery = 'xyzxyzxyz123';
      component.onProductSearch();
      expect(component.productSearchResults).toEqual([]);
    });
  });

  // ===== CUSTOMER SEARCH =====
  describe('onCustomerSearch()', () => {
    it('ẩn dropdown nếu query rỗng', () => {
      component.customerSearchQuery = '';
      component.onCustomerSearch();
      expect(component.showCustomerSearch).toBeFalse();
    });

    it('tìm theo tên khách hàng', () => {
      component.customerSearchQuery = 'Anh Thoa';
      component.onCustomerSearch();
      expect(component.customerSearchResults.length).toBeGreaterThan(0);
    });

    it('tìm theo số điện thoại', () => {
      component.customerSearchQuery = '0795583254';
      component.onCustomerSearch();
      expect(component.customerSearchResults[0].phone).toBe('0795583254');
    });

    it('tìm theo mã khách hàng', () => {
      component.customerSearchQuery = 'CUST001';
      component.onCustomerSearch();
      expect(component.customerSearchResults.length).toBeGreaterThan(0);
    });
  });

  describe('selectCustomer()', () => {
    it('điền đúng thông tin vào form khi chọn KH', () => {
      component.customerSearchQuery = 'Anh Thoa';
      component.onCustomerSearch();
      const customer = component.customerSearchResults[0];
      component.selectCustomer(customer);
      expect(component.form.senderName).toBe(customer.name);
      expect(component.form.senderPhone).toBe(customer.phone);
      expect(component.form.senderEmail).toBe(customer.email);
      expect(component.form.senderCustomerId).toBe(customer.id);
    });

    it('cập nhật selectedCustomerLoyalty và loyaltyDiscount từ KH', () => {
      component.customerSearchQuery = 'Anh Thoa';
      component.onCustomerSearch();
      const customer = component.customerSearchResults[0];
      component.selectCustomer(customer);
      expect(component.selectedCustomerLoyalty).toBe(customer.loyaltyPoints);
      expect(component.loyaltyDiscount).toBe(customer.loyaltyDiscount);
    });

    it('reset useLoyalty về false khi đổi KH', () => {
      component.useLoyalty = true;
      component.customerSearchQuery = 'Anh Thoa';
      component.onCustomerSearch();
      component.selectCustomer(component.customerSearchResults[0]);
      expect(component.useLoyalty).toBeFalse();
    });

    it('đóng dropdown sau khi chọn', () => {
      component.showCustomerSearch = true;
      component.customerSearchQuery = 'Anh Thoa';
      component.onCustomerSearch();
      component.selectCustomer(component.customerSearchResults[0]);
      expect(component.showCustomerSearch).toBeFalse();
    });
  });

  // ===== VOUCHER =====
  describe('applyVoucher()', () => {
    it('áp dụng voucher hợp lệ YEN10', () => {
      component.voucherInput = 'YEN10';
      component.applyVoucher();
      expect(component.form.voucher).toBe('YEN10');
      expect(component.voucherDiscount).toBe(40000);
      expect(component.voucherError).toBe('');
    });

    it('áp dụng voucher hợp lệ SALE50', () => {
      component.voucherInput = 'SALE50';
      component.applyVoucher();
      expect(component.form.voucher).toBe('SALE50');
      expect(component.voucherDiscount).toBe(50000);
    });

    it('không phân biệt hoa thường khi nhập voucher', () => {
      component.voucherInput = 'yen10';
      component.applyVoucher();
      expect(component.form.voucher).toBe('YEN10');
    });

    it('set lỗi nếu voucher không hợp lệ', () => {
      component.voucherInput = 'INVALID';
      component.applyVoucher();
      expect(component.voucherError).toBeTruthy();
      expect(component.form.voucher).toBeNull();
    });

    it('xóa voucher nếu input rỗng', () => {
      component.form.voucher = 'YEN10';
      component.voucherDiscount = 40000;
      component.voucherInput = '';
      component.applyVoucher();
      expect(component.form.voucher).toBeNull();
      expect(component.voucherDiscount).toBe(0);
      expect(component.voucherError).toBe('');
    });
  });

  // ===== SHIPPER =====
  describe('Shipper', () => {
    it('toggleShipperDropdown mở/đóng dropdown', () => {
      expect(component.showShipperDropdown).toBeFalse();
      component.toggleShipperDropdown();
      expect(component.showShipperDropdown).toBeTrue();
      component.toggleShipperDropdown();
      expect(component.showShipperDropdown).toBeFalse();
    });

    it('selectShipper cập nhật selectedShipper và đóng dropdown', () => {
      component.showShipperDropdown = true;
      const shipper = component.shippers[1];
      component.selectShipper(shipper);
      expect(component.selectedShipper).toEqual(shipper);
      expect(component.showShipperDropdown).toBeFalse();
    });
  });

  // ===== STATUS DROPDOWN =====
  describe('Status dropdown', () => {
    it('toggleStatusDropdown mở/đóng', () => {
      expect(component.showStatusDropdown).toBeFalse();
      component.toggleStatusDropdown();
      expect(component.showStatusDropdown).toBeTrue();
    });

    it('selectStatus cập nhật orderStatus và đóng dropdown', () => {
      component.showStatusDropdown = true;
      component.selectStatus('Đang giao');
      expect(component.form.orderStatus).toBe('Đang giao');
      expect(component.showStatusDropdown).toBeFalse();
    });
  });

  // ===== POPUP KHÁCH HÀNG =====
  describe('Popup thêm khách hàng mới', () => {
    it('openAddCustomerPopup reset form và mở popup', () => {
      component.newCustomer = { name: 'test', phone: '123', email: 'x', address: 'y' };
      component.openAddCustomerPopup();
      expect(component.showAddCustomerPopup).toBeTrue();
      expect(component.newCustomer.name).toBe('');
      expect(component.newCustomer.phone).toBe('');
    });

    it('closeAddCustomerPopup đóng popup', () => {
      component.showAddCustomerPopup = true;
      component.closeAddCustomerPopup();
      expect(component.showAddCustomerPopup).toBeFalse();
    });

    it('confirmAddCustomer báo lỗi nếu thiếu tên', () => {
      component.newCustomer = { name: '', phone: '0901234567', email: '', address: '' };
      component.confirmAddCustomer();
      expect(component.newCustomerErrors['name']).toBeTruthy();
      expect(component.showAddCustomerPopup).toBeTrue();
    });

    it('confirmAddCustomer báo lỗi nếu thiếu số điện thoại', () => {
      component.newCustomer = { name: 'Test', phone: '', email: '', address: '' };
      component.confirmAddCustomer();
      expect(component.newCustomerErrors['phone']).toBeTruthy();
    });

    it('confirmAddCustomer điền thông tin vào form và đóng popup nếu hợp lệ', () => {
      component.newCustomer = { name: 'Nguyễn Văn A', phone: '0901234567', email: 'a@gmail.com', address: '' };
      component.confirmAddCustomer();
      expect(component.form.senderName).toBe('Nguyễn Văn A');
      expect(component.form.senderPhone).toBe('0901234567');
      expect(component.showAddCustomerPopup).toBeFalse();
    });
  });

  // ===== VALIDATE & SUBMIT =====
  describe('validate()', () => {
    it('trả về false và set errors nếu form rỗng', () => {
      const result = component.validate();
      expect(result).toBeFalse();
      expect(component.errors['senderName']).toBeTruthy();
      expect(component.errors['senderPhone']).toBeTruthy();
      expect(component.errors['receiverName']).toBeTruthy();
      expect(component.errors['receiverPhone']).toBeTruthy();
      expect(component.errors['deliveryDate']).toBeTruthy();
      expect(component.errors['deliverySlot']).toBeTruthy();
      expect(component.errors['deliveryAddress']).toBeTruthy();
    });

    it('trả về true khi điền đủ các trường bắt buộc', () => {
      component.form.senderName = 'Nguyễn Văn A';
      component.form.senderPhone = '0901234567';
      component.form.receiverName = 'Trần Thị B';
      component.form.receiverPhone = '0912345678';
      component.form.deliveryDate = '2026-07-01';
      component.form.deliverySlot = '09:00 AM–11:00 AM';
      component.form.deliveryAddress = '123 Nguyễn Huệ, Q1, HCM';
      const result = component.validate();
      expect(result).toBeTrue();
      expect(Object.keys(component.errors).length).toBe(0);
    });

    it('xóa errors cũ mỗi lần validate lại', () => {
      component.validate();
      expect(Object.keys(component.errors).length).toBeGreaterThan(0);
      component.form.senderName = 'A';
      component.form.senderPhone = '0901234567';
      component.form.receiverName = 'B';
      component.form.receiverPhone = '0912345678';
      component.form.deliveryDate = '2026-07-01';
      component.form.deliverySlot = '09:00 AM–11:00 AM';
      component.form.deliveryAddress = '123 test';
      component.validate();
      expect(Object.keys(component.errors).length).toBe(0);
    });
  });

  // ===== FORMAT =====
  describe('formatVND()', () => {
    it('format số sang chuỗi VND có dấu phân cách', () => {
      const result = component.formatVND(230000);
      expect(result).toContain('230');
      expect(result).toContain('đ');
    });

    it('format 0 đúng', () => {
      expect(component.formatVND(0)).toBe('0đ');
    });
  });
});
