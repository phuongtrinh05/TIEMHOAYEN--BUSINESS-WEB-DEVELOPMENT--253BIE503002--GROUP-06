import express from 'express';
import { getSuggestedMaterials } from '../controllers/material.js';

const router = express.Router();

// Giữ nguyên endpoint cũ để frontend không phải đổi service:
// GET /api/materials/suggested
// Nhưng dữ liệu trả về hiện lấy từ bảng SAN_PHAM.
router.get('/suggested', getSuggestedMaterials);

export default router;
