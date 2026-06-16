import express from 'express';
import { getAllCarts } from '../controllers/cart.js';

const router = express.Router();
router.get('/', getAllCarts);

export default router;
