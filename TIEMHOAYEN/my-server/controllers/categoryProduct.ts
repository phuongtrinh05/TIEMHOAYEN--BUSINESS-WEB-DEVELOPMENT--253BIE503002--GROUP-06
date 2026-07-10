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
        ha.URL AS HINH_ANH,
        hoa.TEN_HOA_TUOI_LIST,
        dt.TEN_DOI_TUONG_LIST,
        ms.TEN_MAU_SAC_LIST
      FROM SAN_PHAM sp
      LEFT JOIN CHU_DE cd 
        ON sp.CHU_DE_ID = cd.CHU_DE_ID

      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC
      ) ha

      OUTER APPLY (
        SELECT STRING_AGG(f.TEN_HOA_TUOI, N'|') AS TEN_HOA_TUOI_LIST
        FROM (
          SELECT DISTINCT ht.TEN_HOA_TUOI
          FROM HOA_TUOI_SAN_PHAM htsp
          INNER JOIN HOA_TUOI ht
            ON htsp.HOA_TUOI_ID = ht.HOA_TUOI_ID
          WHERE htsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) f
      ) hoa

      OUTER APPLY (
        SELECT STRING_AGG(d.TEN_DOI_TUONG, N'|') AS TEN_DOI_TUONG_LIST
        FROM (
          SELECT DISTINCT dt2.TEN_DOI_TUONG
          FROM DOI_TUONG_SAN_PHAM dtsp
          INNER JOIN DOI_TUONG dt2
            ON dtsp.DOI_TUONG_ID = dt2.DOI_TUONG_ID
          WHERE dtsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) d
      ) dt

      OUTER APPLY (
        SELECT STRING_AGG(m.TEN_MAU_SAC, N'|') AS TEN_MAU_SAC_LIST
        FROM (
          SELECT DISTINCT ms2.TEN_MAU_SAC
          FROM MAU_SAC_SAN_PHAM mssp
          INNER JOIN MAU_SAC ms2
            ON mssp.MAU_SAC_ID = ms2.MAU_SAC_ID
          WHERE mssp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) m
      ) ms

      WHERE sp.CHU_DE_ID = ${id}
    `;

    res.status(200).json({
      topic: topicResult.recordset[0],
      total: productResult.recordset.length,
      products: productResult.recordset
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Lỗi Controller: ' + error.message
    });
  }
};

export const getProductsByFlower = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const flowerResult = await sql.query`
      SELECT HOA_TUOI_ID, TEN_HOA_TUOI
      FROM HOA_TUOI
      WHERE HOA_TUOI_ID = ${id}
    `;

    if (flowerResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy hoa tươi'
      });
    }

    const productResult = await sql.query`
      SELECT 
        sp.SAN_PHAM_ID,
        sp.CHU_DE_ID,
        cd.TEN_CHU_DE,
        ht.HOA_TUOI_ID,
        ht.TEN_HOA_TUOI,
        sp.TEN_SAN_PHAM,
        sp.MO_TA,
        sp.GIA,
        sp.GIA_KHUYEN_MAI,
        sp.TRANG_THAI,
        sp.KIEU_DANG,
        sp.SO_LUONG,
        sp.DA_BAN,
        ha.URL AS HINH_ANH,
        hoa.TEN_HOA_TUOI_LIST,
        dt.TEN_DOI_TUONG_LIST,
        ms.TEN_MAU_SAC_LIST
      FROM HOA_TUOI_SAN_PHAM htspMain
      INNER JOIN HOA_TUOI ht 
        ON htspMain.HOA_TUOI_ID = ht.HOA_TUOI_ID
      INNER JOIN SAN_PHAM sp 
        ON htspMain.SAN_PHAM_ID = sp.SAN_PHAM_ID
      LEFT JOIN CHU_DE cd 
        ON sp.CHU_DE_ID = cd.CHU_DE_ID

      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC
      ) ha

      OUTER APPLY (
        SELECT STRING_AGG(f.TEN_HOA_TUOI, N'|') AS TEN_HOA_TUOI_LIST
        FROM (
          SELECT DISTINCT ht2.TEN_HOA_TUOI
          FROM HOA_TUOI_SAN_PHAM htsp2
          INNER JOIN HOA_TUOI ht2
            ON htsp2.HOA_TUOI_ID = ht2.HOA_TUOI_ID
          WHERE htsp2.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) f
      ) hoa

      OUTER APPLY (
        SELECT STRING_AGG(d.TEN_DOI_TUONG, N'|') AS TEN_DOI_TUONG_LIST
        FROM (
          SELECT DISTINCT dt2.TEN_DOI_TUONG
          FROM DOI_TUONG_SAN_PHAM dtsp
          INNER JOIN DOI_TUONG dt2
            ON dtsp.DOI_TUONG_ID = dt2.DOI_TUONG_ID
          WHERE dtsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) d
      ) dt

      OUTER APPLY (
        SELECT STRING_AGG(m.TEN_MAU_SAC, N'|') AS TEN_MAU_SAC_LIST
        FROM (
          SELECT DISTINCT ms2.TEN_MAU_SAC
          FROM MAU_SAC_SAN_PHAM mssp
          INNER JOIN MAU_SAC ms2
            ON mssp.MAU_SAC_ID = ms2.MAU_SAC_ID
          WHERE mssp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) m
      ) ms

      WHERE ht.HOA_TUOI_ID = ${id}
    `;

    res.status(200).json({
      flower: flowerResult.recordset[0],
      total: productResult.recordset.length,
      products: productResult.recordset
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Lỗi Controller: ' + error.message
    });
  }
};

export const getProductsByStyle = async (req: Request, res: Response) => {
  try {
    const { style } = req.params;
    const decodedStyle = decodeURIComponent(style);

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
        ha.URL AS HINH_ANH,
        hoa.TEN_HOA_TUOI_LIST,
        dt.TEN_DOI_TUONG_LIST,
        ms.TEN_MAU_SAC_LIST
      FROM SAN_PHAM sp
      LEFT JOIN CHU_DE cd 
        ON sp.CHU_DE_ID = cd.CHU_DE_ID

      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC
      ) ha

      OUTER APPLY (
        SELECT STRING_AGG(f.TEN_HOA_TUOI, N'|') AS TEN_HOA_TUOI_LIST
        FROM (
          SELECT DISTINCT ht.TEN_HOA_TUOI
          FROM HOA_TUOI_SAN_PHAM htsp
          INNER JOIN HOA_TUOI ht
            ON htsp.HOA_TUOI_ID = ht.HOA_TUOI_ID
          WHERE htsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) f
      ) hoa

      OUTER APPLY (
        SELECT STRING_AGG(d.TEN_DOI_TUONG, N'|') AS TEN_DOI_TUONG_LIST
        FROM (
          SELECT DISTINCT dt2.TEN_DOI_TUONG
          FROM DOI_TUONG_SAN_PHAM dtsp
          INNER JOIN DOI_TUONG dt2
            ON dtsp.DOI_TUONG_ID = dt2.DOI_TUONG_ID
          WHERE dtsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) d
      ) dt

      OUTER APPLY (
        SELECT STRING_AGG(m.TEN_MAU_SAC, N'|') AS TEN_MAU_SAC_LIST
        FROM (
          SELECT DISTINCT ms2.TEN_MAU_SAC
          FROM MAU_SAC_SAN_PHAM mssp
          INNER JOIN MAU_SAC ms2
            ON mssp.MAU_SAC_ID = ms2.MAU_SAC_ID
          WHERE mssp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) m
      ) ms

      WHERE LOWER(LTRIM(RTRIM(sp.KIEU_DANG))) = LOWER(LTRIM(RTRIM(${decodedStyle})))
    `;

    res.status(200).json({
      style: {
        KIEU_DANG: decodedStyle
      },
      total: productResult.recordset.length,
      products: productResult.recordset
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Lỗi Controller: ' + error.message
    });
  }
};

