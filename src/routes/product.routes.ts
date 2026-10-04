import { Router } from 'express';
import { getProducts, getProductById, createProduct, updateProduct, deleteProduct, bulkLinkErpProducts } from '../controllers/product.controller';
import { authenticateToken, authorizeRoles, authenticateOptionalToken } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { CreateProductSchema, UpdateProductSchema, BulkLinkSchema } from '../validations';

const router = Router();

router.get('/', authenticateOptionalToken, getProducts);
router.get('/:id', authenticateOptionalToken, getProductById);
router.post('/bulk-link', authenticateToken, authorizeRoles('ADMIN'), validateRequest(BulkLinkSchema), bulkLinkErpProducts);
router.post('/', authenticateToken, authorizeRoles('ADMIN'), validateRequest(CreateProductSchema), createProduct);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN'), validateRequest(UpdateProductSchema), updateProduct);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), deleteProduct);

export default router;
