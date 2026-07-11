import express from 'express';
import { getAdminRolePermissions, loginAdminEmployee } from '../controllers/rolePermission.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';

const router = express.Router();

router.post('/auth/login', loginAdminEmployee);
router.get('/role-permissions', requireAdminPermission('permissions', 'view'), getAdminRolePermissions);

export default router;
