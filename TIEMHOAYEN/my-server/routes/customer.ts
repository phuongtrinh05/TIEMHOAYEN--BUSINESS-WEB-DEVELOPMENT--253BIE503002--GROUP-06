import express from 'express';
import multer from 'multer';
import path from 'path';
import { customerLogin, customerSendOtp, customerVerifyOtp, customerReset } from './auth.js';
import { requireIdentity } from '../services/auth.service.js';
import { customerAccess } from '../middleware/customerAccess.js';
import {
  getAllCustomers,
  registerCustomer,
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
router.post('/login', customerLogin);

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
router.get('/:id/orders', getCustomerOrders);
router.get('/:id/vouchers', getCustomerVouchers);
router.get('/:id/wishlist', getCustomerWishlist);
router.put('/:id/avatar', upload.single('avatar'), updateCustomerAvatar);
router.put('/:id/avatar/remove', removeCustomerAvatar);
router.post(
  '/:customerId/wishlist/:productId',
  addWishlistItem
);
router.delete(
  '/:customerId/wishlist/:productId',
  removeWishlistItem
);
router.get('/:id', getCustomerById);
router.put('/:id', updateCustomerById);
router.post('/:id/addresses', addCustomerAddress);

export default router;
