import { Request, Response } from 'express';
import { connectDB, sql } from '../db.js';

interface ReviewableOrderRow {
  DON_HANG_ID: string;
  NGAY_TAO: string;
  TONG_TIEN: number;
  TRANG_THAI: string;
  SDT_NGUOI_NHAN?: string;
  SAN_PHAM_ID: string;
  TEN_SAN_PHAM: string;
  SO_LUONG: number;
  GIA: number;
  HINH_ANH: string | null;
  DA_DANH_GIA: number;
}

const normalizePhone = (phone: string) => String(phone || '').replace(/\D/g, '');

const getPublicBaseUrl = (req: Request): string => {
  const configuredUrl = String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');

  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return `${forwardedProtocol || req.protocol}://${req.get('host')}`;
};

const normalizeReviewImageUrl = (value: unknown): string => {
  const url = String(value || '').trim();
  return url.replace(/^http:\/\/(tiem-hoa-yen-api\.onrender\.com)(?=\/)/i, 'https://$1');
};

const isDeliveredStatusSql = `
  (
    (
      dh.TRANG_THAI COLLATE Vietnamese_CI_AI = N'Giao hang thanh cong'
      AND NULLIF(LTRIM(RTRIM(ISNULL(dh.LY_DO_HOAN_TIEN_TRA_HANG, N''))), N'') IS NULL
    )
    OR
    (
      dh.TRANG_THAI COLLATE Vietnamese_CI_AI = N'Hoan thanh'
    )
  )
`;

const mapOrderRows = (rows: ReviewableOrderRow[]) => {
  const orderMap = new Map<string, any>();

  rows.forEach((row) => {
    if (!orderMap.has(row.DON_HANG_ID)) {
      orderMap.set(row.DON_HANG_ID, {
        orderId: row.DON_HANG_ID,
        createdAt: row.NGAY_TAO,
        total: Number(row.TONG_TIEN || 0),
        status: row.TRANG_THAI,
        receiverPhone: row.SDT_NGUOI_NHAN || '',
        items: [],
      });
    }

    orderMap.get(row.DON_HANG_ID).items.push({
      productId: row.SAN_PHAM_ID,
      productName: row.TEN_SAN_PHAM,
      image: row.HINH_ANH || null,
      quantity: Number(row.SO_LUONG || 1),
      price: Number(row.GIA || 0),
      reviewed: Number(row.DA_DANH_GIA || 0) > 0,
    });
  });

  return Array.from(orderMap.values());
};

const mapReviewRows = (rows: any[]) => rows.map((item: any) => ({
  reviewId: item.DANH_GIA_ID,
  orderId: item.DON_HANG_ID,
  productId: item.SAN_PHAM_ID,
  productName: item.TEN_SAN_PHAM || '',
  productImage: item.HINH_ANH || null,
  customerId: item.KHACH_HANG_ID || null,
  customerName: item.KHACH_HANG_ID ? (item.TEN_KHACH_HANG || 'Khách hàng') : 'Khách hàng ẩn danh',
  rating: Number(item.SO_SAO || 0),
  content: item.NOI_DUNG || '',
  createdAt: item.NGAY_DANH_GIA,
  images: item.HINH_ANH_LIST
    ? String(item.HINH_ANH_LIST).split('|').filter(Boolean).map(normalizeReviewImageUrl)
    : [],
  shopReply: item.PHAN_HOI_SHOP || null,
  shopReplyDate: item.NGAY_PHAN_HOI_SHOP || null,
  shopReplyStaffId: item.NHAN_VIEN_PHAN_HOI_ID || null,
}));

const createNextReviewId = async (pool: any): Promise<string> => {
  const result = await pool.request().query(`
    SELECT TOP 1 DANH_GIA_ID
    FROM DANH_GIA
    ORDER BY DANH_GIA_ID DESC
  `);

  if (result.recordset.length === 0) {
    return 'DG0001';
  }

  const lastId = String(result.recordset[0].DANH_GIA_ID || '');
  const lastNumber = Number(lastId.replace(/\D/g, '')) || 0;
  const nextNumber = lastNumber + 1;

  return `DG${String(nextNumber).padStart(4, '0')}`;
};

