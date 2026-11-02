import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';
import { invalidateAnalyticsCache } from '../services/analytics/cache.js';
import { randomUUID } from 'node:crypto';
import { lookupAccess } from '../services/order-access.service.js';
import { InventoryError, withTransaction } from '../services/inventory/helpers.js';

let reviewStorageReady: Promise<void> | null = null;
export const ensureReviewStorage = async () => {
  if (!reviewStorageReady) reviewStorageReady = (async () => {
    const collection = await getCollection<any>('DANH_GIA');
    const indexes = await collection.listIndexes().toArray().catch((error: any) => {
      if (error?.code === 26) return [];
      throw error;
    });
    const existing = indexes.find((index: any) => index.unique && !index.partialFilterExpression && !index.sparse &&
      Object.keys(index.key || {}).length === 2 && index.key.DON_HANG_ID === 1 && index.key.SAN_PHAM_ID === 1);
    if (existing) return;
    await collection.createIndex(
      { DON_HANG_ID: 1, SAN_PHAM_ID: 1 },
      { unique: true, name: 'uniq_review_order_product' },
    );
  })().catch((error) => {
    reviewStorageReady = null;
    throw error;
  });
  return reviewStorageReady;
};

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
const detailProductId = (detail: any): string => String(
  detail?.SAN_PHAM_ID || detail?.PRODUCT_ID || detail?.MA_SAN_PHAM || detail?._id?.SAN_PHAM_ID || '',
).trim();

const normalizeText = (value: unknown): string => {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .trim()
    .toLowerCase();
};

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

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

const isReviewableOrder = (order: any): boolean => {
  const status = normalizeText(order?.TRANG_THAI);
  const refundReason = String(order?.LY_DO_HOAN_TIEN_TRA_HANG || '').trim();

  return ['giao hang thanh cong', 'da giao', 'hoan thanh'].includes(status) && !refundReason;
};

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

  return Array.from(orderMap.values()).map((order) => ({
    ...order,
    reviewed: order.items.length > 0 && order.items.every((item: any) => item.reviewed),
  }));
};

