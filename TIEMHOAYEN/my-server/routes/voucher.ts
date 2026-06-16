import express from 'express';
import { getAllVouchers } from '../controllers/voucher.js';

const router = express.Router();
router.get('/', getAllVouchers);

export default router;
