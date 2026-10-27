/**
 * CẤU HÌNH & HẰNG SỐ NGHIỆP VỤ KHO — dùng chung toàn backend.
 * Không tự viết lại các ngưỡng này trong controller/frontend (theo "Các giai đoạn code").
 *
 * Các giá trị có thể override bằng biến môi trường (.env).
 * Những giá trị đánh dấu [ĐỀ XUẤT] chưa được chốt chính thức trong tài liệu nghiệp vụ.
 */

const envNumber = (key: string, fallback: number): number => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const INVENTORY_CONFIG = {
  /** [ĐỀ XUẤT] Thời gian giữ tạm chờ thanh toán QR (phút). Stage plan 26/10: 15'; tài liệu Tồn kho 22/10: 5'. */
  holdMinutes: envNumber('INVENTORY_HOLD_MINUTES', 15),
  /** [ĐỀ XUẤT] Giờ cutoff đơn giao trong ngày (giờ VN, HH:mm). Sau giờ này đơn giao hôm nay cần Sales kiểm tra. */
  sameDayCutoff: process.env.INVENTORY_SAME_DAY_CUTOFF || '14:00',
  /** Ngưỡng "Sắp hết" của sản phẩm trên website: 1–3 bó (D01.7 tầng 2). */
  productLowStockMax: envNumber('INVENTORY_PRODUCT_LOW_STOCK', 3),
  /** Múi giờ hiển thị và tính "giao trong ngày". */
  timezone: 'Asia/Ho_Chi_Minh',
  /** Độ chính xác số lượng (kg, m có số lẻ). */
  quantityDecimals: 3,
};

export const COLLECTIONS = {
  material: 'NGUYEN_VAT_LIEU',
  supplier: 'NHA_CUNG_CAP',
  supplierMaterial: 'NHA_CUNG_CAP_NVL',
  product: 'SAN_PHAM',
  legacyRecipe: 'CONG_THUC_SAN_PHAM',
  bom: 'BOM_SAN_PHAM',
  bomLine: 'CHI_TIET_BOM',
  purchaseOrder: 'DON_DAT_MUA_NCC',
  importSlip: 'PHIEU_NHAP_NVL',
  importDetail: 'CHI_TIET_PHIEU_NHAP_NVL',
  exportSlip: 'PHIEU_XUAT_NVL',
  exportDetail: 'CHI_TIET_PHIEU_XUAT_NVL',
  reservation: 'GIU_TON',
  demand: 'NHU_CAU_NVL_DU_KIEN',
  movement: 'BIEN_DONG_KHO',
  counter: 'BO_DEM_MA',
  order: 'DON_HANG',
  orderDetail: 'DON_HANG_CHI_TIET',
  employee: 'NHAN_VIEN',
} as const;

/** D01.1 — Nhóm NVL */
export const MATERIAL_GROUP = {
  perishable: 'DE_HU', // Hoa tươi, lá: FIFO theo phiếu nhập nguồn
  durable: 'IT_HU', // Giấy, ruy băng, giỏ, phụ kiện: tồn tổng, giá vốn bình quân
} as const;

export const MATERIAL_TYPES = [
  'Hoa tươi',
  'Lá',
  'Giấy gói',
  'Lưới',
  'Ruy băng',
  'Hộp/Túi',
  'Giỏ',
  'Phụ kiện cắm',
  'Dụng cụ',
  'Quà tặng kèm',
  'Phụ liệu chung',
] as const;

export const MATERIAL_STATUS = { active: 'Đang sử dụng', hidden: 'Ngừng sử dụng' } as const;

export const SUPPLIER_STATUSES = ['Hoạt động', 'Đang hợp tác', 'Tạm ngưng', 'Ngừng hợp tác', 'Bị khóa'] as const;
export const SUPPLIER_ACTIVE_STATUSES = ['Hoạt động', 'Đang hợp tác'];

/** D01.3 — Trạng thái chứng từ kho */
export const DOC_STATUS = { draft: 'Nháp', posted: 'Đã ghi nhận', cancelled: 'Đã hủy' } as const;

export const IMPORT_TYPES = {
  purchase: 'Nhập mua NCC',
  opening: 'Tồn đầu kỳ',
  return: 'Nhập hoàn',
  adjustIn: 'Điều chỉnh tăng',
} as const;

export const EXPORT_TYPES = {
  order: 'Làm hoa theo đơn',
  readyMade: 'Cắm bó sẵn',
  storageLoss: 'Hao hụt/hỏng khi bảo quản',
  quarantineDisposal: 'Xuất hủy NVL cách ly',
  stockCount: 'Điều chỉnh kiểm kê',
  other: 'Khác',
} as const;

/** D01.3 — Trạng thái PO NCC. Chỉ "Đang giao" được tính hàng đang về. */
export const PO_STATUS = {
  draft: 'Nháp',
  waiting: 'Chờ NCC xác nhận',
  shipping: 'Đang giao',
  done: 'Giao thành công',
  cancelled: 'Đã hủy',
} as const;

/** Bảng giu_ton */
export const RESERVATION_STATUS = {
  temporary: 'TAM_CHO_QR',
  official: 'CHINH_THUC',
  released: 'DA_NHA',
  finished: 'DA_KET_THUC',
} as const;
export const ACTIVE_RESERVATION_STATUSES = [RESERVATION_STATUS.temporary, RESERVATION_STATUS.official];

export const DEMAND_STATUS = { waiting: 'Chờ giữ', reserved: 'Đã giữ', issued: 'Đã xuất', cancelled: 'Đã hủy' } as const;

export const ITEM_KIND = { material: 'NVL', finishedGood: 'THANH_PHAM' } as const;

/** BIEN_DONG_KHO.LOAI */
export const MOVEMENT_TYPES = {
  import: 'NHAP',
  export: 'XUAT',
  reserve: 'GIU',
  release: 'NHA_GIU',
  confirmReservation: 'CHUYEN_GIU_CHINH_THUC',
  endReservation: 'KET_THUC_GIU',
  markDamaged: 'DANH_DAU_KHONG_DAT',
  dispose: 'XUAT_HUY',
  finishedIn: 'NHAP_THANH_PHAM',
  finishedOut: 'XUAT_THANH_PHAM',
  finishedDispose: 'HUY_THANH_PHAM',
} as const;

export const BOM_STATUS = { draft: 'Nháp', active: 'Hiệu lực', retired: 'Ngừng sử dụng' } as const;
export const BOM_ROLES = ['Chính', 'Phụ', 'Phụ liệu'] as const;

/** Đơn vị được coi là tương đương khi so khớp BOM với NVL (dữ liệu cũ ghi lẫn bông/cành/nhánh). */
export const UNIT_ALIASES: string[][] = [
  ['bông', 'cành', 'nhánh', 'cây'],
  ['tờ'],
  ['cuộn'],
  ['cái', 'chiếc'],
];
