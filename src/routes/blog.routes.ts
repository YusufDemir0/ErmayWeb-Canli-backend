import { Router } from 'express';
import {
  getBlogPosts,
  getBlogPostBySlug,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
} from '../controllers/blog.controller';
import { authenticateToken, authorizeRoles, authenticateOptionalToken } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', authenticateOptionalToken, getBlogPosts);
router.get('/:slug', authenticateOptionalToken, getBlogPostBySlug);

router.post('/', authenticateToken, authorizeRoles('ADMIN'), createBlogPost);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN'), updateBlogPost);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), deleteBlogPost);

export default router;
