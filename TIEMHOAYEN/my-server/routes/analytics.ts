import express from 'express';
import * as c from '../controllers/analytics.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';

/**
 * Dashboard, báo cáo, thông báo Admin (AD02–AD07, AD09, AD60) — mount tại /api/admin.
 * Endpoint cũ GET /api/admin/dashboard vẫn giữ để không vỡ code khác.
 */
const router = express.Router();
const view = requireAdminPermission('dashboard', 'view');

router.get('/dashboard/overview', view, c.getOverview);
router.get('/dashboard/best-products', view, c.getBestProducts);
router.get('/dashboard/deliveries', view, c.getDeliveries);
router.get('/dashboard/dictionary', view, c.getDictionary);
router.get('/reports/analytics', view, c.getReport);
router.get('/reports/reconciliation', view, c.getReconcile);

// Thông báo: mọi nhân viên đăng nhập đều xem được (đã lọc theo quyền từng module bên trong)
router.get('/notifications', c.getNotifications);
router.post('/notifications/read-all', c.readAllNotifications);
router.post('/notifications/sync', view, c.syncNotifications);
router.post('/notifications/:id/read', c.readNotification);

export default router;
