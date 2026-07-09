import express from 'express';
import { getAllBlogs, getBlogById } from '../controllers/blog.js';

const router = express.Router();
router.get('/', getAllBlogs);
router.get('/:id', getBlogById);

export default router;
