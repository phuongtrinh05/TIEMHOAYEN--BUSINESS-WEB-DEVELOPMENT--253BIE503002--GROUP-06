import express from 'express';
import { getAllColorProducts } from '../controllers/colorProduct.js';

const router = express.Router();
router.get('/', getAllColorProducts);

export default router;
