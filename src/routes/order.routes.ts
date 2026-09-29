import { Router } from 'express';
import {
  createOrderRequest,
  getPublicReceipt,
  getAdminRequests,
  getAdminRequestById,
  updateRequestStatus,
  retryErpSync,
} from '../controllers/orderRequest.controller';
import { triggerDailySalesReport } from '../controllers/order.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';

const router = Router();

// ==========================================
// Customer Endpoints (Backward compatibility)
// ==========================================
router.post('/', createOrderRequest);
router.get('/public/:token', getPublicReceipt);

// Kapalı uç noktalar
router.get('/track/:orderNumber', (_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Bu uç nokta kapatılmıştır. Sipariş talebinizi size iletilen özel fiş bağlantısından takip edebilirsiniz.',
  });
});
router.get('/my-orders', (_req, res) => {
  res.status(200).json({ success: true, orders: [] });
});
router.post('/:id/receipt', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'Dekont yükleme uç noktası kapatılmıştır.',
  });
});

// ==========================================
// Admin Endpoints
// ==========================================
router.get('/all', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), getAdminRequests);
router.get('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), getAdminRequestById);
router.patch('/:id/status', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), updateRequestStatus);
router.post('/:id/retry-erp', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), retryErpSync);
router.post('/daily-report', authenticateToken, authorizeRoles('ADMIN'), triggerDailySalesReport);

export default router;
