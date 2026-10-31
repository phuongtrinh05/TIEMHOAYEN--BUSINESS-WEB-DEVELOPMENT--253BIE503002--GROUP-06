import { Request, Response } from 'express';
import { getDashboardOverview, computeBestProducts, computeDeliveries } from '../services/analytics/dashboard.service.js';
import { getAnalyticsReport, getReconciliation } from '../services/analytics/reports.service.js';
import { listAdminNotifications, markAdminNotificationsRead, NOTIFICATION_EVENT_MATRIX, syncAdminNotifications } from '../services/analytics/notifications.service.js';
import { ANALYTICS_CONFIG, ATTENTION_RULES, KPI_DICTIONARY } from '../services/analytics/constants.js';
import { getDataset } from '../services/analytics/dataset.js';
import { resolveRange } from '../services/analytics/period.js';

const handle = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    res.status(200).json(await fn(req));
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[analytics]', error);
    res.status(status).json({ message: status >= 500 ? 'Lỗi tổng hợp số liệu: ' + (error?.message || error) : error.message });
  }
};

const isFresh = (req: Request) => req.query.fresh === '1' || req.query.fresh === 'true';

const staffOf = (req: Request) => {
  const pick = (v: any) => (Array.isArray(v) ? v[0] : v) || null;
  return { id: pick(req.headers['x-admin-id']), role: pick(req.headers['x-admin-role']) };
};

/** AD02–AD07 — Tổng quan (một bộ lọc thời gian chung). */
export const getOverview = handle((req) => getDashboardOverview(req.query));

export const getBestProducts = handle(async (req) => {
  const ds = await getDataset({ fresh: isFresh(req) });
  return { items: await computeBestProducts(ds, resolveRange(req.query), req.query.sort === 'revenue' ? 'revenue' : 'quantity', Math.min(50, Number(req.query.limit) || 5)) };
});

export const getDeliveries = handle(async (req) => ({ items: computeDeliveries(await getDataset({ fresh: isFresh(req) }), req.query.mode === 'today' ? 'today' : 'window') }));

/** AD04 + AD60 — Báo cáo phân tích & lợi nhuận. */
export const getReport = handle((req) => getAnalyticsReport(req.query));

/** Đối chiếu đơn – tiền – kho. */
export const getReconcile = handle((req) => getReconciliation({ fresh: isFresh(req) }));

/** D05 + D07 — từ điển KPI, tiêu chí đơn cần chú ý, ma trận thông báo (để FE hiển thị ⓘ & tài liệu). */
export const getDictionary = handle(async () => ({ kpis: KPI_DICTIONARY, attentionRules: ATTENTION_RULES, notificationEvents: NOTIFICATION_EVENT_MATRIX, config: ANALYTICS_CONFIG }));

/** AD09 — Thông báo Admin (đã đọc theo từng nhân viên). */
export const getNotifications = handle((req) => listAdminNotifications(staffOf(req), req.query));
export const readNotification = handle((req) => markAdminNotificationsRead(staffOf(req).id, [String(req.params.id)]));
export const readAllNotifications = handle((req) => markAdminNotificationsRead(staffOf(req).id, 'all', req.body?.group || undefined));
export const syncNotifications = handle(() => syncAdminNotifications(true));
