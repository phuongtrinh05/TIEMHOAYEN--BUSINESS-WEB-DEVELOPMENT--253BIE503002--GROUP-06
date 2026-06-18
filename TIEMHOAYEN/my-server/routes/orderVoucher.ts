import express from 'express';
import { getAllOrderVouchers } from '../controllers/orderVoucher.js';

const router = express.Router();
router.get('/', getAllOrderVouchers);

export default router;
