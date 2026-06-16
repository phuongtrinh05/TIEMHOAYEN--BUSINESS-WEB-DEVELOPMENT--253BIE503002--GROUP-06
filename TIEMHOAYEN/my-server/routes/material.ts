import express from 'express';
import { getAllMaterials } from '../controllers/material.js';

const router = express.Router();
router.get('/', getAllMaterials);

export default router;
