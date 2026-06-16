import express from 'express';
import { getAllTargetProducts } from '../controllers/targetProduct.js';

const router = express.Router();
router.get('/', getAllTargetProducts);

export default router;
