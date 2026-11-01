import express from 'express';
import { getAdminRolePermissions, loginAdminEmployee } from '../controllers/rolePermission.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';
import {getCollection} from '../mongo.js';
import {createHash} from 'node:crypto';

const router = express.Router();

router.post('/auth/login', loginAdminEmployee);
router.post('/auth/logout',async(req,res)=>{const token=String(req.headers['x-admin-session']||'');if(/^as_[a-f0-9]{64}$/.test(token))await (await getCollection<any>('PHIEN_DANG_NHAP_ADMIN')).deleteOne({_id:createHash('sha256').update(token).digest('hex')});res.json({message:'Đã đăng xuất.'});});
router.get('/role-permissions', requireAdminPermission('permissions', 'view'), getAdminRolePermissions);

export default router;
