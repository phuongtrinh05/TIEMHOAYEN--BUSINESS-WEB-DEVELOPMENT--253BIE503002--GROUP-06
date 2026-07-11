import express from 'express';
import {
    createFAQ,
    deleteFAQ,
    getAllFAQs,
    getFAQById,
    updateFAQ,
} from '../controllers/faq.js';

const router = express.Router();

router.get('/', getAllFAQs);
router.post('/', createFAQ);
router.get('/:id', getFAQById);
router.put('/:id', updateFAQ);
router.delete('/:id', deleteFAQ);

export default router;
