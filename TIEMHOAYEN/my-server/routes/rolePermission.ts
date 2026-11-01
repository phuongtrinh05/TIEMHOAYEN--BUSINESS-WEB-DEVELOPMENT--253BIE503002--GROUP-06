import express from 'express';
import { getAdminRolePermissions, loginAdminEmployee } from '../controllers/rolePermission.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';
import { employeeLogin } from './auth.js';

const router = express.Router();

router.post('/auth/login', employeeLogin);
router.get('/role-permissions', requireAdminPermission('permissions', 'view'), getAdminRolePermissions);

export default router;
