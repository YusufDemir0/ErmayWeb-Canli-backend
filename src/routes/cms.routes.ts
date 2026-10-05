import { Router, Request, Response, NextFunction } from 'express';
import { getCmsBlock, getAllCmsBlocks, updateCmsBlock, testTelegramConnection } from '../controllers/cms.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';
import { validateRequest, validateParams } from '../middlewares/validate.middleware';
import { CMS_SCHEMAS, CMS_MAX_BYTES, CmsKeyParamSchema, CmsReadKeyParamSchema, TelegramTestSchema } from '../validations';
import { z } from 'zod';

const router = Router();

/** Validates `content` against the schema registered for the CMS key and bounds its size. */
const validateCmsContent = (req: Request, res: Response, next: NextFunction): void => {
  const schema = CMS_SCHEMAS[String(req.params.key)];
  const body = z.object({ content: schema, description: z.string().max(200).optional() });
  if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > CMS_MAX_BYTES) {
    res.status(413).json({ success: false, message: 'İçerik çok büyük.' });
    return;
  }
  validateRequest(body)(req, res, next);
};

router.get('/', getAllCmsBlocks);
router.get('/blocks/:key', validateParams(CmsReadKeyParamSchema), getCmsBlock);
router.get('/:key', validateParams(CmsReadKeyParamSchema), getCmsBlock);
router.put('/:key', authenticateToken, authorizeRoles('ADMIN'), validateParams(CmsKeyParamSchema), validateCmsContent, updateCmsBlock);
router.post('/telegram/test', authenticateToken, authorizeRoles('ADMIN'), validateRequest(TelegramTestSchema), testTelegramConnection);

export default router;
