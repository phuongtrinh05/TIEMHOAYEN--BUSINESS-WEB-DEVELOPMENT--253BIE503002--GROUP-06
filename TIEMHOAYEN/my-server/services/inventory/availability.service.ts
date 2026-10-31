import {
  ACTIVE_RESERVATION_STATUSES,
  COLLECTIONS,
  DEMAND_STATUS,
  INVENTORY_CONFIG,
  ITEM_KIND,
  MATERIAL_GROUP,
  MATERIAL_STATUS,
  PO_STATUS,
  SUPPLIER_ACTIVE_STATUSES,
} from './constants.js';
import { availableOf, ceilQty, col, finishedAvailableOf, InventoryError, isSameVnDay, parseDate, roundQty, vnTimeKey } from './helpers.js';
import { getActiveBom, getActiveBomMap, type BomLine } from './bom.service.js';

/* ---------------------------------------------------------------------
 * D01.4 — công thức tồn
 *   ton_kha_dung   = ton_thuc − ton_dang_giu − ton_khong_dat
 *   so_bo_lam_duoc = min_i ⌊ ton_kha_dung_i / dinh_muc_i ⌋
 *   ton_ban_duoc   = (ton_thanh_pham − bo_dang_giu) + so_bo_lam_duoc
 * --------------------------------------------------------------------- */

export const materialStockStatus = (m: any) => {
  const available = availableOf(m);
  const threshold = Number(m?.NGUONG_CANH_BAO || 0);
  if (available <= 0) return { code: 'out', label: 'Hết kho' };
  if (threshold > 0 && available <= threshold) return { code: 'low', label: 'Sắp hết' };
  return { code: 'ok', label: 'Đủ hàng' };
};

export const computeBuildable = (lines: BomLine[], materialsById: Map<string, any>) => {
  if (!lines.length) return { buildable: 0, bottleneck: null as any, perMaterial: [] as any[] };
  let buildable = Number.POSITIVE_INFINITY;
  let bottleneck: any = null;
  const perMaterial = lines.map((l) => {
    const m = materialsById.get(l.NGUYEN_VAT_LIEU_ID);
    const available = availableOf(m);
    const perUnit = Number(l.DINH_LUONG || 0);
    const canMake = perUnit > 0 ? Math.floor(roundQty(available / perUnit) + 1e-9) : Number.POSITIVE_INFINITY;
    if (canMake < buildable) {
      buildable = canMake;
      bottleneck = { materialId: l.NGUYEN_VAT_LIEU_ID, name: m?.TEN_NGUYEN_VAT_LIEU || l.NGUYEN_VAT_LIEU_ID };
    }
    return { materialId: l.NGUYEN_VAT_LIEU_ID, name: m?.TEN_NGUYEN_VAT_LIEU || l.NGUYEN_VAT_LIEU_ID, unit: m?.DON_VI_TINH || l.DON_VI_TINH, perUnit, available, canMake, inactive: m?.TRANG_THAI === MATERIAL_STATUS.hidden };
  });
  return { buildable: Number.isFinite(buildable) ? buildable : 0, bottleneck, perMaterial };
};

/** Hàng đang về từ PO "Đang giao" có ngày dự kiến ≤ deadline (chỉ dùng DỰ BÁO). */
export const incomingByMaterial = async (deadline: Date | null) => {
  const query: any = { TRANG_THAI: PO_STATUS.shipping };
  if (deadline) query.NGAY_GIO_DU_KIEN_GIAO = { $lte: deadline };
  const pos = await (await col(COLLECTIONS.purchaseOrder)).find(query).toArray();
  const map = new Map<string, number>();
  pos.forEach((po: any) => (po.CHI_TIET || []).forEach((l: any) => {
    const pending = Math.max(0, Number(l.SL_DAT || 0) - Number(l.SL_DA_NHAN || 0));
    if (pending > 0) map.set(l.NGUYEN_VAT_LIEU_ID, roundQty((map.get(l.NGUYEN_VAT_LIEU_ID) || 0) + pending));
  }));
  return map;
};

