import { ObjectId, type ClientSession } from 'mongodb';
import {
  ACTIVE_RESERVATION_STATUSES,
  COLLECTIONS,
  DEMAND_STATUS,
  DOC_STATUS,
  EXPORT_TYPES,
  IMPORT_TYPES,
  INVENTORY_CONFIG,
  ITEM_KIND,
  MATERIAL_GROUP,
  MATERIAL_STATUS,
  MOVEMENT_TYPES,
  PO_STATUS,
  RESERVATION_STATUS,
  SUPPLIER_ACTIVE_STATUSES,
} from './constants.js';
import {
  availableOf,
  ceilQty,
  col,
  finishedAvailableOf,
  InventoryError,
  money,
  nextCode,
  parseDate,
  roundQty,
  toNonNegativeQty,
  withTransaction,
  type Actor,
} from './helpers.js';
import { applyFinishedDelta, applyMaterialDelta } from './ledger.js';
import { getActiveBom } from './bom.service.js';

/* =====================================================================
 * NGUỒN NHẬP (dòng PN đã Posted) — FIFO theo thời điểm nhận rồi mã PN
 * ===================================================================== */

const sourceFree = (s: any) => roundQty(Number(s.SL_CON_LAI || 0) - Number(s.SL_HONG || 0) - Number(s.SL_DANG_GIU || 0));

const loadSourcesFifo = async (session: ClientSession, materialId: string) =>
  (await col(COLLECTIONS.importDetail))
    .find({ NGUYEN_VAT_LIEU_ID: materialId, LA_NGUON_NHAP: true, SL_CON_LAI: { $gt: 0 } }, { session })
    .sort({ THOI_DIEM_NHAN: 1, PHIEU_NHAP_ID: 1 })
    .toArray();

/** Phân bổ FIFO một lượng q trên các nguồn theo hàm "free" truyền vào. */
const allocateFifo = (sources: any[], quantity: number, freeOf: (s: any) => number, preferred: string[] = []) => {
  const ordered = [
    ...preferred.map((id) => sources.find((s) => s.PHIEU_NHAP_ID === id)).filter(Boolean),
    ...sources.filter((s) => !preferred.includes(s.PHIEU_NHAP_ID)),
  ];
  const allocations: { sourceId: string; quantity: number; unitCost: number }[] = [];
  let remaining = roundQty(quantity);
  for (const s of ordered) {
    if (remaining <= 0) break;
    const take = roundQty(Math.min(remaining, freeOf(s)));
    if (take <= 0) continue;
    allocations.push({ sourceId: s.PHIEU_NHAP_ID, quantity: take, unitCost: Number(s.DON_GIA_VON || s.DON_GIA_NHAP || 0) });
    remaining = roundQty(remaining - take);
  }
  return { allocations, missing: remaining };
};

/* =====================================================================
 * PHIẾU NHẬP KHO (PN) — Nháp → Đã ghi nhận (Posted) đúng một lần
 * ===================================================================== */

const IMPORT_TYPE_VALUES = Object.values(IMPORT_TYPES) as string[];

const mapImportDetailInput = (receiptId: string, raw: any, index: number) => {
  const materialId = String(raw.materialId ?? raw.materialCode ?? raw.NGUYEN_VAT_LIEU_ID ?? '').trim();
  if (!materialId) throw new InventoryError(400, `Dòng ${index + 1}: chưa chọn NVL.`);
  const received = toNonNegativeQty(raw.receivedQty ?? raw.SL_THUC_NHAN ?? raw.quantity ?? raw.SO_LUONG_NHAP, `Dòng ${index + 1}: SL thực nhận`);
  const rejected = toNonNegativeQty(raw.rejectedQty ?? raw.SL_KHONG_DAT ?? 0, `Dòng ${index + 1}: SL không đạt`);
  const accepted = raw.acceptedQty ?? raw.SL_DAT;
  const acceptedQty = accepted === undefined || accepted === null || accepted === ''
    ? roundQty(received - rejected)
    : toNonNegativeQty(accepted, `Dòng ${index + 1}: SL đạt`);
  if (Math.abs(roundQty(acceptedQty + rejected) - received) > 1e-9) {
    throw new InventoryError(400, `Dòng ${index + 1} (${materialId}): SL đạt + SL không đạt phải bằng SL thực nhận.`);
  }
  const unitPrice = money(raw.unitPrice ?? raw.DON_GIA_NHAP ?? 0);
  const chargesAcceptedOnly = Boolean(raw.chargesAcceptedOnly ?? raw.NCC_CHI_TINH_SL_DAT ?? false);
  // Phương án đã chốt: shop trả theo SL thực nhận thì phân bổ toàn bộ tiền vào SL đạt.
  const paid = money((chargesAcceptedOnly ? acceptedQty : received) * unitPrice);
  const unitCost = acceptedQty > 0 ? Math.round(paid / acceptedQty) : unitPrice;
  return {
    _id: { PHIEU_NHAP_ID: receiptId, NGUYEN_VAT_LIEU_ID: materialId },
    PHIEU_NHAP_ID: receiptId,
    NGUYEN_VAT_LIEU_ID: materialId,
    SL_DU_KIEN: raw.expectedQty === undefined || raw.expectedQty === '' ? null : roundQty(raw.expectedQty),
    SL_THUC_NHAN: received,
    SL_DAT: acceptedQty,
    SL_KHONG_DAT: rejected,
    SO_LUONG_NHAP: received, // tương thích cột cũ
    DON_GIA_NHAP: unitPrice,
    NCC_CHI_TINH_SL_DAT: chargesAcceptedOnly,
    THANH_TIEN: paid,
    DON_GIA_VON: unitCost,
    GHI_CHU: String(raw.note ?? raw.GHI_CHU ?? '').trim() || null,
  };
};

const buildImportHeader = (body: any) => {
  const type = IMPORT_TYPE_VALUES.includes(body.type) ? body.type : IMPORT_TYPES.purchase;
  return {
    LOAI_NHAP: type,
    NHA_CUNG_CAP_ID: String(body.supplierId ?? body.supplier ?? body.NHA_CUNG_CAP_ID ?? '').trim() || null,
    PO_ID: String(body.purchaseOrderId ?? body.PO_ID ?? '').trim() || null,
    PX_GOC_ID: String(body.originalExportId ?? body.PX_GOC_ID ?? '').trim() || null,
    THOI_DIEM_NHAN: parseDate(body.receivedAt ?? body.importDate ?? body.THOI_DIEM_NHAN) || new Date(),
    GHI_CHU: String(body.note ?? body.GHI_CHU ?? '').trim() || null,
  };
};

export const createImport = async (body: any, actor: Actor, options: { demo?: boolean } = {}) => {
  const receiptId = await nextCode(COLLECTIONS.importSlip, 'PHIEU_NHAP_ID', 'PN', 6);
  const header = buildImportHeader(body);
  const rawDetails: any[] = Array.isArray(body.details) ? body.details : [];
  const details = rawDetails.map((d, i) => mapImportDetailInput(receiptId, d, i));
  assertNoDuplicateMaterial(details);
  const doc = {
    _id: receiptId,
    PHIEU_NHAP_ID: receiptId,
    ...header,
    NGAY_NHAP: header.THOI_DIEM_NHAN, // tương thích cột cũ
    TRANG_THAI: DOC_STATUS.draft,
    TONG_TIEN: details.reduce((s, d) => s + d.THANH_TIEN, 0),
    NHAN_VIEN_ID: actor.id,
    NGUOI_LAP: actor.id,
    NGAY_LAP: new Date(),
    ...(options.demo ? { DU_LIEU_MAU: true } : {}),
  };
  await (await col(COLLECTIONS.importSlip)).insertOne(doc as any);
  if (details.length) await (await col(COLLECTIONS.importDetail)).insertMany(details.map((d) => ({ ...d, ...(options.demo ? { DU_LIEU_MAU: true } : {}) })) as any);
  if (body.post) return postImport(receiptId, actor);
  return { ...doc, details };
};

const assertNoDuplicateMaterial = (details: any[]) => {
  const seen = new Set<string>();
  details.forEach((d) => {
    if (seen.has(d.NGUYEN_VAT_LIEU_ID)) {
      throw new InventoryError(400, `NVL ${d.NGUYEN_VAT_LIEU_ID} bị trùng trên phiếu — mỗi NVL một dòng.`);
    }
    seen.add(d.NGUYEN_VAT_LIEU_ID);
  });
};

