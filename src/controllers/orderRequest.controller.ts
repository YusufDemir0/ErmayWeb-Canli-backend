import { sendServerError } from '../utils/httpError';
import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { validateRequestStateTransition, InvalidRequestStateTransitionError } from '../services/orderStateMachine.service';
import { telegramService } from '../services/telegram.service';
import { syncSingleRequestToErp } from '../jobs/erpOutbox.job';
import {
  QuoteCartSchema,
  CreateOrderRequestSchema,
  UpdateOrderRequestStatusSchema,
  maskCustomerName,
  maskCustomerPhone,
} from '../validations/request.validation';
import { Prisma, RequestStatus, RequestPreference } from '@prisma/client';
import { normalizeTurkishText } from '../utils/slug';
import { dailyReportService } from '../services/dailyReport.service';
import { invalidateCachePattern } from '../utils/cache';
import { logger, errorFields } from '../utils/logger';

/**
 * Generate unique immutable order request code: WEB-YYMM-XXXX
 * Uses cryptographic randomness to prevent predictable sequential enumeration.
 */
function generateRequestCode(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(crypto.randomInt(0, chars.length));
  }
  return `WEB-${yy}${mm}-${rand}`;
}

const STATUS_LABELS: Record<RequestStatus, string> = {
  NEW: 'Talebiniz Alındı',
  CONTACTED: 'İletişime Geçildi',
  STORE_VISIT_SCHEDULED: 'Mağaza Ziyareti Planlandı',
  AWAITING_PAYMENT: 'Ödeme Bekleniyor',
  PAID_OFFLINE: 'Ödeme Teyit Edildi',
  COMPLETED: 'Sipariş Tamamlandı',
  CANCELLED: 'Talep İptal Edildi',
  SPAM: 'Geçersiz / Spam',
  EXPIRED: 'Zaman Aşımı',
};

/**
 * POST /api/v1/cart/quote
 * Sepetteki ürünlerin güncel DB fiyatlarını sorgular, satır toplamlarını ve alt toplamı hesaplar.
 */
export async function quoteCart(req: Request, res: Response): Promise<void> {
  try {
    const parseResult = QuoteCartSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: 'Sepet verisi geçersiz.',
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const { items } = parseResult.data;
    let subtotal = 0;
    let totalUnits = 0;
    const quotedItems = [];

    // N+1 Sorgu Optimizasyonu: Tek sorguda tüm ürünleri çek
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of items) {
      const product = productMap.get(item.productId);

      if (!product || !product.isPublished || product.archivedAt) {
        res.status(400).json({
          success: false,
          message: `Sepetteki "${product?.name || item.productId}" ürünü şu anda yayında veya satışta değildir.`,
        });
        return;
      }

      const unitPrice = Number(product.price);
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
      totalUnits += item.quantity;

      quotedItems.push({
        productId: product.id,
        name: product.name,
        slug: product.slug,
        image: product.image || (product.images && product.images[0]) || '',
        colorKey: item.colorKey || null,
        unitPrice,
        quantity: item.quantity,
        lineTotal,
        inStock: product.inStock,
        leadTimeDays: product.leadTimeDays || 15,
      });
    }

    res.status(200).json({
      success: true,
      quote: {
        items: quotedItems,
        subtotal,
        itemCount: quotedItems.length,
        totalUnits,
        quotedAt: new Date().toISOString(),
      },
    });
  } catch (err: unknown) {
    sendServerError(res, err, 'Fiyat teklifi hesaplanamadı.');
  }
}

/**
 * POST /api/v1/requests (veya /api/v1/orders)
 * Müşteriden sepet ve iletişim bilgilerini alıp güvenli bir Sipariş Talebi oluşturur.
 */
