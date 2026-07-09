import express from 'express';
import {
  getAllProducts,
  getProductById,
  searchProducts,
} from '../controllers/product.js';

const router = express.Router();

router.get('/', getAllProducts);

// Đặt route /search trước /:id để Express không hiểu "search" là productId.
router.get('/search', searchProducts);

router.get('/:id', getProductById);

export default router;
