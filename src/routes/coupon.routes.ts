import { Router } from 'express';
import { 
  validateCoupon, 
  getCoupons, 
  createCoupon, 
  updateCoupon, 
  deleteCoupon 
} from '../controllers/coupon.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';

const router = Router();

// Public: Validate coupon at checkout
router.post('/validate', validateCoupon);

// Admin: Manage coupons
router.get('/', authenticateToken, authorizeRoles('ADMIN'), getCoupons);
router.post('/', authenticateToken, authorizeRoles('ADMIN'), createCoupon);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN'), updateCoupon);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), deleteCoupon);

export default router;
