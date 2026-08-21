import { Router } from 'express';
import {
  getStores,
  createStore,
  updateStore,
  deleteStore,
} from '../controllers/store.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth.middleware';

const router = Router();

// Public store listing
router.get('/', getStores);

// Protected Admin store management
router.post('/', authenticateToken, authorizeRoles('ADMIN'), createStore);
router.put('/:id', authenticateToken, authorizeRoles('ADMIN'), updateStore);
router.delete('/:id', authenticateToken, authorizeRoles('ADMIN'), deleteStore);

export default router;
