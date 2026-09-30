import { Router } from 'express';
import {
  register,
  login,
  logout,
  getProfile,
  changePassword,
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  getCards,
  addCard,
  deleteCard,
} from '../controllers/auth.controller';
import rateLimit from 'express-rate-limit';
import { authenticateToken } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { LoginSchema, RegisterSchema } from '../validations';

const router = Router();

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 attempts
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Çok fazla başarısız giriş denemesi. Lütfen 15 dakika sonra tekrar deneyiniz.',
  },
});

router.post('/register', validateRequest(RegisterSchema), register);
router.post('/login', loginLimiter, validateRequest(LoginSchema), login);
router.post('/logout', logout);
router.get('/profile', authenticateToken, getProfile);
router.post('/change-password', authenticateToken, changePassword);

// Address Management Endpoints
router.get('/addresses', authenticateToken, getAddresses);
router.post('/addresses', authenticateToken, addAddress);
router.put('/addresses/:id', authenticateToken, updateAddress);
router.delete('/addresses/:id', authenticateToken, deleteAddress);

// Saved Cards Management Endpoints
router.get('/cards', authenticateToken, getCards);
router.post('/cards', authenticateToken, addCard);
router.delete('/cards/:id', authenticateToken, deleteCard);

export default router;
