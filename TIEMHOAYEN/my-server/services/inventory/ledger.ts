import { ObjectId, type ClientSession } from 'mongodb';
import { COLLECTIONS, ITEM_KIND } from './constants.js';
import { availableOf, col, finishedAvailableOf, InventoryError, roundQty, type Actor } from './helpers.js';

/**
 * SỔ BIẾN ĐỘNG KHO (BIEN_DONG_KHO) — mọi thay đổi tồn đều đi qua 2 hàm dưới đây.
 * - Bộ đếm trên NGUYEN_VAT_LIEU: TON_THUC, TON_DANG_GIU, TON_KHONG_DAT (SO_LUONG_TON giữ = TON_THUC để tương thích code cũ).
 * - Bộ đếm trên nguồn nhập (dòng CHI_TIET_PHIEU_NHAP_NVL đã Posted): SL_CON_LAI, SL_HONG, SL_DANG_GIU.
 * - Mỗi lần gọi ghi đúng 1 dòng sổ, lưu số sau sự kiện để đối soát.
 * Hàm ném lỗi nếu số âm → transaction bị hủy, không ghi gì.
 */

export interface MaterialDelta {
  materialId: string;
  /** PHIEU_NHAP_ID của nguồn nhập (bắt buộc với thay đổi tồn thực / không đạt). */
  sourceId?: string | null;
  dOnHand?: number;
  dReserved?: number;
  dDamaged?: number;
  type: string;
  docType?: string | null;
  docId?: string | null;
  orderId?: string | null;
  reservationId?: string | null;
  unitCost?: number | null;
  note?: string | null;
  actor?: Actor | null;
  demo?: boolean;
  /** Ghi thêm vào nguồn (ví dụ SL_DA_XUAT, SL_DA_HUY) — chỉ để hiển thị. */
  sourceExtraInc?: Record<string, number>;
}

const EPS = 1e-9;

export const applyMaterialDelta = async (session: ClientSession, delta: MaterialDelta) => {
  const dOnHand = roundQty(delta.dOnHand || 0);
  const dReserved = roundQty(delta.dReserved || 0);
  const dDamaged = roundQty(delta.dDamaged || 0);

  const materials = await col(COLLECTIONS.material);
  const after = await materials.findOneAndUpdate(
    { NGUYEN_VAT_LIEU_ID: delta.materialId },
    {
      $inc: { TON_THUC: dOnHand, SO_LUONG_TON: dOnHand, TON_DANG_GIU: dReserved, TON_KHONG_DAT: dDamaged },
    },
    { session, returnDocument: 'after' },
  );
  if (!after) throw new InventoryError(404, `Không tìm thấy NVL ${delta.materialId}.`);

  const onHand = roundQty(after.TON_THUC);
  const reserved = roundQty(after.TON_DANG_GIU);
  const damaged = roundQty(after.TON_KHONG_DAT);
  if (onHand < -EPS || reserved < -EPS || damaged < -EPS || onHand - reserved - damaged < -EPS) {
    throw new InventoryError(409, `Tồn của ${after.TEN_NGUYEN_VAT_LIEU || delta.materialId} không đủ cho thao tác này.`, {
      materialId: delta.materialId,
      onHand,
      reserved,
      damaged,
    });
  }

  let sourceAfter: any = null;
  if (delta.sourceId) {
    const details = await col(COLLECTIONS.importDetail);
    sourceAfter = await details.findOneAndUpdate(
      { PHIEU_NHAP_ID: delta.sourceId, NGUYEN_VAT_LIEU_ID: delta.materialId, LA_NGUON_NHAP: true },
      { $inc: { SL_CON_LAI: dOnHand, SL_HONG: dDamaged, SL_DANG_GIU: dReserved, ...(delta.sourceExtraInc || {}) } },
      { session, returnDocument: 'after' },
    );
    if (!sourceAfter) {
      throw new InventoryError(409, `Nguồn nhập ${delta.sourceId} / ${delta.materialId} không tồn tại hoặc chưa ghi nhận.`);
    }
    const rest = roundQty(sourceAfter.SL_CON_LAI);
    const bad = roundQty(sourceAfter.SL_HONG);
    const held = roundQty(sourceAfter.SL_DANG_GIU);
    if (rest < -EPS || bad < -EPS || held < -EPS || rest - bad - held < -EPS) {
      throw new InventoryError(409, `Nguồn nhập ${delta.sourceId} của ${delta.materialId} không đủ số lượng.`);
    }
  }

  await (await col(COLLECTIONS.movement)).insertOne(
    {
      _id: new ObjectId(),
      LOAI: delta.type,
      LOAI_DOI_TUONG: ITEM_KIND.material,
      NGUYEN_VAT_LIEU_ID: delta.materialId,
      PHIEU_NHAP_NGUON: delta.sourceId || null,
      DELTA_TON_THUC: dOnHand,
      DELTA_DANG_GIU: dReserved,
      DELTA_KHONG_DAT: dDamaged,
      TON_THUC_SAU: onHand,
      DANG_GIU_SAU: reserved,
      KHONG_DAT_SAU: damaged,
      KHA_DUNG_SAU: availableOf(after),
      DON_GIA_VON: delta.unitCost ?? null,
      LOAI_CHUNG_TU: delta.docType || null,
      CHUNG_TU_ID: delta.docId || null,
      DON_HANG_ID: delta.orderId || null,
      MA_GIU_TON: delta.reservationId || null,
      GHI_CHU: delta.note || null,
      NGUOI_THUC_HIEN: delta.actor?.id || null,
      THOI_DIEM: new Date(),
      ...(delta.demo ? { DU_LIEU_MAU: true } : {}),
    } as any,
    { session },
  );

  return { material: after, source: sourceAfter };
};

