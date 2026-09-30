import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { quoteCart } from '../controllers/orderRequest.controller';

const router = Router();

const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: {
    success: false,
    message: 'Çok fazla fiyat teklif sorgusu yaptınız. Lütfen bir süre sonra tekrar deneyiniz.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/v1/cart/quote - Sepetteki ürünlerin güncel fiyat ve stok durumunu sorgular
router.post('/quote', quoteLimiter, quoteCart);

export default router;
