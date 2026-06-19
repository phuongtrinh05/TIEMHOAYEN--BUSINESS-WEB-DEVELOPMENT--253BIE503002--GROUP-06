import express from 'express';

import {
  getProductsByTopic,
  getProductsByFlower,
  getProductsByStyle,
  getProductsByTarget,
  getProductsByColor,
  getProductsByCollection,
  getSaleProducts,
  getBestSellerProducts
} from '../controllers/categoryProduct.js';

const router = express.Router();

router.get('/topic/:id', getProductsByTopic);
router.get('/flower/:id', getProductsByFlower);
router.get('/style/:style', getProductsByStyle);
router.get('/target/:id', getProductsByTarget);
router.get('/color/:id', getProductsByColor);
router.get('/collection/:id', getProductsByCollection);
router.get('/sale', getSaleProducts);
router.get('/best-seller', getBestSellerProducts);
export default router;