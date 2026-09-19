import { Router } from 'express';
import { getCmsBlock, getAllCmsBlocks, updateCmsBlock, testTelegramConnection } from '../controllers/cms.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { UpdateCmsBlockSchema } from '../validations';

const router = Router();

router.get('/', getAllCmsBlocks);
router.get('/:key', getCmsBlock);
router.put('/:key', authenticateToken, authorizeRoles('ADMIN'), validateRequest(UpdateCmsBlockSchema), updateCmsBlock);
router.post('/telegram/test', authenticateToken, authorizeRoles('ADMIN'), testTelegramConnection);

export default router;
