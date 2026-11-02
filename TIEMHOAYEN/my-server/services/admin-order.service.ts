import { getCollection } from '../mongo.js';
import type { ClientSession } from 'mongodb';
import { InventoryError } from './inventory/helpers.js';

const statusKey = (v: unknown) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').trim().toLowerCase();
export const paymentSucceeded = (v: unknown) => ['thanh cong', 'thanh toan thanh cong', 'da thanh toan', 'da coc', 'success', 'paid'].includes(statusKey(v));

/** Only verified receipts count. The required deposit is never evidence of receipt. */
export function sumVerifiedPayments(payments: any[]): number {
  const seen = new Set<string>();
  return payments.reduce((sum, p) => {
    if (!paymentSucceeded(p.TRANG_THAI_THANH_TOAN)) return sum;
    const key = String(p.MA_GIAO_DICH || p.THANH_TOAN_ID || p._id || '');
    if (!key || seen.has(key)) return sum;
    seen.add(key);
    const value = Number(p.SO_TIEN);
    return sum + (Number.isSafeInteger(value) && value > 0 ? (p.LOAI_GIAO_DICH === 'HOAN_TIEN' ? -value : value) : 0);
  }, 0);
}

export function assertOrderTransition(order: any, next: string, paid: number) {
  const current = String(order.TRANG_THAI || '');
  if (current === next) return;
  const allowed: Record<string, string[]> = {
    'Chờ thanh toán': ['Đã hủy'], 'Thanh toán thất bại': ['Đã hủy'],
    'Chờ xử lý': ['Đang chuẩn bị', 'Đang chuẩn bị hàng', 'Đã hủy'],
    'Đang chuẩn bị': ['Chờ vận chuyển'], 'Đang chuẩn bị hàng': ['Chờ vận chuyển'],
    'Chờ vận chuyển': ['Đang giao'], 'Đang giao': ['Đã giao', 'Giao hàng thành công', 'Giao không thành công'],
    'Đã giao': ['Hoàn thành'], 'Giao hàng thành công': ['Hoàn thành'],
    'Giao không thành công': ['Chờ vận chuyển'],
    'Yêu cầu hoàn tiền/trả hàng': ['Từ chối hoàn tiền/trả hàng'],
  };
  if (!allowed[current]?.includes(next)) throw new InventoryError(409, 'Không được bỏ qua bước hoặc đổi trạng thái theo luồng này. Hậu mãi cần hồ sơ xử lý riêng.');
  if (next === 'Từ chối hoàn tiền/trả hàng') return;
  if (next === 'Đã hủy') {
    if (order.THOI_DIEM_BAT_DAU_CHUAN_BI && new Date(order.THOI_DIEM_BAT_DAU_CHUAN_BI).getTime() <= Date.now()) throw new InventoryError(409, 'Đã bắt đầu chuẩn bị; cần xử lý hủy theo chính sách riêng.');
    return;
  }
  const due = /cod/i.test(String(order.PHUONG_THUC_THANH_TOAN)) ? Number(order.TIEN_COC || 0) : Number(order.TONG_TIEN || 0);
  if (paid < due) throw new InventoryError(409, 'Chưa xác minh đủ khoản thanh toán cần thiết.');
  if (/^Đang chuẩn bị/.test(next) && !order.THOI_DIEM_BAT_DAU_CHUAN_BI) throw new InventoryError(409, 'Nhân viên cần nhập thời điểm bắt đầu chuẩn bị T.');
  if (next === 'Hoàn thành' && paid < Number(order.TONG_TIEN || 0)) throw new InventoryError(409, 'Cần xác minh đủ số dư trước khi hoàn thành đơn.');
}

export function allowedOrderStatuses(order: any, paid: number): string[] {
  return ['Đang chuẩn bị hàng', 'Chờ vận chuyển', 'Đang giao', 'Đã giao', 'Hoàn thành', 'Giao không thành công', 'Đã hủy', 'Từ chối hoàn tiền/trả hàng'].filter(next => {
    if (next === order.TRANG_THAI) return false;
    try { assertOrderTransition(order, next, paid); return true; } catch { return false; }
  });
}

