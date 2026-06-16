import express from 'express';
import { getAllImportSlipDetails } from '../controllers/importSlipDetail.js';

const router = express.Router();
router.get('/', getAllImportSlipDetails);

export default router;
