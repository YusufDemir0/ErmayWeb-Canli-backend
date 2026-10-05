import { Router } from 'express';
import {
  getStores,
  createStore,
  updateStore,
  deleteStore,
} from '../controllers/store.controller';
import { authenticateToken, authorizeRoles, authenticateOptionalToken } from '../middlewares/auth.middleware';

import { validateRequest } from '../middlewares/validate.middleware';
import { CreateStoreSchema, UpdateStoreSchema } from '../validations';

const router = Router();

// Public store listing
router.get('/', authenticateOptionalToken, getStores);

// Protected Admin store management
router.post('/', authenticateToken, authorizeRoles('ADMIN'), validateRequest(CreateStoreSchema), createStore);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN'), validateRequest(UpdateStoreSchema), updateStore);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), deleteStore);

export default router;