export function validateCheckoutDelivery(delivery: any) {
  const input = String(delivery?.date || '');
  const date = /^\d{2}\/\d{2}\/\d{4}$/.test(input) ? input.split('/').reverse().join('-') : input;
  const slot = String(delivery?.time || '').trim();
  const matches = [...slot.matchAll(/(\d{1,2}):([0-5]\d)\s*(AM|PM)?/gi)];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !matches.length || matches.length > 2 || slot.replace(/\d{1,2}:[0-5]\d\s*(?:AM|PM)?/gi, '').replace(/[\s–—-]/g, '')) throw new InventoryError(400, 'Cần ngày và giờ giao hợp lệ.');
  const values = matches.map(m => {
    let hour = Number(m[1]);
    if (m[3]) {
      if (hour < 1 || hour > 12) throw new InventoryError(400, 'Giờ giao không hợp lệ.');
      hour = hour % 12 + (m[3].toUpperCase() === 'PM' ? 12 : 0);
    }
    if (hour > 23) throw new InventoryError(400, 'Giờ giao không hợp lệ.');
    return `${String(hour).padStart(2, '0')}:${m[2]}`;
  });
  if (values.length === 2 && values[0] >= values[1]) throw new InventoryError(400, 'Khung giờ giao không hợp lệ.');
  const at = new Date(`${date}T${values[values.length - 1]}:00+07:00`);
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(at.getTime()) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date || at.getTime() <= Date.now()) throw new InventoryError(400, 'Ngày giao không tồn tại hoặc lịch giao đã qua.');
  return { ...delivery, date, time: slot, deliveryAt: at.toISOString() };
}

