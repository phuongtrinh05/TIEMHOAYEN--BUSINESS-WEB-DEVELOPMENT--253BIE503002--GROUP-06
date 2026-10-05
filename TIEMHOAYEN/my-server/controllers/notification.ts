import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';

interface NotificationPayload {
  customerId?: string | null;
  orderId?: string | null;
  type?: string;
  title?: string;
  message?: string;
  image?: string | null;
  link?: string | null;
}

const createNextNotificationId = async (): Promise<string> => {
  return getNextPrefixedId('THONG_BAO', 'THONG_BAO_ID', 'TB', 5);
};

const normalizeLimit = (value: unknown): number => {
  const limit = Number(value || 10);
  if (!Number.isFinite(limit)) return 10;
  return Math.min(50, Math.max(1, Math.floor(limit)));
};

const normalizeType = (type: unknown): string => {
  const value = String(type || 'system').trim().toLowerCase();

  if (value.includes('promotion') || value.includes('khuyen') || value.includes('khuyến') || value.includes('voucher')) {
    return 'promotion';
  }

  if (value.includes('point') || value.includes('diem') || value.includes('điểm') || value.includes('reward')) {
    return 'point';
  }

  if (value.includes('review') || value.includes('danh gia') || value.includes('đánh giá')) {
    return 'review';
  }

  if (value.includes('order') || value.includes('don') || value.includes('đơn') || value.includes('giao') || value.includes('thanh toán')) {
    return 'order';
  }

  return 'system';
};

const mapNotificationRow = (row: any) => ({
  id: row.THONG_BAO_ID,
  THONG_BAO_ID: row.THONG_BAO_ID,
  KHACH_HANG_ID: row.KHACH_HANG_ID,
  DON_HANG_ID: row.DON_HANG_ID,
  LOAI_THONG_BAO: row.LOAI_THONG_BAO,
  TIEU_DE: row.TIEU_DE,
  NOI_DUNG: row.NOI_DUNG,
  HINH_ANH: row.HINH_ANH,
  DUONG_DAN: row.DUONG_DAN,
  DA_DOC: Boolean(row.DA_DOC),
  NGAY_TAO: row.NGAY_TAO,

  type: row.LOAI_THONG_BAO,
  title: row.TIEU_DE,
  message: row.NOI_DUNG,
  image: row.HINH_ANH,
  link: row.DUONG_DAN,
  isRead: Boolean(row.DA_DOC),
  createdAt: row.NGAY_TAO,
  orderCode: row.DON_HANG_ID,
});

const getNotificationCollection = () => getCollection<any>('THONG_BAO');

const sortNotifications = (left: any, right: any): number => {
  const leftDate = left.NGAY_TAO ? new Date(left.NGAY_TAO).getTime() : 0;
  const rightDate = right.NGAY_TAO ? new Date(right.NGAY_TAO).getTime() : 0;
  if (leftDate !== rightDate) return rightDate - leftDate;
  return String(right.THONG_BAO_ID || '').localeCompare(String(left.THONG_BAO_ID || ''), 'vi');
};

export const getNotifications = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.query.customerId || '').trim();
    const limit = normalizeLimit(req.query.limit);
    const collection = await getNotificationCollection();
    const query = customerId
      ? { $or: [{ KHACH_HANG_ID: customerId }, { KHACH_HANG_ID: null }, { KHACH_HANG_ID: { $exists: false } }] }
      : { $or: [{ KHACH_HANG_ID: null }, { KHACH_HANG_ID: { $exists: false } }] };
    const notifications = (await collection.find(query).toArray()).sort(sortNotifications).slice(0, limit);

    return res.status(200).json({
      total: notifications.length,
      notifications: notifications.map(mapNotificationRow),
    });
  } catch (error: any) {
    console.error('Lỗi lấy thông báo:', error);
    return res.status(500).json({ message: 'Không thể lấy thông báo: ' + error.message });
  }
};

export const getPublicNotifications = async (req: Request, res: Response) => {
  try {
    const limit = normalizeLimit(req.query.limit);
    const collection = await getNotificationCollection();
    const notifications = (await collection.find({
      $or: [{ KHACH_HANG_ID: null }, { KHACH_HANG_ID: { $exists: false } }],
    }).toArray()).sort(sortNotifications).slice(0, limit);

    return res.status(200).json({
      total: notifications.length,
      notifications: notifications.map(mapNotificationRow),
    });
  } catch (error: any) {
    console.error('Lỗi lấy thông báo công khai:', error);
    return res.status(500).json({ message: 'Không thể lấy thông báo công khai: ' + error.message });
  }
};

