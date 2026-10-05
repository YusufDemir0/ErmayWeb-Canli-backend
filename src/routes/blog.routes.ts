import { Router } from 'express';
import {
  getBlogPosts,
  getBlogPostBySlug,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
} from '../controllers/blog.controller';
import { authenticateToken, authorizeRoles, authenticateOptionalToken } from '../middlewares/auth.middleware';

import { CreateBlogPostSchema, UpdateBlogPostSchema } from '../validations';
import { validateRequest, validateQuery, validateParams } from '../middlewares/validate.middleware';
import * as V from '../validations';

const router = Router();

router.get('/', authenticateOptionalToken, validateQuery(V.BlogListQuerySchema), getBlogPosts);
router.get('/:slug', authenticateOptionalToken, validateParams(V.SlugParamSchema), getBlogPostBySlug);

router.post('/', authenticateToken, authorizeRoles('ADMIN'), validateRequest(CreateBlogPostSchema), createBlogPost);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN'), validateParams(V.IdParamSchema), validateRequest(UpdateBlogPostSchema), updateBlogPost);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), validateParams(V.IdParamSchema), deleteBlogPost);

export default router;
