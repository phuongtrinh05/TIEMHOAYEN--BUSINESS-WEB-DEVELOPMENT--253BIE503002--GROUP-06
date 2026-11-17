import { readAfterSales,createAfterSales,supplementAfterSales,uploadAfterSalesEvidence } from '../controllers/order.js';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { sendLookupOtp, verifyLookupOtp, requireLookup, requireLookupAction, lookupHistory, endLookup, checkoutLookup } from '../controllers/order-access.js';
import { readPublicRequest, customerRespond, listRequestMessages, postRequestMessage, customerUpdateRequest, watchCustomerRequests } from '../controllers/order-request.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';
import {
  getAvailableVouchers,
  getPublicVouchers,
  createOrder,
  quoteOrder,
  getOrderDetail,
  getOrderPaymentStatus,
  expireOrderPayment,
  markOrderPaymentSuccess,
  retryOrderPayment,
  cancelOrder,
  requestReturnRefund,
  updateShippingInfo,
  getCardTemplates,
} from '../controllers/order.js';

const router = express.Router();
const afterSalesUploadDir = 'uploads/after-sales';
fs.mkdirSync(afterSalesUploadDir, { recursive: true });
const evidenceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, afterSalesUploadDir),
    filename: (_req, file, callback) => {
      const extensions: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
      callback(null, `evidence-${Date.now()}-${Math.round(Math.random() * 1_000_000)}${extensions[file.mimetype] || path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

const receiveEvidence = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  evidenceUpload.array('images', 5)(req, res, error => {
    if (error) return res.status(400).json({ message: 'Chỉ được tải tối đa 5 ảnh JPG, PNG hoặc WEBP; mỗi ảnh không quá 5 MB.' });
    next();
  });
};

router.post('/lookup/otp', sendLookupOtp);
router.post('/lookup/verify', verifyLookupOtp);
router.post('/:orderId/checkout-lookup', checkoutLookup);
router.get('/lookup', requireLookup, lookupHistory);
router.post('/lookup/logout', requireLookup, endLookup);
router.get('/', requireLookup, lookupHistory);
router.get('/public-vouchers', getPublicVouchers);
router.post('/vouchers/available', getAvailableVouchers);
router.get('/card-templates', getCardTemplates);
router.post('/', createOrder);
router.post('/quote', quoteOrder);
router.get('/request-events', requireLookup, watchCustomerRequests);
router.get('/requests/:requestId/events', requireLookup, watchCustomerRequests);
router.get('/requests/:requestId', requireLookup, readPublicRequest);
router.post('/requests/:requestId/respond', requireLookup, requireLookupAction, customerRespond);
router.patch('/requests/:requestId', requireLookup, requireLookupAction, customerUpdateRequest);
router.get('/requests/:requestId/messages', requireLookup, listRequestMessages);
router.post('/requests/:requestId/messages', requireLookup, requireLookupAction, postRequestMessage);
router.get('/:orderId/after-sales',requireLookup,readAfterSales);
router.post('/:orderId/after-sales/evidence',requireLookup,requireLookupAction,receiveEvidence,uploadAfterSalesEvidence);
router.post('/:orderId/after-sales',requireLookup,requireLookupAction,createAfterSales);
router.patch('/:orderId/after-sales/:requestId',requireLookup,requireLookupAction,supplementAfterSales);
router.get('/:orderId/detail', requireLookup, getOrderDetail);
router.get('/:orderId/payment-status', requireLookup, getOrderPaymentStatus);
router.put('/:orderId/payment-expired', requireLookup, requireLookupAction, expireOrderPayment);
router.put('/:orderId/payment-success', requireAdminPermission('payments', 'update'), markOrderPaymentSuccess);
router.put('/:orderId/payment-retry', requireLookup, requireLookupAction, retryOrderPayment);
router.put('/:orderId/cancel', requireLookup, requireLookupAction, cancelOrder);
router.put('/:orderId/return-refund', requireLookup, requireLookupAction, requestReturnRefund);
router.put('/:orderId/shipping', requireLookup, requireLookupAction, updateShippingInfo);
export default router;