const getDraftOrThrow = async (collectionName: string, idField: string, id: string, label: string) => {
  const doc = await (await col(collectionName)).findOne({ [idField]: id });
  if (!doc) throw new InventoryError(404, `Không tìm thấy ${label} ${id}.`);
  if ((doc.TRANG_THAI || DOC_STATUS.posted) !== DOC_STATUS.draft) {
    throw new InventoryError(409, `${label} ${id} đang ở trạng thái "${doc.TRANG_THAI || DOC_STATUS.posted}" — không sửa trực tiếp. Hãy lập chứng từ điều chỉnh.`);
  }
  return doc;
};

export const updateImport = async (receiptId: string, body: any, actor: Actor) => {
  await getDraftOrThrow(COLLECTIONS.importSlip, 'PHIEU_NHAP_ID', receiptId, 'Phiếu nhập');
  const header = buildImportHeader(body);
  const details = (Array.isArray(body.details) ? body.details : []).map((d: any, i: number) => mapImportDetailInput(receiptId, d, i));
  assertNoDuplicateMaterial(details);
  const detailCol = await col(COLLECTIONS.importDetail);
  await detailCol.deleteMany({ PHIEU_NHAP_ID: receiptId });
  if (details.length) await detailCol.insertMany(details as any);
  await (await col(COLLECTIONS.importSlip)).updateOne(
    { PHIEU_NHAP_ID: receiptId, TRANG_THAI: DOC_STATUS.draft },
    { $set: { ...header, NGAY_NHAP: header.THOI_DIEM_NHAN, TONG_TIEN: details.reduce((s: number, d: any) => s + d.THANH_TIEN, 0), NGUOI_CAP_NHAT: actor.id, NGAY_CAP_NHAT: new Date() } },
  );
  if (body.post) return postImport(receiptId, actor);
  return getImport(receiptId);
};

export const cancelDraftDocument = async (kind: 'import' | 'export', id: string, actor: Actor, reason?: string) => {
  const name = kind === 'import' ? COLLECTIONS.importSlip : COLLECTIONS.exportSlip;
  const idField = kind === 'import' ? 'PHIEU_NHAP_ID' : 'PHIEU_XUAT_ID';
  await getDraftOrThrow(name, idField, id, kind === 'import' ? 'Phiếu nhập' : 'Phiếu xuất');
  await (await col(name)).updateOne(
    { [idField]: id, TRANG_THAI: DOC_STATUS.draft },
    { $set: { TRANG_THAI: DOC_STATUS.cancelled, LY_DO_HUY: reason || null, NGUOI_HUY: actor.id, NGAY_HUY: new Date() } },
  );
  return { cancelled: true };
};

export const deleteDraftDocument = async (kind: 'import' | 'export', id: string) => {
  const name = kind === 'import' ? COLLECTIONS.importSlip : COLLECTIONS.exportSlip;
  const detailName = kind === 'import' ? COLLECTIONS.importDetail : COLLECTIONS.exportDetail;
  const idField = kind === 'import' ? 'PHIEU_NHAP_ID' : 'PHIEU_XUAT_ID';
  const doc = await (await col(name)).findOne({ [idField]: id });
  if (!doc) throw new InventoryError(404, 'Không tìm thấy phiếu.');
  if (![DOC_STATUS.draft, DOC_STATUS.cancelled].includes(doc.TRANG_THAI)) {
    throw new InventoryError(409, 'Phiếu đã ghi nhận không được xóa. Hãy lập phiếu điều chỉnh/đảo.');
  }
  await (await col(detailName)).deleteMany({ [idField]: id });
  await (await col(name)).deleteOne({ [idField]: id });
  return { deleted: true };
};

export const getImport = async (receiptId: string) => {
  const doc = await (await col(COLLECTIONS.importSlip)).findOne({ PHIEU_NHAP_ID: receiptId });
  if (!doc) throw new InventoryError(404, 'Không tìm thấy phiếu nhập.');
  const details = await (await col(COLLECTIONS.importDetail)).find({ PHIEU_NHAP_ID: receiptId }).toArray();
  return { ...doc, TRANG_THAI: doc.TRANG_THAI || DOC_STATUS.posted, details };
};

/**
 * Ghi nhận phiếu nhập: chỉ SL ĐẠT tăng tồn thực. Gọi lại nhiều lần không cộng lần 2.
 */
export const postImport = async (receiptId: string, actor: Actor) => withTransaction(async (session) => {
  const slips = await col(COLLECTIONS.importSlip);
  const current = await slips.findOne({ PHIEU_NHAP_ID: receiptId }, { session });
  if (!current) throw new InventoryError(404, 'Không tìm thấy phiếu nhập.');
  if (current.TRANG_THAI === DOC_STATUS.posted || (!current.TRANG_THAI)) {
    return { ...current, alreadyPosted: true };
  }
  if (current.TRANG_THAI !== DOC_STATUS.draft) throw new InventoryError(409, `Phiếu đang ở trạng thái ${current.TRANG_THAI}.`);

  const details = await (await col(COLLECTIONS.importDetail)).find({ PHIEU_NHAP_ID: receiptId }, { session }).toArray();
  if (!details.length) throw new InventoryError(400, 'Phiếu nhập chưa có NVL.');
  if (current.LOAI_NHAP === IMPORT_TYPES.purchase) {
    if (!current.NHA_CUNG_CAP_ID) throw new InventoryError(400, 'Phiếu nhập mua bắt buộc chọn nhà cung cấp.');
    const supplier = await (await col(COLLECTIONS.supplier)).findOne({ NHA_CUNG_CAP_ID: current.NHA_CUNG_CAP_ID }, { session });
    if (!supplier) throw new InventoryError(400, 'Nhà cung cấp không tồn tại.');
    if (!SUPPLIER_ACTIVE_STATUSES.includes(supplier.TRANG_THAI)) {
      throw new InventoryError(400, `Nhà cung cấp đang "${supplier.TRANG_THAI}", không thể nhập mua.`);
    }
  }

  const flipped = await slips.findOneAndUpdate(
    { PHIEU_NHAP_ID: receiptId, TRANG_THAI: DOC_STATUS.draft },
    { $set: { TRANG_THAI: DOC_STATUS.posted, NGUOI_XAC_NHAN: actor.id, NGAY_XAC_NHAN: new Date() } },
    { session, returnDocument: 'after' },
  );
  if (!flipped) return { ...current, alreadyPosted: true };

  const materials = await col(COLLECTIONS.material);
  const detailCol = await col(COLLECTIONS.importDetail);
  const demo = Boolean(current.DU_LIEU_MAU);
  for (const d of details) {
    const material = await materials.findOne({ NGUYEN_VAT_LIEU_ID: d.NGUYEN_VAT_LIEU_ID }, { session });
    if (!material) throw new InventoryError(400, `NVL ${d.NGUYEN_VAT_LIEU_ID} không tồn tại.`);
    if (material.TRANG_THAI === MATERIAL_STATUS.hidden && current.LOAI_NHAP === IMPORT_TYPES.purchase) {
      throw new InventoryError(400, `NVL ${material.TEN_NGUYEN_VAT_LIEU} đã ngừng sử dụng.`);
    }
    await detailCol.updateOne(
      { _id: d._id },
      {
        $set: {
          LA_NGUON_NHAP: true,
          THOI_DIEM_NHAN: current.THOI_DIEM_NHAN || current.NGAY_NHAP || new Date(),
          NHA_CUNG_CAP_ID: current.NHA_CUNG_CAP_ID || null,
          SL_CON_LAI: 0, SL_HONG: 0, SL_DANG_GIU: 0, SL_DA_XUAT: 0, SL_DA_HUY: 0,
        },
      },
      { session },
    );
    const accepted = roundQty(d.SL_DAT);
    if (accepted > 0) {
      // Giá vốn bình quân gia quyền (dùng cho NVL ít hư hỏng, D02.5)
      const oldQty = Math.max(0, Number(material.TON_THUC || 0));
      const oldAvg = Number(material.GIA_VON_BQ || material.GIA_NHAP || 0);
      const newAvg = Math.round((oldQty * oldAvg + accepted * Number(d.DON_GIA_VON || 0)) / (oldQty + accepted));
      await materials.updateOne(
        { NGUYEN_VAT_LIEU_ID: d.NGUYEN_VAT_LIEU_ID },
        { $set: { GIA_VON_BQ: newAvg, ...(current.LOAI_NHAP === IMPORT_TYPES.purchase && d.DON_GIA_NHAP ? { GIA_NHAP: d.DON_GIA_NHAP } : {}) } },
        { session },
      );
      await applyMaterialDelta(session, {
        materialId: d.NGUYEN_VAT_LIEU_ID,
        sourceId: receiptId,
        dOnHand: accepted,
        type: MOVEMENT_TYPES.import,
        docType: 'PN',
        docId: receiptId,
        unitCost: d.DON_GIA_VON,
        note: current.LOAI_NHAP,
        actor,
        demo,
      });
    }
  }

  if (current.PO_ID) await applyReceiptToPurchaseOrder(session, current.PO_ID, details);
  return { ...flipped, details, alreadyPosted: false };
});