/** Nhu cầu chưa giữ của các đơn tương lai đã có T ≤ deadline. */
export const pendingDemandByMaterial = async (deadline: Date | null, excludeOrderId?: string) => {
  const query: any = { TRANG_THAI: DEMAND_STATUS.waiting };
  if (deadline) query.THOI_DIEM_CAN_DUNG = { $ne: null, $lte: deadline };
  if (excludeOrderId) query.DON_HANG_ID = { $ne: excludeOrderId };
  const rows = await (await col(COLLECTIONS.demand)).find(query).toArray();
  const map = new Map<string, number>();
  rows.forEach((r: any) => map.set(r.NGUYEN_VAT_LIEU_ID, roundQty((map.get(r.NGUYEN_VAT_LIEU_ID) || 0) + Number(r.SO_LUONG || 0))));
  return map;
};

/**
 * GET /api/products/:id/availability?qty=&deliveryAt=
 * Trả quyết định có giải thích: available (đi thẳng thanh toán) | need_review (chuyển Sales/Admin duyệt).
 * Đây là KIỂM TRA, không giữ tồn. Giữ tồn thật thực hiện ở bước tạo QR (reserveProducts).
 */
export const checkProductAvailability = async (productId: string, qtyRaw: unknown, deliveryAtRaw: unknown) => {
  const qty = Math.max(1, Math.floor(Number(qtyRaw || 1)));
  const now = new Date();
  const deliveryAt = parseDate(deliveryAtRaw) || now;
  const product = await (await col(COLLECTIONS.product)).findOne({ SAN_PHAM_ID: productId });
  if (!product) throw new InventoryError(404, 'Không tìm thấy sản phẩm.');

  const { bom, lines, legacy } = await getActiveBom(productId);
  const materials = await (await col(COLLECTIONS.material)).find({ NGUYEN_VAT_LIEU_ID: { $in: lines.map((l) => l.NGUYEN_VAT_LIEU_ID) } }).toArray();
  const byId = new Map(materials.map((m: any) => [m.NGUYEN_VAT_LIEU_ID, m]));
  const finishedAvailable = Math.floor(finishedAvailableOf(product));
  const { buildable, bottleneck, perMaterial } = computeBuildable(lines, byId);
  const sellable = finishedAvailable + buildable;
  const sameDay = isSameVnDay(deliveryAt, now);
  const reasons: string[] = [];
  let decision: 'available' | 'need_review' | 'unavailable' = 'available';

  if (deliveryAt.getTime() < now.getTime() - 60_000) {
    return { productId, quantity: qty, decision: 'unavailable', reasons: ['Thời gian giao đã qua.'], sellable, finishedAvailable, buildable };
  }
  if (!lines.length && finishedAvailable < qty) {
    decision = 'need_review';
    reasons.push('Sản phẩm chưa có BOM và không đủ thành phẩm cắm sẵn.');
  }
  if (perMaterial.some((p) => p.inactive)) {
    decision = 'need_review';
    reasons.push('BOM có NVL đã ngừng sử dụng.');
  }

  const toMake = Math.max(0, qty - finishedAvailable);
  const requirement = lines.map((l) => {
    const m: any = byId.get(l.NGUYEN_VAT_LIEU_ID);
    const required = ceilQty(l.DINH_LUONG * toMake);
    return { materialId: l.NGUYEN_VAT_LIEU_ID, name: m?.TEN_NGUYEN_VAT_LIEU || l.NGUYEN_VAT_LIEU_ID, unit: m?.DON_VI_TINH || l.DON_VI_TINH, required, available: availableOf(m), group: m?.NHOM_NVL };
  });

  let forecast: any[] = [];
  if (sameDay) {
    if (vnTimeKey(now) >= INVENTORY_CONFIG.sameDayCutoff) {
      decision = 'need_review';
      reasons.push(`Đơn giao trong ngày sau ${INVENTORY_CONFIG.sameDayCutoff} cần Sales/Admin xác nhận khả năng thực hiện.`);
    }
    if (sellable < qty) {
      decision = 'need_review';
      reasons.push(`Chỉ đáp ứng được ${sellable}/${qty} bó với tồn hiện tại${bottleneck ? ` (NVL chốt chặn: ${bottleneck.name})` : ''}.`);
    }
  } else {
    // Đơn tương lai: dự báo = khả dụng hiện tại + PO đang giao kịp − nhu cầu chưa giữ của đơn khác trước ngày giao
    const incoming = await incomingByMaterial(deliveryAt);
    const demand = await pendingDemandByMaterial(deliveryAt);
    forecast = requirement.map((r) => {
      const projected = roundQty(r.available + (incoming.get(r.materialId) || 0) - (demand.get(r.materialId) || 0));
      return { ...r, incoming: incoming.get(r.materialId) || 0, otherDemand: demand.get(r.materialId) || 0, projected, short: projected + 1e-9 < r.required };
    });
    const short = forecast.filter((f) => f.short);
    if (short.length) {
      decision = 'need_review';
      reasons.push(`Dự báo thiếu NVL trước ngày giao: ${short.map((s) => `${s.name} (cần ${s.required}, dự kiến ${s.projected} ${s.unit})`).join('; ')}.`);
    }
  }

  // Phương án nguồn cung cho NVL thiếu (để Sales tham khảo khi duyệt)
  const shortIds = (sameDay ? requirement.filter((r) => r.available < r.required) : forecast.filter((f) => f.short)).map((r: any) => r.materialId);
  const supplierOptions = shortIds.length ? await supplierOptionsFor(shortIds, deliveryAt) : [];

  return {
    productId,
    productName: product.TEN_SAN_PHAM,
    quantity: qty,
    deliveryAt,
    sameDay,
    decision,
    canCheckoutDirectly: decision === 'available',
    reasons,
    finishedAvailable,
    buildable,
    sellable,
    bottleneck,
    bom: bom ? { id: bom.BOM_ID, version: bom.PHIEN_BAN } : legacy ? { legacy: true } : null,
    requirement,
    forecast,
    supplierOptions,
    policy: { holdMinutes: INVENTORY_CONFIG.holdMinutes, sameDayCutoff: INVENTORY_CONFIG.sameDayCutoff },
  };
};

