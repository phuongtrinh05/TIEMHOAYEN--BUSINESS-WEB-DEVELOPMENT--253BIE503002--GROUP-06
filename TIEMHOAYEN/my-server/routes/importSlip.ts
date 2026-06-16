import express from 'express';
import { getAllImportSlips } from '../controllers/importSlip.js';

const router = express.Router();
router.get('/', getAllImportSlips);

export default router;