const applyReceiptToPurchaseOrder = async (session: ClientSession, poId: string, details: any[]) => {
  const pos = await col(COLLECTIONS.purchaseOrder);
  const po = await pos.findOne({ PO_ID: poId }, { session });
  if (!po) throw new InventoryError(400, `Không tìm thấy PO ${poId}.`);
  if (![PO_STATUS.shipping, PO_STATUS.waiting].includes(po.TRANG_THAI)) {
    throw new InventoryError(400, `PO ${poId} đang "${po.TRANG_THAI}", không nhận hàng được.`);
  }
  const lines = (po.CHI_TIET || []).map((line: any) => {
    const d = details.find((x) => x.NGUYEN_VAT_LIEU_ID === line.NGUYEN_VAT_LIEU_ID);
    if (!d) return line;
    return {
      ...line,
      SL_DA_NHAN: roundQty(Number(line.SL_DA_NHAN || 0) + Number(d.SL_THUC_NHAN || 0)),
      SL_DAT_DA_NHAN: roundQty(Number(line.SL_DAT_DA_NHAN || 0) + Number(d.SL_DAT || 0)),
    };
  });
  const complete = lines.every((l: any) => Number(l.SL_DA_NHAN || 0) >= Number(l.SL_DAT || 0));
  await pos.updateOne(
    { PO_ID: poId },
    { $set: { CHI_TIET: lines, ...(complete ? { TRANG_THAI: PO_STATUS.done, NGAY_HOAN_TAT: new Date() } : {}) } },
    { session },
  );
};

/* =====================================================================
 * PHIẾU XUẤT KHO (PX) — xuất một lần, FIFO hoa tươi, giải phóng phần giữ của chính đơn
 * ===================================================================== */

const EXPORT_TYPE_VALUES = Object.values(EXPORT_TYPES) as string[];

const mapExportDetailInput = (receiptId: string, raw: any, index: number) => {
  const materialId = String(raw.materialId ?? raw.materialCode ?? raw.NGUYEN_VAT_LIEU_ID ?? '').trim();
  if (!materialId) throw new InventoryError(400, `Dòng ${index + 1}: chưa chọn NVL.`);
  return {
    _id: { PHIEU_XUAT_ID: receiptId, NGUYEN_VAT_LIEU_ID: materialId },
    PHIEU_XUAT_ID: receiptId,
    NGUYEN_VAT_LIEU_ID: materialId,
    SL_THEO_BOM: raw.bomQty === undefined || raw.bomQty === null || raw.bomQty === '' ? null : roundQty(raw.bomQty ?? raw.SL_THEO_BOM),
    SO_LUONG_XUAT: toNonNegativeQty(raw.quantity ?? raw.SO_LUONG_XUAT, `Dòng ${index + 1}: SL xuất`),
    PHIEU_NHAP_CHI_DINH: String(raw.sourceId ?? raw.PHIEU_NHAP_CHI_DINH ?? '').trim() || null,
    GHI_CHU: String(raw.note ?? raw.GHI_CHU ?? '').trim() || null,
  };
};

const buildExportHeader = (body: any) => {
  const type = EXPORT_TYPE_VALUES.includes(body.type) ? body.type : EXPORT_TYPES.other;
  return {
    LOAI_XUAT: type,
    LY_DO_XUAT: type, // tương thích cột cũ
    DON_HANG_ID: String(body.orderId ?? body.DON_HANG_ID ?? '').trim() || null,
    SAN_PHAM_ID: String(body.productId ?? body.SAN_PHAM_ID ?? '').trim() || null,
    SO_BO: body.bundles === undefined || body.bundles === '' ? null : roundQty(body.bundles ?? body.SO_BO),
    NGAY_XUAT: parseDate(body.exportedAt ?? body.exportDate ?? body.NGAY_XUAT) || new Date(),
    GHI_CHU: String(body.note ?? body.GHI_CHU ?? '').trim() || null,
  };
};

export const createExport = async (body: any, actor: Actor, options: { demo?: boolean } = {}) => {
  const receiptId = await nextCode(COLLECTIONS.exportSlip, 'PHIEU_XUAT_ID', 'PX', 6);
  const header = buildExportHeader(body);
  const details = (Array.isArray(body.details) ? body.details : []).map((d: any, i: number) => mapExportDetailInput(receiptId, d, i));
  assertNoDuplicateMaterial(details);
  const doc = {
    _id: receiptId,
    PHIEU_XUAT_ID: receiptId,
    ...header,
    TRANG_THAI: DOC_STATUS.draft,
    NHAN_VIEN_ID: actor.id,
    NGUOI_LAP: actor.id,
    NGAY_LAP: new Date(),
    ...(options.demo ? { DU_LIEU_MAU: true } : {}),
  };
  await (await col(COLLECTIONS.exportSlip)).insertOne(doc as any);
  if (details.length) await (await col(COLLECTIONS.exportDetail)).insertMany(details.map((d: any) => ({ ...d, ...(options.demo ? { DU_LIEU_MAU: true } : {}) })) as any);
  if (body.post) return postExport(receiptId, actor);
  return { ...doc, details };
};

export const updateExport = async (receiptId: string, body: any, actor: Actor) => {
  await getDraftOrThrow(COLLECTIONS.exportSlip, 'PHIEU_XUAT_ID', receiptId, 'Phiếu xuất');
  const header = buildExportHeader(body);
  const details = (Array.isArray(body.details) ? body.details : []).map((d: any, i: number) => mapExportDetailInput(receiptId, d, i));
  assertNoDuplicateMaterial(details);
  const detailCol = await col(COLLECTIONS.exportDetail);
  await detailCol.deleteMany({ PHIEU_XUAT_ID: receiptId });
  if (details.length) await detailCol.insertMany(details as any);
  await (await col(COLLECTIONS.exportSlip)).updateOne(
    { PHIEU_XUAT_ID: receiptId, TRANG_THAI: DOC_STATUS.draft },
    { $set: { ...header, NGUOI_CAP_NHAT: actor.id, NGAY_CAP_NHAT: new Date() } },
  );
  if (body.post) return postExport(receiptId, actor);
  return getExport(receiptId);
};

export const getExport = async (receiptId: string) => {
  const doc = await (await col(COLLECTIONS.exportSlip)).findOne({ PHIEU_XUAT_ID: receiptId });
  if (!doc) throw new InventoryError(404, 'Không tìm thấy phiếu xuất.');
  const details = await (await col(COLLECTIONS.exportDetail)).find({ PHIEU_XUAT_ID: receiptId }).toArray();
  return { ...doc, TRANG_THAI: doc.TRANG_THAI || DOC_STATUS.posted, details };
};

/**
 * Gợi ý dòng xuất theo BOM:
 * - Làm hoa theo đơn: lấy từ lượng đang giữ / nhu cầu dự kiến của đơn, nếu không có thì BOM × SL dòng đơn.
 * - Cắm bó sẵn: BOM hiệu lực × số bó.
 */
