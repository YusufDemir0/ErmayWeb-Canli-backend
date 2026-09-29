import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

export async function createReturnRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { orderId, reason, notes } = req.body;

    if (!orderId || !reason) {
      res.status(400).json({ success: false, message: 'Sipariş ID ve İade Sebebi zorunludur.' });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order || order.userId !== userId) {
      res.status(404).json({ success: false, message: 'İade edilecek sipariş bulunamadı.' });
      return;
    }

    const returnReq = await prisma.returnRequest.create({
      data: {
        orderId,
        reason,
        notes: notes || null,
      },
    });

    res.status(201).json({
      success: true,
      message: 'İade talebiniz oluşturuldu. Müşteri temsilcilerimiz sizinle iletişime geçecektir.',
      returnRequest: returnReq,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'İade talebi oluşturulurken hata meydana geldi.' });
  }
}

export async function getUserReturnRequests(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;

    const returns = await prisma.returnRequest.findMany({
      where: {
        order: { userId },
      },
      include: {
        order: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ success: true, returns });
  } catch (error) {
    res.status(500).json({ success: false, message: 'İade talepleri getirilemedi.' });
  }
}
