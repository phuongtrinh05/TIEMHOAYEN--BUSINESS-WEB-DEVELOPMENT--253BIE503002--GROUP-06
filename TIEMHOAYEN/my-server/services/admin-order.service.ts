import { sql } from '../db.js';

export interface AdminOrderProductDto {
  id: string;
  name: string;
  image: string;
  qty: number;
  price: number;
}

export interface AdminOrderDetailDto {
  id: string;
  orderStatus: string;
  paymentStatus: string;
  createdAt: string;
  createdTime: string;
  estimatedDelivery: string;
  senderName: string;
  senderCustomerId: string;
  senderPhone: string;
  senderEmail: string;
  senderAvatar: string;
  receiverName: string;
  receiverPhone: string;
  receiverEmail: string;
  deliveryDate: string;
  deliverySlot: string;
  deliveryAddress: string;
  shipperName: string;
  shipperPhone: string;
  shipperAvatar: string;
  products: AdminOrderProductDto[];
  customerNote: string;
  cardTemplate: string;
  cardMessage: string;
  subtotal: number;
  shippingFee: number;
  voucher: string | null;
  voucherDiscount: number;
  loyaltyPoints: number;
  loyaltyDiscount: number;
  tax: number;
  total: number;
  paid: number;
  remaining: number;
  paymentMethod: string;
  adminNote: string;
  adminNoteTime: string;
  reviewId: string;
  rating: number;
  reviewText: string;
  reviewTime: string;
  adminReplyText: string;
  adminReplyTime: string;
  refundReason: string;
  adminRejectReason: string;
  raw: {
    hiddenInfo: boolean;
    requireVat: boolean;
    sendGiftImageToZalo: boolean;
    deliveryEdited: boolean;
  };
}

const formatDate = (value: Date | string | null | undefined): string => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const formatTime = (value: Date | string | null | undefined): string => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
};

const repairMojibakeText = (value: unknown): string => {
  const raw = String(value || '');
  if (!/[\u00c2\u00c3\u00c4\u00c6\u00e1]/.test(raw)) return raw;

  try {
    const repaired = Buffer.from(raw, 'latin1').toString('utf8');
    return repaired.includes('�') ? raw : repaired;
  } catch {
    return raw;
  }
};

