import express from 'express';
import { getAllExportSlips } from '../controllers/exportSlip.js';

const router = express.Router();
router.get('/', getAllExportSlips);

export default router;
