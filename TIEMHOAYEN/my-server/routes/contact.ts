import express from 'express';
import { requireSupportStaff } from '../controllers/support.js';
import {
  createContact,
  getAllContacts,
} from '../controllers/contact.js';

const router = express.Router();

router.get('/', requireSupportStaff, getAllContacts);
router.post('/', createContact);

export default router;
