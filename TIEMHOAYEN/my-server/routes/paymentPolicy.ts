import express from 'express';
import { getAllPaymentPolicys } from '../controllers/paymentPolicy.js';

const router = express.Router();
router.get('/', getAllPaymentPolicys);

export default router;
