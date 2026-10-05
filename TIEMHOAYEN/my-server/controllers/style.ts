import { Request, Response } from 'express';
import { getCollection } from '../mongo.js';

export const getAllStyles = async (req: Request, res: Response) => {
  try {
    const productCollection = await getCollection('SAN_PHAM');
    const styles = await productCollection.distinct('KIEU_DANG', {
      KIEU_DANG: { $nin: [null, ''] },
    });

    res.status(200).json(
      styles
        .sort((a: string, b: string) => String(a || '').localeCompare(String(b || ''), 'vi'))
        .map((KIEU_DANG: string) => ({ KIEU_DANG })),
    );
  } catch (error: any) {
    res.status(500).json({
      message: 'Lỗi Controller: ' + error.message
    });
  }
};
