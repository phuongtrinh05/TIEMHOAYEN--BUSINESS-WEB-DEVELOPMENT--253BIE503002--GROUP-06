import { Request, Response } from 'express';
import { sql } from '../db.js';
import { getAdminOrderDetailById } from '../services/admin-order.service.js';

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

const toIsoDate = (value: Date | string | null | undefined): string => {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toISOString().slice(0, 10);
};

const normalizePaymentStatus = (status: unknown, deposit: unknown, total: unknown = 0, paidAmount: unknown = 0): string => {
  const key = textKey(status);
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

  if (key.includes('cho') || key.includes('chua') || key.includes('ch thanh ton') || key.includes('ch thanh to') || key.includes('thanh to') || key.includes('thanh ton')) {
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

const parseMoneyAmount = (value: unknown): number => {
  if (typeof value === 'number') return value;

  const normalized = String(value ?? '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  return Number(normalized);
};

const normalizeOrderStatus = (status: unknown): string => {
  const raw = repairMojibakeText(status).trim();
  const key = textKey(raw);

  if (!raw) return 'Ch\u1edd x\u1eed l\u00fd';
  if (key.includes('van chuyen')) return 'Ch\u1edd v\u1eadn chuy\u1ec3n';
  if (key.includes('thanh to')) return 'Ch\u1edd thanh to\u00e1n';
  if (/\bhuy\b/.test(key) || key.includes('da huy')) return '\u0110\u00e3 h\u1ee7y';
  if (key.includes('hoan thanh')) return 'Ho\u00e0n th\u00e0nh';
  if (key.includes('giao thanh cong')) return 'Giao th\u00e0nh c\u00f4ng';
  if (key.includes('da giao')) return '\u0110\u00e3 giao';
  if (key.includes('dang giao')) return '\u0110ang giao';
  if (key.includes('chuan bi')) return '\u0110ang chu\u1ea9n b\u1ecb h\u00e0ng';

  return raw;
};

const PAYMENT_STATUSES_ALLOWED_TO_UPDATE_ORDER = new Set(['\u0110\u00e3 c\u1ecdc', '\u0110\u00e3 thanh to\u00e1n']);

const scheduleOrderCompletion = (orderId: string): void => {
  const threeHoursMs = 3 * 60 * 60 * 1000;

  setTimeout(async () => {
    try {
      const request = new sql.Request();
      request.input('DON_HANG_ID', sql.NVarChar(20), orderId);
      await request.query(`
        UPDATE DON_HANG
        SET TRANG_THAI = N'Ho\u00e0n th\u00e0nh'
        WHERE DON_HANG_ID = @DON_HANG_ID
          AND TRANG_THAI = N'Giao th\u00e0nh c\u00f4ng';
      `);
    } catch (error) {
      console.error('Auto complete delivered order error:', error);
    }
  }, threeHoursMs);
};

const getAvatarText = (name: unknown): string => {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
};

const normalizeTransactionStatus = (status: unknown): string => {
  const raw = repairMojibakeText(status).trim();
  const key = textKey(raw);

  if (!raw) return 'Chờ thanh toán';
  if (key.includes('that bai') || key.includes('thanh ton tht b') || key.includes('thanh toan tht b') || key.includes('thanh ton that b') || key.includes('failed') || key.includes('fail') || (key.includes('thanh to') && key.includes('bai'))) return 'Thanh toán thất bại';
  if (key.includes('thanh cong') || key.includes('da thanh toan') || key.includes('da thanh ton') || key.includes('success')) return 'Đã thanh toán';
  if (key.includes('coc')) return 'Đã cọc';
  if (key.includes('dang') || key.includes('ang thanh ton') || key.includes('ang thanh to') || key.includes('pending')) return 'Chờ thanh toán';
  if (key.includes('cho') || key.includes('chua') || key.includes('ch thanh ton') || key.includes('ch thanh to') || key.includes('thanh to') || key.includes('thanh ton')) return 'Chờ thanh toán';

  return raw;
};

const mapAdminCustomer = (row: any, index: number) => ({
  id: index + 1,
  code: row.KHACH_HANG_ID,
  name: row.TEN || '',
  avatarText: getAvatarText(row.TEN),
  phone: row.SDT || '',
  email: row.EMAIL || '',
  point: Number(row.DIEM_TICH_LUY || 0),
  membershipTier: row.LOAI_THANH_VIEN || '',
  createdAt: row.NGAY_DANG_KY ? new Date(row.NGAY_DANG_KY).toISOString() : '',
  birthDate: row.DOB ? new Date(row.DOB).toISOString() : '',
  gender: row.GIOI_TINH || '',
  selected: false,
});

const ADMIN_CUSTOMER_DETAIL_CACHE_MS = 30 * 1000;
const adminCustomerDetailCache = new Map<string, { expiresAt: number; data: any }>();

const clearAdminCustomerDetailCache = (customerId: unknown): void => {
  const key = String(customerId || '').trim().toUpperCase();
  if (key) {
    adminCustomerDetailCache.delete(key);
  }
};

const formatAdminCustomerAddress = (row: any): string => {
  return [
    row.DIA_CHI_CHI_TIET,
    row.PHUONG_XA,
    row.QUAN_HUYEN,
    row.TINH_THANH,
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
};

const cleanAdminAddressPart = (value: unknown): string => String(value || '').trim();

const parseAdminAddressPayload = (body: any) => {
  const addressText = cleanAdminAddressPart(body.address);
  const addressParts = addressText.split(',').map((part) => part.trim()).filter(Boolean);
  const province = cleanAdminAddressPart(body.province ?? body.tinhThanh)
    || addressParts[addressParts.length - 1]
    || '';
  const district = cleanAdminAddressPart(body.district ?? body.quanHuyen)
    || addressParts[addressParts.length - 2]
    || '';
  const ward = cleanAdminAddressPart(body.ward ?? body.phuongXa)
    || addressParts[addressParts.length - 3]
    || '';
  const detailAddress = cleanAdminAddressPart(body.detailAddress ?? body.addressDetail ?? body.specificAddress)
    || (addressParts.length > 3 ? addressParts.slice(0, -3).join(', ') : addressText);

  return {
    province,
    district,
    ward,
    detailAddress,
    address: [detailAddress, ward, district, province].filter(Boolean).join(', '),
  };
};

const mapAdminCustomerAddress = (row: any, fallbackName = '', fallbackPhone = '') => ({
  id: row.DIA_CHI_ID,
  name: row.TEN_NGUOI_NHAN || fallbackName,
  phone: row.SDT_NGUOI_NHAN || fallbackPhone,
  address: formatAdminCustomerAddress(row),
  province: row.TINH_THANH || '',
  district: row.QUAN_HUYEN || '',
  ward: row.PHUONG_XA || '',
  detailAddress: row.DIA_CHI_CHI_TIET || '',
  isDefault: Boolean(row.LA_MAC_DINH),
  lastUsedAt: row.LAST_USED_AT ? new Date(row.LAST_USED_AT).toISOString() : '',
});

export const getAdminAddressOptions = async (_req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      SELECT DISTINCT
        TINH_THANH,
        QUAN_HUYEN,
        PHUONG_XA
      FROM DIA_CHI_GIAO_HANG
      WHERE ISNULL(DA_XOA, 0) = 0
        AND NULLIF(LTRIM(RTRIM(ISNULL(TINH_THANH, ''))), '') IS NOT NULL
      ORDER BY TINH_THANH, QUAN_HUYEN, PHUONG_XA
    `);

    const provinceMap = new Map<string, { name: string; districts: Map<string, { name: string; wards: Map<string, { name: string }> }> }>();

    for (const row of result.recordset) {
      const provinceName = repairMojibakeText(row.TINH_THANH || '').trim();
      const districtName = repairMojibakeText(row.QUAN_HUYEN || '').trim();
      const wardName = repairMojibakeText(row.PHUONG_XA || '').trim();

      if (!provinceName) {
        continue;
      }

      if (!provinceMap.has(provinceName)) {
        provinceMap.set(provinceName, {
          name: provinceName,
          districts: new Map(),
        });
      }

      const province = provinceMap.get(provinceName)!;

      if (!districtName) {
        continue;
      }

      if (!province.districts.has(districtName)) {
        province.districts.set(districtName, {
          name: districtName,
          wards: new Map(),
        });
      }

      const district = province.districts.get(districtName)!;

      if (wardName && !district.wards.has(wardName)) {
        district.wards.set(wardName, { name: wardName });
      }
    }

    const provinces = Array.from(provinceMap.values()).map((province) => ({
      name: province.name,
      districts: Array.from(province.districts.values()).map((district) => ({
        name: district.name,
        wards: Array.from(district.wards.values()),
      })),
    }));

    return res.status(200).json({ provinces });
  } catch (error: any) {
    console.error('Admin address options error:', error);
    return res.status(500).json({ message: 'Cannot load address options: ' + error.message });
  }
};

const mapAdminTransaction = (row: any, index: number) => ({
  id: index + 1,
  code: row.THANH_TOAN_ID,
  orderCode: row.DON_HANG_ID || '',
  gateway: row.CONG_THANH_TOAN || '',
  status: normalizeTransactionStatus(row.TRANG_THAI_THANH_TOAN),
  amount: Number(row.SO_TIEN || 0),
  referenceCode: row.MA_GIAO_DICH || '',
  transactionDate: row.NGAY_THANH_TOAN ? new Date(row.NGAY_THANH_TOAN).toISOString() : '',
  selected: false,
});

const normalizeProductStatus = (status: unknown): string => {
  const raw = repairMojibakeText(status).trim();
  const key = textKey(raw);

  if (!raw) return 'Đang bán';
  if (key.includes('ngung') || key.includes('stop')) return 'Ngừng bán';
  return 'Đang bán';
};

const mapAdminProduct = (row: any) => {
  const originalPrice = Number(row.GIA || 0);
  const salePrice = Number(row.GIA_KHUYEN_MAI || 0);
  const finalPrice = salePrice > 0 && salePrice < originalPrice ? salePrice : originalPrice;
  const status = normalizeProductStatus(row.TRANG_THAI);

  return {
    image: row.HINH_ANH || 'assets/images/product-list-chungthuy.png',
    name: row.TEN_SAN_PHAM || '',
    sku: row.SAN_PHAM_ID,
    price: `${finalPrice.toLocaleString('vi-VN')}đ`,
    rating: Number(row.AVG_RATING || 0),
    quantity: Number(row.SO_LUONG || 0),
    featured: Number(row.DA_BAN || 0) > 0,
    sale: salePrice > 0 && salePrice < originalPrice,
    status,
    statusClass: status === 'Đang bán' ? 'selling' : 'stop',
    selected: false,
  };
};

const mapAdminCustomerFavoriteProduct = (row: any, index: number) => {
  const originalPrice = Number(row.GIA || 0);
  const salePrice = Number(row.GIA_KHUYEN_MAI || 0);
  const finalPrice = salePrice > 0 && salePrice < originalPrice ? salePrice : originalPrice;

  return {
    id: index + 1,
    code: row.SAN_PHAM_ID,
    name: row.TEN_SAN_PHAM || '',
    image: row.HINH_ANH || 'assets/images/product-list-chungthuy.png',
    price: finalPrice,
    originalPrice,
    salePrice,
    likedAt: row.NGAY_TAO ? new Date(row.NGAY_TAO).toISOString() : '',
  };
};

const categoryConfig: Record<string, {
  table: string;
  idColumn: string;
  nameColumn: string;
  linkTable?: string;
}> = {
  topic: {
    table: 'CHU_DE',
    idColumn: 'CHU_DE_ID',
    nameColumn: 'TEN_CHU_DE',
  },
  target: {
    table: 'DOI_TUONG',
    idColumn: 'DOI_TUONG_ID',
    nameColumn: 'TEN_DOI_TUONG',
    linkTable: 'DOI_TUONG_SAN_PHAM',
  },
  color: {
    table: 'MAU_SAC',
    idColumn: 'MAU_SAC_ID',
    nameColumn: 'TEN_MAU_SAC',
    linkTable: 'MAU_SAC_SAN_PHAM',
  },
  collection: {
    table: 'BO_SUU_TAP',
    idColumn: 'BO_SUU_TAP_ID',
    nameColumn: 'TEN_BO_SUU_TAP',
    linkTable: 'BO_SUU_TAP_SAN_PHAM',
  },
};

const categoryPrefix: Record<string, string> = {
  topic: 'CD',
  target: 'DT',
  color: 'MS',
  collection: 'BST',
};

const getNextPrefixedId = async (
  table: string,
  column: string,
  prefix: string,
  width: number
): Promise<string> => {
  const result = await sql.query(`
    SELECT ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(${column}, ${prefix.length + 1}, 20))), 0) + 1 AS NEXT_NUM
    FROM ${table}
    WHERE ${column} LIKE '${prefix}%'
  `);

  const nextNum = Number(result.recordset[0]?.NEXT_NUM || 1);
  return `${prefix}${nextNum.toString().padStart(width, '0')}`;
};

const getProductLookupId = async (
  tx: any,
  table: string,
  idColumn: string,
  nameColumn: string,
  value: unknown
): Promise<string | null> => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;

  const request = new sql.Request(tx);
  request.input('VALUE', sql.NVarChar(255), normalized);
  const result = await request.query(`
    SELECT TOP 1 ${idColumn} AS ID
    FROM ${table}
    WHERE ${idColumn} = @VALUE OR ${nameColumn} = @VALUE
  `);

  return result.recordset[0]?.ID || null;
};

const insertProductLookupLink = async (
  tx: any,
  table: string,
  productId: string,
  lookupColumn: string,
  lookupId: string | null
): Promise<void> => {
  if (!lookupId) return;

  const request = new sql.Request(tx);
  request.input('SAN_PHAM_ID', sql.NVarChar(20), productId);
  request.input('LOOKUP_ID', sql.NVarChar(20), lookupId);
  await request.query(`
    IF NOT EXISTS (
      SELECT 1
      FROM ${table}
      WHERE SAN_PHAM_ID = @SAN_PHAM_ID AND ${lookupColumn} = @LOOKUP_ID
    )
    INSERT INTO ${table} (SAN_PHAM_ID, ${lookupColumn})
    VALUES (@SAN_PHAM_ID, @LOOKUP_ID);
  `);
};

export const getAdminStaffAccounts = async (_req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      SELECT
        NHAN_VIEN_ID,
        HO_TEN,
        EMAIL,
        SDT,
        VAI_TRO,
        NGAY_TAO,
        TRANG_THAI
      FROM NHAN_VIEN
      ORDER BY NHAN_VIEN_ID ASC
    `);

    const accounts = result.recordset.map((row: any) => ({
      code: row.NHAN_VIEN_ID || '',
      name: row.HO_TEN || '',
      email: row.EMAIL || '',
      phone: row.SDT ? String(row.SDT) : '',
      role: row.VAI_TRO || '',
      createdAt: formatDate(row.NGAY_TAO),
      createdDate: toIsoDate(row.NGAY_TAO),
      status: row.TRANG_THAI || '',
      selected: false,
    }));

    return res.status(200).json({
      total: accounts.length,
      accounts,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Không thể tải danh sách tài khoản quản trị.',
      detail: error.message,
    });
  }
};