const mapReviewRows = (rows: any[]) => rows.map((item: any) => ({
  reviewId: item.DANH_GIA_ID,
  orderId: item.DON_HANG_ID,
  productId: item.SAN_PHAM_ID,
  productName: item.TEN_SAN_PHAM || '',
  productImage: item.HINH_ANH || null,
  customerId: item.KHACH_HANG_ID || null,
  customerName: item.AN_DANH === true ? 'Khách hàng ẩn danh' : (item.KHACH_HANG_ID ? (item.TEN_KHACH_HANG || 'Khách hàng') : 'Khách hàng'),
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

const getPrimaryImageMap = async (productIds: string[]) => {
  const imageCollection = await getCollection<any>('HINH_ANH_SAN_PHAM');
  const images = await imageCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray();
  const imageMap = new Map<string, any>();

  for (const image of images.sort((left, right) => {
    if (Boolean(left.LA_ANH_CHINH) !== Boolean(right.LA_ANH_CHINH)) {
      return Boolean(left.LA_ANH_CHINH) ? -1 : 1;
    }
    return String(left.HINH_ANH_ID || '').localeCompare(String(right.HINH_ANH_ID || ''), 'vi');
  })) {
    if (!imageMap.has(image.SAN_PHAM_ID)) {
      imageMap.set(image.SAN_PHAM_ID, image);
    }
  }

  return imageMap;
};

const buildReviewableOrderRows = async (orders: any[]): Promise<ReviewableOrderRow[]> => {
  const orderIds = orders.map((order) => order.DON_HANG_ID).filter(Boolean);
  if (orderIds.length === 0) return [];

  const [detailCollection, productCollection, reviewCollection] = await Promise.all([
    getCollection<any>('DON_HANG_CHI_TIET'),
    getCollection<any>('SAN_PHAM'),
    getCollection<any>('DANH_GIA'),
  ]);
  const details = await detailCollection.find({ DON_HANG_ID: { $in: orderIds } }).toArray();
  const productIds = details.map(detailProductId).filter(Boolean);
  const [products, imageMap, reviews] = await Promise.all([
    productCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
    getPrimaryImageMap(productIds),
    reviewCollection.find({ DON_HANG_ID: { $in: orderIds } }).toArray(),
  ]);
  const productMap = new Map(products.map((product) => [product.SAN_PHAM_ID, product]));
  const reviewedPairs = new Set(reviews.map((review) => `${review.DON_HANG_ID}:${review.SAN_PHAM_ID}`));
  const orderMap = new Map(orders.map((order) => [order.DON_HANG_ID, order]));

  const groupedDetails = new Map<string, any>();
  for (const detail of details) {
    const normalizedProductId = detailProductId(detail);
    if (!normalizedProductId) continue;
    const normalizedDetail = { ...detail, SAN_PHAM_ID: normalizedProductId };
    const key = `${detail.DON_HANG_ID}:${normalizedProductId}`;
    const current = groupedDetails.get(key);
    groupedDetails.set(key, current
      ? { ...current, SO_LUONG: Number(current.SO_LUONG || 0) + Number(detail.SO_LUONG || 0) }
      : normalizedDetail);
  }
  return [...groupedDetails.values()]
    .sort((left, right) => {
      const orderDateDiff = (toDate(orderMap.get(right.DON_HANG_ID)?.NGAY_TAO)?.getTime() || 0)
        - (toDate(orderMap.get(left.DON_HANG_ID)?.NGAY_TAO)?.getTime() || 0);
      if (orderDateDiff !== 0) return orderDateDiff;
      return String(left.SAN_PHAM_ID || '').localeCompare(String(right.SAN_PHAM_ID || ''), 'vi');
    })
    .map((detail) => {
      const order = orderMap.get(detail.DON_HANG_ID);
      const product = productMap.get(detail.SAN_PHAM_ID);
      const image = imageMap.get(detail.SAN_PHAM_ID);
      return {
        DON_HANG_ID: detail.DON_HANG_ID,
        NGAY_TAO: order?.NGAY_TAO,
        TONG_TIEN: order?.TONG_TIEN,
        TRANG_THAI: order?.TRANG_THAI,
        SDT_NGUOI_NHAN: order?.SDT_NGUOI_NHAN,
        SAN_PHAM_ID: detail.SAN_PHAM_ID,
        TEN_SAN_PHAM: product?.TEN_SAN_PHAM || detail.TEN_SAN_PHAM_SNAPSHOT || detail.TEN_SAN_PHAM || detail.SAN_PHAM_ID,
        SO_LUONG: detail.SO_LUONG,
        GIA: detail.GIA,
        HINH_ANH: image?.URL || detail.HINH_ANH_SNAPSHOT || detail.HINH_ANH || null,
        DA_DANH_GIA: reviewedPairs.has(`${detail.DON_HANG_ID}:${detail.SAN_PHAM_ID}`) ? 1 : 0,
      };
    });
};

const buildReviewRows = async (reviews: any[]) => {
  const productIds = reviews.map((review) => review.SAN_PHAM_ID).filter(Boolean);
  const customerIds = reviews.map((review) => review.KHACH_HANG_ID).filter(Boolean);
  const reviewIds = reviews.map((review) => review.DANH_GIA_ID).filter(Boolean);
  const [productCollection, customerCollection, reviewImageCollection] = await Promise.all([
    getCollection<any>('SAN_PHAM'),
    getCollection<any>('KHACH_HANG'),
    getCollection<any>('DANH_GIA_HINH_ANH'),
  ]);
  const [products, imageMap, customers, reviewImages] = await Promise.all([
    productCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
    getPrimaryImageMap(productIds),
    customerCollection.find({ KHACH_HANG_ID: { $in: customerIds } }).toArray(),
    reviewImageCollection.find({ DANH_GIA_ID: { $in: reviewIds } }).toArray(),
  ]);
  const productMap = new Map(products.map((product) => [product.SAN_PHAM_ID, product]));
  const customerMap = new Map(customers.map((customer) => [customer.KHACH_HANG_ID, customer]));
  const reviewImageMap = new Map<string, string[]>();

  for (const image of reviewImages) {
    const current = reviewImageMap.get(image.DANH_GIA_ID) || [];
    current.push(image.URL);
    reviewImageMap.set(image.DANH_GIA_ID, current);
  }

  return reviews
    .sort((left, right) => (toDate(right.NGAY_DANH_GIA)?.getTime() || 0) - (toDate(left.NGAY_DANH_GIA)?.getTime() || 0))
    .map((review) => {
      const product = productMap.get(review.SAN_PHAM_ID);
      const customer = customerMap.get(review.KHACH_HANG_ID);
      const productImage = imageMap.get(review.SAN_PHAM_ID);
      return {
        ...review,
        TEN_SAN_PHAM: product?.TEN_SAN_PHAM || '',
        HINH_ANH: productImage?.URL || null,
        TEN_KHACH_HANG: customer?.TEN || null,
        HINH_ANH_LIST: (reviewImageMap.get(review.DANH_GIA_ID) || []).join('|'),
      };
    });
};

const createNextReviewImageId = async (): Promise<number> => {
  const imageCollection = await getCollection<any>('DANH_GIA_HINH_ANH');
  const images = await imageCollection.find({}).project({ DANH_GIA_HINH_ANH_ID: 1 }).toArray();
  return images.reduce((max, image) => Math.max(max, Number(image.DANH_GIA_HINH_ANH_ID || image._id || 0)), 0) + 1;
};

export const getReviewableOrdersForCustomer = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const access = await lookupAccess(req.headers['x-order-access']);
    if (access.authType !== 'member' || access.customerId !== customerId) throw new InventoryError(403, 'Phiên đăng nhập không thuộc khách hàng này.');
    await ensureReviewStorage();
    const orderCollection = await getCollection<any>('DON_HANG');
    const orders = (await orderCollection.find({ KHACH_HANG_ID: customerId }).toArray()).filter(isReviewableOrder);
    const rows = await buildReviewableOrderRows(orders);

    return res.status(200).json({ orders: mapOrderRows(rows) });
  } catch (error: any) {
    if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message });
    return res.status(500).json({
      message: 'Lỗi lấy đơn hàng có thể đánh giá: ' + error.message,
    });
  }
};

