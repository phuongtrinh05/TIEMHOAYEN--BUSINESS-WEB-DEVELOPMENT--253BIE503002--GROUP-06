import express from 'express';
import { ownerAccess } from '../middleware/resourceAccess.js';
import { requireAdminPermission } from '../middleware/rolePermission.js';
import {
  getAllCarts,
  getCartByCustomer,
  addCartItem,
  updateCartItem,
  removeCartItem
} from '../controllers/cart.js';

const router = express.Router();

router.get('/', requireAdminPermission('customers', 'view'), getAllCarts);
router.get('/customer/:customerId', ownerAccess(req => req.params.customerId), getCartByCustomer);
router.post('/add', ownerAccess(req => req.body.customerId), addCartItem);
router.put('/update', ownerAccess(req => req.body.customerId), updateCartItem);
router.delete('/remove', ownerAccess(req => req.body.customerId), removeCartItem);

export default router;
