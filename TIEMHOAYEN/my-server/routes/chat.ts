import express from 'express';
import { sendChat } from '../controllers/chat.js';

const router = express.Router();

router.post('/', sendChat);

export default router;
