import {getCollection} from '../mongo.js';
import express from 'express';
import { requireSupportStaff } from '../controllers/support.js';
import {
    createFAQ,
    deleteFAQ,
    getAllFAQs,
    getFAQById,
    updateFAQ,
} from '../controllers/faq.js';

const router = express.Router();
router.get('/public',async(_req,res)=>{try{res.json(await(await getCollection('CAU_HOI_CO_SAN')).find({TRANG_THAI:'Hoạt động'},{projection:{_id:0,CAU_HOI:1,CAU_TRA_LOI:1,CAU_HOI_ID:1}}).limit(100).toArray());}catch{res.status(500).json({message:'Chưa tải được FAQ.'});}});

router.get('/', getAllFAQs);
router.post('/', requireSupportStaff, createFAQ);
router.get('/:id', getFAQById);
router.put('/:id', requireSupportStaff, updateFAQ);
router.delete('/:id', requireSupportStaff, deleteFAQ);

export default router;
