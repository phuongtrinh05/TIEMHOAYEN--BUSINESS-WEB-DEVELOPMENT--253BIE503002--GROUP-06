import {
  ACTIVE_RESERVATION_STATUSES,
  COLLECTIONS,
  DOC_STATUS,
  MATERIAL_GROUP,
  MATERIAL_STATUS,
  MATERIAL_TYPES,
  PO_STATUS,
  SUPPLIER_ACTIVE_STATUSES,
  SUPPLIER_STATUSES,
} from './constants.js';
import { availableOf, col, finishedAvailableOf, InventoryError, money, nextCode, normalizeText, parseDate, roundQty, toPositiveQty, type Actor } from './helpers.js';
import { materialStockStatus } from './availability.service.js';

/* =====================================================================
 * NGUYÊN VẬT LIỆU (AD21–AD23) — danh mục KHÔNG chứa thao tác sửa tồn
 * ===================================================================== */

export const mapMaterial = (m: any) => {
  const status = materialStockStatus(m);
  return {
    code: m.NGUYEN_VAT_LIEU_ID,
    name: m.TEN_NGUYEN_VAT_LIEU || '',
    image: m.URL_HINH_ANH || '',
    unit: m.DON_VI_TINH || '',
    description: m.MO_TA || '',
    group: m.NHOM_NVL || MATERIAL_GROUP.durable,
    type: m.LOAI_NVL || '',
    importPrice: Number(m.GIA_NHAP || 0),
    sellPrice: Number(m.GIA_BAN || 0),
    averageCost: Number(m.GIA_VON_BQ || m.GIA_NHAP || 0),
    threshold: Number(m.NGUONG_CANH_BAO || 0),
    maxLevel: Number(m.NGUONG_TOI_DA || 0),
    shelfDays: m.SO_NGAY_BAO_QUAN ?? null,
    substitutionGroup: m.NHOM_THAY_THE || '',
    purchaseUnit: m.DON_VI_MUA || '',
    conversionRate: Number(m.HE_SO_QUY_DOI || 1),
    active: m.TRANG_THAI !== MATERIAL_STATUS.hidden,
    statusLabel: m.TRANG_THAI || MATERIAL_STATUS.active,
    onHand: roundQty(m.TON_THUC || 0),
    reserved: roundQty(m.TON_DANG_GIU || 0),
    damaged: roundQty(m.TON_KHONG_DAT || 0),
    available: availableOf(m),
    // tương thích FE cũ
    quantity: availableOf(m),
    stockStatus: status.code,
    status: status.label,
    updatedAt: m.NGAY_CAP_NHAT || null,
    updatedBy: m.NGUOI_CAP_NHAT || null,
  };
};

export const listMaterials = async (query: any = {}) => {
  const filter: any = {};
  if (query.includeHidden !== 'true') filter.TRANG_THAI = { $ne: MATERIAL_STATUS.hidden };
  if (query.type) filter.LOAI_NVL = query.type;
  if (query.group) filter.NHOM_NVL = query.group;
  const rows = await (await col(COLLECTIONS.material)).find(filter).sort({ NGUYEN_VAT_LIEU_ID: 1 }).toArray();
  let materials = rows.map(mapMaterial);
  if (query.search) {
    const q = normalizeText(query.search);
    materials = materials.filter((m) => normalizeText(`${m.code} ${m.name} ${m.type}`).includes(q));
  }
  if (query.stockStatus) materials = materials.filter((m) => m.stockStatus === query.stockStatus);
  return { total: materials.length, materials, types: MATERIAL_TYPES };
};

const materialPayload = (body: any, partial: boolean) => {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (!partial || value !== undefined) out[key] = value; };
  set('TEN_NGUYEN_VAT_LIEU', body.name === undefined ? undefined : String(body.name).trim());
  set('DON_VI_TINH', body.unit === undefined ? undefined : String(body.unit).trim());
  set('MO_TA', body.description === undefined ? undefined : String(body.description || ''));
  set('URL_HINH_ANH', body.image === undefined ? undefined : String(body.image || ''));
  set('NHOM_NVL', body.group === undefined ? undefined : (body.group === MATERIAL_GROUP.perishable ? MATERIAL_GROUP.perishable : MATERIAL_GROUP.durable));
  set('LOAI_NVL', body.type === undefined ? undefined : String(body.type || ''));
  set('GIA_NHAP', body.importPrice === undefined ? undefined : money(body.importPrice));
  set('GIA_BAN', body.sellPrice === undefined ? undefined : money(body.sellPrice));
  set('NGUONG_CANH_BAO', body.threshold === undefined ? undefined : Math.max(0, roundQty(body.threshold)));
  set('NGUONG_TOI_DA', body.maxLevel === undefined ? undefined : Math.max(0, roundQty(body.maxLevel)));
  set('SO_NGAY_BAO_QUAN', body.shelfDays === undefined ? undefined : (body.shelfDays === null || body.shelfDays === '' ? null : Math.max(0, Number(body.shelfDays))));
  set('NHOM_THAY_THE', body.substitutionGroup === undefined ? undefined : (String(body.substitutionGroup || '').trim().toUpperCase() || null));
  set('DON_VI_MUA', body.purchaseUnit === undefined ? undefined : String(body.purchaseUnit || ''));
  set('HE_SO_QUY_DOI', body.conversionRate === undefined ? undefined : Math.max(1, Number(body.conversionRate) || 1));
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
};

