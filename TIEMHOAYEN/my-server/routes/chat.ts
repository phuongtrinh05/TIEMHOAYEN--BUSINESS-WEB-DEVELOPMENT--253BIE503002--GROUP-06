import express from 'express';
import {
  getAdminChatConversations,
  getChatImage,
  getCustomerChatMessages,
  getGuestChatMessages,
  replyAdminChat,
  saveHandoffChat,
  sendChat
} from '../controllers/chat.js';

const router = express.Router();

router.get('/admin/conversations', getAdminChatConversations);
router.post('/admin/conversations/:conversationId/replies', replyAdminChat);
router.get('/image/:chatId', getChatImage);
router.get('/customer/:customerId/messages', getCustomerChatMessages);
router.get('/guest/:chatId/messages', getGuestChatMessages);
router.post('/handoff', saveHandoffChat);
router.post('/', sendChat);

export default router;
