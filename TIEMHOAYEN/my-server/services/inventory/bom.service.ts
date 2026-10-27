import type { ClientSession } from 'mongodb';
import { BOM_ROLES, BOM_STATUS, COLLECTIONS, MATERIAL_GROUP, MATERIAL_STATUS } from './constants.js';
import { col, InventoryError, money, nextCode, roundQty, unitsCompatible, type Actor } from './helpers.js';

/**
 * D02 — BOM SPECIFICATION
 * BOM_SAN_PHAM (đầu BOM, có phiên bản) + CHI_TIET_BOM (dòng NVL).
 * Mỗi sản phẩm chỉ có 1 BOM "Hiệu lực". Kích hoạt phiên bản mới → phiên bản cũ "Ngừng sử dụng".
 * Khi kích hoạt, đồng bộ sang CONG_THUC_SAN_PHAM để các màn hình cũ (chi tiết sản phẩm) vẫn đọc được.
 */

export interface BomLineInput {
  materialId: string;
  quantity: number;
  unit?: string;
  role?: string;
  substitutes?: string[];
  note?: string;
}

export interface BomLine {
  NGUYEN_VAT_LIEU_ID: string;
  DINH_LUONG: number;
  DON_VI_TINH: string;
  VAI_TRO: string;
  DS_THAY_THE: string[];
  GHI_CHU: string;
}

export interface ResolvedBom {
  bom: any | null;
  lines: BomLine[];
  /** true khi sản phẩm chưa có BOM_SAN_PHAM, đọc tạm từ CONG_THUC_SAN_PHAM cũ */
  legacy: boolean;
}

const mapLegacyRecipe = (row: any): BomLine => ({
  NGUYEN_VAT_LIEU_ID: row.NGUYEN_VAT_LIEU_ID,
  DINH_LUONG: roundQty(row.SO_LUONG_CAN),
  DON_VI_TINH: row.DON_VI_TINH || '',
  VAI_TRO: 'Chính',
  DS_THAY_THE: [],
  GHI_CHU: row.GHI_CHU || '',
});

export const getActiveBom = async (productId: string, session?: ClientSession): Promise<ResolvedBom> => {
  const bom = await (await col(COLLECTIONS.bom)).findOne({ SAN_PHAM_ID: productId, TRANG_THAI: BOM_STATUS.active }, { session });
  if (bom) {
    const lines = await (await col(COLLECTIONS.bomLine)).find({ BOM_ID: bom.BOM_ID }, { session }).toArray();
    return { bom, lines: lines as any, legacy: false };
  }
  const legacy = await (await col(COLLECTIONS.legacyRecipe)).find({ SAN_PHAM_ID: productId }, { session }).toArray();
  return { bom: null, lines: legacy.map(mapLegacyRecipe), legacy: true };
};

/** Lấy BOM hiệu lực của nhiều sản phẩm một lần (dùng cho cảnh báo tầng 2). */
export const getActiveBomMap = async (productIds?: string[]): Promise<Map<string, BomLine[]>> => {
  const filter: any = { TRANG_THAI: BOM_STATUS.active };
  if (productIds) filter.SAN_PHAM_ID = { $in: productIds };
  const boms = await (await col(COLLECTIONS.bom)).find(filter).toArray();
  const lines = await (await col(COLLECTIONS.bomLine)).find({ BOM_ID: { $in: boms.map((b) => b.BOM_ID) } }).toArray();
  const byBom = new Map<string, BomLine[]>();
  lines.forEach((line: any) => {
    const list = byBom.get(line.BOM_ID) || [];
    list.push(line);
    byBom.set(line.BOM_ID, list);
  });
  const result = new Map<string, BomLine[]>();
  boms.forEach((b) => result.set(b.SAN_PHAM_ID, byBom.get(b.BOM_ID) || []));

  // Sản phẩm chưa có BOM mới → đọc công thức cũ
  const legacyFilter: any = productIds ? { SAN_PHAM_ID: { $in: productIds.filter((id) => !result.has(id)) } } : {};
  const legacy = await (await col(COLLECTIONS.legacyRecipe)).find(legacyFilter).toArray();
  legacy.forEach((row: any) => {
    if (result.has(row.SAN_PHAM_ID) && boms.some((b) => b.SAN_PHAM_ID === row.SAN_PHAM_ID)) return;
    const list = result.get(row.SAN_PHAM_ID) || [];
    list.push(mapLegacyRecipe(row));
    result.set(row.SAN_PHAM_ID, list);
  });
  return result;
};

