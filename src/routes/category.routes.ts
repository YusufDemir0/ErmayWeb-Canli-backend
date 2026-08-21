import { Router } from 'express';
import { getCategories, createCategory, updateCategory, deleteCategory } from '../controllers/category.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { CreateCategorySchema, UpdateCategorySchema } from '../validations';

const router = Router();

router.get('/', getCategories);
router.post('/', authenticateToken, authorizeRoles('ADMIN'), validateRequest(CreateCategorySchema), createCategory);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN'), validateRequest(UpdateCategorySchema), updateCategory);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), deleteCategory);

export default router;
