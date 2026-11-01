import express from 'express';
import { orderAccess, orderCreator } from '../middleware/resourceAccess.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';
import {
  getAllOrders,
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

router.get('/', requireAdminPermission('orders', 'view'), getAllOrders);
router.get('/public-vouchers', getPublicVouchers);
router.post('/', orderCreator, createOrder);
router.use('/:orderId', orderAccess);
router.get('/:orderId/detail', getOrderDetail);
router.get('/:orderId/payment-status', getOrderPaymentStatus);
router.put('/:orderId/payment-expired', expireOrderPayment);
router.put('/:orderId/payment-success', requireAdminPermission('payments', 'update'), markOrderPaymentSuccess);
router.put('/:orderId/payment-retry', retryOrderPayment);
router.put('/:orderId/cancel', cancelOrder);
router.put('/:orderId/return-refund', requestReturnRefund);
router.put('/:orderId/shipping', updateShippingInfo);
export default router;