/** D02.8 — Ràng buộc hợp lệ BOM. Trả về danh sách lỗi (rỗng = hợp lệ). */
export const validateBomLines = async (rawLines: BomLineInput[], options: { strictUnit?: boolean } = {}): Promise<{ errors: string[]; lines: BomLine[] }> => {
  const errors: string[] = [];
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { errors: ['BOM phải có ít nhất một NVL.'], lines: [] };
  }
  const ids = rawLines.map((l) => String(l.materialId || '').trim());
  const materials = await (await col(COLLECTIONS.material))
    .find({ NGUYEN_VAT_LIEU_ID: { $in: [...ids, ...rawLines.flatMap((l) => l.substitutes || [])] } })
    .toArray();
  const byId = new Map(materials.map((m: any) => [m.NGUYEN_VAT_LIEU_ID, m]));

  const seen = new Set<string>();
  const lines: BomLine[] = rawLines.map((raw, index) => {
    const id = ids[index];
    const material: any = byId.get(id);
    const label = `Dòng ${index + 1} (${id || 'trống'})`;
    if (!id) errors.push(`${label}: chưa chọn NVL.`);
    else if (!material) errors.push(`${label}: NVL không tồn tại.`);
    else if (material.TRANG_THAI === MATERIAL_STATUS.hidden) errors.push(`${label}: NVL đã ngừng sử dụng.`);
    if (seen.has(id)) errors.push(`${label}: NVL bị trùng trong BOM — hãy sửa định lượng thay vì thêm dòng.`);
    seen.add(id);

    const quantity = roundQty(raw.quantity);
    if (!(quantity > 0)) errors.push(`${label}: định lượng phải > 0.`);

    const unit = String(raw.unit || material?.DON_VI_TINH || '').trim();
    if (material && options.strictUnit !== false && !unitsCompatible(unit, material.DON_VI_TINH)) {
      errors.push(`${label}: đơn vị "${unit}" không khớp đơn vị NVL "${material.DON_VI_TINH}".`);
    }

    const role = BOM_ROLES.includes(raw.role as any) ? String(raw.role) : 'Chính';
    const substitutes = [...new Set((raw.substitutes || []).map((s) => String(s).trim()).filter(Boolean))];
    substitutes.forEach((subId) => {
      const sub: any = byId.get(subId);
      if (subId === id) errors.push(`${label}: NVL không thể thay thế chính nó.`);
      else if (!sub) errors.push(`${label}: NVL thay thế ${subId} không tồn tại.`);
      else if (material && (!material.NHOM_THAY_THE || sub.NHOM_THAY_THE !== material.NHOM_THAY_THE)) {
        errors.push(`${label}: ${subId} không cùng nhóm thay thế với ${id}.`);
      }
    });

    return {
      NGUYEN_VAT_LIEU_ID: id,
      DINH_LUONG: quantity,
      DON_VI_TINH: material?.DON_VI_TINH || unit,
      VAI_TRO: role,
      DS_THAY_THE: substitutes,
      GHI_CHU: String(raw.note || '').trim(),
    };
  });

  if (!lines.some((l) => l.VAI_TRO === 'Chính')) errors.push('BOM phải có ít nhất một NVL vai trò "Chính".');
  return { errors, lines };
};

const toLineInput = (body: any): BomLineInput[] =>
  (Array.isArray(body?.lines) ? body.lines : []).map((l: any) => ({
    materialId: l.materialId ?? l.NGUYEN_VAT_LIEU_ID,
    quantity: l.quantity ?? l.DINH_LUONG,
    unit: l.unit ?? l.DON_VI_TINH,
    role: l.role ?? l.VAI_TRO,
    substitutes: l.substitutes ?? l.DS_THAY_THE ?? [],
    note: l.note ?? l.GHI_CHU,
  }));

export const listProductBoms = async (productId: string) => {
  const boms = await (await col(COLLECTIONS.bom)).find({ SAN_PHAM_ID: productId }).sort({ PHIEN_BAN: -1 }).toArray();
  const lines = await (await col(COLLECTIONS.bomLine)).find({ BOM_ID: { $in: boms.map((b) => b.BOM_ID) } }).toArray();
  const legacy = boms.length ? [] : await (await col(COLLECTIONS.legacyRecipe)).find({ SAN_PHAM_ID: productId }).toArray();
  return {
    boms: boms.map((b) => ({ ...b, lines: lines.filter((l: any) => l.BOM_ID === b.BOM_ID) })),
    legacyRecipe: legacy.map(mapLegacyRecipe),
  };
};

