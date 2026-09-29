import { Request, Response } from 'express';
import { prisma } from '../config/database';

export async function validateCoupon(req: Request, res: Response): Promise<void> {
  try {
    const { code, cartAmount } = req.body;
    if (!code || typeof code !== 'string') {
      res.status(400).json({ success: false, message: 'Kupon kodu gereklidir.' });
      return;
    }

    const cleanCode = code.trim().toUpperCase();
    const coupon = await prisma.coupon.findUnique({
      where: { code: cleanCode },
    });

    if (!coupon || !coupon.isActive) {
      res.status(404).json({ success: false, message: 'Geçersiz veya süresi dolmuş kupon kodu.' });
      return;
    }

    if (coupon.expiryDate) {
      const exp = new Date(coupon.expiryDate);
      exp.setHours(23, 59, 59, 999);
      if (exp.getTime() < Date.now()) {
        res.status(400).json({ success: false, message: 'Bu kuponun kullanım süresi dolmuştur.' });
        return;
      }
    }

    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
      res.status(400).json({ success: false, message: 'Bu kupon maksimum kullanım limitine ulaşmıştır.' });
      return;
    }

    const minAmount = coupon.minAmount ? Number(coupon.minAmount) : 0;
    const cartTotal = Number(cartAmount || 0);

    if (minAmount > 0 && cartTotal < minAmount) {
      res.status(400).json({
        success: false,
        message: `Bu kuponu kullanabilmek için sepet tutarınız en az ${minAmount} TL olmalıdır.`,
      });
      return;
    }

    let discountAmount = 0;
    if (coupon.discountType === 'percentage') {
      discountAmount = Math.round((cartTotal * Number(coupon.discount)) / 100);
    } else {
      discountAmount = Number(coupon.discount || coupon.discountAmount);
    }

    res.status(200).json({
      success: true,
      message: `%${coupon.discount} indirim uygulandı.`,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discount: Number(coupon.discount),
        discountType: coupon.discountType,
        discountAmount,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Kupon doğrulanamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function getCoupons(req: Request, res: Response): Promise<void> {
  try {
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json({ success: true, coupons });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: 'Kuponlar yüklenemedi.' });
  }
}

export async function createCoupon(req: Request, res: Response): Promise<void> {
  try {
    const { code, discount, discountType, minAmount, maxUses, expiryDate, isActive } = req.body;
    if (!code || discount === undefined) {
      res.status(400).json({ success: false, message: 'Kupon kodu ve indirim oranı/tutarı zorunludur.' });
      return;
    }

    const cleanCode = code.trim().toUpperCase();
    const existing = await prisma.coupon.findUnique({ where: { code: cleanCode } });
    if (existing) {
      res.status(409).json({ success: false, message: 'Bu kupon kodu zaten mevcut.' });
      return;
    }

    const coupon = await prisma.coupon.create({
      data: {
        code: cleanCode,
        discount: parseFloat(discount),
        discountType: discountType || 'percentage',
        discountAmount: discountType === 'fixed' ? parseFloat(discount) : 0,
        minAmount: minAmount ? parseFloat(minAmount) : null,
        maxUses: maxUses ? parseInt(maxUses, 10) : null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      },
    });

    res.status(201).json({ success: true, message: 'Kupon başarıyla oluşturuldu.', coupon });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Kupon oluşturulamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function updateCoupon(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { discount, discountType, minAmount, maxUses, expiryDate, isActive } = req.body;

    const coupon = await prisma.coupon.update({
      where: { id },
      data: {
        ...(discount !== undefined && { discount: parseFloat(discount) }),
        ...(discountType !== undefined && { discountType }),
        ...(minAmount !== undefined && { minAmount: minAmount ? parseFloat(minAmount) : null }),
        ...(maxUses !== undefined && { maxUses: maxUses ? parseInt(maxUses, 10) : null }),
        ...(expiryDate !== undefined && { expiryDate: expiryDate ? new Date(expiryDate) : null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    res.status(200).json({ success: true, message: 'Kupon güncellendi.', coupon });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Kupon güncellenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function deleteCoupon(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    await prisma.coupon.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Kupon silindi.' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Kupon silinemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}
