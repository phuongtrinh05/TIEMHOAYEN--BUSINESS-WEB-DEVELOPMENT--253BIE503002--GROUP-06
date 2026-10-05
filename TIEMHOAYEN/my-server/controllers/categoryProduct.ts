import { Request, Response } from 'express';
import { getCollection } from '../mongo.js';

const uniqueJoin = (values: unknown[]): string | null => {
  const normalized = Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
  return normalized.length > 0 ? normalized.join('|') : null;
};

const sortPrimaryImages = (left: any, right: any): number => {
  if (Boolean(left.LA_ANH_CHINH) !== Boolean(right.LA_ANH_CHINH)) {
    return Boolean(left.LA_ANH_CHINH) ? -1 : 1;
  }
  return String(left.HINH_ANH_ID || '').localeCompare(String(right.HINH_ANH_ID || ''), 'vi');
};

const getPrimaryImageMap = async (productIds: string[]) => {
  const imageCollection = await getCollection<any>('HINH_ANH_SAN_PHAM');
  const images = await imageCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray();
  const imageMap = new Map<string, any>();

  for (const image of images.sort(sortPrimaryImages)) {
    if (!imageMap.has(image.SAN_PHAM_ID)) {
      imageMap.set(image.SAN_PHAM_ID, image);
    }
  }

  return imageMap;
};

const buildNameListMap = async (
  relationCollectionName: string,
  lookupCollectionName: string,
  relationIdField: string,
  nameField: string,
  productIds: string[],
) => {
  const relationCollection = await getCollection<any>(relationCollectionName);
  const lookupCollection = await getCollection<any>(lookupCollectionName);
  const [relations, lookups] = await Promise.all([
    relationCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
    lookupCollection.find({}).toArray(),
  ]);
  const lookupMap = new Map(lookups.map((item) => [item[relationIdField], item[nameField]]));
  const valueMap = new Map<string, string[]>();

  for (const relation of relations) {
    const productId = relation.SAN_PHAM_ID;
    const name = lookupMap.get(relation[relationIdField]);
    if (!productId || !name) continue;
    valueMap.set(productId, [...(valueMap.get(productId) || []), name]);
  }

  return new Map(Array.from(valueMap.entries()).map(([productId, values]) => [productId, uniqueJoin(values)]));
};

const enrichProducts = async (products: any[], extraByProduct = new Map<string, any>()) => {
  const productIds = products.map((product) => product.SAN_PHAM_ID).filter(Boolean);
  const topicCollection = await getCollection<any>('CHU_DE');
  const [topics, imageMap, flowerListMap, targetListMap, colorListMap] = await Promise.all([
    topicCollection.find({}).toArray(),
    getPrimaryImageMap(productIds),
    buildNameListMap('HOA_TUOI_SAN_PHAM', 'HOA_TUOI', 'HOA_TUOI_ID', 'TEN_HOA_TUOI', productIds),
    buildNameListMap('DOI_TUONG_SAN_PHAM', 'DOI_TUONG', 'DOI_TUONG_ID', 'TEN_DOI_TUONG', productIds),
    buildNameListMap('MAU_SAC_SAN_PHAM', 'MAU_SAC', 'MAU_SAC_ID', 'TEN_MAU_SAC', productIds),
  ]);
  const topicMap = new Map(topics.map((topic) => [topic.CHU_DE_ID, topic]));

  return products.map((product) => {
    const topic = topicMap.get(product.CHU_DE_ID);
    const image = imageMap.get(product.SAN_PHAM_ID);
    return {
      SAN_PHAM_ID: product.SAN_PHAM_ID,
      CHU_DE_ID: product.CHU_DE_ID,
      TEN_CHU_DE: topic?.TEN_CHU_DE || null,
      ...extraByProduct.get(product.SAN_PHAM_ID),
      TEN_SAN_PHAM: product.TEN_SAN_PHAM,
      MO_TA: product.MO_TA,
      GIA: product.GIA,
      GIA_KHUYEN_MAI: product.GIA_KHUYEN_MAI,
      TRANG_THAI: product.TRANG_THAI,
      KIEU_DANG: product.KIEU_DANG,
      SO_LUONG: product.SO_LUONG,
      DA_BAN: product.DA_BAN,
      HINH_ANH: image?.URL || null,
      TEN_HOA_TUOI_LIST: flowerListMap.get(product.SAN_PHAM_ID) || null,
      TEN_DOI_TUONG_LIST: targetListMap.get(product.SAN_PHAM_ID) || null,
      TEN_MAU_SAC_LIST: colorListMap.get(product.SAN_PHAM_ID) || null,
    };
  });
};

