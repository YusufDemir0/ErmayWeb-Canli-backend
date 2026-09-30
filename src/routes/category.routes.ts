import { Router } from 'express';
import {
  getCategories,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  reorderCategories,
  deleteCategory,
} from '../controllers/category.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import {
  CreateCategorySchema,
  UpdateCategorySchema,
  ReorderCategoriesSchema,
} from '../validations';

const router = Router();

router.get('/', getCategories);
router.get('/:slug', getCategoryBySlug);
router.post('/', authenticateToken, authorizeRoles('ADMIN'), validateRequest(CreateCategorySchema), createCategory);
router.put('/reorder', authenticateToken, authorizeRoles('ADMIN'), validateRequest(ReorderCategoriesSchema), reorderCategories);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN'), validateRequest(UpdateCategorySchema), updateCategory);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), deleteCategory);

export default router;
