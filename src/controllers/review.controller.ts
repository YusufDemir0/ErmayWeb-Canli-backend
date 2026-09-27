import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

/**
 * Ürüne ait onaylı yorumları listeleme
 */
export async function getProductReviews(req: Request, res: Response): Promise<void> {
  try {
    const productId = String(req.params.productId);

    if (!productId) {
      res.status(400).json({ success: false, message: 'Ürün ID zorunludur.' });
      return;
    }

    const reviews = await prisma.review.findMany({
      where: {
        productId,
        isApproved: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.status(200).json({
      success: true,
      reviews,
    });
  } catch (error) {
    console.error('Yorumları getirme hatası:', error);
    res.status(500).json({ success: false, message: 'Yorumlar getirilemedi.' });
  }
}

/**
 * Yeni ürün yorumu ekleme
 */
export async function createProductReview(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { productId, rating = 5, comment, userName } = req.body;
    const userId = req.user?.userId;

    if (!productId || !comment || !comment.trim()) {
      res.status(400).json({ success: false, message: 'Lütfen ürün ve yorum detaylarını doldurunuz.' });
      return;
    }

    const safeRating = Math.max(1, Math.min(5, Number(rating) || 5));
    const safeUserName = (userName || (req.user as { name?: string } | undefined)?.name || 'Değerli Müşterimiz').trim();

    const newReview = await prisma.review.create({
      data: {
        productId: String(productId),
        userId: userId || null,
        userName: safeUserName,
        rating: safeRating,
        comment: comment.trim(),
        isApproved: true, // Auto-approved for verified customer experience
      },
    });

    res.status(201).json({
      success: true,
      message: 'Değerlendirmeniz ve yorumunuz başarıyla kaydedildi.',
      review: newReview,
    });
  } catch (error) {
    console.error('Yorum ekleme hatası:', error);
    res.status(500).json({ success: false, message: 'Yorum kaydedilirken bir hata oluştu.' });
  }
}
