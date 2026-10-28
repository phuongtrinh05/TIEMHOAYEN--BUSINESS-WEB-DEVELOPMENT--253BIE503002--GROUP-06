import { Request, Response } from 'express';
import { actorFromRequest, col, InventoryError, normalizeText } from '../services/inventory/helpers.js';
import { BOM_STATUS, COLLECTIONS, EXPORT_TYPES, IMPORT_TYPES, INVENTORY_CONFIG, MATERIAL_TYPES, PO_STATUS, RESERVATION_STATUS, SUPPLIER_STATUSES } from '../services/inventory/constants.js';
import * as master from '../services/inventory/master-data.service.js';
import * as stock from '../services/inventory/stock.service.js';
import * as bom from '../services/inventory/bom.service.js';
import { checkProductAvailability, computeBuildable, getInventoryAlerts, getOrderInventory } from '../services/inventory/availability.service.js';
import { finishedAvailableOf } from '../services/inventory/helpers.js';

/** Bọc handler: lỗi nghiệp vụ trả đúng mã + chi tiết; lỗi khác trả 500. */
const handle = (fn: (req: Request, res: Response) => Promise<unknown>, successStatus = 200) =>
  async (req: Request, res: Response) => {
    try {
      const data = await fn(req, res);
      if (!res.headersSent) res.status(successStatus).json(data);
    } catch (error: any) {
      if (error instanceof InventoryError) {
        return res.status(error.status).json({ message: error.message, details: error.details ?? null });
      }
      console.error('[inventory]', error);
      return res.status(500).json({ message: 'Lỗi hệ thống kho: ' + (error?.message || error) });
    }
  };

const p = (req: Request, key: string) => String(req.params[key]);

/* ---------- Cấu hình & danh mục giá trị ---------- */
export const getInventoryMeta = handle(async () => ({
  config: INVENTORY_CONFIG,
  materialTypes: MATERIAL_TYPES,
  importTypes: Object.values(IMPORT_TYPES),
  exportTypes: Object.values(EXPORT_TYPES),
  poStatuses: Object.values(PO_STATUS),
  supplierStatuses: SUPPLIER_STATUSES,
  bomStatuses: Object.values(BOM_STATUS),
  reservationStatuses: Object.values(RESERVATION_STATUS),
}));

/* ---------- NVL ---------- */
export const listMaterials = handle((req) => master.listMaterials(req.query));
export const getMaterialDetail = handle((req) => master.getMaterialDetail(p(req, 'materialId')));
export const createMaterial = handle(async (req) => ({ message: 'Đã tạo NVL.', material: await master.createMaterial(req.body, actorFromRequest(req)) }), 201);
export const updateMaterial = handle(async (req) => ({ message: 'Đã cập nhật NVL.', material: await master.updateMaterial(p(req, 'materialId'), req.body, actorFromRequest(req)) }));
export const deleteMaterial = handle((req) => master.deleteOrHideMaterial(p(req, 'materialId'), actorFromRequest(req)));
export const markMaterialDamaged = handle((req) => stock.markMaterialDamaged({ ...req.body, materialId: p(req, 'materialId') }, actorFromRequest(req)));

/* ---------- NCC & nguồn cung ---------- */
export const listSuppliers = handle((req) => master.listSuppliers(req.query));
export const createSupplier = handle(async (req) => ({ message: 'Đã thêm nhà cung cấp.', supplier: await master.createSupplier(req.body, actorFromRequest(req)) }), 201);
export const updateSupplier = handle(async (req) => ({ message: 'Đã cập nhật nhà cung cấp.', supplier: await master.updateSupplier(p(req, 'supplierId'), req.body, actorFromRequest(req)) }));
export const deleteSupplier = handle((req) => master.deleteOrDeactivateSupplier(p(req, 'supplierId'), actorFromRequest(req)));
export const listSupplierMaterials = handle((req) => master.listSupplierMaterials(req.query));
export const createSupplierMaterial = handle((req) => master.upsertSupplierMaterial(req.body, actorFromRequest(req)), 201);
export const updateSupplierMaterial = handle((req) => master.upsertSupplierMaterial(req.body, actorFromRequest(req), p(req, 'id')));
export const deleteSupplierMaterial = handle((req) => master.deleteSupplierMaterial(p(req, 'id')));

