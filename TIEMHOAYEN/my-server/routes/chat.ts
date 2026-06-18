import express from 'express';
import { getAllChats } from '../controllers/chat.js';

const router = express.Router();
router.get('/', getAllChats);

export default router;
