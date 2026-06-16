import express from 'express';
import { getAllFlowerProducts } from '../controllers/flowerProduct.js';

const router = express.Router();
router.get('/', getAllFlowerProducts);

export default router;
