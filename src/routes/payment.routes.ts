import { Router } from 'express';
import { processCardPayment, handleIyzicoWebhook } from '../controllers/payment.controller';
import { validateRequest } from '../middlewares/validate.middleware';
import { ProcessPaymentSchema } from '../validations';

const router = Router();

router.post('/process', validateRequest(ProcessPaymentSchema), processCardPayment);
router.post('/card', validateRequest(ProcessPaymentSchema), processCardPayment);
router.post('/webhook', handleIyzicoWebhook);

export default router;
