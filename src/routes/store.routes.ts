import { Router } from 'express';
import {
  getStores,
  createStore,
  updateStore,
  deleteStore,
} from '../controllers/store.controller';
import { authenticateToken, authorizeRoles, authenticateOptionalToken } from '../middlewares/auth.middleware';

import { CreateStoreSchema, UpdateStoreSchema } from '../validations';
import { validateRequest, validateQuery, validateParams } from '../middlewares/validate.middleware';
import * as V from '../validations';

const router = Router();

// Public store listing
router.get('/', authenticateOptionalToken, validateQuery(V.StoreListQuerySchema), getStores);

// Protected Admin store management
router.post('/', authenticateToken, authorizeRoles('ADMIN'), validateRequest(CreateStoreSchema), createStore);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN'), validateParams(V.IdParamSchema), validateRequest(UpdateStoreSchema), updateStore);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), validateParams(V.IdParamSchema), deleteStore);

export default router;
