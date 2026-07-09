import express from 'express';
import {
  getAllCarts,
  getCartByCustomer,
  addCartItem,
  updateCartItem,
  removeCartItem
} from '../controllers/cart.js';

const router = express.Router();

router.get('/', getAllCarts);
router.get('/customer/:customerId', getCartByCustomer);
router.post('/add', addCartItem);
router.put('/update', updateCartItem);
router.delete('/remove', removeCartItem);

export default router;
