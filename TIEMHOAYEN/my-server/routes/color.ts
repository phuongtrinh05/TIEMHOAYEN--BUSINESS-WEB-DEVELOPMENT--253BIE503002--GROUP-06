import express from 'express';
import { getAllColors } from '../controllers/color.js';

const router = express.Router();
router.get('/', getAllColors);

export default router;