/* ---------- PO ---------- */
export const listPurchaseOrders = handle((req) => master.listPurchaseOrders(req.query));
export const createPurchaseOrder = handle((req) => master.createPurchaseOrder(req.body, actorFromRequest(req)), 201);
export const updatePurchaseOrder = handle((req) => master.updatePurchaseOrder(p(req, 'poId'), req.body, actorFromRequest(req)));
export const changePurchaseOrderStatus = handle((req) => master.changePurchaseOrderStatus(p(req, 'poId'), String(req.body.status || ''), actorFromRequest(req), req.body.note));

/* ---------- PN ---------- */
export const listImports = handle((req) => master.listDocuments('import', req.query));
export const getImport = handle((req) => stock.getImport(p(req, 'receiptId')));
export const createImport = handle((req) => stock.createImport(req.body, actorFromRequest(req)), 201);
export const updateImport = handle((req) => stock.updateImport(p(req, 'receiptId'), req.body, actorFromRequest(req)));
export const postImport = handle((req) => stock.postImport(p(req, 'receiptId'), actorFromRequest(req)));
export const cancelImport = handle((req) => stock.cancelDraftDocument('import', p(req, 'receiptId'), actorFromRequest(req), req.body?.reason));
export const deleteImport = handle((req) => stock.deleteDraftDocument('import', p(req, 'receiptId')));

/* ---------- PX ---------- */
export const listExports = handle((req) => master.listDocuments('export', req.query));
export const getExport = handle((req) => stock.getExport(p(req, 'receiptId')));
export const suggestExportLines = handle((req) => stock.suggestExportLines({
  type: String(req.query.type || ''), orderId: String(req.query.orderId || ''), productId: String(req.query.productId || ''), bundles: Number(req.query.bundles || 1),
}));
export const createExport = handle((req) => stock.createExport(req.body, actorFromRequest(req)), 201);
export const updateExport = handle((req) => stock.updateExport(p(req, 'receiptId'), req.body, actorFromRequest(req)));
export const postExport = handle((req) => stock.postExport(p(req, 'receiptId'), actorFromRequest(req)));
export const cancelExport = handle((req) => stock.cancelDraftDocument('export', p(req, 'receiptId'), actorFromRequest(req), req.body?.reason));
export const deleteExport = handle((req) => stock.deleteDraftDocument('export', p(req, 'receiptId')));

/* ---------- BOM ---------- */
export const listBomProducts = handle(async (req) => {
  const search = normalizeText(req.query.search || '');
  const products = await (await col(COLLECTIONS.product)).find({}).project({ SAN_PHAM_ID: 1, TEN_SAN_PHAM: 1, KIEU_DANG: 1, GIA: 1, GIA_KHUYEN_MAI: 1, TRANG_THAI: 1, TON_THANH_PHAM: 1, TP_DANG_GIU: 1 }).sort({ SAN_PHAM_ID: 1 }).toArray();
  const filtered = search ? products.filter((x: any) => normalizeText(`${x.SAN_PHAM_ID} ${x.TEN_SAN_PHAM}`).includes(search)) : products;
  const boms = await (await col(COLLECTIONS.bom)).find({}).project({ SAN_PHAM_ID: 1, TRANG_THAI: 1, PHIEN_BAN: 1, BOM_ID: 1, CAN_RA_SOAT: 1 }).toArray();
  const bomMap = await bom.getActiveBomMap(filtered.map((x: any) => x.SAN_PHAM_ID));
  const materials = await (await col(COLLECTIONS.material)).find({}).toArray();
  const byId = new Map(materials.map((m: any) => [m.NGUYEN_VAT_LIEU_ID, m]));
  return {
    total: filtered.length,
    items: filtered.map((x: any) => {
      const mine = boms.filter((b: any) => b.SAN_PHAM_ID === x.SAN_PHAM_ID);
      const active: any = mine.find((b: any) => b.TRANG_THAI === BOM_STATUS.active);
      const lines = bomMap.get(x.SAN_PHAM_ID) || [];
      const { buildable, bottleneck } = computeBuildable(lines, byId);
      return {
        ...x,
        activeBomId: active?.BOM_ID || null,
        activeVersion: active?.PHIEN_BAN || null,
        needsReview: Boolean(active?.CAN_RA_SOAT),
        draftCount: mine.filter((b: any) => b.TRANG_THAI === BOM_STATUS.draft).length,
        lineCount: lines.length,
        finishedAvailable: finishedAvailableOf(x),
        buildable,
        sellable: finishedAvailableOf(x) + buildable,
        bottleneck,
      };
    }),
  };
});
export const getProductBoms = handle(async (req) => {
  const data = await bom.listProductBoms(p(req, 'productId'));
  const withCost = await Promise.all(data.boms.map(async (b: any) => ({ ...b, cost: await bom.estimateBomCost(b.lines) })));
  return { ...data, boms: withCost };
});
export const createBom = handle((req) => bom.createBomVersion(p(req, 'productId'), req.body, actorFromRequest(req)), 201);
export const updateBom = handle((req) => bom.updateBomDraft(p(req, 'bomId'), req.body, actorFromRequest(req)));
export const activateBom = handle((req) => bom.activateBom(p(req, 'bomId'), actorFromRequest(req)));
export const retireBom = handle((req) => bom.retireBom(p(req, 'bomId'), actorFromRequest(req)));
export const validateBom = handle(async (req) => bom.validateBomLines(req.body?.lines || []));