export const suggestExportLines = async (params: { type?: string; orderId?: string; productId?: string; bundles?: number }) => {
  const needs = new Map<string, number>();
  const add = (id: string, q: number) => needs.set(id, roundQty((needs.get(id) || 0) + q));
  if (params.type === EXPORT_TYPES.order && params.orderId) {
    const reservations = await (await col(COLLECTIONS.reservation)).find({
      DON_HANG_ID: params.orderId, LOAI_DOI_TUONG: ITEM_KIND.material, TRANG_THAI: { $in: ACTIVE_RESERVATION_STATUSES },
    }).toArray();
    reservations.forEach((r: any) => add(r.NGUYEN_VAT_LIEU_ID, r.SO_LUONG));
    const demands = await (await col(COLLECTIONS.demand)).find({ DON_HANG_ID: params.orderId, TRANG_THAI: DEMAND_STATUS.waiting }).toArray();
    demands.forEach((d: any) => add(d.NGUYEN_VAT_LIEU_ID, d.SO_LUONG));
    if (!needs.size) {
      const lines = await (await col(COLLECTIONS.orderDetail)).find({ DON_HANG_ID: params.orderId }).toArray();
      const finishedHeld = await (await col(COLLECTIONS.reservation)).find({
        DON_HANG_ID: params.orderId, LOAI_DOI_TUONG: ITEM_KIND.finishedGood, TRANG_THAI: { $in: ACTIVE_RESERVATION_STATUSES },
      }).toArray();
      for (const line of lines as any[]) {
        const held = finishedHeld.filter((r: any) => r.SAN_PHAM_ID === line.SAN_PHAM_ID).reduce((s: number, r: any) => s + Number(r.SO_LUONG || 0), 0);
        const toMake = Math.max(0, Number(line.SO_LUONG || 0) - held);
        if (!toMake) continue;
        const { lines: bom } = await getActiveBom(line.SAN_PHAM_ID);
        bom.forEach((b) => add(b.NGUYEN_VAT_LIEU_ID, ceilQty(b.DINH_LUONG * toMake)));
      }
    }
  } else if (params.productId) {
    const { lines: bom } = await getActiveBom(params.productId);
    const bundles = Number(params.bundles || 1);
    bom.forEach((b) => add(b.NGUYEN_VAT_LIEU_ID, ceilQty(b.DINH_LUONG * bundles)));
  }
  const materials = await (await col(COLLECTIONS.material)).find({ NGUYEN_VAT_LIEU_ID: { $in: [...needs.keys()] } }).toArray();
  return [...needs.entries()].map(([id, qty]) => {
    const m: any = materials.find((x: any) => x.NGUYEN_VAT_LIEU_ID === id);
    return { materialId: id, name: m?.TEN_NGUYEN_VAT_LIEU || id, unit: m?.DON_VI_TINH || '', bomQty: qty, quantity: qty, available: availableOf(m) };
  });
};

export const postExport = async (receiptId: string, actor: Actor) => withTransaction(async (session) => {
  const slips = await col(COLLECTIONS.exportSlip);
  const current = await slips.findOne({ PHIEU_XUAT_ID: receiptId }, { session });
  if (!current) throw new InventoryError(404, 'Không tìm thấy phiếu xuất.');
  if (current.TRANG_THAI === DOC_STATUS.posted || !current.TRANG_THAI) return { ...current, alreadyPosted: true };
  if (current.TRANG_THAI !== DOC_STATUS.draft) throw new InventoryError(409, `Phiếu đang ở trạng thái ${current.TRANG_THAI}.`);

  const type = current.LOAI_XUAT;
  const details = await (await col(COLLECTIONS.exportDetail)).find({ PHIEU_XUAT_ID: receiptId }, { session }).toArray();
  if (!details.length) throw new InventoryError(400, 'Phiếu xuất chưa có NVL.');
  if (type === EXPORT_TYPES.other && !current.GHI_CHU) throw new InventoryError(400, 'Loại xuất "Khác" bắt buộc ghi chú.');

  if (type === EXPORT_TYPES.order) {
    if (!current.DON_HANG_ID) throw new InventoryError(400, 'Xuất làm hoa theo đơn phải chọn mã đơn hàng.');
    const order = await (await col(COLLECTIONS.order)).findOne({ DON_HANG_ID: current.DON_HANG_ID }, { session });
    if (!order) throw new InventoryError(400, `Không tìm thấy đơn ${current.DON_HANG_ID}.`);
    // Một đơn cắm chỉ xuất NVL một lần
    const existed = await slips.findOne(
      { DON_HANG_ID: current.DON_HANG_ID, LOAI_XUAT: EXPORT_TYPES.order, TRANG_THAI: DOC_STATUS.posted },
      { session },
    );
    if (existed) {
      throw new InventoryError(409, `Đơn ${current.DON_HANG_ID} đã xuất NVL ở phiếu ${existed.PHIEU_XUAT_ID}. Hao hụt phát sinh khi cắm ghi chú hao hụt sản xuất, không xuất lần 2.`);
    }
  }
  if (type === EXPORT_TYPES.readyMade) {
    if (!current.SAN_PHAM_ID || !(Number(current.SO_BO) > 0)) throw new InventoryError(400, 'Cắm bó sẵn phải chọn sản phẩm và số bó > 0.');
    const product = await (await col(COLLECTIONS.product)).findOne({ SAN_PHAM_ID: current.SAN_PHAM_ID }, { session });
    if (!product) throw new InventoryError(400, 'Sản phẩm không tồn tại.');
  }

  const flipped = await slips.findOneAndUpdate(
    { PHIEU_XUAT_ID: receiptId, TRANG_THAI: DOC_STATUS.draft },
    { $set: { TRANG_THAI: DOC_STATUS.posted, NGUOI_XAC_NHAN: actor.id, NGAY_XAC_NHAN: new Date() } },
    { session, returnDocument: 'after' },
  );
  if (!flipped) return { ...current, alreadyPosted: true };

  const demo = Boolean(current.DU_LIEU_MAU);
  const materials = await col(COLLECTIONS.material);
  const reservationsCol = await col(COLLECTIONS.reservation);
  const detailCol = await col(COLLECTIONS.exportDetail);
  let totalCost = 0;
  const ctx = { docType: 'PX', docId: receiptId, orderId: current.DON_HANG_ID || null, actor, demo };

  for (const d of details) {
    const x = roundQty(d.SO_LUONG_XUAT);
    const material = await materials.findOne({ NGUYEN_VAT_LIEU_ID: d.NGUYEN_VAT_LIEU_ID }, { session });
    if (!material) throw new InventoryError(400, `NVL ${d.NGUYEN_VAT_LIEU_ID} không tồn tại.`);
    const perishable = material.NHOM_NVL === MATERIAL_GROUP.perishable;
    let allocations: { sourceId: string; quantity: number; unitCost: number }[] = [];
    let endedReserved = 0;

    if (type === EXPORT_TYPES.quarantineDisposal) {
      // Sự kiện 13: xuất hủy phần đã cách ly (không đạt)
      if (x > roundQty(material.TON_KHONG_DAT || 0) + 1e-9) {
        throw new InventoryError(409, `${material.TEN_NGUYEN_VAT_LIEU}: chỉ còn ${material.TON_KHONG_DAT || 0} ${material.DON_VI_TINH} đang cách ly.`);
      }
      const sources = (await loadSourcesFifo(session, d.NGUYEN_VAT_LIEU_ID)).filter((s) => Number(s.SL_HONG || 0) > 0);
      const result = allocateFifo(sources, x, (s) => roundQty(s.SL_HONG), d.PHIEU_NHAP_CHI_DINH ? [d.PHIEU_NHAP_CHI_DINH] : []);
      if (result.missing > 0) throw new InventoryError(409, `${material.TEN_NGUYEN_VAT_LIEU}: không đủ lượng cách ly theo nguồn nhập.`);
      allocations = result.allocations;
      for (const a of allocations) {
        await applyMaterialDelta(session, {
          ...ctx, materialId: d.NGUYEN_VAT_LIEU_ID, sourceId: a.sourceId, dOnHand: -a.quantity, dDamaged: -a.quantity,
          type: MOVEMENT_TYPES.dispose, unitCost: a.unitCost, sourceExtraInc: { SL_DA_HUY: a.quantity },
        });
      }
    } else {
      // Kết thúc toàn bộ phần đang giữ của chính đơn (sự kiện 8): giảm đang giữ n
      const own = current.DON_HANG_ID
        ? await reservationsCol.find({
          DON_HANG_ID: current.DON_HANG_ID, LOAI_DOI_TUONG: ITEM_KIND.material, NGUYEN_VAT_LIEU_ID: d.NGUYEN_VAT_LIEU_ID,
          TRANG_THAI: { $in: ACTIVE_RESERVATION_STATUSES },
        }, { session }).toArray()
        : [];
      const preferred: string[] = [];
      for (const r of own) {
        await applyMaterialDelta(session, {
          ...ctx, materialId: d.NGUYEN_VAT_LIEU_ID, sourceId: r.PHIEU_NHAP_NGUON || null, dReserved: -Number(r.SO_LUONG),
          type: MOVEMENT_TYPES.endReservation, reservationId: r.MA_GIU_TON, note: 'Kết thúc giữ khi xuất kho',
        });
        await reservationsCol.updateOne({ _id: r._id }, { $set: { TRANG_THAI: RESERVATION_STATUS.finished, KET_THUC_LUC: new Date(), PHIEU_XUAT_ID: receiptId } }, { session });
        endedReserved = roundQty(endedReserved + Number(r.SO_LUONG));
        if (r.PHIEU_NHAP_NGUON) preferred.push(r.PHIEU_NHAP_NGUON);
      }
      if (x > 0) {
        const fresh = await materials.findOne({ NGUYEN_VAT_LIEU_ID: d.NGUYEN_VAT_LIEU_ID }, { session });
        const limit = availableOf(fresh);
        if (x > limit + 1e-9) {
          throw new InventoryError(409, `${material.TEN_NGUYEN_VAT_LIEU}: xuất ${x} vượt khả dụng ${limit} (đã cộng phần giữ của chính đơn ${endedReserved}).`, {
            materialId: d.NGUYEN_VAT_LIEU_ID, requested: x, available: limit,
          });
        }
        const sources = await loadSourcesFifo(session, d.NGUYEN_VAT_LIEU_ID);
        const result = allocateFifo(sources, x, sourceFree, d.PHIEU_NHAP_CHI_DINH ? [d.PHIEU_NHAP_CHI_DINH, ...preferred] : preferred);
        if (result.missing > 0) {
          throw new InventoryError(409, `${material.TEN_NGUYEN_VAT_LIEU}: nguồn nhập không đủ để phân bổ ${x}.`);
        }
        allocations = result.allocations;
        const avgCost = Number(fresh?.GIA_VON_BQ || fresh?.GIA_NHAP || 0);
        for (const a of allocations) {
          if (!perishable) a.unitCost = avgCost; // phụ kiện: giá vốn bình quân gia quyền
          await applyMaterialDelta(session, {
            ...ctx, materialId: d.NGUYEN_VAT_LIEU_ID, sourceId: a.sourceId, dOnHand: -a.quantity,
            type: type === EXPORT_TYPES.storageLoss ? MOVEMENT_TYPES.dispose : MOVEMENT_TYPES.export,
            unitCost: a.unitCost, sourceExtraInc: { SL_DA_XUAT: a.quantity },
          });
        }
      }
    }

    const lineCost = allocations.reduce((s, a) => s + Math.round(a.quantity * a.unitCost), 0);
    totalCost += lineCost;
    await detailCol.updateOne(
      { _id: d._id },
      {
        $set: {
          PHAN_BO: allocations.map((a) => ({ PHIEU_NHAP_ID: a.sourceId, SO_LUONG: a.quantity, DON_GIA_VON: Math.round(a.unitCost) })),
          SL_GIU_DA_KET_THUC: endedReserved,
          THANH_TIEN_VON: lineCost,
          DON_GIA_VON: x > 0 ? Math.round(lineCost / x) : 0,
        },
      },
      { session },
    );
  }

  if (type === EXPORT_TYPES.readyMade) {
    await applyFinishedDelta(session, {
      productId: current.SAN_PHAM_ID, dOnHand: Number(current.SO_BO), type: MOVEMENT_TYPES.finishedIn,
      docType: 'PX', docId: receiptId, actor, demo, newUnitCost: Math.round(totalCost / Number(current.SO_BO)), unitCost: Math.round(totalCost / Number(current.SO_BO)),
    });
  }
  if (type === EXPORT_TYPES.order) {
    await (await col(COLLECTIONS.demand)).updateMany(
      { DON_HANG_ID: current.DON_HANG_ID, TRANG_THAI: { $in: [DEMAND_STATUS.waiting, DEMAND_STATUS.reserved] } },
      { $set: { TRANG_THAI: DEMAND_STATUS.issued, PHIEU_XUAT_ID: receiptId } },
      { session },
    );
    await (await col(COLLECTIONS.order)).updateOne(
      { DON_HANG_ID: current.DON_HANG_ID },
      { $set: { DA_XUAT_NVL: true, PHIEU_XUAT_NVL_ID: receiptId, NGAY_XUAT_NVL: new Date() } },
      { session },
    );
  }
  await slips.updateOne({ PHIEU_XUAT_ID: receiptId }, { $set: { TONG_GIA_VON: totalCost } }, { session });
  return { ...flipped, TONG_GIA_VON: totalCost, alreadyPosted: false };
});