export async function createOrderRequest(req: Request, res: Response): Promise<void> {
  try {
    // 1. Honeypot kontrolü (Bot engelleme)
    if (req.body.website && String(req.body.website).trim().length > 0) {
      // Bot tuzağı: DB'ye yazmadan sahte başarılı yanıt dön
      res.status(201).json({
        success: true,
        message: 'Sipariş talebiniz başarıyla alındı.',
        code: generateRequestCode(),
        publicToken: crypto.randomBytes(16).toString('hex'),
        status: 'NEW',
      });
      return;
    }

    // 2. Zod Doğrulama
    const parseResult = CreateOrderRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: 'Lütfen form alanlarını kontrol ediniz.',
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parseResult.data;

    // 3. Teslimat bölgesi kısıt kontrolü (CMS)
    try {
      const deliveryBlock = await prisma.cmsBlock.findUnique({
        where: { key: 'delivery_zones' },
      });
      if (deliveryBlock && deliveryBlock.content) {
        const zones = deliveryBlock.content as { disabledCityNames?: string[] };
        const disabled = zones.disabledCityNames || [];
        const normalizedCity = normalizeTurkishText(data.city);
        const isCityDisabled = disabled.some(
          (c) => normalizeTurkishText(c) === normalizedCity
        );
        if (isCityDisabled) {
          res.status(400).json({
            success: false,
            message: `Üzgünüz, geçici olarak ${data.city} iline mobilya teslimat hizmetimiz bulunmamaktadır.`,
          });
          return;
        }
      }
    } catch {
      // Hata durumunda akışı engelleme
    }

    // 4. Idempotency Key kontrolü (Çift tık / çift gönderim koruması)
    // Başlık göndermeyen eski istemciler reddedilmez (geriye dönük uyumluluk); yalnızca çift gönderim koruması
    // olmadan tek seferlik anahtar atanır. Web sitesi her zaman başlığı gönderir.
    const idempotencyKey = (req.headers['idempotency-key'] as string)?.trim() || `srv-${crypto.randomUUID()}`;

    const existing = await prisma.orderRequest.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      res.status(200).json({
        success: true,
        message: 'Talep daha önce oluşturulmuştu.',
        code: existing.code,
        publicToken: existing.publicToken,
        status: existing.status,
      });
      return;
    }

    // 5. Ürünleri DB'den tek sorguda doğrula ve dondur (Snapshot - N+1 Fix)
    const productIds = data.items.map((i) => i.productId);
    const dbProducts = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    const dbProductMap = new Map(dbProducts.map((p) => [p.id, p]));

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

    for (const item of data.items) {
      const dbProduct = dbProductMap.get(item.productId);

      if (!dbProduct || !dbProduct.isPublished || dbProduct.archivedAt) {
        res.status(400).json({
          success: false,
          message: `Sepetteki "${dbProduct?.name || item.productId}" ürünü şu anda satışta değildir.`,
        });
        return;
      }

      const unitPrice = Number(dbProduct.price);
      const lineTotal = unitPrice * item.quantity;
      totalSubtotal += lineTotal;

      resolvedItems.push({
        productId: dbProduct.id,
        productName: dbProduct.name,
        erpItemCode: dbProduct.erpItemCode,
        colorKey: item.colorKey || null,
        colorLabel: item.colorLabel || null,
        unitPrice,
        quantity: item.quantity,
        lineTotal,
      });
    }

    // 6. Benzersiz Kod ve Kriptografik Public Token Üretimi
    let code = generateRequestCode();
    for (let attempt = 0; attempt < 8; attempt++) {
      const exists = await prisma.orderRequest.findUnique({ where: { code } });
      if (!exists) break;
      code = generateRequestCode();
    }

    const publicToken = crypto.randomBytes(16).toString('hex');
    const targetPreference = data.preference === 'STORE_VISIT' ? RequestPreference.STORE_VISIT : RequestPreference.WHATSAPP;

    // 7. Atomik Veritabanı Kaydı (TOCTOU P2002 yakalamalı)
    let createdRequest;
    try {
      createdRequest = await prisma.$transaction(async (tx) => {
        const newRequest = await tx.orderRequest.create({
          data: {
            code,
            publicToken,
            idempotencyKey,
            status: RequestStatus.NEW,
            preference: targetPreference,
            preferredStoreId: data.preferredStoreId || null,
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            customerEmail: data.customerEmail || null,
            city: data.city,
            district: data.district || null,
            addressLine: data.addressLine || null,
            note: data.note || null,
            subtotal: totalSubtotal,
            itemCount: resolvedItems.length,
            kvkkNoticeAckAt: new Date(),
            marketingConsent: Boolean(data.marketingConsent),
            erpSyncStatus: 'PENDING',
            erpAttempts: 0,
            erpNextAttemptAt: new Date(),
          },
        });

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

        await tx.orderRequestEvent.create({
          data: {
            requestId: newRequest.id,
            type: 'STATUS_CHANGE',
            toStatus: RequestStatus.NEW,
            note: 'Sipariş talebi web sitesinden oluşturuldu.',
          },
        });

        return newRequest;
      });
    } catch (createErr: unknown) {
      const prismaErr = createErr as { code?: string };
      if (prismaErr?.code === 'P2002') {
        const existingAfterRace = await prisma.orderRequest.findUnique({
          where: { idempotencyKey },
        });
        if (existingAfterRace) {
          res.status(200).json({
            success: true,
            message: 'Talep daha önce oluşturulmuştu.',
            code: existingAfterRace.code,
            publicToken: existingAfterRace.publicToken,
            status: existingAfterRace.status,
          });
          return;
        }
      }
      throw createErr;
    }

    // 8. Maskeli Telegram Bildirimi (Arka planda)
    telegramService
      .notifyNewRequest({
        code: createdRequest.code,
        subtotal: totalSubtotal,
        preference: targetPreference,
        city: data.city,
        district: data.district || undefined,
        itemCount: resolvedItems.length,
      })
      .catch((tgErr) => logger.warn('Telegram notification failed', errorFields(tgErr)));

    res.status(201).json({
      success: true,
      message: 'Sipariş talebiniz başarıyla alındı.',
      code: createdRequest.code,
      publicToken: createdRequest.publicToken,
      status: createdRequest.status,
    });
  } catch (err: unknown) {
    sendServerError(res, err, 'Sipariş talebi oluşturulamadı.', 'Order request create failed');
  }
}

