import { Router } from 'express';
import {
  quoteCart,
  createOrderRequest,
  getPublicReceipt,
  getAdminRequests,
  getAdminRequestById,
  updateRequestStatus,
  retryErpSync,
} from '../controllers/orderRequest.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';
import { requestCreateLimiter, quoteLimiter, publicReceiptLimiter } from '../middlewares/rateLimiters';
import { validateRequest, validateQuery, validateParams } from '../middlewares/validate.middleware';
import * as V from '../validations';

const router = Router();

// ==========================================
// Public Endpoints
// ==========================================

// POST /api/v1/requests - Talep Oluşturma
router.post('/', requestCreateLimiter, validateRequest(V.CreateOrderRequestSchema), createOrderRequest);

// POST /api/v1/requests/quote - Fiyat Doğrulama / Teklif
router.post('/quote', quoteLimiter, validateRequest(V.QuoteCartSchema), quoteCart);

// GET /api/v1/requests/public/:token - Maskeli Fiş Görüntüleme
router.get('/public/:token', publicReceiptLimiter, validateParams(V.TokenParamSchema), getPublicReceipt);

// ==========================================
// Admin & Personel Endpoints
// ==========================================

// GET /api/v1/requests/admin and /api/v1/requests/admin/all - Tüm talepleri listeleme
router.get('/admin', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), validateQuery(V.RequestListQuerySchema), getAdminRequests);
router.get('/admin/all', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), validateQuery(V.RequestListQuerySchema), getAdminRequests);

// GET /api/v1/requests/admin/:id - Talep detayı ve olay geçmişi
router.get('/admin/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), validateParams(V.IdParamSchema), getAdminRequestById);

// PATCH /api/v1/requests/admin/:id/status - Durum güncelleme
router.patch('/admin/:id/status', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), validateParams(V.IdParamSchema), validateRequest(V.UpdateOrderRequestStatusSchema), updateRequestStatus);

// POST /api/v1/requests/admin/:id/retry-erp - Manuel ERP yeniden deneme
router.post('/admin/:id/retry-erp', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), validateParams(V.IdParamSchema), retryErpSync);

export default router;
