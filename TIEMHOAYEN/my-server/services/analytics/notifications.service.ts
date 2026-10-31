import { ObjectId } from 'mongodb';
import { getCollection } from '../../mongo.js';
import { hasPermission } from '../role-permission.service.js';
import { ANALYTICS_CONFIG, NOTIFICATION_GROUPS, NOTIFICATION_PRIORITY, NotificationGroup, ORDER_STATUS } from './constants.js';
import { getDataset } from './dataset.js';
import { computeDeliveries, getCachedInventoryAlerts } from './dashboard.service.js';
import { PO_STATUS } from '../inventory/constants.js';

/**
 * AD09 — THÔNG BÁO ADMIN (D07 Notification Event Matrix)
 *
 * Tách khỏi THONG_BAO của khách hàng: THONG_BAO hiện trả các bản ghi KHACH_HANG_ID = null cho mọi khách
 * (getPublicNotifications) nên KHÔNG thể ghi thông báo nội bộ vào đó.
 *  - THONG_BAO_ADMIN: 1 bản ghi / sự kiện, khóa chống trùng KHOA_SU_KIEN (unique)
 *  - THONG_BAO_ADMIN_DA_DOC: trạng thái đã đọc THEO TỪNG NHÂN VIÊN (_id = <TB>:<NV>)
 * Nguồn sự kiện: (1) module khác gọi emitAdminNotification(); (2) bộ quét định kỳ syncAdminNotifications()
 * — idempotent, đồng thời tự đánh dấu "đã xử lý xong" khi điều kiện không còn đúng.
 */

const NOTI = 'THONG_BAO_ADMIN';
const READS = 'THONG_BAO_ADMIN_DA_DOC';
const STATE = 'BO_DEM_MA';

export interface AdminNotificationEvent {
  key: string; // khóa chống trùng, ví dụ ORDER_NEW:YEN16121
  type: string; // mã sự kiện D07
  group: NotificationGroup;
  priority: 'Cao' | 'Trung bình' | 'Thấp';
  title: string;
  message: string;
  link: string; // route Admin
  queryParams?: Record<string, string>;
  module: string; // quyền cần có để thấy (orders | materials | customerService | payments | dashboard)
  entityId?: string | null;
  /** Sự kiện trạng thái: tự đánh dấu đã xử lý khi bộ quét không còn thấy */
  stateful?: boolean;
}

