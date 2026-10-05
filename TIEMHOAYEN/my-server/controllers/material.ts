import { Request, Response } from 'express';
import { getCollection } from '../mongo.js';

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
    const productCollection = await getCollection('SAN_PHAM');
    const imageCollection = await getCollection('HINH_ANH_SAN_PHAM');
    const candidates = await productCollection.find({
      TRANG_THAI: 'Đang bán',
      $or: [
        { KIEU_DANG: 'Sản phẩm mua kèm' },
        { KIEU_DANG: 'Phụ kiện' },
        { TEN_SAN_PHAM: { $in: ['Gấu bông', 'Nến thơm', 'Thiệp', 'Túi quà cao cấp'] } },
        { MO_TA: /SẢN PHẨM MUA KÈM/i },
        { MO_TA: /SAN PHAM MUA KEM/i },
      ],
    }).toArray();

    const order = new Map([
      ['Gấu bông', 1],
      ['Nến thơm', 2],
      ['Thiệp', 3],
      ['Túi quà cao cấp', 4],
    ]);
    const sorted = candidates
      .sort((a: any, b: any) => {
        const rankDiff = (order.get(String(a.TEN_SAN_PHAM)) ?? 5) - (order.get(String(b.TEN_SAN_PHAM)) ?? 5);
        if (rankDiff !== 0) return rankDiff;
        return String(a.TEN_SAN_PHAM || '').localeCompare(String(b.TEN_SAN_PHAM || ''), 'vi');
      })
      .slice(0, 4);
    const images = await imageCollection
      .find({ SAN_PHAM_ID: { $in: sorted.map((product: any) => product.SAN_PHAM_ID) } })
      .toArray();
    const imageMap = new Map<string, string | null>();
    images
      .sort((a: any, b: any) => Number(Boolean(b.LA_ANH_CHINH)) - Number(Boolean(a.LA_ANH_CHINH)) || String(a.HINH_ANH_ID || '').localeCompare(String(b.HINH_ANH_ID || ''), 'vi'))
      .forEach((image: any) => {
        const productId = String(image.SAN_PHAM_ID || '');
        if (!imageMap.has(productId)) {
          imageMap.set(productId, image.URL || null);
        }
      });
    const products = sorted.map((product: any) => ({
      SAN_PHAM_ID: product.SAN_PHAM_ID,
      TEN_SAN_PHAM: product.TEN_SAN_PHAM,
      GIA: product.GIA ?? null,
      GIA_KHUYEN_MAI: product.GIA_KHUYEN_MAI ?? null,
      TRANG_THAI: product.TRANG_THAI ?? null,
      KIEU_DANG: product.KIEU_DANG ?? null,
      SO_LUONG: product.SO_LUONG ?? null,
      HINH_ANH: imageMap.get(String(product.SAN_PHAM_ID || '')) || null,
    })) as SuggestedProduct[];

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