export const getAdminOrders = async (_req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      WITH LatestPayment AS (
        SELECT
          t.DON_HANG_ID,
          t.TRANG_THAI_THANH_TOAN,
          t.SO_TIEN,
          t.CONG_THANH_TOAN,
          ROW_NUMBER() OVER (
            PARTITION BY t.DON_HANG_ID
            ORDER BY t.NGAY_THANH_TOAN DESC, t.THANH_TOAN_ID DESC
          ) AS RN
        FROM THANH_TOAN t
      ), PaymentTotals AS (
        SELECT
          t.DON_HANG_ID,
          SUM(ISNULL(t.SO_TIEN, 0)) AS PAID_AMOUNT
        FROM THANH_TOAN t
        GROUP BY t.DON_HANG_ID
      )
      SELECT
        dh.DON_HANG_ID,
        dh.KHACH_HANG_ID,
        dh.NGAY_TAO,
        dh.TONG_TIEN,
        dh.TIEN_COC,
        dh.TRANG_THAI,
        tt.TRANG_THAI_THANH_TOAN,
        tt.SO_TIEN,
        tt.CONG_THANH_TOAN,
        paid.PAID_AMOUNT
      FROM DON_HANG dh
      LEFT JOIN LatestPayment tt ON tt.DON_HANG_ID = dh.DON_HANG_ID AND tt.RN = 1
      LEFT JOIN PaymentTotals paid ON paid.DON_HANG_ID = dh.DON_HANG_ID
      ORDER BY dh.NGAY_TAO DESC, dh.DON_HANG_ID DESC
    `);

    const orders = result.recordset.map((row: any) => ({
      id: row.DON_HANG_ID,
      customerId: row.KHACH_HANG_ID || '',
      createdAt: formatDate(row.NGAY_TAO),
      total: Number(row.TONG_TIEN || 0),
      paymentStatus: normalizeLatestPaymentStatus(row.TRANG_THAI_THANH_TOAN, row.TIEN_COC, row.TONG_TIEN, row.PAID_AMOUNT || row.SO_TIEN),
      orderStatus: normalizeOrderStatus(row.TRANG_THAI),
      selected: false,
    }));

    return res.status(200).json({
      total: orders.length,
      orders,
    });
  } catch (error: any) {
    console.error('Admin orders error:', error);
    return res.status(500).json({ message: 'KhÃ´ng thá»ƒ láº¥y danh sÃ¡ch Ä‘Æ¡n hÃ ng: ' + error.message });
  }
};

export const getAdminOrderDetail = async (req: Request, res: Response) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId) {
      return res.status(400).json({ message: 'Thiếu mã đơn hàng.' });
    }

    const order = await getAdminOrderDetailById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    return res.status(200).json({ order });
  } catch (error: any) {
    console.error('Admin order detail error:', error);
    return res.status(500).json({ message: 'Không thể lấy chi tiết đơn hàng: ' + error.message });
  }
};
const normalizeAdminOrderItems = (products: any[]) => {
  return (Array.isArray(products) ? products : [])
    .map((product) => ({
      productId: String(product.id || product.sku || '').replace(/^#/, '').trim(),
      quantity: Number(product.qty || product.quantity || 0),
      price: Number(product.price || 0),
    }))
    .filter((product) => product.productId && product.quantity > 0);
};

export const createAdminOrder = async (req: Request, res: Response) => {
  const tx = new sql.Transaction();
  try {
    const {
      senderName,
      senderPhone,
      senderEmail,
      senderCustomerId,
      receiverName,
      receiverPhone,
      deliveryDate,
      deliverySlot,
      deliveryAddress,
      products,
      customerNote,
      cardMessage,
      adminNote,
      paymentMethod,
      orderStatus,
      shippingFee,
      tax,
      voucher,
      voucherDiscount,
      loyaltyDiscount,
    } = req.body;

    const items = normalizeAdminOrderItems(products);
    if (items.length === 0) {
      return res.status(400).json({ message: 'Order requires at least one product.' });
    }

    const orderId = await getNextPrefixedId('DON_HANG', 'DON_HANG_ID', 'DH', 6);
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const shipping = Number(shippingFee || 0);
    const vat = Number(tax || 0);
    const vatRate = subtotal > 0 ? Number(((vat / subtotal) * 100).toFixed(2)) : 0;
    const discount = Number(voucherDiscount || 0) + Number(loyaltyDiscount || 0);
    const total = Math.max(subtotal + shipping + vat - discount, 0);

    const customerId = senderCustomerId ? String(senderCustomerId).replace(/^#/, '').trim() : '';
    const senderDisplayName = String(senderName || '').trim();
    const senderDisplayPhone = String(senderPhone || '').trim();

    if (!customerId && (!senderDisplayName || !senderDisplayPhone)) {
      return res.status(400).json({ message: 'Vui lòng nhập họ tên và số điện thoại người gửi.' });
    }

    await tx.begin();

    const headerRequest = new sql.Request(tx);
    headerRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    headerRequest.input('KHACH_HANG_ID', sql.NVarChar(20), customerId || null);
    headerRequest.input('NGAY_TAO', sql.DateTime, new Date());
    headerRequest.input('TRANG_THAI', sql.NVarChar(50), orderStatus || 'Chờ xử lý');
    headerRequest.input('TAM_TINH', sql.BigInt, subtotal);
    headerRequest.input('PHI_VAN_CHUYEN', sql.BigInt, shipping);
    headerRequest.input('TIEN_COC', sql.BigInt, 0);
    headerRequest.input('TONG_TIEN', sql.BigInt, total);
    headerRequest.input('PHUONG_THUC_THANH_TOAN', sql.NVarChar(100), paymentMethod || null);
    headerRequest.input('VAT', sql.Decimal(5, 2), vatRate);
    headerRequest.input('NGAY_MUON_GIAO', sql.Date, deliveryDate ? new Date(deliveryDate) : null);
    headerRequest.input('KHUNG_GIO_MUON_GIAO', sql.NVarChar(50), deliverySlot || null);
    headerRequest.input('LOI_NHAN_THIEP', sql.NVarChar(500), cardMessage || null);
    headerRequest.input('TEN_NGUOI_NHAN', sql.NVarChar(100), receiverName || null);
    headerRequest.input('SDT_NGUOI_NHAN', sql.VarChar(20), receiverPhone || null);
    headerRequest.input('DIA_CHI_GIAO_HANG', sql.NVarChar(500), deliveryAddress || null);
    const senderNoteParts = [
      senderDisplayName ? 'Người gửi: ' + senderDisplayName : '',
      senderDisplayPhone ? 'SĐT người gửi: ' + senderDisplayPhone : '',
      senderEmail ? 'Email người gửi: ' + String(senderEmail).trim() : '',
    ].filter(Boolean);
    headerRequest.input('GHI_CHU', sql.NVarChar(500), [...senderNoteParts, customerNote, adminNote].filter(Boolean).join(' | ') || null);

    await headerRequest.query(`
      INSERT INTO DON_HANG (
        DON_HANG_ID,
        KHACH_HANG_ID,
        NGAY_TAO,
        TRANG_THAI,
        TAM_TINH,
        PHI_VAN_CHUYEN,
        TIEN_COC,
        TONG_TIEN,
        PHUONG_THUC_THANH_TOAN,
        VAT,
        NGAY_MUON_GIAO,
        KHUNG_GIO_MUON_GIAO,
        LOI_NHAN_THIEP,
        TEN_NGUOI_NHAN,
        SDT_NGUOI_NHAN,
        DIA_CHI_GIAO_HANG,
        AN_THONG_TIN,
        GHI_CHU
      )
      VALUES (
        @DON_HANG_ID,
        @KHACH_HANG_ID,
        @NGAY_TAO,
        @TRANG_THAI,
        @TAM_TINH,
        @PHI_VAN_CHUYEN,
        @TIEN_COC,
        @TONG_TIEN,
        @PHUONG_THUC_THANH_TOAN,
        @VAT,
        @NGAY_MUON_GIAO,
        @KHUNG_GIO_MUON_GIAO,
        @LOI_NHAN_THIEP,
        @TEN_NGUOI_NHAN,
        @SDT_NGUOI_NHAN,
        @DIA_CHI_GIAO_HANG,
        0,
        @GHI_CHU
      )
    `);

    for (const item of items) {
      const detailRequest = new sql.Request(tx);
      detailRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
      detailRequest.input('SAN_PHAM_ID', sql.NVarChar(10), item.productId);
      detailRequest.input('SO_LUONG', sql.Int, item.quantity);
      detailRequest.input('GIA', sql.BigInt, item.price);
      await detailRequest.query(`
        INSERT INTO DON_HANG_CHI_TIET (DON_HANG_ID, SAN_PHAM_ID, SO_LUONG, GIA)
        VALUES (@DON_HANG_ID, @SAN_PHAM_ID, @SO_LUONG, @GIA);

        UPDATE SAN_PHAM
        SET
          SO_LUONG = CASE
            WHEN ISNULL(SO_LUONG, 0) - @SO_LUONG < 0 THEN 0
            ELSE ISNULL(SO_LUONG, 0) - @SO_LUONG
          END,
          DA_BAN = ISNULL(DA_BAN, 0) + @SO_LUONG
        WHERE SAN_PHAM_ID = @SAN_PHAM_ID;
      `);
    }

    const requestedVoucherId = String(voucher?.id || '').trim();
    const requestedVoucherCode = String(voucher?.code || '').trim().toUpperCase();

    if (requestedVoucherId || requestedVoucherCode) {
      const voucherCheckRequest = new sql.Request(tx);
      voucherCheckRequest.input('VOUCHER_ID', sql.NVarChar(10), requestedVoucherId);
      voucherCheckRequest.input('MA_VOUCHER', sql.NVarChar(50), requestedVoucherCode);

      if (customerId) {
        voucherCheckRequest.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);
      }

      const customerCondition = customerId
        ? 'AND (v.KHACH_HANG_ID = @KHACH_HANG_ID OR v.KHACH_HANG_ID IS NULL)'
        : 'AND v.KHACH_HANG_ID IS NULL';
      const customerOrder = customerId
        ? 'CASE WHEN v.KHACH_HANG_ID = @KHACH_HANG_ID THEN 0 ELSE 1 END,'
        : '';

      const voucherCheck = await voucherCheckRequest.query(`
        SELECT TOP 1
          v.VOUCHER_ID,
          v.MA_VOUCHER
        FROM VOUCHER v
        WHERE ISNULL(v.DA_DUNG, 0) = 0
          ${customerCondition}
          AND (
            v.NGAY_BAT_DAU IS NULL
            OR CAST(GETDATE() AS date) >= CAST(v.NGAY_BAT_DAU AS date)
          )
          AND (
            v.NGAY_KET_THUC IS NULL
            OR CAST(GETDATE() AS date) <= CAST(v.NGAY_KET_THUC AS date)
          )
          AND (
            (@VOUCHER_ID <> N'' AND v.VOUCHER_ID = @VOUCHER_ID)
            OR (@VOUCHER_ID = N'' AND @MA_VOUCHER <> N'' AND UPPER(v.MA_VOUCHER) = @MA_VOUCHER)
          )
        ORDER BY ${customerOrder} v.VOUCHER_ID ASC
      `);

      if (voucherCheck.recordset.length === 0) {
        const voucherError: any = new Error(customerId
          ? 'Voucher không hợp lệ, đã hết hạn hoặc không thuộc khách hàng này.'
          : 'Voucher không hợp lệ, đã hết hạn hoặc không dành cho khách vãng lai.');
        voucherError.statusCode = 400;
        throw voucherError;
      }

      const checkedVoucher = voucherCheck.recordset[0];
      const orderVoucherRequest = new sql.Request(tx);
      orderVoucherRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
      orderVoucherRequest.input('VOUCHER_ID', sql.NVarChar(10), checkedVoucher.VOUCHER_ID);
      orderVoucherRequest.input('MO_TA', sql.NVarChar(255), `Áp dụng voucher ${checkedVoucher.MA_VOUCHER}`);

      await orderVoucherRequest.query(`
        INSERT INTO DON_HANG_VOUCHER (DON_HANG_ID, VOUCHER_ID, MO_TA)
        VALUES (@DON_HANG_ID, @VOUCHER_ID, @MO_TA);

        UPDATE VOUCHER
        SET DA_DUNG = 1
        WHERE VOUCHER_ID = @VOUCHER_ID;
      `);
    }

    await tx.commit();
    return res.status(201).json({ message: 'Order created.', orderId });
  } catch (error: any) {
    if ((tx as any)._aborted !== true) {
      try { await tx.rollback(); } catch {}
    }
    console.error('Admin create order error:', error);
    const statusCode = Number(error?.statusCode || 500);
    return res.status(statusCode).json({ message: 'Cannot create order: ' + error.message });
  }
};

export const getAdminCustomers = async (_req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      SELECT
        KHACH_HANG_ID,
        TEN,
        EMAIL,
        SDT,
        DOB,
        GIOI_TINH,
        NGAY_DANG_KY,
        LOAI_THANH_VIEN,
        DIEM_TICH_LUY
      FROM KHACH_HANG
      ORDER BY NGAY_DANG_KY DESC, KHACH_HANG_ID DESC
    `);

    const customers = result.recordset.map(mapAdminCustomer);

    return res.status(200).json({
      total: customers.length,
      customers,
    });
  } catch (error: any) {
    console.error('Admin customers error:', error);
    return res.status(500).json({ message: 'Cannot load admin customers: ' + error.message });
  }
};

export const getAdminCustomerDetail = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || '').trim();
    if (!customerId) {
      return res.status(400).json({ message: 'Missing customer id.' });
    }

    const cacheKey = customerId.toUpperCase();
    const cached = adminCustomerDetailCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.status(200).json(cached.data);
    }

    const customerRequest = new sql.Request();
    customerRequest.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);

    const statsRequest = new sql.Request();
    statsRequest.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);

    const addressRequest = new sql.Request();
    addressRequest.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);

    const ordersRequest = new sql.Request();
    ordersRequest.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);

    const favoritesRequest = new sql.Request();
    favoritesRequest.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);

    const [customerResult, statsResult, addressResult, ordersResult, favoritesResult] = await Promise.all([
      customerRequest.query(`
      SELECT
        KHACH_HANG_ID,
        TEN,
        EMAIL,
        SDT,
        DOB,
        GIOI_TINH,
        NGAY_DANG_KY,
        LOAI_THANH_VIEN,
        DIEM_TICH_LUY
      FROM KHACH_HANG
      WHERE KHACH_HANG_ID = @KHACH_HANG_ID
    `),
      statsRequest.query(`
      WITH CustomerProfile AS (
        SELECT KHACH_HANG_ID, SDT
        FROM KHACH_HANG
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
      ), CustomerOrders AS (
        SELECT dh.DON_HANG_ID, dh.NGAY_TAO, dh.TAM_TINH, dh.TONG_TIEN, dh.TRANG_THAI
        FROM DON_HANG dh
        INNER JOIN CustomerProfile cp ON
          dh.KHACH_HANG_ID = cp.KHACH_HANG_ID
          OR NULLIF(LTRIM(RTRIM(ISNULL(dh.SDT_NGUOI_NHAN, ''))), '') = NULLIF(LTRIM(RTRIM(ISNULL(cp.SDT, ''))), '')
      )
      SELECT
        COUNT(*) AS TOTAL_ORDERS,
        ISNULL(SUM(CASE
          WHEN ISNULL(TRANG_THAI, '') IN (N'Hoàn thành', N'Giao hàng thành công') THEN ISNULL(TAM_TINH, 0)
          ELSE 0
        END), 0) AS TOTAL_SPENT,
        MAX(NGAY_TAO) AS LATEST_ORDER_DATE,
        ISNULL((
          SELECT AVG(CAST(dg.SO_SAO AS float))
          FROM DANH_GIA dg
          INNER JOIN CustomerOrders co ON co.DON_HANG_ID = dg.DON_HANG_ID
        ), 0) AS AVERAGE_RATING,
        (
          SELECT COUNT(*)
          FROM DANH_GIA dg
          INNER JOIN CustomerOrders co ON co.DON_HANG_ID = dg.DON_HANG_ID
        ) AS REVIEW_COUNT
      FROM CustomerOrders
    `),
      addressRequest.query(`
      SELECT TOP 20
        DIA_CHI_ID,
        TEN_NGUOI_NHAN,
        SDT_NGUOI_NHAN,
        TINH_THANH,
        QUAN_HUYEN,
        PHUONG_XA,
        DIA_CHI_CHI_TIET,
        LA_MAC_DINH,
        NULL AS LAST_USED_AT
      FROM DIA_CHI_GIAO_HANG
      WHERE KHACH_HANG_ID = @KHACH_HANG_ID
        AND ISNULL(DA_XOA, 0) = 0
      ORDER BY LA_MAC_DINH DESC, DIA_CHI_ID ASC
    `),
      ordersRequest.query(`
      SELECT TOP 100
        dh.DON_HANG_ID,
        dh.NGAY_TAO,
        dh.TONG_TIEN,
        dh.TRANG_THAI,
        dh.TIEN_COC,
        dh.PHUONG_THUC_THANH_TOAN,
        tt.TRANG_THAI_THANH_TOAN,
        tt.SO_TIEN AS SO_TIEN_THANH_TOAN
      FROM DON_HANG dh
      INNER JOIN KHACH_HANG kh ON kh.KHACH_HANG_ID = @KHACH_HANG_ID
      OUTER APPLY (
        SELECT TOP 1
          tt.TRANG_THAI_THANH_TOAN,
          tt.SO_TIEN
        FROM THANH_TOAN tt
        WHERE tt.DON_HANG_ID = dh.DON_HANG_ID
        ORDER BY tt.NGAY_THANH_TOAN DESC, tt.THANH_TOAN_ID DESC
      ) tt
      WHERE
        dh.KHACH_HANG_ID = kh.KHACH_HANG_ID
        OR NULLIF(LTRIM(RTRIM(ISNULL(dh.SDT_NGUOI_NHAN, ''))), '') = NULLIF(LTRIM(RTRIM(ISNULL(kh.SDT, ''))), '')
      ORDER BY dh.NGAY_TAO DESC, dh.DON_HANG_ID DESC
    `),
      favoritesRequest.query(`
      SELECT TOP 100
        yt.SAN_PHAM_ID,
        yt.NGAY_TAO,
        sp.TEN_SAN_PHAM,
        sp.GIA,
        sp.GIA_KHUYEN_MAI,
        ha.URL AS HINH_ANH
      FROM YEU_THICH yt
      INNER JOIN SAN_PHAM sp ON sp.SAN_PHAM_ID = yt.SAN_PHAM_ID
      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC, HINH_ANH_ID ASC
      ) ha
      WHERE yt.KHACH_HANG_ID = @KHACH_HANG_ID
      ORDER BY yt.NGAY_TAO DESC, yt.SAN_PHAM_ID DESC
    `),
    ]);

    if (customerResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const customer = mapAdminCustomer(customerResult.recordset[0], 0);
    const stats = statsResult.recordset[0] || {};

    const payload = {
      customer: {
        ...customer,
        totalOrders: Number(stats.TOTAL_ORDERS || 0),
        totalSpent: Number(stats.TOTAL_SPENT || 0),
        averageRating: Number(Number(stats.AVERAGE_RATING || 0).toFixed(1)),
        reviewCount: Number(stats.REVIEW_COUNT || 0),
        latestOrderDate: stats.LATEST_ORDER_DATE ? new Date(stats.LATEST_ORDER_DATE).toISOString() : customer.createdAt,
      },
      addresses: addressResult.recordset.map((row: any) => mapAdminCustomerAddress(row, customer.name, customer.phone)),
      orders: ordersResult.recordset.map((row: any, index: number) => ({
        id: index + 1,
        code: row.DON_HANG_ID,
        createdAt: row.NGAY_TAO ? new Date(row.NGAY_TAO).toISOString() : '',
        total: Number(row.TONG_TIEN || 0),
        paymentStatus: normalizeLatestPaymentStatus(
          row.TRANG_THAI_THANH_TOAN,
          row.TIEN_COC,
          row.TONG_TIEN,
          row.SO_TIEN_THANH_TOAN,
        ),
        status: repairMojibakeText(row.TRANG_THAI || ''),
      })),
      favorites: favoritesResult.recordset.map(mapAdminCustomerFavoriteProduct),
    };

    adminCustomerDetailCache.set(cacheKey, {
      expiresAt: Date.now() + ADMIN_CUSTOMER_DETAIL_CACHE_MS,
      data: payload,
    });

    return res.status(200).json(payload);
  } catch (error: any) {
    console.error('Admin customer detail error:', error);
    return res.status(500).json({ message: 'Cannot load customer detail: ' + error.message });
  }
};

