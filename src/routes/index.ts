import { Router } from 'express';
import authRoutes from './auth.routes';
import productRoutes from './product.routes';
import orderRoutes from './order.routes';
import paymentRoutes from './payment.routes';
import geoRoutes from './geo.routes';
import cmsRoutes from './cms.routes';
import categoryRoutes from './category.routes';
import couponRoutes from './coupon.routes';
import uploadRoutes from './upload.routes';
import storeRoutes from './store.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/coupons', couponRoutes);
router.use('/orders', orderRoutes);
router.use('/payments', paymentRoutes);
router.use('/geo', geoRoutes);
router.use('/cms', cmsRoutes);
router.use('/upload', uploadRoutes);
router.use('/stores', storeRoutes);

export default router;
