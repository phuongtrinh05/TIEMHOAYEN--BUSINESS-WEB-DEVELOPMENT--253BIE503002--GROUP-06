import { Request, Response } from 'express';
import { getCollection } from '../mongo.js';

type SearchProductRow = {
  SAN_PHAM_ID: string;
  CHU_DE_ID?: string;
  TEN_CHU_DE?: string;
  TEN_SAN_PHAM: string;
  MO_TA?: string;
  GIA: number | string;
  GIA_KHUYEN_MAI?: number | string | null;
  TRANG_THAI?: string;
  KIEU_DANG?: string;
  SO_LUONG?: number;
  DA_BAN?: number;
  HINH_ANH?: string | null;
};

const SEARCH_STOP_WORDS = new Set([
  'hoa',
  'bo',
  'bong',
  'cay',
  'ngay',
  'tang',
  'cho',
  'va',
  'voi',
  'cua',
  'nhung',
  'mau',
  'san',
  'pham',
  'dep',
  'gia',
  're',
  'cao',
  'cap',
]);

const normalizeSearchText = (value: unknown): string => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9/\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const getSearchTokens = (value: string): string[] => {
  return normalizeSearchText(value)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !SEARCH_STOP_WORDS.has(token));
};

const expandSearchTerms = (keyword: string): string[] => {
  const normalized = normalizeSearchText(keyword);
  const terms = new Set<string>();

  if (normalized) {
    terms.add(normalized);
  }

  // Bộ data có nhiều tên/mô tả ngày lễ bị nhập dạng 20/1110 hoặc 20/1111.
  // Thêm biến thể để người dùng gõ 20/10, 20-10, 20/11 vẫn tìm ra đúng nhóm sản phẩm.
  if (/20\s*\/?\s*10/.test(normalized) || normalized.includes('2010')) {
    terms.add('20/10');
    terms.add('20 10');
    terms.add('20/1110');
    terms.add('phu nu viet nam');
    terms.add('me vo chong');
  }

  if (/20\s*\/?\s*11/.test(normalized) || normalized.includes('2011')) {
    terms.add('20/11');
    terms.add('20 11');
    terms.add('20/1111');
    terms.add('nha giao');
    terms.add('thay co');
  }

  if (normalized.includes('khai truong')) {
    terms.add('khung hoa khai truong');
    terms.add('lang hoa khai truong');
    terms.add('chuc mung khai truong');
    terms.add('hong phat');
  }

  if (normalized.includes('sinh nhat')) {
    terms.add('happy birthday');
    terms.add('chuc mung sinh nhat');
    terms.add('hop hoa');
    terms.add('bo hoa');
  }

  if (normalized.includes('hoa cuoi') || normalized.includes('cuoi')) {
    terms.add('hoa cuoi');
    terms.add('bo hoa cuoi');
    terms.add('cam tay');
    terms.add('co dau');
  }

  if (normalized.includes('hong do')) {
    terms.add('hoa hong do');
    terms.add('bo hoa hong do');
    terms.add('tinh yeu');
  }

  if (normalized.includes('huong duong')) {
    terms.add('hoa huong duong');
    terms.add('nang vang');
  }

  if (normalized.includes('tulip')) {
    terms.add('hoa tulip');
  }

  return Array.from(terms).filter(Boolean);
};

const parseBudgetFromKeyword = (keyword: string): number | null => {
  const normalized = normalizeSearchText(keyword).replace(/,/g, '.');

  const millionMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(trieu|tr|m)\b/);
  if (millionMatch) {
    return Math.round(Number(millionMatch[1]) * 1_000_000);
  }

  const thousandMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(k|nghin|ngan)\b/);
  if (thousandMatch) {
    return Math.round(Number(thousandMatch[1]) * 1_000);
  }

  const plainNumberMatch = normalized.match(/\b(\d{5,9})\b/);
  if (plainNumberMatch) {
    return Number(plainNumberMatch[1]);
  }

  return null;
};

const getFinalPrice = (item: SearchProductRow): number => {
  const originalPrice = Number(item.GIA || 0);
  const salePrice = item.GIA_KHUYEN_MAI === null || item.GIA_KHUYEN_MAI === undefined
    ? null
    : Number(item.GIA_KHUYEN_MAI);

  if (
    salePrice !== null &&
    !Number.isNaN(salePrice) &&
    salePrice > 0 &&
    originalPrice > 0 &&
    salePrice < originalPrice
  ) {
    return salePrice;
  }

  return originalPrice;
};

const sortPrimaryImages = (a: any, b: any): number => {
  const primaryDiff = Number(Boolean(b.LA_ANH_CHINH)) - Number(Boolean(a.LA_ANH_CHINH));
  if (primaryDiff !== 0) return primaryDiff;
  return String(a.HINH_ANH_ID || '').localeCompare(String(b.HINH_ANH_ID || ''), 'vi');
};