export const updateAdminCustomer = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { name, phone, email, birthDate, gender } = req.body;

    if (!customerId || !name || !phone) {
      return res.status(400).json({ message: 'Missing customer fields.' });
    }

    const request = new sql.Request();
    request.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);
    request.input('TEN', sql.NVarChar(100), String(name).trim());
    request.input('SDT', sql.NVarChar(20), String(phone).trim());
    request.input('EMAIL', sql.NVarChar(100), email ? String(email).trim() : null);
    request.input('DOB', sql.Date, birthDate ? new Date(birthDate) : null);
    request.input('GIOI_TINH', sql.NVarChar(20), gender ? String(gender).trim() : null);

    const result = await request.query(`
      UPDATE KHACH_HANG
      SET
        TEN = @TEN,
        SDT = @SDT,
        EMAIL = @EMAIL,
        DOB = @DOB,
        GIOI_TINH = @GIOI_TINH
      WHERE KHACH_HANG_ID = @KHACH_HANG_ID;

      SELECT
        KHACH_HANG_ID,
        TEN,
        EMAIL,
        SDT,
        DOB,
        GIOI_TINH,
        NGAY_DANG_KY,
        DIEM_TICH_LUY
      FROM KHACH_HANG
      WHERE KHACH_HANG_ID = @KHACH_HANG_ID;
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    clearAdminCustomerDetailCache(customerId);

    return res.status(200).json({
      message: 'Customer updated.',
      customer: mapAdminCustomer(result.recordset[0], 0),
    });
  } catch (error: any) {
    console.error('Admin update customer error:', error);
    return res.status(500).json({ message: 'Cannot update customer: ' + error.message });
  }
};

const getNextAdminAddressId = async (): Promise<string> => {
  const result = await sql.query(`
    SELECT TOP 1 DIA_CHI_ID
    FROM DIA_CHI_GIAO_HANG
    WHERE DIA_CHI_ID LIKE 'DC%'
    ORDER BY DIA_CHI_ID DESC
  `);

  const lastId = String(result.recordset[0]?.DIA_CHI_ID || '');
  const nextNumber = (Number(lastId.replace(/\D/g, '')) || 0) + 1;
  return `DC${nextNumber.toString().padStart(4, '0')}`;
};

const getAdminAddressById = async (customerId: string, addressId: string) => {
  const request = new sql.Request();
  request.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);
  request.input('DIA_CHI_ID', sql.NVarChar(20), addressId);

  const result = await request.query(`
    SELECT TOP 1
      DIA_CHI_ID,
      TEN_NGUOI_NHAN,
      SDT_NGUOI_NHAN,
      TINH_THANH,
      QUAN_HUYEN,
      PHUONG_XA,
      DIA_CHI_CHI_TIET,
      LA_MAC_DINH,
      NULL AS LAST_USED_AT
    FROM DIA_CHI_GIAO_HANG
    WHERE KHACH_HANG_ID = @KHACH_HANG_ID
      AND DIA_CHI_ID = @DIA_CHI_ID
      AND ISNULL(DA_XOA, 0) = 0
  `);

  return result.recordset[0];
};

export const createAdminCustomerAddress = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || '').trim();
    const { name, phone, isDefault } = req.body;
    const receiverName = String(name || '').trim();
    const receiverPhone = String(phone || '').trim();
    const { province, district, ward, detailAddress } = parseAdminAddressPayload(req.body);

    if (!customerId || !receiverName || !receiverPhone || !province || !district || !ward || !detailAddress) {
      return res.status(400).json({ message: 'Missing address fields.' });
    }

    const countRequest = new sql.Request();
    countRequest.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);
    const countResult = await countRequest.query(`
      SELECT COUNT(*) AS TOTAL
      FROM DIA_CHI_GIAO_HANG
      WHERE KHACH_HANG_ID = @KHACH_HANG_ID
        AND ISNULL(DA_XOA, 0) = 0
    `);

    const shouldSetDefault = Boolean(isDefault) || Number(countResult.recordset[0]?.TOTAL || 0) === 0;

    if (shouldSetDefault) {
      const resetRequest = new sql.Request();
      resetRequest.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);
      await resetRequest.query(`
        UPDATE DIA_CHI_GIAO_HANG
        SET LA_MAC_DINH = 0
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
          AND ISNULL(DA_XOA, 0) = 0
      `);
    }

    const addressId = await getNextAdminAddressId();
    const request = new sql.Request();
    request.input('DIA_CHI_ID', sql.NVarChar(20), addressId);
    request.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);
    request.input('TEN_NGUOI_NHAN', sql.NVarChar(100), receiverName);
    request.input('SDT_NGUOI_NHAN', sql.NVarChar(20), receiverPhone);
    request.input('TINH_THANH', sql.NVarChar(100), province);
    request.input('QUAN_HUYEN', sql.NVarChar(100), district);
    request.input('PHUONG_XA', sql.NVarChar(100), ward);
    request.input('DIA_CHI_CHI_TIET', sql.NVarChar(255), detailAddress);
    request.input('LA_MAC_DINH', sql.Bit, shouldSetDefault);

    await request.query(`
      INSERT INTO DIA_CHI_GIAO_HANG (
        DIA_CHI_ID,
        KHACH_HANG_ID,
        TEN_NGUOI_NHAN,
        SDT_NGUOI_NHAN,
        TINH_THANH,
        QUAN_HUYEN,
        PHUONG_XA,
        DIA_CHI_CHI_TIET,
        LA_MAC_DINH,
        DA_XOA
      )
      VALUES (
        @DIA_CHI_ID,
        @KHACH_HANG_ID,
        @TEN_NGUOI_NHAN,
        @SDT_NGUOI_NHAN,
        @TINH_THANH,
        @QUAN_HUYEN,
        @PHUONG_XA,
        @DIA_CHI_CHI_TIET,
        @LA_MAC_DINH,
        0
      )
    `);

    clearAdminCustomerDetailCache(customerId);
    const savedAddress = await getAdminAddressById(customerId, addressId);

    return res.status(201).json({
      message: 'Address created.',
      address: mapAdminCustomerAddress(savedAddress, receiverName, receiverPhone),
    });
  } catch (error: any) {
    console.error('Admin create customer address error:', error);
    return res.status(500).json({ message: 'Cannot create address: ' + error.message });
  }
};

export const updateAdminCustomerAddress = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || '').trim();
    const addressId = String(req.params.addressId || '').trim();
    const { name, phone, isDefault } = req.body;
    const receiverName = String(name || '').trim();
    const receiverPhone = String(phone || '').trim();
    const { province, district, ward, detailAddress } = parseAdminAddressPayload(req.body);

    if (!customerId || !addressId || !receiverName || !receiverPhone || !province || !district || !ward || !detailAddress) {
      return res.status(400).json({ message: 'Missing address fields.' });
    }

    const existing = await getAdminAddressById(customerId, addressId);
    if (!existing) {
      return res.status(404).json({ message: 'Address not found.' });
    }

    if (Boolean(isDefault)) {
      const resetRequest = new sql.Request();
      resetRequest.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);
      await resetRequest.query(`
        UPDATE DIA_CHI_GIAO_HANG
        SET LA_MAC_DINH = 0
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
          AND ISNULL(DA_XOA, 0) = 0
      `);
    }

    const request = new sql.Request();
    request.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);
    request.input('DIA_CHI_ID', sql.NVarChar(20), addressId);
    request.input('TEN_NGUOI_NHAN', sql.NVarChar(100), receiverName);
    request.input('SDT_NGUOI_NHAN', sql.NVarChar(20), receiverPhone);
    request.input('TINH_THANH', sql.NVarChar(100), province);
    request.input('QUAN_HUYEN', sql.NVarChar(100), district);
    request.input('PHUONG_XA', sql.NVarChar(100), ward);
    request.input('DIA_CHI_CHI_TIET', sql.NVarChar(255), detailAddress);
    request.input('LA_MAC_DINH', sql.Bit, Boolean(isDefault));

    await request.query(`
      UPDATE DIA_CHI_GIAO_HANG
      SET
        TEN_NGUOI_NHAN = @TEN_NGUOI_NHAN,
        SDT_NGUOI_NHAN = @SDT_NGUOI_NHAN,
        TINH_THANH = @TINH_THANH,
        QUAN_HUYEN = @QUAN_HUYEN,
        PHUONG_XA = @PHUONG_XA,
        DIA_CHI_CHI_TIET = @DIA_CHI_CHI_TIET,
        LA_MAC_DINH = @LA_MAC_DINH
      WHERE KHACH_HANG_ID = @KHACH_HANG_ID
        AND DIA_CHI_ID = @DIA_CHI_ID
        AND ISNULL(DA_XOA, 0) = 0
    `);

    clearAdminCustomerDetailCache(customerId);
    const savedAddress = await getAdminAddressById(customerId, addressId);

    return res.status(200).json({
      message: 'Address updated.',
      address: mapAdminCustomerAddress(savedAddress, receiverName, receiverPhone),
    });
  } catch (error: any) {
    console.error('Admin update customer address error:', error);
    return res.status(500).json({ message: 'Cannot update address: ' + error.message });
  }
};

export const setDefaultAdminCustomerAddress = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || '').trim();
    const addressId = String(req.params.addressId || '').trim();

    const existing = await getAdminAddressById(customerId, addressId);
    if (!existing) {
      return res.status(404).json({ message: 'Address not found.' });
    }

    const request = new sql.Request();
    request.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);
    request.input('DIA_CHI_ID', sql.NVarChar(20), addressId);
    await request.query(`
      UPDATE DIA_CHI_GIAO_HANG
      SET LA_MAC_DINH = CASE WHEN DIA_CHI_ID = @DIA_CHI_ID THEN 1 ELSE 0 END
      WHERE KHACH_HANG_ID = @KHACH_HANG_ID
        AND ISNULL(DA_XOA, 0) = 0
    `);

    clearAdminCustomerDetailCache(customerId);
    const savedAddress = await getAdminAddressById(customerId, addressId);

    return res.status(200).json({
      message: 'Default address updated.',
      address: mapAdminCustomerAddress(savedAddress),
    });
  } catch (error: any) {
    console.error('Admin set default address error:', error);
    return res.status(500).json({ message: 'Cannot set default address: ' + error.message });
  }
};

export const deleteAdminCustomerAddress = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || '').trim();
    const addressId = String(req.params.addressId || '').trim();

    const existing = await getAdminAddressById(customerId, addressId);
    if (!existing) {
      return res.status(404).json({ message: 'Address not found.' });
    }

    const request = new sql.Request();
    request.input('KHACH_HANG_ID', sql.NVarChar(20), customerId);
    request.input('DIA_CHI_ID', sql.NVarChar(20), addressId);
    await request.query(`
      UPDATE DIA_CHI_GIAO_HANG
      SET DA_XOA = 1, LA_MAC_DINH = 0
      WHERE KHACH_HANG_ID = @KHACH_HANG_ID
        AND DIA_CHI_ID = @DIA_CHI_ID;

      IF NOT EXISTS (
        SELECT 1
        FROM DIA_CHI_GIAO_HANG
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
          AND ISNULL(DA_XOA, 0) = 0
          AND LA_MAC_DINH = 1
      )
      BEGIN
        UPDATE DIA_CHI_GIAO_HANG
        SET LA_MAC_DINH = 1
        WHERE DIA_CHI_ID = (
          SELECT TOP 1 DIA_CHI_ID
          FROM DIA_CHI_GIAO_HANG
          WHERE KHACH_HANG_ID = @KHACH_HANG_ID
            AND ISNULL(DA_XOA, 0) = 0
          ORDER BY DIA_CHI_ID ASC
        );
      END
    `);

    clearAdminCustomerDetailCache(customerId);
    return res.status(200).json({ message: 'Address deleted.' });
  } catch (error: any) {
    console.error('Admin delete customer address error:', error);
    return res.status(500).json({ message: 'Cannot delete address: ' + error.message });
  }
};

export const getAdminTransactions = async (_req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      SELECT
        THANH_TOAN_ID,
        DON_HANG_ID,
        CONG_THANH_TOAN,
        MA_GIAO_DICH,
        SO_TIEN,
        TRANG_THAI_THANH_TOAN,
        NGAY_THANH_TOAN
      FROM THANH_TOAN
      ORDER BY NGAY_THANH_TOAN DESC, THANH_TOAN_ID DESC
    `);

    const transactions = result.recordset.map(mapAdminTransaction);

    return res.status(200).json({
      total: transactions.length,
      transactions,
    });
  } catch (error: any) {
    console.error('Admin transactions error:', error);
    return res.status(500).json({ message: 'Cannot load admin transactions: ' + error.message });
  }
};

export const updateAdminTransaction = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;
    const { gateway, status, amount } = req.body;
    const parsedAmount = parseMoneyAmount(amount);

    if (!transactionId || !gateway || !status || !Number.isFinite(parsedAmount) || parsedAmount < 0) {
      return res.status(400).json({ message: 'Missing transaction fields.' });
    }

    const request = new sql.Request();
    request.input('THANH_TOAN_ID', sql.NVarChar(20), transactionId);
    request.input('CONG_THANH_TOAN', sql.NVarChar(100), String(gateway));
    request.input('TRANG_THAI_THANH_TOAN', sql.NVarChar(50), normalizeTransactionStatus(status));
    request.input('SO_TIEN', sql.Decimal(18, 2), parsedAmount);

    const result = await request.query(`
      UPDATE THANH_TOAN
      SET
        CONG_THANH_TOAN = @CONG_THANH_TOAN,
        TRANG_THAI_THANH_TOAN = @TRANG_THAI_THANH_TOAN,
        SO_TIEN = @SO_TIEN,
        NGAY_THANH_TOAN = GETDATE()
      WHERE THANH_TOAN_ID = @THANH_TOAN_ID;

      SELECT
        THANH_TOAN_ID,
        DON_HANG_ID,
        CONG_THANH_TOAN,
        MA_GIAO_DICH,
        SO_TIEN,
        TRANG_THAI_THANH_TOAN,
        NGAY_THANH_TOAN
      FROM THANH_TOAN
      WHERE THANH_TOAN_ID = @THANH_TOAN_ID;
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Transaction not found.' });
    }

    const updatedTransaction = result.recordset[0];
    const orderCode = String(updatedTransaction.DON_HANG_ID || '').trim();
    if (orderCode) {
      const normalizedPayment = normalizePaymentStatus(updatedTransaction.TRANG_THAI_THANH_TOAN, 0, 0, updatedTransaction.SO_TIEN);
      const paidAmount = normalizedPayment === 'Đã thanh toán' || normalizedPayment === 'Đã cọc'
        ? Number(updatedTransaction.SO_TIEN || 0)
        : 0;
      const syncRequest = new sql.Request();
      syncRequest.input('DON_HANG_ID', sql.NVarChar(20), orderCode);
      syncRequest.input('TIEN_COC', sql.BigInt, Math.round(paidAmount));
      syncRequest.input('PHUONG_THUC_THANH_TOAN', sql.NVarChar(100), updatedTransaction.CONG_THANH_TOAN || null);
      await syncRequest.query(`
        UPDATE DON_HANG
        SET
          TIEN_COC = @TIEN_COC,
          PHUONG_THUC_THANH_TOAN = @PHUONG_THUC_THANH_TOAN
        WHERE DON_HANG_ID = @DON_HANG_ID;
      `);
    }

    return res.status(200).json({
      message: 'Transaction updated.',
      transaction: mapAdminTransaction(updatedTransaction, 0),
    });
  } catch (error: any) {
    console.error('Admin update transaction error:', error);
    return res.status(500).json({ message: 'Cannot update transaction: ' + error.message });
  }
};

export const createAdminTransaction = async (req: Request, res: Response) => {
  try {
    const { orderCode, gateway, status, amount, referenceCode, transactionDate } = req.body;
    const normalizedOrderCode = String(orderCode || '').replace(/^#/, '').trim();
    const parsedAmount = parseMoneyAmount(amount);

    if (!normalizedOrderCode || !gateway || !status || !referenceCode || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: 'Missing transaction fields.' });
    }

    const nextIdResult = await sql.query(`
      SELECT ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(THANH_TOAN_ID, 3, 20))), 0) + 1 AS NEXT_NUM
      FROM THANH_TOAN
      WHERE THANH_TOAN_ID LIKE 'TT%'
    `);

    const nextNum = Number(nextIdResult.recordset[0]?.NEXT_NUM || 1);
    const transactionId = `TT${nextNum.toString().padStart(5, '0')}`;
    const paidAt = transactionDate ? new Date(transactionDate) : new Date();

    if (Number.isNaN(paidAt.getTime())) {
      return res.status(400).json({ message: 'Invalid transaction date.' });
    }

    const request = new sql.Request();
    request.input('THANH_TOAN_ID', sql.NVarChar(20), transactionId);
    request.input('DON_HANG_ID', sql.NVarChar(20), normalizedOrderCode);
    request.input('CONG_THANH_TOAN', sql.NVarChar(100), String(gateway));
    request.input('MA_GIAO_DICH', sql.NVarChar(100), String(referenceCode).trim());
    request.input('SO_TIEN', sql.Decimal(18, 2), parsedAmount);
    request.input('TRANG_THAI_THANH_TOAN', sql.NVarChar(50), normalizeTransactionStatus(status));
    request.input('NGAY_THANH_TOAN', sql.DateTime, paidAt);

    const result = await request.query(`
      INSERT INTO THANH_TOAN (
        THANH_TOAN_ID,
        DON_HANG_ID,
        CONG_THANH_TOAN,
        MA_GIAO_DICH,
        SO_TIEN,
        TRANG_THAI_THANH_TOAN,
        NGAY_THANH_TOAN
      )
      VALUES (
        @THANH_TOAN_ID,
        @DON_HANG_ID,
        @CONG_THANH_TOAN,
        @MA_GIAO_DICH,
        @SO_TIEN,
        @TRANG_THAI_THANH_TOAN,
        @NGAY_THANH_TOAN
      );

      SELECT
        THANH_TOAN_ID,
        DON_HANG_ID,
        CONG_THANH_TOAN,
        MA_GIAO_DICH,
        SO_TIEN,
        TRANG_THAI_THANH_TOAN,
        NGAY_THANH_TOAN
      FROM THANH_TOAN
      WHERE THANH_TOAN_ID = @THANH_TOAN_ID;
    `);

    const createdTransaction = result.recordset[0];
    const normalizedPayment = normalizePaymentStatus(createdTransaction.TRANG_THAI_THANH_TOAN, 0, 0, createdTransaction.SO_TIEN);
    const paidAmount = normalizedPayment === 'Đã thanh toán' || normalizedPayment === 'Đã cọc'
      ? Number(createdTransaction.SO_TIEN || 0)
      : 0;
    const syncRequest = new sql.Request();
    syncRequest.input('DON_HANG_ID', sql.NVarChar(20), createdTransaction.DON_HANG_ID);
    syncRequest.input('TIEN_COC', sql.BigInt, Math.round(paidAmount));
    syncRequest.input('PHUONG_THUC_THANH_TOAN', sql.NVarChar(100), createdTransaction.CONG_THANH_TOAN || null);
    await syncRequest.query(`
      UPDATE DON_HANG
      SET
        TIEN_COC = @TIEN_COC,
        PHUONG_THUC_THANH_TOAN = @PHUONG_THUC_THANH_TOAN
      WHERE DON_HANG_ID = @DON_HANG_ID;
    `);

    return res.status(201).json({
      message: 'Transaction created.',
      transaction: mapAdminTransaction(createdTransaction, 0),
    });
  } catch (error: any) {
    console.error('Admin create transaction error:', error);
    return res.status(500).json({ message: 'Cannot create transaction: ' + error.message });
  }
};

export const updateAdminOrderPaymentStatus = async (req: Request, res: Response) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const status = normalizePaymentStatus(req.body.status, 0, 0, 0);
    const paymentMethod = String(req.body.paymentMethod || '').trim();
    const allowedStatuses = ['Đã thanh toán', 'Chờ thanh toán', 'Đã cọc', 'Thanh toán thất bại'];

    if (!orderId || !allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Thiếu mã đơn hàng hoặc trạng thái thanh toán không hợp lệ.' });
    }

    const orderRequest = new sql.Request();
    orderRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    const orderResult = await orderRequest.query(`
      SELECT TOP 1 DON_HANG_ID, TONG_TIEN, TIEN_COC, PHUONG_THUC_THANH_TOAN
      FROM DON_HANG
      WHERE DON_HANG_ID = @DON_HANG_ID;
    `);

    const order = orderResult.recordset[0];
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const total = Number(order.TONG_TIEN || 0);
    const currentDeposit = Number(order.TIEN_COC || 0);
    const paidAmount = status === 'Đã thanh toán'
      ? total
      : status === 'Đã cọc'
        ? currentDeposit
        : 0;
    const nextDeposit = status === 'Đã thanh toán' || status === 'Đã cọc' ? paidAmount : 0;
    const gateway = paymentMethod || order.PHUONG_THUC_THANH_TOAN || 'Admin';

    const latestRequest = new sql.Request();
    latestRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    const latestResult = await latestRequest.query(`
      SELECT TOP 1 THANH_TOAN_ID
      FROM THANH_TOAN
      WHERE DON_HANG_ID = @DON_HANG_ID
      ORDER BY NGAY_THANH_TOAN DESC, THANH_TOAN_ID DESC;
    `);

    const paymentId = latestResult.recordset[0]?.THANH_TOAN_ID;

    if (paymentId) {
      const updateRequest = new sql.Request();
      updateRequest.input('THANH_TOAN_ID', sql.NVarChar(20), paymentId);
      updateRequest.input('TRANG_THAI_THANH_TOAN', sql.NVarChar(50), status);
      updateRequest.input('SO_TIEN', sql.Decimal(18, 2), paidAmount);
      updateRequest.input('CONG_THANH_TOAN', sql.NVarChar(100), gateway);
      await updateRequest.query(`
        UPDATE THANH_TOAN
        SET
          TRANG_THAI_THANH_TOAN = @TRANG_THAI_THANH_TOAN,
          SO_TIEN = @SO_TIEN,
          CONG_THANH_TOAN = @CONG_THANH_TOAN,
          NGAY_THANH_TOAN = GETDATE()
        WHERE THANH_TOAN_ID = @THANH_TOAN_ID;
      `);
    } else {
      const nextIdResult = await sql.query(`
        SELECT ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(THANH_TOAN_ID, 3, 20))), 0) + 1 AS NEXT_NUM
        FROM THANH_TOAN
        WHERE THANH_TOAN_ID LIKE 'TT%'
      `);
      const nextNum = Number(nextIdResult.recordset[0]?.NEXT_NUM || 1);
      const newPaymentId = `TT${nextNum.toString().padStart(5, '0')}`;
      const insertRequest = new sql.Request();
      insertRequest.input('THANH_TOAN_ID', sql.NVarChar(20), newPaymentId);
      insertRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
      insertRequest.input('CONG_THANH_TOAN', sql.NVarChar(100), gateway);
      insertRequest.input('MA_GIAO_DICH', sql.NVarChar(100), null);
      insertRequest.input('SO_TIEN', sql.Decimal(18, 2), paidAmount);
      insertRequest.input('TRANG_THAI_THANH_TOAN', sql.NVarChar(50), status);
      await insertRequest.query(`
        INSERT INTO THANH_TOAN (
          THANH_TOAN_ID,
          DON_HANG_ID,
          CONG_THANH_TOAN,
          MA_GIAO_DICH,
          SO_TIEN,
          TRANG_THAI_THANH_TOAN,
          NGAY_THANH_TOAN
        )
        VALUES (
          @THANH_TOAN_ID,
          @DON_HANG_ID,
          @CONG_THANH_TOAN,
          @MA_GIAO_DICH,
          @SO_TIEN,
          @TRANG_THAI_THANH_TOAN,
          GETDATE()
        );
      `);
    }

    const headerRequest = new sql.Request();
    headerRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    headerRequest.input('TIEN_COC', sql.BigInt, Math.round(nextDeposit));
    headerRequest.input('PHUONG_THUC_THANH_TOAN', sql.NVarChar(100), gateway);
    await headerRequest.query(`
      UPDATE DON_HANG
      SET
        TIEN_COC = @TIEN_COC,
        PHUONG_THUC_THANH_TOAN = @PHUONG_THUC_THANH_TOAN
      WHERE DON_HANG_ID = @DON_HANG_ID;
    `);

    const updatedOrder = await getAdminOrderDetailById(orderId);

    return res.status(200).json({
      message: 'Cập nhật trạng thái thanh toán thành công.',
      order: updatedOrder,
    });
  } catch (error: any) {
    console.error('Admin update order payment status error:', error);
    return res.status(500).json({ message: 'Không thể cập nhật trạng thái thanh toán: ' + error.message });
  }
};

export const getAdminProducts = async (_req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      WITH FirstImage AS (
        SELECT
          SAN_PHAM_ID,
          URL,
          ROW_NUMBER() OVER (
            PARTITION BY SAN_PHAM_ID
            ORDER BY LA_ANH_CHINH DESC, HINH_ANH_ID ASC
          ) AS rn
        FROM HINH_ANH_SAN_PHAM
      ),
      ReviewStats AS (
        SELECT
          SAN_PHAM_ID,
          AVG(CAST(SO_SAO AS FLOAT)) AS AVG_RATING
        FROM DANH_GIA
        GROUP BY SAN_PHAM_ID
      )
      SELECT
        sp.SAN_PHAM_ID,
        sp.TEN_SAN_PHAM,
        sp.MO_TA,
        sp.GIA,
        sp.GIA_KHUYEN_MAI,
        sp.TRANG_THAI,
        sp.KIEU_DANG,
        sp.SO_LUONG,
        sp.DA_BAN,
        img.URL AS HINH_ANH,
        ISNULL(rs.AVG_RATING, 0) AS AVG_RATING
      FROM SAN_PHAM sp
      LEFT JOIN FirstImage img ON img.SAN_PHAM_ID = sp.SAN_PHAM_ID AND img.rn = 1
      LEFT JOIN ReviewStats rs ON rs.SAN_PHAM_ID = sp.SAN_PHAM_ID
      ORDER BY sp.SAN_PHAM_ID DESC
    `);

    const products = result.recordset.map(mapAdminProduct);

    return res.status(200).json({
      total: products.length,
      products,
    });
  } catch (error: any) {
    console.error('Admin products error:', error);
    return res.status(500).json({ message: 'Cannot load admin products: ' + error.message });
  }
};