export const getProductsByTarget = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const targetResult = await sql.query`
      SELECT DOI_TUONG_ID, TEN_DOI_TUONG
      FROM DOI_TUONG
      WHERE DOI_TUONG_ID = ${id}
    `;

    if (targetResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy đối tượng'
      });
    }

    const productResult = await sql.query`
      SELECT 
        sp.SAN_PHAM_ID,
        sp.CHU_DE_ID,
        cd.TEN_CHU_DE,
        dtMain.DOI_TUONG_ID,
        dtMain.TEN_DOI_TUONG,
        sp.TEN_SAN_PHAM,
        sp.MO_TA,
        sp.GIA,
        sp.GIA_KHUYEN_MAI,
        sp.TRANG_THAI,
        sp.KIEU_DANG,
        sp.SO_LUONG,
        sp.DA_BAN,
        ha.URL AS HINH_ANH,
        hoa.TEN_HOA_TUOI_LIST,
        dt.TEN_DOI_TUONG_LIST,
        ms.TEN_MAU_SAC_LIST
      FROM DOI_TUONG_SAN_PHAM dtspMain
      INNER JOIN DOI_TUONG dtMain
        ON dtspMain.DOI_TUONG_ID = dtMain.DOI_TUONG_ID
      INNER JOIN SAN_PHAM sp
        ON dtspMain.SAN_PHAM_ID = sp.SAN_PHAM_ID
      LEFT JOIN CHU_DE cd 
        ON sp.CHU_DE_ID = cd.CHU_DE_ID

      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC
      ) ha

      OUTER APPLY (
        SELECT STRING_AGG(f.TEN_HOA_TUOI, N'|') AS TEN_HOA_TUOI_LIST
        FROM (
          SELECT DISTINCT ht.TEN_HOA_TUOI
          FROM HOA_TUOI_SAN_PHAM htsp
          INNER JOIN HOA_TUOI ht
            ON htsp.HOA_TUOI_ID = ht.HOA_TUOI_ID
          WHERE htsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) f
      ) hoa

      OUTER APPLY (
        SELECT STRING_AGG(d.TEN_DOI_TUONG, N'|') AS TEN_DOI_TUONG_LIST
        FROM (
          SELECT DISTINCT dt2.TEN_DOI_TUONG
          FROM DOI_TUONG_SAN_PHAM dtsp2
          INNER JOIN DOI_TUONG dt2
            ON dtsp2.DOI_TUONG_ID = dt2.DOI_TUONG_ID
          WHERE dtsp2.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) d
      ) dt

      OUTER APPLY (
        SELECT STRING_AGG(m.TEN_MAU_SAC, N'|') AS TEN_MAU_SAC_LIST
        FROM (
          SELECT DISTINCT ms2.TEN_MAU_SAC
          FROM MAU_SAC_SAN_PHAM mssp
          INNER JOIN MAU_SAC ms2
            ON mssp.MAU_SAC_ID = ms2.MAU_SAC_ID
          WHERE mssp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) m
      ) ms

      WHERE dtMain.DOI_TUONG_ID = ${id}
    `;

    res.status(200).json({
      target: targetResult.recordset[0],
      total: productResult.recordset.length,
      products: productResult.recordset
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Lỗi Controller: ' + error.message
    });
  }
};

