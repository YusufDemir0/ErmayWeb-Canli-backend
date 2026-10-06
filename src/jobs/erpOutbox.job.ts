import { prisma } from '../config/database';
import { erpIntegrationService, ErpWebOrderInput, ErpOrderItemInput } from '../services/erpIntegration.service';
import { telegramService } from '../services/telegram.service';
import { isCuratedErpId, isPermanentErpError, ErpPermanentError } from '../utils/erp';
import { logger, errorFields } from '../utils/logger';

let outboxIntervalTimer: NodeJS.Timeout | null = null;
let watchdogIntervalTimer: NodeJS.Timeout | null = null;
let isProcessing = false;

/**
 * Tek bir talebi ERP sistemine senkronize eder.
 * Katı kurallar:
 * 1. erpSaleId dolu ise ASLA tekrar gönderilmez (İdempotency).
 * 2. externalRef olarak talebin ID'si iletilir.
 */
export async function syncSingleRequestToErp(requestId: string): Promise<{ success: boolean; message: string }> {
  const request = await prisma.orderRequest.findUnique({
    where: { id: requestId },
    include: {
      items: {
        include: {
          product: true,
        },
      },
      preferredStore: true,
    },
  });

  if (!request) {
    return { success: false, message: 'Talep bulunamadı.' };
  }

  // 1. Zaten ERP'ye iletilmişse tekrar gönderilmesini KESİNLİKLE engelle
  if (request.erpSaleId) {
    if (request.erpSyncStatus !== 'SYNCED') {
      await prisma.orderRequest.update({
        where: { id: requestId },
        data: { erpSyncStatus: 'SYNCED' },
      });
    }
    return { success: true, message: `Talep zaten ERP'ye işlenmiş (ERP Satış Kodu: ${request.erpSaleCode || request.erpSaleId}).` };
  }

  try {
    const erpItems = request.items.map((it): ErpOrderItemInput => {
      const targetErpId = it.product?.erpItemId || it.erpItemCodeSnap || it.product?.erpItemCode;
      if (!targetErpId) {
        throw new ErpPermanentError(`"${it.productNameSnap}" ürününün ERP Sistem ID (erpItemId) veya Kodu bulunamadı.`);
      }
      const line = {
        quantity: it.quantity,
        price: Number(it.unitPriceSnap),
        name: [it.productNameSnap, it.colorLabel].filter(Boolean).join(' - '),
      };
      if (isCuratedErpId(targetErpId)) {
        // ERP'de karşılığı yok: admin deneme ürün kabul ettiyse onunla gönder (gerçek ad satır açıklamasına yazılır)
        if (it.product?.erpPlaceholder && it.product.erpPlaceholderAckAt) {
          return { ...line, placeholder: it.product.erpPlaceholder };
        }
        throw new ErpPermanentError(
          `"${it.productNameSnap}" (${targetErpId}) web kürasyonu bir üründür, ERP'de karşılığı yoktur. ` +
            `Ürün düzenleme ekranında deneme ürün seçip kabul edin ya da ürünü gerçek bir ERP kalemiyle eşleştirip tekrar gönderin.`
        );
      }
      return { ...line, itemId: targetErpId };
    });

    const storeNote = request.preferredStore ? ` | Tercih Edilen Mağaza: ${request.preferredStore.name}` : '';
    const customerNote = request.note ? ` | Müşteri Notu: ${request.note}` : '';

    const payload: ErpWebOrderInput = {
      externalRef: request.id,
      warehouse: 'Web Depo Satış',
      warehouseCode: 'MWDS',
      customerType: 'INDIVIDUAL',
      fullName: request.customerName,
      phone1: request.customerPhone,
      email: request.customerEmail || 'talep@ermaymobilya.com',
      city: request.city,
      // ERP WebOrderDto'da district zorunlu (@IsNotEmpty); ilçesiz talepler kalıcı 400 ile reddedilmesin
      district: request.district?.trim() || 'Belirtilmedi',
      address: request.addressLine || 'Mağazadan / WhatsApp Üzerinden Teslimat',
      orderNote: `Tercih: ${request.preference} | Talep: ${request.code}${storeNote}${customerNote}`,
      totalAmount: Number(request.subtotal),
      items: erpItems,
    };

    const erpResponse = await erpIntegrationService.submitWebOrderToErp(payload);

    await prisma.$transaction(async (tx) => {
      await tx.orderRequest.update({
        where: { id: request.id },
        data: {
          erpSyncStatus: 'SYNCED',
          erpSaleId: erpResponse.saleId,
          erpSaleCode: erpResponse.saleCode,
          erpLastError: null,
        },
      });

      await tx.orderRequestEvent.create({
        data: {
          requestId: request.id,
          type: 'ERP_SYNCED',
          note: `ERP Satış Kodu: ${erpResponse.saleCode} (Satış ID: ${erpResponse.saleId})`,
        },
      });
    });

    return {
      success: true,
      message: `ERP senkronizasyonu başarılı. Satış Kodu: ${erpResponse.saleCode}`,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const nextAttempts = request.erpAttempts + 1;
    const delayMinutes = Math.min(Math.pow(2, nextAttempts), 60);
    const nextAttemptAt = new Date(Date.now() + delayMinutes * 60 * 1000);
    // Kalıcı hatalar (ERP'de olmayan ürün, doğrulama hatası) 10 kez boşuna denenmez: hemen FAILED + alarm
    const isPermanent = isPermanentErpError(err);
    const isFinalFailure = isPermanent || nextAttempts >= 10;

    await prisma.$transaction(async (tx) => {
      await tx.orderRequest.update({
        where: { id: request.id },
        data: {
          erpAttempts: nextAttempts,
          erpLastError: errorMsg,
          erpNextAttemptAt: nextAttemptAt,
          erpSyncStatus: isFinalFailure ? 'FAILED' : 'PENDING',
        },
      });

      await tx.orderRequestEvent.create({
        data: {
          requestId: request.id,
          type: 'ERP_SYNC_FAILED',
          note: `ERP Senkronizasyon Hatası (${nextAttempts}. deneme${isPermanent ? ', kalıcı hata - tekrar denenmeyecek' : ''}): ${errorMsg}`,
        },
      });
    });

    if (isFinalFailure) {
      telegramService
        .notifyErpSyncFailed({
          code: request.code,
          attempts: nextAttempts,
          error: errorMsg,
        })
        .catch((tgErr) => logger.warn('Telegram notification failed', errorFields(tgErr)));
    }

    return { success: false, message: errorMsg };
  }
}

/**
 * Outbox döngüsü:
 * PostgreSQL FOR UPDATE SKIP LOCKED ile eşzamanlı konteynerlerde çakışmasız satır kilitleme.
 */
export async function processErpOutboxBatch(): Promise<number> {
  if (isProcessing) return 0;
  isProcessing = true;

  try {
    // 1. Atomik olarak sıradaki kayıtları IN_PROGRESS'e al ve ID'lerini getir
    const lockedRows = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "order_requests" 
      SET "erpSyncStatus" = 'IN_PROGRESS', 
          "updatedAt" = NOW()
      WHERE id IN (
        SELECT id FROM "order_requests"
        WHERE "erpSyncStatus" = 'PENDING'  -- FAILED yalnızca admin'in manuel "tekrar gönder"i ile yeniden denenir
          AND "erpAttempts" < 10
          AND ("erpNextAttemptAt" IS NULL OR "erpNextAttemptAt" <= NOW())
          AND "erpSaleId" IS NULL
        ORDER BY "createdAt" ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id;
    `;

    if (!lockedRows || lockedRows.length === 0) {
      return 0;
    }

    for (const row of lockedRows) {
      try {
        await syncSingleRequestToErp(row.id);
      } catch (itemErr) {
        logger.error('ERP outbox: request export failed', { 'event.action': 'erp.outbox_export', 'order_request.id': row.id, ...errorFields(itemErr) });
      }
    }

    return lockedRows.length;
  } catch (batchErr) {
    logger.error('ERP outbox: batch failed', { 'event.action': 'erp.outbox_export', ...errorFields(batchErr) });
    return 0;
  } finally {
    isProcessing = false;
  }
}

/**
 * Watchdog:
 * 10 dakikadan uzun süredir IN_PROGRESS kalmış ve erpSaleId'si boş olan kilitlenmiş satırları kurtarır.
 */
export async function runErpOutboxWatchdog(): Promise<number> {
  try {
    const result = await prisma.$executeRaw`
      UPDATE "order_requests"
      SET "erpAttempts" = "erpAttempts" + 1,
          -- CASE metin döndürür; enum kolonuna açık tip dönüşümü gerekir (aksi halde 42804 datatype_mismatch)
          "erpSyncStatus" = (CASE WHEN "erpAttempts" + 1 >= 10 THEN 'FAILED' ELSE 'PENDING' END)::"ErpSyncStatus",
          "erpLastError" = 'İşlem zaman aşımına uğradı, watchdog tarafından sıfırlandı.',
          "updatedAt" = NOW()
      WHERE "erpSyncStatus" = 'IN_PROGRESS'
        AND "erpSaleId" IS NULL
        AND "updatedAt" < NOW() - INTERVAL '10 minutes';
    `;
    if (result > 0) {
      logger.warn('ERP outbox watchdog requeued stale requests', { 'erp.requeued_count': result });
    }
    return result;
  } catch (err) {
    logger.error('ERP outbox watchdog failed', errorFields(err));
    return 0;
  }
}

/**
 * Outbox worker servisini başlatır.
 */
export function startErpOutboxWorker(): void {
  const intervalMs = parseInt(process.env.ERP_OUTBOX_INTERVAL_MS || '60000', 10);

  if (outboxIntervalTimer) {
    clearInterval(outboxIntervalTimer);
  }
  if (watchdogIntervalTimer) {
    clearInterval(watchdogIntervalTimer);
  }

  logger.info('ERP outbox worker started', { 'job.interval_seconds': intervalMs / 1000 });

  // İlk çalıştırma (5 saniye gecikmeyle, sunucu ayağa kalktıktan sonra)
  setTimeout(() => {
    processErpOutboxBatch().catch((err) => logger.error('ERP outbox initial run failed', errorFields(err)));
  }, 5000);

  // Periyodik Outbox kontrolü
  outboxIntervalTimer = setInterval(() => {
    processErpOutboxBatch().catch((err) => logger.error('ERP outbox run failed', errorFields(err)));
  }, intervalMs);

  // Periyodik Watchdog (Her 10 dakikada bir)
  watchdogIntervalTimer = setInterval(() => {
    runErpOutboxWatchdog().catch((err) => logger.error('ERP outbox watchdog run failed', errorFields(err)));
  }, 10 * 60 * 1000);
}

/**
 * Graceful shutdown için worker'ı durdurur.
 */
export function stopErpOutboxWorker(): void {
  if (outboxIntervalTimer) {
    clearInterval(outboxIntervalTimer);
    outboxIntervalTimer = null;
  }
  if (watchdogIntervalTimer) {
    clearInterval(watchdogIntervalTimer);
    watchdogIntervalTimer = null;
  }
  logger.info('ERP outbox worker stopped');
}