const getPrimaryImageMap = async (): Promise<Map<string, string | null>> => {
  const imageCollection = await getCollection('HINH_ANH_SAN_PHAM');
  const images = await imageCollection.find({}).toArray();
  const grouped = new Map<string, any[]>();

  images.forEach((image: any) => {
    const productId = String(image.SAN_PHAM_ID || '');
    grouped.set(productId, [...(grouped.get(productId) || []), image]);
  });

  return new Map(
    Array.from(grouped.entries()).map(([productId, productImages]) => {
      const [primaryImage] = productImages.sort(sortPrimaryImages);
      return [productId, primaryImage?.URL || null];
    }),
  );
};

const enrichProducts = async (products: any[], includeTopic = false): Promise<SearchProductRow[]> => {
  const imageMap = await getPrimaryImageMap();
  let topicMap = new Map<string, string>();

  if (includeTopic) {
    const topicCollection = await getCollection('CHU_DE');
    const topics = await topicCollection.find({}).toArray();
    topicMap = new Map(topics.map((topic: any) => [String(topic.CHU_DE_ID || ''), String(topic.TEN_CHU_DE || '')]));
  }

  return products.map((product: any) => ({
    ...product,
    TEN_CHU_DE: includeTopic ? topicMap.get(String(product.CHU_DE_ID || '')) : undefined,
    HINH_ANH: imageMap.get(String(product.SAN_PHAM_ID || '')) || null,
  }));
};

const calculateSearchScore = (
  item: SearchProductRow,
  rawKeyword: string,
  terms: string[],
  tokens: string[],
  budget: number | null,
): number => {
  const keyword = normalizeSearchText(rawKeyword);
  const id = normalizeSearchText(item.SAN_PHAM_ID);
  const name = normalizeSearchText(item.TEN_SAN_PHAM);
  const style = normalizeSearchText(item.KIEU_DANG);
  const topic = normalizeSearchText(item.TEN_CHU_DE);
  const description = normalizeSearchText(item.MO_TA);
  const blob = `${id} ${name} ${style} ${topic} ${description}`;

  let score = 0;

  if (id === keyword) score += 1200;
  else if (id.startsWith(keyword)) score += 900;
  else if (id.includes(keyword)) score += 650;

  if (name === keyword) score += 850;
  else if (name.startsWith(keyword)) score += 620;
  else if (name.includes(keyword)) score += 460;

  if (style === keyword) score += 620;
  else if (style.includes(keyword)) score += 360;

  if (topic === keyword) score += 420;
  else if (topic.includes(keyword)) score += 260;

  if (description.includes(keyword)) score += 95;

  terms.forEach((term) => {
    if (!term || term === keyword) return;

    if (name.includes(term)) score += 240;
    if (style.includes(term)) score += 190;
    if (topic.includes(term)) score += 130;
    if (description.includes(term)) score += 50;
  });

  tokens.forEach((token) => {
    if (id.includes(token)) score += 250;
    if (name.includes(token)) score += 110;
    if (style.includes(token)) score += 90;
    if (topic.includes(token)) score += 60;
    if (description.includes(token)) score += 24;
  });

  if (tokens.length > 0 && tokens.every((token) => name.includes(token))) {
    score += 210;
  }

  if (tokens.length > 0 && tokens.every((token) => blob.includes(token))) {
    score += 110;
  }

  // Khi từ khóa quá rộng như "hoa", ưu tiên sản phẩm bán chạy/đang giảm giá hơn.
  const sold = Number(item.DA_BAN || 0);
  if (sold > 0) {
    score += Math.min(95, Math.round(Math.log10(sold + 1) * 38));
  }

  const originalPrice = Number(item.GIA || 0);
  const finalPrice = getFinalPrice(item);

  if (originalPrice > finalPrice) {
    score += 25;
  }

  if (budget !== null && budget > 0 && finalPrice > 0) {
    const diffRate = Math.abs(finalPrice - budget) / budget;

    if (finalPrice <= budget) {
      score += 70;
    }

    if (diffRate <= 0.1) score += 160;
    else if (diffRate <= 0.25) score += 90;
    else if (diffRate <= 0.4) score += 45;
  }

  return score;
};