export const getProductsByColor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const colorResult = await sql.query`
      SELECT MAU_SAC_ID, TEN_MAU_SAC
      FROM MAU_SAC
      WHERE MAU_SAC_ID = ${id}
    `;

    if (colorResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy màu sắc'
      });
    }

    const productResult = await sql.query`
      SELECT 
        sp.SAN_PHAM_ID,
        sp.CHU_DE_ID,
        cd.TEN_CHU_DE,
        msMain.MAU_SAC_ID,
        msMain.TEN_MAU_SAC,
        sp.TEN_SAN_PHAM,
        sp.MO_TA,
        sp.GIA,
        sp.GIA_KHUYEN_MAI,
        sp.TRANG_THAI,
        sp.KIEU_DANG,
        sp.SO_LUONG,
        sp.DA_BAN,
        ha.URL AS HINH_ANH,
        hoa.TEN_HOA_TUOI_LIST,
        dt.TEN_DOI_TUONG_LIST,
        ms.TEN_MAU_SAC_LIST
      FROM MAU_SAC_SAN_PHAM msspMain
      INNER JOIN MAU_SAC msMain
        ON msspMain.MAU_SAC_ID = msMain.MAU_SAC_ID
      INNER JOIN SAN_PHAM sp
        ON msspMain.SAN_PHAM_ID = sp.SAN_PHAM_ID
      LEFT JOIN CHU_DE cd 
        ON sp.CHU_DE_ID = cd.CHU_DE_ID

      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC
      ) ha

      OUTER APPLY (
        SELECT STRING_AGG(f.TEN_HOA_TUOI, N'|') AS TEN_HOA_TUOI_LIST
        FROM (
          SELECT DISTINCT ht.TEN_HOA_TUOI
          FROM HOA_TUOI_SAN_PHAM htsp
          INNER JOIN HOA_TUOI ht
            ON htsp.HOA_TUOI_ID = ht.HOA_TUOI_ID
          WHERE htsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) f
      ) hoa

      OUTER APPLY (
        SELECT STRING_AGG(d.TEN_DOI_TUONG, N'|') AS TEN_DOI_TUONG_LIST
        FROM (
          SELECT DISTINCT dt2.TEN_DOI_TUONG
          FROM DOI_TUONG_SAN_PHAM dtsp
          INNER JOIN DOI_TUONG dt2
            ON dtsp.DOI_TUONG_ID = dt2.DOI_TUONG_ID
          WHERE dtsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) d
      ) dt

      OUTER APPLY (
        SELECT STRING_AGG(m.TEN_MAU_SAC, N'|') AS TEN_MAU_SAC_LIST
        FROM (
          SELECT DISTINCT ms2.TEN_MAU_SAC
          FROM MAU_SAC_SAN_PHAM mssp
          INNER JOIN MAU_SAC ms2
            ON mssp.MAU_SAC_ID = ms2.MAU_SAC_ID
          WHERE mssp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) m
      ) ms

      WHERE msMain.MAU_SAC_ID = ${id}
    `;

    res.status(200).json({
      color: colorResult.recordset[0],
      total: productResult.recordset.length,
      products: productResult.recordset
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Lỗi Controller: ' + error.message
    });
  }
};

