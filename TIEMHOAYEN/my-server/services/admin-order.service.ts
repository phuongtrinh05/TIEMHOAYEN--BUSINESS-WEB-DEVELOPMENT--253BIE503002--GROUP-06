import { getCollection } from '../mongo.js';

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

  if (key.includes('that bai') || key.includes('failed') || key.includes('fail') || (key.includes('thanh to') && key.includes('bai'))) {
    return 'Thanh toán thất bại';
  }

  if (key.includes('thanh cong') || key.includes('da thanh toan') || key.includes('success')) {
    return 'Đã thanh toán';
  }

  if (key.includes('coc')) return 'Đã cọc';
  if (key.includes('dang') || key.includes('pending')) return 'Chờ thanh toán';
  if (key.includes('chua') || key.includes('cho')) return 'Chờ thanh toán';
  if (paid > 0 && totalAmount > 0 && paid >= totalAmount) return 'Đã thanh toán';
  if (paid > 0) return 'Đã cọc';

  return 'Chờ thanh toán';
};

const normalizeLatestPaymentStatus = (
  status: unknown,
  deposit: unknown,
  total: unknown = 0,
  paidAmount: unknown = 0,
): string => {
  const key = textKey(status);
  if (key) return normalizePaymentStatus(status, 0, 0, 0);
  return normalizePaymentStatus('', deposit, total, paidAmount);
};

const boolFromSql = (value: unknown): boolean => value === true || value === 1 || value === '1';

const getPrimaryImages = async (productIds: string[]) => {
  const imageCollection = await getCollection<any>('HINH_ANH_SAN_PHAM');
  const images = await imageCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray();
  const imageMap = new Map<string, any>();

  for (const image of images.sort((left, right) => {
    if (Boolean(left.LA_ANH_CHINH) !== Boolean(right.LA_ANH_CHINH)) {
      return Boolean(left.LA_ANH_CHINH) ? -1 : 1;
    }
    return String(left.HINH_ANH_ID || '').localeCompare(String(right.HINH_ANH_ID || ''), 'vi');
  })) {
    if (!imageMap.has(image.SAN_PHAM_ID)) {
      imageMap.set(image.SAN_PHAM_ID, image);
    }
  }

  return imageMap;
};