export const createAdminProduct = async (req: Request, res: Response) => {
  const tx = new sql.Transaction();

  try {
    const {
      sku,
      name,
      description,
      color,
      target,
      flower,
      topic,
      salePrice,
      discountPrice,
      quantity,
      style,
      images,
      materials,
    } = req.body;

    if (!sku || !name || Number(salePrice) <= 0) {
      return res.status(400).json({ message: 'Missing product fields.' });
    }

    const productId = String(sku).trim();
    await tx.begin();

    const topicId = await getProductLookupId(tx, 'CHU_DE', 'CHU_DE_ID', 'TEN_CHU_DE', topic);
    const colorId = await getProductLookupId(tx, 'MAU_SAC', 'MAU_SAC_ID', 'TEN_MAU_SAC', color);
    const targetId = await getProductLookupId(tx, 'DOI_TUONG', 'DOI_TUONG_ID', 'TEN_DOI_TUONG', target);
    const flowerId = await getProductLookupId(tx, 'HOA_TUOI', 'HOA_TUOI_ID', 'TEN_HOA_TUOI', flower);

    const request = new sql.Request(tx);
    request.input('SAN_PHAM_ID', sql.NVarChar(20), productId);
    request.input('CHU_DE_ID', sql.NVarChar(20), topicId);
    request.input('TEN_SAN_PHAM', sql.NVarChar(200), String(name).trim());
    request.input('MO_TA', sql.NVarChar(sql.MAX), description ? String(description).trim() : '');
    request.input('GIA', sql.Decimal(18, 2), Number(salePrice || 0));
    request.input('GIA_KHUYEN_MAI', sql.Decimal(18, 2), Number(discountPrice || 0));
    request.input('TRANG_THAI', sql.NVarChar(50), 'Đang bán');
    request.input('KIEU_DANG', sql.NVarChar(100), style ? String(style) : '');
    request.input('SO_LUONG', sql.Int, Number(quantity || 0));

    await request.query(`
      INSERT INTO SAN_PHAM (
        SAN_PHAM_ID,
        CHU_DE_ID,
        TEN_SAN_PHAM,
        MO_TA,
        GIA,
        GIA_KHUYEN_MAI,
        TRANG_THAI,
        KIEU_DANG,
        SO_LUONG,
        DA_BAN
      )
      VALUES (
        @SAN_PHAM_ID,
        @CHU_DE_ID,
        @TEN_SAN_PHAM,
        @MO_TA,
        @GIA,
        NULLIF(@GIA_KHUYEN_MAI, 0),
        @TRANG_THAI,
        @KIEU_DANG,
        @SO_LUONG,
        0
      );
    `);

    await insertProductLookupLink(tx, 'MAU_SAC_SAN_PHAM', productId, 'MAU_SAC_ID', colorId);
    await insertProductLookupLink(tx, 'DOI_TUONG_SAN_PHAM', productId, 'DOI_TUONG_ID', targetId);
    await insertProductLookupLink(tx, 'HOA_TUOI_SAN_PHAM', productId, 'HOA_TUOI_ID', flowerId);

    const productImages = Array.isArray(images)
      ? images.map((image: unknown) => String(image || '').trim()).filter(Boolean)
      : [];

    for (let index = 0; index < productImages.length; index++) {
      const imageRequest = new sql.Request(tx);
      imageRequest.input('SAN_PHAM_ID', sql.NVarChar(20), productId);
      imageRequest.input('URL', sql.NVarChar(sql.MAX), productImages[index]);
      imageRequest.input('LA_ANH_CHINH', sql.Bit, index === 0);

      await imageRequest.query(`
        DECLARE @NEXT_NUM int;
        SELECT @NEXT_NUM = ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(HINH_ANH_ID, 4, 20))), 0) + 1
        FROM HINH_ANH_SAN_PHAM
        WHERE HINH_ANH_ID LIKE 'IMG%';

        INSERT INTO HINH_ANH_SAN_PHAM (HINH_ANH_ID, SAN_PHAM_ID, URL, LA_ANH_CHINH)
        VALUES (CONCAT('IMG', RIGHT(CONCAT('000000', @NEXT_NUM), 6)), @SAN_PHAM_ID, @URL, @LA_ANH_CHINH);
      `);
    }

    const recipe = Array.isArray(materials) ? materials : [];
    for (const item of recipe) {
      const materialValue = String(item?.code || item?.name || '').trim();
      if (!materialValue) continue;

      const materialId = await getProductLookupId(
        tx,
        'NGUYEN_VAT_LIEU',
        'NGUYEN_VAT_LIEU_ID',
        'TEN_NGUYEN_VAT_LIEU',
        materialValue
      );

      if (!materialId) continue;

      const recipeRequest = new sql.Request(tx);
      recipeRequest.input('SAN_PHAM_ID', sql.NVarChar(20), productId);
      recipeRequest.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(20), materialId);
      recipeRequest.input('SO_LUONG_CAN', sql.Int, Number(item.quantity || 0));
      recipeRequest.input('DON_VI_TINH', sql.NVarChar(50), item.unit ? String(item.unit).trim() : null);
      recipeRequest.input('GHI_CHU', sql.NVarChar(255), item.note ? String(item.note).trim() : null);
      await recipeRequest.query(`
        INSERT INTO CONG_THUC_SAN_PHAM (
          SAN_PHAM_ID,
          NGUYEN_VAT_LIEU_ID,
          SO_LUONG_CAN,
          DON_VI_TINH,
          GHI_CHU
        )
        VALUES (
          @SAN_PHAM_ID,
          @NGUYEN_VAT_LIEU_ID,
          @SO_LUONG_CAN,
          @DON_VI_TINH,
          @GHI_CHU
        );
      `);
    }

    await tx.commit();

    const created = await sql.query`
      SELECT
        sp.SAN_PHAM_ID,
        sp.TEN_SAN_PHAM,
        sp.GIA,
        sp.GIA_KHUYEN_MAI,
        sp.TRANG_THAI,
        sp.SO_LUONG,
        sp.DA_BAN,
        img.URL AS HINH_ANH,
        0 AS AVG_RATING
      FROM SAN_PHAM sp
      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC, HINH_ANH_ID ASC
      ) img
      WHERE sp.SAN_PHAM_ID = ${String(sku).trim()}
    `;

    return res.status(201).json({
      message: 'Product created.',
      product: mapAdminProduct(created.recordset[0]),
    });
  } catch (error: any) {
    if ((tx as any)._aborted !== true) {
      try { await tx.rollback(); } catch {}
    }
    console.error('Admin create product error:', error);
    return res.status(500).json({ message: 'Cannot create product: ' + error.message });
  }
};

export const getAdminProductDetail = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ message: 'Missing product id.' });
    }

    const scopedProductRequest = () => {
      const request = new sql.Request();
      request.input('SAN_PHAM_ID', sql.NVarChar(10), productId);
      return request;
    };

    const [
      productResult,
      imageResult,
      recipeResult,
      reviewResult,
      colorResult,
      styleResult,
      targetResult,
      topicResult,
      flowerResult,
      materialResult,
    ] = await Promise.all([
      scopedProductRequest().query(`
        SELECT TOP 1
          sp.SAN_PHAM_ID,
          sp.CHU_DE_ID,
          sp.TEN_SAN_PHAM,
          sp.MO_TA,
          sp.GIA,
          sp.GIA_KHUYEN_MAI,
          sp.TRANG_THAI,
          sp.KIEU_DANG,
          sp.SO_LUONG,
          cd.TEN_CHU_DE,
          ms.TEN_MAU_SAC,
          dt.TEN_DOI_TUONG,
          ht.TEN_HOA_TUOI
        FROM SAN_PHAM sp
        LEFT JOIN CHU_DE cd ON cd.CHU_DE_ID = sp.CHU_DE_ID
        OUTER APPLY (
          SELECT TOP 1 m.TEN_MAU_SAC
          FROM MAU_SAC_SAN_PHAM mssp
          INNER JOIN MAU_SAC m ON m.MAU_SAC_ID = mssp.MAU_SAC_ID
          WHERE mssp.SAN_PHAM_ID = sp.SAN_PHAM_ID
          ORDER BY m.TEN_MAU_SAC ASC
        ) ms
        OUTER APPLY (
          SELECT TOP 1 d.TEN_DOI_TUONG
          FROM DOI_TUONG_SAN_PHAM dtsp
          INNER JOIN DOI_TUONG d ON d.DOI_TUONG_ID = dtsp.DOI_TUONG_ID
          WHERE dtsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
          ORDER BY d.TEN_DOI_TUONG ASC
        ) dt
        OUTER APPLY (
          SELECT TOP 1 h.TEN_HOA_TUOI
          FROM HOA_TUOI_SAN_PHAM htsp
          INNER JOIN HOA_TUOI h ON h.HOA_TUOI_ID = htsp.HOA_TUOI_ID
          WHERE htsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
          ORDER BY h.TEN_HOA_TUOI ASC
        ) ht
        WHERE sp.SAN_PHAM_ID = @SAN_PHAM_ID
      `),
      scopedProductRequest().query(`
        SELECT URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = @SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC, HINH_ANH_ID ASC
      `),
      scopedProductRequest().query(`
        SELECT
          ct.NGUYEN_VAT_LIEU_ID,
          nvl.TEN_NGUYEN_VAT_LIEU,
          ct.SO_LUONG_CAN,
          ct.DON_VI_TINH,
          ct.GHI_CHU,
          nvl.GIA_NHAP
        FROM CONG_THUC_SAN_PHAM ct
        LEFT JOIN NGUYEN_VAT_LIEU nvl ON nvl.NGUYEN_VAT_LIEU_ID = ct.NGUYEN_VAT_LIEU_ID
        WHERE ct.SAN_PHAM_ID = @SAN_PHAM_ID
        ORDER BY ct.NGUYEN_VAT_LIEU_ID ASC
      `),
      scopedProductRequest().query(`
        SELECT
          dg.DANH_GIA_ID,
          dg.SO_SAO,
          dg.NOI_DUNG,
          dg.NGAY_DANH_GIA,
          kh.TEN,
          kh.AVATAR
        FROM DANH_GIA dg
        LEFT JOIN KHACH_HANG kh ON kh.KHACH_HANG_ID = dg.KHACH_HANG_ID
        WHERE dg.SAN_PHAM_ID = @SAN_PHAM_ID
        ORDER BY dg.NGAY_DANH_GIA DESC
      `),
      sql.query(`SELECT TEN_MAU_SAC AS name FROM MAU_SAC ORDER BY TEN_MAU_SAC ASC`),
      sql.query(`SELECT DISTINCT KIEU_DANG AS name FROM SAN_PHAM WHERE KIEU_DANG IS NOT NULL AND KIEU_DANG <> '' ORDER BY KIEU_DANG ASC`),
      sql.query(`SELECT TEN_DOI_TUONG AS name FROM DOI_TUONG ORDER BY TEN_DOI_TUONG ASC`),
      sql.query(`SELECT TEN_CHU_DE AS name FROM CHU_DE ORDER BY TEN_CHU_DE ASC`),
      sql.query(`SELECT TEN_HOA_TUOI AS name FROM HOA_TUOI ORDER BY TEN_HOA_TUOI ASC`),
      sql.query(`
        SELECT
          NGUYEN_VAT_LIEU_ID,
          TEN_NGUYEN_VAT_LIEU,
          DON_VI_TINH,
          GIA_NHAP
        FROM NGUYEN_VAT_LIEU
        ORDER BY TEN_NGUYEN_VAT_LIEU ASC
      `),
    ]);

    const product = productResult.recordset[0];
    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const recipe = recipeResult.recordset.map((row: any, index: number) => ({
      id: index + 1,
      code: row.NGUYEN_VAT_LIEU_ID,
      name: row.TEN_NGUYEN_VAT_LIEU || row.NGUYEN_VAT_LIEU_ID,
      quantity: Number(row.SO_LUONG_CAN || 0),
      unit: row.DON_VI_TINH || '',
      note: row.GHI_CHU || '',
      image: 'assets/images/hoahong.png',
      importPrice: Number(row.GIA_NHAP || 0),
    }));

    const reviews = reviewResult.recordset.map((row: any) => ({
      avatar: row.AVATAR || 'assets/images/logo-main.png',
      name: row.TEN || 'Khách hàng',
      rating: Number(row.SO_SAO || 0),
      content: row.NOI_DUNG || '',
      date: row.NGAY_DANH_GIA ? new Date(row.NGAY_DANH_GIA).toISOString() : '',
      images: [],
    }));

    const ratingCounts = [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: reviews.filter((review) => review.rating === star).length,
      percent: reviews.length
        ? Math.round((reviews.filter((review) => review.rating === star).length / reviews.length) * 100)
        : 0,
    }));

    const averageRating = reviews.length
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : 0;

    return res.status(200).json({
      product: {
        name: product.TEN_SAN_PHAM || '',
        code: product.SAN_PHAM_ID,
        note: product.MO_TA || '',
        color: product.TEN_MAU_SAC || '',
        style: product.KIEU_DANG || '',
        target: product.TEN_DOI_TUONG || '',
        topic: product.TEN_CHU_DE || '',
        flower: product.TEN_HOA_TUOI || '',
        quantity: Number(product.SO_LUONG || 0),
        status: normalizeProductStatus(product.TRANG_THAI),
        isPublished: normalizeProductStatus(product.TRANG_THAI) === 'Đang bán',
        images: imageResult.recordset.map((row: any) => row.URL).filter(Boolean),
        importPrice: recipe.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.importPrice || 0), 0),
        salePrice: Number(product.GIA || 0),
        discountPrice: Number(product.GIA_KHUYEN_MAI || 0),
        recipe: '',
      },
      options: {
        colors: colorResult.recordset.map((row: any) => row.name),
        styles: styleResult.recordset.map((row: any) => row.name),
        targets: targetResult.recordset.map((row: any) => row.name),
        topics: topicResult.recordset.map((row: any) => row.name),
        flowers: flowerResult.recordset.map((row: any) => row.name),
        materials: materialResult.recordset.map((row: any) => ({
          code: row.NGUYEN_VAT_LIEU_ID,
          name: row.TEN_NGUYEN_VAT_LIEU,
          unit: row.DON_VI_TINH || '',
          importPrice: Number(row.GIA_NHAP || 0),
          image: 'assets/images/hoahong.png',
        })),
      },
      materials: recipe,
      reviews,
      ratingSummary: ratingCounts,
      averageRating: Number(averageRating.toFixed(1)),
      reviewCount: reviews.length,
    });
  } catch (error: any) {
    console.error('Admin product detail error:', error);
    return res.status(500).json({ message: 'Cannot load product detail: ' + error.message });
  }
};

export const updateAdminProductDetail = async (req: Request, res: Response) => {
  const tx = new sql.Transaction();
  try {
    const { productId } = req.params;
    const { product, materials } = req.body;

    if (!productId || !product?.name) {
      return res.status(400).json({ message: 'Missing product detail fields.' });
    }

    await tx.begin();

    const updateRequest = new sql.Request(tx);
    updateRequest.input('SAN_PHAM_ID', sql.NVarChar(10), productId);
    updateRequest.input('TEN_SAN_PHAM', sql.NVarChar(255), String(product.name).trim());
    updateRequest.input('MO_TA', sql.NVarChar(sql.MAX), product.note ? String(product.note).trim() : null);
    updateRequest.input('GIA', sql.BigInt, Number(product.salePrice || 0));
    updateRequest.input('GIA_KHUYEN_MAI', sql.BigInt, Number(product.discountPrice || 0));
    updateRequest.input('TRANG_THAI', sql.NVarChar(50), normalizeProductStatus(product.status));
    updateRequest.input('KIEU_DANG', sql.NVarChar(100), product.style ? String(product.style).trim() : null);
    updateRequest.input('SO_LUONG', sql.Int, Number(product.quantity || 0));
    await updateRequest.query(`
      UPDATE SAN_PHAM
      SET
        TEN_SAN_PHAM = @TEN_SAN_PHAM,
        MO_TA = @MO_TA,
        GIA = @GIA,
        GIA_KHUYEN_MAI = NULLIF(@GIA_KHUYEN_MAI, 0),
        TRANG_THAI = @TRANG_THAI,
        KIEU_DANG = @KIEU_DANG,
        SO_LUONG = @SO_LUONG
      WHERE SAN_PHAM_ID = @SAN_PHAM_ID;

      DELETE FROM CONG_THUC_SAN_PHAM
      WHERE SAN_PHAM_ID = @SAN_PHAM_ID;
    `);

    const recipe = Array.isArray(materials) ? materials : [];
    for (const item of recipe) {
      const code = String(item.code || '').trim();
      if (!code) continue;

      const detailRequest = new sql.Request(tx);
      detailRequest.input('SAN_PHAM_ID', sql.NVarChar(10), productId);
      detailRequest.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(10), code);
      detailRequest.input('SO_LUONG_CAN', sql.Int, Number(item.quantity || 0));
      detailRequest.input('DON_VI_TINH', sql.NVarChar(50), item.unit ? String(item.unit).trim() : null);
      detailRequest.input('GHI_CHU', sql.NVarChar(255), item.note ? String(item.note).trim() : null);
      await detailRequest.query(`
        INSERT INTO CONG_THUC_SAN_PHAM (
          SAN_PHAM_ID,
          NGUYEN_VAT_LIEU_ID,
          SO_LUONG_CAN,
          DON_VI_TINH,
          GHI_CHU
        )
        VALUES (
          @SAN_PHAM_ID,
          @NGUYEN_VAT_LIEU_ID,
          @SO_LUONG_CAN,
          @DON_VI_TINH,
          @GHI_CHU
        )
      `);
    }

    const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
    const imageDeleteRequest = new sql.Request(tx);
    imageDeleteRequest.input('SAN_PHAM_ID', sql.NVarChar(10), productId);
    await imageDeleteRequest.query('DELETE FROM HINH_ANH_SAN_PHAM WHERE SAN_PHAM_ID = @SAN_PHAM_ID');

    for (let index = 0; index < images.length; index++) {
      const imageRequest = new sql.Request(tx);
      const imageId = `${productId}${(index + 1).toString().padStart(3, '0')}`.slice(0, 10);
      imageRequest.input('HINH_ANH_ID', sql.NVarChar(10), imageId);
      imageRequest.input('SAN_PHAM_ID', sql.NVarChar(10), productId);
      imageRequest.input('URL', sql.NVarChar(500), String(images[index]));
      imageRequest.input('LA_ANH_CHINH', sql.Bit, index === 0);
      await imageRequest.query(`
        INSERT INTO HINH_ANH_SAN_PHAM (HINH_ANH_ID, SAN_PHAM_ID, URL, LA_ANH_CHINH)
        VALUES (@HINH_ANH_ID, @SAN_PHAM_ID, @URL, @LA_ANH_CHINH)
      `);
    }

    await tx.commit();
    return res.status(200).json({ message: 'Product detail updated.' });
  } catch (error: any) {
    if ((tx as any)._aborted !== true) {
      try { await tx.rollback(); } catch {}
    }
    console.error('Admin update product detail error:', error);
    return res.status(500).json({ message: 'Cannot update product detail: ' + error.message });
  }
};