/** D07 — ma trận sự kiện (hiển thị ở trang Từ điển & tài liệu). */
export const NOTIFICATION_EVENT_MATRIX = [
  { type: 'ORDER_NEW', group: 'Đơn hàng', priority: 'Trung bình', module: 'orders', trigger: 'Đơn mới "Chờ xử lý"', link: 'Chi tiết đơn', autoResolve: 'Khi đơn rời "Chờ xử lý"' },
  { type: 'ORDER_PENDING_LONG', group: 'Đơn hàng', priority: 'Cao', module: 'orders', trigger: `Chờ xử lý quá ${ANALYTICS_CONFIG.pendingTooLongMinutes} phút`, link: 'Chi tiết đơn', autoResolve: 'Khi đơn được xử lý' },
  { type: 'DELIVERY_DUE', group: 'Đơn hàng', priority: 'Cao', module: 'orders', trigger: `Đơn đã xác nhận giao trong ≤ ${ANALYTICS_CONFIG.deliveryOrangeMinutes} phút`, link: 'Chi tiết đơn', autoResolve: 'Khi đơn Đã giao/Hoàn thành/Hủy' },
  { type: 'DELIVERY_OVERDUE', group: 'Đơn hàng', priority: 'Cao', module: 'orders', trigger: 'Quá giờ giao mà chưa giao', link: 'Chi tiết đơn', autoResolve: 'Khi đơn Đã giao/Hoàn thành/Hủy' },
  { type: 'PAYMENT_FAILED', group: 'Đơn hàng', priority: 'Trung bình', module: 'payments', trigger: 'Đơn "Thanh toán thất bại"', link: 'Chi tiết đơn', autoResolve: 'Không' },
  { type: 'SALES_REQUEST_NEW', group: 'Đơn hàng', priority: 'Cao', module: 'orders', trigger: 'Yêu cầu đặt hàng "Chờ Sales tiếp nhận"', link: 'Yêu cầu đặt hàng', autoResolve: 'Khi Sales tiếp nhận' },
  { type: 'SALES_REQUEST_ACCEPTED', group: 'Đơn hàng', priority: 'Cao', module: 'orders', trigger: 'Khách đã đồng ý phương án → cần lên đơn', link: 'Yêu cầu đặt hàng', autoResolve: 'Khi đã lên đơn' },
  { type: 'REFUND_REQUEST', group: 'Khiếu nại', priority: 'Cao', module: 'orders', trigger: 'Đơn "Yêu cầu hoàn tiền/trả hàng"', link: 'Chi tiết đơn', autoResolve: 'Khi đơn đổi trạng thái' },
  { type: 'SUPPORT_WAITING', group: 'Khiếu nại', priority: 'Trung bình', module: 'customerService', trigger: 'Yêu cầu hỗ trợ chờ nhân viên (Form / chuyển từ bot / khẩn)', link: 'Hộp thư hỗ trợ', autoResolve: 'Khi có nhân viên nhận / đã xử lý' },
  { type: 'REVIEW_LOW', group: 'Khiếu nại', priority: 'Trung bình', module: 'products', trigger: 'Đánh giá ≤ 2 sao', link: 'Chi tiết sản phẩm', autoResolve: 'Không' },
  { type: 'STOCK_OUT', group: 'Tồn kho', priority: 'Cao', module: 'materials', trigger: 'NVL hết khả dụng', link: 'Nguyên vật liệu', autoResolve: 'Khi khả dụng > 0' },
  { type: 'STOCK_LOW', group: 'Tồn kho', priority: 'Trung bình', module: 'materials', trigger: 'NVL khả dụng ≤ ngưỡng', link: 'Nguyên vật liệu', autoResolve: 'Khi khả dụng > ngưỡng' },
  { type: 'STOCK_FORECAST_SHORT', group: 'Tồn kho', priority: 'Cao', module: 'materials', trigger: 'Dự báo thiếu NVL trước lịch chuẩn bị T', link: 'Tổng quan kho', autoResolve: 'Khi hết thiếu' },
  { type: 'PO_LATE', group: 'Tồn kho', priority: 'Trung bình', module: 'materials', trigger: 'PO "Đang giao" quá ngày dự kiến', link: 'Đặt mua NCC', autoResolve: 'Khi PO đóng / đổi ngày' },
  { type: 'FRESH_QUALITY_CHECK', group: 'Tồn kho', priority: 'Thấp', module: 'materials', trigger: 'Hoa tươi quá số ngày bảo quản', link: 'Tổng quan kho', autoResolve: 'Khi xuất hết / đánh dấu' },
  { type: 'RECONCILE_ISSUE', group: 'Hệ thống', priority: 'Cao', module: 'dashboard', trigger: 'Đối chiếu đơn–tiền–kho phát hiện lệch (mức Cao)', link: 'Tổng quan → Đối chiếu', autoResolve: 'Khi hết lệch' },
];

export const ensureNotificationIndexes = async () => {
  await Promise.allSettled([
    (await getCollection<any>(NOTI)).createIndex({ KHOA_SU_KIEN: 1 }, { unique: true, name: 'uniq_khoa_su_kien' }),
    (await getCollection<any>(NOTI)).createIndex({ NGAY_TAO: -1 }, { name: 'tb_admin_ngay' }),
    (await getCollection<any>(READS)).createIndex({ NHAN_VIEN_ID: 1, THONG_BAO_ID: 1 }, { name: 'tb_admin_doc' }),
  ]);
};

/** Lệnh upsert theo khóa sự kiện (dùng chung cho ghi lẻ và ghi hàng loạt). */
const notificationUpdate = (e: AdminNotificationEvent, now: Date) => ({
      $setOnInsert: {
        _id: `TBA${new ObjectId().toHexString().slice(-10).toUpperCase()}`,
        KHOA_SU_KIEN: e.key, LOAI: e.type, NHOM: e.group, MUC_DO: e.priority, MODULE: e.module,
        DOI_TUONG_ID: e.entityId || null, NGAY_TAO: now, TU_DONG: Boolean(e.stateful),
      },
      $set: { TIEU_DE: e.title, NOI_DUNG: e.message, DUONG_DAN: e.link, THAM_SO: e.queryParams || null, NGAY_CAP_NHAT: now, DA_XU_LY: false, NGAY_XU_LY: null },
});