/* ---------- Giữ tồn / nhu cầu / thành phẩm ---------- */
export const listReservations = handle((req) => master.listReservations(req.query));
export const reserveProducts = handle((req) => stock.reserveProducts(req.body.items || [], {
  status: req.body.status === RESERVATION_STATUS.official ? RESERVATION_STATUS.official : RESERVATION_STATUS.temporary,
  orderId: req.body.orderId || null,
  paymentSessionId: req.body.paymentSessionId || null,
  neededAt: req.body.neededAt ? new Date(req.body.neededAt) : null,
  actor: actorFromRequest(req),
}), 201);
export const confirmReservations = handle((req) => stock.confirmReservations({ paymentSessionId: req.body.paymentSessionId, orderId: req.body.orderId }, req.body.attachOrderId || req.body.orderId || null, actorFromRequest(req)));
export const releaseReservations = handle((req) => stock.releaseReservations({ orderId: req.body.orderId, paymentSessionId: req.body.paymentSessionId, reservationIds: req.body.reservationIds }, actorFromRequest(req), req.body.reason || 'Admin nhả giữ'));
export const sweepReservations = handle(() => stock.sweepExpiredReservations());
export const listDemands = handle((req) => master.listDemands(req.query));
export const recordOrderDemand = handle((req) => stock.recordOrderDemand(p(req, 'orderId'), req.body || {}, actorFromRequest(req)), 201);
export const setOrderPrepTime = handle((req) => stock.setOrderPrepTime(p(req, 'orderId'), req.body.neededAt ?? req.body.prepStartAt, actorFromRequest(req)));
export const reserveOrderDemand = handle((req) => stock.reserveOrderDemand(p(req, 'orderId'), actorFromRequest(req)));
export const cancelOrderInventory = handle((req) => stock.cancelOrderInventory(p(req, 'orderId'), actorFromRequest(req)));
export const shipFinishedGoods = handle((req) => stock.shipFinishedGoodsForOrder(p(req, 'orderId'), actorFromRequest(req)));
export const getOrderInventoryInfo = handle((req) => getOrderInventory(p(req, 'orderId')));
export const listFinishedGoods = handle(() => master.listFinishedGoods());
export const disposeFinishedGoods = handle((req) => stock.disposeFinishedGoods(p(req, 'productId'), req.body.quantity, req.body.note || '', actorFromRequest(req)));

/* ---------- Sổ kho / cảnh báo / đối soát ---------- */
export const listMovements = handle((req) => master.listMovements(req.query));
export const getAlerts = handle(() => getInventoryAlerts());
export const reconcile = handle((req) => stock.reconcileInventory(req.body?.fix === true));

/* ---------- Public: kiểm tra khả năng đáp ứng ---------- */
export const getProductAvailability = handle((req) => checkProductAvailability(p(req, 'id'), req.query.qty, req.query.deliveryAt));
