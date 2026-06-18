import express from 'express';
import { getAllProductImages } from '../controllers/productImage.js';

const router = express.Router();
router.get('/', getAllProductImages);

export default router;