/** Ghi 1 sự kiện (idempotent theo key). Module khác có thể gọi trực tiếp, kể cả trong transaction. */
export const emitAdminNotification = async (e: AdminNotificationEvent, session?: any) => {
  const col = await getCollection<any>(NOTI);
  return col.findOneAndUpdate({ KHOA_SU_KIEN: e.key }, notificationUpdate(e, new Date()), { upsert: true, returnDocument: 'after', session });
};

let syncing: Promise<any> | null = null;

/** Quét dữ liệu hiện tại → sinh/cập nhật thông báo. Gọi tối đa mỗi notificationSyncSeconds. */
export const syncAdminNotifications = async (force = false) => {
  if (syncing) return syncing;
  syncing = (async () => {
    const state = await getCollection<any>(STATE);
    const last = await state.findOne({ _id: 'sync:admin-notifications' as any });
    if (!force && last?.at && Date.now() - new Date(last.at).getTime() < ANALYTICS_CONFIG.notificationSyncSeconds * 1000) return { skipped: true };
    await state.updateOne({ _id: 'sync:admin-notifications' as any }, { $set: { at: new Date() } }, { upsert: true });

    const events: AdminNotificationEvent[] = [];
    const now = new Date();
    const lookback = new Date(now.getTime() - ANALYTICS_CONFIG.notificationLookbackDays * 86_400_000);
    // Đọc song song mọi nguồn; dataset/kho/đối chiếu dùng chung cache với Dashboard (allowStale=false → luôn ≤ ttl)
    const { getReconciliation, warmAnalyticsCaches } = await import('./reports.service.js');
    const [ds, requests, tickets, reviews, alerts, lateOrders, rec] = await Promise.all([
      getDataset({ allowStale: false, fresh: force }),
      getCollection<any>('YEU_CAU_DAT_HANG').then((c) => c.find({ status: { $in: ['Chờ Sales tiếp nhận', 'Khách đã đồng ý'] } }).project({ requestId: 1, status: 1, createdAt: 1, contact: 1, delivery: 1 }).limit(200).toArray()).catch(() => [] as any[]),
      getCollection<any>('YEU_CAU_HO_TRO').then((c) => c.find({ status: 'Chưa xử lý', $or: [{ mode: 'WAITING' }, { priority: 'urgent' }] }).project({ _id: 1, name: 1, source: 1, priority: 1, reason: 1 }).limit(200).toArray()).catch(() => [] as any[]),
      getCollection<any>('DANH_GIA').then((c) => c.find({ SO_SAO: { $lte: 2 }, NGAY_DANH_GIA: { $gte: lookback } }).limit(100).toArray()).catch(() => [] as any[]),
      getCachedInventoryAlerts({ allowStale: false, fresh: force }),
      getCollection<any>('DON_DAT_MUA_NCC').then((c) => c.find({ TRANG_THAI: PO_STATUS.shipping, NGAY_GIO_DU_KIEN_GIAO: { $lt: now } }).toArray()).catch(() => [] as any[]),
      getReconciliation({ allowStale: false, fresh: force }).catch(() => null),
    ]);
    const fmtMoney = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;
    const orderLink = (id: string) => `/orders/order-detail/${encodeURIComponent(id)}`;

    ds.orders.forEach((o) => {
      const recent = o.createdAt && o.createdAt >= lookback;
      if (recent && [ORDER_STATUS.pending, ORDER_STATUS.confirmed].includes(o.status as any)) {
        events.push({ key: `ORDER_NEW:${o.id}`, type: 'ORDER_NEW', group: 'Đơn hàng', priority: 'Trung bình', module: 'orders', stateful: true, entityId: o.id,
          title: `Đơn mới ${o.id}`, message: `${fmtMoney(o.total)} · ${o.recipient || 'khách'} · chờ xác nhận`, link: orderLink(o.id) });
        const age = o.createdAt ? (now.getTime() - o.createdAt.getTime()) / 60_000 : 0;
        if (age > ANALYTICS_CONFIG.pendingTooLongMinutes) {
          events.push({ key: `ORDER_PENDING_LONG:${o.id}`, type: 'ORDER_PENDING_LONG', group: 'Đơn hàng', priority: 'Cao', module: 'orders', stateful: true, entityId: o.id,
            title: `Đơn ${o.id} chờ xử lý quá ${ANALYTICS_CONFIG.pendingTooLongMinutes} phút`, message: `Tạo lúc ${o.createdAt?.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`, link: orderLink(o.id) });
        }
      }
      if (recent && o.status === ORDER_STATUS.paymentFailed) {
        events.push({ key: `PAYMENT_FAILED:${o.id}`, type: 'PAYMENT_FAILED', group: 'Đơn hàng', priority: 'Trung bình', module: 'payments', entityId: o.id,
          title: `Thanh toán thất bại — ${o.id}`, message: `${fmtMoney(o.total)}. Liên hệ khách thanh toán lại hoặc hủy đơn.`, link: orderLink(o.id) });
      }
      if (o.status === ORDER_STATUS.refundRequested) {
        events.push({ key: `REFUND_REQUEST:${o.id}`, type: 'REFUND_REQUEST', group: 'Khiếu nại', priority: 'Cao', module: 'orders', stateful: true, entityId: o.id,
          title: `Yêu cầu trả/hoàn — ${o.id}`, message: String(o.raw.LY_DO_HOAN_TIEN_TRA_HANG || 'Khách yêu cầu trả hàng / hoàn tiền'), link: orderLink(o.id) });
      }
    });

    computeDeliveries(ds, 'window', now).forEach((d) => {
      if (d.minutesLeft < 0) {
        events.push({ key: `DELIVERY_OVERDUE:${d.orderId}`, type: 'DELIVERY_OVERDUE', group: 'Đơn hàng', priority: 'Cao', module: 'orders', stateful: true, entityId: d.orderId,
          title: `Quá giờ giao — ${d.orderId}`, message: `Hẹn ${d.slot || ''} · ${d.recipient} · trạng thái "${d.status}"`, link: d.link });
      } else if (d.minutesLeft <= ANALYTICS_CONFIG.deliveryOrangeMinutes && d.status !== ORDER_STATUS.shipping) {
        events.push({ key: `DELIVERY_DUE:${d.orderId}`, type: 'DELIVERY_DUE', group: 'Đơn hàng', priority: 'Cao', module: 'orders', stateful: true, entityId: d.orderId,
          title: `Còn ${d.minutesLeft} phút tới giờ giao — ${d.orderId}`, message: `${d.recipient} · ${d.address}`, link: d.link });
      }
    });

    requests.forEach((r: any) => {
      const accepted = r.status === 'Khách đã đồng ý';
      events.push({ key: `${accepted ? 'SALES_REQUEST_ACCEPTED' : 'SALES_REQUEST_NEW'}:${r.requestId}`, type: accepted ? 'SALES_REQUEST_ACCEPTED' : 'SALES_REQUEST_NEW',
        group: 'Đơn hàng', priority: 'Cao', module: 'orders', stateful: true, entityId: r.requestId,
        title: accepted ? `Khách đã đồng ý phương án — ${r.requestId}` : `Yêu cầu đặt hàng mới — ${r.requestId}`,
        message: accepted ? 'Kiểm tra tồn lần cuối và lên đơn.' : 'Sales tiếp nhận, kiểm tra nguồn hoa và liên hệ khách.',
        link: '/orders/requests', queryParams: { requestId: String(r.requestId) } });
    });

    tickets.forEach((t: any) => events.push({ key: `SUPPORT_WAITING:${t._id}`, type: 'SUPPORT_WAITING', group: 'Khiếu nại', priority: t.priority === 'urgent' ? 'Cao' : 'Trung bình',
      module: 'customerService', stateful: true, entityId: String(t._id), title: `${t.source === 'Form' ? 'Form liên hệ' : 'Khách chờ nhân viên'} — ${t.name || 'Khách'}`,
      message: t.reason || (t.priority === 'urgent' ? 'Yêu cầu khẩn' : 'Chưa có nhân viên tiếp nhận'), link: '/customer-service', queryParams: { ticketId: String(t._id) } }));

    reviews.forEach((r: any) => events.push({ key: `REVIEW_LOW:${r.DANH_GIA_ID || r._id}`, type: 'REVIEW_LOW', group: 'Khiếu nại', priority: 'Trung bình', module: 'products',
      entityId: String(r.SAN_PHAM_ID || ''), title: `Đánh giá ${r.SO_SAO}★ — ${ds.products.get(String(r.SAN_PHAM_ID))?.TEN_SAN_PHAM || r.SAN_PHAM_ID}`,
      message: String(r.NOI_DUNG || '').slice(0, 140) || 'Không có nội dung', link: '/products/product-detail', queryParams: { id: String(r.SAN_PHAM_ID || '') } }));

    if (alerts) {
      const today = now.toISOString().slice(0, 10);
      alerts.materialAlerts.forEach((m: any) => events.push({
        key: `${m.status === 'out' ? 'STOCK_OUT' : 'STOCK_LOW'}:${m.materialId}`, type: m.status === 'out' ? 'STOCK_OUT' : 'STOCK_LOW', group: 'Tồn kho',
        priority: m.status === 'out' ? 'Cao' : 'Trung bình', module: 'materials', stateful: true, entityId: m.materialId,
        title: `${m.name} ${m.status === 'out' ? 'hết kho' : 'sắp hết'}`, message: `Khả dụng ${m.available} ${m.unit || ''} / ngưỡng ${m.threshold}. Gợi ý nhập ${m.suggestedOrder}.`,
        link: '/materials/stock' }));
      alerts.forecastShortages.forEach((f: any) => events.push({
        key: `STOCK_FORECAST_SHORT:${f.orderId}:${f.materialId}`, type: 'STOCK_FORECAST_SHORT', group: 'Tồn kho', priority: 'Cao', module: 'materials', stateful: true, entityId: f.orderId,
        title: `Đơn ${f.orderId} dự kiến thiếu ${f.name}`, message: `Thiếu ${f.missing} ${f.unit || ''} trước ${new Date(f.neededAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
        link: '/materials/stock' }));
      alerts.qualityChecks.forEach((q: any) => events.push({
        key: `FRESH_QUALITY_CHECK:${q.sourceId}:${q.materialId}:${today}`, type: 'FRESH_QUALITY_CHECK', group: 'Tồn kho', priority: 'Thấp', module: 'materials', stateful: true, entityId: q.materialId,
        title: `Kiểm tra chất lượng ${q.name} (${q.sourceId})`, message: `Đã nhập ${q.ageDays} ngày (hạn ${q.shelfDays}). Còn ${q.quantity}.`, link: '/materials' }));
    }

    lateOrders.forEach((po: any) => events.push({ key: `PO_LATE:${po.PO_ID}:${new Date(po.NGAY_GIO_DU_KIEN_GIAO).toISOString()}`, type: 'PO_LATE', group: 'Tồn kho', priority: 'Trung bình',
      module: 'materials', stateful: true, entityId: po.PO_ID, title: `PO ${po.PO_ID} trễ giao`, message: `Dự kiến ${new Date(po.NGAY_GIO_DU_KIEN_GIAO).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}. Liên hệ NCC, cập nhật ngày hoặc nhận hàng.`,
      link: '/materials/purchase-orders' }));

    if (rec) {
      rec.issues.filter((i: any) => i.count > 0 && i.severity === 'Cao').forEach((i: any) => events.push({
        key: `RECONCILE_ISSUE:${i.code}`, type: 'RECONCILE_ISSUE', group: 'Hệ thống', priority: 'Cao', module: 'dashboard', stateful: true, entityId: i.code,
        title: `Đối chiếu: ${i.title}`, message: `${i.count} trường hợp. ${i.hint}`, link: '/dashboard', queryParams: { section: 'doi-soat' } }));
    }

    // 1 lệnh bulkWrite thay cho N lệnh upsert tuần tự
    const col = await getCollection<any>(NOTI);
    const unique = [...new Map(events.map((e) => [e.key, e])).values()];
    if (unique.length) {
      const at = new Date();
      await col.bulkWrite(unique.map((e) => ({ updateOne: { filter: { KHOA_SU_KIEN: e.key }, update: notificationUpdate(e, at), upsert: true } })), { ordered: false });
    }

    // Tự đánh dấu "đã xử lý" cho sự kiện trạng thái không còn đúng
    const activeKeys = events.filter((e) => e.stateful).map((e) => e.key);
    const resolved = await col.updateMany(
      { TU_DONG: true, DA_XU_LY: { $ne: true }, KHOA_SU_KIEN: { $nin: activeKeys } },
      { $set: { DA_XU_LY: true, NGAY_XU_LY: new Date() } },
    );
    warmAnalyticsCaches().catch(() => void 0);
    return { events: events.length, resolved: resolved.modifiedCount };
  })().finally(() => { syncing = null; });
  return syncing;
};

/** Danh sách thông báo cho 1 nhân viên: lọc theo quyền module, kèm trạng thái đã đọc riêng. */
export const listAdminNotifications = async (staff: { id: string | null; role: string | null }, query: any) => {
  // Không chờ bộ quét (đã chạy định kỳ ngầm) → danh sách trả ngay từ THONG_BAO_ADMIN
  syncAdminNotifications(false).catch((e) => console.error('[notifications] sync lỗi', e));
  const role = staff.role || '';
  const visibleModules = ['orders', 'payments', 'materials', 'customerService', 'products', 'dashboard'].filter((m) => Boolean(role) && hasPermission(role, m, 'view'));
  const filter: any = { MODULE: { $in: visibleModules } };
  if (query.group && NOTIFICATION_GROUPS.includes(query.group)) filter.NHOM = query.group;
  if (query.includeResolved !== 'true') filter.DA_XU_LY = { $ne: true };
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  const col = await getCollection<any>(NOTI);
  const rows = await col.find(filter).sort({ NGAY_TAO: -1 }).limit(500).toArray();
  const reads = staff.id
    ? new Set((await (await getCollection<any>(READS)).find({ NHAN_VIEN_ID: staff.id, THONG_BAO_ID: { $in: rows.map((r) => r._id) } }).toArray()).map((r: any) => r.THONG_BAO_ID))
    : new Set<string>();
  const items = rows.map((r: any) => ({
    id: r._id, type: r.LOAI, group: r.NHOM, priority: r.MUC_DO, title: r.TIEU_DE, message: r.NOI_DUNG, link: r.DUONG_DAN, queryParams: r.THAM_SO || null,
    createdAt: r.NGAY_TAO, updatedAt: r.NGAY_CAP_NHAT, resolved: Boolean(r.DA_XU_LY), read: reads.has(r._id),
  }));
  const unread = items.filter((i) => !i.read);
  const unreadByGroup = Object.fromEntries(NOTIFICATION_GROUPS.map((g) => [g, unread.filter((i) => i.group === g).length]));
  const onlyUnread = query.unread === 'true';
  const priorityOrder = [NOTIFICATION_PRIORITY.high, NOTIFICATION_PRIORITY.medium, NOTIFICATION_PRIORITY.low] as string[];
  const sorted = (onlyUnread ? unread : items).sort((a, b) => Number(a.read) - Number(b.read) || priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { total: items.length, unread: unread.length, unreadByGroup, groups: NOTIFICATION_GROUPS, items: sorted.slice(0, limit), canMarkRead: Boolean(staff.id) };
};

export const markAdminNotificationsRead = async (staffId: string | null, ids: string[] | 'all', group?: string) => {
  if (!staffId) throw Object.assign(new Error('Thiếu mã nhân viên (x-admin-id) để lưu trạng thái đã đọc.'), { status: 400 });
  const col = await getCollection<any>(NOTI);
  let targetIds: string[];
  if (ids === 'all') {
    targetIds = (await col.find({ DA_XU_LY: { $ne: true }, ...(group ? { NHOM: group } : {}) }).project({ _id: 1 }).toArray()).map((r: any) => r._id);
  } else targetIds = ids;
  const reads = await getCollection<any>(READS);
  const now = new Date();
  if (targetIds.length) {
    await reads.bulkWrite(targetIds.map((id) => ({
      updateOne: { filter: { _id: `${id}:${staffId}` as any }, update: { $setOnInsert: { THONG_BAO_ID: id, NHAN_VIEN_ID: staffId, DA_DOC_LUC: now } }, upsert: true },
    })));
  }
  return { marked: targetIds.length };
};

let timer: NodeJS.Timeout | null = null;
export const startNotificationJobs = () => {
  if (timer) return;
  // Chạy ngay sau khi khởi động để làm nóng cache Dashboard và có sẵn thông báo
  setTimeout(() => { syncAdminNotifications(true).catch((e) => console.error('[notifications] sync lỗi', e)); }, 2000).unref?.();
  timer = setInterval(() => { syncAdminNotifications(false).catch((e) => console.error('[notifications] sync lỗi', e)); }, ANALYTICS_CONFIG.notificationSyncSeconds * 1000);
  timer.unref?.();
};
