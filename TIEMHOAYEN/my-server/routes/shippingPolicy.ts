import express from 'express';
import { getAllShippingPolicys } from '../controllers/shippingPolicy.js';

const router = express.Router();
router.get('/', getAllShippingPolicys);

export default router;
