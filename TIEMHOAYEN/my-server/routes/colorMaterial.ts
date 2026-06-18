import express from 'express';
import { getAllColorMaterials } from '../controllers/colorMaterial.js';

const router = express.Router();
router.get('/', getAllColorMaterials);

export default router;