export const getAllProducts = async (req: Request, res: Response) => {
  try {
    const productCollection = await getCollection('SAN_PHAM');
    const products = await productCollection.find({}).sort({ TEN_SAN_PHAM: 1 }).toArray();
    const rows = await enrichProducts(products);

    res.status(200).json(rows);
  } catch (error: any) {
    res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

export const searchProducts = async (req: Request, res: Response) => {
  try {
    const keyword = String(req.query.q || '').trim();
    const limitRaw = Number(req.query.limit || 8);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.floor(limitRaw), 1), 20)
      : 8;

    if (!keyword) {
      return res.status(200).json({ products: [] });
    }

    const normalizedKeyword = normalizeSearchText(keyword);

    if (normalizedKeyword.length < 2) {
      return res.status(200).json({ products: [] });
    }

    const terms = expandSearchTerms(keyword);
    const tokens = getSearchTokens(keyword);
    const budget = parseBudgetFromKeyword(keyword);

    const productCollection = await getCollection('SAN_PHAM');
    const products = await productCollection.find({ TRANG_THAI: { $ne: 'Ngừng bán' } }).toArray();
    const rows = await enrichProducts(products, true);

    const rankedProducts = rows
      .map((item) => ({
        ...item,
        MATCH_SCORE: calculateSearchScore(item, keyword, terms, tokens, budget),
      }))
      .filter((item) => item.MATCH_SCORE > 0)
      .sort((a, b) => {
        if (b.MATCH_SCORE !== a.MATCH_SCORE) {
          return b.MATCH_SCORE - a.MATCH_SCORE;
        }

        const aSold = Number(a.DA_BAN || 0);
        const bSold = Number(b.DA_BAN || 0);

        if (bSold !== aSold) {
          return bSold - aSold;
        }

        return String(a.TEN_SAN_PHAM || '').localeCompare(String(b.TEN_SAN_PHAM || ''), 'vi');
      })
      .slice(0, limit);

    return res.status(200).json({
      products: rankedProducts,
      keyword,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi tìm kiếm sản phẩm: ' + error.message,
    });
  }
};


export const getProductById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const productCollection = await getCollection('SAN_PHAM');
    const imageCollection = await getCollection('HINH_ANH_SAN_PHAM');
    const reviewCollection = await getCollection('DANH_GIA');
    const reviewImageCollection = await getCollection('DANH_GIA_HINH_ANH');
    const customerCollection = await getCollection('KHACH_HANG');

    const product = await productCollection.findOne({ SAN_PHAM_ID: id });

    if (!product) {
      return res.status(404).json({
        message: 'Không tìm thấy sản phẩm'
      });
    }

    const [images, reviews] = await Promise.all([
      imageCollection.find({ SAN_PHAM_ID: id }).toArray(),
      reviewCollection.find({ SAN_PHAM_ID: id }).sort({ NGAY_DANH_GIA: -1, DANH_GIA_ID: -1 }).toArray(),
    ]);

    const customers = await customerCollection
      .find({ KHACH_HANG_ID: { $in: reviews.map((review: any) => review.KHACH_HANG_ID).filter(Boolean) } })
      .toArray();
    const customerMap = new Map(customers.map((customer: any) => [String(customer.KHACH_HANG_ID), customer]));
    const reviewIds = reviews.map((review: any) => review.DANH_GIA_ID);
    const reviewImages = await reviewImageCollection
      .find({ DANH_GIA_ID: { $in: reviewIds } })
      .sort({ NGAY_TAO: 1, URL: 1 })
      .toArray();

    const imageMap = new Map<string, string[]>();

    reviewImages.forEach((row: any) => {
      const reviewId = String(row.DANH_GIA_ID || '');

      if (!imageMap.has(reviewId)) {
        imageMap.set(reviewId, []);
      }

      imageMap.get(reviewId)?.push(String(row.URL || ''));
    });

    const reviewCount = reviews.length;
    const averageRating = reviewCount > 0
      ? Math.round((reviews.reduce((sum: number, item: any) => sum + Number(item.SO_SAO || 0), 0) / reviewCount) * 10) / 10
      : 0;

    const mappedReviews = reviews.map((item: any) => {
      const customer = customerMap.get(String(item.KHACH_HANG_ID || ''));

      return ({
      reviewId: item.DANH_GIA_ID,
      orderId: item.DON_HANG_ID,
      productId: item.SAN_PHAM_ID,
      customerId: item.KHACH_HANG_ID || null,
      customerName: item.KHACH_HANG_ID
        ? (customer?.TEN || 'Khách hàng')
        : 'Khách hàng ẩn danh',
      avatar: customer?.AVATAR || null,
      rating: Number(item.SO_SAO || 0),
      content: item.NOI_DUNG || '',
      createdAt: item.NGAY_DANH_GIA,
      images: imageMap.get(String(item.DANH_GIA_ID || '')) || [],
      shopReply: item.PHAN_HOI_SHOP || null,
      shopReplyDate: item.NGAY_PHAN_HOI_SHOP || null,
      shopReplyStaffId: item.NHAN_VIEN_PHAN_HOI_ID || null
    });
    });

    const [enrichedProduct] = await enrichProducts([product], true);

    return res.status(200).json({
      product: enrichedProduct,
      images: images.sort(sortPrimaryImages),
      reviewStats: {
        reviewCount,
        averageRating
      },
      reviews: mappedReviews
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Lỗi Controller: ' + error.message
    });
  }
};
