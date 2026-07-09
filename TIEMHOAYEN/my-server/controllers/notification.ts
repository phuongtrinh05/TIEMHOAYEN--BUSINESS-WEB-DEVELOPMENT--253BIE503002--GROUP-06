import { Request, Response } from 'express';
import { sql } from '../db.js';

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
  const result = await sql.query(`
    SELECT MAX(TRY_CONVERT(INT, SUBSTRING(THONG_BAO_ID, 3, 20))) AS MAX_NUM
    FROM THONG_BAO
    WHERE THONG_BAO_ID LIKE N'TB%'
  `);

  const maxNumber = Number(result.recordset?.[0]?.MAX_NUM || 0);
  const nextNumber = maxNumber + 1;

  return `TB${nextNumber.toString().padStart(5, '0')}`;
};

const normalizeLimit = (value: unknown): number => {
  const limit = Number(value || 10);

  if (!Number.isFinite(limit)) {
    return 10;
  }

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

export const getNotifications = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.query.customerId || '').trim();
    const limit = normalizeLimit(req.query.limit);

    const request = new sql.Request();
    request.input('LIMIT', sql.Int, limit);

    let query = `
      SELECT TOP (@LIMIT)
        THONG_BAO_ID,
        KHACH_HANG_ID,
        DON_HANG_ID,
        LOAI_THONG_BAO,
        TIEU_DE,
        NOI_DUNG,
        HINH_ANH,
        DUONG_DAN,
        DA_DOC,
        NGAY_TAO
      FROM THONG_BAO
    `;

    if (customerId) {
      request.input('KHACH_HANG_ID', sql.NVarChar(10), customerId);
      query += `
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
           OR KHACH_HANG_ID IS NULL
      `;
    } else {
      query += `
        WHERE KHACH_HANG_ID IS NULL
      `;
    }

    query += `
      ORDER BY NGAY_TAO DESC, THONG_BAO_ID DESC
    `;

    const result = await request.query(query);

    return res.status(200).json({
      total: result.recordset.length,
      notifications: result.recordset.map(mapNotificationRow),
    });
  } catch (error: any) {
    console.error('Lỗi lấy thông báo:', error);
    return res.status(500).json({
      message: 'Không thể lấy thông báo: ' + error.message,
    });
  }
};

export const getPublicNotifications = async (req: Request, res: Response) => {
  try {
    const limit = normalizeLimit(req.query.limit);

    const request = new sql.Request();
    request.input('LIMIT', sql.Int, limit);

    const result = await request.query(`
      SELECT TOP (@LIMIT)
        THONG_BAO_ID,
        KHACH_HANG_ID,
        DON_HANG_ID,
        LOAI_THONG_BAO,
        TIEU_DE,
        NOI_DUNG,
        HINH_ANH,
        DUONG_DAN,
        DA_DOC,
        NGAY_TAO
      FROM THONG_BAO
      WHERE KHACH_HANG_ID IS NULL
      ORDER BY NGAY_TAO DESC, THONG_BAO_ID DESC
    `);

    return res.status(200).json({
      total: result.recordset.length,
      notifications: result.recordset.map(mapNotificationRow),
    });
  } catch (error: any) {
    console.error('Lỗi lấy thông báo công khai:', error);
    return res.status(500).json({
      message: 'Không thể lấy thông báo công khai: ' + error.message,
    });
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

    const request = new sql.Request();
    request.input('THONG_BAO_ID', sql.NVarChar(20), notificationId);
    request.input('KHACH_HANG_ID', sql.NVarChar(10), customerId);
    request.input('DON_HANG_ID', sql.NVarChar(20), orderId);
    request.input('LOAI_THONG_BAO', sql.NVarChar(50), type);
    request.input('TIEU_DE', sql.NVarChar(255), title);
    request.input('NOI_DUNG', sql.NVarChar(500), message);
    request.input('HINH_ANH', sql.NVarChar(500), image);
    request.input('DUONG_DAN', sql.NVarChar(255), link);

    await request.query(`
      INSERT INTO THONG_BAO (
        THONG_BAO_ID,
        KHACH_HANG_ID,
        DON_HANG_ID,
        LOAI_THONG_BAO,
        TIEU_DE,
        NOI_DUNG,
        HINH_ANH,
        DUONG_DAN,
        DA_DOC,
        NGAY_TAO
      )
      VALUES (
        @THONG_BAO_ID,
        @KHACH_HANG_ID,
        @DON_HANG_ID,
        @LOAI_THONG_BAO,
        @TIEU_DE,
        @NOI_DUNG,
        @HINH_ANH,
        @DUONG_DAN,
        0,
        GETDATE()
      )
    `);

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
    return res.status(500).json({
      message: 'Không thể tạo thông báo: ' + error.message,
    });
  }
};

