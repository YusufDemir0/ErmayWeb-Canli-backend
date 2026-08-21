import { Router } from 'express';
import { getCmsBlock, getAllCmsBlocks, updateCmsBlock } from '../controllers/cms.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { UpdateCmsBlockSchema } from '../validations';

const router = Router();

router.get('/', getAllCmsBlocks);
router.get('/:key', getCmsBlock);
router.put('/:key', authenticateToken, authorizeRoles('ADMIN'), validateRequest(UpdateCmsBlockSchema), updateCmsBlock);

export default router;
