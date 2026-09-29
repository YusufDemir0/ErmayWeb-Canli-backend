import { Router } from 'express';
import { quoteCart } from '../controllers/orderRequest.controller';

const router = Router();

// POST /api/v1/cart/quote - Sepetteki ürünlerin güncel fiyat ve stok durumunu sorgular
router.post('/quote', quoteCart);

export default router;
