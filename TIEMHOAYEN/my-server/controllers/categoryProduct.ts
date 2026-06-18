import { Request, Response } from 'express';
import { sql } from '../db.js';

export const getProductsByTopic = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const topicResult = await sql.query`
      SELECT CHU_DE_ID, TEN_CHU_DE
      FROM CHU_DE
      WHERE CHU_DE_ID = ${id}
    `;

    if (topicResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy chủ đề'
      });
    }

    const productResult = await sql.query`
      SELECT 
        sp.SAN_PHAM_ID,
        sp.CHU_DE_ID,
        cd.TEN_CHU_DE,
        sp.TEN_SAN_PHAM,
        sp.MO_TA,
        sp.GIA,
        sp.GIA_KHUYEN_MAI,
        sp.TRANG_THAI,
        sp.KIEU_DANG,
        sp.SO_LUONG,
        sp.DA_BAN,
        ha.URL AS HINH_ANH
      FROM SAN_PHAM sp
      LEFT JOIN CHU_DE cd 
        ON sp.CHU_DE_ID = cd.CHU_DE_ID
      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC
      ) ha
      WHERE sp.CHU_DE_ID = ${id}
    `;

    res.status(200).json({
      topic: topicResult.recordset[0],
      products: productResult.recordset
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Lỗi Controller: ' + error.message
    });
  }
};