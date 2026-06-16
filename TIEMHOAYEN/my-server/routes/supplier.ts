import express from 'express';
import { getAllSuppliers } from '../controllers/supplier.js';

const router = express.Router();
router.get('/', getAllSuppliers);

export default router;