export const updateAdminProductStatus = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { status } = req.body;

    if (!productId || !status) {
      return res.status(400).json({ message: 'Missing product status.' });
    }

    const request = new sql.Request();
    request.input('SAN_PHAM_ID', sql.NVarChar(20), productId);
    request.input('TRANG_THAI', sql.NVarChar(50), normalizeProductStatus(status));

    const result = await request.query(`
      UPDATE SAN_PHAM
      SET TRANG_THAI = @TRANG_THAI
      WHERE SAN_PHAM_ID = @SAN_PHAM_ID;

      SELECT SAN_PHAM_ID, TRANG_THAI
      FROM SAN_PHAM
      WHERE SAN_PHAM_ID = @SAN_PHAM_ID;
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    return res.status(200).json({ message: 'Product status updated.' });
  } catch (error: any) {
    console.error('Admin update product status error:', error);
    return res.status(500).json({ message: 'Cannot update product status: ' + error.message });
  }
};

export const deleteAdminProduct = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;

    if (!productId) {
      return res.status(400).json({ message: 'Missing product id.' });
    }

    const request = new sql.Request();
    request.input('SAN_PHAM_ID', sql.NVarChar(20), productId);

    await request.query(`
      DELETE FROM HINH_ANH_SAN_PHAM
      WHERE SAN_PHAM_ID = @SAN_PHAM_ID;

      DELETE FROM SAN_PHAM
      WHERE SAN_PHAM_ID = @SAN_PHAM_ID;
    `);

    return res.status(200).json({ message: 'Product deleted.' });
  } catch (error: any) {
    console.error('Admin delete product error:', error);
    return res.status(500).json({ message: 'Cannot delete product: ' + error.message });
  }
};

export const getAdminCategories = async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type || 'topic');

    if (type === 'style') {
      const result = await sql.query(`
        SELECT
          ROW_NUMBER() OVER (ORDER BY ISNULL(NULLIF(KIEU_DANG, ''), N'Chưa phân loại')) AS ROW_NUM,
          ISNULL(NULLIF(KIEU_DANG, ''), N'Chưa phân loại') AS NAME,
          COUNT(*) AS TOTAL
        FROM SAN_PHAM
        GROUP BY ISNULL(NULLIF(KIEU_DANG, ''), N'Chưa phân loại')
        ORDER BY NAME ASC
      `);

      const categories = result.recordset.map((row: any) => ({
        code: `STYLE${Number(row.ROW_NUM || 0).toString().padStart(3, '0')}`,
        name: row.NAME,
        total: Number(row.TOTAL || 0),
        selected: false,
      }));

      return res.status(200).json({ type, categories });
    }

    const config = categoryConfig[type];
    if (!config) {
      return res.status(400).json({ message: 'Invalid category type.' });
    }

    const totalExpression = config.linkTable
      ? `(SELECT COUNT(DISTINCT link.SAN_PHAM_ID) FROM ${config.linkTable} link WHERE link.${config.idColumn} = c.${config.idColumn})`
      : `(SELECT COUNT(*) FROM SAN_PHAM sp WHERE sp.${config.idColumn} = c.${config.idColumn})`;

    const result = await sql.query(`
      SELECT
        c.${config.idColumn} AS CODE,
        c.${config.nameColumn} AS NAME,
        ${totalExpression} AS TOTAL
      FROM ${config.table} c
      ORDER BY c.${config.idColumn} ASC
    `);

    const categories = result.recordset.map((row: any) => ({
      code: row.CODE,
      name: row.NAME,
      total: Number(row.TOTAL || 0),
      selected: false,
    }));

    return res.status(200).json({ type, categories });
  } catch (error: any) {
    console.error('Admin categories error:', error);
    return res.status(500).json({ message: 'Cannot load categories: ' + error.message });
  }
};

export const createAdminCategory = async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type || 'topic');
    const { name } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Missing category name.' });
    }

    if (type === 'style') {
      return res.status(400).json({ message: 'Style categories are generated from product data.' });
    }

    const config = categoryConfig[type];
    const prefix = categoryPrefix[type];

    if (!config || !prefix) {
      return res.status(400).json({ message: 'Invalid category type.' });
    }

    const nextIdResult = await sql.query(`
      SELECT ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(${config.idColumn}, ${prefix.length + 1}, 20))), 0) + 1 AS NEXT_NUM
      FROM ${config.table}
      WHERE ${config.idColumn} LIKE '${prefix}%'
    `);

    const nextNum = Number(nextIdResult.recordset[0]?.NEXT_NUM || 1);
    const categoryId = `${prefix}${nextNum.toString().padStart(3, '0')}`;

    const request = new sql.Request();
    request.input('ID', sql.NVarChar(20), categoryId);
    request.input('NAME', sql.NVarChar(200), String(name).trim());

    await request.query(`
      INSERT INTO ${config.table} (${config.idColumn}, ${config.nameColumn})
      VALUES (@ID, @NAME)
    `);

    return res.status(201).json({
      message: 'Category created.',
      category: {
        code: categoryId,
        name: String(name).trim(),
        total: 0,
        selected: false,
      },
    });
  } catch (error: any) {
    console.error('Admin create category error:', error);
    return res.status(500).json({ message: 'Cannot create category: ' + error.message });
  }
};

export const deleteAdminCategory = async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type || 'topic');
    const { categoryId } = req.params;

    if (type === 'style') {
      return res.status(400).json({ message: 'Style categories are generated from product data.' });
    }

    const config = categoryConfig[type];
    if (!config || !categoryId) {
      return res.status(400).json({ message: 'Invalid category.' });
    }

    const request = new sql.Request();
    request.input('ID', sql.NVarChar(20), categoryId);

    await request.query(`
      DELETE FROM ${config.table}
      WHERE ${config.idColumn} = @ID
    `);

    return res.status(200).json({ message: 'Category deleted.' });
  } catch (error: any) {
    console.error('Admin delete category error:', error);
    return res.status(500).json({ message: 'Cannot delete category: ' + error.message });
  }
};

const mapAdminMaterial = (row: any, index: number) => ({
  id: index + 1,
  code: row.NGUYEN_VAT_LIEU_ID,
  name: row.TEN_NGUYEN_VAT_LIEU || '',
  image: row.URL_HINH_ANH || '',
  color: row.TEN_MAU_SAC || '',
  unit: row.DON_VI_TINH || '',
  quantity: Number(row.SO_LUONG_TON || 0),
  importPrice: Number(row.GIA_NHAP || 0),
  sellPrice: Number(row.GIA_BAN || 0),
  selected: false,
  description: row.MO_TA || '',
  status: Number(row.SO_LUONG_TON || 0) <= 0
    ? 'Hết hàng'
    : Number(row.SO_LUONG_TON || 0) <= 10
      ? 'Sắp hết hàng'
      : 'Còn hàng',
});

export const getAdminMaterials = async (_req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      WITH ColorAgg AS (
        SELECT
          msn.NGUYEN_VAT_LIEU_ID,
          STRING_AGG(ms.TEN_MAU_SAC, N', ') AS TEN_MAU_SAC
        FROM MAU_SAC_NVL msn
        INNER JOIN MAU_SAC ms ON ms.MAU_SAC_ID = msn.MAU_SAC_ID
        GROUP BY msn.NGUYEN_VAT_LIEU_ID
      )
      SELECT
        nvl.NGUYEN_VAT_LIEU_ID,
        nvl.TEN_NGUYEN_VAT_LIEU,
        nvl.SO_LUONG_TON,
        nvl.DON_VI_TINH,
        nvl.GIA_NHAP,
        nvl.GIA_BAN,
        nvl.MO_TA,
        nvl.URL_HINH_ANH,
        colors.TEN_MAU_SAC
      FROM NGUYEN_VAT_LIEU nvl
      LEFT JOIN ColorAgg colors ON colors.NGUYEN_VAT_LIEU_ID = nvl.NGUYEN_VAT_LIEU_ID
      ORDER BY nvl.NGUYEN_VAT_LIEU_ID ASC
    `);

    const materials = result.recordset.map(mapAdminMaterial);

    return res.status(200).json({
      total: materials.length,
      materials,
    });
  } catch (error: any) {
    console.error('Admin materials error:', error);
    return res.status(500).json({ message: 'Cannot load materials: ' + error.message });
  }
};

export const createAdminMaterial = async (req: Request, res: Response) => {
  try {
    const { name, unit, quantity, importPrice, sellPrice, description, image } = req.body;

    if (!name || !unit) {
      return res.status(400).json({ message: 'Missing material fields.' });
    }

    const materialId = await getNextPrefixedId('NGUYEN_VAT_LIEU', 'NGUYEN_VAT_LIEU_ID', 'NVL', 4);

    const request = new sql.Request();
    request.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(20), materialId);
    request.input('TEN_NGUYEN_VAT_LIEU', sql.NVarChar(200), String(name).trim());
    request.input('SO_LUONG_TON', sql.Int, Number(quantity || 0));
    request.input('DON_VI_TINH', sql.NVarChar(50), String(unit).trim());
    request.input('GIA_NHAP', sql.BigInt, Number(importPrice || 0));
    request.input('GIA_BAN', sql.BigInt, Number(sellPrice || 0));
    request.input('MO_TA', sql.NVarChar(500), description ? String(description).trim() : null);
    request.input('URL_HINH_ANH', sql.NVarChar(1000), image ? String(image).trim() : null);

    const result = await request.query(`
      INSERT INTO NGUYEN_VAT_LIEU (
        NGUYEN_VAT_LIEU_ID,
        TEN_NGUYEN_VAT_LIEU,
        SO_LUONG_TON,
        DON_VI_TINH,
        GIA_NHAP,
        GIA_BAN,
        MO_TA,
        URL_HINH_ANH
      )
      VALUES (
        @NGUYEN_VAT_LIEU_ID,
        @TEN_NGUYEN_VAT_LIEU,
        @SO_LUONG_TON,
        @DON_VI_TINH,
        @GIA_NHAP,
        @GIA_BAN,
        @MO_TA,
        @URL_HINH_ANH
      );

      SELECT
        nvl.NGUYEN_VAT_LIEU_ID,
        nvl.TEN_NGUYEN_VAT_LIEU,
        nvl.SO_LUONG_TON,
        nvl.DON_VI_TINH,
        nvl.GIA_NHAP,
        nvl.GIA_BAN,
        nvl.MO_TA,
        nvl.URL_HINH_ANH,
        colors.TEN_MAU_SAC
      FROM NGUYEN_VAT_LIEU nvl
      OUTER APPLY (
        SELECT STRING_AGG(ms.TEN_MAU_SAC, N', ') AS TEN_MAU_SAC
        FROM MAU_SAC_NVL msn
        INNER JOIN MAU_SAC ms ON ms.MAU_SAC_ID = msn.MAU_SAC_ID
        WHERE msn.NGUYEN_VAT_LIEU_ID = nvl.NGUYEN_VAT_LIEU_ID
      ) colors
      WHERE nvl.NGUYEN_VAT_LIEU_ID = @NGUYEN_VAT_LIEU_ID;
    `);

    return res.status(201).json({
      message: 'Material created.',
      material: mapAdminMaterial(result.recordset[0], 0),
    });
  } catch (error: any) {
    console.error('Admin create material error:', error);
    return res.status(500).json({ message: 'Cannot create material: ' + error.message });
  }
};

export const updateAdminMaterial = async (req: Request, res: Response) => {
  try {
    const { materialId } = req.params;
    const { name, unit, quantity, importPrice, sellPrice, description, image } = req.body;

    if (!materialId || !name || !unit) {
      return res.status(400).json({ message: 'Missing material fields.' });
    }

    const request = new sql.Request();
    request.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(20), materialId);
    request.input('TEN_NGUYEN_VAT_LIEU', sql.NVarChar(200), String(name).trim());
    request.input('SO_LUONG_TON', sql.Int, Number(quantity || 0));
    request.input('DON_VI_TINH', sql.NVarChar(50), String(unit).trim());
    request.input('GIA_NHAP', sql.BigInt, Number(importPrice || 0));
    request.input('GIA_BAN', sql.BigInt, Number(sellPrice || 0));
    request.input('MO_TA', sql.NVarChar(500), description ? String(description).trim() : null);
    request.input('URL_HINH_ANH', sql.NVarChar(1000), image ? String(image).trim() : null);

    const result = await request.query(`
      UPDATE NGUYEN_VAT_LIEU
      SET
        TEN_NGUYEN_VAT_LIEU = @TEN_NGUYEN_VAT_LIEU,
        SO_LUONG_TON = @SO_LUONG_TON,
        DON_VI_TINH = @DON_VI_TINH,
        GIA_NHAP = @GIA_NHAP,
        GIA_BAN = @GIA_BAN,
        MO_TA = @MO_TA,
        URL_HINH_ANH = @URL_HINH_ANH
      WHERE NGUYEN_VAT_LIEU_ID = @NGUYEN_VAT_LIEU_ID;

      SELECT
        nvl.NGUYEN_VAT_LIEU_ID,
        nvl.TEN_NGUYEN_VAT_LIEU,
        nvl.SO_LUONG_TON,
        nvl.DON_VI_TINH,
        nvl.GIA_NHAP,
        nvl.GIA_BAN,
        nvl.MO_TA,
        nvl.URL_HINH_ANH,
        colors.TEN_MAU_SAC
      FROM NGUYEN_VAT_LIEU nvl
      OUTER APPLY (
        SELECT STRING_AGG(ms.TEN_MAU_SAC, N', ') AS TEN_MAU_SAC
        FROM MAU_SAC_NVL msn
        INNER JOIN MAU_SAC ms ON ms.MAU_SAC_ID = msn.MAU_SAC_ID
        WHERE msn.NGUYEN_VAT_LIEU_ID = nvl.NGUYEN_VAT_LIEU_ID
      ) colors
      WHERE nvl.NGUYEN_VAT_LIEU_ID = @NGUYEN_VAT_LIEU_ID;
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Material not found.' });
    }

    return res.status(200).json({
      message: 'Material updated.',
      material: mapAdminMaterial(result.recordset[0], 0),
    });
  } catch (error: any) {
    console.error('Admin update material error:', error);
    return res.status(500).json({ message: 'Cannot update material: ' + error.message });
  }
};

export const uploadAdminMaterialImage = (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Missing image file.' });
    }

    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/materials/${req.file.filename}`;

    return res.status(200).json({
      message: 'Material image uploaded.',
      imageUrl,
    });
  } catch (error: any) {
    console.error('Admin upload material image error:', error);
    return res.status(500).json({ message: 'Cannot upload material image: ' + error.message });
  }
};

export const deleteAdminMaterial = async (req: Request, res: Response) => {
  try {
    const { materialId } = req.params;
    const request = new sql.Request();
    request.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(20), materialId);

    await request.query(`
      DELETE FROM NGUYEN_VAT_LIEU
      WHERE NGUYEN_VAT_LIEU_ID = @NGUYEN_VAT_LIEU_ID
    `);

    return res.status(200).json({ message: 'Material deleted.' });
  } catch (error: any) {
    console.error('Admin delete material error:', error);
    return res.status(500).json({ message: 'Cannot delete material: ' + error.message });
  }
};

const mapAdminSupplier = (row: any, index: number) => ({
  id: index + 1,
  code: row.NHA_CUNG_CAP_ID,
  name: row.TEN_NHA_CUNG_CAP || '',
  representative: row.NGUOI_DAI_DIEN || '',
  phone: row.SDT || '',
  email: row.EMAIL || '',
  address: row.DIA_CHI || '',
  taxCode: row.MA_SO_THUE || '',
  status: row.TRANG_THAI || 'Đang hợp tác',
  selected: false,
  image: '',
});

export const getAdminSuppliers = async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const normalizedStatus = rawStatus
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const status = rawStatus && normalizedStatus !== 'tat ca' && normalizedStatus !== 'all'
      ? rawStatus
      : '';

    const request = new sql.Request();
    const whereClauses: string[] = [];

    if (search) {
      request.input('Search', sql.NVarChar(200), `%${search}%`);
      whereClauses.push(`(
        NHA_CUNG_CAP_ID LIKE @Search OR
        TEN_NHA_CUNG_CAP LIKE @Search OR
        NGUOI_DAI_DIEN LIKE @Search OR
        SDT LIKE @Search OR
        EMAIL LIKE @Search OR
        DIA_CHI LIKE @Search OR
        MA_SO_THUE LIKE @Search OR
        TRANG_THAI LIKE @Search
      )`);
    }

    if (status) {
      request.input('Status', sql.NVarChar(50), status);
      whereClauses.push('TRANG_THAI = @Status');
    }

    const result = await request.query(`
      SELECT
        NHA_CUNG_CAP_ID,
        TEN_NHA_CUNG_CAP,
        NGUOI_DAI_DIEN,
        SDT,
        EMAIL,
        DIA_CHI,
        MA_SO_THUE,
        TRANG_THAI
      FROM NHA_CUNG_CAP
      ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
      ORDER BY
        TRY_CONVERT(INT, SUBSTRING(NHA_CUNG_CAP_ID, 4, 20)) ASC,
        NHA_CUNG_CAP_ID ASC
    `);

    const suppliers = result.recordset.map(mapAdminSupplier);
    return res.status(200).json({ total: suppliers.length, suppliers });
  } catch (error: any) {
    console.error('Admin suppliers error:', error);
    return res.status(500).json({ message: 'Cannot load suppliers: ' + error.message });
  }
};

export const createAdminSupplier = async (req: Request, res: Response) => {
  try {
    const { name, representative, phone, email, address, taxCode, status } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Missing supplier name.' });
    }

    const supplierId = await getNextPrefixedId('NHA_CUNG_CAP', 'NHA_CUNG_CAP_ID', 'NCC', 4);
    const request = new sql.Request();
    request.input('NHA_CUNG_CAP_ID', sql.NVarChar(10), supplierId);
    request.input('TEN_NHA_CUNG_CAP', sql.NVarChar(200), String(name).trim());
    request.input('NGUOI_DAI_DIEN', sql.NVarChar(100), representative ? String(representative).trim() : null);
    request.input('SDT', sql.NVarChar(20), phone ? String(phone).trim() : null);
    request.input('EMAIL', sql.NVarChar(100), email ? String(email).trim() : null);
    request.input('DIA_CHI', sql.NVarChar(255), address ? String(address).trim() : null);
    request.input('MA_SO_THUE', sql.NVarChar(20), taxCode ? String(taxCode).trim() : null);
    request.input('TRANG_THAI', sql.NVarChar(50), status ? String(status).trim() : 'Đang hợp tác');

    const result = await request.query(`
      INSERT INTO NHA_CUNG_CAP (
        NHA_CUNG_CAP_ID,
        TEN_NHA_CUNG_CAP,
        NGUOI_DAI_DIEN,
        SDT,
        EMAIL,
        DIA_CHI,
        MA_SO_THUE,
        TRANG_THAI
      )
      VALUES (
        @NHA_CUNG_CAP_ID,
        @TEN_NHA_CUNG_CAP,
        @NGUOI_DAI_DIEN,
        @SDT,
        @EMAIL,
        @DIA_CHI,
        @MA_SO_THUE,
        @TRANG_THAI
      );

      SELECT *
      FROM NHA_CUNG_CAP
      WHERE NHA_CUNG_CAP_ID = @NHA_CUNG_CAP_ID;
    `);

    return res.status(201).json({
      message: 'Supplier created.',
      supplier: mapAdminSupplier(result.recordset[0], 0),
    });
  } catch (error: any) {
    console.error('Admin create supplier error:', error);
    return res.status(500).json({ message: 'Cannot create supplier: ' + error.message });
  }
};

