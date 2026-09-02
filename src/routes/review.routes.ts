import { Router } from 'express';
import { getProductReviews, createProductReview } from '../controllers/review.controller';

const router = Router();

router.get('/product/:productId', getProductReviews);
router.post('/', createProductReview);

export default router;
