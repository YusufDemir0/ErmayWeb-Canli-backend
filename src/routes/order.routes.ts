import { Router } from 'express';
import {
  createOrderRequest,
  getPublicReceipt,
  getAdminRequests,
  getAdminRequestById,
  updateRequestStatus,
  retryErpSync,
  triggerDailySalesReport,
} from '../controllers/orderRequest.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';
import { requestCreateLimiter, publicReceiptLimiter } from '../middlewares/rateLimiters';
import { validateRequest, validateQuery, validateParams } from '../middlewares/validate.middleware';
import * as V from '../validations';

const router = Router();

// ==========================================
// Customer Endpoints (Backward compatibility)
// ==========================================
router.post('/', requestCreateLimiter, validateRequest(V.CreateOrderRequestSchema), createOrderRequest);
router.get('/public/:token', publicReceiptLimiter, validateParams(V.TokenParamSchema), getPublicReceipt);

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
router.get('/all', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), validateQuery(V.RequestListQuerySchema), getAdminRequests);
router.get('/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), validateParams(V.IdParamSchema), getAdminRequestById);
router.patch('/:id/status', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), validateParams(V.IdParamSchema), validateRequest(V.UpdateOrderRequestStatusSchema), updateRequestStatus);
router.post('/:id/retry-erp', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), validateParams(V.IdParamSchema), retryErpSync);
router.post('/daily-report', authenticateToken, authorizeRoles('ADMIN'), triggerDailySalesReport);

export default router;