export const createBomVersion = async (productId: string, body: any, actor: Actor) => {
  const product = await (await col(COLLECTIONS.product)).findOne({ SAN_PHAM_ID: productId });
  if (!product) throw new InventoryError(404, 'Không tìm thấy sản phẩm.');
  const { errors, lines } = await validateBomLines(toLineInput(body));
  if (errors.length) throw new InventoryError(400, 'BOM chưa hợp lệ.', errors);

  const boms = await col(COLLECTIONS.bom);
  const latest = await boms.find({ SAN_PHAM_ID: productId }).sort({ PHIEN_BAN: -1 }).limit(1).toArray();
  const version = Number(latest[0]?.PHIEN_BAN || 0) + 1;
  const bomId = await nextCode(COLLECTIONS.bom, 'BOM_ID', 'BOM', 5);
  const header = {
    _id: bomId,
    BOM_ID: bomId,
    SAN_PHAM_ID: productId,
    PHIEN_BAN: version,
    TRANG_THAI: BOM_STATUS.draft,
    CHO_THAY_THE_NVL: Boolean(body.allowSubstitution ?? body.CHO_THAY_THE_NVL ?? true),
    GHI_CHU: String(body.note || ''),
    NGUOI_TAO: actor.id,
    NGAY_TAO: new Date(),
    HIEU_LUC_TU: null,
    HIEU_LUC_DEN: null,
  };
  await boms.insertOne(header as any);
  await (await col(COLLECTIONS.bomLine)).insertMany(lines.map((l) => ({ _id: `${bomId}:${l.NGUYEN_VAT_LIEU_ID}`, BOM_ID: bomId, ...l })) as any);
  if (body.activate) return activateBom(bomId, actor);
  return { ...header, lines };
};

export const updateBomDraft = async (bomId: string, body: any, actor: Actor) => {
  const boms = await col(COLLECTIONS.bom);
  const bom = await boms.findOne({ BOM_ID: bomId });
  if (!bom) throw new InventoryError(404, 'Không tìm thấy BOM.');
  if (bom.TRANG_THAI !== BOM_STATUS.draft) {
    throw new InventoryError(409, 'Chỉ sửa được BOM Nháp. BOM đang hiệu lực phải tạo phiên bản mới.');
  }
  const { errors, lines } = await validateBomLines(toLineInput(body));
  if (errors.length) throw new InventoryError(400, 'BOM chưa hợp lệ.', errors);
  await boms.updateOne({ BOM_ID: bomId }, {
    $set: {
      CHO_THAY_THE_NVL: Boolean(body.allowSubstitution ?? bom.CHO_THAY_THE_NVL),
      GHI_CHU: String(body.note ?? bom.GHI_CHU ?? ''),
      NGUOI_CAP_NHAT: actor.id,
      NGAY_CAP_NHAT: new Date(),
    },
  });
  const lineCol = await col(COLLECTIONS.bomLine);
  await lineCol.deleteMany({ BOM_ID: bomId });
  await lineCol.insertMany(lines.map((l) => ({ _id: `${bomId}:${l.NGUYEN_VAT_LIEU_ID}`, BOM_ID: bomId, ...l })) as any);
  return { ...bom, lines };
};

