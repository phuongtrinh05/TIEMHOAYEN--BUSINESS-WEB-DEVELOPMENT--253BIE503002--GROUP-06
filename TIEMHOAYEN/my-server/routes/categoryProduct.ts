import express from 'express';
import { getProductsByTopic } from '../controllers/categoryProduct.js';

const router = express.Router();

router.get('/topic/:id', getProductsByTopic);

export default router;