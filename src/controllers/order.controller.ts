import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { validateRequestStateTransition } from '../services/orderStateMachine.service';
import { telegramService } from '../services/telegram.service';
import { dailyReportService } from '../services/dailyReport.service';
import { RequestStatus, RequestPreference, PaymentChannel } from '@prisma/client';

interface CartItemInput {
  productId?: string;
  product?: { id: string };
  colorKey?: string;
  colorLabel?: string;
  quantity: number;
}

/**
 * Generate unique immutable order request code: WEB-YYMM-XXXX
 */
function generateRequestCode(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `WEB-${yy}${mm}-${rand}`;
}

/**
 * POST /api/v1/orders or POST /api/v1/requests
 * Creates a new OrderRequest (Talep) from shopping cart.
 */
export async function createOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      items,
      customerName,
      customerPhone,
      customerEmail,
      city,
      district,
      addressLine,
      shippingCity,
      shippingDistrict,
      shippingAddressLine,
      note,
      orderNote,
      preference,
      preferredStoreId,
      kvkkNoticeAcknowledged,
      marketingConsent,
      website, // Honeypot field
    } = req.body;

    // 1. Honeypot check (Bot protection)
    if (website && String(website).trim().length > 0) {
      res.status(400).json({ success: false, message: 'Geçersiz form gönderimi.' });
      return;
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, message: 'Sipariş sepeti boş olamaz.' });
      return;
    }

    if (items.length > 30) {
      res.status(400).json({ success: false, message: 'Bir talepte en fazla 30 farklı ürün bulunabilir.' });
      return;
    }

    const finalName = (customerName || '').trim();
    const finalPhone = (customerPhone || '').trim();
    const finalCity = (city || shippingCity || 'İstanbul').trim();
    const finalDistrict = (district || shippingDistrict || '').trim();
    const finalAddress = (addressLine || shippingAddressLine || '').trim();
    const finalNote = (note || orderNote || '').trim();

    if (!finalName || !finalPhone) {
      res.status(400).json({
        success: false,
        message: 'Lütfen Ad Soyad ve İletişim Telefonu alanlarını eksiksiz doldurunuz.',
      });
      return;
    }

    // Check delivery zone availability
    try {
      const deliveryBlock = await prisma.cmsBlock.findUnique({
        where: { key: 'delivery_zones' },
      });

      if (deliveryBlock && deliveryBlock.content) {
        const zones = deliveryBlock.content as { disabledCityNames?: string[] };
        const disabled = zones.disabledCityNames || [];
        const isCityDisabled = disabled.some(
          (c) => c.toLocaleLowerCase('tr-TR') === finalCity.toLocaleLowerCase('tr-TR')
        );
        if (isCityDisabled) {
          res.status(400).json({
            success: false,
            message: `Üzgünüz, geçici olarak ${finalCity} iline mobilya teslimat hizmetimiz bulunmamaktadır.`,
          });
          return;
        }
      }
    } catch {
      // Fallback
    }

    // 2. Resolve items, snapshot prices from database (NEVER TRUST CLIENT PRICES)
    let totalSubtotal = 0;
    const resolvedItems: Array<{
      productId: string;
      productName: string;
      erpItemCode: string | null;
      colorKey: string | null;
      colorLabel: string | null;
      unitPrice: number;
      quantity: number;
      lineTotal: number;
    }> = [];

    for (const item of items as CartItemInput[]) {
      const pid = item.productId || item.product?.id;
      if (!pid) {
        res.status(400).json({ success: false, message: 'Sepette geçersiz ürün ID.' });
        return;
      }

      const qty = Math.max(1, Math.min(20, parseInt(String(item.quantity), 10) || 1));

      const dbProduct = await prisma.product.findUnique({
        where: { id: pid },
      });

      if (!dbProduct || !dbProduct.isPublished || dbProduct.archivedAt) {
        res.status(400).json({
          success: false,
          message: `Sepetteki "${dbProduct?.name || pid}" ürünü şu anda satışta değildir.`,
        });
        return;
      }

      const unitPrice = Number(dbProduct.price);
      const lineTotal = unitPrice * qty;
      totalSubtotal += lineTotal;

      resolvedItems.push({
        productId: dbProduct.id,
        productName: dbProduct.name,
        erpItemCode: dbProduct.erpItemCode,
        colorKey: item.colorKey || null,
        colorLabel: item.colorLabel || null,
        unitPrice,
        quantity: qty,
        lineTotal,
      });
    }

    // 3. Idempotency Key check
    const idempotencyKey = (req.headers['idempotency-key'] as string) || null;
    if (idempotencyKey) {
      const existingReq = await prisma.orderRequest.findUnique({
        where: { idempotencyKey },
      });
      if (existingReq) {
        res.status(200).json({
          success: true,
          message: 'Talep daha önce oluşturulmuştu.',
          code: existingReq.code,
          publicToken: existingReq.publicToken,
          status: existingReq.status,
        });
        return;
      }
    }

    // 4. Generate unique request code (up to 3 retries on collision)
    let code = generateRequestCode();
    for (let attempt = 0; attempt < 3; attempt++) {
      const exists = await prisma.orderRequest.findUnique({ where: { code } });
      if (!exists) break;
      code = generateRequestCode();
    }

    const targetPreference = preference === 'STORE_VISIT' ? RequestPreference.STORE_VISIT : RequestPreference.WHATSAPP;

    // 5. Create OrderRequest in a transaction with items and event
    const publicToken = crypto.randomUUID();

    const createdRequest = await prisma.$transaction(async (tx) => {
      const newRequest = await tx.orderRequest.create({
        data: {
          code,
          publicToken,
          idempotencyKey,
          status: RequestStatus.NEW,
          preference: targetPreference,
          preferredStoreId: preferredStoreId || null,
          customerName: finalName,
          customerPhone: finalPhone,
          customerEmail: customerEmail ? String(customerEmail).trim().toLowerCase() : null,
          city: finalCity,
          district: finalDistrict || null,
          addressLine: finalAddress || null,
          note: finalNote || null,
          subtotal: totalSubtotal,
          itemCount: resolvedItems.length,
          kvkkNoticeAckAt: new Date(),
          marketingConsent: Boolean(marketingConsent),
          erpSyncStatus: 'PENDING',
        },
      });

      // Create items
      for (const it of resolvedItems) {
        await tx.orderRequestItem.create({
          data: {
            requestId: newRequest.id,
            productId: it.productId,
            productNameSnap: it.productName,
            erpItemCodeSnap: it.erpItemCode,
            colorKey: it.colorKey,
            colorLabel: it.colorLabel,
            unitPriceSnap: it.unitPrice,
            quantity: it.quantity,
            lineTotal: it.lineTotal,
          },
        });
      }

      // Initial audit event
      await tx.orderRequestEvent.create({
        data: {
          requestId: newRequest.id,
          type: 'STATUS_CHANGE',
          toStatus: RequestStatus.NEW,
          note: 'Sipariş talebi web sitesi üzerinden oluşturuldu.',
        },
      });

      return newRequest;
    });

    // Send masked telegram notification
    telegramService
      .notifyNewRequest({
        code: createdRequest.code,
        subtotal: totalSubtotal,
        preference: targetPreference,
        city: finalCity,
        district: finalDistrict,
        itemCount: resolvedItems.length,
      })
      .catch((tgErr) => console.warn('Telegram notification failed:', tgErr));

    res.status(201).json({
      success: true,
      message: 'Sipariş talebiniz başarıyla alındı.',
      code: createdRequest.code,
      publicToken: createdRequest.publicToken,
      status: createdRequest.status,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Sipariş talebi oluşturulamadı.';
    console.error('Create Request Error:', err);
    res.status(500).json({ success: false, message: msg });
  }
}

