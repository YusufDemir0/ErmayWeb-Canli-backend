import { Router } from 'express';
import rateLimit from 'express-rate-limit';
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

const router = Router();

// Rate limiter for request creation: 10 requests / 1 hour per IP
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Çok fazla sipariş talebi oluşturdunuz. Lütfen daha sonra tekrar deneyiniz veya doğrudan WhatsApp hattımızdan iletişime geçiniz.',
  },
});

// ==========================================
// Public Endpoints
// ==========================================

// POST /api/v1/requests - Talep Oluşturma
router.post('/', requestLimiter, createOrderRequest);

// POST /api/v1/requests/quote - Fiyat Doğrulama / Teklif
router.post('/quote', quoteCart);

// GET /api/v1/requests/public/:token - Maskeli Fiş Görüntüleme
router.get('/public/:token', getPublicReceipt);

// ==========================================
// Admin & Personel Endpoints
// ==========================================

// GET /api/v1/requests/admin and /api/v1/requests/admin/all - Tüm talepleri listeleme
router.get('/admin', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), getAdminRequests);
router.get('/admin/all', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), getAdminRequests);

// GET /api/v1/requests/admin/:id - Talep detayı ve olay geçmişi
router.get('/admin/:id', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), getAdminRequestById);

// PATCH /api/v1/requests/admin/:id/status - Durum güncelleme
router.patch('/admin/:id/status', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), updateRequestStatus);

// POST /api/v1/requests/admin/:id/retry-erp - Manuel ERP yeniden deneme
router.post('/admin/:id/retry-erp', authenticateToken, authorizeRoles('ADMIN', 'STAFF'), retryErpSync);

export default router;
