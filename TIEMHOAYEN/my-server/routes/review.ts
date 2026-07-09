import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import {
  createReview,
  getProductReviews,
  getReviewableOrdersForCustomer,
  getCustomerReviewHistory,
  getGuestReviewHistory,
  lookupGuestOrderForReview,
  replyToReview,
} from '../controllers/review.js';

const router = express.Router();

const reviewUploadDir = 'uploads/reviews';

fs.mkdirSync(reviewUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, reviewUploadDir);
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const safeName = `review-${Date.now()}-${Math.round(Math.random() * 1_000_000)}${extension}`;

    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 5,
  },
  fileFilter: (_req, file, cb) => {
    const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!acceptedTypes.includes(file.mimetype)) {
      cb(new Error('Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP.'));
      return;
    }

    cb(null, true);
  },
});

router.get('/customer/:customerId/reviewable-orders', getReviewableOrdersForCustomer);
router.get('/customer/:customerId/history', getCustomerReviewHistory);
router.post('/guest/lookup', lookupGuestOrderForReview);
router.post('/guest/history', getGuestReviewHistory);
router.get('/product/:productId', getProductReviews);
router.patch('/:reviewId/reply', replyToReview);
router.post('/', upload.array('images', 5), createReview);

export default router;