/** NCC có thể cung cấp NVL + có kịp trước hạn không (lead time ước lượng, cần xác minh). */
export const supplierOptionsFor = async (materialIds: string[], deadline: Date) => {
  const rows = await (await col(COLLECTIONS.supplierMaterial)).find({ NGUYEN_VAT_LIEU_ID: { $in: materialIds }, TRANG_THAI: { $ne: 'Ngừng' } }).toArray();
  const suppliers = await (await col(COLLECTIONS.supplier)).find({ NHA_CUNG_CAP_ID: { $in: rows.map((r: any) => r.NHA_CUNG_CAP_ID) } }).toArray();
  const now = new Date();
  return rows
    .map((r: any) => {
      const s: any = suppliers.find((x: any) => x.NHA_CUNG_CAP_ID === r.NHA_CUNG_CAP_ID);
      const leadDays = Number(r.SO_NGAY_GIAO ?? s?.SO_NGAY_GIAO_MAC_DINH ?? 1);
      const cutoff = r.GIO_CHOT_DON || s?.GIO_CHOT_DON || '12:00';
      const extraDay = vnTimeKey(now) >= cutoff ? 1 : 0;
      const eta = new Date(now.getTime() + (leadDays + extraDay) * 86_400_000);
      return {
        materialId: r.NGUYEN_VAT_LIEU_ID,
        supplierId: r.NHA_CUNG_CAP_ID,
        supplierName: s?.TEN_NHA_CUNG_CAP || r.NHA_CUNG_CAP_ID,
        supplierActive: SUPPLIER_ACTIVE_STATUSES.includes(s?.TRANG_THAI),
        unitCost: Number(r.DON_GIA || 0),
        leadDays,
        cutoff,
        minOrderQty: Number(r.SL_DAT_TOI_THIEU || 0),
        priority: Number(r.UU_TIEN || 99),
        confidence: r.MUC_TIN_CAY || null,
        lastVerifiedAt: r.NGAY_XAC_MINH || null,
        estimatedArrival: eta,
        canArriveInTime: eta.getTime() <= deadline.getTime(),
      };
    })
    .sort((a, b) => Number(b.supplierActive) - Number(a.supplierActive) || Number(b.canArriveInTime) - Number(a.canArriveInTime) || a.priority - b.priority);
};

/* ---------------------------------------------------------------------
 * D01.7 — Ba tầng cảnh báo
 * --------------------------------------------------------------------- */