export interface FinishedDelta {
  productId: string;
  dOnHand?: number;
  dReserved?: number;
  type: string;
  docType?: string | null;
  docId?: string | null;
  orderId?: string | null;
  reservationId?: string | null;
  unitCost?: number | null;
  note?: string | null;
  actor?: Actor | null;
  demo?: boolean;
  /** Khi nhập thành phẩm cắm sẵn: cập nhật giá vốn bình quân thành phẩm. */
  newUnitCost?: number | null;
}

export const applyFinishedDelta = async (session: ClientSession, delta: FinishedDelta) => {
  const dOnHand = roundQty(delta.dOnHand || 0);
  const dReserved = roundQty(delta.dReserved || 0);
  const products = await col(COLLECTIONS.product);

  const set: Record<string, unknown> = {};
  if (delta.newUnitCost !== undefined && delta.newUnitCost !== null && dOnHand > 0) {
    const before = await products.findOne({ SAN_PHAM_ID: delta.productId }, { session });
    const oldQty = Math.max(0, Number(before?.TON_THANH_PHAM || 0));
    const oldCost = Number(before?.GIA_VON_THANH_PHAM || 0);
    set.GIA_VON_THANH_PHAM = Math.round((oldQty * oldCost + dOnHand * delta.newUnitCost) / (oldQty + dOnHand));
  }

  const after = await products.findOneAndUpdate(
    { SAN_PHAM_ID: delta.productId },
    { $inc: { TON_THANH_PHAM: dOnHand, TP_DANG_GIU: dReserved }, ...(Object.keys(set).length ? { $set: set } : {}) },
    { session, returnDocument: 'after' },
  );
  if (!after) throw new InventoryError(404, `Không tìm thấy sản phẩm ${delta.productId}.`);
  const onHand = roundQty(after.TON_THANH_PHAM);
  const reserved = roundQty(after.TP_DANG_GIU);
  if (onHand < -EPS || reserved < -EPS || onHand - reserved < -EPS) {
    throw new InventoryError(409, `Thành phẩm ${after.TEN_SAN_PHAM || delta.productId} không đủ.`);
  }

  await (await col(COLLECTIONS.movement)).insertOne(
    {
      _id: new ObjectId(),
      LOAI: delta.type,
      LOAI_DOI_TUONG: ITEM_KIND.finishedGood,
      SAN_PHAM_ID: delta.productId,
      DELTA_TON_THUC: dOnHand,
      DELTA_DANG_GIU: dReserved,
      DELTA_KHONG_DAT: 0,
      TON_THUC_SAU: onHand,
      DANG_GIU_SAU: reserved,
      KHONG_DAT_SAU: 0,
      KHA_DUNG_SAU: finishedAvailableOf(after),
      DON_GIA_VON: delta.unitCost ?? null,
      LOAI_CHUNG_TU: delta.docType || null,
      CHUNG_TU_ID: delta.docId || null,
      DON_HANG_ID: delta.orderId || null,
      MA_GIU_TON: delta.reservationId || null,
      GHI_CHU: delta.note || null,
      NGUOI_THUC_HIEN: delta.actor?.id || null,
      THOI_DIEM: new Date(),
      ...(delta.demo ? { DU_LIEU_MAU: true } : {}),
    } as any,
    { session },
  );
  return after;
};
