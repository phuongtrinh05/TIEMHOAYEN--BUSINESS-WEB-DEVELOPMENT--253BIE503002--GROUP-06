import express from 'express';
import zlib from 'node:zlib';
import * as c from '../controllers/analytics.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';

/**
 * Dashboard, báo cáo, thông báo Admin (AD02–AD07, AD09, AD60) — mount tại /api/admin.
 * Endpoint cũ GET /api/admin/dashboard vẫn giữ để không vỡ code khác.
 */
const router = express.Router();

/**
 * Nén gzip các phản hồi JSON lớn của Dashboard / báo cáo (báo cáo có thể vài nghìn dòng).
 * Không cần thêm thư viện: dùng zlib có sẵn của Node. Chỉ áp dụng cho router này.
 */
router.use((req, res, next) => {
  const accepts = String(req.headers['accept-encoding'] || '');
  // Router mount chung /api/admin → chỉ nén đường dẫn của module này, không đụng API khác
  if (!/^\/(dashboard|reports|notifications)\//.test(req.path) || !/\bgzip\b/.test(accepts)) return next();
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    const raw = Buffer.from(JSON.stringify(body));
    if (raw.length < 8 * 1024) return json(body);
    const gz = zlib.gzipSync(raw, { level: 5 });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', String(gz.length));
    res.end(gz);
    return res;
  };
  next();
});
const view = requireAdminPermission('dashboard', 'view');

router.get('/dashboard/overview', view, c.getOverview);
router.get('/dashboard/best-products', view, c.getBestProducts);
router.get('/dashboard/deliveries', view, c.getDeliveries);
router.get('/dashboard/dictionary', view, c.getDictionary);
router.get('/reports/analytics', view, c.getReport);
router.get('/reports/reconciliation', view, c.getReconcile);
router.get('/dashboard/analysis', view, c.getAnalysisPage);
router.get('/reports/catalog', view, c.getCatalog);
router.get('/reports/run/:key', view, c.getReportRun);

// Thông báo: mọi nhân viên đăng nhập đều xem được (đã lọc theo quyền từng module bên trong)
router.get('/notifications', c.getNotifications);
router.post('/notifications/read-all', c.readAllNotifications);
router.post('/notifications/sync', view, c.syncNotifications);
router.post('/notifications/:id/read', c.readNotification);

export default router;
