import { Request, Response } from 'express';
import { connectDB, sql } from '../db.js';
import axios from 'axios';

const N8N_WEBHOOK_URL = 'https://thuongthu.app.n8n.cloud/webhook/2bb78087-b702-4dc2-91d4-12b65ef2dc79';

// ================================================================
// sendChat — POST /api/chat
// Nhận từ Angular: chatInput, customerId, productId, orderId
// 1. Query SQL lấy context
// 2. Gọi n8n kèm toàn bộ context
// 3. Trả kết quả về Angular
// ================================================================
export const sendChat = async (req: Request, res: Response) => {
  try {
    const { chatInput, customerId, productId, orderId } = req.body;

    if (!chatInput || !chatInput.trim()) {
      return res.status(400).json({ message: 'Thiếu nội dung tin nhắn.' });
    }

    const pool = await connectDB();

    // ----------------------------------------------------------------
    // 1. Lấy thông tin khách hàng (nếu đã đăng nhập)
    // ----------------------------------------------------------------
    let customerInfo = null;


    // ----------------------------------------------------------------
    // 3. Lấy chi tiết đơn hàng gần nhất (hoặc đơn đang xem)
    //    orderId từ URL nếu khách đang ở /order-detail/:id
    //    Fallback: lấy đơn đầu tiên trong orderList
    // ----------------------------------------------------------------
    let orderInfo = null;
    let targetOrderId = orderId;
    if (!targetOrderId && customerId) {

      const newestOrder = await pool.request()
        .input("KHACH_HANG_ID", sql.NVarChar, customerId)
        .query(`
            SELECT TOP 1 DON_HANG_ID
            FROM DON_HANG
            WHERE KHACH_HANG_ID = @KHACH_HANG_ID
            ORDER BY NGAY_TAO DESC
        `);

      targetOrderId = newestOrder.recordset[0]?.DON_HANG_ID ?? null;
    }
    if (targetOrderId) {

      const detailResult = await pool.request()
        .input("DON_HANG_ID", sql.NVarChar, targetOrderId)
        .query(`
                SELECT
                dh.DON_HANG_ID,
                dh.TRANG_THAI,
                dh.NGAY_TAO,
                dh.TONG_TIEN,
                ct.SAN_PHAM_ID

            FROM DON_HANG dh

            JOIN DON_HANG_CHI_TIET ct
                ON dh.DON_HANG_ID = ct.DON_HANG_ID

            JOIN SAN_PHAM sp
                ON sp.SAN_PHAM_ID = ct.SAN_PHAM_ID

            WHERE dh.DON_HANG_ID = @DON_HANG_ID
        `);

      if (detailResult.recordset.length > 0) {

        orderInfo = {

          order: {

            DON_HANG_ID: detailResult.recordset[0].DON_HANG_ID,

            TRANG_THAI: detailResult.recordset[0].TRANG_THAI,

            NGAY_TAO: detailResult.recordset[0].NGAY_TAO,

            TONG_TIEN: detailResult.recordset[0].TONG_TIEN
          },

          items: detailResult.recordset

        };

      }

    }

    // ----------------------------------------------------------------
    // 4. Lấy thông tin sản phẩm (nếu đang ở /product-detail/:id)
    // ----------------------------------------------------------------
    let productInfo = null;
    if (productId) {
      const productResult = await pool.request()
        .input('SAN_PHAM_ID', sql.NVarChar, productId)
        .query(`
          SELECT TOP 1
            SAN_PHAM_ID,
            TEN_SAN_PHAM,
            GIA,
            GIA_KHUYEN_MAI,
            MO_TA
        FROM SAN_PHAM
        WHERE SAN_PHAM_ID=@SAN_PHAM_ID
        `);
      productInfo = productResult.recordset[0] ?? null;
    }

    // ----------------------------------------------------------------
    // 5. Gọi n8n kèm toàn bộ context đã query
    // ----------------------------------------------------------------
    const n8nPayload = {

      chatInput,
      customerId,
      productId,
      orderId,
      customerInfo,
      productInfo,
      orderInfo

    };

    console.log('[CHAT] Gọi n8n với payload:', JSON.stringify(n8nPayload, null, 2));
    console.log("===== PAYLOAD =====");
    console.log(JSON.stringify(n8nPayload, null, 2));
    const n8nRes = await axios.post(N8N_WEBHOOK_URL, n8nPayload, {
      // AI/image workflows can take longer than 30 seconds to finish.
      timeout: 120000
    });

    return res.status(200).json(n8nRes.data);

  } 
  catch (error: any) {

  console.error("========== CHAT ERROR ==========");

  console.error(error);

  console.error("MESSAGE:");
  console.error(error.message);

  console.error("RESPONSE:");
  console.error(error.response?.data);

  console.error("===============================");

  return res.status(500).json({
    output: 'Xin lỗi, hệ thống đang gặp sự cố. Bạn thử lại nhé! 🌸'
  });
}
};