/* =====================================================================
 * GIỮ TỒN (GIU_TON) — giữ tạm QR / giữ chính thức / nhả / kết thúc
 * ===================================================================== */

export interface ReserveContext {
  status: typeof RESERVATION_STATUS.temporary | typeof RESERVATION_STATUS.official;
  orderId?: string | null;
  paymentSessionId?: string | null;
  neededAt?: Date | null;
  actor: Actor;
  demo?: boolean;
}

export interface Shortage {
  materialId?: string;
  productId?: string;
  name: string;
  unit?: string;
  required: number;
  available: number;
  missing: number;
  reason?: string;
}

const newReservationDoc = (ctx: ReserveContext, extra: Record<string, unknown>) => {
  const id = new ObjectId();
  const now = new Date();
  return {
    _id: id,
    MA_GIU_TON: `GT${id.toHexString().slice(-8).toUpperCase()}`,
    DON_HANG_ID: ctx.orderId || null,
    MA_PHIEN_THANH_TOAN: ctx.paymentSessionId || null,
    TRANG_THAI: ctx.status,
    TAO_LUC: now,
    HET_HAN_LUC: ctx.status === RESERVATION_STATUS.temporary ? new Date(now.getTime() + INVENTORY_CONFIG.holdMinutes * 60_000) : null,
    THOI_DIEM_CAN_DUNG: ctx.neededAt || null,
    NGUOI_TAO: ctx.actor.id,
    ...(ctx.demo ? { DU_LIEU_MAU: true } : {}),
    ...extra,
  };
};

/** Giữ NVL (đã quy đổi theo BOM) — tất cả hoặc không. Ném 409 kèm danh sách thiếu. */
export const reserveMaterialNeeds = async (session: ClientSession, needs: Map<string, number>, ctx: ReserveContext) => {
  const materials = await col(COLLECTIONS.material);
  const docs = await materials.find({ NGUYEN_VAT_LIEU_ID: { $in: [...needs.keys()] } }, { session }).toArray();
  const shortages: Shortage[] = [];
  for (const [id, qty] of needs) {
    const m: any = docs.find((x: any) => x.NGUYEN_VAT_LIEU_ID === id);
    const available = availableOf(m);
    if (!m || available + 1e-9 < qty) {
      shortages.push({ materialId: id, name: m?.TEN_NGUYEN_VAT_LIEU || id, unit: m?.DON_VI_TINH, required: qty, available, missing: roundQty(qty - available) });
    }
  }
  if (shortages.length) throw new InventoryError(409, 'Không đủ NVL khả dụng để giữ tồn.', { shortages });

  const created: any[] = [];
  const resCol = await col(COLLECTIONS.reservation);
  for (const [id, qty] of needs) {
    if (!(qty > 0)) continue;
    const m: any = docs.find((x: any) => x.NGUYEN_VAT_LIEU_ID === id);
    const parts: { sourceId: string | null; quantity: number }[] = [];
    if (m.NHOM_NVL === MATERIAL_GROUP.perishable) {
      const sources = await loadSourcesFifo(session, id);
      const result = allocateFifo(sources, qty, sourceFree);
      if (result.missing > 0) throw new InventoryError(409, `${m.TEN_NGUYEN_VAT_LIEU}: nguồn nhập không đủ để giữ.`, { shortages: [{ materialId: id, name: m.TEN_NGUYEN_VAT_LIEU, required: qty, available: roundQty(qty - result.missing), missing: result.missing }] });
      result.allocations.forEach((a) => parts.push({ sourceId: a.sourceId, quantity: a.quantity }));
    } else {
      parts.push({ sourceId: null, quantity: qty });
    }
    for (const part of parts) {
      const doc = newReservationDoc(ctx, {
        LOAI_DOI_TUONG: ITEM_KIND.material, NGUYEN_VAT_LIEU_ID: id, SAN_PHAM_ID: null, PHIEU_NHAP_NGUON: part.sourceId, SO_LUONG: part.quantity,
      });
      await resCol.insertOne(doc as any, { session });
      await applyMaterialDelta(session, {
        materialId: id, sourceId: part.sourceId, dReserved: part.quantity, type: MOVEMENT_TYPES.reserve,
        docType: 'GIU_TON', docId: doc.MA_GIU_TON, reservationId: doc.MA_GIU_TON, orderId: ctx.orderId, actor: ctx.actor, demo: ctx.demo,
        note: ctx.status,
      });
      created.push(doc);
    }
  }
  return created;
};

