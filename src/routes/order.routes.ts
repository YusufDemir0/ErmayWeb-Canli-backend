import { Router } from 'express';
import { 
  createOrder, 
  getUserOrders, 
  getAllOrders, 
  updateOrderStatus, 
  uploadReceipt, 
  approveOrderPayment,
  triggerDailySalesReport 
} from '../controllers/order.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { CreateOrderSchema, UpdateOrderStatusSchema } from '../validations';

const router = Router();

// Customer Endpoints
router.post('/', authenticateToken, validateRequest(CreateOrderSchema), createOrder);
router.get('/my-orders', authenticateToken, getUserOrders);
router.post('/:id/receipt', authenticateToken, uploadReceipt);

// Admin Endpoints
router.get('/all', authenticateToken, authorizeRoles('ADMIN'), getAllOrders);
router.patch('/:id/status', authenticateToken, authorizeRoles('ADMIN'), validateRequest(UpdateOrderStatusSchema), updateOrderStatus);
router.post('/:id/approve-payment', authenticateToken, authorizeRoles('ADMIN'), approveOrderPayment);
router.post('/daily-report', authenticateToken, authorizeRoles('ADMIN'), triggerDailySalesReport);

export default router;
