import express from 'express';
import { getAllAddresss } from '../controllers/address.js';

const router = express.Router();
router.get('/', getAllAddresss);

export default router;
