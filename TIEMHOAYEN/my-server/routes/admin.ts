import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import {
  createAdminCategory,
  createAdminCampaign,
  createAdminCustomerAddress,
  createAdminExport,
  createAdminImport,
  createAdminMaterial,
  createAdminOrder,
  createAdminProduct,
  createAdminSupplier,
  createAdminTransaction,
  createAdminVoucher,
  deleteAdminCategory,
  deleteAdminCampaign,
  deleteAdminCustomerAddress,
  deleteAdminExport,
  deleteAdminImport,
  deleteAdminMaterial,
  deleteAdminProduct,
  deleteAdminSupplier,
  deleteAdminVoucher,
  getAdminCategories,
  getAdminCampaigns,
  getAdminAddressOptions,
  getAdminCustomerDetail,
  getAdminCustomers,
  getAdminDashboard,
  getAdminExports,
  getAdminImports,
  getAdminMaterials,
  getAdminOrders,
  getAdminOrderDetail,
  getAdminProductDetail,
  getAdminProducts,
  getAdminStaffAccounts,
  getAdminSuppliers,
  getAdminTransactions,
  getAdminVouchers,
  updateAdminCampaign,
  updateAdminCustomer,
  updateAdminCustomerAddress,
  updateAdminExport,
  updateAdminImport,
  updateAdminMaterial,
  uploadAdminMaterialImage,
  updateAdminOrderStatus,
  updateAdminOrderPaymentStatus,
  updateAdminProductDetail,
  updateAdminProductStatus,
  updateAdminSupplier,
  updateAdminTransaction,
  updateAdminVoucher,
  setDefaultAdminCustomerAddress,
} from '../controllers/admin.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';

const router = express.Router();
const materialUploadDir = 'uploads/materials';

fs.mkdirSync(materialUploadDir, { recursive: true });

const materialImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, materialUploadDir);
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const safeName = `material-${Date.now()}-${Math.round(Math.random() * 1_000_000)}${extension}`;

    cb(null, safeName);
  },
});

const materialImageUpload = multer({
  storage: materialImageStorage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    if (!acceptedTypes.includes(file.mimetype)) {
      cb(new Error('Chỉ chấp nhận ảnh JPG, PNG, WEBP hoặc GIF.'));
      return;
    }

    cb(null, true);
  },
});

router.get('/dashboard', requireAdminPermission('dashboard'), getAdminDashboard);
router.get('/address-options', requireAdminPermission('customers'), getAdminAddressOptions);
router.get('/staff-accounts', requireAdminPermission('permissions'), getAdminStaffAccounts);
router.get('/orders', requireAdminPermission('orders'), getAdminOrders);
router.get('/orders/:orderId', requireAdminPermission('orders'), getAdminOrderDetail);
router.post('/orders', requireAdminPermission('orders'), createAdminOrder);
router.put('/orders/:orderId/status', requireAdminPermission('orders'), updateAdminOrderStatus);
router.put('/orders/:orderId/payment-status', requireAdminPermission('payments'), updateAdminOrderPaymentStatus);
router.get('/customers', requireAdminPermission('customers'), getAdminCustomers);
router.get('/customers/:customerId', requireAdminPermission('customers'), getAdminCustomerDetail);
router.put('/customers/:customerId', requireAdminPermission('customers'), updateAdminCustomer);
router.post('/customers/:customerId/addresses', requireAdminPermission('customers'), createAdminCustomerAddress);
router.put('/customers/:customerId/addresses/:addressId', requireAdminPermission('customers'), updateAdminCustomerAddress);
router.patch('/customers/:customerId/addresses/:addressId/default', requireAdminPermission('customers'), setDefaultAdminCustomerAddress);
router.delete('/customers/:customerId/addresses/:addressId', requireAdminPermission('customers'), deleteAdminCustomerAddress);
router.get('/transactions', requireAdminPermission('payments'), getAdminTransactions);
router.post('/transactions', requireAdminPermission('payments'), createAdminTransaction);
router.put('/transactions/:transactionId', requireAdminPermission('payments'), updateAdminTransaction);
router.get('/products', requireAdminPermission('products'), getAdminProducts);
router.post('/products', requireAdminPermission('products'), createAdminProduct);
router.get('/products/:productId', requireAdminPermission('products'), getAdminProductDetail);
router.put('/products/:productId', requireAdminPermission('products'), updateAdminProductDetail);
router.put('/products/:productId/status', requireAdminPermission('products'), updateAdminProductStatus);
router.delete('/products/:productId', requireAdminPermission('products'), deleteAdminProduct);
router.get('/categories/:type', requireAdminPermission('products'), getAdminCategories);
router.post('/categories/:type', requireAdminPermission('products'), createAdminCategory);
router.delete('/categories/:type/:categoryId', requireAdminPermission('products'), deleteAdminCategory);
router.get('/campaigns', requireAdminPermission('promotions'), getAdminCampaigns);
router.post('/campaigns', requireAdminPermission('promotions'), createAdminCampaign);
router.put('/campaigns/:campaignId', requireAdminPermission('promotions'), updateAdminCampaign);
router.delete('/campaigns/:campaignId', requireAdminPermission('promotions'), deleteAdminCampaign);
router.get('/vouchers', requireAdminPermission('promotions'), getAdminVouchers);
router.post('/vouchers', requireAdminPermission('promotions'), createAdminVoucher);
router.put('/vouchers/:voucherId', requireAdminPermission('promotions'), updateAdminVoucher);
router.delete('/vouchers/:voucherId', requireAdminPermission('promotions'), deleteAdminVoucher);
router.get('/materials', requireAdminPermission('materials'), getAdminMaterials);
router.post('/materials/upload-image', requireAdminPermission('materials', 'create'), materialImageUpload.single('image'), uploadAdminMaterialImage);
router.post('/materials', requireAdminPermission('materials'), createAdminMaterial);
router.put('/materials/:materialId', requireAdminPermission('materials'), updateAdminMaterial);
router.delete('/materials/:materialId', requireAdminPermission('materials'), deleteAdminMaterial);
router.get('/suppliers', requireAdminPermission('materials'), getAdminSuppliers);
router.post('/suppliers', requireAdminPermission('materials'), createAdminSupplier);
router.put('/suppliers/:supplierId', requireAdminPermission('materials'), updateAdminSupplier);
router.delete('/suppliers/:supplierId', requireAdminPermission('materials'), deleteAdminSupplier);
router.get('/imports', requireAdminPermission('materials'), getAdminImports);
router.post('/imports', requireAdminPermission('materials'), createAdminImport);
router.put('/imports/:receiptId', requireAdminPermission('materials'), updateAdminImport);
router.delete('/imports/:receiptId', requireAdminPermission('materials'), deleteAdminImport);
router.get('/exports', requireAdminPermission('materials'), getAdminExports);
router.post('/exports', requireAdminPermission('materials'), createAdminExport);
router.put('/exports/:receiptId', requireAdminPermission('materials'), updateAdminExport);
router.delete('/exports/:receiptId', requireAdminPermission('materials'), deleteAdminExport);

export default router;
