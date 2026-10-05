import { Request, Response } from 'express';
import { getCollection } from '../mongo.js';

export const createGetAllHandler = (collectionName: string, sort: Record<string, 1 | -1> = {}) => {
  return async (_req: Request, res: Response) => {
    try {
      const collection = await getCollection(collectionName);
      const data = await collection.find({}).sort(sort).toArray();
      return res.status(200).json(data);
    } catch (error: any) {
      return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
    }
  };
};