export const getReviewableOrdersForCustomer = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, customerId)
      .query(`
        SELECT
          dh.DON_HANG_ID,
          dh.NGAY_TAO,
          dh.TONG_TIEN,
          dh.TRANG_THAI,
          dh.SDT_NGUOI_NHAN,
          dct.SAN_PHAM_ID,
          sp.TEN_SAN_PHAM,
          dct.SO_LUONG,
          dct.GIA,
          ha.URL AS HINH_ANH,
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM DANH_GIA dg
              WHERE dg.DON_HANG_ID = dh.DON_HANG_ID
            ) THEN 1
            ELSE 0
          END AS DA_DANH_GIA
        FROM DON_HANG dh
        INNER JOIN DON_HANG_CHI_TIET dct
          ON dh.DON_HANG_ID = dct.DON_HANG_ID
        INNER JOIN SAN_PHAM sp
          ON dct.SAN_PHAM_ID = sp.SAN_PHAM_ID
        OUTER APPLY (
          SELECT TOP 1 URL
          FROM HINH_ANH_SAN_PHAM
          WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
          ORDER BY LA_ANH_CHINH DESC
        ) ha
        WHERE dh.KHACH_HANG_ID = @KHACH_HANG_ID
          AND ${isDeliveredStatusSql}
        ORDER BY dh.NGAY_TAO DESC, dct.SAN_PHAM_ID ASC
      `);

    return res.status(200).json({
      orders: mapOrderRows(result.recordset),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi lấy đơn hàng có thể đánh giá: ' + error.message,
    });
  }
};

export const lookupGuestOrderForReview = async (req: Request, res: Response) => {
  try {
    const { orderId, phone } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!orderId || !normalizedPhone) {
      return res.status(400).json({ message: 'Vui lòng nhập mã đơn hàng và số điện thoại.' });
    }

    const pool = await connectDB();

    const result = await pool.request()
      .input('DON_HANG_ID', sql.NVarChar, String(orderId).trim().toUpperCase())
      .input('PHONE', sql.NVarChar, normalizedPhone)
      .query(`
        SELECT
          dh.DON_HANG_ID,
          dh.NGAY_TAO,
          dh.TONG_TIEN,
          dh.TRANG_THAI,
          dh.SDT_NGUOI_NHAN,
          dct.SAN_PHAM_ID,
          sp.TEN_SAN_PHAM,
          dct.SO_LUONG,
          dct.GIA,
          ha.URL AS HINH_ANH,
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM DANH_GIA dg
              WHERE dg.DON_HANG_ID = dh.DON_HANG_ID
            ) THEN 1
            ELSE 0
          END AS DA_DANH_GIA
        FROM DON_HANG dh
        INNER JOIN DON_HANG_CHI_TIET dct
          ON dh.DON_HANG_ID = dct.DON_HANG_ID
        INNER JOIN SAN_PHAM sp
          ON dct.SAN_PHAM_ID = sp.SAN_PHAM_ID
        OUTER APPLY (
          SELECT TOP 1 URL
          FROM HINH_ANH_SAN_PHAM
          WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
          ORDER BY LA_ANH_CHINH DESC
        ) ha
        WHERE dh.DON_HANG_ID = @DON_HANG_ID
          AND REPLACE(REPLACE(REPLACE(ISNULL(dh.SDT_NGUOI_NHAN, ''), ' ', ''), '.', ''), '-', '') = @PHONE
          AND ${isDeliveredStatusSql}
        ORDER BY dct.SAN_PHAM_ID ASC
      `);

    const orders = mapOrderRows(result.recordset);

    if (orders.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy đơn hàng đã giao thành công khớp với mã đơn và số điện thoại nhận hàng.',
      });
    }

    return res.status(200).json({ order: orders[0] });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi tra cứu đơn hàng: ' + error.message,
    });
  }
};

