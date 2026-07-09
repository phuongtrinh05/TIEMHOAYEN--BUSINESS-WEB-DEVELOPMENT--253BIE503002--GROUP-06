// routes/chat.ts
import express from 'express';
import { sendChat } from '../controllers/chat.js';

const router = express.Router();

// POST /api/chat
router.post('/', sendChat);

export default router;