export const getProductsByCollection = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const collectionResult = await sql.query`
      SELECT BO_SUU_TAP_ID, TEN_BO_SUU_TAP, MO_TA
      FROM BO_SUU_TAP
      WHERE BO_SUU_TAP_ID = ${id}
    `;

    if (collectionResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy bộ sưu tập'
      });
    }

    const productResult = await sql.query`
      SELECT 
        sp.SAN_PHAM_ID,
        sp.CHU_DE_ID,
        cd.TEN_CHU_DE,
        bst.BO_SUU_TAP_ID,
        bst.TEN_BO_SUU_TAP,
        sp.TEN_SAN_PHAM,
        sp.MO_TA,
        sp.GIA,
        sp.GIA_KHUYEN_MAI,
        sp.TRANG_THAI,
        sp.KIEU_DANG,
        sp.SO_LUONG,
        sp.DA_BAN,
        ha.URL AS HINH_ANH,
        hoa.TEN_HOA_TUOI_LIST,
        dt.TEN_DOI_TUONG_LIST,
        ms.TEN_MAU_SAC_LIST
      FROM BO_SUU_TAP_SAN_PHAM bstsp
      INNER JOIN BO_SUU_TAP bst
        ON bstsp.BO_SUU_TAP_ID = bst.BO_SUU_TAP_ID
      INNER JOIN SAN_PHAM sp
        ON bstsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
      LEFT JOIN CHU_DE cd 
        ON sp.CHU_DE_ID = cd.CHU_DE_ID

      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC
      ) ha

      OUTER APPLY (
        SELECT STRING_AGG(f.TEN_HOA_TUOI, N'|') AS TEN_HOA_TUOI_LIST
        FROM (
          SELECT DISTINCT ht.TEN_HOA_TUOI
          FROM HOA_TUOI_SAN_PHAM htsp
          INNER JOIN HOA_TUOI ht
            ON htsp.HOA_TUOI_ID = ht.HOA_TUOI_ID
          WHERE htsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) f
      ) hoa

      OUTER APPLY (
        SELECT STRING_AGG(d.TEN_DOI_TUONG, N'|') AS TEN_DOI_TUONG_LIST
        FROM (
          SELECT DISTINCT dt2.TEN_DOI_TUONG
          FROM DOI_TUONG_SAN_PHAM dtsp
          INNER JOIN DOI_TUONG dt2
            ON dtsp.DOI_TUONG_ID = dt2.DOI_TUONG_ID
          WHERE dtsp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) d
      ) dt

      OUTER APPLY (
        SELECT STRING_AGG(m.TEN_MAU_SAC, N'|') AS TEN_MAU_SAC_LIST
        FROM (
          SELECT DISTINCT ms2.TEN_MAU_SAC
          FROM MAU_SAC_SAN_PHAM mssp
          INNER JOIN MAU_SAC ms2
            ON mssp.MAU_SAC_ID = ms2.MAU_SAC_ID
          WHERE mssp.SAN_PHAM_ID = sp.SAN_PHAM_ID
        ) m
      ) ms

      WHERE bst.BO_SUU_TAP_ID = ${id}
    `;

    res.status(200).json({
      collection: collectionResult.recordset[0],
      total: productResult.recordset.length,
      products: productResult.recordset
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Lỗi Controller: ' + error.message
    });
  }
};

export const getSaleProducts = async (req: Request, res: Response) => {
  try {
    const productResult = await sql.query`
      SELECT TOP 80
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

      WHERE 
        sp.GIA_KHUYEN_MAI IS NOT NULL
        AND sp.GIA_KHUYEN_MAI > 0
        AND sp.GIA_KHUYEN_MAI < sp.GIA
        AND sp.TRANG_THAI = N'Đang bán'

      ORDER BY sp.DA_BAN DESC, sp.GIA_KHUYEN_MAI ASC
    `;

    res.status(200).json({
      total: productResult.recordset.length,
      products: productResult.recordset
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Lỗi Controller: ' + error.message
    });
  }
};

export const getBestSellerProducts = async (req: Request, res: Response) => {
  try {
    const productResult = await sql.query`
      SELECT TOP 40
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

      WHERE sp.TRANG_THAI = N'Đang bán'

      ORDER BY sp.DA_BAN DESC
    `;

    res.status(200).json({
      total: productResult.recordset.length,
      products: productResult.recordset
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Lỗi Controller: ' + error.message
    });
  }
};
