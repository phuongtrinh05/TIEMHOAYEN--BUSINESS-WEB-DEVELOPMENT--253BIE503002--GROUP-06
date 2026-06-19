import express from 'express';

import {
  getAllCustomers,
  registerCustomer,
  loginCustomer,
  forgotPassword,sendOtp,
verifyOtp
} from '../controllers/customer.js';

const router = express.Router();

router.get('/', getAllCustomers);

// Đăng ký
router.post('/', registerCustomer);

// Đăng nhập
router.post('/login', loginCustomer);

// Quên mật khẩu
router.put('/forgot-password', forgotPassword);
router.post('/send-otp',sendOtp);

router.post('/verify-otp',verifyOtp);

export default router;