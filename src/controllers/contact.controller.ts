import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { CreateContactMessageSchema } from '../validations';
import { telegramService } from '../services/telegram.service';

/**
 * POST /api/v1/contact
 * İletişim formu mesajını kaydeder ve maskeli Telegram bildirimi gönderir.
 */
export async function createContactMessage(req: Request, res: Response): Promise<void> {
  try {
    // Honeypot: bot tuzağı alanı doluysa DB'ye yazmadan sahte başarılı yanıt dön
    if (req.body.website && String(req.body.website).trim().length > 0) {
      res.status(201).json({ success: true, message: 'Mesajınız alındı.' });
      return;
    }

    const parseResult = CreateContactMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: 'Lütfen form alanlarını kontrol ediniz.',
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parseResult.data;

    await prisma.contactMessage.create({
      data: {
        name: data.name,
        phone: data.phone,
        email: data.email || null,
        subject: data.subject,
        message: data.message,
      },
    });

    telegramService
      .notifyNewContactMessage({ subject: data.subject })
      .catch((tgErr) => console.warn('Telegram bildirim hatası:', tgErr));

    res.status(201).json({ success: true, message: 'Mesajınız alındı.' });
  } catch (err: unknown) {
    console.error('Create Contact Message Error:', err);
    res.status(500).json({ success: false, message: 'Mesajınız iletilemedi. Lütfen daha sonra tekrar deneyiniz.' });
  }
}

/**
 * GET /api/v1/contact
 * Admin & Personel: iletişim mesajlarını listeler (status=open|handled|all).
 */
export async function getContactMessages(req: Request, res: Response): Promise<void> {
  try {
    const { status = 'open', page = '1', limit = '25' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.ContactMessageWhereInput = {};
    if (status === 'open') where.handledAt = null;
    if (status === 'handled') where.handledAt = { not: null };

    const [messages, total, openCount] = await Promise.all([
      prisma.contactMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.contactMessage.count({ where }),
      prisma.contactMessage.count({ where: { handledAt: null } }),
    ]);

    res.status(200).json({
      success: true,
      messages,
      total,
      openCount,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Mesajlar listelenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

/**
 * PATCH /api/v1/contact/:id/handled
 * Admin & Personel: mesajı ilgilenildi / tekrar açık olarak işaretler.
 */
export async function setContactMessageHandled(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const handled = req.body?.handled !== false;

    const existing = await prisma.contactMessage.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Mesaj bulunamadı.' });
      return;
    }

    const updated = await prisma.contactMessage.update({
      where: { id },
      data: { handledAt: handled ? new Date() : null },
    });

    res.status(200).json({ success: true, message: handled ? 'Mesaj ilgilenildi olarak işaretlendi.' : 'Mesaj tekrar açıldı.', contactMessage: updated });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Mesaj güncellenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}
