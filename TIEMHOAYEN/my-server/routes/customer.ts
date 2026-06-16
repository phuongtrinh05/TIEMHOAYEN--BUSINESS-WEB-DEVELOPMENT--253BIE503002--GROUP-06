import express from 'express';
import { getAllCustomers } from '../controllers/customer.js';

const router = express.Router();
router.get('/', getAllCustomers);

export default router;