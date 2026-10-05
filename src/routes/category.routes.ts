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
import {
  CreateCategorySchema,
  UpdateCategorySchema,
  ReorderCategoriesSchema,
} from '../validations';
import { validateRequest, validateQuery, validateParams } from '../middlewares/validate.middleware';
import * as V from '../validations';

const router = Router();

router.get('/', getCategories);
router.get('/:slug', validateParams(V.SlugParamSchema), getCategoryBySlug);
router.post('/', authenticateToken, authorizeRoles('ADMIN'), validateRequest(CreateCategorySchema), createCategory);
router.put('/reorder', authenticateToken, authorizeRoles('ADMIN'), validateRequest(ReorderCategoriesSchema), reorderCategories);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN'), validateParams(V.IdParamSchema), validateRequest(UpdateCategorySchema), updateCategory);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), validateParams(V.IdParamSchema), validateQuery(V.DeleteCategoryQuerySchema), deleteCategory);

export default router;
