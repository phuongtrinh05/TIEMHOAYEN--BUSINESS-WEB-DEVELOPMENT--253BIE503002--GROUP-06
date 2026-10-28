import express from 'express';
import { requireSales } from '../controllers/order-request.js';
import { getAllPayments } from '../controllers/payment.js';

const router = express.Router();
router.get('/', requireSales, getAllPayments);

export default router;
