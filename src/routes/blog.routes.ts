import { Router } from 'express';
import {
  getBlogPosts,
  getBlogPostBySlug,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
} from '../controllers/blog.controller';
import { authenticateToken, authorizeRoles, authenticateOptionalToken } from '../middlewares/auth.middleware';

import { validateRequest } from '../middlewares/validate.middleware';
import { CreateBlogPostSchema, UpdateBlogPostSchema } from '../validations';

const router = Router();

router.get('/', authenticateOptionalToken, getBlogPosts);
router.get('/:slug', authenticateOptionalToken, getBlogPostBySlug);

router.post('/', authenticateToken, authorizeRoles('ADMIN'), validateRequest(CreateBlogPostSchema), createBlogPost);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN'), validateRequest(UpdateBlogPostSchema), updateBlogPost);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), deleteBlogPost);

export default router;
