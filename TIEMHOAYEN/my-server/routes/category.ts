import express from 'express';
import { getAllCategorys } from '../controllers/category.js';

const router = express.Router();
router.get('/', getAllCategorys);

export default router;
