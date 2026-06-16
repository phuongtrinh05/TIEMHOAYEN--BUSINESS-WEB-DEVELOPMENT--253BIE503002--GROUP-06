import express from 'express';
import { getAllCollectionProducts } from '../controllers/collectionProduct.js';

const router = express.Router();
router.get('/', getAllCollectionProducts);

export default router;
