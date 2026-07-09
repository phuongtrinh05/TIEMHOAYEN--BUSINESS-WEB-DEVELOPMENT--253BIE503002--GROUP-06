import { Request, Response } from 'express';
import { sql } from '../db.js';

interface SuggestedProduct {
  SAN_PHAM_ID: string;
  TEN_SAN_PHAM: string;
  GIA: number | null;
  GIA_KHUYEN_MAI: number | null;
  TRANG_THAI: string | null;
  KIEU_DANG: string | null;
  SO_LUONG: number | null;
  HINH_ANH: string | null;
}

interface SuggestedProductsResponse {
  total: number;
  products: SuggestedProduct[];
  /**
   * Giữ thêm key `materials` để frontend cũ đang gọi res.materials không bị lỗi.
   * Dữ liệu bên trong vẫn lấy từ bảng SAN_PHAM, không còn lấy NGUYEN_VAT_LIEU.
   */
  materials: SuggestedProduct[];
}

// GET /materials/suggested
// Lấy sản phẩm mua kèm từ bảng SAN_PHAM, không lấy từ bảng NGUYEN_VAT_LIEU nữa.
export const getSuggestedMaterials = async (req: Request, res: Response) => {
  try {
    const result = await sql.query<SuggestedProduct>`
      SELECT TOP 4
        sp.SAN_PHAM_ID,
        sp.TEN_SAN_PHAM,
        sp.GIA,
        sp.GIA_KHUYEN_MAI,
        sp.TRANG_THAI,
        sp.KIEU_DANG,
        sp.SO_LUONG,
        img.URL AS HINH_ANH
      FROM SAN_PHAM sp
      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC, HINH_ANH_ID ASC
      ) img
      WHERE
        sp.TRANG_THAI = N'Đang bán'
        AND (
          sp.KIEU_DANG = N'Sản phẩm mua kèm'
          OR sp.KIEU_DANG = N'Phụ kiện'
          OR sp.TEN_SAN_PHAM IN (N'Gấu bông', N'Nến thơm', N'Thiệp', N'Túi quà cao cấp')
          OR sp.MO_TA LIKE N'%SẢN PHẨM MUA KÈM%'
          OR sp.MO_TA LIKE N'%SAN PHAM MUA KEM%'
        )
      ORDER BY
        CASE
          WHEN sp.TEN_SAN_PHAM = N'Gấu bông' THEN 1
          WHEN sp.TEN_SAN_PHAM = N'Nến thơm' THEN 2
          WHEN sp.TEN_SAN_PHAM = N'Thiệp' THEN 3
          WHEN sp.TEN_SAN_PHAM = N'Túi quà cao cấp' THEN 4
          ELSE 5
        END,
        sp.TEN_SAN_PHAM ASC
    `;

    const products = result.recordset;

    const response: SuggestedProductsResponse = {
      total: products.length,
      products,
      materials: products,
    };

    return res.status(200).json(response);
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};