export const createMaterial = async (body: any, actor: Actor) => {
  const name = String(body.name || '').trim();
  const unit = String(body.unit || '').trim();
  if (!name) throw new InventoryError(400, 'Tên NVL là bắt buộc.');
  if (!unit) throw new InventoryError(400, 'Đơn vị tính là bắt buộc.');
  if (body.quantity || body.onHand) {
    throw new InventoryError(400, 'Không nhập tồn khi tạo NVL. Tồn đầu kỳ ghi bằng phiếu nhập loại "Tồn đầu kỳ".');
  }
  const materials = await col(COLLECTIONS.material);
  const duplicate = (await materials.find({}).project({ TEN_NGUYEN_VAT_LIEU: 1, DON_VI_TINH: 1 }).toArray())
    .find((m: any) => normalizeText(m.TEN_NGUYEN_VAT_LIEU) === normalizeText(name) && normalizeText(m.DON_VI_TINH) === normalizeText(unit));
  if (duplicate) throw new InventoryError(409, `Đã có NVL "${name}" (${unit}).`);
  const code = String(body.code || '').trim() || await nextCode(COLLECTIONS.material, 'NGUYEN_VAT_LIEU_ID', 'NVL', 3);
  if (await materials.findOne({ NGUYEN_VAT_LIEU_ID: code })) throw new InventoryError(409, `Mã ${code} đã tồn tại.`);
  const doc = {
    _id: code,
    NGUYEN_VAT_LIEU_ID: code,
    ...materialPayload(body, false),
    TRANG_THAI: MATERIAL_STATUS.active,
    TON_THUC: 0, SO_LUONG_TON: 0, TON_DANG_GIU: 0, TON_KHONG_DAT: 0, GIA_VON_BQ: money(body.importPrice),
    NGAY_TAO: new Date(), NGUOI_TAO: actor.id,
  };
  await materials.insertOne(doc as any);
  return mapMaterial(doc);
};

export const updateMaterial = async (materialId: string, body: any, actor: Actor) => {
  const materials = await col(COLLECTIONS.material);
  const current = await materials.findOne({ NGUYEN_VAT_LIEU_ID: materialId });
  if (!current) throw new InventoryError(404, 'Không tìm thấy NVL.');
  const payload = materialPayload(body, true);
  if (payload.DON_VI_TINH && payload.DON_VI_TINH !== current.DON_VI_TINH && Number(current.TON_THUC || 0) > 0) {
    throw new InventoryError(409, 'NVL còn tồn, không được đổi đơn vị tính (cần quy đổi có kiểm soát).');
  }
  if (body.active !== undefined) payload.TRANG_THAI = body.active ? MATERIAL_STATUS.active : MATERIAL_STATUS.hidden;
  const updated = await materials.findOneAndUpdate(
    { NGUYEN_VAT_LIEU_ID: materialId },
    { $set: { ...payload, NGAY_CAP_NHAT: new Date(), NGUOI_CAP_NHAT: actor.id } },
    { returnDocument: 'after' },
  );
  return mapMaterial(updated);
};

/** AD30: NVL đã phát sinh chứng từ/BOM chỉ được ẩn, không xóa cứng. */
export const deleteOrHideMaterial = async (materialId: string, actor: Actor) => {
  const used = await Promise.all([
    (await col(COLLECTIONS.importDetail)).countDocuments({ NGUYEN_VAT_LIEU_ID: materialId }),
    (await col(COLLECTIONS.exportDetail)).countDocuments({ NGUYEN_VAT_LIEU_ID: materialId }),
    (await col(COLLECTIONS.bomLine)).countDocuments({ NGUYEN_VAT_LIEU_ID: materialId }),
    (await col(COLLECTIONS.legacyRecipe)).countDocuments({ NGUYEN_VAT_LIEU_ID: materialId }),
    (await col(COLLECTIONS.reservation)).countDocuments({ NGUYEN_VAT_LIEU_ID: materialId }),
  ]);
  const materials = await col(COLLECTIONS.material);
  if (used.some((n) => n > 0)) {
    await materials.updateOne({ NGUYEN_VAT_LIEU_ID: materialId }, { $set: { TRANG_THAI: MATERIAL_STATUS.hidden, NGAY_CAP_NHAT: new Date(), NGUOI_CAP_NHAT: actor.id } });
    return { hidden: true, message: 'NVL đã phát sinh giao dịch/BOM nên chỉ chuyển sang "Ngừng sử dụng".' };
  }
  await materials.deleteOne({ NGUYEN_VAT_LIEU_ID: materialId });
  return { deleted: true };
};