export const lookupGuestOrderForReview = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.body;
    const access = await lookupAccess(req.headers['x-order-access']);
    const normalizedPhone = normalizePhone(access.phone || '');

    if (!orderId || !normalizedPhone) {
      return res.status(400).json({ message: 'Vui lòng nhập mã đơn hàng và số điện thoại.' });
    }

    const orderCollection = await getCollection<any>('DON_HANG');
    const order = await orderCollection.findOne({ DON_HANG_ID: String(orderId).trim().toUpperCase() });
    const orderPhone = normalizePhone(order?.SDT_NGUOI_NHAN || '');

    if (!order || normalizedPhone !== orderPhone || !isReviewableOrder(order)) {
      return res.status(404).json({
        message: 'Không tìm thấy đơn hàng đã giao thành công khớp với mã đơn và số điện thoại nhận hàng.',
      });
    }

    const rows = await buildReviewableOrderRows([order]);
    const orders = mapOrderRows(rows);

    return res.status(200).json({ order: orders[0] });
  } catch (error: any) {
    if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message });
    return res.status(500).json({
      message: 'Lỗi tra cứu đơn hàng: ' + error.message,
    });
  }
};

export const getCustomerReviewHistory = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const access = await lookupAccess(req.headers['x-order-access']);
    if (access.authType !== 'member' || access.customerId !== customerId) throw new InventoryError(403, 'Phiên đăng nhập không thuộc khách hàng này.');

    if (!customerId) {
      return res.status(400).json({ message: 'Thiếu mã khách hàng.' });
    }

    const [reviewCollection, orderCollection] = await Promise.all([
      getCollection<any>('DANH_GIA'),
      getCollection<any>('DON_HANG'),
    ]);
    const orders = await orderCollection.find({ KHACH_HANG_ID: customerId }).project({ DON_HANG_ID: 1 }).toArray();
    const orderIds = orders.map((order) => order.DON_HANG_ID).filter(Boolean);
    const reviews = await reviewCollection.find({
      $or: [{ KHACH_HANG_ID: customerId }, { DON_HANG_ID: { $in: orderIds } }],
    }).toArray();
    const rows = await buildReviewRows(reviews);

    return res.status(200).json({ reviews: mapReviewRows(rows) });
  } catch (error: any) {
    if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message });
    return res.status(500).json({
      message: 'Lỗi lấy lịch sử đánh giá của khách hàng: ' + error.message,
    });
  }
};

