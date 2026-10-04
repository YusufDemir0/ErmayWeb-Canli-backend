import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createContactMessage, getContactMessages, setContactMessageHandled } from '../controllers/contact.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';

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
router.post('/', contactLimiter, createContactMessage);

// Admin & Personel
router.get('/', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), getContactMessages);
router.patch('/:id/handled', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), setContactMessageHandled);

export default router;
