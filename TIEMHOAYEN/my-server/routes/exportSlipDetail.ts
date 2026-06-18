import express from 'express';
import { getAllExportSlipDetails } from '../controllers/exportSlipDetail.js';

const router = express.Router();
router.get('/', getAllExportSlipDetails);

export default router;
