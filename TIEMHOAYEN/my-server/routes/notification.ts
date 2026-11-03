import express from 'express';
import { requireLookup } from '../controllers/order-access.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';
import {
  createNotification,
  getNotifications,
  getPublicNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '../controllers/notification.js';

const router = express.Router();

router.get('/public', getPublicNotifications);
router.get('/', requireLookup, getNotifications);
router.post('/', requireAdminPermission('orders', 'update'), createNotification);
router.patch('/read-all/:customerId', requireLookup, markAllNotificationsAsRead);
router.patch('/:id/read', requireLookup, markNotificationAsRead);

export default router;
