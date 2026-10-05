import { Request, Response } from 'express';
import { getCollection } from '../mongo.js';

const createCartId = (): string => `GH${Date.now().toString().slice(-8)}`;

const sortPrimaryImages = (left: any, right: any): number => {
  if (Boolean(left.LA_ANH_CHINH) !== Boolean(right.LA_ANH_CHINH)) {
    return Boolean(left.LA_ANH_CHINH) ? -1 : 1;
  }
  return String(left.HINH_ANH_ID || '').localeCompare(String(right.HINH_ANH_ID || ''), 'vi');
};

export const getAllCarts = async (_req: Request, res: Response) => {
  try {
    const cartCollection = await getCollection<any>('GIO_HANG');
    const carts = await cartCollection.find({}).sort({ NGAY_TAO: -1 }).toArray();
    return res.status(200).json(carts);
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

const getOrCreateCart = async (customerId: string): Promise<string> => {
  const cartCollection = await getCollection<any>('GIO_HANG');
  const existing = await cartCollection.findOne(
    { KHACH_HANG_ID: customerId },
    { sort: { NGAY_TAO: -1 } },
  );

  if (existing?.GIO_HANG_ID) {
    return existing.GIO_HANG_ID;
  }

  let cartId = createCartId();
  while (await cartCollection.findOne({ GIO_HANG_ID: cartId })) {
    cartId = createCartId();
  }

  await cartCollection.insertOne({
    _id: cartId,
    GIO_HANG_ID: cartId,
    KHACH_HANG_ID: customerId,
    NGAY_TAO: new Date(),
  });

  return cartId;
};

const buildCartItems = async (cartId: string) => {
  const detailCollection = await getCollection<any>('GIO_HANG_CHI_TIET');
  const productCollection = await getCollection<any>('SAN_PHAM');
  const topicCollection = await getCollection<any>('CHU_DE');
  const imageCollection = await getCollection<any>('HINH_ANH_SAN_PHAM');

  const details = await detailCollection.find({ GIO_HANG_ID: cartId }).toArray();
  const productIds = details.map((item) => item.SAN_PHAM_ID).filter(Boolean);

  if (productIds.length === 0) {
    return [];
  }

  const [products, topics, images] = await Promise.all([
    productCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
    topicCollection.find({}).toArray(),
    imageCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
  ]);

  const detailMap = new Map(details.map((item) => [item.SAN_PHAM_ID, item]));
  const topicMap = new Map(topics.map((topic) => [topic.CHU_DE_ID, topic]));
  const imageMap = new Map<string, any>();

  for (const image of images.sort(sortPrimaryImages)) {
    if (!imageMap.has(image.SAN_PHAM_ID)) {
      imageMap.set(image.SAN_PHAM_ID, image);
    }
  }

  return products
    .map((product) => {
      const detail = detailMap.get(product.SAN_PHAM_ID);
      const topic = topicMap.get(product.CHU_DE_ID);
      const image = imageMap.get(product.SAN_PHAM_ID);
      return {
        SAN_PHAM_ID: product.SAN_PHAM_ID,
        TEN_SAN_PHAM: product.TEN_SAN_PHAM,
        GIA: product.GIA,
        GIA_KHUYEN_MAI: product.GIA_KHUYEN_MAI,
        SO_LUONG_TON: product.SO_LUONG,
        KIEU_DANG: product.KIEU_DANG,
        CHU_DE_ID: product.CHU_DE_ID,
        TEN_CHU_DE: topic?.TEN_CHU_DE || null,
        SO_LUONG: detail?.SO_LUONG || 1,
        HINH_ANH: image?.URL || null,
      };
    })
    .sort((left, right) => String(left.TEN_SAN_PHAM || '').localeCompare(String(right.TEN_SAN_PHAM || ''), 'vi'));
};

export const getCartByCustomer = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || '');

    if (!customerId) {
      return res.status(400).json({ message: 'Thiếu customerId.' });
    }

    const cartId = await getOrCreateCart(customerId);
    const items = await buildCartItems(cartId);

    return res.status(200).json({ cartId, items });
  } catch (error: any) {
    console.error('Lỗi lấy giỏ hàng theo khách hàng:', error);
    return res.status(500).json({ message: 'Không thể lấy giỏ hàng.' });
  }
};

export const addCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.body.customerId || '');
    const productId = String(req.body.productId || '');
    const quantity = Math.max(1, Number(req.body.quantity || 1));

    if (!customerId || !productId) {
      return res.status(400).json({ message: 'Thiếu customerId hoặc productId.' });
    }

    if (!productId.startsWith('SP')) {
      return res.status(400).json({ message: 'GIO_HANG_CHI_TIET chỉ nhận SAN_PHAM_ID.' });
    }

    const productCollection = await getCollection<any>('SAN_PHAM');
    const product = await productCollection.findOne({ SAN_PHAM_ID: productId }, { projection: { SAN_PHAM_ID: 1 } });

    if (!product) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    }

    const cartId = await getOrCreateCart(customerId);
    const detailCollection = await getCollection<any>('GIO_HANG_CHI_TIET');
    await detailCollection.updateOne(
      { GIO_HANG_ID: cartId, SAN_PHAM_ID: productId },
      {
        $setOnInsert: { _id: { GIO_HANG_ID: cartId, SAN_PHAM_ID: productId } },
        $inc: { SO_LUONG: quantity },
      },
      { upsert: true },
    );

    return res.status(200).json({
      message: 'Đã lưu sản phẩm vào giỏ hàng.',
      cartId,
    });
  } catch (error: any) {
    console.error('Lỗi thêm sản phẩm vào giỏ hàng:', error);
    return res.status(500).json({ message: 'Không thể thêm sản phẩm vào giỏ hàng.' });
  }
};

export const updateCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.body.customerId || '');
    const productId = String(req.body.productId || '');
    const quantity = Math.max(1, Number(req.body.quantity || 1));

    if (!customerId || !productId) {
      return res.status(400).json({ message: 'Thiếu customerId hoặc productId.' });
    }

    const cartId = await getOrCreateCart(customerId);
    const detailCollection = await getCollection<any>('GIO_HANG_CHI_TIET');
    await detailCollection.updateOne(
      { GIO_HANG_ID: cartId, SAN_PHAM_ID: productId },
      {
        $set: { SO_LUONG: quantity },
        $setOnInsert: { _id: { GIO_HANG_ID: cartId, SAN_PHAM_ID: productId } },
      },
      { upsert: true },
    );

    return res.status(200).json({ message: 'Đã cập nhật số lượng.' });
  } catch (error: any) {
    console.error('Lỗi cập nhật giỏ hàng:', error);
    return res.status(500).json({ message: 'Không thể cập nhật giỏ hàng.' });
  }
};

export const removeCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.body.customerId || '');
    const productId = String(req.body.productId || '');

    if (!customerId || !productId) {
      return res.status(400).json({ message: 'Thiếu customerId hoặc productId.' });
    }

    const cartId = await getOrCreateCart(customerId);
    const detailCollection = await getCollection<any>('GIO_HANG_CHI_TIET');
    await detailCollection.deleteOne({ GIO_HANG_ID: cartId, SAN_PHAM_ID: productId });

    return res.status(200).json({ message: 'Đã xóa sản phẩm khỏi giỏ hàng.' });
  } catch (error: any) {
    console.error('Lỗi xóa sản phẩm khỏi giỏ hàng:', error);
    return res.status(500).json({ message: 'Không thể xóa sản phẩm khỏi giỏ hàng.' });
  }
};
