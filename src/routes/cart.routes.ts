import { Router } from 'express';
import { quoteCart } from '../controllers/orderRequest.controller';
import { quoteLimiter } from '../middlewares/rateLimiters';
import { validateRequest, validateQuery } from '../middlewares/validate.middleware';
import * as V from '../validations';

const router = Router();

// POST /api/v1/cart/quote - Sepetteki ürünlerin güncel fiyat ve stok durumunu sorgular
router.post('/quote', quoteLimiter, validateRequest(V.QuoteCartSchema), quoteCart);

export default router;
