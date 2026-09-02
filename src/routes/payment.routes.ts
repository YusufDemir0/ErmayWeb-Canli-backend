import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { processCardPayment, handleIyzicoWebhook, initCheckoutForm } from '../controllers/payment.controller';
import { validateRequest } from '../middlewares/validate.middleware';
import { ProcessPaymentSchema } from '../validations';

const router = Router();

// Strict Rate Limiting against Carding / BIN Testing Attacks (Max 10 attempts per 15 minutes per IP)
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: 'Çok fazla ödeme denemesi yaptınız. Güvenliğiniz için lütfen 15 dakika sonra tekrar deneyiniz.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/process', paymentLimiter, validateRequest(ProcessPaymentSchema), processCardPayment);
router.post('/card', paymentLimiter, validateRequest(ProcessPaymentSchema), processCardPayment);
router.post('/initialize-form', paymentLimiter, initCheckoutForm);
router.post('/webhook', handleIyzicoWebhook);

export default router;

