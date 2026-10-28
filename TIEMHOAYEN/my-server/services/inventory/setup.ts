import { COLLECTIONS, DOC_STATUS, EXPORT_TYPES } from './constants.js';
import { col } from './helpers.js';
import { sweepExpiredReservations } from './stock.service.js';

/** Index bảo vệ ràng buộc nghiệp vụ ở tầng DB (chạy idempotent khi server khởi động). */
export const ensureInventoryIndexes = async () => {
  const tasks: Promise<unknown>[] = [
    (await col(COLLECTIONS.supplierMaterial)).createIndex({ NHA_CUNG_CAP_ID: 1, NGUYEN_VAT_LIEU_ID: 1 }, { unique: true, name: 'uniq_ncc_nvl' }),
    (await col(COLLECTIONS.bom)).createIndex(
      { SAN_PHAM_ID: 1 },
      { unique: true, name: 'uniq_bom_hieu_luc', partialFilterExpression: { TRANG_THAI: 'Hiệu lực' } },
    ),
    (await col(COLLECTIONS.bomLine)).createIndex({ BOM_ID: 1, NGUYEN_VAT_LIEU_ID: 1 }, { unique: true, name: 'uniq_bom_nvl' }),
    (await col(COLLECTIONS.exportSlip)).createIndex(
      { DON_HANG_ID: 1 },
      { unique: true, name: 'uniq_xuat_nvl_mot_lan_moi_don', partialFilterExpression: { LOAI_XUAT: EXPORT_TYPES.order, TRANG_THAI: DOC_STATUS.posted } },
    ),
    (await col(COLLECTIONS.importDetail)).createIndex({ NGUYEN_VAT_LIEU_ID: 1, LA_NGUON_NHAP: 1, THOI_DIEM_NHAN: 1 }, { name: 'fifo_nguon_nhap' }),
    (await col(COLLECTIONS.reservation)).createIndex({ TRANG_THAI: 1, HET_HAN_LUC: 1 }, { name: 'giu_ton_het_han' }),
    (await col(COLLECTIONS.reservation)).createIndex({ DON_HANG_ID: 1 }, { name: 'giu_ton_don' }),
    (await col(COLLECTIONS.reservation)).createIndex({ MA_PHIEN_THANH_TOAN: 1 }, { name: 'giu_ton_phien' }),
    (await col(COLLECTIONS.demand)).createIndex({ TRANG_THAI: 1, THOI_DIEM_CAN_DUNG: 1 }, { name: 'nhu_cau_T' }),
    (await col(COLLECTIONS.movement)).createIndex({ NGUYEN_VAT_LIEU_ID: 1, THOI_DIEM: -1 }, { name: 'so_kho_nvl' }),
    (await col(COLLECTIONS.movement)).createIndex({ THOI_DIEM: -1 }, { name: 'so_kho_thoi_diem' }),
  ];
  const results = await Promise.allSettled(tasks);
  results.forEach((r) => {
    if (r.status === 'rejected') console.warn('[inventory] Không tạo được index:', (r.reason as Error)?.message);
  });
};

let timer: NodeJS.Timeout | null = null;

/** Định kỳ nhả các lượng giữ tạm QR đã quá hạn. */
export const startInventoryJobs = () => {
  if (timer) return;
  timer = setInterval(() => {
    sweepExpiredReservations().catch((error) => console.error('[inventory] sweep lỗi', error));
  }, 60_000);
  timer.unref?.();
};