export const createNotification = async (req: Request, res: Response) => {
  try {
    const body: NotificationPayload = req.body || {};
    const notificationId = await createNextNotificationId();
    const customerId = body.customerId ? String(body.customerId).trim() : null;
    const orderId = body.orderId ? String(body.orderId).trim() : null;
    const type = normalizeType(body.type);
    const title = String(body.title || '').trim();
    const message = String(body.message || '').trim();
    const image = body.image ? String(body.image).trim() : null;
    const link = body.link
      ? String(body.link).trim()
      : orderId
        ? `/order-detail/${orderId}`
        : null;

    if (!title) {
      return res.status(400).json({ message: 'Thiếu tiêu đề thông báo.' });
    }

    if (!message) {
      return res.status(400).json({ message: 'Thiếu nội dung thông báo.' });
    }

    const collection = await getNotificationCollection();
    await collection.insertOne({
      _id: notificationId,
      THONG_BAO_ID: notificationId,
      KHACH_HANG_ID: customerId,
      DON_HANG_ID: orderId,
      LOAI_THONG_BAO: type,
      TIEU_DE: title,
      NOI_DUNG: message,
      HINH_ANH: image,
      DUONG_DAN: link,
      DA_DOC: false,
      NGAY_TAO: new Date(),
    });

    return res.status(201).json({
      message: 'Tạo thông báo thành công.',
      notification: {
        id: notificationId,
        type,
        title,
        message,
        image,
        link,
        isRead: false,
      },
    });
  } catch (error: any) {
    console.error('Lỗi tạo thông báo:', error);
    return res.status(500).json({ message: 'Không thể tạo thông báo: ' + error.message });
  }
};

export const markNotificationAsRead = async (req: Request, res: Response) => {
  try {
    const notificationId = String(req.params.id || '').trim();

    if (!notificationId) {
      return res.status(400).json({ message: 'Thiếu mã thông báo.' });
    }

    const collection = await getNotificationCollection();
    const result = await collection.updateOne(
      { THONG_BAO_ID: notificationId },
      { $set: { DA_DOC: true } },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Không tìm thấy thông báo.' });
    }

    return res.status(200).json({
      message: 'Đã đánh dấu thông báo là đã đọc.',
      id: notificationId,
    });
  } catch (error: any) {
    console.error('Lỗi cập nhật trạng thái thông báo:', error);
    return res.status(500).json({ message: 'Không thể cập nhật trạng thái thông báo: ' + error.message });
  }
};

export const markAllNotificationsAsRead = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || req.query.customerId || '').trim();

    if (!customerId) {
      return res.status(400).json({ message: 'Thiếu mã khách hàng.' });
    }

    const collection = await getNotificationCollection();
    const result = await collection.updateMany(
      { KHACH_HANG_ID: customerId },
      { $set: { DA_DOC: true } },
    );

    return res.status(200).json({
      message: 'Đã đánh dấu tất cả thông báo là đã đọc.',
      affectedRows: result.modifiedCount,
    });
  } catch (error: any) {
    console.error('Lỗi cập nhật tất cả thông báo:', error);
    return res.status(500).json({ message: 'Không thể cập nhật tất cả thông báo: ' + error.message });
  }
};

export const createOrderNotification = async (
  customerId: string | null,
  orderId: string,
  title: string,
  message: string,
  type: string = 'order',
  link?: string,
): Promise<void> => {
  const notificationId = await createNextNotificationId();
  const collection = await getNotificationCollection();

  await collection.insertOne({
    _id: notificationId,
    THONG_BAO_ID: notificationId,
    KHACH_HANG_ID: customerId || null,
    DON_HANG_ID: orderId || null,
    LOAI_THONG_BAO: normalizeType(type),
    TIEU_DE: title,
    NOI_DUNG: message,
    HINH_ANH: null,
    DUONG_DAN: link || `/order-detail/${orderId}`,
    DA_DOC: false,
    NGAY_TAO: new Date(),
  });
};