export const getAdminOrderDetailById = async (orderId: string): Promise<AdminOrderDetailDto | null> => {
  const [
    orderCollection,
    customerCollection,
    paymentCollection,
    itemCollection,
    productCollection,
    reviewCollection,
  ] = await Promise.all([
    getCollection<any>('DON_HANG'),
    getCollection<any>('KHACH_HANG'),
    getCollection<any>('THANH_TOAN'),
    getCollection<any>('DON_HANG_CHI_TIET'),
    getCollection<any>('SAN_PHAM'),
    getCollection<any>('DANH_GIA'),
  ]);
  const order = await orderCollection.findOne({ DON_HANG_ID: orderId });
  if (!order) return null;

  const [customer, payments, items, review] = await Promise.all([
    order.KHACH_HANG_ID ? customerCollection.findOne({ KHACH_HANG_ID: order.KHACH_HANG_ID }) : null,
    paymentCollection.find({ DON_HANG_ID: orderId }).toArray(),
    itemCollection.find({ DON_HANG_ID: orderId }).sort({ SAN_PHAM_ID: 1 }).toArray(),
    reviewCollection.findOne({ DON_HANG_ID: orderId }, { sort: { NGAY_DANH_GIA: -1, DANH_GIA_ID: -1 } }),
  ]);
  const productIds = items.map((item) => item.SAN_PHAM_ID).filter(Boolean);
  const [productsRaw, imageMap] = await Promise.all([
    productCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
    getPrimaryImages(productIds),
  ]);
  const productMap = new Map(productsRaw.map((product) => [product.SAN_PHAM_ID, product]));
  const products = items.map((item) => {
    const product = productMap.get(item.SAN_PHAM_ID);
    const image = imageMap.get(item.SAN_PHAM_ID);
    return {
      id: item.SAN_PHAM_ID || '',
      name: product?.TEN_SAN_PHAM || item.SAN_PHAM_ID || 'Sản phẩm',
      image: image?.URL || 'assets/images/logo-main.png',
      qty: Number(item.SO_LUONG || 0),
      price: Number(item.GIA || 0),
    };
  });

  const latestPayment = payments.sort((left, right) => {
    const dateDiff = new Date(right.NGAY_THANH_TOAN || 0).getTime() - new Date(left.NGAY_THANH_TOAN || 0).getTime();
    if (dateDiff !== 0) return dateDiff;
    return String(right.THANH_TOAN_ID || '').localeCompare(String(left.THANH_TOAN_ID || ''), 'vi');
  })[0] || null;
  const paidAmount = payments.reduce((sum, payment) => sum + Number(payment.SO_TIEN || 0), 0);
  const reviewTime = review?.NGAY_DANH_GIA
    ? `${formatDate(review.NGAY_DANH_GIA)} ${formatTime(review.NGAY_DANH_GIA)}`.trim()
    : '';
  const adminReplyTime = review?.NGAY_PHAN_HOI_SHOP
    ? `${formatDate(review.NGAY_PHAN_HOI_SHOP)} ${formatTime(review.NGAY_PHAN_HOI_SHOP)}`.trim()
    : '';
  const noteParts = String(order.GHI_CHU || '')
    .split(' | ')
    .map((part) => part.trim())
    .filter(Boolean);
  const customerNote = noteParts[0] || '';
  const adminNote = noteParts.length > 1 ? noteParts.slice(1).join(' | ') : '';
  const adminNoteTime = adminNote
    ? `Ghi chú bởi Admin | ${formatDate(order.NGAY_TAO)} ${formatTime(order.NGAY_TAO)}`.trim()
    : '';
  const total = Number(order.TONG_TIEN || 0);
  const deposit = Number(order.TIEN_COC || 0);
  const normalizedPaidAmount = Math.max(paidAmount, deposit);
  const paymentStatus = normalizeLatestPaymentStatus(latestPayment?.TRANG_THAI_THANH_TOAN, deposit, total, normalizedPaidAmount || latestPayment?.SO_TIEN);
  const paid = paymentStatus === 'Đã thanh toán'
    ? total
    : paymentStatus === 'Đã cọc'
      ? Math.min(normalizedPaidAmount, total || normalizedPaidAmount)
      : 0;

  return {
    id: order.DON_HANG_ID,
    orderStatus: normalizeOrderStatus(order.TRANG_THAI),
    paymentStatus,
    createdAt: formatDate(order.NGAY_TAO),
    createdTime: formatTime(order.NGAY_TAO),
    estimatedDelivery: order.KHUNG_GIO_MUON_GIAO || '',
    senderName: customer?.TEN || 'Khách lẻ',
    senderCustomerId: order.KHACH_HANG_ID || '',
    senderPhone: customer?.SDT || '',
    senderEmail: customer?.EMAIL || '',
    senderAvatar: customer?.AVATAR || '',
    receiverName: order.TEN_NGUOI_NHAN || '',
    receiverPhone: order.SDT_NGUOI_NHAN || '',
    receiverEmail: '',
    deliveryDate: formatDate(order.NGAY_MUON_GIAO),
    deliverySlot: order.KHUNG_GIO_MUON_GIAO || '',
    deliveryAddress: order.DIA_CHI_GIAO_HANG || '',
    shipperName: '',
    shipperPhone: '',
    shipperAvatar: 'assets/images/logo-main.png',
    products,
    customerNote,
    cardTemplate: order.LOI_NHAN_THIEP ? 'Thiệp' : 'Không có thiệp',
    cardMessage: order.LOI_NHAN_THIEP || '',
    subtotal: Number(order.TAM_TINH || 0),
    shippingFee: Number(order.PHI_VAN_CHUYEN || 0),
    voucher: null,
    voucherDiscount: 0,
    loyaltyPoints: Number(order.DIEM_THUONG_SU_DUNG || 0),
    loyaltyDiscount: 0,
    tax: Number(order.VAT || 0),
    total,
    paid,
    remaining: Math.max(total - paid, 0),
    paymentMethod: latestPayment?.CONG_THANH_TOAN || order.PHUONG_THUC_THANH_TOAN || '',
    adminNote,
    adminNoteTime,
    reviewId: review?.DANH_GIA_ID || '',
    rating: Number(review?.SO_SAO || 0),
    reviewText: review?.NOI_DUNG || '',
    reviewTime,
    adminReplyText: review?.PHAN_HOI_SHOP || '',
    adminReplyTime,
    refundReason: order.LY_DO_HOAN_TIEN_TRA_HANG || '',
    adminRejectReason: order.LY_DO_TU_CHOI || '',
    raw: {
      hiddenInfo: boolFromSql(order.AN_THONG_TIN),
      requireVat: boolFromSql(order.YEU_CAU_VAT),
      sendGiftImageToZalo: boolFromSql(order.GUI_ANH_QUA_ZALO),
      deliveryEdited: boolFromSql(order.DA_CHINH_SUA_GIAO_HANG),
    },
  };
};