export const getCustomerReviewHistory = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;

    if (!customerId) {
      return res.status(400).json({ message: 'Thiếu mã khách hàng.' });
    }

    const pool = await connectDB();

    const result = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, customerId)
      .query(`
        SELECT
          dg.DANH_GIA_ID,
          dg.DON_HANG_ID,
          dg.SAN_PHAM_ID,
          sp.TEN_SAN_PHAM,
          ha.URL AS HINH_ANH,
          dg.KHACH_HANG_ID,
          kh.TEN AS TEN_KHACH_HANG,
          dg.SO_SAO,
          dg.NOI_DUNG,
          dg.NGAY_DANH_GIA,
          dg.PHAN_HOI_SHOP,
          dg.NGAY_PHAN_HOI_SHOP,
          dg.NHAN_VIEN_PHAN_HOI_ID,
          images.HINH_ANH_LIST
        FROM DANH_GIA dg
        INNER JOIN DON_HANG dh
          ON dg.DON_HANG_ID = dh.DON_HANG_ID
        INNER JOIN SAN_PHAM sp
          ON dg.SAN_PHAM_ID = sp.SAN_PHAM_ID
        LEFT JOIN KHACH_HANG kh
          ON dg.KHACH_HANG_ID = kh.KHACH_HANG_ID
        OUTER APPLY (
          SELECT TOP 1 URL
          FROM HINH_ANH_SAN_PHAM
          WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
          ORDER BY LA_ANH_CHINH DESC
        ) ha
        OUTER APPLY (
          SELECT STRING_AGG(CAST(dgha.URL AS NVARCHAR(MAX)), N'|') AS HINH_ANH_LIST
          FROM DANH_GIA_HINH_ANH dgha
          WHERE dgha.DANH_GIA_ID = dg.DANH_GIA_ID
        ) images
        WHERE dg.KHACH_HANG_ID = @KHACH_HANG_ID
           OR dh.KHACH_HANG_ID = @KHACH_HANG_ID
        ORDER BY dg.NGAY_DANH_GIA DESC
      `);

    return res.status(200).json({
      reviews: mapReviewRows(result.recordset),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi lấy lịch sử đánh giá của khách hàng: ' + error.message,
    });
  }
};

export const getGuestReviewHistory = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!/^0\d{9}$/.test(normalizedPhone)) {
      return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' });
    }

    const pool = await connectDB();

    const result = await pool.request()
      .input('PHONE', sql.NVarChar, normalizedPhone)
      .query(`
        SELECT
          dg.DANH_GIA_ID,
          dg.DON_HANG_ID,
          dg.SAN_PHAM_ID,
          sp.TEN_SAN_PHAM,
          ha.URL AS HINH_ANH,
          dg.KHACH_HANG_ID,
          kh.TEN AS TEN_KHACH_HANG,
          dg.SO_SAO,
          dg.NOI_DUNG,
          dg.NGAY_DANH_GIA,
          dg.PHAN_HOI_SHOP,
          dg.NGAY_PHAN_HOI_SHOP,
          dg.NHAN_VIEN_PHAN_HOI_ID,
          images.HINH_ANH_LIST
        FROM DANH_GIA dg
        INNER JOIN DON_HANG dh
          ON dg.DON_HANG_ID = dh.DON_HANG_ID
        INNER JOIN SAN_PHAM sp
          ON dg.SAN_PHAM_ID = sp.SAN_PHAM_ID
        LEFT JOIN KHACH_HANG kh
          ON dg.KHACH_HANG_ID = kh.KHACH_HANG_ID
        OUTER APPLY (
          SELECT TOP 1 URL
          FROM HINH_ANH_SAN_PHAM
          WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
          ORDER BY LA_ANH_CHINH DESC
        ) ha
        OUTER APPLY (
          SELECT STRING_AGG(CAST(dgha.URL AS NVARCHAR(MAX)), N'|') AS HINH_ANH_LIST
          FROM DANH_GIA_HINH_ANH dgha
          WHERE dgha.DANH_GIA_ID = dg.DANH_GIA_ID
        ) images
        WHERE REPLACE(REPLACE(REPLACE(ISNULL(dh.SDT_NGUOI_NHAN, ''), ' ', ''), '.', ''), '-', '') = @PHONE
        ORDER BY dg.NGAY_DANH_GIA DESC
      `);

    return res.status(200).json({
      reviews: mapReviewRows(result.recordset),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi lấy lịch sử đánh giá khách vãng lai: ' + error.message,
    });
  }
};

