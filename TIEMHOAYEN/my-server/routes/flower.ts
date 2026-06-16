import express from 'express';
import { getAllFlowers } from '../controllers/flower.js';

const router = express.Router();
router.get('/', getAllFlowers);

export default router;
