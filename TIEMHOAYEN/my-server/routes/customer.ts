import express from 'express';
import { requireCustomerLookup } from '../controllers/order-access.js';
import multer from 'multer';
import path from 'path';
import { customerSendOtp, customerVerifyOtp, customerReset } from './auth.js';
import { requireIdentity } from '../services/auth.service.js';
import { customerAccess } from '../middleware/customerAccess.js';
import {
  getAllCustomers,
  registerCustomer,
  loginCustomer,
  getCustomerById,
  updateCustomerById,
  getCustomerAddresses,
  addCustomerAddress,
  deleteCustomerAddress,
  updateCustomerAddress,
  setDefaultCustomerAddress,
  getCustomerOrders,
  getCustomerVouchers,
  getCustomerWishlist,
  updateCustomerAvatar,
  removeCustomerAvatar,
  addWishlistItem,
  removeWishlistItem
} from '../controllers/customer.js';

const router = express.Router();
const storage = multer.diskStorage({
  destination: 'uploads/account',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.id}-avatar-${Date.now()}${ext}`);
  }
});

const upload = multer({ storage });

router.get('/', requireIdentity, customerAccess, getAllCustomers);

// Đăng ký
router.post('/', registerCustomer);

// Đăng nhập
router.post('/login', loginCustomer);

// Quên mật khẩu
router.put('/forgot-password', customerReset);
router.post('/send-otp', customerSendOtp);

router.post('/verify-otp', customerVerifyOtp);

router.use(requireIdentity, customerAccess);

// Lấy thông tin khách hàng theo ID
router.get('/:id/addresses', getCustomerAddresses);
router.delete('/addresses/:addressId', deleteCustomerAddress);
router.put('/addresses/:addressId', updateCustomerAddress);
router.put('/addresses/:addressId/default', setDefaultCustomerAddress);
router.get('/:id/orders', requireCustomerLookup, getCustomerOrders);
router.get('/:id/vouchers', requireCustomerLookup, getCustomerVouchers);
router.get('/:id/wishlist', requireCustomerLookup, getCustomerWishlist);
router.put('/:id/avatar', upload.single('avatar'), updateCustomerAvatar);
router.put('/:id/avatar/remove', removeCustomerAvatar);
router.post(
  '/:customerId/wishlist/:productId',
  requireCustomerLookup,
  addWishlistItem
);
router.delete(
  '/:customerId/wishlist/:productId',
  requireCustomerLookup,
  removeWishlistItem
);
router.get('/:id', getCustomerById);
router.put('/:id', updateCustomerById);
router.post('/:id/addresses', addCustomerAddress);

export default router;