/** Mirrors the existing storefront tariff; no new deposit/cutoff policy is introduced. */
export async function priceCheckout(payload: any, session?: ClientSession, collections: typeof getCollection = getCollection) {
  const delivery = validateCheckoutDelivery(payload.delivery);
  if (String(delivery.message || '').length > 2000 || String(delivery.noteShop || '').length > 2000 || String(payload.adminNote || '').length > 2000) throw new InventoryError(400, 'Nội dung thiệp hoặc ghi chú tối đa 2.000 ký tự.');
  const customer = payload.customerId ? await (await collections<any>('KHACH_HANG')).findOne({ KHACH_HANG_ID: payload.customerId }, { session }) : null;
  if (payload.customerId && (!customer || customer.DA_XOA === true || customer.DA_XOA === 1)) throw new InventoryError(400, 'Không tìm thấy tài khoản khách hàng hợp lệ.');
  const items: any[] = [];
  const merged = new Map<string, number>();
  for (const item of payload.items || []) {
    const id = String(item.id || item.productId || item.SAN_PHAM_ID || '');
    const qty = Number(item.qty ?? item.quantity ?? item.SO_LUONG);
    if (!id || !Number.isSafeInteger(qty) || qty <= 0 || qty > 1000) throw new InventoryError(400, 'Sản phẩm hoặc số lượng không hợp lệ.');
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  if (!merged.size) throw new InventoryError(400, 'Đơn hàng chưa có sản phẩm.');
  for (const [id, qty] of merged) {
    if (qty > 1000) throw new InventoryError(400, 'Số lượng gộp vượt giới hạn.');
    const product = await (await collections<any>('SAN_PHAM')).findOne({ SAN_PHAM_ID: id }, { session });
    if (!product || /ngừng|ngưng|ẩn|khóa|đã xóa/i.test(String(product.TRANG_THAI || ''))) throw new InventoryError(400, `Sản phẩm ${id} không còn bán.`);
    const regular = Number(product.GIA), sale = Number(product.GIA_KHUYEN_MAI);
    const price = sale > 0 && sale < regular ? sale : regular;
    if (!Number.isSafeInteger(price) || price <= 0) throw new InventoryError(409, `Sản phẩm ${id} chưa có giá hợp lệ.`);
    const image = await (await collections<any>('HINH_ANH_SAN_PHAM')).find({ SAN_PHAM_ID: id }, { session }).sort({ LA_ANH_CHINH: -1, HINH_ANH_ID: 1 }).limit(1).next();
    items.push({ id, qty, price, name: product.TEN_SAN_PHAM, image: image?.URL || '' });
  }
  const subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0);
  if (!Number.isSafeInteger(subtotal)) throw new InventoryError(400, 'Giá trị đơn vượt giới hạn tính toán.');
  const address = statusKey(payload.receiver?.address);
  const district = statusKey(payload.receiver?.districtName);
  const inner = ['Quận 1','Quận 3','Quận 4','Quận 5','Quận 6','Quận 7','Quận 8','Quận 10','Quận 11','Quận Bình Thạnh','Quận Phú Nhuận','Quận Tân Bình','Quận Tân Phú','Quận Gò Vấp'].map(statusKey);
  const outer = ['Quận 2','Quận 9','Quận 12','Quận Bình Tân','Thành phố Thủ Đức','Huyện Bình Chánh','Huyện Cần Giờ','Huyện Củ Chi','Huyện Hóc Môn','Huyện Nhà Bè'].map(statusKey);
  const selected = [...inner, ...outer].find(d => address.split(',').some(part => part.trim() === d));
  if (!selected || district && district !== selected || !/ho chi minh|\bhcm\b/.test(address)) throw new InventoryError(400, 'Cần địa chỉ và quận/huyện thuộc Thành phố Hồ Chí Minh để tính phí giao.');
  const method = String(payload.shippingMethod || 'standard');
  if (!['standard', 'fast'].includes(method)) throw new InventoryError(400, 'Phương thức giao hàng không hợp lệ.');
  const fast = method === 'fast', isInner = inner.includes(selected);
  const baseShippingFee = isInner ? (fast ? subtotal < 300000 ? 60000 : subtotal <= 500000 ? 30000 : 0 : subtotal < 300000 ? 30000 : 0)
    : (fast ? subtotal < 300000 ? 80000 : subtotal <= 500000 ? 40000 : 30000 : subtotal < 300000 ? 40000 : subtotal <= 500000 ? 20000 : 0);
  let voucher: any = null, productDiscount = 0, shippingDiscount = 0;
  if (payload.voucher?.id || payload.voucher?.code) {
    const query = payload.voucher.id ? { VOUCHER_ID: String(payload.voucher.id) } : { MA_VOUCHER: String(payload.voucher.code).trim().toUpperCase() };
    voucher = await (await collections<any>('VOUCHER')).findOne(query, { session });
    const now = Date.now();
    if (!voucher || voucher.DA_DUNG === true || voucher.DA_DUNG === 1 || voucher.KHACH_HANG_ID && voucher.KHACH_HANG_ID !== payload.customerId
      || voucher.NGAY_BAT_DAU && new Date(voucher.NGAY_BAT_DAU).getTime() > now || voucher.NGAY_KET_THUC && new Date(voucher.NGAY_KET_THUC).getTime() < now) throw new InventoryError(400, 'Voucher không hợp lệ hoặc không thuộc khách hàng.');
    if (/chờ|thu hồi|hủy|khóa|hết hạn|inactive|revoked|pending/i.test(String(voucher.TRANG_THAI || ''))) throw new InventoryError(400, 'Voucher chưa kích hoạt hoặc không còn được sử dụng.');
    if (/minigame|vòng quay/i.test(String(voucher.NGUON || voucher.SOURCE || ''))) throw new InventoryError(409, 'Voucher minigame chưa có contract xác minh kích hoạt và đơn gốc trong module hiện tại. Cần nhóm voucher xác nhận dữ liệu trước khi áp dụng.');
    if (voucher.NHOM_KHACH_HANG && !['tat ca', 'all', 'public'].includes(statusKey(voucher.NHOM_KHACH_HANG)) &&
      (!customer || ![statusKey(customer.LOAI_THANH_VIEN), 'thanh vien', 'member'].includes(statusKey(voucher.NHOM_KHACH_HANG)))) throw new InventoryError(400, 'Voucher không dành cho nhóm khách này.');
    const minimum = Number(voucher.GIA_TRI_DON_TOI_THIEU ?? voucher.DON_HANG_TOI_THIEU ?? 0);
    if (!Number.isSafeInteger(minimum) || minimum < 0) throw new InventoryError(409, 'Điều kiện voucher chưa hợp lệ.');
    if (subtotal < minimum) throw new InventoryError(400, 'Đơn chưa đạt điều kiện voucher.');
    const value = Number(voucher.GIA_TRI_GIAM), kind = statusKey(voucher.LOAI_GIAM_GIA);
    if (!Number.isFinite(value) || value < 0) throw new InventoryError(409, 'Voucher chưa có mức giảm hợp lệ.');
    if (kind.includes('phan tram') || kind.includes('percent') || kind === '%') {
      if (value > 100) throw new InventoryError(409, 'Tỷ lệ voucher không hợp lệ.');
      const cap = Number(voucher.GIAM_TOI_DA ?? subtotal);
      if (!Number.isSafeInteger(cap) || cap < 0) throw new InventoryError(409, 'Giới hạn giảm voucher chưa hợp lệ.');
      productDiscount = Math.min(subtotal, Math.round(subtotal * value / 100), cap);
    } else if (['so tien', 'tien co dinh', 'tien mat', 'cash', 'fixed'].includes(kind)) {
      if (!Number.isSafeInteger(value)) throw new InventoryError(409, 'Mức giảm tiền phải là số nguyên đồng.');
      productDiscount = Math.min(subtotal, value);
    } else if (kind.includes('freeship') || kind.includes('van chuyen')) {
      if (!Number.isSafeInteger(value)) throw new InventoryError(409, 'Mức giảm tiền phải là số nguyên đồng.');
      shippingDiscount = Math.min(baseShippingFee, value);
    }
    else throw new InventoryError(409, 'Loại voucher chưa có quy tắc được hỗ trợ.');
  }
  const loyaltyPoints = Number(payload.summary?.loyaltyPoints || 0);
  if (!Number.isSafeInteger(loyaltyPoints) || loyaltyPoints < 0) throw new InventoryError(400, 'Điểm sử dụng phải là số nguyên không âm.');
  const loyaltyDiscount = loyaltyPoints * 500;
  if (loyaltyPoints) {
    if (!customer || loyaltyPoints > Number(customer.DIEM_TICH_LUY || 0) || loyaltyDiscount > subtotal - productDiscount) throw new InventoryError(400, 'Không đủ điểm hoặc mức giảm vượt tiền hàng.');
  }
  const shippingFee = baseShippingFee - shippingDiscount;
  const total = subtotal + shippingFee - productDiscount - loyaltyDiscount;
  const paymentMethod = String(payload.payment?.method || '');
  if (!['cod','bank','momo','vnpay'].includes(paymentMethod)) throw new InventoryError(400, 'Phương thức thanh toán không được hỗ trợ.');
  let depositAmount = 0;
  if (paymentMethod === 'cod') {
    const special = items.reduce((sum, i) => sum + i.qty, 0) >= 10 || items.some(i => /cuoi|su kien|wedding|event/.test(statusKey(i.name)));
    depositAmount = subtotal < 50000 ? 0 : Math.min(total, special ? Math.round(subtotal * .7) : subtotal < 300000 ? 50000 : subtotal < 500000 ? 100000 : Math.round(subtotal * (subtotal < 1000000 ? .3 : subtotal < 2000000 ? .4 : .5)));
  }
  return { ...payload, delivery, items, summary: { subtotal, shippingFee, baseShippingFee, productDiscount, shippingDiscount, loyaltyPoints, loyaltyDiscount, depositAmount, total },
    payment: { method: paymentMethod, methodName: ({ cod: 'COD', bank: 'Chuyển khoản', momo: 'MoMo', vnpay: 'VNPay' } as Record<string,string>)[paymentMethod] }, validatedVoucher: voucher };
}

