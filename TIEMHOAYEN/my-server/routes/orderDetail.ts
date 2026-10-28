import express from 'express';
import { requireSales } from '../controllers/order-request.js';
import { getAllOrderDetails } from '../controllers/orderDetail.js';

const router = express.Router();
router.get('/', requireSales, getAllOrderDetails);

export default router;
