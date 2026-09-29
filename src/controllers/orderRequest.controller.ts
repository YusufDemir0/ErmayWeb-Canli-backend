import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { validateRequestStateTransition } from '../services/orderStateMachine.service';
import { telegramService } from '../services/telegram.service';
import { syncSingleRequestToErp } from '../jobs/erpOutbox.job';
import {
  QuoteCartSchema,
  CreateOrderRequestSchema,
  UpdateOrderRequestStatusSchema,
  maskCustomerName,
  maskCustomerPhone,
} from '../validations/request.validation';
import { RequestStatus, RequestPreference } from '@prisma/client';

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

    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
      });

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
    const msg = err instanceof Error ? err.message : 'Fiyat teklifi hesaplanamadı.';
    res.status(500).json({ success: false, message: msg });
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
        code: 'WEB-2609-0000',
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
        const isCityDisabled = disabled.some(
          (c) => c.toLocaleLowerCase('tr-TR') === data.city.toLocaleLowerCase('tr-TR')
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
    const idempotencyKey = (req.headers['idempotency-key'] as string) || null;
    if (idempotencyKey) {
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
    }

    // 5. Ürünleri DB'den doğrula ve güncel fiyatları dondur (Snapshot)
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
      const dbProduct = await prisma.product.findUnique({
        where: { id: item.productId },
      });

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
    for (let attempt = 0; attempt < 3; attempt++) {
      const exists = await prisma.orderRequest.findUnique({ where: { code } });
      if (!exists) break;
      code = generateRequestCode();
    }

    const publicToken = crypto.randomBytes(16).toString('hex');
    const targetPreference = data.preference === 'STORE_VISIT' ? RequestPreference.STORE_VISIT : RequestPreference.WHATSAPP;

    // 7. Atomik Veritabanı Kaydı
    const createdRequest = await prisma.$transaction(async (tx) => {
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
      .catch((tgErr) => console.warn('Telegram bildirim hatası:', tgErr));

    res.status(201).json({
      success: true,
      message: 'Sipariş talebiniz başarıyla alındı.',
      code: createdRequest.code,
      publicToken: createdRequest.publicToken,
      status: createdRequest.status,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Sipariş talebi oluşturulamadı.';
    console.error('Create Order Request Error:', err);
    res.status(500).json({ success: false, message: msg });
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
    const msg = err instanceof Error ? err.message : 'Fiş bilgisi getirilemedi.';
    res.status(500).json({ success: false, message: msg });
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
          events: {
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
      staffNote: req.events?.[0]?.note || req.note || null,
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
    const msg = err instanceof Error ? err.message : 'Talepler listelenemedi.';
    res.status(500).json({ success: false, message: msg });
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

    const mappedRequest = {
      ...orderRequest,
      totalAmount: Number(orderRequest.subtotal),
      subtotal: Number(orderRequest.subtotal),
      erpStatus: orderRequest.erpSyncStatus,
      staffNote: orderRequest.events?.slice(-1)[0]?.note || orderRequest.note || null,
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
    const msg = err instanceof Error ? err.message : 'Talep detayı alınamadı.';
    res.status(500).json({ success: false, message: msg });
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
      // Aynı durum: no-op
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

    res.status(200).json({
      success: true,
      message: `Talep durumu "${STATUS_LABELS[targetStatus]}" olarak güncellendi.`,
      request: updated,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Durum güncellenemedi.';
    res.status(400).json({ success: false, message: msg });
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

    // Sıfırla ve yeniden dene
    await prisma.orderRequest.update({
      where: { id: requestId },
      data: {
        erpSyncStatus: 'PENDING',
        erpAttempts: 0,
        erpNextAttemptAt: new Date(),
        erpLastError: null,
      },
    });

    await prisma.orderRequestEvent.create({
      data: {
        requestId,
        type: 'ERP_MANUAL_RETRY',
        actorId: req.user?.userId || 'ADMIN',
        note: 'Admin panelinden manuel ERP gönderimi tetiklendi.',
      },
    });

    const syncResult = await syncSingleRequestToErp(requestId);

    res.status(200).json({
      success: syncResult.success,
      message: syncResult.message,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'ERP senkronizasyonu tetiklenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}
