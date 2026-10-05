import { Router } from 'express';
import { getProducts, getProductById, createProduct, updateProduct, deleteProduct, bulkLinkErpProducts } from '../controllers/product.controller';
import { authenticateToken, authorizeRoles, authenticateOptionalToken } from '../middlewares/auth.middleware';
import { CreateProductSchema, UpdateProductSchema, BulkLinkSchema } from '../validations';
import { validateRequest, validateQuery, validateParams } from '../middlewares/validate.middleware';
import * as V from '../validations';

const router = Router();

router.get('/', authenticateOptionalToken, validateQuery(V.ProductListQuerySchema), getProducts);
router.get('/:id', authenticateOptionalToken, validateParams(V.ProductRefParamSchema), getProductById);
router.post('/bulk-link', authenticateToken, authorizeRoles('ADMIN'), validateRequest(BulkLinkSchema), bulkLinkErpProducts);
router.post('/', authenticateToken, authorizeRoles('ADMIN'), validateRequest(CreateProductSchema), createProduct);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN'), validateParams(V.IdParamSchema), validateRequest(V.UpdateProductSchema), updateProduct);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), validateParams(V.IdParamSchema), deleteProduct);

export default router;