export const getGuestReviewHistory = async (req: Request, res: Response) => {
  try {
    const access = await lookupAccess(req.headers['x-order-access']);
    const normalizedPhone = normalizePhone(access.phone || '');

    if (!/^0\d{9}$/.test(normalizedPhone)) {
      return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' });
    }

    const [orderCollection, reviewCollection] = await Promise.all([
      getCollection<any>('DON_HANG'),
      getCollection<any>('DANH_GIA'),
    ]);
    const orders = (await orderCollection.find({}).project({ DON_HANG_ID: 1, SDT_NGUOI_NHAN: 1 }).toArray())
      .filter((order) => normalizePhone(order.SDT_NGUOI_NHAN || '') === normalizedPhone);
    const orderIds = orders.map((order) => order.DON_HANG_ID).filter(Boolean);
    const reviews = await reviewCollection.find({ DON_HANG_ID: { $in: orderIds } }).toArray();
    const rows = await buildReviewRows(reviews);

    return res.status(200).json({ reviews: mapReviewRows(rows) });
  } catch (error: any) {
    if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message });
    return res.status(500).json({
      message: 'Lỗi lấy lịch sử đánh giá khách vãng lai: ' + error.message,
    });
  }
};

export const createReview = async (req: Request, res: Response) => {
  try {
    const { orderId, hideReviewer, rating, content } = req.body;
    const normalizedOrderId = String(orderId || '').trim().toUpperCase();
    const safeRating = Number(rating || 0);
    const shouldHideReviewer = String(hideReviewer || '').toLowerCase() === 'true';

    if (!normalizedOrderId) {
      return res.status(400).json({ message: 'Thiếu mã đơn hàng cần đánh giá.' });
    }

    if (!Number.isInteger(safeRating) || safeRating < 1 || safeRating > 5) {
      return res.status(400).json({ message: 'Số sao đánh giá phải từ 1 đến 5.' });
    }

    const safeContent = String(content || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!safeContent) {
      return res.status(400).json({ message: 'Vui lòng nhập nội dung đánh giá.' });
    }
    if (safeContent.length > 2000) return res.status(400).json({ message: 'Nội dung đánh giá không được vượt quá 2000 ký tự.' });

    await ensureReviewStorage();
    const access = await lookupAccess(req.headers['x-order-access']);

    const [orderCollection, orderDetailCollection, reviewCollection, reviewImageCollection] = await Promise.all([
      getCollection<any>('DON_HANG'),
      getCollection<any>('DON_HANG_CHI_TIET'),
      getCollection<any>('DANH_GIA'),
      getCollection<any>('DANH_GIA_HINH_ANH'),
    ]);
    const [order, orderDetail] = await Promise.all([
      orderCollection.findOne({ DON_HANG_ID: normalizedOrderId }),
      orderDetailCollection.find({ DON_HANG_ID: normalizedOrderId }).toArray(),
    ]);

    if (!order || !orderDetail.length || !isReviewableOrder(order)) {
      return res.status(404).json({
        message: 'Đơn hàng không hợp lệ hoặc chưa giao thành công.',
      });
    }

    const actorId = access.authType === 'member' ? String(access.customerId || '') : '';
    if (access.authType === 'member') {
      if (!actorId || String(order.KHACH_HANG_ID || '') !== actorId) {
        return res.status(403).json({ message: 'Bạn không có quyền đánh giá đơn hàng này.' });
      }
    } else {
      const normalizedInputPhone = normalizePhone(access.phone || '');
      const normalizedOrderPhone = normalizePhone(order.SDT_NGUOI_NHAN || '');

      if (!normalizedInputPhone || normalizedInputPhone !== normalizedOrderPhone) {
        return res.status(403).json({ message: 'Số điện thoại nhận hàng không khớp.' });
      }
    }

    const productIds = [...new Set(orderDetail.map(detailProductId).filter(Boolean))];
    if (productIds.length === 0) {
      return res.status(400).json({ message: 'Đơn hàng không có sản phẩm để đánh giá.' });
    }

    let submittedProductIds: unknown;
    try {
      submittedProductIds = JSON.parse(String(req.body.productIds || 'null'));
    } catch {
      return res.status(400).json({ message: 'Danh sách sản phẩm đánh giá không hợp lệ.' });
    }
    if (
      !Array.isArray(submittedProductIds) ||
      submittedProductIds.some((productId) => typeof productId !== 'string') ||
      new Set(submittedProductIds).size !== productIds.length ||
      productIds.some((productId) => !submittedProductIds.includes(productId))
    ) {
      return res.status(400).json({ message: 'Vui lòng gửi đánh giá cho toàn bộ sản phẩm trong đơn hàng.' });
    }

    const files = (Array.isArray(req.files) ? req.files : []) as any[];
    const existingReviews = await reviewCollection.find({
      DON_HANG_ID: normalizedOrderId,
      SAN_PHAM_ID: { $in: productIds },
    }).toArray();
    const existingByProduct = new Map(existingReviews.map((review) => [String(review.SAN_PHAM_ID), review]));
    if (productIds.every((productId) => existingByProduct.has(productId))) {
      return res.status(409).json({ message: 'Đơn hàng này đã được đánh giá.' });
    }

    const imageUrls: string[] = [];
    files.forEach(file => imageUrls.push(`${getPublicBaseUrl(req)}/uploads/reviews/${file.filename}`));
    const submittedAt = new Date();
    const reviews = productIds.map((productId) => ({
      productId,
      reviewId: String(existingByProduct.get(productId)?.DANH_GIA_ID || existingByProduct.get(productId)?._id || `DG${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`),
      existing: existingByProduct.get(productId),
    }));
    try {
      await withTransaction(async session => {
        const existingReviewIds = reviews.filter((review) => review.existing).map((review) => review.reviewId);
        if (existingReviewIds.length) {
          await reviewImageCollection.deleteMany({ DANH_GIA_ID: { $in: existingReviewIds } }, { session });
        }

        await reviewCollection.bulkWrite(reviews.map((review) => {
          const reviewData = {
            DANH_GIA_ID: review.reviewId,
            SAN_PHAM_ID: review.productId,
            KHACH_HANG_ID: actorId || null,
            AN_DANH: shouldHideReviewer,
            DON_HANG_ID: normalizedOrderId,
            SO_SAO: safeRating,
            NOI_DUNG: safeContent,
            NGAY_DANH_GIA: submittedAt,
            PHAN_HOI_SHOP: null,
            NGAY_PHAN_HOI_SHOP: null,
            NHAN_VIEN_PHAN_HOI_ID: null,
          };

          if (review.existing) {
            return {
              updateOne: {
                filter: { _id: review.existing._id },
                update: { $set: reviewData },
              },
            };
          }

          return {
            insertOne: {
              document: { _id: review.reviewId, ...reviewData },
            },
          };
        }), { session });

        if (files.length) {
          await reviewImageCollection.insertMany(
            reviews.flatMap((review) => files.map((file, index) => ({
              _id: `${review.reviewId}:${index + 1}`,
              DANH_GIA_HINH_ANH_ID: `${review.reviewId}:${index + 1}`,
              DANH_GIA_ID: review.reviewId,
              URL: imageUrls[index],
              NGAY_TAO: submittedAt,
            }))),
            { session },
          );
        }
      });
    } catch (error: any) {
      if (error?.code === 11000) return res.status(409).json({ message: 'Đơn hàng đã được đánh giá. Vui lòng tải lại trang.' });
      throw error;
    }

    if (isReviewableOrder(order) && !String(order.LY_DO_HOAN_TIEN_TRA_HANG || '').trim()) {
      await orderCollection.updateOne(
        { DON_HANG_ID: normalizedOrderId },
        { $set: { TRANG_THAI: 'Hoàn thành' } },
      );
      await orderCollection.updateOne(
        { DON_HANG_ID: normalizedOrderId, $or: [{ NGAY_HOAN_THANH: { $exists: false } }, { NGAY_HOAN_THANH: null }] },
        { $set: { NGAY_HOAN_THANH: new Date() } },
      );
      invalidateAnalyticsCache();
    }

    return res.status(201).json({
      message: 'Đã lưu đánh giá.',
      reviewId: reviews[0].reviewId,
      reviews: reviews.map(({ productId, reviewId }) => ({ productId, reviewId })),
      imageUrls,
      progress: { reviewed: productIds.length, total: productIds.length },
    });
  } catch (error: any) {
    if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message });
    return res.status(500).json({
      message: 'Lỗi lưu đánh giá: ' + error.message,
    });
  }
};

