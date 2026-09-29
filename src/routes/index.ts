import { Router } from 'express';
import authRoutes from './auth.routes';
import productRoutes from './product.routes';
import orderRoutes from './order.routes';
import requestRoutes from './request.routes';
import cartRoutes from './cart.routes';
import geoRoutes from './geo.routes';
import cmsRoutes from './cms.routes';
import categoryRoutes from './category.routes';
import uploadRoutes from './upload.routes';
import storeRoutes from './store.routes';
import erpIntegrationRoutes from './erpIntegration.routes';
import blogRoutes from './blog.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/cart', cartRoutes);
router.use('/requests', requestRoutes);
router.use('/orders', orderRoutes); // Geriye dönük uyumluluk için
router.use('/geo', geoRoutes);
router.use('/cms', cmsRoutes);
router.use('/upload', uploadRoutes);
router.use('/stores', storeRoutes);
router.use('/integration', erpIntegrationRoutes);
router.use('/blogs', blogRoutes);

export default router;
