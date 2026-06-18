import express from 'express';
import { getAllTargets } from '../controllers/target.js';

const router = express.Router();
router.get('/', getAllTargets);

export default router;
