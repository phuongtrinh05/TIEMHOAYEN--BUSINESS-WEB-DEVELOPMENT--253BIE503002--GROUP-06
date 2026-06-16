import express from 'express';
import { getAllReviews } from '../controllers/review.js';

const router = express.Router();
router.get('/', getAllReviews);

export default router;