export const getMaterialDetail = async (materialId: string) => {
  const material = await (await col(COLLECTIONS.material)).findOne({ NGUYEN_VAT_LIEU_ID: materialId });
  if (!material) throw new InventoryError(404, 'Không tìm thấy NVL.');
  const [sources, reservations, movements, supplierLinks, bomUsage] = await Promise.all([
    (await col(COLLECTIONS.importDetail)).find({ NGUYEN_VAT_LIEU_ID: materialId, LA_NGUON_NHAP: true, SL_CON_LAI: { $gt: 0 } }).sort({ THOI_DIEM_NHAN: 1, PHIEU_NHAP_ID: 1 }).toArray(),
    (await col(COLLECTIONS.reservation)).find({ NGUYEN_VAT_LIEU_ID: materialId, TRANG_THAI: { $in: ACTIVE_RESERVATION_STATUSES } }).sort({ TAO_LUC: 1 }).toArray(),
    (await col(COLLECTIONS.movement)).find({ NGUYEN_VAT_LIEU_ID: materialId }).sort({ THOI_DIEM: -1 }).limit(50).toArray(),
    (await col(COLLECTIONS.supplierMaterial)).find({ NGUYEN_VAT_LIEU_ID: materialId }).sort({ UU_TIEN: 1 }).toArray(),
    (await col(COLLECTIONS.bomLine)).countDocuments({ NGUYEN_VAT_LIEU_ID: materialId }),
  ]);
  const suppliers = await (await col(COLLECTIONS.supplier)).find({ NHA_CUNG_CAP_ID: { $in: supplierLinks.map((s: any) => s.NHA_CUNG_CAP_ID) } }).toArray();
  return {
    material: mapMaterial(material),
    sources: sources.map((s: any) => ({
      sourceId: s.PHIEU_NHAP_ID, receivedAt: s.THOI_DIEM_NHAN, supplierId: s.NHA_CUNG_CAP_ID || null, unitCost: s.DON_GIA_VON,
      accepted: s.SL_DAT, remaining: s.SL_CON_LAI, damaged: s.SL_HONG || 0, reserved: s.SL_DANG_GIU || 0,
      usable: roundQty(Number(s.SL_CON_LAI) - Number(s.SL_HONG || 0) - Number(s.SL_DANG_GIU || 0)),
    })),
    reservations,
    movements,
    suppliers: supplierLinks.map((link: any) => ({ ...link, supplier: suppliers.find((s: any) => s.NHA_CUNG_CAP_ID === link.NHA_CUNG_CAP_ID) || null })),
    usedInBoms: bomUsage,
  };
};

/* =====================================================================
 * NHÀ CUNG CẤP (AD30–AD32) + NGUỒN CUNG THEO NVL
 * ===================================================================== */

