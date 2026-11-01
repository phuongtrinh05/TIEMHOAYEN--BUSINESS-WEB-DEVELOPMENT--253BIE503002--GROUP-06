import { getCollection } from '../../mongo.js';
import { CACHE_TTL, swr } from './cache.js';
import { toDate } from './dataset.js';
import { EXPORT_TYPES } from '../inventory/constants.js';

/**
 * Dòng chảy kho đã ghi nhận (phiếu nhập / phiếu xuất) — dùng cho phần Chi phí của Bảng phân tích
 * và các báo cáo Kho. Chỉ lấy phiếu "Đã ghi nhận"; có cache như bộ dữ liệu đơn.
 */

export interface ExportSlip {
  id: string;
  type: string;
  orderId: string | null;
  at: Date | null;
  cost: number;
  lines: { materialId: string; quantity: number; cost: number }[];
}

export interface ImportSlip {
  id: string;
  supplierId: string | null;
  at: Date | null;
  total: number;
  lines: { materialId: string; quantity: number; rejected: number; amount: number }[];
}

export interface InventoryFlows {
  exports: ExportSlip[];
  imports: ImportSlip[];
  materials: Map<string, { name: string; unit: string; group: string }>;
  suppliers: Map<string, string>;
}

/** Loại xuất được coi là "hao hụt / hủy" (chi phí không tạo ra doanh thu). */
export const LOSS_EXPORT_TYPES: string[] = [EXPORT_TYPES.storageLoss, EXPORT_TYPES.quarantineDisposal, EXPORT_TYPES.stockCount];

const POSTED = 'Đã ghi nhận';
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const loadInventoryFlows = async (): Promise<InventoryFlows> => {
  const col = (name: string) => getCollection<any>(name);
  const [px, pxLines, pn, pnLines, materials, suppliers] = await Promise.all([
    col('PHIEU_XUAT_NVL').then((c) => c.find({ TRANG_THAI: POSTED }).project({ PHIEU_XUAT_ID: 1, LOAI_XUAT: 1, DON_HANG_ID: 1, NGAY_XUAT: 1, TONG_GIA_VON: 1 }).toArray()).catch(() => [] as any[]),
    col('CHI_TIET_PHIEU_XUAT_NVL').then((c) => c.find({}).project({ PHIEU_XUAT_ID: 1, NGUYEN_VAT_LIEU_ID: 1, SO_LUONG_XUAT: 1, THANH_TIEN_VON: 1 }).toArray()).catch(() => [] as any[]),
    col('PHIEU_NHAP_NVL').then((c) => c.find({ TRANG_THAI: POSTED }).project({ PHIEU_NHAP_ID: 1, NHA_CUNG_CAP_ID: 1, THOI_DIEM_NHAN: 1, NGAY_NHAP: 1, TONG_TIEN: 1 }).toArray()).catch(() => [] as any[]),
    col('CHI_TIET_PHIEU_NHAP_NVL').then((c) => c.find({}).project({ PHIEU_NHAP_ID: 1, NGUYEN_VAT_LIEU_ID: 1, SO_LUONG_NHAP: 1, SL_THUC_NHAN: 1, SL_KHONG_DAT: 1, THANH_TIEN: 1 }).toArray()).catch(() => [] as any[]),
    col('NGUYEN_VAT_LIEU').then((c) => c.find({}).project({ NGUYEN_VAT_LIEU_ID: 1, TEN_NGUYEN_VAT_LIEU: 1, DON_VI_TINH: 1, NHOM_NVL: 1 }).toArray()).catch(() => [] as any[]),
    col('NHA_CUNG_CAP').then((c) => c.find({}).project({ NHA_CUNG_CAP_ID: 1, TEN_NHA_CUNG_CAP: 1 }).toArray()).catch(() => [] as any[]),
  ]);
  const group = <T>(rows: any[], key: string, map: (r: any) => T) => {
    const m = new Map<string, T[]>();
    rows.forEach((r) => { const k = String(r[key]); m.set(k, [...(m.get(k) || []), map(r)]); });
    return m;
  };
  const pxLineMap = group(pxLines, 'PHIEU_XUAT_ID', (d) => ({ materialId: String(d.NGUYEN_VAT_LIEU_ID), quantity: num(d.SO_LUONG_XUAT), cost: num(d.THANH_TIEN_VON) }));
  const pnLineMap = group(pnLines, 'PHIEU_NHAP_ID', (d) => ({
    materialId: String(d.NGUYEN_VAT_LIEU_ID), quantity: num(d.SL_THUC_NHAN ?? d.SO_LUONG_NHAP), rejected: num(d.SL_KHONG_DAT), amount: num(d.THANH_TIEN),
  }));
  return {
    exports: px.map((x: any) => {
      const lines = pxLineMap.get(String(x.PHIEU_XUAT_ID)) || [];
      return { id: String(x.PHIEU_XUAT_ID), type: String(x.LOAI_XUAT || 'Khác'), orderId: x.DON_HANG_ID || null, at: toDate(x.NGAY_XUAT), cost: num(x.TONG_GIA_VON) || lines.reduce((s, l) => s + l.cost, 0), lines };
    }),
    imports: pn.map((x: any) => {
      const lines = pnLineMap.get(String(x.PHIEU_NHAP_ID)) || [];
      return { id: String(x.PHIEU_NHAP_ID), supplierId: x.NHA_CUNG_CAP_ID || null, at: toDate(x.THOI_DIEM_NHAN || x.NGAY_NHAP), total: num(x.TONG_TIEN) || lines.reduce((s, l) => s + l.amount, 0), lines };
    }),
    materials: new Map(materials.map((m: any) => [String(m.NGUYEN_VAT_LIEU_ID), { name: String(m.TEN_NGUYEN_VAT_LIEU || m.NGUYEN_VAT_LIEU_ID), unit: String(m.DON_VI_TINH || ''), group: String(m.NHOM_NVL || '') }])),
    suppliers: new Map(suppliers.map((s: any) => [String(s.NHA_CUNG_CAP_ID), String(s.TEN_NHA_CUNG_CAP || s.NHA_CUNG_CAP_ID)])),
  };
};

export const getInventoryFlows = (opts: { fresh?: boolean } = {}) =>
  swr('inventoryFlows', { ttlMs: CACHE_TTL.heavyMs, maxStaleMs: CACHE_TTL.heavyMaxStaleMs, ...opts }, loadInventoryFlows);