const getProductsByIds = async (productIds: string[]) => {
  if (productIds.length === 0) return [];
  const productCollection = await getCollection<any>('SAN_PHAM');
  const products = await productCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray();
  const orderMap = new Map(productIds.map((id, index) => [id, index]));
  return products.sort((left, right) => (orderMap.get(left.SAN_PHAM_ID) ?? 0) - (orderMap.get(right.SAN_PHAM_ID) ?? 0));
};

export const getAllCategoryProducts = async (_req: Request, res: Response) => {
  try {
    const productCollection = await getCollection<any>('SAN_PHAM');
    const products = await productCollection.find({}).toArray();
    const sortedProducts = products.sort((left, right) => String(right.SAN_PHAM_ID || '').localeCompare(String(left.SAN_PHAM_ID || ''), 'vi'));
    const enriched = await enrichProducts(sortedProducts);

    return res.status(200).json({
      total: enriched.length,
      products: enriched,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

export const getProductsByTopic = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [topicCollection, productCollection] = await Promise.all([
      getCollection<any>('CHU_DE'),
      getCollection<any>('SAN_PHAM'),
    ]);
    const topic = await topicCollection.findOne({ CHU_DE_ID: id });

    if (!topic) {
      return res.status(404).json({ message: 'Không tìm thấy chủ đề' });
    }

    const products = await productCollection.find({ CHU_DE_ID: id }).toArray();
    const enriched = await enrichProducts(products);

    return res.status(200).json({
      topic,
      total: enriched.length,
      products: enriched,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

export const getProductsByFlower = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [flowerCollection, relationCollection] = await Promise.all([
      getCollection<any>('HOA_TUOI'),
      getCollection<any>('HOA_TUOI_SAN_PHAM'),
    ]);
    const flower = await flowerCollection.findOne({ HOA_TUOI_ID: id });

    if (!flower) {
      return res.status(404).json({ message: 'Không tìm thấy hoa tươi' });
    }

    const relations = await relationCollection.find({ HOA_TUOI_ID: id }).toArray();
    const products = await getProductsByIds(relations.map((relation) => relation.SAN_PHAM_ID));
    const extra = new Map(products.map((product) => [product.SAN_PHAM_ID, {
      HOA_TUOI_ID: flower.HOA_TUOI_ID,
      TEN_HOA_TUOI: flower.TEN_HOA_TUOI,
    }]));
    const enriched = await enrichProducts(products, extra);

    return res.status(200).json({
      flower,
      total: enriched.length,
      products: enriched,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

export const getProductsByStyle = async (req: Request, res: Response) => {
  try {
    const decodedStyle = decodeURIComponent(req.params.style);
    const productCollection = await getCollection<any>('SAN_PHAM');
    const products = (await productCollection.find({}).toArray())
      .filter((product) => String(product.KIEU_DANG || '').trim().toLowerCase() === decodedStyle.trim().toLowerCase());
    const enriched = await enrichProducts(products);

    return res.status(200).json({
      style: { KIEU_DANG: decodedStyle },
      total: enriched.length,
      products: enriched,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

export const getProductsByTarget = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [targetCollection, relationCollection] = await Promise.all([
      getCollection<any>('DOI_TUONG'),
      getCollection<any>('DOI_TUONG_SAN_PHAM'),
    ]);
    const target = await targetCollection.findOne({ DOI_TUONG_ID: id });

    if (!target) {
      return res.status(404).json({ message: 'Không tìm thấy đối tượng' });
    }

    const relations = await relationCollection.find({ DOI_TUONG_ID: id }).toArray();
    const products = await getProductsByIds(relations.map((relation) => relation.SAN_PHAM_ID));
    const extra = new Map(products.map((product) => [product.SAN_PHAM_ID, {
      DOI_TUONG_ID: target.DOI_TUONG_ID,
      TEN_DOI_TUONG: target.TEN_DOI_TUONG,
    }]));
    const enriched = await enrichProducts(products, extra);

    return res.status(200).json({
      target,
      total: enriched.length,
      products: enriched,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

export const getProductsByColor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [colorCollection, relationCollection] = await Promise.all([
      getCollection<any>('MAU_SAC'),
      getCollection<any>('MAU_SAC_SAN_PHAM'),
    ]);
    const color = await colorCollection.findOne({ MAU_SAC_ID: id });

    if (!color) {
      return res.status(404).json({ message: 'Không tìm thấy màu sắc' });
    }

    const relations = await relationCollection.find({ MAU_SAC_ID: id }).toArray();
    const products = await getProductsByIds(relations.map((relation) => relation.SAN_PHAM_ID));
    const extra = new Map(products.map((product) => [product.SAN_PHAM_ID, {
      MAU_SAC_ID: color.MAU_SAC_ID,
      TEN_MAU_SAC: color.TEN_MAU_SAC,
    }]));
    const enriched = await enrichProducts(products, extra);

    return res.status(200).json({
      color,
      total: enriched.length,
      products: enriched,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

export const getProductsByCollection = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [collectionCollection, relationCollection] = await Promise.all([
      getCollection<any>('BO_SUU_TAP'),
      getCollection<any>('BO_SUU_TAP_SAN_PHAM'),
    ]);
    const collection = await collectionCollection.findOne({ BO_SUU_TAP_ID: id });

    if (!collection) {
      return res.status(404).json({ message: 'Không tìm thấy bộ sưu tập' });
    }

    const relations = await relationCollection.find({ BO_SUU_TAP_ID: id }).toArray();
    const products = await getProductsByIds(relations.map((relation) => relation.SAN_PHAM_ID));
    const extra = new Map(products.map((product) => [product.SAN_PHAM_ID, {
      BO_SUU_TAP_ID: collection.BO_SUU_TAP_ID,
      TEN_BO_SUU_TAP: collection.TEN_BO_SUU_TAP,
    }]));
    const enriched = await enrichProducts(products, extra);

    return res.status(200).json({
      collection,
      total: enriched.length,
      products: enriched,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

export const getSaleProducts = async (_req: Request, res: Response) => {
  try {
    const productCollection = await getCollection<any>('SAN_PHAM');
    const products = (await productCollection.find({ TRANG_THAI: 'Đang bán' }).toArray())
      .filter((product) => Number(product.GIA_KHUYEN_MAI || 0) > 0 && Number(product.GIA_KHUYEN_MAI || 0) < Number(product.GIA || 0))
      .sort((left, right) => {
        const soldDiff = Number(right.DA_BAN || 0) - Number(left.DA_BAN || 0);
        if (soldDiff !== 0) return soldDiff;
        return Number(left.GIA_KHUYEN_MAI || 0) - Number(right.GIA_KHUYEN_MAI || 0);
      })
      .slice(0, 80);
    const enriched = await enrichProducts(products);

    return res.status(200).json({
      total: enriched.length,
      products: enriched,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

export const getBestSellerProducts = async (_req: Request, res: Response) => {
  try {
    const productCollection = await getCollection<any>('SAN_PHAM');
    const products = (await productCollection.find({ TRANG_THAI: 'Đang bán' }).toArray())
      .sort((left, right) => Number(right.DA_BAN || 0) - Number(left.DA_BAN || 0))
      .slice(0, 40);
    const enriched = await enrichProducts(products);

    return res.status(200).json({
      total: enriched.length,
      products: enriched,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};
