import express from 'express';
import { getAllWishlists } from '../controllers/wishlist.js';

const router = express.Router();
router.get('/', getAllWishlists);

export default router;