export const updateAdminSupplier = async (req: Request, res: Response) => {
  try {
    const { supplierId } = req.params;
    const { name, representative, phone, email, address, taxCode, status } = req.body;
    if (!supplierId || !name) {
      return res.status(400).json({ message: 'Missing supplier fields.' });
    }

    const request = new sql.Request();
    request.input('NHA_CUNG_CAP_ID', sql.NVarChar(10), supplierId);
    request.input('TEN_NHA_CUNG_CAP', sql.NVarChar(200), String(name).trim());
    request.input('NGUOI_DAI_DIEN', sql.NVarChar(100), representative ? String(representative).trim() : null);
    request.input('SDT', sql.NVarChar(20), phone ? String(phone).trim() : null);
    request.input('EMAIL', sql.NVarChar(100), email ? String(email).trim() : null);
    request.input('DIA_CHI', sql.NVarChar(255), address ? String(address).trim() : null);
    request.input('MA_SO_THUE', sql.NVarChar(20), taxCode ? String(taxCode).trim() : null);
    request.input('TRANG_THAI', sql.NVarChar(50), status ? String(status).trim() : 'Đang hợp tác');

    const result = await request.query(`
      UPDATE NHA_CUNG_CAP
      SET
        TEN_NHA_CUNG_CAP = @TEN_NHA_CUNG_CAP,
        NGUOI_DAI_DIEN = @NGUOI_DAI_DIEN,
        SDT = @SDT,
        EMAIL = @EMAIL,
        DIA_CHI = @DIA_CHI,
        MA_SO_THUE = @MA_SO_THUE,
        TRANG_THAI = @TRANG_THAI
      WHERE NHA_CUNG_CAP_ID = @NHA_CUNG_CAP_ID;

      SELECT *
      FROM NHA_CUNG_CAP
      WHERE NHA_CUNG_CAP_ID = @NHA_CUNG_CAP_ID;
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Supplier not found.' });
    }

    return res.status(200).json({
      message: 'Supplier updated.',
      supplier: mapAdminSupplier(result.recordset[0], 0),
    });
  } catch (error: any) {
    console.error('Admin update supplier error:', error);
    return res.status(500).json({ message: 'Cannot update supplier: ' + error.message });
  }
};

export const deleteAdminSupplier = async (req: Request, res: Response) => {
  try {
    const { supplierId } = req.params;
    const request = new sql.Request();
    request.input('NHA_CUNG_CAP_ID', sql.NVarChar(10), supplierId);
    await request.query('DELETE FROM NHA_CUNG_CAP WHERE NHA_CUNG_CAP_ID = @NHA_CUNG_CAP_ID');
    return res.status(200).json({ message: 'Supplier deleted.' });
  } catch (error: any) {
    console.error('Admin delete supplier error:', error);
    return res.status(500).json({ message: 'Cannot delete supplier: ' + error.message });
  }
};

const mapImportReceipts = (headers: any[], details: any[]) => {
  const detailsByReceipt = new Map<string, any[]>();
  details.forEach((row, index) => {
    const receiptDetails = detailsByReceipt.get(row.PHIEU_NHAP_ID) || [];
    receiptDetails.push({
      id: index + 1,
      materialCode: row.NGUYEN_VAT_LIEU_ID,
      materialName: row.TEN_NGUYEN_VAT_LIEU || row.NGUYEN_VAT_LIEU_ID,
      image: 'assets/images/hoahong.png',
      quantity: Number(row.SO_LUONG_NHAP || 0),
      unitPrice: Number(row.DON_GIA_NHAP || 0),
    });
    detailsByReceipt.set(row.PHIEU_NHAP_ID, receiptDetails);
  });

  return headers.map((row, index) => ({
    id: index + 1,
    code: row.PHIEU_NHAP_ID,
    supplier: row.NHA_CUNG_CAP_ID || '',
    supplierName: row.TEN_NHA_CUNG_CAP || row.NHA_CUNG_CAP_ID || '',
    importDate: row.NGAY_NHAP ? new Date(row.NGAY_NHAP).toISOString() : '',
    totalAmount: Number(row.TONG_TIEN || 0),
    selected: false,
    note: row.GHI_CHU || '',
    details: detailsByReceipt.get(row.PHIEU_NHAP_ID) || [],
  }));
};

export const getAdminImports = async (_req: Request, res: Response) => {
  try {
    const [headersResult, detailsResult] = await Promise.all([
      sql.query(`
        SELECT
          pn.PHIEU_NHAP_ID,
          pn.NHA_CUNG_CAP_ID,
          ncc.TEN_NHA_CUNG_CAP,
          pn.NHAN_VIEN_ID,
          pn.NGAY_NHAP,
          pn.TONG_TIEN,
          pn.GHI_CHU
        FROM PHIEU_NHAP_NVL pn
        LEFT JOIN NHA_CUNG_CAP ncc ON ncc.NHA_CUNG_CAP_ID = pn.NHA_CUNG_CAP_ID
        ORDER BY pn.NGAY_NHAP DESC, pn.PHIEU_NHAP_ID DESC
      `),
      sql.query(`
        SELECT
          ct.PHIEU_NHAP_ID,
          ct.NGUYEN_VAT_LIEU_ID,
          nvl.TEN_NGUYEN_VAT_LIEU,
          ct.SO_LUONG_NHAP,
          ct.DON_GIA_NHAP,
          ct.THANH_TIEN
        FROM CHI_TIET_PHIEU_NHAP_NVL ct
        LEFT JOIN NGUYEN_VAT_LIEU nvl ON nvl.NGUYEN_VAT_LIEU_ID = ct.NGUYEN_VAT_LIEU_ID
        ORDER BY ct.PHIEU_NHAP_ID DESC, ct.NGUYEN_VAT_LIEU_ID ASC
      `),
    ]);

    const imports = mapImportReceipts(headersResult.recordset, detailsResult.recordset);
    return res.status(200).json({ total: imports.length, imports });
  } catch (error: any) {
    console.error('Admin imports error:', error);
    return res.status(500).json({ message: 'Cannot load import receipts: ' + error.message });
  }
};

const getFirstEmployeeId = async (): Promise<string | null> => {
  const result = await sql.query('SELECT TOP 1 NHAN_VIEN_ID FROM NHAN_VIEN ORDER BY NHAN_VIEN_ID ASC');
  return result.recordset[0]?.NHAN_VIEN_ID || null;
};

const normalizeImportDetails = (details: any[]) => {
  return (Array.isArray(details) ? details : [])
    .map((detail) => ({
      materialCode: String(detail.materialCode || '').trim(),
      quantity: Number(detail.quantity || 0),
      unitPrice: Number(detail.unitPrice || 0),
    }))
    .filter((detail) => detail.materialCode && detail.quantity > 0);
};

export const createAdminImport = async (req: Request, res: Response) => {
  const tx = new sql.Transaction();
  try {
    const { supplier, importDate, note } = req.body;
    const details = normalizeImportDetails(req.body.details);
    if (details.length === 0) {
      return res.status(400).json({ message: 'Import receipt requires at least one material.' });
    }

    const receiptId = await getNextPrefixedId('PHIEU_NHAP_NVL', 'PHIEU_NHAP_ID', 'PN', 6);
    const employeeId = await getFirstEmployeeId();
    const totalAmount = details.reduce((sum, detail) => sum + detail.quantity * detail.unitPrice, 0);

    await tx.begin();
    const headerRequest = new sql.Request(tx);
    headerRequest.input('PHIEU_NHAP_ID', sql.NVarChar(10), receiptId);
    headerRequest.input('NHA_CUNG_CAP_ID', sql.NVarChar(10), supplier || null);
    headerRequest.input('NHAN_VIEN_ID', sql.NVarChar(10), employeeId);
    headerRequest.input('NGAY_NHAP', sql.DateTime, importDate ? new Date(importDate) : new Date());
    headerRequest.input('TONG_TIEN', sql.BigInt, totalAmount);
    headerRequest.input('GHI_CHU', sql.NVarChar(500), note ? String(note).trim() : null);
    await headerRequest.query(`
      INSERT INTO PHIEU_NHAP_NVL (PHIEU_NHAP_ID, NHA_CUNG_CAP_ID, NHAN_VIEN_ID, NGAY_NHAP, TONG_TIEN, GHI_CHU)
      VALUES (@PHIEU_NHAP_ID, @NHA_CUNG_CAP_ID, @NHAN_VIEN_ID, @NGAY_NHAP, @TONG_TIEN, @GHI_CHU)
    `);

    for (const detail of details) {
      const detailRequest = new sql.Request(tx);
      detailRequest.input('PHIEU_NHAP_ID', sql.NVarChar(10), receiptId);
      detailRequest.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(10), detail.materialCode);
      detailRequest.input('SO_LUONG_NHAP', sql.Int, detail.quantity);
      detailRequest.input('DON_GIA_NHAP', sql.BigInt, detail.unitPrice);
      detailRequest.input('THANH_TIEN', sql.BigInt, detail.quantity * detail.unitPrice);
      await detailRequest.query(`
        INSERT INTO CHI_TIET_PHIEU_NHAP_NVL (
          PHIEU_NHAP_ID,
          NGUYEN_VAT_LIEU_ID,
          SO_LUONG_NHAP,
          DON_GIA_NHAP,
          THANH_TIEN
        )
        VALUES (
          @PHIEU_NHAP_ID,
          @NGUYEN_VAT_LIEU_ID,
          @SO_LUONG_NHAP,
          @DON_GIA_NHAP,
          @THANH_TIEN
        );

        UPDATE NGUYEN_VAT_LIEU
        SET
          SO_LUONG_TON = ISNULL(SO_LUONG_TON, 0) + @SO_LUONG_NHAP,
          GIA_NHAP = @DON_GIA_NHAP
        WHERE NGUYEN_VAT_LIEU_ID = @NGUYEN_VAT_LIEU_ID;
      `);
    }

    await tx.commit();
    return res.status(201).json({ message: 'Import receipt created.', code: receiptId });
  } catch (error: any) {
    if ((tx as any)._aborted !== true) {
      try { await tx.rollback(); } catch {}
    }
    console.error('Admin create import error:', error);
    return res.status(500).json({ message: 'Cannot create import receipt: ' + error.message });
  }
};

export const updateAdminImport = async (req: Request, res: Response) => {
  const tx = new sql.Transaction();
  try {
    const { receiptId } = req.params;
    const { supplier, importDate, note } = req.body;
    const details = normalizeImportDetails(req.body.details);
    if (details.length === 0) {
      return res.status(400).json({ message: 'Import receipt requires at least one material.' });
    }

    const totalAmount = details.reduce((sum, detail) => sum + detail.quantity * detail.unitPrice, 0);
    await tx.begin();

    const oldDetailsRequest = new sql.Request(tx);
    oldDetailsRequest.input('PHIEU_NHAP_ID', sql.NVarChar(10), receiptId);
    const oldDetailsResult = await oldDetailsRequest.query(`
      SELECT NGUYEN_VAT_LIEU_ID, SO_LUONG_NHAP
      FROM CHI_TIET_PHIEU_NHAP_NVL
      WHERE PHIEU_NHAP_ID = @PHIEU_NHAP_ID
    `);

    for (const detail of oldDetailsResult.recordset) {
      const stockRequest = new sql.Request(tx);
      stockRequest.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(10), detail.NGUYEN_VAT_LIEU_ID);
      stockRequest.input('SO_LUONG_NHAP', sql.Int, Number(detail.SO_LUONG_NHAP || 0));
      await stockRequest.query(`
        UPDATE NGUYEN_VAT_LIEU
        SET SO_LUONG_TON = CASE
          WHEN ISNULL(SO_LUONG_TON, 0) - @SO_LUONG_NHAP < 0 THEN 0
          ELSE ISNULL(SO_LUONG_TON, 0) - @SO_LUONG_NHAP
        END
        WHERE NGUYEN_VAT_LIEU_ID = @NGUYEN_VAT_LIEU_ID
      `);
    }

    const headerRequest = new sql.Request(tx);
    headerRequest.input('PHIEU_NHAP_ID', sql.NVarChar(10), receiptId);
    headerRequest.input('NHA_CUNG_CAP_ID', sql.NVarChar(10), supplier || null);
    headerRequest.input('NGAY_NHAP', sql.DateTime, importDate ? new Date(importDate) : new Date());
    headerRequest.input('TONG_TIEN', sql.BigInt, totalAmount);
    headerRequest.input('GHI_CHU', sql.NVarChar(500), note ? String(note).trim() : null);
    await headerRequest.query(`
      UPDATE PHIEU_NHAP_NVL
      SET
        NHA_CUNG_CAP_ID = @NHA_CUNG_CAP_ID,
        NGAY_NHAP = @NGAY_NHAP,
        TONG_TIEN = @TONG_TIEN,
        GHI_CHU = @GHI_CHU
      WHERE PHIEU_NHAP_ID = @PHIEU_NHAP_ID;

      DELETE FROM CHI_TIET_PHIEU_NHAP_NVL
      WHERE PHIEU_NHAP_ID = @PHIEU_NHAP_ID;
    `);

    for (const detail of details) {
      const detailRequest = new sql.Request(tx);
      detailRequest.input('PHIEU_NHAP_ID', sql.NVarChar(10), receiptId);
      detailRequest.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(10), detail.materialCode);
      detailRequest.input('SO_LUONG_NHAP', sql.Int, detail.quantity);
      detailRequest.input('DON_GIA_NHAP', sql.BigInt, detail.unitPrice);
      detailRequest.input('THANH_TIEN', sql.BigInt, detail.quantity * detail.unitPrice);
      await detailRequest.query(`
        INSERT INTO CHI_TIET_PHIEU_NHAP_NVL (
          PHIEU_NHAP_ID,
          NGUYEN_VAT_LIEU_ID,
          SO_LUONG_NHAP,
          DON_GIA_NHAP,
          THANH_TIEN
        )
        VALUES (
          @PHIEU_NHAP_ID,
          @NGUYEN_VAT_LIEU_ID,
          @SO_LUONG_NHAP,
          @DON_GIA_NHAP,
          @THANH_TIEN
        );

        UPDATE NGUYEN_VAT_LIEU
        SET
          SO_LUONG_TON = ISNULL(SO_LUONG_TON, 0) + @SO_LUONG_NHAP,
          GIA_NHAP = @DON_GIA_NHAP
        WHERE NGUYEN_VAT_LIEU_ID = @NGUYEN_VAT_LIEU_ID;
      `);
    }

    await tx.commit();
    return res.status(200).json({ message: 'Import receipt updated.' });
  } catch (error: any) {
    if ((tx as any)._aborted !== true) {
      try { await tx.rollback(); } catch {}
    }
    console.error('Admin update import error:', error);
    return res.status(500).json({ message: 'Cannot update import receipt: ' + error.message });
  }
};

export const deleteAdminImport = async (req: Request, res: Response) => {
  const tx = new sql.Transaction();
  try {
    const { receiptId } = req.params;
    await tx.begin();

    const detailsRequest = new sql.Request(tx);
    detailsRequest.input('PHIEU_NHAP_ID', sql.NVarChar(10), receiptId);
    const detailsResult = await detailsRequest.query(`
      SELECT NGUYEN_VAT_LIEU_ID, SO_LUONG_NHAP
      FROM CHI_TIET_PHIEU_NHAP_NVL
      WHERE PHIEU_NHAP_ID = @PHIEU_NHAP_ID
    `);

    for (const detail of detailsResult.recordset) {
      const stockRequest = new sql.Request(tx);
      stockRequest.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(10), detail.NGUYEN_VAT_LIEU_ID);
      stockRequest.input('SO_LUONG_NHAP', sql.Int, Number(detail.SO_LUONG_NHAP || 0));
      await stockRequest.query(`
        UPDATE NGUYEN_VAT_LIEU
        SET SO_LUONG_TON = CASE
          WHEN ISNULL(SO_LUONG_TON, 0) - @SO_LUONG_NHAP < 0 THEN 0
          ELSE ISNULL(SO_LUONG_TON, 0) - @SO_LUONG_NHAP
        END
        WHERE NGUYEN_VAT_LIEU_ID = @NGUYEN_VAT_LIEU_ID
      `);
    }

    const deleteRequest = new sql.Request(tx);
    deleteRequest.input('PHIEU_NHAP_ID', sql.NVarChar(10), receiptId);
    await deleteRequest.query(`
      DELETE FROM CHI_TIET_PHIEU_NHAP_NVL WHERE PHIEU_NHAP_ID = @PHIEU_NHAP_ID;
      DELETE FROM PHIEU_NHAP_NVL WHERE PHIEU_NHAP_ID = @PHIEU_NHAP_ID;
    `);

    await tx.commit();
    return res.status(200).json({ message: 'Import receipt deleted.' });
  } catch (error: any) {
    if ((tx as any)._aborted !== true) {
      try { await tx.rollback(); } catch {}
    }
    console.error('Admin delete import error:', error);
    return res.status(500).json({ message: 'Cannot delete import receipt: ' + error.message });
  }
};

const mapExportReceipts = (headers: any[], details: any[]) => {
  const detailsByReceipt = new Map<string, any[]>();
  details.forEach((row, index) => {
    const receiptDetails = detailsByReceipt.get(row.PHIEU_XUAT_ID) || [];
    receiptDetails.push({
      id: index + 1,
      materialCode: row.NGUYEN_VAT_LIEU_ID,
      materialName: row.TEN_NGUYEN_VAT_LIEU || row.NGUYEN_VAT_LIEU_ID,
      image: 'assets/images/hoahong.png',
      quantity: Number(row.SO_LUONG_XUAT || 0),
    });
    detailsByReceipt.set(row.PHIEU_XUAT_ID, receiptDetails);
  });

  return headers.map((row, index) => ({
    id: index + 1,
    code: row.PHIEU_XUAT_ID,
    staff: row.NHAN_VIEN_ID || '',
    staffName: row.HO_TEN || row.NHAN_VIEN_ID || '',
    exportDate: row.NGAY_XUAT ? new Date(row.NGAY_XUAT).toISOString() : '',
    selected: false,
    reason: row.LY_DO_XUAT || '',
    note: row.GHI_CHU || '',
    details: detailsByReceipt.get(row.PHIEU_XUAT_ID) || [],
  }));
};

const normalizeExportDetails = (details: any[]) => {
  return (Array.isArray(details) ? details : [])
    .map((detail) => ({
      materialCode: String(detail.materialCode || '').trim(),
      quantity: Number(detail.quantity || 0),
    }))
    .filter((detail) => detail.materialCode && detail.quantity > 0);
};

export const getAdminExports = async (_req: Request, res: Response) => {
  try {
    const [headersResult, detailsResult] = await Promise.all([
      sql.query(`
        SELECT
          px.PHIEU_XUAT_ID,
          px.NHAN_VIEN_ID,
          nv.HO_TEN,
          px.NGAY_XUAT,
          px.LY_DO_XUAT,
          px.GHI_CHU
        FROM PHIEU_XUAT_NVL px
        LEFT JOIN NHAN_VIEN nv ON nv.NHAN_VIEN_ID = px.NHAN_VIEN_ID
        ORDER BY px.NGAY_XUAT DESC, px.PHIEU_XUAT_ID DESC
      `),
      sql.query(`
        SELECT
          ct.PHIEU_XUAT_ID,
          ct.NGUYEN_VAT_LIEU_ID,
          nvl.TEN_NGUYEN_VAT_LIEU,
          ct.SO_LUONG_XUAT
        FROM CHI_TIET_PHIEU_XUAT_NVL ct
        LEFT JOIN NGUYEN_VAT_LIEU nvl ON nvl.NGUYEN_VAT_LIEU_ID = ct.NGUYEN_VAT_LIEU_ID
        ORDER BY ct.PHIEU_XUAT_ID DESC, ct.NGUYEN_VAT_LIEU_ID ASC
      `),
    ]);

    const exports = mapExportReceipts(headersResult.recordset, detailsResult.recordset);
    return res.status(200).json({ total: exports.length, exports });
  } catch (error: any) {
    console.error('Admin exports error:', error);
    return res.status(500).json({ message: 'Cannot load export receipts: ' + error.message });
  }
};

const subtractExportStock = async (tx: any, details: Array<{ materialCode: string; quantity: number }>) => {
  for (const detail of details) {
    const request = new sql.Request(tx);
    request.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(10), detail.materialCode);
    request.input('SO_LUONG_XUAT', sql.Int, detail.quantity);
    const stockResult = await request.query(`
      SELECT SO_LUONG_TON
      FROM NGUYEN_VAT_LIEU
      WHERE NGUYEN_VAT_LIEU_ID = @NGUYEN_VAT_LIEU_ID
    `);

    const stock = Number(stockResult.recordset[0]?.SO_LUONG_TON || 0);
    if (stock < detail.quantity) {
      throw new Error(`Not enough stock for ${detail.materialCode}.`);
    }

    const updateRequest = new sql.Request(tx);
    updateRequest.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(10), detail.materialCode);
    updateRequest.input('SO_LUONG_XUAT', sql.Int, detail.quantity);
    await updateRequest.query(`
      UPDATE NGUYEN_VAT_LIEU
      SET SO_LUONG_TON = ISNULL(SO_LUONG_TON, 0) - @SO_LUONG_XUAT
      WHERE NGUYEN_VAT_LIEU_ID = @NGUYEN_VAT_LIEU_ID
    `);
  }
};

export const createAdminExport = async (req: Request, res: Response) => {
  const tx = new sql.Transaction();
  try {
    const { staff, exportDate, reason, note } = req.body;
    const details = normalizeExportDetails(req.body.details);
    if (details.length === 0) {
      return res.status(400).json({ message: 'Export receipt requires at least one material.' });
    }

    const receiptId = await getNextPrefixedId('PHIEU_XUAT_NVL', 'PHIEU_XUAT_ID', 'PX', 6);
    const employeeId = staff || await getFirstEmployeeId();

    await tx.begin();
    await subtractExportStock(tx, details);

    const headerRequest = new sql.Request(tx);
    headerRequest.input('PHIEU_XUAT_ID', sql.NVarChar(10), receiptId);
    headerRequest.input('NHAN_VIEN_ID', sql.NVarChar(10), employeeId);
    headerRequest.input('NGAY_XUAT', sql.DateTime, exportDate ? new Date(exportDate) : new Date());
    headerRequest.input('LY_DO_XUAT', sql.NVarChar(255), reason ? String(reason).trim() : null);
    headerRequest.input('GHI_CHU', sql.NVarChar(500), note ? String(note).trim() : null);
    await headerRequest.query(`
      INSERT INTO PHIEU_XUAT_NVL (PHIEU_XUAT_ID, NHAN_VIEN_ID, NGAY_XUAT, LY_DO_XUAT, GHI_CHU)
      VALUES (@PHIEU_XUAT_ID, @NHAN_VIEN_ID, @NGAY_XUAT, @LY_DO_XUAT, @GHI_CHU)
    `);

    for (const detail of details) {
      const detailRequest = new sql.Request(tx);
      detailRequest.input('PHIEU_XUAT_ID', sql.NVarChar(10), receiptId);
      detailRequest.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(10), detail.materialCode);
      detailRequest.input('SO_LUONG_XUAT', sql.Int, detail.quantity);
      await detailRequest.query(`
        INSERT INTO CHI_TIET_PHIEU_XUAT_NVL (PHIEU_XUAT_ID, NGUYEN_VAT_LIEU_ID, SO_LUONG_XUAT)
        VALUES (@PHIEU_XUAT_ID, @NGUYEN_VAT_LIEU_ID, @SO_LUONG_XUAT)
      `);
    }

    await tx.commit();
    return res.status(201).json({ message: 'Export receipt created.', code: receiptId });
  } catch (error: any) {
    if ((tx as any)._aborted !== true) {
      try { await tx.rollback(); } catch {}
    }
    console.error('Admin create export error:', error);
    return res.status(500).json({ message: 'Cannot create export receipt: ' + error.message });
  }
};

export const updateAdminExport = async (req: Request, res: Response) => {
  const tx = new sql.Transaction();
  try {
    const { receiptId } = req.params;
    const { staff, exportDate, reason, note } = req.body;
    const details = normalizeExportDetails(req.body.details);
    if (details.length === 0) {
      return res.status(400).json({ message: 'Export receipt requires at least one material.' });
    }

    await tx.begin();

    const oldDetailsRequest = new sql.Request(tx);
    oldDetailsRequest.input('PHIEU_XUAT_ID', sql.NVarChar(10), receiptId);
    const oldDetailsResult = await oldDetailsRequest.query(`
      SELECT NGUYEN_VAT_LIEU_ID, SO_LUONG_XUAT
      FROM CHI_TIET_PHIEU_XUAT_NVL
      WHERE PHIEU_XUAT_ID = @PHIEU_XUAT_ID
    `);

    for (const detail of oldDetailsResult.recordset) {
      const stockRequest = new sql.Request(tx);
      stockRequest.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(10), detail.NGUYEN_VAT_LIEU_ID);
      stockRequest.input('SO_LUONG_XUAT', sql.Int, Number(detail.SO_LUONG_XUAT || 0));
      await stockRequest.query(`
        UPDATE NGUYEN_VAT_LIEU
        SET SO_LUONG_TON = ISNULL(SO_LUONG_TON, 0) + @SO_LUONG_XUAT
        WHERE NGUYEN_VAT_LIEU_ID = @NGUYEN_VAT_LIEU_ID
      `);
    }

    await subtractExportStock(tx, details);

    const headerRequest = new sql.Request(tx);
    headerRequest.input('PHIEU_XUAT_ID', sql.NVarChar(10), receiptId);
    headerRequest.input('NHAN_VIEN_ID', sql.NVarChar(10), staff || await getFirstEmployeeId());
    headerRequest.input('NGAY_XUAT', sql.DateTime, exportDate ? new Date(exportDate) : new Date());
    headerRequest.input('LY_DO_XUAT', sql.NVarChar(255), reason ? String(reason).trim() : null);
    headerRequest.input('GHI_CHU', sql.NVarChar(500), note ? String(note).trim() : null);
    await headerRequest.query(`
      UPDATE PHIEU_XUAT_NVL
      SET
        NHAN_VIEN_ID = @NHAN_VIEN_ID,
        NGAY_XUAT = @NGAY_XUAT,
        LY_DO_XUAT = @LY_DO_XUAT,
        GHI_CHU = @GHI_CHU
      WHERE PHIEU_XUAT_ID = @PHIEU_XUAT_ID;

      DELETE FROM CHI_TIET_PHIEU_XUAT_NVL
      WHERE PHIEU_XUAT_ID = @PHIEU_XUAT_ID;
    `);

    for (const detail of details) {
      const detailRequest = new sql.Request(tx);
      detailRequest.input('PHIEU_XUAT_ID', sql.NVarChar(10), receiptId);
      detailRequest.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(10), detail.materialCode);
      detailRequest.input('SO_LUONG_XUAT', sql.Int, detail.quantity);
      await detailRequest.query(`
        INSERT INTO CHI_TIET_PHIEU_XUAT_NVL (PHIEU_XUAT_ID, NGUYEN_VAT_LIEU_ID, SO_LUONG_XUAT)
        VALUES (@PHIEU_XUAT_ID, @NGUYEN_VAT_LIEU_ID, @SO_LUONG_XUAT)
      `);
    }

    await tx.commit();
    return res.status(200).json({ message: 'Export receipt updated.' });
  } catch (error: any) {
    if ((tx as any)._aborted !== true) {
      try { await tx.rollback(); } catch {}
    }
    console.error('Admin update export error:', error);
    return res.status(500).json({ message: 'Cannot update export receipt: ' + error.message });
  }
};

export const deleteAdminExport = async (req: Request, res: Response) => {
  const tx = new sql.Transaction();
  try {
    const { receiptId } = req.params;
    await tx.begin();

    const detailsRequest = new sql.Request(tx);
    detailsRequest.input('PHIEU_XUAT_ID', sql.NVarChar(10), receiptId);
    const detailsResult = await detailsRequest.query(`
      SELECT NGUYEN_VAT_LIEU_ID, SO_LUONG_XUAT
      FROM CHI_TIET_PHIEU_XUAT_NVL
      WHERE PHIEU_XUAT_ID = @PHIEU_XUAT_ID
    `);

    for (const detail of detailsResult.recordset) {
      const stockRequest = new sql.Request(tx);
      stockRequest.input('NGUYEN_VAT_LIEU_ID', sql.NVarChar(10), detail.NGUYEN_VAT_LIEU_ID);
      stockRequest.input('SO_LUONG_XUAT', sql.Int, Number(detail.SO_LUONG_XUAT || 0));
      await stockRequest.query(`
        UPDATE NGUYEN_VAT_LIEU
        SET SO_LUONG_TON = ISNULL(SO_LUONG_TON, 0) + @SO_LUONG_XUAT
        WHERE NGUYEN_VAT_LIEU_ID = @NGUYEN_VAT_LIEU_ID
      `);
    }

    const deleteRequest = new sql.Request(tx);
    deleteRequest.input('PHIEU_XUAT_ID', sql.NVarChar(10), receiptId);
    await deleteRequest.query(`
      DELETE FROM CHI_TIET_PHIEU_XUAT_NVL WHERE PHIEU_XUAT_ID = @PHIEU_XUAT_ID;
      DELETE FROM PHIEU_XUAT_NVL WHERE PHIEU_XUAT_ID = @PHIEU_XUAT_ID;
    `);

    await tx.commit();
    return res.status(200).json({ message: 'Export receipt deleted.' });
  } catch (error: any) {
    if ((tx as any)._aborted !== true) {
      try { await tx.rollback(); } catch {}
    }
    console.error('Admin delete export error:', error);
    return res.status(500).json({ message: 'Cannot delete export receipt: ' + error.message });
  }
};

export const updateAdminOrderStatus = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { status, rejectReason } = req.body;

    if (!orderId || !status) {
      return res.status(400).json({ message: 'Thiáº¿u mÃ£ Ä‘Æ¡n hÃ ng hoáº·c tráº¡ng thÃ¡i.' });
    }

    const orderRequest = new sql.Request();
    orderRequest.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    const orderResult = await orderRequest.query(`
      SELECT TOP 1
        dh.DON_HANG_ID,
        dh.TRANG_THAI,
        dh.TIEN_COC,
        dh.TONG_TIEN,
        dh.GHI_CHU,
        dh.LY_DO_HOAN_TIEN_TRA_HANG,
        dh.LY_DO_TU_CHOI,
        tt.TRANG_THAI_THANH_TOAN,
        tt.SO_TIEN,
        paid.PAID_AMOUNT
      FROM DON_HANG dh
      OUTER APPLY (
        SELECT TOP 1
          t.TRANG_THAI_THANH_TOAN,
          t.SO_TIEN,
          t.THANH_TOAN_ID,
          t.NGAY_THANH_TOAN
        FROM THANH_TOAN t
        WHERE t.DON_HANG_ID = dh.DON_HANG_ID
        ORDER BY t.NGAY_THANH_TOAN DESC, t.THANH_TOAN_ID DESC
      ) tt
      OUTER APPLY (
        SELECT SUM(ISNULL(t.SO_TIEN, 0)) AS PAID_AMOUNT
        FROM THANH_TOAN t
        WHERE t.DON_HANG_ID = dh.DON_HANG_ID
      ) paid
      WHERE dh.DON_HANG_ID = @DON_HANG_ID;
    `);

    const order = orderResult.recordset[0];
    if (!order) {
      return res.status(404).json({ message: 'KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n hÃ ng.' });
    }

    const paymentStatus = normalizeLatestPaymentStatus(
      order.TRANG_THAI_THANH_TOAN,
      order.TIEN_COC,
      order.TONG_TIEN,
      order.PAID_AMOUNT || order.SO_TIEN,
    );

    if (!PAYMENT_STATUSES_ALLOWED_TO_UPDATE_ORDER.has(paymentStatus)) {
      return res.status(409).json({
        message: 'Chá»‰ Ä‘Æ¡n Ä‘Ã£ cá»c hoáº·c Ä‘Ã£ thanh toÃ¡n thÃ nh cÃ´ng má»›i Ä‘Æ°á»£c cáº­p nháº­t tráº¡ng thÃ¡i.',
        paymentStatus,
      });
    }

    const request = new sql.Request();
    request.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    request.input('TRANG_THAI', sql.NVarChar(50), String(status));
    request.input('REJECT_REASON', sql.NVarChar(500), rejectReason ? String(rejectReason).trim() : null);

    const result = await request.query(`
      UPDATE DON_HANG
      SET
        TRANG_THAI = @TRANG_THAI,
        LY_DO_TU_CHOI = CASE
          WHEN @REJECT_REASON IS NULL OR LTRIM(RTRIM(@REJECT_REASON)) = '' THEN LY_DO_TU_CHOI
          ELSE @REJECT_REASON
        END
      WHERE DON_HANG_ID = @DON_HANG_ID;

      SELECT DON_HANG_ID, TRANG_THAI, GHI_CHU, LY_DO_HOAN_TIEN_TRA_HANG, LY_DO_TU_CHOI
      FROM DON_HANG
      WHERE DON_HANG_ID = @DON_HANG_ID;
    `);

    if (normalizeOrderStatus(status) === 'Giao th\u00e0nh c\u00f4ng') {
      scheduleOrderCompletion(orderId);
    }

    return res.status(200).json({
      message: 'Cáº­p nháº­t tráº¡ng thÃ¡i Ä‘Æ¡n hÃ ng thÃ nh cÃ´ng.',
      order: result.recordset[0],
    });
  } catch (error: any) {
    console.error('Admin update order status error:', error);
    return res.status(500).json({ message: 'KhÃ´ng thá»ƒ cáº­p nháº­t tráº¡ng thÃ¡i Ä‘Æ¡n hÃ ng: ' + error.message });
  }
};

export const getAdminDashboard = async (_req: Request, res: Response) => {
  try {
    const [
      summaryResult,
      weekResult,
      recentOrdersResult,
      deliveryResult,
      bestProductsResult,
      warningMaterialsResult,
    ] = await Promise.all([
      sql.query(`
        SELECT
          COUNT(*) AS TOTAL_ORDERS,
          SUM(CASE WHEN TRANG_THAI IN (N'Chờ xử lý', N'Chờ thanh toán') THEN 1 ELSE 0 END) AS NEW_ORDERS,
          SUM(CASE WHEN TRANG_THAI IN (N'Hoàn thành', N'Đã giao') THEN 1 ELSE 0 END) AS COMPLETED_ORDERS,
          SUM(CASE WHEN TRANG_THAI = N'Đã hủy' THEN 1 ELSE 0 END) AS CANCELLED_ORDERS,
          SUM(ISNULL(TONG_TIEN, 0)) AS TOTAL_REVENUE,
          (SELECT COUNT(*) FROM KHACH_HANG WHERE NGAY_DANG_KY >= DATEADD(DAY, -6, CONVERT(date, GETDATE()))) AS NEW_CUSTOMERS,
          (SELECT SUM(ISNULL(SO_LUONG, 0)) FROM DON_HANG_CHI_TIET) AS PRODUCTS_SOLD,
          (SELECT COUNT(*) FROM NGUYEN_VAT_LIEU WHERE ISNULL(SO_LUONG_TON, 0) <= 10) AS WARNING_MATERIALS
        FROM DON_HANG
      `),
      sql.query(`
        SELECT
          CONVERT(date, NGAY_TAO) AS ORDER_DATE,
          COUNT(*) AS ORDER_COUNT,
          SUM(ISNULL(TONG_TIEN, 0)) AS REVENUE
        FROM DON_HANG
        WHERE NGAY_TAO >= DATEADD(DAY, -6, CONVERT(date, GETDATE()))
        GROUP BY CONVERT(date, NGAY_TAO)
        ORDER BY ORDER_DATE ASC
      `),
      sql.query(`
        WITH LatestOrders AS (
          SELECT TOP 10
            dh.DON_HANG_ID,
            dh.KHACH_HANG_ID,
            dh.NGAY_TAO,
            dh.TONG_TIEN,
            dh.TIEN_COC,
            dh.TRANG_THAI
          FROM DON_HANG dh
          ORDER BY dh.NGAY_TAO DESC, dh.DON_HANG_ID DESC
        ), LatestPayment AS (
          SELECT
            t.DON_HANG_ID,
            t.TRANG_THAI_THANH_TOAN,
            t.SO_TIEN,
            ROW_NUMBER() OVER (
              PARTITION BY t.DON_HANG_ID
              ORDER BY t.NGAY_THANH_TOAN DESC, t.THANH_TOAN_ID DESC
            ) AS RN
          FROM THANH_TOAN t
          INNER JOIN LatestOrders lo ON lo.DON_HANG_ID = t.DON_HANG_ID
        ), PaymentTotals AS (
          SELECT
            t.DON_HANG_ID,
            SUM(ISNULL(t.SO_TIEN, 0)) AS PAID_AMOUNT
          FROM THANH_TOAN t
          INNER JOIN LatestOrders lo ON lo.DON_HANG_ID = t.DON_HANG_ID
          GROUP BY t.DON_HANG_ID
        )
        SELECT
          lo.DON_HANG_ID,
          lo.KHACH_HANG_ID,
          lo.NGAY_TAO,
          lo.TONG_TIEN,
          lo.TIEN_COC,
          lo.TRANG_THAI,
          tt.TRANG_THAI_THANH_TOAN,
          tt.SO_TIEN,
          paid.PAID_AMOUNT
        FROM LatestOrders lo
        LEFT JOIN LatestPayment tt ON tt.DON_HANG_ID = lo.DON_HANG_ID AND tt.RN = 1
        LEFT JOIN PaymentTotals paid ON paid.DON_HANG_ID = lo.DON_HANG_ID
        ORDER BY lo.NGAY_TAO DESC, lo.DON_HANG_ID DESC
      `),
      sql.query(`
        SELECT TOP 10
          dh.DON_HANG_ID,
          dh.KHACH_HANG_ID,
          kh.TEN AS TEN_KHACH_HANG,
          dh.DIA_CHI_GIAO_HANG,
          dh.KHUNG_GIO_MUON_GIAO,
          dh.TONG_TIEN,
          SUM(ISNULL(ct.SO_LUONG, 0)) AS SO_LUONG
        FROM DON_HANG dh
        LEFT JOIN KHACH_HANG kh ON kh.KHACH_HANG_ID = dh.KHACH_HANG_ID
        LEFT JOIN DON_HANG_CHI_TIET ct ON ct.DON_HANG_ID = dh.DON_HANG_ID
        GROUP BY
          dh.DON_HANG_ID,
          dh.KHACH_HANG_ID,
          kh.TEN,
          dh.DIA_CHI_GIAO_HANG,
          dh.KHUNG_GIO_MUON_GIAO,
          dh.TONG_TIEN,
          dh.NGAY_TAO
        ORDER BY dh.NGAY_TAO DESC
      `),
      sql.query(`
        SELECT TOP 5
          sp.SAN_PHAM_ID,
          sp.TEN_SAN_PHAM,
          sp.GIA,
          sp.TRANG_THAI,
          ISNULL(SUM(ct.SO_LUONG), 0) AS TOTAL_ORDERS,
          img.URL AS HINH_ANH
        FROM SAN_PHAM sp
        LEFT JOIN DON_HANG_CHI_TIET ct ON ct.SAN_PHAM_ID = sp.SAN_PHAM_ID
        OUTER APPLY (
          SELECT TOP 1 URL
          FROM HINH_ANH_SAN_PHAM
          WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
          ORDER BY LA_ANH_CHINH DESC, HINH_ANH_ID ASC
        ) img
        GROUP BY sp.SAN_PHAM_ID, sp.TEN_SAN_PHAM, sp.GIA, sp.TRANG_THAI, img.URL
        ORDER BY TOTAL_ORDERS DESC, sp.TEN_SAN_PHAM ASC
      `),
      sql.query(`
        SELECT TOP 5
          NGUYEN_VAT_LIEU_ID,
          TEN_NGUYEN_VAT_LIEU,
          SO_LUONG_TON,
          DON_VI_TINH
        FROM NGUYEN_VAT_LIEU
        ORDER BY ISNULL(SO_LUONG_TON, 0) ASC
      `),
    ]);

    const summary = summaryResult.recordset[0] || {};
    const recentOrders = recentOrdersResult.recordset.map((row: any) => ({
      id: row.DON_HANG_ID,
      customer: row.KHACH_HANG_ID || '',
      date: formatDate(row.NGAY_TAO),
      total: `${Number(row.TONG_TIEN || 0).toLocaleString('vi-VN')}đ`,
      payment: normalizeLatestPaymentStatus(row.TRANG_THAI_THANH_TOAN, row.TIEN_COC, row.TONG_TIEN, row.PAID_AMOUNT || row.SO_TIEN),
      status: normalizeOrderStatus(row.TRANG_THAI),
    }));

    return res.status(200).json({
      summary: {
        totalOrders: Number(summary.TOTAL_ORDERS || 0),
        newOrders: Number(summary.NEW_ORDERS || 0),
        completedOrders: Number(summary.COMPLETED_ORDERS || 0),
        cancelledOrders: Number(summary.CANCELLED_ORDERS || 0),
        revenue: Number(summary.TOTAL_REVENUE || 0),
        newCustomers: Number(summary.NEW_CUSTOMERS || 0),
        productsSold: Number(summary.PRODUCTS_SOLD || 0),
        warningMaterials: Number(summary.WARNING_MATERIALS || 0),
      },
      chart: weekResult.recordset.map((row: any) => ({
        date: formatDate(row.ORDER_DATE),
        orders: Number(row.ORDER_COUNT || 0),
        revenue: Number(row.REVENUE || 0),
      })),
      orders: recentOrders,
      deliveries: deliveryResult.recordset.map((row: any) => ({
        time: row.KHUNG_GIO_MUON_GIAO || '',
        orderId: row.DON_HANG_ID,
        quantity: Number(row.SO_LUONG || 0).toString(),
        price: `${Number(row.TONG_TIEN || 0).toLocaleString('vi-VN')}đ`,
        customer: row.TEN_KHACH_HANG || row.KHACH_HANG_ID || 'Khách lẻ',
        address: row.DIA_CHI_GIAO_HANG || '',
      })),
      bestProducts: bestProductsResult.recordset.map((row: any) => ({
        image: row.HINH_ANH || 'assets/images/flower_default.png',
        name: row.TEN_SAN_PHAM,
        id: row.SAN_PHAM_ID,
        price: `${Number(row.GIA || 0).toLocaleString('vi-VN')}đ`,
        totalOrders: Number(row.TOTAL_ORDERS || 0),
        status: row.TRANG_THAI || '',
      })),
      warningMaterials: warningMaterialsResult.recordset.map((row: any) => ({
        image: 'assets/images/flower_default.png',
        name: row.TEN_NGUYEN_VAT_LIEU,
        id: row.NGUYEN_VAT_LIEU_ID,
        quantity: Number(row.SO_LUONG_TON || 0),
        unit: row.DON_VI_TINH || '',
      })),
    });
  } catch (error: any) {
    console.error('Admin dashboard error:', error);
    return res.status(500).json({ message: 'Không thể lấy dữ liệu dashboard: ' + error.message });
  }
};

const mapAdminCampaign = (row: any, index: number) => ({
  id: index + 1,
  code: row.CHIEN_DICH_ID,
  name: row.TEN_CHIEN_DICH || '',
  description: row.MO_TA || '',
  startDate: row.NGAY_BAT_DAU ? new Date(row.NGAY_BAT_DAU).toISOString() : '',
  endDate: row.NGAY_KET_THUC ? new Date(row.NGAY_KET_THUC).toISOString() : '',
  status: row.TRANG_THAI || '',
  selected: false,
});

const mapAdminVoucher = (row: any, index: number) => ({
  id: index + 1,
  code: row.VOUCHER_ID,
  voucherCode: row.MA_VOUCHER || '',
  campaignCode: row.CHIEN_DICH_ID || '',
  customerId: row.KHACH_HANG_ID || '',
  customerName: row.TEN_KHACH_HANG || '',
  discountType: row.LOAI_GIAM_GIA || '',
  discountValue: Number(row.GIA_TRI_GIAM || 0),
  startDate: row.NGAY_BAT_DAU ? new Date(row.NGAY_BAT_DAU).toISOString() : '',
  endDate: row.NGAY_KET_THUC ? new Date(row.NGAY_KET_THUC).toISOString() : '',
  used: Boolean(row.DA_DUNG),
  selected: false,
});

const parseOptionalDate = (value: unknown): Date | null => {
  if (!value) return null;

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeAdminDiscountType = (value: unknown): string | null => {
  const type = String(value || '').trim();
  if (!type) return null;

  const normalized = type
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized === 'tien') return 'Tiền mặt';
  if (normalized === 'phan tram') return 'Phần trăm';

  return type;
};

const normalizeVoucherCustomerIds = (customerIds: unknown, customerId?: unknown): string[] => {
  const rawValues = Array.isArray(customerIds)
    ? customerIds
    : customerIds
      ? [customerIds]
      : customerId
        ? [customerId]
        : [];

  return Array.from(new Set(
    rawValues
      .map((value) => String(value || '').replace(/^#/, '').trim())
      .filter(Boolean)
  ));
};

const buildPrefixedId = (prefix: string, width: number, value: number): string => {
  return `${prefix}${value.toString().padStart(width, '0')}`;
};

export const getAdminCampaigns = async (_req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      SELECT
        CHIEN_DICH_ID,
        TEN_CHIEN_DICH,
        MO_TA,
        NGAY_BAT_DAU,
        NGAY_KET_THUC,
        TRANG_THAI
      FROM CHIEN_DICH
      ORDER BY NGAY_BAT_DAU DESC, CHIEN_DICH_ID DESC
    `);

    const campaigns = result.recordset.map(mapAdminCampaign);
    return res.status(200).json({ total: campaigns.length, campaigns });
  } catch (error: any) {
    console.error('Admin campaigns error:', error);
    return res.status(500).json({ message: 'Cannot load campaigns: ' + error.message });
  }
};

