import { Router } from 'express';
import { quoteCart } from '../controllers/orderRequest.controller';
import { quoteLimiter } from '../middlewares/rateLimiters';

const router = Router();

// POST /api/v1/cart/quote - Sepetteki ürünlerin güncel fiyat ve stok durumunu sorgular
router.post('/quote', quoteLimiter, quoteCart);

export default router;
