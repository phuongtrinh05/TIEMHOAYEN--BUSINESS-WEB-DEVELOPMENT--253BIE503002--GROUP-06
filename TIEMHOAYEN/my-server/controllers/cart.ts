import {getDesign,isDesignProduct} from '../services/design3d.service.js';
import { Request, Response } from 'express';
import { getCollection } from '../mongo.js';
import { getProductSellableStockMap, sellableStockFields } from '../services/inventory/availability.service.js';
import { checkProductAvailability } from '../services/inventory/availability.service.js';
import { InventoryError } from '../services/inventory/helpers.js';
import { createHash } from 'node:crypto';

const createCartId = (): string => `GH${Date.now().toString().slice(-8)}`;
const cartLine = (body: any) => {
  const productId = String(body.productId || '');
  const configuration = body.configuration && typeof body.configuration === 'object' ? body.configuration : {};
  const variantId = body.variantId ? String(body.variantId) : null;
  const designId = body.designId ? String(body.designId) : null;
  const generated = `${productId}:${createHash('sha256').update(JSON.stringify({ variantId, designId, configuration })).digest('hex').slice(0, 16)}`;
  const lineKey = /^[\w:.-]{3,120}$/.test(String(body.lineKey || '')) ? String(body.lineKey) : generated;
  return { productId, lineKey, variantId, designId, configuration };
};

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
  const stockMap = await getProductSellableStockMap(products);

  const productMap = new Map(products.map((item) => [item.SAN_PHAM_ID, item]));
  const topicMap = new Map(topics.map((topic) => [topic.CHU_DE_ID, topic]));
  const imageMap = new Map<string, any>();

  for (const image of images.sort(sortPrimaryImages)) {
    if (!imageMap.has(image.SAN_PHAM_ID)) {
      imageMap.set(image.SAN_PHAM_ID, image);
    }
  }

  const designItems: any[] = [];
  for(const detail of details.filter(d=>isDesignProduct(String(d.SAN_PHAM_ID)))) {
    const design=await getDesign(detail.SAN_PHAM_ID);
    const quantity=Number(detail.SO_LUONG || 1);
    const short=design.materials.some((l:any)=>l.quantity*quantity>l.available);
    designItems.push({SAN_PHAM_ID:detail.SAN_PHAM_ID,THIET_KE_3D_ID:design.designId,TEN_SAN_PHAM:design.name,GIA:design.price,SO_LUONG:quantity,
      KIEU_DANG:'Thiết kế 3D',HINH_ANH:design.image,SO_LUONG_TON:null,CAN_SHOP_DUYET:design.requiresReview || short,BADGES:[...design.badges,...(short?['Số bó vượt NVL khả dụng']:[])]});
  }
  const mapped = await Promise.all(details.filter(detail => !isDesignProduct(String(detail.SAN_PHAM_ID))).map(async (detail) => {
      const product = productMap.get(detail.SAN_PHAM_ID);
      if (!product) return null;
      const topic = topicMap.get(product.CHU_DE_ID);
      const image = imageMap.get(product.SAN_PHAM_ID);
      const stock = stockMap.get(String(product.SAN_PHAM_ID));
      return {
        SAN_PHAM_ID: product.SAN_PHAM_ID,
        LINE_KEY: detail.LINE_KEY || product.SAN_PHAM_ID,
        BIEN_THE_ID: detail.BIEN_THE_ID || null,
        THIET_KE_ID: detail.THIET_KE_ID || null,
        CAU_HINH: detail.CAU_HINH || {},
        TEN_SAN_PHAM: product.TEN_SAN_PHAM,
        GIA: product.GIA,
        GIA_KHUYEN_MAI: product.GIA_KHUYEN_MAI,
        ...sellableStockFields(stock),
        SO_LUONG_TON: stock?.sellable ?? 0,
        KIEU_DANG: product.KIEU_DANG,
        CHU_DE_ID: product.CHU_DE_ID,
        TEN_CHU_DE: topic?.TEN_CHU_DE || null,
        SO_LUONG: detail?.SO_LUONG || 1,
        HINH_ANH: image?.URL || null,
        TRANG_THAI: product.TRANG_THAI,
        GIA_DA_THAY_DOI: Number(detail.GIA_LUC_THEM) > 0 && Number(detail.GIA_LUC_THEM) !== Number(product.GIA_KHUYEN_MAI || product.GIA || 0),
        GIA_LUC_THEM: Number(detail.GIA_LUC_THEM || 0),
      };
    }));
  return [...designItems, ...mapped.filter(Boolean)].sort((left: any, right: any) => String(left.TEN_SAN_PHAM || '').localeCompare(String(right.TEN_SAN_PHAM || ''), 'vi'));
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
    const { productId, lineKey, variantId, designId, configuration } = cartLine(req.body);
    const quantity = Number(req.body.quantity);

    if (!customerId || !productId) {
      return res.status(400).json({ message: 'Thiếu customerId hoặc productId.' });
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) return res.status(400).json({ message: 'Số lượng phải là số nguyên từ 1–1000.' });

    if (!productId.startsWith('SP')) {
      return res.status(400).json({ message: 'GIO_HANG_CHI_TIET chỉ nhận SAN_PHAM_ID.' });
    }

    const productCollection = await getCollection<any>('SAN_PHAM');
    const product = await productCollection.findOne({ SAN_PHAM_ID: productId, TRANG_THAI: 'Đang bán' });

    const design = isDesignProduct(productId) ? await getDesign(productId) : null;
    if (!design && !product) {
      return res.status(409).json({ message: 'Sản phẩm đã ngừng bán, bị xóa hoặc không còn hiệu lực.' });
    }
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)return res.status(400).json({message:'Số bó phải là số nguyên từ 1–1000.'});

    const cartId = await getOrCreateCart(customerId);
    const detailCollection = await getCollection<any>('GIO_HANG_CHI_TIET');
    const lineFilter = { GIO_HANG_ID: cartId, $or: [{ LINE_KEY: lineKey }, { SAN_PHAM_ID: productId, LINE_KEY: { $exists: false } }] };
    const existing = await detailCollection.findOne(lineFilter);
    const totalQuantity = Number(existing?.SO_LUONG || 0) + quantity;
    if (totalQuantity > 1000) return res.status(400).json({ message: 'Tổng số lượng trong giỏ không được vượt quá 1000.' });
    const availability = await checkProductAvailability(productId, totalQuantity, null);
    await detailCollection.updateOne(
      lineFilter,
      {
        $set: { LINE_KEY: lineKey },
        $setOnInsert: {
          _id: { GIO_HANG_ID: cartId, LINE_KEY: lineKey },
          SAN_PHAM_ID: productId,
          ...(design ? { THIET_KE_3D_ID: design.designId } : {}),
          BIEN_THE_ID: variantId,
          THIET_KE_ID: designId,
          CAU_HINH: configuration,
          GIA_LUC_THEM: Number(design?.price || product?.GIA_KHUYEN_MAI || product?.GIA || 0),
        },
        $inc: { SO_LUONG: quantity },
      },
      { upsert: true },
    );

    return res.status(200).json({
      message: 'Đã lưu sản phẩm vào giỏ hàng.',
      cartId,
      availability,
    });
  } catch (error: any) {
    console.error('Lỗi thêm sản phẩm vào giỏ hàng:', error);
    if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message, details: error.details });
    return res.status(500).json({ message: 'Không thể thêm sản phẩm vào giỏ hàng.' });
  }
};

