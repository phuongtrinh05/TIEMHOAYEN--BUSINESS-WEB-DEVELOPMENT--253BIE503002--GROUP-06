import express from 'express';
import { requireCustomerLookup, requireAddressOwner } from '../controllers/order-access.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';
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

router.get('/', requireAdminPermission('customers'), getAllCustomers);

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
router.get('/:id/addresses', requireAddressOwner, getCustomerAddresses);
router.delete('/addresses/:addressId', requireAddressOwner, deleteCustomerAddress);
router.put('/addresses/:addressId', requireAddressOwner, updateCustomerAddress);
router.put('/addresses/:addressId/default', requireAddressOwner, setDefaultCustomerAddress);
router.get('/:id/orders', requireCustomerLookup, getCustomerOrders);
router.get('/:id/vouchers', requireAddressOwner, getCustomerVouchers);
router.get('/:id/wishlist', requireAddressOwner, getCustomerWishlist);
router.put('/:id/avatar', requireAddressOwner, upload.single('avatar'), updateCustomerAvatar);
router.put('/:id/avatar/remove', requireAddressOwner, removeCustomerAvatar);
router.post(
  '/:customerId/wishlist/:productId',
  requireAddressOwner,
  addWishlistItem
);
router.delete(
  '/:customerId/wishlist/:productId',
  requireAddressOwner,
  removeWishlistItem
);
router.get('/:id', requireAddressOwner, getCustomerById);
router.put('/:id', requireAddressOwner, updateCustomerById);
router.post('/:id/addresses', requireAddressOwner, addCustomerAddress);

export default router;
