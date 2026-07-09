import express from 'express';
import multer from 'multer';
import path from 'path';
import {
  getAllCustomers,
  registerCustomer,
  loginCustomer,
  forgotPassword,
  sendOtp,
  verifyOtp,
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

router.get('/', getAllCustomers);

// Đăng ký
router.post('/', registerCustomer);

// Đăng nhập
router.post('/login', loginCustomer);

// Quên mật khẩu
router.put('/forgot-password', forgotPassword);
router.post('/send-otp', sendOtp);

router.post('/verify-otp', verifyOtp);

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