export const updateCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.body.customerId || '');
    const { productId, lineKey } = cartLine(req.body);
    const quantity = Number(req.body.quantity);

    if (!customerId || !productId) {
      return res.status(400).json({ message: 'Thiếu customerId hoặc productId.' });
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) return res.status(400).json({ message: 'Số lượng phải là số nguyên từ 1–1000.' });
    const availability = await checkProductAvailability(productId, quantity, null);

    const cartId = await getOrCreateCart(customerId);
    const detailCollection = await getCollection<any>('GIO_HANG_CHI_TIET');
    await detailCollection.updateOne(
      { GIO_HANG_ID: cartId, $or: [{ LINE_KEY: lineKey }, ...(!req.body.lineKey ? [{ SAN_PHAM_ID: productId }] : [])] },
      {
        $set: { SO_LUONG: quantity },
        $setOnInsert: { _id: { GIO_HANG_ID: cartId, LINE_KEY: lineKey }, SAN_PHAM_ID: productId, LINE_KEY: lineKey },
      },
      { upsert: true },
    );

    return res.status(200).json({ message: 'Đã cập nhật số lượng.', availability });
  } catch (error: any) {
    console.error('Lỗi cập nhật giỏ hàng:', error);
    if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message, details: error.details });
    return res.status(500).json({ message: 'Không thể cập nhật giỏ hàng.' });
  }
};

export const removeCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.body.customerId || '');
    const { productId, lineKey } = cartLine(req.body);

    if (!customerId || !productId) {
      return res.status(400).json({ message: 'Thiếu customerId hoặc productId.' });
    }

    const cartId = await getOrCreateCart(customerId);
    const detailCollection = await getCollection<any>('GIO_HANG_CHI_TIET');
    await detailCollection.deleteOne({ GIO_HANG_ID: cartId, $or: [{ LINE_KEY: lineKey }, ...(!req.body.lineKey ? [{ SAN_PHAM_ID: productId }] : [])] });

    return res.status(200).json({ message: 'Đã xóa sản phẩm khỏi giỏ hàng.' });
  } catch (error: any) {
    console.error('Lỗi xóa sản phẩm khỏi giỏ hàng:', error);
    return res.status(500).json({ message: 'Không thể xóa sản phẩm khỏi giỏ hàng.' });
  }
};