export const getInventoryAlerts = async () => {
  // Đọc song song mọi nguồn (trước đây 6 lượt tuần tự → chậm khi DB ở xa như Atlas)
  const [materials, demandRows, pos, products, bomMap, sources] = await Promise.all([
    col(COLLECTIONS.material).then((c) => c.find({ TRANG_THAI: { $ne: MATERIAL_STATUS.hidden } }).toArray()),
    col(COLLECTIONS.demand).then((c) => c.find({ TRANG_THAI: DEMAND_STATUS.waiting }).sort({ THOI_DIEM_CAN_DUNG: 1, DON_HANG_ID: 1 }).toArray()),
    col(COLLECTIONS.purchaseOrder).then((c) => c.find({ TRANG_THAI: PO_STATUS.shipping }).toArray()),
    col(COLLECTIONS.product).then((c) => c.find({ TRANG_THAI: 'Đang bán' }).project({ SAN_PHAM_ID: 1, TEN_SAN_PHAM: 1, TON_THANH_PHAM: 1, TP_DANG_GIU: 1, KIEU_DANG: 1 }).toArray()),
    getActiveBomMap(),
    col(COLLECTIONS.importDetail).then((c) => c.find({ LA_NGUON_NHAP: true, SL_CON_LAI: { $gt: 0 } }).toArray()),
  ]);
  const byId = new Map(materials.map((m: any) => [m.NGUYEN_VAT_LIEU_ID, m]));

  // Tầng 1 — NVL theo tồn hiện tại
  const materialAlerts = materials
    .map((m: any) => ({ m, status: materialStockStatus(m) }))
    .filter((x) => x.status.code !== 'ok')
    .map(({ m, status }) => ({
      materialId: m.NGUYEN_VAT_LIEU_ID, name: m.TEN_NGUYEN_VAT_LIEU, unit: m.DON_VI_TINH, status: status.code, label: status.label,
      available: availableOf(m), threshold: Number(m.NGUONG_CANH_BAO || 0), maxLevel: Number(m.NGUONG_TOI_DA || 0),
      suggestedOrder: Math.max(0, roundQty(Number(m.NGUONG_TOI_DA || m.NGUONG_CANH_BAO || 0) - availableOf(m))),
    }))
    .sort((a, b) => (a.status === b.status ? a.available - b.available : a.status === 'out' ? -1 : 1));

  // Tầng 1b + 3 — dự báo theo lịch T: khả dụng + PO đang giao kịp T − nhu cầu chưa giữ các đơn có T sớm hơn/cùng T
  // Gộp theo (đơn, NVL) — một đơn có nhiều sản phẩm dùng chung NVL
  const grouped = new Map<string, any>();
  demandRows.forEach((d: any) => {
    const key = `${d.DON_HANG_ID}|${d.NGUYEN_VAT_LIEU_ID}`;
    const g = grouped.get(key);
    if (g) g.SO_LUONG = roundQty(g.SO_LUONG + Number(d.SO_LUONG || 0));
    else grouped.set(key, { ...d, SO_LUONG: Number(d.SO_LUONG || 0) });
  });
  const demands = [...grouped.values()];
  const cumulative = new Map<string, number>();
  const forecastShortages: any[] = [];
  const unscheduled = new Set<string>();
  for (const d of demands as any[]) {
    if (!d.THOI_DIEM_CAN_DUNG) { unscheduled.add(d.DON_HANG_ID); continue; }
    const T = new Date(d.THOI_DIEM_CAN_DUNG);
    const used = roundQty((cumulative.get(d.NGUYEN_VAT_LIEU_ID) || 0) + Number(d.SO_LUONG || 0));
    cumulative.set(d.NGUYEN_VAT_LIEU_ID, used);
    const incoming = pos.reduce((sum: number, po: any) => {
      if (!po.NGAY_GIO_DU_KIEN_GIAO || new Date(po.NGAY_GIO_DU_KIEN_GIAO) > T) return sum;
      const line = (po.CHI_TIET || []).find((l: any) => l.NGUYEN_VAT_LIEU_ID === d.NGUYEN_VAT_LIEU_ID);
      return sum + (line ? Math.max(0, Number(line.SL_DAT || 0) - Number(line.SL_DA_NHAN || 0)) : 0);
    }, 0);
    const m = byId.get(d.NGUYEN_VAT_LIEU_ID);
    const projected = roundQty(availableOf(m) + incoming - used);
    if (projected < 0) {
      forecastShortages.push({
        orderId: d.DON_HANG_ID, materialId: d.NGUYEN_VAT_LIEU_ID, name: m?.TEN_NGUYEN_VAT_LIEU || d.NGUYEN_VAT_LIEU_ID, unit: m?.DON_VI_TINH,
        neededAt: T, required: Number(d.SO_LUONG), missing: roundQty(-projected), available: availableOf(m), incoming,
      });
    }
  }

  // Tầng 2 — sản phẩm trên website
  const productAlerts: any[] = [];
  for (const p of products as any[]) {
    const lines = bomMap.get(p.SAN_PHAM_ID) || [];
    const { buildable, bottleneck } = computeBuildable(lines, byId);
    const sellable = Math.floor(finishedAvailableOf(p)) + buildable;
    if (sellable <= INVENTORY_CONFIG.productLowStockMax) {
      productAlerts.push({ productId: p.SAN_PHAM_ID, name: p.TEN_SAN_PHAM, sellable, status: sellable <= 0 ? 'out' : 'low', label: sellable <= 0 ? 'Hết hàng' : 'Sắp hết', bottleneck, noBom: !lines.length });
    }
  }
  productAlerts.sort((a, b) => a.sellable - b.sellable);

  // Chất lượng hoa tươi: nguồn nhập còn hàng đã quá số ngày bảo quản → nhắc kiểm tra (không tự loại)
  const now = Date.now();
  const qualityChecks = (sources as any[])
    .map((s) => {
      const m = byId.get(s.NGUYEN_VAT_LIEU_ID);
      const days = Number(m?.SO_NGAY_BAO_QUAN || 0);
      if (m?.NHOM_NVL !== MATERIAL_GROUP.perishable || !days || !s.THOI_DIEM_NHAN) return null;
      const age = (now - new Date(s.THOI_DIEM_NHAN).getTime()) / 86_400_000;
      const usable = roundQty(Number(s.SL_CON_LAI) - Number(s.SL_HONG || 0));
      if (age < days || usable <= 0) return null;
      return { materialId: s.NGUYEN_VAT_LIEU_ID, name: m.TEN_NGUYEN_VAT_LIEU, sourceId: s.PHIEU_NHAP_ID, receivedAt: s.THOI_DIEM_NHAN, ageDays: Math.floor(age), shelfDays: days, quantity: usable, reserved: Number(s.SL_DANG_GIU || 0) };
    })
    .filter(Boolean);

  return {
    summary: {
      materialsOut: materialAlerts.filter((a) => a.status === 'out').length,
      materialsLow: materialAlerts.filter((a) => a.status === 'low').length,
      forecastShortages: forecastShortages.length,
      ordersWithoutSchedule: unscheduled.size,
      productsOut: productAlerts.filter((a) => a.status === 'out').length,
      productsLow: productAlerts.filter((a) => a.status === 'low').length,
      qualityChecks: qualityChecks.length,
    },
    materialAlerts,
    forecastShortages,
    ordersWithoutSchedule: [...unscheduled],
    productAlerts: productAlerts.slice(0, 200),
    qualityChecks,
  };
};

/** Thông tin kho của một đơn (giữ tồn, nhu cầu dự kiến, phiếu xuất) — dùng ở chi tiết đơn Admin. */
export const getOrderInventory = async (orderId: string) => {
  const [reservations, demands, exports] = await Promise.all([
    (await col(COLLECTIONS.reservation)).find({ DON_HANG_ID: orderId }).sort({ TAO_LUC: 1 }).toArray(),
    (await col(COLLECTIONS.demand)).find({ DON_HANG_ID: orderId }).toArray(),
    (await col(COLLECTIONS.exportSlip)).find({ DON_HANG_ID: orderId }).toArray(),
  ]);
  return {
    orderId,
    reservations,
    activeReservations: reservations.filter((r: any) => ACTIVE_RESERVATION_STATUSES.includes(r.TRANG_THAI)),
    demands,
    exports,
    finishedReservations: reservations.filter((r: any) => r.LOAI_DOI_TUONG === ITEM_KIND.finishedGood),
  };
};