const textKey = (value: unknown): string => repairMojibakeText(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .replace(/[�\?]/g, '')
  .toLowerCase();

const normalizeOrderStatus = (status: unknown): string => {
  const raw = repairMojibakeText(status).trim();
  const key = textKey(raw);

  if (!raw) return 'Chờ xử lý';
  if (key.includes('van chuyen')) return 'Chờ vận chuyển';
  if (/\bhuy\b/.test(key) || key.includes('da huy')) return 'Đã hủy';
  if (key.includes('hoan thanh')) return 'Hoàn thành';
  if (key.includes('da giao')) return 'Đã giao';
  if (key.includes('dang giao')) return 'Đang giao';
  if (key.includes('chuan bi')) return 'Đang chuẩn bị hàng';
  if (key.includes('thanh to') || key.includes('cho thanh to') || key.includes('ch thanh to')) return 'Chờ thanh toán';

  return raw;
};

const normalizePaymentStatus = (status: unknown, deposit: unknown, total: unknown, paidAmount: unknown = 0): string => {
  const raw = repairMojibakeText(status).trim();
  const key = textKey(raw);
  const depositAmount = Number(deposit || 0);
  const totalAmount = Number(total || 0);
  const paid = Math.max(Number(paidAmount || 0), depositAmount);

  if (key.includes('that bai') || key.includes('thanh ton tht b') || key.includes('thanh toan tht b') || key.includes('thanh ton that b') || key.includes('failed') || key.includes('fail') || (key.includes('thanh to') && key.includes('bai'))) {
    return 'Thanh toán thất bại';
  }

  if (key.includes('thanh cong') || key.includes('da thanh toan') || key.includes('da thanh ton') || key.includes('success')) {
    return 'Đã thanh toán';
  }

  if (key.includes('coc')) {
    return 'Đã cọc';
  }

  if (key.includes('dang') || key.includes('ang thanh ton') || key.includes('ang thanh to') || key.includes('pending')) {
    return 'Chờ thanh toán';
  }

  if (key.includes('chua') || key.includes('cho') || key.includes('ch thanh ton') || key.includes('ch thanh to')) {
    return 'Chờ thanh toán';
  }

  if (paid > 0 && totalAmount > 0 && paid >= totalAmount) {
    return 'Đã thanh toán';
  }

  if (paid > 0) {
    return 'Đã cọc';
  }

  return 'Chờ thanh toán';
};

const normalizeLatestPaymentStatus = (
  status: unknown,
  deposit: unknown,
  total: unknown = 0,
  paidAmount: unknown = 0,
): string => {
  const key = textKey(status);
  if (key) {
    return normalizePaymentStatus(status, 0, 0, 0);
  }

  return normalizePaymentStatus('', deposit, total, paidAmount);
};

const boolFromSql = (value: unknown): boolean => Boolean(Number(value || 0));

export const getAdminOrderDetailById = async (orderId: string): Promise<AdminOrderDetailDto | null> => {
  const orderRequest = new sql.Request();
  orderRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);

  const itemRequest = new sql.Request();
  itemRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);

  const reviewRequest = new sql.Request();
  reviewRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);

  const [orderResult, itemResult, reviewResult] = await Promise.all([
    orderRequest.query(`
      SELECT TOP 1
        dh.DON_HANG_ID,
        dh.KHACH_HANG_ID,
        dh.NGAY_TAO,
        dh.TRANG_THAI,
        dh.TAM_TINH,
        dh.PHI_VAN_CHUYEN,
        dh.TIEN_COC,
        dh.TONG_TIEN,
        dh.PHUONG_THUC_THANH_TOAN,
        dh.VAT,
        dh.NGAY_MUON_GIAO,
        dh.KHUNG_GIO_MUON_GIAO,
        dh.LOI_NHAN_THIEP,
        dh.AN_THONG_TIN,
        dh.GHI_CHU,
        dh.LY_DO_HOAN_TIEN_TRA_HANG,
        dh.LY_DO_TU_CHOI,
        dh.TEN_NGUOI_NHAN,
        dh.SDT_NGUOI_NHAN,
        dh.DIA_CHI_GIAO_HANG,
        dh.YEU_CAU_VAT,
        dh.GUI_ANH_QUA_ZALO,
        dh.DA_CHINH_SUA_GIAO_HANG,
        kh.TEN AS TEN_KHACH_HANG,
        kh.EMAIL AS EMAIL_KHACH_HANG,
        kh.SDT AS SDT_KHACH_HANG,
        kh.AVATAR AS AVATAR_KHACH_HANG,
        tt.TRANG_THAI_THANH_TOAN,
        tt.SO_TIEN,
        tt.CONG_THANH_TOAN,
        tt.NGAY_THANH_TOAN,
        paid.PAID_AMOUNT
      FROM DON_HANG dh
      LEFT JOIN KHACH_HANG kh ON kh.KHACH_HANG_ID = dh.KHACH_HANG_ID
      OUTER APPLY (
        SELECT TOP 1
          t.TRANG_THAI_THANH_TOAN,
          t.SO_TIEN,
          t.CONG_THANH_TOAN,
          t.NGAY_THANH_TOAN,
          t.THANH_TOAN_ID
        FROM THANH_TOAN t
        WHERE t.DON_HANG_ID = dh.DON_HANG_ID
        ORDER BY t.NGAY_THANH_TOAN DESC, t.THANH_TOAN_ID DESC
      ) tt
      OUTER APPLY (
        SELECT
          SUM(ISNULL(t.SO_TIEN, 0)) AS PAID_AMOUNT
        FROM THANH_TOAN t
        WHERE t.DON_HANG_ID = dh.DON_HANG_ID
      ) paid
      WHERE dh.DON_HANG_ID = @DON_HANG_ID;
    `),
    itemRequest.query(`
      SELECT
        ct.SAN_PHAM_ID,
        ct.SO_LUONG,
        ct.GIA,
        sp.TEN_SAN_PHAM,
        img.URL AS HINH_ANH
      FROM DON_HANG_CHI_TIET ct
      LEFT JOIN SAN_PHAM sp ON sp.SAN_PHAM_ID = ct.SAN_PHAM_ID
      OUTER APPLY (
        SELECT TOP 1 ha.URL
        FROM HINH_ANH_SAN_PHAM ha
        WHERE ha.SAN_PHAM_ID = ct.SAN_PHAM_ID
        ORDER BY ha.LA_ANH_CHINH DESC, ha.HINH_ANH_ID ASC
      ) img
      WHERE ct.DON_HANG_ID = @DON_HANG_ID
      ORDER BY ct.SAN_PHAM_ID ASC;
    `),
    reviewRequest.query(`
      SELECT TOP 1
        dg.DANH_GIA_ID,
        dg.SO_SAO,
        dg.NOI_DUNG,
        dg.NGAY_DANH_GIA,
        dg.PHAN_HOI_SHOP,
        dg.NGAY_PHAN_HOI_SHOP
      FROM DANH_GIA dg
      WHERE dg.DON_HANG_ID = @DON_HANG_ID
      ORDER BY dg.NGAY_DANH_GIA DESC, dg.DANH_GIA_ID DESC;
    `),
  ]);

  const row = orderResult.recordset[0];
  if (!row) return null;

  const products = itemResult.recordset.map((item: any) => ({
    id: item.SAN_PHAM_ID || '',
    name: item.TEN_SAN_PHAM || item.SAN_PHAM_ID || 'Sản phẩm',
    image: item.HINH_ANH || 'assets/images/logo-main.png',
    qty: Number(item.SO_LUONG || 0),
    price: Number(item.GIA || 0),
  }));

  const review = reviewResult.recordset[0] || null;
  const reviewTime = review?.NGAY_DANH_GIA
    ? `${formatDate(review.NGAY_DANH_GIA)} ${formatTime(review.NGAY_DANH_GIA)}`.trim()
    : '';
  const adminReplyTime = review?.NGAY_PHAN_HOI_SHOP
    ? `${formatDate(review.NGAY_PHAN_HOI_SHOP)} ${formatTime(review.NGAY_PHAN_HOI_SHOP)}`.trim()
    : '';

  const noteParts = String(row.GHI_CHU || '')
    .split(' | ')
    .map((part) => part.trim())
    .filter(Boolean);
  const customerNote = noteParts[0] || '';
  const adminNote = noteParts.length > 1 ? noteParts.slice(1).join(' | ') : '';
  const adminNoteTime = adminNote
    ? `Ghi ch? b?i Admin | ${formatDate(row.NGAY_TAO)} ${formatTime(row.NGAY_TAO)}`.trim()
    : '';

  const total = Number(row.TONG_TIEN || 0);
  const deposit = Number(row.TIEN_COC || 0);
  const paidAmount = Math.max(Number(row.PAID_AMOUNT || 0), deposit);
  const paymentStatus = normalizeLatestPaymentStatus(row.TRANG_THAI_THANH_TOAN, deposit, total, paidAmount || row.SO_TIEN);
  const paid = paymentStatus === 'Đã thanh toán'
    ? total
    : paymentStatus === 'Đã cọc'
      ? Math.min(paidAmount, total || paidAmount)
      : 0;

  return {
    id: row.DON_HANG_ID,
    orderStatus: normalizeOrderStatus(row.TRANG_THAI),
    paymentStatus,
    createdAt: formatDate(row.NGAY_TAO),
    createdTime: formatTime(row.NGAY_TAO),
    estimatedDelivery: row.KHUNG_GIO_MUON_GIAO || '',
    senderName: row.TEN_KHACH_HANG || 'Khách lẻ',
    senderCustomerId: row.KHACH_HANG_ID || '',
    senderPhone: row.SDT_KHACH_HANG || '',
    senderEmail: row.EMAIL_KHACH_HANG || '',
    senderAvatar: row.AVATAR_KHACH_HANG || '',
    receiverName: row.TEN_NGUOI_NHAN || '',
    receiverPhone: row.SDT_NGUOI_NHAN || '',
    receiverEmail: '',
    deliveryDate: formatDate(row.NGAY_MUON_GIAO),
    deliverySlot: row.KHUNG_GIO_MUON_GIAO || '',
    deliveryAddress: row.DIA_CHI_GIAO_HANG || '',
    shipperName: '',
    shipperPhone: '',
    shipperAvatar: 'assets/images/logo-main.png',
    products,
    customerNote,
    cardTemplate: row.LOI_NHAN_THIEP ? 'Thiệp' : 'Không có thiệp',
    cardMessage: row.LOI_NHAN_THIEP || '',
    subtotal: Number(row.TAM_TINH || 0),
    shippingFee: Number(row.PHI_VAN_CHUYEN || 0),
    voucher: null,
    voucherDiscount: 0,
    loyaltyPoints: 0,
    loyaltyDiscount: 0,
    tax: Number(row.VAT || 0),
    total,
    paid,
    remaining: Math.max(total - paid, 0),
    paymentMethod: row.CONG_THANH_TOAN || row.PHUONG_THUC_THANH_TOAN || '',
    adminNote,
    adminNoteTime,
    reviewId: review?.DANH_GIA_ID || '',
    rating: Number(review?.SO_SAO || 0),
    reviewText: review?.NOI_DUNG || '',
    reviewTime,
    adminReplyText: review?.PHAN_HOI_SHOP || '',
    adminReplyTime,
    refundReason: row.LY_DO_HOAN_TIEN_TRA_HANG || '',
    adminRejectReason: row.LY_DO_TU_CHOI || '',
    raw: {
      hiddenInfo: boolFromSql(row.AN_THONG_TIN),
      requireVat: boolFromSql(row.YEU_CAU_VAT),
      sendGiftImageToZalo: boolFromSql(row.GUI_ANH_QUA_ZALO),
      deliveryEdited: boolFromSql(row.DA_CHINH_SUA_GIAO_HANG),
    },
  };
};