export const createReview = async (req: Request, res: Response) => {
  try {
    const {
      orderId,
      productId,
      actorCustomerId,
      phone,
      hideReviewer,
      rating,
      content,
    } = req.body;

    const safeRating = Number(rating || 0);
    const shouldHideReviewer = String(hideReviewer || '').toLowerCase() === 'true';

    if (!orderId || !productId) {
      return res.status(400).json({ message: 'Thiếu đơn hàng hoặc sản phẩm cần đánh giá.' });
    }

    if (safeRating < 1 || safeRating > 5) {
      return res.status(400).json({ message: 'Số sao đánh giá phải từ 1 đến 5.' });
    }

    if (!String(content || '').trim()) {
      return res.status(400).json({ message: 'Vui lòng nhập nội dung đánh giá.' });
    }

    const pool = await connectDB();

    const orderProductResult = await pool.request()
      .input('DON_HANG_ID', sql.NVarChar, String(orderId).trim().toUpperCase())
      .input('SAN_PHAM_ID', sql.NVarChar, String(productId).trim())
      .query(`
        SELECT TOP 1
          dh.DON_HANG_ID,
          dh.KHACH_HANG_ID,
          dh.SDT_NGUOI_NHAN,
          dh.TRANG_THAI,
          dct.SAN_PHAM_ID
        FROM DON_HANG dh
        INNER JOIN DON_HANG_CHI_TIET dct
          ON dh.DON_HANG_ID = dct.DON_HANG_ID
        WHERE dh.DON_HANG_ID = @DON_HANG_ID
          AND dct.SAN_PHAM_ID = @SAN_PHAM_ID
          AND ${isDeliveredStatusSql}
      `);

    if (orderProductResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Đơn hàng hoặc sản phẩm không hợp lệ, hoặc đơn chưa giao thành công.',
      });
    }

    const order = orderProductResult.recordset[0];
    const actorId = actorCustomerId ? String(actorCustomerId).trim() : '';

    if (actorId) {
      if (String(order.KHACH_HANG_ID || '') !== actorId) {
        return res.status(403).json({ message: 'Bạn không có quyền đánh giá đơn hàng này.' });
      }
    } else {
      const normalizedInputPhone = normalizePhone(phone);
      const normalizedOrderPhone = normalizePhone(order.SDT_NGUOI_NHAN || '');

      if (!normalizedInputPhone || normalizedInputPhone !== normalizedOrderPhone) {
        return res.status(403).json({ message: 'Số điện thoại nhận hàng không khớp.' });
      }
    }

    const duplicateResult = await pool.request()
      .input('DON_HANG_ID', sql.NVarChar, String(orderId).trim().toUpperCase())
      .input('SAN_PHAM_ID', sql.NVarChar, String(productId).trim())
      .query(`
        SELECT TOP 1 DANH_GIA_ID
        FROM DANH_GIA
        WHERE DON_HANG_ID = @DON_HANG_ID
      `);

    if (duplicateResult.recordset.length > 0) {
      return res.status(409).json({ message: 'Đơn hàng này đã được đánh giá rồi.' });
    }

    const reviewId = await createNextReviewId(pool);
    const customerIdToStore = shouldHideReviewer ? null : (actorId || null);

    await pool.request()
      .input('DANH_GIA_ID', sql.NVarChar, reviewId)
      .input('SAN_PHAM_ID', sql.NVarChar, String(productId).trim())
      .input('KHACH_HANG_ID', sql.NVarChar, customerIdToStore)
      .input('DON_HANG_ID', sql.NVarChar, String(orderId).trim().toUpperCase())
      .input('SO_SAO', sql.Int, safeRating)
      .input('NOI_DUNG', sql.NVarChar(sql.MAX), String(content).trim())
      .query(`
        INSERT INTO DANH_GIA
        (
          DANH_GIA_ID,
          SAN_PHAM_ID,
          KHACH_HANG_ID,
          DON_HANG_ID,
          SO_SAO,
          NOI_DUNG,
          NGAY_DANH_GIA
        )
        VALUES
        (
          @DANH_GIA_ID,
          @SAN_PHAM_ID,
          @KHACH_HANG_ID,
          @DON_HANG_ID,
          @SO_SAO,
          @NOI_DUNG,
          GETDATE()
        )
      `);

    const files = (Array.isArray(req.files) ? req.files : []) as any[];
    const imageUrls: string[] = [];

    for (const file of files) {
      const imageUrl = `${getPublicBaseUrl(req)}/uploads/reviews/${file.filename}`;

      await pool.request()
        .input('DANH_GIA_ID', sql.NVarChar, reviewId)
        .input('URL', sql.NVarChar, imageUrl)
        .query(`
          INSERT INTO DANH_GIA_HINH_ANH
          (
            DANH_GIA_ID,
            URL
          )
          VALUES
          (
            @DANH_GIA_ID,
            @URL
          )
        `);

      imageUrls.push(imageUrl);
    }

    await pool.request()
      .input('DON_HANG_ID', sql.NVarChar, String(orderId).trim().toUpperCase())
      .query(`
        UPDATE DON_HANG
        SET TRANG_THAI = N'Hoàn thành'
        WHERE DON_HANG_ID = @DON_HANG_ID
          AND (
            TRANG_THAI COLLATE Vietnamese_CI_AI = N'Giao hang thanh cong'
            OR TRANG_THAI COLLATE Vietnamese_CI_AI = N'Hoan thanh'
          )
          AND NULLIF(LTRIM(RTRIM(ISNULL(LY_DO_HOAN_TIEN_TRA_HANG, N''))), N'') IS NULL
      `);

    return res.status(201).json({
      message: 'Đã lưu đánh giá.',
      reviewId,
      imageUrls,
      orderStatus: 'Hoàn thành',
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi lưu đánh giá: ' + error.message,
    });
  }
};

