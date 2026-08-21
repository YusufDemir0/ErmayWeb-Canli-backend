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
import { authenticateToken } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { LoginSchema, RegisterSchema } from '../validations';

const router = Router();

router.post('/register', validateRequest(RegisterSchema), register);
router.post('/login', validateRequest(LoginSchema), login);
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