/**
 * GET /api/v1/requests/public/:token
 * Müşteriye sunulacak maskeli fiş DTO'su (Adres, tam telefon, e-posta ASLA dönülmez).
 */
export async function getPublicReceipt(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.params;

    if (!token || typeof token !== 'string') {
      res.status(400).json({ success: false, message: 'Geçersiz fiş tokenı.' });
      return;
    }

    const orderRequest = await prisma.orderRequest.findUnique({
      where: { publicToken: token },
      include: {
        items: true,
        preferredStore: true,
      },
    });

    if (!orderRequest) {
      res.status(404).json({
        success: false,
        message: 'Talep bulunamadı veya bağlantı geçersiz.',
      });
      return;
    }

    const responseDto = {
      code: orderRequest.code,
      status: orderRequest.status,
      statusLabel: STATUS_LABELS[orderRequest.status] || orderRequest.status,
      createdAt: orderRequest.createdAt.toISOString(),
      maskedName: maskCustomerName(orderRequest.customerName),
      maskedPhone: maskCustomerPhone(orderRequest.customerPhone),
      city: orderRequest.city,
      district: orderRequest.district,
      preference: orderRequest.preference,
      preferredStore: orderRequest.preferredStore
        ? {
            name: orderRequest.preferredStore.name,
            address: orderRequest.preferredStore.address,
            phone: orderRequest.preferredStore.phone,
            hours: orderRequest.preferredStore.hours,
            mapUrl: orderRequest.preferredStore.mapUrl,
          }
        : null,
      items: orderRequest.items.map((it) => ({
        productName: it.productNameSnap,
        colorLabel: it.colorLabel,
        quantity: it.quantity,
        unitPrice: Number(it.unitPriceSnap),
        lineTotal: Number(it.lineTotal),
      })),
      subtotal: Number(orderRequest.subtotal),
      officialIbanNotice:
        'Ödemelerinizi yalnızca Ermay Mobilya San. Tic. Ltd. Şti. adına kayıtlı resmi şirket banka hesaplarımıza yapınız. Şahıs hesaplarına ödeme talep edilmez.',
    };

    res.status(200).json({
      success: true,
      request: responseDto,
    });
  } catch (err: unknown) {
    sendServerError(res, err, 'Fiş bilgisi getirilemedi.');
  }
}

/**
 * GET /api/v1/admin/requests
 * Admin & Personel talep listeleme ve filtreleme
 */