export const createAdminCampaign = async (req: Request, res: Response) => {
  try {
    const { name, description, startDate, endDate, status } = req.body;

    if (!String(name || '').trim()) {
      return res.status(400).json({ message: 'Campaign name is required.' });
    }

    const campaignId = await getNextPrefixedId('CHIEN_DICH', 'CHIEN_DICH_ID', 'CD', 3);
    const request = new sql.Request();
    request.input('CHIEN_DICH_ID', sql.NVarChar(10), campaignId);
    request.input('TEN_CHIEN_DICH', sql.NVarChar(200), String(name).trim());
    request.input('MO_TA', sql.NVarChar(500), description ? String(description).trim() : null);
    request.input('NGAY_BAT_DAU', sql.Date, parseOptionalDate(startDate));
    request.input('NGAY_KET_THUC', sql.Date, parseOptionalDate(endDate));
    request.input('TRANG_THAI', sql.NVarChar(50), status ? String(status).trim() : null);

    const result = await request.query(`
      INSERT INTO CHIEN_DICH (
        CHIEN_DICH_ID,
        TEN_CHIEN_DICH,
        MO_TA,
        NGAY_BAT_DAU,
        NGAY_KET_THUC,
        TRANG_THAI
      )
      VALUES (
        @CHIEN_DICH_ID,
        @TEN_CHIEN_DICH,
        @MO_TA,
        @NGAY_BAT_DAU,
        @NGAY_KET_THUC,
        @TRANG_THAI
      );

      SELECT
        CHIEN_DICH_ID,
        TEN_CHIEN_DICH,
        MO_TA,
        NGAY_BAT_DAU,
        NGAY_KET_THUC,
        TRANG_THAI
      FROM CHIEN_DICH
      WHERE CHIEN_DICH_ID = @CHIEN_DICH_ID;
    `);

    return res.status(201).json({
      message: 'Campaign created.',
      campaign: mapAdminCampaign(result.recordset[0], 0),
    });
  } catch (error: any) {
    console.error('Admin create campaign error:', error);
    return res.status(500).json({ message: 'Cannot create campaign: ' + error.message });
  }
};

