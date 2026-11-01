import express from 'express';
import { ownerAccess } from '../middleware/resourceAccess.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';
import { requireIdentity } from '../services/auth.service.js';
import {
  createNotification,
  getNotifications,
  getPublicNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '../controllers/notification.js';

const router = express.Router();

router.get('/public', getPublicNotifications);
router.get('/', (req, res, next) => req.query.customerId ? ownerAccess(r => String(r.query.customerId))(req, res, next) : next(), getNotifications);
router.post('/', requireAdminPermission('customerService', 'create'), createNotification);
router.patch('/read-all/:customerId', ownerAccess(req => req.params.customerId), markAllNotificationsAsRead);
router.patch('/:id/read', requireIdentity, markNotificationAsRead);

export default router;
