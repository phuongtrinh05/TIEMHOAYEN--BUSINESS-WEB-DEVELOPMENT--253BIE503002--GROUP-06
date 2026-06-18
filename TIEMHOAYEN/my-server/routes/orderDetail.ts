import express from 'express';
import { getAllOrderDetails } from '../controllers/orderDetail.js';

const router = express.Router();
router.get('/', getAllOrderDetails);

export default router;
