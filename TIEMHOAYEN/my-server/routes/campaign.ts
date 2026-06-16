import express from 'express';
import { getAllCampaigns } from '../controllers/campaign.js';

const router = express.Router();
router.get('/', getAllCampaigns);

export default router;