const supplierPayload = (body: any) => {
  const pick = (a: any, b: any) => (a !== undefined ? a : b);
  const out: Record<string, unknown> = {
    TEN_NHA_CUNG_CAP: pick(body.name, body.TEN_NHA_CUNG_CAP),
    NGUOI_DAI_DIEN: pick(body.representative, body.NGUOI_DAI_DIEN),
    SDT: pick(body.phone, body.SDT),
    EMAIL: pick(body.email, body.EMAIL),
    DIA_CHI: pick(body.address, body.DIA_CHI),
    MA_SO_THUE: pick(body.taxCode, body.MA_SO_THUE),
    TRANG_THAI: pick(body.status, body.TRANG_THAI),
    LOGO: pick(body.logo, body.LOGO),
    DIEU_KHOAN_THANH_TOAN: pick(body.paymentTerms, body.DIEU_KHOAN_THANH_TOAN),
    GIO_CHOT_DON: pick(body.orderCutoffTime, body.GIO_CHOT_DON),
    SO_NGAY_GIAO_MAC_DINH: body.defaultLeadDays !== undefined ? Math.max(0, Number(body.defaultLeadDays) || 0) : body.SO_NGAY_GIAO_MAC_DINH,
    GHI_CHU: pick(body.note, body.GHI_CHU),
  };
  if (out.TRANG_THAI !== undefined && !SUPPLIER_STATUSES.includes(out.TRANG_THAI as any)) {
    throw new InventoryError(400, `Trạng thái NCC không hợp lệ. Chọn: ${SUPPLIER_STATUSES.join(', ')}.`);
  }
  if (out.GIO_CHOT_DON !== undefined && out.GIO_CHOT_DON !== null && out.GIO_CHOT_DON !== '' && !/^\d{2}:\d{2}$/.test(String(out.GIO_CHOT_DON))) {
    throw new InventoryError(400, 'Giờ chốt đơn phải dạng HH:mm.');
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
};

export const listSuppliers = async (query: any = {}) => {
  const rows = await (await col(COLLECTIONS.supplier)).find({}).sort({ NHA_CUNG_CAP_ID: 1 }).toArray();
  const links = await (await col(COLLECTIONS.supplierMaterial)).aggregate([{ $group: { _id: '$NHA_CUNG_CAP_ID', n: { $sum: 1 } } }]).toArray();
  const count = new Map(links.map((l: any) => [l._id, l.n]));
  let suppliers = rows.map((s: any) => ({ ...s, SO_NVL_CUNG_CAP: count.get(s.NHA_CUNG_CAP_ID) || 0, DANG_HOAT_DONG: SUPPLIER_ACTIVE_STATUSES.includes(s.TRANG_THAI) }));
  if (query.search) {
    const q = normalizeText(query.search);
    suppliers = suppliers.filter((s: any) => normalizeText(`${s.NHA_CUNG_CAP_ID} ${s.TEN_NHA_CUNG_CAP} ${s.SDT} ${s.EMAIL}`).includes(q));
  }
  if (query.status) suppliers = suppliers.filter((s: any) => s.TRANG_THAI === query.status);
  return { total: suppliers.length, suppliers, statuses: SUPPLIER_STATUSES };
};

export const createSupplier = async (body: any, actor: Actor) => {
  const payload = supplierPayload(body);
  if (!String(payload.TEN_NHA_CUNG_CAP || '').trim()) throw new InventoryError(400, 'Tên nhà cung cấp là bắt buộc.');
  const suppliers = await col(COLLECTIONS.supplier);
  const all = await suppliers.find({}).toArray();
  if (all.some((s: any) => normalizeText(s.TEN_NHA_CUNG_CAP) === normalizeText(payload.TEN_NHA_CUNG_CAP))) {
    throw new InventoryError(409, 'Tên nhà cung cấp đã tồn tại.');
  }
  if (payload.MA_SO_THUE && all.some((s: any) => s.MA_SO_THUE && String(s.MA_SO_THUE) === String(payload.MA_SO_THUE))) {
    throw new InventoryError(409, 'Mã số thuế đã được dùng cho nhà cung cấp khác.');
  }
  const id = String(body.code || '').trim() || await nextCode(COLLECTIONS.supplier, 'NHA_CUNG_CAP_ID', 'NCC', 3);
  const doc = { _id: id, NHA_CUNG_CAP_ID: id, TRANG_THAI: 'Hoạt động', ...payload, NGAY_TAO: new Date(), NGUOI_TAO: actor.id };
  await suppliers.insertOne(doc as any);
  return doc;
};

export const updateSupplier = async (supplierId: string, body: any, actor: Actor) => {
  const updated = await (await col(COLLECTIONS.supplier)).findOneAndUpdate(
    { NHA_CUNG_CAP_ID: supplierId },
    { $set: { ...supplierPayload(body), NGAY_CAP_NHAT: new Date(), NGUOI_CAP_NHAT: actor.id } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new InventoryError(404, 'Không tìm thấy nhà cung cấp.');
  return updated;
};

export const deleteOrDeactivateSupplier = async (supplierId: string, actor: Actor) => {
  const used = await Promise.all([
    (await col(COLLECTIONS.importSlip)).countDocuments({ NHA_CUNG_CAP_ID: supplierId }),
    (await col(COLLECTIONS.purchaseOrder)).countDocuments({ NHA_CUNG_CAP_ID: supplierId }),
    (await col(COLLECTIONS.supplierMaterial)).countDocuments({ NHA_CUNG_CAP_ID: supplierId }),
  ]);
  const suppliers = await col(COLLECTIONS.supplier);
  if (used.some((n) => n > 0)) {
    await suppliers.updateOne({ NHA_CUNG_CAP_ID: supplierId }, { $set: { TRANG_THAI: 'Ngừng hợp tác', NGAY_CAP_NHAT: new Date(), NGUOI_CAP_NHAT: actor.id } });
    return { deactivated: true, message: 'NCC đã có phiếu/PO/nguồn cung nên chỉ chuyển "Ngừng hợp tác".' };
  }
  await suppliers.deleteOne({ NHA_CUNG_CAP_ID: supplierId });
  return { deleted: true };
};

export const listSupplierMaterials = async (query: any = {}) => {
  const filter: any = {};
  if (query.supplierId) filter.NHA_CUNG_CAP_ID = query.supplierId;
  if (query.materialId) filter.NGUYEN_VAT_LIEU_ID = query.materialId;
  const rows = await (await col(COLLECTIONS.supplierMaterial)).find(filter).sort({ NGUYEN_VAT_LIEU_ID: 1, UU_TIEN: 1 }).toArray();
  const [materials, suppliers] = await Promise.all([
    (await col(COLLECTIONS.material)).find({ NGUYEN_VAT_LIEU_ID: { $in: rows.map((r: any) => r.NGUYEN_VAT_LIEU_ID) } }).project({ NGUYEN_VAT_LIEU_ID: 1, TEN_NGUYEN_VAT_LIEU: 1, DON_VI_TINH: 1 }).toArray(),
    (await col(COLLECTIONS.supplier)).find({ NHA_CUNG_CAP_ID: { $in: rows.map((r: any) => r.NHA_CUNG_CAP_ID) } }).project({ NHA_CUNG_CAP_ID: 1, TEN_NHA_CUNG_CAP: 1, TRANG_THAI: 1 }).toArray(),
  ]);
  return {
    total: rows.length,
    items: rows.map((r: any) => ({
      ...r,
      TEN_NGUYEN_VAT_LIEU: (materials.find((m: any) => m.NGUYEN_VAT_LIEU_ID === r.NGUYEN_VAT_LIEU_ID) as any)?.TEN_NGUYEN_VAT_LIEU || '',
      DON_VI_TINH: (materials.find((m: any) => m.NGUYEN_VAT_LIEU_ID === r.NGUYEN_VAT_LIEU_ID) as any)?.DON_VI_TINH || '',
      TEN_NHA_CUNG_CAP: (suppliers.find((s: any) => s.NHA_CUNG_CAP_ID === r.NHA_CUNG_CAP_ID) as any)?.TEN_NHA_CUNG_CAP || '',
    })),
  };
};

export const upsertSupplierMaterial = async (body: any, actor: Actor, id?: string) => {
  const supplierId = String(body.supplierId ?? body.NHA_CUNG_CAP_ID ?? '').trim();
  const materialId = String(body.materialId ?? body.NGUYEN_VAT_LIEU_ID ?? '').trim();
  if (!supplierId || !materialId) throw new InventoryError(400, 'Phải chọn NCC và NVL.');
  const [supplier, material] = await Promise.all([
    (await col(COLLECTIONS.supplier)).findOne({ NHA_CUNG_CAP_ID: supplierId }),
    (await col(COLLECTIONS.material)).findOne({ NGUYEN_VAT_LIEU_ID: materialId }),
  ]);
  if (!supplier) throw new InventoryError(400, 'NCC không tồn tại.');
  if (!material) throw new InventoryError(400, 'NVL không tồn tại.');
  const key = `${supplierId}:${materialId}`;
  if (id && id !== key) throw new InventoryError(400, 'Không đổi NCC/NVL của một nguồn cung — hãy tạo mới.');
  const doc = {
    _id: key,
    NHA_CUNG_CAP_ID: supplierId,
    NGUYEN_VAT_LIEU_ID: materialId,
    MA_HANG_NCC: String(body.supplierSku ?? body.MA_HANG_NCC ?? '') || null,
    DON_VI_MUA: String(body.purchaseUnit ?? body.DON_VI_MUA ?? material.DON_VI_TINH),
    HE_SO_QUY_DOI: Math.max(1, Number(body.conversionRate ?? body.HE_SO_QUY_DOI ?? 1) || 1),
    DON_GIA: money(body.unitCost ?? body.DON_GIA ?? material.GIA_NHAP),
    SL_DAT_TOI_THIEU: Math.max(0, roundQty(body.minOrderQty ?? body.SL_DAT_TOI_THIEU ?? 0)),
    SO_NGAY_GIAO: Math.max(0, Number(body.leadDays ?? body.SO_NGAY_GIAO ?? supplier.SO_NGAY_GIAO_MAC_DINH ?? 1)),
    GIO_CHOT_DON: String(body.orderCutoffTime ?? body.GIO_CHOT_DON ?? supplier.GIO_CHOT_DON ?? '') || null,
    NGAY_CO_HANG: Array.isArray(body.availableDays ?? body.NGAY_CO_HANG) ? (body.availableDays ?? body.NGAY_CO_HANG) : [],
    UU_TIEN: Math.max(1, Number(body.priority ?? body.UU_TIEN ?? 1) || 1),
    MUC_TIN_CAY: String(body.confidence ?? body.MUC_TIN_CAY ?? 'Trung bình'),
    NGAY_XAC_MINH: parseDate(body.lastVerifiedAt ?? body.NGAY_XAC_MINH) || new Date(),
    TRANG_THAI: body.active === false ? 'Ngừng' : 'Đang cung cấp',
    GHI_CHU: String(body.note ?? body.GHI_CHU ?? '') || null,
    NGUOI_CAP_NHAT: actor.id,
    NGAY_CAP_NHAT: new Date(),
  };
  await (await col(COLLECTIONS.supplierMaterial)).replaceOne({ _id: key as any }, doc as any, { upsert: true });
  return doc;
};

export const deleteSupplierMaterial = async (id: string) => {
  await (await col(COLLECTIONS.supplierMaterial)).deleteOne({ _id: id as any });
  return { deleted: true };
};

/* =====================================================================
 * ĐƠN ĐẶT MUA NCC (PO) — nguồn "hàng đang về", chỉ để dự báo
 * ===================================================================== */

const PO_TRANSITIONS: Record<string, string[]> = {
  [PO_STATUS.draft]: [PO_STATUS.waiting, PO_STATUS.cancelled],
  [PO_STATUS.waiting]: [PO_STATUS.shipping, PO_STATUS.cancelled],
  [PO_STATUS.shipping]: [PO_STATUS.done, PO_STATUS.cancelled],
  [PO_STATUS.done]: [],
  [PO_STATUS.cancelled]: [],
};

const mapPoLines = async (raw: any[]) => {
  if (!Array.isArray(raw) || !raw.length) throw new InventoryError(400, 'PO phải có ít nhất một NVL.');
  const seen = new Set<string>();
  const materials = await (await col(COLLECTIONS.material)).find({ NGUYEN_VAT_LIEU_ID: { $in: raw.map((l) => l.materialId ?? l.NGUYEN_VAT_LIEU_ID) } }).toArray();
  return raw.map((l, i) => {
    const id = String(l.materialId ?? l.NGUYEN_VAT_LIEU_ID ?? '').trim();
    const m: any = materials.find((x: any) => x.NGUYEN_VAT_LIEU_ID === id);
    if (!m) throw new InventoryError(400, `Dòng ${i + 1}: NVL không tồn tại.`);
    if (seen.has(id)) throw new InventoryError(400, `NVL ${id} bị trùng trong PO.`);
    seen.add(id);
    return {
      NGUYEN_VAT_LIEU_ID: id,
      DON_VI_TINH: m.DON_VI_TINH,
      SL_DAT: toPositiveQty(l.quantity ?? l.SL_DAT, `Dòng ${i + 1}: SL đặt`),
      DON_GIA_DU_KIEN: money(l.unitCost ?? l.DON_GIA_DU_KIEN ?? m.GIA_NHAP),
      SL_DA_NHAN: roundQty(l.SL_DA_NHAN || 0),
      SL_DAT_DA_NHAN: roundQty(l.SL_DAT_DA_NHAN || 0),
    };
  });
};

export const listPurchaseOrders = async (query: any = {}) => {
  const filter: any = {};
  if (query.status) filter.TRANG_THAI = query.status;
  if (query.supplierId) filter.NHA_CUNG_CAP_ID = query.supplierId;
  const rows = await (await col(COLLECTIONS.purchaseOrder)).find(filter).sort({ NGAY_DAT: -1, PO_ID: -1 }).toArray();
  return { total: rows.length, purchaseOrders: rows, statuses: Object.values(PO_STATUS) };
};

export const createPurchaseOrder = async (body: any, actor: Actor, options: { demo?: boolean } = {}) => {
  const supplierId = String(body.supplierId ?? body.NHA_CUNG_CAP_ID ?? '').trim();
  const supplier = await (await col(COLLECTIONS.supplier)).findOne({ NHA_CUNG_CAP_ID: supplierId });
  if (!supplier) throw new InventoryError(400, 'Phải chọn nhà cung cấp hợp lệ.');
  if (!SUPPLIER_ACTIVE_STATUSES.includes(supplier.TRANG_THAI)) throw new InventoryError(400, `NCC đang "${supplier.TRANG_THAI}".`);
  const lines = await mapPoLines(body.lines ?? body.CHI_TIET);
  const id = await nextCode(COLLECTIONS.purchaseOrder, 'PO_ID', 'PO', 5);
  const doc = {
    _id: id,
    PO_ID: id,
    NHA_CUNG_CAP_ID: supplierId,
    NGAY_DAT: parseDate(body.orderedAt) || new Date(),
    NGAY_GIO_DU_KIEN_GIAO: parseDate(body.expectedAt ?? body.NGAY_GIO_DU_KIEN_GIAO),
    TRANG_THAI: PO_STATUS.draft,
    CHI_TIET: lines,
    TONG_TIEN_DU_KIEN: lines.reduce((s, l) => s + l.SL_DAT * l.DON_GIA_DU_KIEN, 0),
    GHI_CHU: String(body.note ?? '') || null,
    NGUOI_TAO: actor.id,
    NGAY_TAO: new Date(),
    ...(options.demo ? { DU_LIEU_MAU: true } : {}),
  };
  await (await col(COLLECTIONS.purchaseOrder)).insertOne(doc as any);
  return doc;
};

export const updatePurchaseOrder = async (poId: string, body: any, actor: Actor) => {
  const pos = await col(COLLECTIONS.purchaseOrder);
  const po = await pos.findOne({ PO_ID: poId });
  if (!po) throw new InventoryError(404, 'Không tìm thấy PO.');
  if (![PO_STATUS.draft, PO_STATUS.waiting].includes(po.TRANG_THAI)) {
    // Đang giao: chỉ cho đổi ngày dự kiến (NCC báo trễ/sớm)
    if (po.TRANG_THAI === PO_STATUS.shipping && body.expectedAt !== undefined) {
      await pos.updateOne({ PO_ID: poId }, { $set: { NGAY_GIO_DU_KIEN_GIAO: parseDate(body.expectedAt), NGUOI_CAP_NHAT: actor.id, NGAY_CAP_NHAT: new Date() } });
      return pos.findOne({ PO_ID: poId });
    }
    throw new InventoryError(409, `PO đang "${po.TRANG_THAI}" không sửa được nội dung.`);
  }
  const set: any = { NGUOI_CAP_NHAT: actor.id, NGAY_CAP_NHAT: new Date() };
  if (body.expectedAt !== undefined) set.NGAY_GIO_DU_KIEN_GIAO = parseDate(body.expectedAt);
  if (body.note !== undefined) set.GHI_CHU = body.note;
  if (body.lines) {
    set.CHI_TIET = await mapPoLines(body.lines);
    set.TONG_TIEN_DU_KIEN = set.CHI_TIET.reduce((s: number, l: any) => s + l.SL_DAT * l.DON_GIA_DU_KIEN, 0);
  }
  await pos.updateOne({ PO_ID: poId }, { $set: set });
  return pos.findOne({ PO_ID: poId });
};

export const changePurchaseOrderStatus = async (poId: string, status: string, actor: Actor, note?: string) => {
  const pos = await col(COLLECTIONS.purchaseOrder);
  const po = await pos.findOne({ PO_ID: poId });
  if (!po) throw new InventoryError(404, 'Không tìm thấy PO.');
  if (po.TRANG_THAI === status) return po;
  if (!(PO_TRANSITIONS[po.TRANG_THAI] || []).includes(status)) {
    throw new InventoryError(409, `Không thể chuyển PO từ "${po.TRANG_THAI}" sang "${status}".`);
  }
  if (status === PO_STATUS.shipping && !po.NGAY_GIO_DU_KIEN_GIAO) throw new InventoryError(400, 'PO đang giao phải có ngày/giờ dự kiến giao.');
  const updated = await pos.findOneAndUpdate(
    { PO_ID: poId, TRANG_THAI: po.TRANG_THAI },
    { $set: { TRANG_THAI: status, NGUOI_CAP_NHAT: actor.id, NGAY_CAP_NHAT: new Date(), ...(note ? { GHI_CHU_TRANG_THAI: note } : {}), ...(status === PO_STATUS.done ? { NGAY_HOAN_TAT: new Date() } : {}) } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new InventoryError(409, 'PO vừa được cập nhật bởi người khác, hãy tải lại.');
  return updated;
};

/* =====================================================================
 * DANH SÁCH CHỨNG TỪ / SỔ KHO / THÀNH PHẨM
 * ===================================================================== */

const nameMaps = async () => {
  const [materials, suppliers, employees] = await Promise.all([
    (await col(COLLECTIONS.material)).find({}).project({ NGUYEN_VAT_LIEU_ID: 1, TEN_NGUYEN_VAT_LIEU: 1, DON_VI_TINH: 1, NHOM_NVL: 1 }).toArray(),
    (await col(COLLECTIONS.supplier)).find({}).project({ NHA_CUNG_CAP_ID: 1, TEN_NHA_CUNG_CAP: 1 }).toArray(),
    (await col(COLLECTIONS.employee)).find({}).project({ NHAN_VIEN_ID: 1, HO_TEN: 1 }).toArray(),
  ]);
  return {
    material: new Map(materials.map((m: any) => [m.NGUYEN_VAT_LIEU_ID, m])),
    supplier: new Map(suppliers.map((s: any) => [s.NHA_CUNG_CAP_ID, s.TEN_NHA_CUNG_CAP])),
    employee: new Map(employees.map((e: any) => [e.NHAN_VIEN_ID, e.HO_TEN])),
  };
};

export const listDocuments = async (kind: 'import' | 'export', query: any = {}) => {
  const slipName = kind === 'import' ? COLLECTIONS.importSlip : COLLECTIONS.exportSlip;
  const detailName = kind === 'import' ? COLLECTIONS.importDetail : COLLECTIONS.exportDetail;
  const idField = kind === 'import' ? 'PHIEU_NHAP_ID' : 'PHIEU_XUAT_ID';
  const filter: any = {};
  if (query.status === DOC_STATUS.posted) filter.$or = [{ TRANG_THAI: DOC_STATUS.posted }, { TRANG_THAI: { $exists: false } }];
  else if (query.status) filter.TRANG_THAI = query.status;
  if (query.type) filter[kind === 'import' ? 'LOAI_NHAP' : 'LOAI_XUAT'] = query.type;
  if (query.supplierId) filter.NHA_CUNG_CAP_ID = query.supplierId;
  if (query.orderId) filter.DON_HANG_ID = query.orderId;
  const slips = await (await col(slipName)).find(filter).sort({ [idField]: -1 }).toArray();
  const details = await (await col(detailName)).find({ [idField]: { $in: slips.map((s: any) => s[idField]) } }).toArray();
  const names = await nameMaps();
  return {
    total: slips.length,
    items: slips.map((s: any) => ({
      ...s,
      TRANG_THAI: s.TRANG_THAI || DOC_STATUS.posted,
      LOAI_NHAP: kind === 'import' ? s.LOAI_NHAP || 'Nhập mua NCC' : undefined,
      LOAI_XUAT: kind === 'export' ? s.LOAI_XUAT || s.LY_DO_XUAT || 'Khác' : undefined,
      TEN_NHA_CUNG_CAP: s.NHA_CUNG_CAP_ID ? names.supplier.get(s.NHA_CUNG_CAP_ID) || '' : '',
      TEN_NGUOI_LAP: names.employee.get(s.NGUOI_LAP || s.NHAN_VIEN_ID) || s.NGUOI_LAP || s.NHAN_VIEN_ID || '',
      TEN_NGUOI_XAC_NHAN: s.NGUOI_XAC_NHAN ? names.employee.get(s.NGUOI_XAC_NHAN) || s.NGUOI_XAC_NHAN : '',
      details: details.filter((d: any) => d[idField] === s[idField]).map((d: any) => {
        const m: any = names.material.get(d.NGUYEN_VAT_LIEU_ID);
        return { ...d, TEN_NGUYEN_VAT_LIEU: m?.TEN_NGUYEN_VAT_LIEU || '', DON_VI_TINH: m?.DON_VI_TINH || '', NHOM_NVL: m?.NHOM_NVL || '' };
      }),
    })),
  };
};

export const listMovements = async (query: any = {}) => {
  const filter: any = {};
  if (query.materialId) filter.NGUYEN_VAT_LIEU_ID = query.materialId;
  if (query.productId) filter.SAN_PHAM_ID = query.productId;
  if (query.type) filter.LOAI = query.type;
  if (query.orderId) filter.DON_HANG_ID = query.orderId;
  if (query.docId) filter.CHUNG_TU_ID = query.docId;
  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (from || to) filter.THOI_DIEM = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 200));
  const rows = await (await col(COLLECTIONS.movement)).find(filter).sort({ THOI_DIEM: -1, _id: -1 }).limit(limit).toArray();
  const names = await nameMaps();
  return {
    total: rows.length,
    items: rows.map((r: any) => ({ ...r, TEN: r.NGUYEN_VAT_LIEU_ID ? (names.material.get(r.NGUYEN_VAT_LIEU_ID) as any)?.TEN_NGUYEN_VAT_LIEU || r.NGUYEN_VAT_LIEU_ID : r.SAN_PHAM_ID, TEN_NGUOI_THUC_HIEN: names.employee.get(r.NGUOI_THUC_HIEN) || r.NGUOI_THUC_HIEN })),
  };
};

export const listFinishedGoods = async () => {
  const rows = await (await col(COLLECTIONS.product)).find({ TON_THANH_PHAM: { $gt: 0 } }).project({ SAN_PHAM_ID: 1, TEN_SAN_PHAM: 1, TON_THANH_PHAM: 1, TP_DANG_GIU: 1, GIA_VON_THANH_PHAM: 1, GIA: 1, KIEU_DANG: 1 }).toArray();
  return { total: rows.length, items: rows.map((p: any) => ({ ...p, KHA_DUNG: finishedAvailableOf(p) })) };
};

export const listReservations = async (query: any = {}) => {
  const filter: any = {};
  filter.TRANG_THAI = query.status ? query.status : { $in: ACTIVE_RESERVATION_STATUSES };
  if (query.orderId) filter.DON_HANG_ID = query.orderId;
  if (query.materialId) filter.NGUYEN_VAT_LIEU_ID = query.materialId;
  const rows = await (await col(COLLECTIONS.reservation)).find(filter).sort({ TAO_LUC: -1 }).limit(500).toArray();
  const names = await nameMaps();
  return { total: rows.length, items: rows.map((r: any) => ({ ...r, TEN: r.NGUYEN_VAT_LIEU_ID ? (names.material.get(r.NGUYEN_VAT_LIEU_ID) as any)?.TEN_NGUYEN_VAT_LIEU : r.SAN_PHAM_ID })) };
};

export const listDemands = async (query: any = {}) => {
  const filter: any = {};
  if (query.status) filter.TRANG_THAI = query.status;
  if (query.orderId) filter.DON_HANG_ID = query.orderId;
  const rows = await (await col(COLLECTIONS.demand)).find(filter).sort({ THOI_DIEM_CAN_DUNG: 1 }).limit(500).toArray();
  const names = await nameMaps();
  return { total: rows.length, items: rows.map((r: any) => ({ ...r, TEN: (names.material.get(r.NGUYEN_VAT_LIEU_ID) as any)?.TEN_NGUYEN_VAT_LIEU || r.NGUYEN_VAT_LIEU_ID })) };
};
