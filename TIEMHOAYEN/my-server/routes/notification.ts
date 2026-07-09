import express from 'express';
import {
  createNotification,
  getNotifications,
  getPublicNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '../controllers/notification.js';

const router = express.Router();

router.get('/public', getPublicNotifications);
router.get('/', getNotifications);
router.post('/', createNotification);
router.patch('/read-all/:customerId', markAllNotificationsAsRead);
router.patch('/:id/read', markNotificationAsRead);

export default router;