export async function getAdminRequests(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { status, preference, erpSyncStatus, search, page = '1', limit = '25' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (status && status !== 'all') {
      where.status = status as RequestStatus;
    }
    if (preference && preference !== 'all') {
      where.preference = preference as RequestPreference;
    }
    if (erpSyncStatus && erpSyncStatus !== 'all') {
      where.erpSyncStatus = erpSyncStatus;
    }

    if (search) {
      const q = String(search).trim();
      const phoneDigits = q.replace(/\D/g, '');
      const searchConditions: Prisma.OrderRequestWhereInput[] = [
        { code: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ];
      if (phoneDigits.length >= 3) {
        searchConditions.push({ customerPhone: { contains: phoneDigits } });
      }
      where.OR = searchConditions;
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
          events: {
            where: {
              type: { in: ['NOTE', 'STATUS_CHANGE', 'MANUAL_NOTE'] },
              note: { not: null },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.orderRequest.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum) || 1;

    // Map Prisma models to AdminOrderRequest DTO to guarantee frontend compatibility
    const mappedRequests = requests.map((req) => ({
      ...req,
      totalAmount: Number(req.subtotal),
      subtotal: Number(req.subtotal),
      erpStatus: req.erpSyncStatus,
      staffNote: (req.events?.[0]?.note && req.events[0].note.trim() !== '') ? req.events[0].note : req.note || null,
      items: req.items.map((it) => ({
        ...it,
        productName: it.productNameSnap,
        unitPrice: Number(it.unitPriceSnap),
        lineTotal: Number(it.lineTotal),
      })),
    }));

    res.status(200).json({
      success: true,
      requests: mappedRequests,
      total: totalCount,
      page: pageNum,
      totalPages,
      pagination: {
        total: totalCount,
        page: pageNum,
        totalPages,
        limit: limitNum,
      },
    });
  } catch (err: unknown) {
    sendServerError(res, err, 'Talepler listelenemedi.');
  }
}

/**
 * GET /api/v1/admin/requests/:id
 * Admin talep detay görünümü (Tam kişisel veriler, audit olay geçmişi)
 */
export async function getAdminRequestById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const requestId = req.params.id as string;

    const orderRequest = await prisma.orderRequest.findUnique({
      where: { id: requestId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        events: {
          orderBy: { createdAt: 'asc' },
        },
        preferredStore: true,
      },
    });

    if (!orderRequest) {
      res.status(404).json({ success: false, message: 'Talep bulunamadı.' });
      return;
    }

    const lastStaffEvent = [...(orderRequest.events || [])]
      .reverse()
      .find(
        (e) =>
          (e.type === 'NOTE' || e.type === 'STATUS_CHANGE' || e.type === 'MANUAL_NOTE') &&
          e.note &&
          e.note.trim() !== ''
      );
    const staffNote = lastStaffEvent?.note || orderRequest.note || null;

    const mappedRequest = {
      ...orderRequest,
      totalAmount: Number(orderRequest.subtotal),
      subtotal: Number(orderRequest.subtotal),
      erpStatus: orderRequest.erpSyncStatus,
      staffNote,
      items: orderRequest.items.map((it) => ({
        ...it,
        productName: it.productNameSnap,
        unitPrice: Number(it.unitPriceSnap),
        lineTotal: Number(it.lineTotal),
      })),
    };

    res.status(200).json({
      success: true,
      request: mappedRequest,
    });
  } catch (err: unknown) {
    sendServerError(res, err, 'Talep detayı alınamadı.');
  }
}

/**
 * PATCH /api/v1/admin/requests/:id/status
 * Durum makinesi kurallarına göre talep durumunu günceller ve olay kaydeder.
 */
export async function updateRequestStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const requestId = req.params.id as string;

    const parseResult = UpdateOrderRequestStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: 'Geçersiz durum güncelleme verisi.',
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const { status: targetStatus, note, staffNote, assignedToId } = parseResult.data as {
      status: RequestStatus;
      note?: string | null;
      staffNote?: string | null;
      assignedToId?: string | null;
    };
    const effectiveNote = (note || staffNote || '').trim() || null;

    const existing = await prisma.orderRequest.findUnique({
      where: { id: requestId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Talep bulunamadı.' });
      return;
    }

    const shouldTransition = validateRequestStateTransition(existing.status, targetStatus);

    if (!shouldTransition) {
      // Aynı durum: durum değişmez ama personel notu varsa kaybolmasın (önceden sessizce atılıyordu)
      if (effectiveNote) {
        await prisma.orderRequestEvent.create({
          data: {
            requestId,
            type: 'NOTE',
            actorId: req.user?.userId || 'ADMIN',
            note: effectiveNote,
          },
        });
        res.status(200).json({ success: true, message: 'Personel notu kaydedildi.', request: existing });
        return;
      }
      res.status(200).json({ success: true, message: 'Talep durumu zaten bu değerde.', request: existing });
      return;
    }

    const terminalStatuses: RequestStatus[] = ['COMPLETED', 'CANCELLED', 'SPAM', 'EXPIRED'];
    const isTerminal = terminalStatuses.includes(targetStatus);

    const updated = await prisma.$transaction(async (tx) => {
      const reqUpdated = await tx.orderRequest.update({
        where: { id: requestId },
        data: {
          status: targetStatus,
          closedAt: isTerminal ? new Date() : null,
          assignedToId: assignedToId !== undefined ? assignedToId : existing.assignedToId,
        },
      });

      // V-14: Increment product salesCount if transition is to PAID_OFFLINE or COMPLETED
      const isPaidNow =
        (targetStatus === 'PAID_OFFLINE' || targetStatus === 'COMPLETED') &&
        existing.status !== 'PAID_OFFLINE' &&
        existing.status !== 'COMPLETED';

      if (isPaidNow) {
        const items = await tx.orderRequestItem.findMany({
          where: { requestId },
          select: { productId: true, quantity: true },
        });
        for (const item of items) {
          if (item.productId) {
            await tx.product.update({
              where: { id: item.productId },
              data: { salesCount: { increment: item.quantity } },
            }).catch(() => {});
          }
        }
      }

      await tx.orderRequestEvent.create({
        data: {
          requestId,
          type: 'STATUS_CHANGE',
          fromStatus: existing.status,
          toStatus: targetStatus,
          actorId: req.user?.userId || 'ADMIN',
          note: effectiveNote,
        },
      });

      return reqUpdated;
    });

    const isPaidNow =
      (targetStatus === 'PAID_OFFLINE' || targetStatus === 'COMPLETED') &&
      existing.status !== 'PAID_OFFLINE' &&
      existing.status !== 'COMPLETED';
    if (isPaidNow) {
      await invalidateCachePattern('products:*').catch(() => {});
    }

    res.status(200).json({
      success: true,
      message: `Talep durumu "${STATUS_LABELS[targetStatus]}" olarak güncellendi.`,
      request: updated,
    });
  } catch (err: unknown) {
    if (err instanceof InvalidRequestStateTransitionError) {
      res.status(409).json({ success: false, message: err.message });
      return;
    }
    sendServerError(res, err, 'Durum güncellenemedi.', 'Order request status update failed');
  }
}

/**
 * POST /api/v1/admin/requests/:id/retry-erp
 * Admin panelinden ERP senkronizasyonunu manuel olarak yeniden tetikler.
 */
export async function retryErpSync(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const requestId = req.params.id as string;

    const existing = await prisma.orderRequest.findUnique({
      where: { id: requestId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Talep bulunamadı.' });
      return;
    }

    if (existing.erpSaleId) {
      res.status(400).json({
        success: false,
        message: `Bu talep zaten ERP'ye aktarılmış (Satış Kodu: ${existing.erpSaleCode || existing.erpSaleId}).`,
      });
      return;
    }

    // Atomik Claim: Kaydı başka bir worker veya eşzamanlı admin işlemine karşı kilitle
    const claimed = await prisma.orderRequest.updateMany({
      where: {
        id: requestId,
        erpSyncStatus: { in: ['PENDING', 'FAILED'] },
        erpSaleId: null,
      },
      data: {
        erpSyncStatus: 'IN_PROGRESS',
        erpLastError: null,
      },
    });

    if (claimed.count === 0) {
      res.status(409).json({
        success: false,
        message: 'Bu talep şu anda başka bir işlem tarafından yürütülüyor veya zaten aktarılmış.',
      });
      return;
    }

    await prisma.orderRequestEvent.create({
      data: {
        requestId,
        type: 'ERP_MANUAL_RETRY',
        actorId: req.user?.userId || 'ADMIN',
        note: 'Admin panelinden manuel ERP gönderimi tetiklendi.',
      },
    });

    // Non-blocking asynchronous dispatch so HTTP thread is not tied up for ERP timeout duration
    setImmediate(async () => {
      try {
        await syncSingleRequestToErp(requestId);
      } catch (syncErr) {
        logger.error('ERP retry sync failed', { 'order_request.id': requestId, ...errorFields(syncErr) });
      }
    });

    res.status(202).json({
      success: true,
      message: 'ERP senkronizasyon talebi sıraya alındı ve arka planda işleme başlatıldı.',
    });
  } catch (err: unknown) {
    sendServerError(res, err, 'ERP senkronizasyonu tetiklenemedi.');
  }
}

/**
 * POST /api/v1/orders/daily-report or /api/v1/requests/daily-report (Admin only)
 * Triggers daily summary digest calculation and dispatches masked report to Telegram.
 */
export async function triggerDailySalesReport(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const result = await dailyReportService.generateAndSendDailyReport();
    res.status(200).json(result);
  } catch (error: unknown) {
    sendServerError(res, error, 'Günlük rapor oluşturulamadı.');
  }
}
