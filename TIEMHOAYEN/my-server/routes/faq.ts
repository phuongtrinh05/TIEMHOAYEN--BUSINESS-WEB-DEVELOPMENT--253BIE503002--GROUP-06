import express from 'express';
import { requireSupportStaff } from '../controllers/support.js';
import {
    createFAQ,
    deleteFAQ,
    getAllFAQs,
    getFAQById,
    updateFAQ,
} from '../controllers/faq.js';

const router = express.Router();

router.get('/', getAllFAQs);
router.post('/', requireSupportStaff, createFAQ);
router.get('/:id', getFAQById);
router.put('/:id', requireSupportStaff, updateFAQ);
router.delete('/:id', requireSupportStaff, deleteFAQ);

export default router;
