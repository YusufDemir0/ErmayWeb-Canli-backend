import { prisma } from '../config/database';
import { erpIntegrationService, ErpWebOrderInput } from '../services/erpIntegration.service';
import { telegramService } from '../services/telegram.service';

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
    const erpItems = request.items.map((it) => {
      const targetErpId = it.product?.erpItemId || it.erpItemCodeSnap || it.productId;
      return {
        itemId: targetErpId,
        quantity: it.quantity,
        price: Number(it.unitPriceSnap),
        name: it.productNameSnap,
      };
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
      district: request.district || undefined,
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
    const isFinalFailure = nextAttempts >= 10;

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
          note: `ERP Senkronizasyon Hatası (${nextAttempts}. deneme): ${errorMsg}`,
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
        .catch((tgErr) => console.warn('Telegram bildirim hatası:', tgErr));
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
        WHERE "erpSyncStatus" IN ('PENDING', 'FAILED')
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
        console.error(`[ERP Outbox] Hata (Request ID: ${row.id}):`, itemErr);
      }
    }

    return lockedRows.length;
  } catch (batchErr) {
    console.error('[ERP Outbox] Toplu işleme hatası:', batchErr);
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
      SET "erpSyncStatus" = 'PENDING',
          "erpLastError" = 'İşlem zaman aşımına uğradı, watchdog tarafından sıfırlandı.',
          "updatedAt" = NOW()
      WHERE "erpSyncStatus" = 'IN_PROGRESS'
        AND "erpSaleId" IS NULL
        AND "updatedAt" < NOW() - INTERVAL '10 minutes';
    `;
    if (result > 0) {
      console.warn(`[ERP Outbox Watchdog] ${result} adet zaman aşımına uğramış talep tekrar PENDING kuyruğuna alındı.`);
    }
    return result;
  } catch (err) {
    console.error('[ERP Outbox Watchdog] Hata:', err);
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

  console.log(`⏱️ ERP Outbox Worker aktif edildi (Periyot: ${intervalMs / 1000}s).`);

  // İlk çalıştırma (5 saniye gecikmeyle, sunucu ayağa kalktıktan sonra)
  setTimeout(() => {
    processErpOutboxBatch().catch((err) => console.error('[ERP Outbox Initial] Hata:', err));
  }, 5000);

  // Periyodik Outbox kontrolü
  outboxIntervalTimer = setInterval(() => {
    processErpOutboxBatch().catch((err) => console.error('[ERP Outbox] Hata:', err));
  }, intervalMs);

  // Periyodik Watchdog (Her 10 dakikada bir)
  watchdogIntervalTimer = setInterval(() => {
    runErpOutboxWatchdog().catch((err) => console.error('[ERP Watchdog] Hata:', err));
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
  console.log('⏹️ ERP Outbox Worker durduruldu.');
}
