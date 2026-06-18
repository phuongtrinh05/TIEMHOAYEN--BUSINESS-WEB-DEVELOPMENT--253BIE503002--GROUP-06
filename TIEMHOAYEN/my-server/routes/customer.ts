import express from 'express';
import { getAllCustomers, registerCustomer } from '../controllers/customer.js';

const router = express.Router();

router.get('/', getAllCustomers);
router.post('/', registerCustomer);

export default router;