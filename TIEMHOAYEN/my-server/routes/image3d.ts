import express from 'express';
import { getAllImage3Ds } from '../controllers/image3d.js';

const router = express.Router();
router.get('/', getAllImage3Ds);

export default router;
