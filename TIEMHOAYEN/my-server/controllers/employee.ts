import { endpoint } from '../services/auth.service.js';
import { getCollection } from '../mongo.js';
export const getAllEmployees = endpoint(async (_req, res) => {
  res.json(await (await getCollection('NHAN_VIEN')).find({}, { projection: { MAT_KHAU: 0 } }).toArray());
});