/**
 * GET /api/v1/orders/all or /api/v1/admin/requests
 * Admin & Staff order requests listing.
 */
export async function getAllOrders(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { status, search, page = '1', limit = '25' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (status && status !== 'all') {
      where.status = status as RequestStatus;
    }

    if (search) {
      const q = String(search).trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { customerPhone: { contains: q } },
        { city: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [requests, totalCount] = await Promise.all([
      prisma.orderRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        include: {
          items: true,
          preferredStore: true,
        },
      }),
      prisma.orderRequest.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      requests,
      orders: requests, // backward-compat alias
      total: totalCount,
      page: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Talepler listelenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

/**
 * PATCH /api/v1/orders/:id/status or /api/v1/admin/requests/:id/status
 * Updates status of an OrderRequest according to state machine.
 */
export async function updateOrderStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const requestId = req.params.id as string;
    const { status: targetStatus, note } = req.body;

    const existing = await prisma.orderRequest.findUnique({
      where: { id: requestId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Talep bulunamadı.' });
      return;
    }

    const shouldTransition = validateRequestStateTransition(existing.status, targetStatus as RequestStatus);

    if (!shouldTransition) {
      // No-op: same status
      res.status(200).json({ success: true, message: 'Talep durumu aynı.', request: existing });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const reqUpdated = await tx.orderRequest.update({
        where: { id: requestId },
        data: {
          status: targetStatus as RequestStatus,
          closedAt: ['COMPLETED', 'CANCELLED', 'SPAM', 'EXPIRED'].includes(targetStatus) ? new Date() : null,
        },
      });

      await tx.orderRequestEvent.create({
        data: {
          requestId,
          type: 'STATUS_CHANGE',
          fromStatus: existing.status,
          toStatus: targetStatus as RequestStatus,
          actorId: req.user?.userId || 'STAFF',
          note: note ? String(note).trim() : null,
        },
      });

      return reqUpdated;
    });

    res.status(200).json({
      success: true,
      message: `Talep durumu "${targetStatus}" olarak güncellendi.`,
      request: updated,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Durum güncellenemedi.';
    res.status(400).json({ success: false, message: msg });
  }
}

/**
 * POST /api/v1/orders/:id/approve-payment
 * Approves payment offline (WhatsApp wire transfer or in-store).
 */
export async function approveOrderPayment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const requestId = req.params.id as string;

    const existing = await prisma.orderRequest.findUnique({
      where: { id: requestId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Talep bulunamadı.' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.orderRequest.update({
        where: { id: requestId },
        data: {
          status: RequestStatus.PAID_OFFLINE,
          paymentChannel: PaymentChannel.WHATSAPP_TRANSFER,
        },
      });

      await tx.orderRequestEvent.create({
        data: {
          requestId,
          type: 'STATUS_CHANGE',
          fromStatus: existing.status,
          toStatus: RequestStatus.PAID_OFFLINE,
          actorId: req.user?.userId || 'ADMIN',
          note: 'Ödeme personel tarafından teyit edildi.',
        },
      });

      return u;
    });

    res.status(200).json({
      success: true,
      message: 'Ödeme onaylandı, talep durumu güncellendi.',
      request: updated,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Ödeme onaylanamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function triggerDailySalesReport(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const result = await dailyReportService.generateAndSendDailyReport();
    res.status(200).json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Günlük rapor oluşturulamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function getOrderByNumber(_req: Request, res: Response): Promise<void> {
  res.status(404).json({
    success: false,
    message: 'Bu uç nokta güvenlik ve gizlilik gereği kapatılmıştır.',
  });
}

export async function getUserOrders(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ success: true, orders: [] });
}

export async function uploadReceipt(_req: Request, res: Response): Promise<void> {
  res.status(410).json({
    success: false,
    message: 'Dekont yükleme uç noktası kapatılmıştır.',
  });
}