export const getProductReviews = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const reviewCollection = await getCollection<any>('DANH_GIA');
    const reviews = await reviewCollection.find({ SAN_PHAM_ID: productId }).toArray();
    const rows = await buildReviewRows(reviews);

    return res.status(200).json({
      reviews: mapReviewRows(rows).map(({ productName, productImage, ...review }) => review),
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
    const { reply } = req.body;
    const staffId = String(req.headers['x-admin-id'] || '').trim();
    const safeReply = String(reply || '').trim();

    if (!reviewId) {
      return res.status(400).json({ message: 'Thiếu mã đánh giá.' });
    }

    if (!safeReply) {
      return res.status(400).json({ message: 'Vui lòng nhập nội dung phản hồi của shop.' });
    }

    const reviewCollection = await getCollection<any>('DANH_GIA');
    const replyDate = new Date();
    const result = await reviewCollection.findOneAndUpdate(
      { DANH_GIA_ID: String(reviewId).trim() },
      {
        $set: {
          PHAN_HOI_SHOP: safeReply,
          NGAY_PHAN_HOI_SHOP: replyDate,
          NHAN_VIEN_PHAN_HOI_ID: staffId || null,
        },
      },
      { returnDocument: 'after' },
    );

    if (!result) {
      return res.status(404).json({ message: 'Không tìm thấy đánh giá cần phản hồi.' });
    }

    return res.status(200).json({
      message: 'Đã lưu phản hồi của shop.',
      review: {
        reviewId: result.DANH_GIA_ID,
        shopReply: result.PHAN_HOI_SHOP,
        shopReplyDate: result.NGAY_PHAN_HOI_SHOP,
        shopReplyStaffId: result.NHAN_VIEN_PHAN_HOI_ID || null,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi lưu phản hồi đánh giá: ' + error.message,
    });
  }
};