/**
 * Giữ tồn cho danh sách sản phẩm: ưu tiên thành phẩm cắm sẵn còn khả dụng, phần còn lại quy đổi BOM → NVL.
 * Dùng cho: tạo QR đơn giao trong ngày (TAM_CHO_QR), hoặc Admin giữ chính thức.
 */
export const reserveProducts = async (items: { productId: string; quantity: number }[], ctx: ReserveContext) => {
  if (!Array.isArray(items) || !items.length) throw new InventoryError(400, 'Chưa có sản phẩm cần giữ.');
  if (ctx.paymentSessionId) {
    const existing = await (await col(COLLECTIONS.reservation)).find({
      MA_PHIEN_THANH_TOAN: ctx.paymentSessionId, TRANG_THAI: { $in: ACTIVE_RESERVATION_STATUSES },
    }).toArray();
    if (existing.length) return { reservations: existing, idempotent: true };
  }
  return withTransaction(async (session) => {
    const created: any[] = [];
    const needs = new Map<string, number>();
    const shortages: Shortage[] = [];
    const products = await col(COLLECTIONS.product);
    const resCol = await col(COLLECTIONS.reservation);

    for (const raw of items) {
      const productId = String(raw.productId || '').trim();
      const quantity = Math.floor(Number(raw.quantity || 0));
      if (!productId || quantity <= 0) throw new InventoryError(400, 'Sản phẩm / số lượng không hợp lệ.');
      const product = await products.findOne({ SAN_PHAM_ID: productId }, { session });
      if (!product) throw new InventoryError(404, `Không tìm thấy sản phẩm ${productId}.`);
      const finished = Math.min(quantity, Math.floor(finishedAvailableOf(product)));
      if (finished > 0) {
        const doc = newReservationDoc(ctx, { LOAI_DOI_TUONG: ITEM_KIND.finishedGood, SAN_PHAM_ID: productId, NGUYEN_VAT_LIEU_ID: null, PHIEU_NHAP_NGUON: null, SO_LUONG: finished });
        await resCol.insertOne(doc as any, { session });
        await applyFinishedDelta(session, {
          productId, dReserved: finished, type: MOVEMENT_TYPES.reserve, docType: 'GIU_TON', docId: doc.MA_GIU_TON,
          reservationId: doc.MA_GIU_TON, orderId: ctx.orderId, actor: ctx.actor, demo: ctx.demo, note: ctx.status,
        });
        created.push(doc);
      }
      const toMake = quantity - finished;
      if (toMake > 0) {
        const { lines } = await getActiveBom(productId, session);
        if (!lines.length) {
          shortages.push({ productId, name: product.TEN_SAN_PHAM, required: toMake, available: 0, missing: toMake, reason: 'Sản phẩm chưa có BOM và hết thành phẩm.' });
          continue;
        }
        lines.forEach((l) => needs.set(l.NGUYEN_VAT_LIEU_ID, roundQty((needs.get(l.NGUYEN_VAT_LIEU_ID) || 0) + ceilQty(l.DINH_LUONG * toMake))));
      }
    }
    if (shortages.length) throw new InventoryError(409, 'Không đủ hàng để giữ.', { shortages });
    created.push(...(await reserveMaterialNeeds(session, needs, ctx)));
    return { reservations: created, idempotent: false };
  });
};

const releaseOne = async (session: ClientSession, r: any, actor: Actor, reason: string) => {
  const updated = await (await col(COLLECTIONS.reservation)).findOneAndUpdate(
    { _id: r._id, TRANG_THAI: { $in: ACTIVE_RESERVATION_STATUSES } },
    { $set: { TRANG_THAI: RESERVATION_STATUS.released, NHA_LUC: new Date(), LY_DO_NHA: reason } },
    { session, returnDocument: 'after' },
  );
  if (!updated) return false; // đã nhả/kết thúc ở request khác → không trừ 2 lần
  const base = { docType: 'GIU_TON', docId: r.MA_GIU_TON, reservationId: r.MA_GIU_TON, orderId: r.DON_HANG_ID, actor, demo: Boolean(r.DU_LIEU_MAU), note: reason };
  if (r.LOAI_DOI_TUONG === ITEM_KIND.finishedGood) {
    await applyFinishedDelta(session, { ...base, productId: r.SAN_PHAM_ID, dReserved: -Number(r.SO_LUONG), type: MOVEMENT_TYPES.release });
  } else {
    await applyMaterialDelta(session, { ...base, materialId: r.NGUYEN_VAT_LIEU_ID, sourceId: r.PHIEU_NHAP_NGUON || null, dReserved: -Number(r.SO_LUONG), type: MOVEMENT_TYPES.release });
  }
  return true;
};

export const releaseReservations = async (filter: { orderId?: string; paymentSessionId?: string; reservationIds?: string[] }, actor: Actor, reason = 'Nhả giữ') => {
  const query: any = { TRANG_THAI: { $in: ACTIVE_RESERVATION_STATUSES } };
  if (filter.orderId) query.DON_HANG_ID = filter.orderId;
  if (filter.paymentSessionId) query.MA_PHIEN_THANH_TOAN = filter.paymentSessionId;
  if (filter.reservationIds?.length) query.MA_GIU_TON = { $in: filter.reservationIds };
  if (!filter.orderId && !filter.paymentSessionId && !filter.reservationIds?.length) throw new InventoryError(400, 'Thiếu điều kiện nhả giữ.');
  return withTransaction(async (session) => {
    const rows = await (await col(COLLECTIONS.reservation)).find(query, { session }).toArray();
    let released = 0;
    for (const r of rows) if (await releaseOne(session, r, actor, reason)) released++;
    return { released };
  });
};

/** Thanh toán hợp lệ trong hạn: TAM_CHO_QR → CHINH_THUC, không giữ thêm (sự kiện 4). Idempotent. */
export const confirmReservations = async (filter: { paymentSessionId?: string; orderId?: string }, attachOrderId: string | null, actor: Actor) => {
  if (!filter.paymentSessionId && !filter.orderId) throw new InventoryError(400, 'Thiếu mã phiên thanh toán hoặc mã đơn.');
  return withTransaction(async (session) => {
    const resCol = await col(COLLECTIONS.reservation);
    const query: any = filter.paymentSessionId ? { MA_PHIEN_THANH_TOAN: filter.paymentSessionId } : { DON_HANG_ID: filter.orderId };
    const rows = await resCol.find(query, { session }).toArray();
    if (!rows.length) throw new InventoryError(404, 'Không có lượng giữ nào cho phiên/đơn này.');
    const now = new Date();
    if (rows.some((r: any) => r.TRANG_THAI === RESERVATION_STATUS.released || (r.TRANG_THAI === RESERVATION_STATUS.temporary && r.HET_HAN_LUC && new Date(r.HET_HAN_LUC) < now))) {
      throw new InventoryError(410, 'Phiên giữ tạm đã hết hạn hoặc đã nhả. Khách cần tạo phiên thanh toán mới.');
    }
    let confirmed = 0;
    for (const r of rows.filter((x: any) => x.TRANG_THAI === RESERVATION_STATUS.temporary)) {
      await resCol.updateOne({ _id: r._id }, { $set: { TRANG_THAI: RESERVATION_STATUS.official, XAC_NHAN_LUC: now, DON_HANG_ID: attachOrderId || r.DON_HANG_ID } }, { session });
      confirmed++;
    }
    return { confirmed, alreadyConfirmed: confirmed === 0 };
  });
};