export const markNotificationAsRead = async (req: Request, res: Response) => {
  try {
    const notificationId = String(req.params.id || '').trim();

    if (!notificationId) {
      return res.status(400).json({ message: 'Thiếu mã thông báo.' });
    }

    const request = new sql.Request();
    request.input('THONG_BAO_ID', sql.NVarChar(20), notificationId);

    const result = await request.query(`
      UPDATE THONG_BAO
      SET DA_DOC = 1
      WHERE THONG_BAO_ID = @THONG_BAO_ID
    `);

    if (result.rowsAffected?.[0] === 0) {
      return res.status(404).json({ message: 'Không tìm thấy thông báo.' });
    }

    return res.status(200).json({
      message: 'Đã đánh dấu thông báo là đã đọc.',
      id: notificationId,
    });
  } catch (error: any) {
    console.error('Lỗi cập nhật trạng thái thông báo:', error);
    return res.status(500).json({
      message: 'Không thể cập nhật trạng thái thông báo: ' + error.message,
    });
  }
};

export const markAllNotificationsAsRead = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || req.query.customerId || '').trim();

    if (!customerId) {
      return res.status(400).json({ message: 'Thiếu mã khách hàng.' });
    }

    const request = new sql.Request();
    request.input('KHACH_HANG_ID', sql.NVarChar(10), customerId);

    const result = await request.query(`
      UPDATE THONG_BAO
      SET DA_DOC = 1
      WHERE KHACH_HANG_ID = @KHACH_HANG_ID
    `);

    return res.status(200).json({
      message: 'Đã đánh dấu tất cả thông báo là đã đọc.',
      affectedRows: result.rowsAffected?.[0] || 0,
    });
  } catch (error: any) {
    console.error('Lỗi cập nhật tất cả thông báo:', error);
    return res.status(500).json({
      message: 'Không thể cập nhật tất cả thông báo: ' + error.message,
    });
  }
};

export const createOrderNotification = async (
  customerId: string | null,
  orderId: string,
  title: string,
  message: string,
  type: string = 'order',
  link?: string
): Promise<void> => {
  const notificationId = await createNextNotificationId();

  const request = new sql.Request();
  request.input('THONG_BAO_ID', sql.NVarChar(20), notificationId);
  request.input('KHACH_HANG_ID', sql.NVarChar(10), customerId || null);
  request.input('DON_HANG_ID', sql.NVarChar(20), orderId || null);
  request.input('LOAI_THONG_BAO', sql.NVarChar(50), normalizeType(type));
  request.input('TIEU_DE', sql.NVarChar(255), title);
  request.input('NOI_DUNG', sql.NVarChar(500), message);
  request.input('HINH_ANH', sql.NVarChar(500), null);
  request.input('DUONG_DAN', sql.NVarChar(255), link || `/order-detail/${orderId}`);

  await request.query(`
    INSERT INTO THONG_BAO (
      THONG_BAO_ID,
      KHACH_HANG_ID,
      DON_HANG_ID,
      LOAI_THONG_BAO,
      TIEU_DE,
      NOI_DUNG,
      HINH_ANH,
      DUONG_DAN,
      DA_DOC,
      NGAY_TAO
    )
    VALUES (
      @THONG_BAO_ID,
      @KHACH_HANG_ID,
      @DON_HANG_ID,
      @LOAI_THONG_BAO,
      @TIEU_DE,
      @NOI_DUNG,
      @HINH_ANH,
      @DUONG_DAN,
      0,
      GETDATE()
    )
  `);
};
