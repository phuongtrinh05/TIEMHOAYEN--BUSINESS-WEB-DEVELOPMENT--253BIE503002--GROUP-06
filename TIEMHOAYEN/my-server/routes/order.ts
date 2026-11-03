import { readAfterSales,createAfterSales,supplementAfterSales } from '../controllers/order.js';
import express from 'express';
import { sendLookupOtp, verifyLookupOtp, requireLookup, requireLookupAction, lookupHistory, endLookup } from '../controllers/order-access.js';
import { readPublicRequest, customerRespond, listRequestMessages, postRequestMessage, customerUpdateRequest } from '../controllers/order-request.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';
import {
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

router.post('/lookup/otp', sendLookupOtp);
router.post('/lookup/verify', verifyLookupOtp);
router.get('/lookup', requireLookup, lookupHistory);
router.post('/lookup/logout', requireLookup, endLookup);
router.get('/', requireLookup, lookupHistory);
router.get('/public-vouchers', getPublicVouchers);
router.get('/card-templates', getCardTemplates);
router.post('/', createOrder);
router.post('/quote', quoteOrder);
router.get('/requests/:requestId', requireLookup, readPublicRequest);
router.post('/requests/:requestId/respond', requireLookup, requireLookupAction, customerRespond);
router.patch('/requests/:requestId', requireLookup, requireLookupAction, customerUpdateRequest);
router.get('/requests/:requestId/messages', requireLookup, listRequestMessages);
router.post('/requests/:requestId/messages', requireLookup, requireLookupAction, postRequestMessage);
router.get('/:orderId/after-sales',requireLookup,readAfterSales);
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