/** Nhả các lượng giữ tạm QR đã hết hạn. Gọi định kỳ từ server. */
export const sweepExpiredReservations = async () => {
  const rows = await (await col(COLLECTIONS.reservation)).find({
    TRANG_THAI: RESERVATION_STATUS.temporary, HET_HAN_LUC: { $lt: new Date() },
  }).limit(200).toArray();
  let released = 0;
  for (const r of rows) {
    try {
      const ok = await withTransaction((session) => releaseOne(session, r, { id: 'SYSTEM', role: 'system' }, 'Hết hạn giữ tạm chờ thanh toán'));
      if (ok) released++;
    } catch (error) {
      console.error('[inventory] Không nhả được giữ tồn hết hạn', r.MA_GIU_TON, error);
    }
  }
  return { released };
};

/* =====================================================================
 * NHU CẦU NVL DỰ KIẾN (đơn giao ngày khác) & lịch chuẩn bị T
 * ===================================================================== */

export const recordOrderDemand = async (orderId: string, body: { items?: { productId: string; quantity: number }[]; neededAt?: string }, actor: Actor, options: { demo?: boolean } = {}) => {
  const order = await (await col(COLLECTIONS.order)).findOne({ DON_HANG_ID: orderId });
  if (!order) throw new InventoryError(404, 'Không tìm thấy đơn hàng.');
  const items = body.items?.length
    ? body.items
    : (await (await col(COLLECTIONS.orderDetail)).find({ DON_HANG_ID: orderId }).toArray()).map((d: any) => ({ productId: d.SAN_PHAM_ID, quantity: d.SO_LUONG }));
  const demandCol = await col(COLLECTIONS.demand);
  const existing = await demandCol.countDocuments({ DON_HANG_ID: orderId, TRANG_THAI: { $ne: DEMAND_STATUS.cancelled } });
  if (existing) throw new InventoryError(409, 'Đơn đã có nhu cầu NVL. Hủy nhu cầu cũ trước khi ghi lại.');
  const neededAt = parseDate(body.neededAt);
  const rows: any[] = [];
  for (const item of items) {
    const { bom, lines } = await getActiveBom(item.productId);
    lines.forEach((l) => rows.push({
      _id: new ObjectId(),
      DON_HANG_ID: orderId,
      SAN_PHAM_ID: item.productId,
      BOM_ID: bom?.BOM_ID || null,
      BOM_PHIEN_BAN: bom?.PHIEN_BAN || null,
      NGUYEN_VAT_LIEU_ID: l.NGUYEN_VAT_LIEU_ID,
      SO_LUONG: ceilQty(l.DINH_LUONG * Number(item.quantity || 1)),
      DON_VI_TINH: l.DON_VI_TINH,
      THOI_DIEM_CAN_DUNG: neededAt,
      TRANG_THAI: DEMAND_STATUS.waiting,
      TAO_LUC: new Date(),
      NGUOI_TAO: actor.id,
      ...(options.demo ? { DU_LIEU_MAU: true } : {}),
    }));
  }
  if (rows.length) await demandCol.insertMany(rows);
  return { created: rows.length, rows };
};

/** Admin nhập/đổi T (thời điểm bắt đầu chuẩn bị) — không tự xếp lịch. */
export const setOrderPrepTime = async (orderId: string, neededAtRaw: unknown, actor: Actor) => {
  const neededAt = parseDate(neededAtRaw);
  if (!neededAt) throw new InventoryError(400, 'Thời điểm chuẩn bị T không hợp lệ.');
  await (await col(COLLECTIONS.demand)).updateMany({ DON_HANG_ID: orderId, TRANG_THAI: DEMAND_STATUS.waiting }, { $set: { THOI_DIEM_CAN_DUNG: neededAt } });
  await (await col(COLLECTIONS.reservation)).updateMany({ DON_HANG_ID: orderId, TRANG_THAI: { $in: ACTIVE_RESERVATION_STATUSES } }, { $set: { THOI_DIEM_CAN_DUNG: neededAt } });
  await (await col(COLLECTIONS.order)).updateOne({ DON_HANG_ID: orderId }, { $set: { THOI_DIEM_BAT_DAU_CHUAN_BI: neededAt, NGUOI_NHAP_T: actor.id } });
  return { orderId, neededAt };
};

/** Sự kiện 6: đến lịch trước T → giữ chính thức phần nhu cầu dự kiến. */
export const reserveOrderDemand = async (orderId: string, actor: Actor, options: { demo?: boolean } = {}) => withTransaction(async (session) => {
  const demandCol = await col(COLLECTIONS.demand);
  const rows = await demandCol.find({ DON_HANG_ID: orderId, TRANG_THAI: DEMAND_STATUS.waiting }, { session }).toArray();
  if (!rows.length) throw new InventoryError(404, 'Đơn không có nhu cầu NVL đang chờ giữ.');
  const needs = new Map<string, number>();
  rows.forEach((r: any) => needs.set(r.NGUYEN_VAT_LIEU_ID, roundQty((needs.get(r.NGUYEN_VAT_LIEU_ID) || 0) + Number(r.SO_LUONG))));
  const neededAt = rows.find((r: any) => r.THOI_DIEM_CAN_DUNG)?.THOI_DIEM_CAN_DUNG || null;
  const reservations = await reserveMaterialNeeds(session, needs, {
    status: RESERVATION_STATUS.official, orderId, neededAt, actor, demo: options.demo,
  });
  await demandCol.updateMany({ _id: { $in: rows.map((r: any) => r._id) } }, { $set: { TRANG_THAI: DEMAND_STATUS.reserved, GIU_LUC: new Date() } }, { session });
  return { reservations };
});

/** Sự kiện 10: hủy đơn trước khi xuất NVL → nhả giữ + hủy nhu cầu dự kiến. */
export const cancelOrderInventory = async (orderId: string, actor: Actor) => {
  const released = await releaseReservations({ orderId }, actor, 'Hủy đơn trước khi xuất NVL').catch((e) => {
    if (e instanceof InventoryError && e.status === 400) return { released: 0 };
    throw e;
  });
  const demand = await (await col(COLLECTIONS.demand)).updateMany(
    { DON_HANG_ID: orderId, TRANG_THAI: DEMAND_STATUS.waiting },
    { $set: { TRANG_THAI: DEMAND_STATUS.cancelled, HUY_LUC: new Date() } },
  );
  return { ...released, cancelledDemands: demand.modifiedCount };
};

/** Sự kiện 9 (bó cắm sẵn): giao hàng thành công → giảm thành phẩm đã giữ. Không trừ NVL. */
export const shipFinishedGoodsForOrder = async (orderId: string, actor: Actor) => withTransaction(async (session) => {
  const resCol = await col(COLLECTIONS.reservation);
  const rows = await resCol.find({ DON_HANG_ID: orderId, LOAI_DOI_TUONG: ITEM_KIND.finishedGood, TRANG_THAI: { $in: ACTIVE_RESERVATION_STATUSES } }, { session }).toArray();
  for (const r of rows) {
    await resCol.updateOne({ _id: r._id }, { $set: { TRANG_THAI: RESERVATION_STATUS.finished, KET_THUC_LUC: new Date() } }, { session });
    await applyFinishedDelta(session, {
      productId: r.SAN_PHAM_ID, dOnHand: -Number(r.SO_LUONG), dReserved: -Number(r.SO_LUONG), type: MOVEMENT_TYPES.finishedOut,
      docType: 'DON_HANG', docId: orderId, orderId, reservationId: r.MA_GIU_TON, actor, demo: Boolean(r.DU_LIEU_MAU),
    });
  }
  return { shipped: rows.length };
});

/* =====================================================================
 * KHÔNG ĐẠT / HAO HỤT / THÀNH PHẨM
 * ===================================================================== */