export const updateAdminCampaign = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { name, description, startDate, endDate, status } = req.body;

    if (!campaignId || !String(name || '').trim()) {
      return res.status(400).json({ message: 'Campaign fields are missing.' });
    }

    const request = new sql.Request();
    request.input('CHIEN_DICH_ID', sql.NVarChar(10), campaignId);
    request.input('TEN_CHIEN_DICH', sql.NVarChar(200), String(name).trim());
    request.input('MO_TA', sql.NVarChar(500), description ? String(description).trim() : null);
    request.input('NGAY_BAT_DAU', sql.Date, parseOptionalDate(startDate));
    request.input('NGAY_KET_THUC', sql.Date, parseOptionalDate(endDate));
    request.input('TRANG_THAI', sql.NVarChar(50), status ? String(status).trim() : null);

    const result = await request.query(`
      UPDATE CHIEN_DICH
      SET
        TEN_CHIEN_DICH = @TEN_CHIEN_DICH,
        MO_TA = @MO_TA,
        NGAY_BAT_DAU = @NGAY_BAT_DAU,
        NGAY_KET_THUC = @NGAY_KET_THUC,
        TRANG_THAI = @TRANG_THAI
      WHERE CHIEN_DICH_ID = @CHIEN_DICH_ID;

      SELECT
        CHIEN_DICH_ID,
        TEN_CHIEN_DICH,
        MO_TA,
        NGAY_BAT_DAU,
        NGAY_KET_THUC,
        TRANG_THAI
      FROM CHIEN_DICH
      WHERE CHIEN_DICH_ID = @CHIEN_DICH_ID;
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    return res.status(200).json({
      message: 'Campaign updated.',
      campaign: mapAdminCampaign(result.recordset[0], 0),
    });
  } catch (error: any) {
    console.error('Admin update campaign error:', error);
    return res.status(500).json({ message: 'Cannot update campaign: ' + error.message });
  }
};

export const deleteAdminCampaign = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const request = new sql.Request();
    request.input('CHIEN_DICH_ID', sql.NVarChar(10), campaignId);

    const result = await request.query(`
      DELETE FROM CHIEN_DICH
      WHERE CHIEN_DICH_ID = @CHIEN_DICH_ID
    `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    return res.status(200).json({ message: 'Campaign deleted.' });
  } catch (error: any) {
    console.error('Admin delete campaign error:', error);
    return res.status(500).json({ message: 'Cannot delete campaign: ' + error.message });
  }
};

export const getAdminVouchers = async (_req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      SELECT
        v.VOUCHER_ID,
        v.CHIEN_DICH_ID,
        v.KHACH_HANG_ID,
        kh.TEN AS TEN_KHACH_HANG,
        v.MA_VOUCHER,
        v.LOAI_GIAM_GIA,
        v.GIA_TRI_GIAM,
        v.NGAY_BAT_DAU,
        v.NGAY_KET_THUC,
        v.DA_DUNG
      FROM VOUCHER v
      LEFT JOIN KHACH_HANG kh ON kh.KHACH_HANG_ID = v.KHACH_HANG_ID
      ORDER BY v.NGAY_BAT_DAU DESC, v.VOUCHER_ID DESC
    `);

    const vouchers = result.recordset.map(mapAdminVoucher);
    return res.status(200).json({ total: vouchers.length, vouchers });
  } catch (error: any) {
    console.error('Admin vouchers error:', error);
    return res.status(500).json({ message: 'Cannot load vouchers: ' + error.message });
  }
};

export const createAdminVoucher = async (req: Request, res: Response) => {
  const tx = new sql.Transaction();
  try {
    const { voucherCode, campaignCode, customerIds, customerId, discountType, discountValue, startDate, endDate } = req.body;

    if (!String(voucherCode || '').trim()) {
      return res.status(400).json({ message: 'Voucher code is required.' });
    }

    const parsedStartDate = parseOptionalDate(startDate);
    const parsedEndDate = parseOptionalDate(endDate);
    const parsedDiscountValue = Number(discountValue || 0);

    if (!parsedStartDate || !parsedEndDate) {
      return res.status(400).json({ message: 'Voucher dates are required.' });
    }

    if (parsedEndDate < parsedStartDate) {
      return res.status(400).json({ message: 'Voucher end date must be after start date.' });
    }

    if (!Number.isFinite(parsedDiscountValue) || parsedDiscountValue < 0) {
      return res.status(400).json({ message: 'Voucher discount value is invalid.' });
    }

    const selectedCustomerIds = normalizeVoucherCustomerIds(customerIds, customerId);
    const voucherTargets: Array<string | null> = selectedCustomerIds.length > 0 ? selectedCustomerIds : [null];
    const firstVoucherId = await getNextPrefixedId('VOUCHER', 'VOUCHER_ID', 'VC', 5);
    const firstVoucherNumber = Number(firstVoucherId.replace(/^VC/i, '')) || 1;
    const employeeId = await getFirstEmployeeId();
    const normalizedDiscountType = normalizeAdminDiscountType(discountType);
    const createdVoucherIds: string[] = [];

    await tx.begin();

    for (const [index, targetCustomerId] of voucherTargets.entries()) {
      const voucherId = buildPrefixedId('VC', 5, firstVoucherNumber + index);
      createdVoucherIds.push(voucherId);

      const request = new sql.Request(tx);
      request.input('VOUCHER_ID', sql.NVarChar(10), voucherId);
      request.input('NHAN_VIEN_ID', sql.NVarChar(10), employeeId);
      request.input('CHIEN_DICH_ID', sql.NVarChar(10), campaignCode ? String(campaignCode).trim() : null);
      request.input('KHACH_HANG_ID', sql.NVarChar(20), targetCustomerId);
      request.input('MA_VOUCHER', sql.NVarChar(50), String(voucherCode).trim());
      request.input('LOAI_GIAM_GIA', sql.NVarChar(50), normalizedDiscountType);
      request.input('GIA_TRI_GIAM', sql.Decimal(15, 2), parsedDiscountValue);
      request.input('NGAY_BAT_DAU', sql.Date, parsedStartDate);
      request.input('NGAY_KET_THUC', sql.Date, parsedEndDate);
      request.input('DA_DUNG', sql.Bit, false);

      await request.query(`
        INSERT INTO VOUCHER (
          VOUCHER_ID,
          NHAN_VIEN_ID,
          CHIEN_DICH_ID,
          KHACH_HANG_ID,
          MA_VOUCHER,
          LOAI_GIAM_GIA,
          GIA_TRI_GIAM,
          NGAY_BAT_DAU,
          NGAY_KET_THUC,
          DA_DUNG
        )
        VALUES (
          @VOUCHER_ID,
          @NHAN_VIEN_ID,
          @CHIEN_DICH_ID,
          @KHACH_HANG_ID,
          @MA_VOUCHER,
          @LOAI_GIAM_GIA,
          @GIA_TRI_GIAM,
          @NGAY_BAT_DAU,
          @NGAY_KET_THUC,
          @DA_DUNG
        )
      `);
    }

    const selectRequest = new sql.Request(tx);
    const idParams = createdVoucherIds.map((id, index) => {
      const paramName = `VOUCHER_ID_${index}`;
      selectRequest.input(paramName, sql.NVarChar(10), id);
      return `@${paramName}`;
    });

    const result = await selectRequest.query(`
      SELECT
        v.VOUCHER_ID,
        v.CHIEN_DICH_ID,
        v.KHACH_HANG_ID,
        kh.TEN AS TEN_KHACH_HANG,
        v.MA_VOUCHER,
        v.LOAI_GIAM_GIA,
        v.GIA_TRI_GIAM,
        v.NGAY_BAT_DAU,
        v.NGAY_KET_THUC,
        v.DA_DUNG
      FROM VOUCHER v
      LEFT JOIN KHACH_HANG kh ON kh.KHACH_HANG_ID = v.KHACH_HANG_ID
      WHERE v.VOUCHER_ID IN (${idParams.join(', ')})
      ORDER BY v.VOUCHER_ID ASC
    `);

    await tx.commit();
    const vouchers = result.recordset.map(mapAdminVoucher);

    return res.status(201).json({
      message: 'Voucher created.',
      voucher: vouchers[0],
      vouchers,
    });
  } catch (error: any) {
    if ((tx as any)._aborted !== true) {
      try { await tx.rollback(); } catch {}
    }
    console.error('Admin create voucher error:', error);
    return res.status(500).json({ message: 'Cannot create voucher: ' + error.message });
  }
};

export const updateAdminVoucher = async (req: Request, res: Response) => {
  try {
    const { voucherId } = req.params;
    const { voucherCode, campaignCode, discountType, discountValue, startDate, endDate } = req.body;

    if (!voucherId || !String(voucherCode || '').trim()) {
      return res.status(400).json({ message: 'Voucher fields are missing.' });
    }

    const parsedStartDate = parseOptionalDate(startDate);
    const parsedEndDate = parseOptionalDate(endDate);
    const parsedDiscountValue = Number(discountValue || 0);

    if (!parsedStartDate || !parsedEndDate) {
      return res.status(400).json({ message: 'Voucher dates are required.' });
    }

    if (parsedEndDate < parsedStartDate) {
      return res.status(400).json({ message: 'Voucher end date must be after start date.' });
    }

    if (!Number.isFinite(parsedDiscountValue) || parsedDiscountValue < 0) {
      return res.status(400).json({ message: 'Voucher discount value is invalid.' });
    }

    const request = new sql.Request();
    request.input('VOUCHER_ID', sql.NVarChar(10), voucherId);
    request.input('CHIEN_DICH_ID', sql.NVarChar(10), campaignCode ? String(campaignCode).trim() : null);
    request.input('MA_VOUCHER', sql.NVarChar(50), String(voucherCode).trim());
    request.input('LOAI_GIAM_GIA', sql.NVarChar(50), normalizeAdminDiscountType(discountType));
    request.input('GIA_TRI_GIAM', sql.Decimal(15, 2), parsedDiscountValue);
    request.input('NGAY_BAT_DAU', sql.Date, parsedStartDate);
    request.input('NGAY_KET_THUC', sql.Date, parsedEndDate);

    const result = await request.query(`
      UPDATE VOUCHER
      SET
        CHIEN_DICH_ID = @CHIEN_DICH_ID,
        MA_VOUCHER = @MA_VOUCHER,
        LOAI_GIAM_GIA = @LOAI_GIAM_GIA,
        GIA_TRI_GIAM = @GIA_TRI_GIAM,
        NGAY_BAT_DAU = @NGAY_BAT_DAU,
        NGAY_KET_THUC = @NGAY_KET_THUC
      WHERE VOUCHER_ID = @VOUCHER_ID;

      SELECT
        v.VOUCHER_ID,
        v.CHIEN_DICH_ID,
        v.KHACH_HANG_ID,
        kh.TEN AS TEN_KHACH_HANG,
        v.MA_VOUCHER,
        v.LOAI_GIAM_GIA,
        v.GIA_TRI_GIAM,
        v.NGAY_BAT_DAU,
        v.NGAY_KET_THUC,
        v.DA_DUNG
      FROM VOUCHER v
      LEFT JOIN KHACH_HANG kh ON kh.KHACH_HANG_ID = v.KHACH_HANG_ID
      WHERE v.VOUCHER_ID = @VOUCHER_ID;
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Voucher not found.' });
    }

    return res.status(200).json({
      message: 'Voucher updated.',
      voucher: mapAdminVoucher(result.recordset[0], 0),
    });
  } catch (error: any) {
    console.error('Admin update voucher error:', error);
    return res.status(500).json({ message: 'Cannot update voucher: ' + error.message });
  }
};

export const deleteAdminVoucher = async (req: Request, res: Response) => {
  try {
    const { voucherId } = req.params;
    const request = new sql.Request();
    request.input('VOUCHER_ID', sql.NVarChar(10), voucherId);

    const result = await request.query(`
      DELETE FROM VOUCHER
      WHERE VOUCHER_ID = @VOUCHER_ID
    `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Voucher not found.' });
    }

    return res.status(200).json({ message: 'Voucher deleted.' });
  } catch (error: any) {
    console.error('Admin delete voucher error:', error);
    return res.status(500).json({ message: 'Cannot delete voucher: ' + error.message });
  }
};
