import express from 'express';
import { getAllStyles } from '../controllers/style.js';

const router = express.Router();

router.get('/', getAllStyles);

export default router;