export const activateBom = async (bomId: string, actor: Actor) => {
  const boms = await col(COLLECTIONS.bom);
  const bom = await boms.findOne({ BOM_ID: bomId });
  if (!bom) throw new InventoryError(404, 'Không tìm thấy BOM.');
  if (bom.TRANG_THAI === BOM_STATUS.active) return bom;
  if (bom.TRANG_THAI !== BOM_STATUS.draft) throw new InventoryError(409, 'Chỉ kích hoạt được BOM Nháp.');
  const lines = await (await col(COLLECTIONS.bomLine)).find({ BOM_ID: bomId }).toArray();
  const { errors } = await validateBomLines(lines.map((l: any) => ({
    materialId: l.NGUYEN_VAT_LIEU_ID, quantity: l.DINH_LUONG, unit: l.DON_VI_TINH, role: l.VAI_TRO, substitutes: l.DS_THAY_THE,
  })));
  if (errors.length) throw new InventoryError(400, 'BOM chưa hợp lệ, không thể kích hoạt.', errors);

  const now = new Date();
  await boms.updateMany(
    { SAN_PHAM_ID: bom.SAN_PHAM_ID, TRANG_THAI: BOM_STATUS.active },
    { $set: { TRANG_THAI: BOM_STATUS.retired, HIEU_LUC_DEN: now } },
  );
  await boms.updateOne({ BOM_ID: bomId }, { $set: { TRANG_THAI: BOM_STATUS.active, HIEU_LUC_TU: now, NGUOI_KICH_HOAT: actor.id } });

  // Đồng bộ ngược công thức cũ cho các màn hình đang đọc CONG_THUC_SAN_PHAM
  const recipe = await col(COLLECTIONS.legacyRecipe);
  await recipe.deleteMany({ SAN_PHAM_ID: bom.SAN_PHAM_ID });
  if (lines.length) {
    await recipe.insertMany(lines.map((l: any) => ({
      _id: { SAN_PHAM_ID: bom.SAN_PHAM_ID, NGUYEN_VAT_LIEU_ID: l.NGUYEN_VAT_LIEU_ID },
      SAN_PHAM_ID: bom.SAN_PHAM_ID,
      NGUYEN_VAT_LIEU_ID: l.NGUYEN_VAT_LIEU_ID,
      SO_LUONG_CAN: l.DINH_LUONG,
      DON_VI_TINH: l.DON_VI_TINH,
      GHI_CHU: l.GHI_CHU || '',
    })) as any);
  }
  return { ...bom, TRANG_THAI: BOM_STATUS.active, HIEU_LUC_TU: now };
};

export const retireBom = async (bomId: string, actor: Actor) => {
  const boms = await col(COLLECTIONS.bom);
  const bom = await boms.findOne({ BOM_ID: bomId });
  if (!bom) throw new InventoryError(404, 'Không tìm thấy BOM.');
  if (bom.TRANG_THAI === BOM_STATUS.draft) {
    await boms.deleteOne({ BOM_ID: bomId });
    await (await col(COLLECTIONS.bomLine)).deleteMany({ BOM_ID: bomId });
    return { deleted: true };
  }
  await boms.updateOne({ BOM_ID: bomId }, { $set: { TRANG_THAI: BOM_STATUS.retired, HIEU_LUC_DEN: new Date(), NGUOI_CAP_NHAT: actor.id } });
  return { retired: true };
};

/**
 * Giá vốn DỰ KIẾN của 1 bó theo BOM (D02.5): định lượng × giá vốn hiện hành.
 * Hoa/lá: giá vốn nguồn nhập mới nhất còn hàng; nhóm ít hư: bình quân gia quyền. Chỉ để tham khảo.
 */
export const estimateBomCost = async (lines: BomLine[]) => {
  const ids = lines.map((l) => l.NGUYEN_VAT_LIEU_ID);
  const materials = await (await col(COLLECTIONS.material)).find({ NGUYEN_VAT_LIEU_ID: { $in: ids } }).toArray();
  const latestSources = await (await col(COLLECTIONS.importDetail))
    .aggregate([
      { $match: { NGUYEN_VAT_LIEU_ID: { $in: ids }, LA_NGUON_NHAP: true } },
      { $sort: { THOI_DIEM_NHAN: -1 } },
      { $group: { _id: '$NGUYEN_VAT_LIEU_ID', cost: { $first: '$DON_GIA_VON' } } },
    ])
    .toArray();
  const latestCost = new Map(latestSources.map((s: any) => [s._id, Number(s.cost || 0)]));
  const byId = new Map(materials.map((m: any) => [m.NGUYEN_VAT_LIEU_ID, m]));
  const items = lines.map((l) => {
    const m: any = byId.get(l.NGUYEN_VAT_LIEU_ID);
    const unitCost = m?.NHOM_NVL === MATERIAL_GROUP.perishable
      ? latestCost.get(l.NGUYEN_VAT_LIEU_ID) || Number(m?.GIA_NHAP || 0)
      : Number(m?.GIA_VON_BQ || m?.GIA_NHAP || 0);
    return { materialId: l.NGUYEN_VAT_LIEU_ID, name: m?.TEN_NGUYEN_VAT_LIEU || '', quantity: l.DINH_LUONG, unit: l.DON_VI_TINH, unitCost: money(unitCost), amount: money(unitCost * l.DINH_LUONG) };
  });
  return { items, total: items.reduce((s, i) => s + i.amount, 0) };
};