/** Sự kiện 12: đánh dấu phần CHƯA GIỮ không đạt → giảm khả dụng, tồn thực giữ nguyên. */
export const markMaterialDamaged = async (body: { materialId: string; quantity: number; sourceId?: string; note?: string }, actor: Actor, options: { demo?: boolean } = {}) =>
  withTransaction(async (session) => {
    const quantity = roundQty(body.quantity);
    if (!(quantity > 0)) throw new InventoryError(400, 'Số lượng không đạt phải > 0.');
    const sources = await loadSourcesFifo(session, body.materialId);
    const result = allocateFifo(
      body.sourceId ? sources.filter((s) => s.PHIEU_NHAP_ID === body.sourceId) : sources,
      quantity,
      sourceFree,
    );
    if (result.missing > 0) {
      throw new InventoryError(409, 'Lượng chưa giữ không đủ để đánh dấu. Nếu hỏng phần đang giữ, hãy nhả/chuyển giữ trước.');
    }
    for (const a of result.allocations) {
      await applyMaterialDelta(session, {
        materialId: body.materialId, sourceId: a.sourceId, dDamaged: a.quantity, type: MOVEMENT_TYPES.markDamaged,
        docType: 'DANH_DAU', note: body.note || 'Không đạt chất lượng', actor, demo: options.demo,
      });
    }
    return { allocations: result.allocations };
  });

export const disposeFinishedGoods = async (productId: string, quantityRaw: unknown, note: string, actor: Actor) =>
  withTransaction(async (session) => {
    const quantity = Math.floor(Number(quantityRaw));
    if (!(quantity > 0)) throw new InventoryError(400, 'Số bó hủy phải > 0.');
    await applyFinishedDelta(session, { productId, dOnHand: -quantity, type: MOVEMENT_TYPES.finishedDispose, docType: 'HUY_TP', note: note || 'Bó không đạt chất lượng', actor });
    return { disposed: quantity };
  });

/* =====================================================================
 * ĐỐI SOÁT — so bộ đếm với sổ biến động & chứng từ
 * ===================================================================== */

export const reconcileInventory = async (fix = false) => {
  const movements = await col(COLLECTIONS.movement);
  const byMaterial = await movements.aggregate([
    { $match: { LOAI_DOI_TUONG: ITEM_KIND.material } },
    { $group: { _id: '$NGUYEN_VAT_LIEU_ID', onHand: { $sum: '$DELTA_TON_THUC' }, reserved: { $sum: '$DELTA_DANG_GIU' }, damaged: { $sum: '$DELTA_KHONG_DAT' } } },
  ]).toArray();
  const bySource = await movements.aggregate([
    { $match: { LOAI_DOI_TUONG: ITEM_KIND.material, PHIEU_NHAP_NGUON: { $ne: null } } },
    { $group: { _id: { m: '$NGUYEN_VAT_LIEU_ID', s: '$PHIEU_NHAP_NGUON' }, onHand: { $sum: '$DELTA_TON_THUC' }, reserved: { $sum: '$DELTA_DANG_GIU' }, damaged: { $sum: '$DELTA_KHONG_DAT' } } },
  ]).toArray();
  const byFinished = await movements.aggregate([
    { $match: { LOAI_DOI_TUONG: ITEM_KIND.finishedGood } },
    { $group: { _id: '$SAN_PHAM_ID', onHand: { $sum: '$DELTA_TON_THUC' }, reserved: { $sum: '$DELTA_DANG_GIU' } } },
  ]).toArray();
  const activeRes = await (await col(COLLECTIONS.reservation)).aggregate([
    { $match: { TRANG_THAI: { $in: ACTIVE_RESERVATION_STATUSES }, LOAI_DOI_TUONG: ITEM_KIND.material } },
    { $group: { _id: '$NGUYEN_VAT_LIEU_ID', qty: { $sum: '$SO_LUONG' } } },
  ]).toArray();

  const materialsCol = await col(COLLECTIONS.material);
  const sourcesCol = await col(COLLECTIONS.importDetail);
  const productsCol = await col(COLLECTIONS.product);
  const materials = await materialsCol.find({}).toArray();
  const ledger = new Map(byMaterial.map((r: any) => [r._id, r]));
  const resMap = new Map(activeRes.map((r: any) => [r._id, r.qty]));
  const diffs: any[] = [];
  const near = (a: number, b: number) => Math.abs(roundQty(a) - roundQty(b)) < 1e-6;

  for (const m of materials as any[]) {
    const l: any = ledger.get(m.NGUYEN_VAT_LIEU_ID) || { onHand: 0, reserved: 0, damaged: 0 };
    const expected = { TON_THUC: roundQty(l.onHand), TON_DANG_GIU: roundQty(l.reserved), TON_KHONG_DAT: roundQty(l.damaged) };
    const reservationDocs = roundQty(resMap.get(m.NGUYEN_VAT_LIEU_ID) || 0);
    const ok = near(m.TON_THUC || 0, expected.TON_THUC) && near(m.TON_DANG_GIU || 0, expected.TON_DANG_GIU) && near(m.TON_KHONG_DAT || 0, expected.TON_KHONG_DAT) && near(reservationDocs, expected.TON_DANG_GIU);
    if (!ok) {
      diffs.push({ kind: 'NVL', id: m.NGUYEN_VAT_LIEU_ID, name: m.TEN_NGUYEN_VAT_LIEU, counters: { TON_THUC: m.TON_THUC || 0, TON_DANG_GIU: m.TON_DANG_GIU || 0, TON_KHONG_DAT: m.TON_KHONG_DAT || 0 }, ledger: expected, reservationDocs });
      if (fix) await materialsCol.updateOne({ _id: m._id }, { $set: { ...expected, SO_LUONG_TON: expected.TON_THUC } });
    }
  }
  for (const s of bySource as any[]) {
    const src = await sourcesCol.findOne({ PHIEU_NHAP_ID: s._id.s, NGUYEN_VAT_LIEU_ID: s._id.m, LA_NGUON_NHAP: true });
    if (!src) { diffs.push({ kind: 'NGUON', id: `${s._id.s}/${s._id.m}`, problem: 'Sổ có biến động nhưng không còn dòng nguồn nhập' }); continue; }
    if (!near(src.SL_CON_LAI || 0, s.onHand) || !near(src.SL_HONG || 0, s.damaged) || !near(src.SL_DANG_GIU || 0, s.reserved)) {
      diffs.push({ kind: 'NGUON', id: `${s._id.s}/${s._id.m}`, counters: { SL_CON_LAI: src.SL_CON_LAI, SL_HONG: src.SL_HONG, SL_DANG_GIU: src.SL_DANG_GIU }, ledger: { SL_CON_LAI: roundQty(s.onHand), SL_HONG: roundQty(s.damaged), SL_DANG_GIU: roundQty(s.reserved) } });
      if (fix) await sourcesCol.updateOne({ _id: src._id }, { $set: { SL_CON_LAI: roundQty(s.onHand), SL_HONG: roundQty(s.damaged), SL_DANG_GIU: roundQty(s.reserved) } });
    }
  }
  const finishedLedger = new Map(byFinished.map((r: any) => [r._id, r]));
  const products = await productsCol.find({ $or: [{ TON_THANH_PHAM: { $exists: true } }, { SAN_PHAM_ID: { $in: [...finishedLedger.keys()] } }] }).toArray();
  for (const p of products as any[]) {
    const l: any = finishedLedger.get(p.SAN_PHAM_ID) || { onHand: 0, reserved: 0 };
    if (!near(p.TON_THANH_PHAM || 0, l.onHand) || !near(p.TP_DANG_GIU || 0, l.reserved)) {
      diffs.push({ kind: 'THANH_PHAM', id: p.SAN_PHAM_ID, counters: { TON_THANH_PHAM: p.TON_THANH_PHAM || 0, TP_DANG_GIU: p.TP_DANG_GIU || 0 }, ledger: { TON_THANH_PHAM: roundQty(l.onHand), TP_DANG_GIU: roundQty(l.reserved) } });
      if (fix) await productsCol.updateOne({ _id: p._id }, { $set: { TON_THANH_PHAM: roundQty(l.onHand), TP_DANG_GIU: roundQty(l.reserved) } });
    }
  }
  return { ok: diffs.length === 0, checkedMaterials: materials.length, diffs, fixed: fix && diffs.length > 0 };
};
