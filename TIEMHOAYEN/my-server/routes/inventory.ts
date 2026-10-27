import express from 'express';
import * as c from '../controllers/inventory.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';

/**
 * API KHO — mount tại /api/admin (xem server.ts).
 * Quyền: module "materials" cho kho/NVL/NCC/BOM; module "orders" cho giữ tồn & nhu cầu theo đơn.
 */
const router = express.Router();
const kho = (action?: 'view' | 'create' | 'update' | 'delete') => requireAdminPermission('materials', action);
const don = (action?: 'view' | 'create' | 'update' | 'delete') => requireAdminPermission('orders', action);

router.get('/inventory/meta', kho('view'), c.getInventoryMeta);

// NVL (không có API sửa tồn trực tiếp — tồn chỉ đổi qua PN/PX/đánh dấu không đạt)
router.get('/materials', kho(), c.listMaterials);
router.get('/materials/:materialId', kho(), c.getMaterialDetail);
router.post('/materials', kho(), c.createMaterial);
router.put('/materials/:materialId', kho(), c.updateMaterial);
router.delete('/materials/:materialId', kho(), c.deleteMaterial);
router.post('/materials/:materialId/mark-damaged', kho('update'), c.markMaterialDamaged);

// Nhà cung cấp + nguồn cung từng NVL
router.get('/suppliers', kho(), c.listSuppliers);
router.post('/suppliers', kho(), c.createSupplier);
router.put('/suppliers/:supplierId', kho(), c.updateSupplier);
router.delete('/suppliers/:supplierId', kho(), c.deleteSupplier);
router.get('/supplier-materials', kho(), c.listSupplierMaterials);
router.post('/supplier-materials', kho(), c.createSupplierMaterial);
router.put('/supplier-materials/:id', kho(), c.updateSupplierMaterial);
router.delete('/supplier-materials/:id', kho(), c.deleteSupplierMaterial);

// Đơn đặt mua NCC
router.get('/purchase-orders', kho(), c.listPurchaseOrders);
router.post('/purchase-orders', kho(), c.createPurchaseOrder);
router.put('/purchase-orders/:poId', kho(), c.updatePurchaseOrder);
router.post('/purchase-orders/:poId/status', kho('update'), c.changePurchaseOrderStatus);

// Phiếu nhập kho
router.get('/imports', kho(), c.listImports);
router.get('/imports/:receiptId', kho(), c.getImport);
router.post('/imports', kho(), c.createImport);
router.put('/imports/:receiptId', kho(), c.updateImport);
router.post('/imports/:receiptId/post', kho('update'), c.postImport);
router.post('/imports/:receiptId/cancel', kho('update'), c.cancelImport);
router.delete('/imports/:receiptId', kho(), c.deleteImport);

// Phiếu xuất kho
router.get('/exports', kho(), c.listExports);
router.get('/exports/suggest', kho(), c.suggestExportLines);
router.get('/exports/:receiptId', kho(), c.getExport);
router.post('/exports', kho(), c.createExport);
router.put('/exports/:receiptId', kho(), c.updateExport);
router.post('/exports/:receiptId/post', kho('update'), c.postExport);
router.post('/exports/:receiptId/cancel', kho('update'), c.cancelExport);
router.delete('/exports/:receiptId', kho(), c.deleteExport);

// BOM
router.get('/boms/products', kho(), c.listBomProducts);
router.get('/boms/products/:productId', kho(), c.getProductBoms);
router.post('/boms/products/:productId', kho('create'), c.createBom);
router.post('/boms/validate', kho('view'), c.validateBom);
router.put('/boms/:bomId', kho('update'), c.updateBom);
router.post('/boms/:bomId/activate', kho('update'), c.activateBom);
router.post('/boms/:bomId/retire', kho('update'), c.retireBom);

// Sổ kho, cảnh báo, đối soát, thành phẩm
router.get('/inventory/movements', kho(), c.listMovements);
router.get('/inventory/alerts', kho(), c.getAlerts);
router.post('/inventory/reconcile', kho('update'), c.reconcile);
router.get('/inventory/finished-goods', kho(), c.listFinishedGoods);
router.post('/inventory/finished-goods/:productId/dispose', kho('update'), c.disposeFinishedGoods);

// Giữ tồn & nhu cầu theo đơn (dùng cho luồng đặt hàng S3–S5)
router.get('/inventory/reservations', don('view'), c.listReservations);
router.post('/inventory/reservations', don('create'), c.reserveProducts);
router.post('/inventory/reservations/confirm', don('update'), c.confirmReservations);
router.post('/inventory/reservations/release', don('update'), c.releaseReservations);
router.post('/inventory/reservations/sweep', don('update'), c.sweepReservations);
router.get('/inventory/demands', don('view'), c.listDemands);
router.get('/inventory/orders/:orderId', don('view'), c.getOrderInventoryInfo);
router.post('/inventory/orders/:orderId/demand', don('create'), c.recordOrderDemand);
router.patch('/inventory/orders/:orderId/prep-start', don('update'), c.setOrderPrepTime);
router.post('/inventory/orders/:orderId/reserve', don('update'), c.reserveOrderDemand);
router.post('/inventory/orders/:orderId/cancel', don('update'), c.cancelOrderInventory);
router.post('/inventory/orders/:orderId/ship-finished', don('update'), c.shipFinishedGoods);

export default router;