export const getProductReviews = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('SAN_PHAM_ID', sql.NVarChar, productId)
      .query(`
        SELECT
          dg.DANH_GIA_ID,
          dg.DON_HANG_ID,
          dg.SAN_PHAM_ID,
          dg.KHACH_HANG_ID,
          kh.TEN AS TEN_KHACH_HANG,
          dg.SO_SAO,
          dg.NOI_DUNG,
          dg.NGAY_DANH_GIA,
          dg.PHAN_HOI_SHOP,
          dg.NGAY_PHAN_HOI_SHOP,
          dg.NHAN_VIEN_PHAN_HOI_ID,
          images.HINH_ANH_LIST
        FROM DANH_GIA dg
        LEFT JOIN KHACH_HANG kh
          ON dg.KHACH_HANG_ID = kh.KHACH_HANG_ID
        OUTER APPLY (
          SELECT STRING_AGG(CAST(dgha.URL AS NVARCHAR(MAX)), N'|') AS HINH_ANH_LIST
          FROM DANH_GIA_HINH_ANH dgha
          WHERE dgha.DANH_GIA_ID = dg.DANH_GIA_ID
        ) images
        WHERE dg.SAN_PHAM_ID = @SAN_PHAM_ID
        ORDER BY dg.NGAY_DANH_GIA DESC
      `);

    return res.status(200).json({
      reviews: result.recordset.map((item: any) => ({
        reviewId: item.DANH_GIA_ID,
        orderId: item.DON_HANG_ID,
        productId: item.SAN_PHAM_ID,
        customerId: item.KHACH_HANG_ID || null,
        customerName: item.KHACH_HANG_ID ? (item.TEN_KHACH_HANG || 'Khách hàng') : 'Khách hàng ẩn danh',
        rating: Number(item.SO_SAO || 0),
        content: item.NOI_DUNG || '',
        createdAt: item.NGAY_DANH_GIA,
        images: item.HINH_ANH_LIST
          ? String(item.HINH_ANH_LIST).split('|').filter(Boolean).map(normalizeReviewImageUrl)
          : [],
        shopReply: item.PHAN_HOI_SHOP || null,
        shopReplyDate: item.NGAY_PHAN_HOI_SHOP || null,
        shopReplyStaffId: item.NHAN_VIEN_PHAN_HOI_ID || null,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi lấy đánh giá sản phẩm: ' + error.message,
    });
  }
};


export const replyToReview = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const { reply, staffId } = req.body;
    const safeReply = String(reply || '').trim();

    if (!reviewId) {
      return res.status(400).json({ message: 'Thiếu mã đánh giá.' });
    }

    if (!safeReply) {
      return res.status(400).json({ message: 'Vui lòng nhập nội dung phản hồi của shop.' });
    }

    const pool = await connectDB();

    const result = await pool.request()
      .input('DANH_GIA_ID', sql.NVarChar, String(reviewId).trim())
      .input('PHAN_HOI_SHOP', sql.NVarChar(sql.MAX), safeReply)
      .input('NHAN_VIEN_PHAN_HOI_ID', sql.NVarChar, staffId ? String(staffId).trim() : null)
      .query(`
        UPDATE DANH_GIA
        SET
          PHAN_HOI_SHOP = @PHAN_HOI_SHOP,
          NGAY_PHAN_HOI_SHOP = GETDATE(),
          NHAN_VIEN_PHAN_HOI_ID = @NHAN_VIEN_PHAN_HOI_ID
        WHERE DANH_GIA_ID = @DANH_GIA_ID;

        SELECT
          DANH_GIA_ID,
          PHAN_HOI_SHOP,
          NGAY_PHAN_HOI_SHOP,
          NHAN_VIEN_PHAN_HOI_ID
        FROM DANH_GIA
        WHERE DANH_GIA_ID = @DANH_GIA_ID;
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đánh giá cần phản hồi.' });
    }

    return res.status(200).json({
      message: 'Đã lưu phản hồi của shop.',
      review: {
        reviewId: result.recordset[0].DANH_GIA_ID,
        shopReply: result.recordset[0].PHAN_HOI_SHOP,
        shopReplyDate: result.recordset[0].NGAY_PHAN_HOI_SHOP,
        shopReplyStaffId: result.recordset[0].NHAN_VIEN_PHAN_HOI_ID || null,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi lưu phản hồi đánh giá: ' + error.message,
    });
  }
};
