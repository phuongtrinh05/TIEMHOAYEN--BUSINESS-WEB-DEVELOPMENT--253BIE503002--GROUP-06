import express from 'express';
import { getAllCartDetails } from '../controllers/cartDetail.js';

const router = express.Router();
router.get('/', getAllCartDetails);

export default router;
