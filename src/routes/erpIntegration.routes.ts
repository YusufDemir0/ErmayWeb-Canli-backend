import { Router } from 'express';
import {
  getErpCatalog,
  syncProduct,
  handleErpSaleApprovedWebhook,
} from '../controllers/erpIntegration.controller';

const router = Router();

// Catalog and product sync endpoints
router.get('/catalog', getErpCatalog);
router.post('/sync', syncProduct);

// Webhook endpoint called by ERP when sale is approved
router.post('/erp-sale-approved', handleErpSaleApprovedWebhook);

export default router;
