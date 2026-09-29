import { Router } from 'express';
import {
  getErpCatalog,
  syncProduct,
  triggerManualCatalogSync,
  handleErpSaleApprovedWebhook,
} from '../controllers/erpIntegration.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';

const router = Router();

// Catalog and product sync endpoints (Protected: Admin Only)
router.get('/catalog', authenticateToken, authorizeRoles('ADMIN'), getErpCatalog);
router.post('/sync', authenticateToken, authorizeRoles('ADMIN'), syncProduct);
router.post('/sync-now', authenticateToken, authorizeRoles('ADMIN'), triggerManualCatalogSync);

// Webhook endpoint called by ERP when sale is approved (Protected: x-integration-key constant-time)
router.post('/erp-sale-approved', handleErpSaleApprovedWebhook);
router.post('/sale-status', handleErpSaleApprovedWebhook);

export default router;