export interface AdminOrderProductDto {
  id: string;
  name: string;
  image: string;
  qty: number;
  price: number;
}

export interface AdminOrderDetailDto {
  snapshotAvailable: boolean;
  allowedStatuses: string[];
  history: any[];
  preparationAt: string | null;
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

  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const formatTime = (value: Date | string | null | undefined): string => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh',
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
  if (key.includes('thanh to') && key.includes('bai')) return 'Thanh toán thất bại';
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
      name: item.TEN_SAN_PHAM_SNAPSHOT || product?.TEN_SAN_PHAM || item.SAN_PHAM_ID || 'Sản phẩm',
      image: item.HINH_ANH_SNAPSHOT || image?.URL || 'assets/images/logo-main.png',
      qty: Number(item.SO_LUONG || 0),
      price: Number(item.GIA || 0),
    };
  });

  const latestPayment = payments.sort((left, right) => {
    const dateDiff = new Date(right.NGAY_THANH_TOAN || 0).getTime() - new Date(left.NGAY_THANH_TOAN || 0).getTime();
    if (dateDiff !== 0) return dateDiff;
    return String(right.THANH_TOAN_ID || '').localeCompare(String(left.THANH_TOAN_ID || ''), 'vi');
  })[0] || null;
  const paidAmount = Math.max(0, sumVerifiedPayments(payments));
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
  const adminNote = order.GHI_CHU_NOI_BO || (noteParts.length > 1 ? noteParts.slice(1).join(' | ') : '');
  const noteEvent = [...(order.LICH_SU_TRANG_THAI || [])].reverse().find(event => event.action === 'note');
  const adminNoteTime = adminNote && noteEvent
    ? `${noteEvent.actor || 'Nhân viên'} | ${formatDate(noteEvent.at)} ${formatTime(noteEvent.at)}`.trim()
    : '';
  const total = Number(order.TONG_TIEN || 0);
  const voucherLinks = await (await getCollection<any>('DON_HANG_VOUCHER')).find({ DON_HANG_ID: orderId }).toArray();
  const voucherRows = await (await getCollection<any>('VOUCHER')).find({ VOUCHER_ID: { $in: voucherLinks.map(v => v.VOUCHER_ID) } }).toArray();
  const voucherLabel = voucherLinks.map(v => v.UU_DAI_SNAPSHOT?.MA_VOUCHER || voucherRows.find(r => r.VOUCHER_ID === v.VOUCHER_ID)?.MA_VOUCHER || v.VOUCHER_ID).join(', ');
  const deposit = Number(order.TIEN_COC || 0);
  const paid = paidAmount;
  const paymentStatus = total === 0 && paymentSucceeded(latestPayment?.TRANG_THAI_THANH_TOAN) ? 'Đã thanh toán' : paid > 0 ? (paid >= total ? 'Đã thanh toán' : 'Đã cọc')
    : /thất bại/i.test(String(latestPayment?.TRANG_THAI_THANH_TOAN)) ? 'Thanh toán thất bại' : 'Chờ thanh toán';

  return {
    allowedStatuses: allowedOrderStatuses(order, paid),
    snapshotAvailable: !!order.TINH_TIEN_SNAPSHOT && items.every(item => !!item.TEN_SAN_PHAM_SNAPSHOT),
    history: order.LICH_SU_TRANG_THAI || [],
    preparationAt: order.THOI_DIEM_BAT_DAU_CHUAN_BI ? new Date(order.THOI_DIEM_BAT_DAU_CHUAN_BI).toISOString() : null,
    id: order.DON_HANG_ID,
    orderStatus: normalizeOrderStatus(order.TRANG_THAI),
    paymentStatus,
    createdAt: formatDate(order.NGAY_TAO),
    createdTime: formatTime(order.NGAY_TAO),
    estimatedDelivery: order.KHUNG_GIO_MUON_GIAO || '',
    senderName: order.TEN_NGUOI_DAT || customer?.TEN || 'Khách lẻ',
    senderCustomerId: order.KHACH_HANG_ID || '',
    senderPhone: order.SDT_NGUOI_DAT || customer?.SDT || '',
    senderEmail: order.EMAIL_NGUOI_DAT || customer?.EMAIL || '',
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
    voucher: voucherLabel || null,
    voucherDiscount: Number(order.TINH_TIEN_SNAPSHOT?.productDiscount || 0) + Number(order.TINH_TIEN_SNAPSHOT?.shippingDiscount || 0),
    loyaltyPoints: Number(order.DIEM_THUONG_SU_DUNG || 0),
    loyaltyDiscount: Number(order.TINH_TIEN_SNAPSHOT?.loyaltyDiscount || 0),
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


export const AFTER_SALES = 'YEU_CAU_HAU_MAI';
export async function orderEvent(session: ClientSession, key: string, customerId: string | null, orderId: string | null, title: string, message: string, link?: string) {
  if (!customerId) return; // Guest sees private order/request history, never a public notification.
  const id = 'EV:' + key;
  await (await getCollection<any>('THONG_BAO')).updateOne({ _id: id }, { $setOnInsert: {
    THONG_BAO_ID: id, KHACH_HANG_ID: customerId, DON_HANG_ID: orderId, LOAI_THONG_BAO: 'order', TIEU_DE: title,
    NOI_DUNG: message, HINH_ANH: null, DUONG_DAN: link || '/order-detail/' + orderId, DA_DOC: false, DA_XEM: false, NGAY_TAO: new Date()
  } }, { upsert: true, session });
}
export function refundableAmount(receipts: any[]): number { return Math.max(0, sumVerifiedPayments(receipts)); }
export function afterSalesInput(body: any, details: any[]) {
  if (!body || !['return','exchange','refund'].includes(body.type)) throw new InventoryError(400, 'Chọn trả hàng, đổi hàng hoặc hoàn tiền.');
  const reason = String(body.reason || '').trim();
  if (!reason || reason.length > 2000) throw new InventoryError(400, 'Lý do cần từ 1–2.000 ký tự.');
  const items = Array.isArray(body.items) && body.items.length ? body.items : details.map(d => ({ productId:d.SAN_PHAM_ID, quantity:d.SO_LUONG }));
  const seen = new Set();
  for (const item of items) {
    const row = details.find(d => d.SAN_PHAM_ID === item.productId);
    if (!row || seen.has(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > Number(row.SO_LUONG)) throw new InventoryError(400, 'Sản phẩm hoặc số lượng khiếu nại không thuộc đơn.');
    seen.add(item.productId);
  }
  const evidence = Array.isArray(body.evidence) ? body.evidence : [];
  if (evidence.length > 10 || evidence.some((v: any) => typeof v !== 'string' || v.length > 2000 || !/^https?:\/\//.test(v) && !/^\/uploads\/[\w./-]+$/.test(v))) throw new InventoryError(400, 'Tối đa 10 liên kết bằng chứng ảnh/video hợp lệ.');
  return { type:body.type, reason, items, evidence };
}
export async function afterSalesRead(orderId: string) {
  return (await getCollection<any>(AFTER_SALES)).find({orderId}, {projection:{_id:0}}).sort({createdAt:-1}).toArray();
}
export async function afterSalesCreate(orderId: string, body: any) {
  const { randomUUID } = await import('node:crypto');
  const { withTransaction } = await import('./inventory/helpers.js');
  return withTransaction(async session => {
    const orders = await getCollection<any>('DON_HANG');
    const order = await orders.findOne({DON_HANG_ID:orderId},{session});
    if (!order) throw new InventoryError(404,'Không tìm thấy đơn.');
    const receipts = await (await getCollection<any>('THANH_TOAN')).find({DON_HANG_ID:orderId},{session}).toArray();
    if (!['Đã giao','Giao thành công','Giao hàng thành công','Hoàn thành','Đã hủy','Giao không thành công'].includes(order.TRANG_THAI) && refundableAmount(receipts) <= 0) throw new InventoryError(409,'Đơn chưa có căn cứ giao hàng hoặc khoản thu để mở hồ sơ hậu mãi. Hãy liên hệ shop tư vấn.');
    const details = await (await getCollection<any>('DON_HANG_CHI_TIET')).find({DON_HANG_ID:orderId},{session}).toArray();
    const input = afterSalesInput(body,details);
    const col = await getCollection<any>(AFTER_SALES);
    const active = await col.findOne({orderId,active:true},{session});
    if (active) return active;
    // Order lock also protects installations where the approved partial index is not yet installed.
    await orders.updateOne({DON_HANG_ID:orderId},{$inc:{PHIEN_BAN_THANH_TOAN:1}},{session});
    const id='HM'+randomUUID().replaceAll('-',''); const now=new Date();
    const row={_id:id,requestId:id,orderId,customerId:order.KHACH_HANG_ID || null,...input,status:'Chờ tiếp nhận',active:true,version:0,assignedTo:null,createdAt:now,updatedAt:now,history:[{action:'Khách gửi yêu cầu',at:now}]};
    await col.insertOne(row,{session});
    await orderEvent(session,id+':created',row.customerId,orderId,'Đã nhận yêu cầu hậu mãi','Shop đã tiếp nhận yêu cầu; chưa có quyết định hoàn tiền.');
    return row;
  });
}
export async function afterSalesChange(id: string, body: any, actor: string) {
  const { withTransaction } = await import('./inventory/helpers.js');
  const { createHash } = await import('node:crypto');
  return withTransaction(async session => {
    const col = await getCollection<any>(AFTER_SALES); const row = await col.findOne({_id:id},{session});
    if (!row) throw new InventoryError(404,'Không tìm thấy hồ sơ.');
    if (!Number.isInteger(body.version) || body.version !== row.version) throw new InventoryError(409,'Hồ sơ đã thay đổi; tải lại trước khi xử lý.');
    const orders=await getCollection<any>('DON_HANG'); const order=await orders.findOne({DON_HANG_ID:row.orderId},{session});
    const payments=await getCollection<any>('THANH_TOAN');const receipts=await payments.find({DON_HANG_ID:row.orderId},{session}).toArray();
    const maximum=refundableAmount(receipts); const now=new Date(); const updates:any={updatedAt:now};
    if(!actor) throw new InventoryError(401,'Cần xác thực nhân viên.');
    const reason=String(body.reason||'').trim();
    if(body.action==='claim') {
      if(row.status!=='Chờ tiếp nhận') throw new InventoryError(409,'Hồ sơ đã được tiếp nhận.');
      Object.assign(updates,{status:'Đang xem xét',assignedTo:actor});
    } else {
      if(row.assignedTo!==actor) throw new InventoryError(403,'Bạn chưa tiếp nhận hồ sơ này.');
      if(!reason || reason.length>2000) throw new InventoryError(400,'Cần lý do/kết quả xử lý tối đa 2.000 ký tự.');
      if(body.action==='accept'||body.action==='reject') {
        if(row.status!=='Đang xem xét') throw new InventoryError(409,'Quyết định đã chốt hoặc hồ sơ chưa được xem xét.');
        const maxRefund=body.action==='reject'?0:Number(body.maxRefund||0);
        if(!Number.isSafeInteger(maxRefund)||maxRefund<0||maxRefund>maximum) throw new InventoryError(409,'Mức hoàn được duyệt vượt tiền thực thu còn lại.');
        Object.assign(updates,{status:body.action==='reject'?'Đã từ chối':'Đã chấp nhận',active:body.action!=='reject',decision:{actor,at:now,reason,maxRefund}});
      } else if(body.action==='refund') {
        if(row.status!=='Đã chấp nhận'||row.refund) throw new InventoryError(409,'Chưa có quyết định hợp lệ hoặc đã hoàn.');
        const amount=Number(body.amount);const reference=String(body.reference||'').trim();
        if(!Number.isSafeInteger(amount)||amount<=0||amount>maximum||amount>Number(row.decision?.maxRefund)||!reference||reference.length>200) throw new InventoryError(409,'Khoản hoàn/mã tham chiếu không hợp lệ hoặc vượt hạn mức.');
        if(body.transferred!==true) throw new InventoryError(400,'Chỉ ghi nhận sau khi đã chuyển tiền thực tế và đối soát chứng từ.');
        await orders.updateOne({DON_HANG_ID:row.orderId},{$inc:{PHIEN_BAN_THANH_TOAN:1}},{session});
        const paymentId='HT'+id;const key='refund-reference:'+createHash('sha256').update(reference).digest('hex');
        const claims=await getCollection<any>('PHIEN_DAT_HANG');if(await payments.findOne({MA_GIAO_DICH:reference,TRANG_THAI_THANH_TOAN:{$in:['Thành công','Đã thanh toán','Đã cọc']}},{session}) || await claims.findOne({_id:key},{session})) throw new InventoryError(409,'Mã hoàn tiền đã được sử dụng.');
        await claims.insertOne({_id:key,paymentId,createdAt:now},{session});
        await payments.insertOne({_id:paymentId,THANH_TOAN_ID:paymentId,DON_HANG_ID:row.orderId,LOAI_GIAO_DICH:'HOAN_TIEN',SO_TIEN:amount,MA_GIAO_DICH:reference,CONG_THANH_TOAN:order?.PHUONG_THUC_THANH_TOAN,TRANG_THAI_THANH_TOAN:'Thành công',NGAY_THANH_TOAN:now,XAC_NHAN_LUC:now,NGUOI_XAC_NHAN:actor,LICH_SU:[{action:'Đối soát hoàn tiền thực tế',actor,at:now,reason}]},{session});
        Object.assign(updates,{status:'Đã hoàn tiền',active:false,refund:{amount,reference,paymentId,actor,at:now}});
      } else if(body.action==='complete') {
        if(row.status!=='Đã chấp nhận'||Number(row.decision?.maxRefund)>0) throw new InventoryError(409,'Cần đối soát khoản hoàn đã duyệt trước khi kết thúc.');
        Object.assign(updates,{status:'Đã xử lý',active:false});
      } else throw new InventoryError(400,'Thao tác không hợp lệ.');
    }
    await col.updateOne({_id:id,version:row.version},{$set:updates,$inc:{version:1},$push:{history:{action:body.action,actor,at:now,reason,status:updates.status}}} as any,{session});
    await orderEvent(session,id+':'+(row.version+1),row.customerId,row.orderId,'Cập nhật yêu cầu hậu mãi',updates.status+'. '+reason);
    return {...row,...updates,version:row.version+1};
  });
}
