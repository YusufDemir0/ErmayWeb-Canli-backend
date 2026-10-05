import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createContactMessage, getContactMessages, setContactMessageHandled } from '../controllers/contact.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';
import { validateRequest, validateQuery, validateParams } from '../middlewares/validate.middleware';
import * as V from '../validations';

const router = Router();

// Rate limiter for contact form: 5 messages / 1 hour per IP
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  message: {
    success: false,
    message: 'Çok fazla mesaj gönderdiniz. Lütfen daha sonra tekrar deneyiniz veya doğrudan WhatsApp hattımızdan iletişime geçiniz.',
  },
});

// POST /api/v1/contact - İletişim formu (Public)
router.post('/', contactLimiter, validateRequest(V.CreateContactMessageSchema), createContactMessage);

// Admin & Personel
router.get('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), validateQuery(V.ContactListQuerySchema), getContactMessages);
router.patch('/:id/handled', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), validateParams(V.IdParamSchema), setContactMessageHandled);

export default router;
