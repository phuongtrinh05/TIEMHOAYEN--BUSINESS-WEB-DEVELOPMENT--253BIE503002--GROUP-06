import express from 'express';
import { getAllImageRequests } from '../controllers/imageRequest.js';

const router = express.Router();
router.get('/', getAllImageRequests);

export default router;
