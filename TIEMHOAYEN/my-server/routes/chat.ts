import express from 'express';
import { requireSupportStaff } from '../controllers/support.js';
import {
  getAdminChatConversations,
  getChatImage,
  getCustomerChatMessages,
  getGuestChatMessages,
  replyAdminChat,
  sendChat
} from '../controllers/chat.js';

const router = express.Router();

router.get('/admin/conversations', requireSupportStaff, getAdminChatConversations);
router.post('/admin/conversations/:conversationId/replies', requireSupportStaff, replyAdminChat);
router.get('/image/:chatId', requireSupportStaff, getChatImage);
router.get('/customer/:customerId/messages', requireSupportStaff, getCustomerChatMessages);
router.get('/guest/:chatId/messages', requireSupportStaff, getGuestChatMessages);
router.post('/handoff', (_req,res)=>res.status(410).json({message:'Vui lòng chuyển nhân viên trong phiên hỗ trợ mới.'}));
router.post('/', sendChat);

export default router;
