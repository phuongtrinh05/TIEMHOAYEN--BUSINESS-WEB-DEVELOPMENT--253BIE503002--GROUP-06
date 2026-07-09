import express from 'express';
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

router.get('/', getAllOrders);
router.get('/public-vouchers', getPublicVouchers);
router.post('/', createOrder);
router.get('/:orderId/detail', getOrderDetail);
router.get('/:orderId/payment-status', getOrderPaymentStatus);
router.put('/:orderId/payment-expired', expireOrderPayment);
router.put('/:orderId/payment-success', markOrderPaymentSuccess);
router.put('/:orderId/payment-retry', retryOrderPayment);
router.put('/:orderId/cancel', cancelOrder);
router.put('/:orderId/return-refund', requestReturnRefund);
router.put('/:orderId/shipping', updateShippingInfo);
export default router;
