import express from 'express';
import { getAllPayments } from '../controllers/payment.js';

const router = express.Router();
router.get('/', getAllPayments);

export default router;
