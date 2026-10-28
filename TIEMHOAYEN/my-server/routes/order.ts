import express from 'express';
import { sendLookupOtp, verifyLookupOtp, requireLookup, lookupHistory, endLookup } from '../controllers/order-access.js';
import { readPublicRequest, customerRespond, listRequestMessages, postRequestMessage, customerUpdateRequest } from '../controllers/order-request.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';
import {
  getPublicVouchers,
  createOrder,
  getOrderDetail,
  getOrderPaymentStatus,
  expireOrderPayment,
  markOrderPaymentSuccess,
  retryOrderPayment,
  cancelOrder,
  requestReturnRefund,
  updateShippingInfo,
} from '../controllers/order.js';

const router = express.Router();

router.post('/lookup/otp', sendLookupOtp);
router.post('/lookup/verify', verifyLookupOtp);
router.get('/lookup', requireLookup, lookupHistory);
router.post('/lookup/logout', requireLookup, endLookup);
router.get('/', requireLookup, lookupHistory);
router.get('/public-vouchers', getPublicVouchers);
router.post('/', createOrder);
router.get('/requests/:requestId', requireLookup, readPublicRequest);
router.post('/requests/:requestId/respond', requireLookup, customerRespond);
router.patch('/requests/:requestId', requireLookup, customerUpdateRequest);
router.get('/requests/:requestId/messages', requireLookup, listRequestMessages);
router.post('/requests/:requestId/messages', requireLookup, postRequestMessage);
router.get('/:orderId/detail', requireLookup, getOrderDetail);
router.get('/:orderId/payment-status', requireLookup, getOrderPaymentStatus);
router.put('/:orderId/payment-expired', requireLookup, expireOrderPayment);
router.put('/:orderId/payment-success', requireAdminPermission('payments', 'update'), markOrderPaymentSuccess);
router.put('/:orderId/payment-retry', requireLookup, retryOrderPayment);
router.put('/:orderId/cancel', requireLookup, cancelOrder);
router.put('/:orderId/return-refund', requireLookup, requestReturnRefund);
router.put('/:orderId/shipping', requireLookup, updateShippingInfo);
export default router;
