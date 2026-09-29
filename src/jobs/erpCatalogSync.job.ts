import { prisma } from '../config/database';
import { erpIntegrationService, ErpItem } from '../services/erpIntegration.service';
import { canPublishProduct } from '../controllers/product.controller';
import { invalidateCachePattern } from '../utils/cache';

const ADVISORY_LOCK_ID = 42001;
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let syncTimer: NodeJS.Timeout | null = null;
let isJobRunning = false;

export interface CatalogSyncReport {
  totalErpItems: number;
  matchedProducts: number;
  pricesUpdated: number;
  stocksUpdated: number;
  unpublishedMissing: number;
  restoredItems: number;
  errors: number;
  durationMs: number;
}

/**
 * Execute ERP Catalog Synchronization with PostgreSQL Advisory Lock to avoid race conditions.
 */
export async function runCatalogSync(): Promise<CatalogSyncReport | null> {
  const startTime = Date.now();
  const report: CatalogSyncReport = {
    totalErpItems: 0,
    matchedProducts: 0,
    pricesUpdated: 0,
    stocksUpdated: 0,
    unpublishedMissing: 0,
    restoredItems: 0,
    errors: 0,
    durationMs: 0,
  };

  // Try to acquire PostgreSQL session-level advisory lock
  const lockResult = await prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
    SELECT pg_try_advisory_lock(${ADVISORY_LOCK_ID});
  `;

  const acquired = lockResult?.[0]?.pg_try_advisory_lock ?? false;
  if (!acquired) {
    console.log('[CatalogSync] Başka bir instance katalog senkronizasyonunu yürütüyor (Advisory Lock meşgul).');
    return null;
  }

  try {
    console.log('[CatalogSync] 15 dakikalık ERP katalog senkronizasyonu başlatıldı...');

    // 1. Fetch fresh items from ERP
    let erpItems: ErpItem[] = [];
    try {
      erpItems = await erpIntegrationService.fetchErpItems(true);
      report.totalErpItems = erpItems.length;
    } catch (err: unknown) {
      console.error('[CatalogSync] ERP API ürün listesi alınamadı:', err);
      return null;
    }

    const erpMap = new Map<string, ErpItem>();
    erpItems.forEach((item) => {
      erpMap.set(item.id, item);
      if (item.code) {
        erpMap.set(item.code, item);
      }
    });

    // 2. Fetch all non-archived products from ErmayWeb DB
    const dbProducts = await prisma.product.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        erpItemId: true,
        erpItemCode: true,
        price: true,
        stock: true,
        inStock: true,
        isPublished: true,
        images: true,
        image: true,
        erpMissingSince: true,
        archivedAt: true,
      },
    });

    for (const prod of dbProducts) {
      if (!prod.erpItemId) {
        // ERP bağlantısı veya web kürasyon kodu olmayan ürün yayınlanamaz
        if (prod.isPublished) {
          await prisma.product.update({
            where: { id: prod.id },
            data: { isPublished: false },
          });
          report.unpublishedMissing++;
        }
        continue;
      }

      // 1. Web ve Atölye Kürasyonlu Showroom Ürünleri (ERM-*, WEB-*, ATELIER-*)
      // Bu ürünler Modoko showroom ve atölye üretimidir, ERP depo listesinde olmasa dahi
      // canPublishProduct kriterlerine uyduğu sürece yayında kalmalıdır.
      const isCurated = 
        prod.erpItemId.startsWith('ERM-') || 
        prod.erpItemId.startsWith('WEB-') || 
        prod.erpItemId.startsWith('ATELIER-');

      if (isCurated) {
        const canPublish = canPublishProduct({
          images: prod.images,
          image: prod.image,
          price: prod.price,
          erpItemId: prod.erpItemId,
          archivedAt: prod.archivedAt,
        });

        // Eğer canPublish geçerliyse ve daha önce yanlışlıkla yayından çekilmiş veya erpMissingSince atanmışsa, onar
        if (prod.erpMissingSince || (!prod.isPublished && canPublish)) {
          await prisma.product.update({
            where: { id: prod.id },
            data: {
              isPublished: canPublish,
              erpMissingSince: null,
            },
          });
          if (canPublish) report.restoredItems++;
        }
        report.matchedProducts++;
        continue;
      }

      // 2. Standart ERP Entegrasyon Kontrolü
      const erpMatch = erpMap.get(prod.erpItemId) || (prod.erpItemCode ? erpMap.get(prod.erpItemCode) : undefined);

      if (erpMatch) {
        // ERP'de mevcut - Fiyat, stok ve durum güncelle
        report.matchedProducts++;
        const erpPrice = Number(erpMatch.salePrice || 0);
        const erpStock = Number(erpMatch.totalStock || 0);
        const currentPrice = Number(prod.price);

        const priceChanged = Math.abs(currentPrice - erpPrice) > 0.01;
        const stockChanged = prod.stock !== erpStock;

        if (priceChanged) report.pricesUpdated++;
        if (stockChanged) report.stocksUpdated++;

        // canPublishProduct kontrolü
        const canPublish = canPublishProduct({
          images: prod.images,
          image: prod.image,
          price: erpPrice,
          erpItemId: prod.erpItemId,
          archivedAt: prod.archivedAt,
        });

        const shouldPublish = prod.isPublished && canPublish;

        const updateData: Record<string, unknown> = {
          price: erpPrice,
          stock: erpStock,
          inStock: erpStock > 0,
          isPublished: shouldPublish,
        };

        if (prod.erpMissingSince) {
          updateData.erpMissingSince = null;
          report.restoredItems++;
        }

        if (priceChanged || stockChanged || prod.erpMissingSince || prod.isPublished !== shouldPublish) {
          await prisma.product.update({
            where: { id: prod.id },
            data: updateData,
          });
        }
      } else {
        // ERP'de bulunamadı (ERP'den silinmiş veya devredışı bırakılmış standart ERP ürünü)
        if (prod.isPublished || !prod.erpMissingSince) {
          await prisma.product.update({
            where: { id: prod.id },
            data: {
              isPublished: false,
              erpMissingSince: prod.erpMissingSince || new Date(),
            },
          });
          report.unpublishedMissing++;
        }
      }
    }

    report.durationMs = Date.now() - startTime;
    console.log(
      `[CatalogSync] Tamamlandı (${report.durationMs}ms): ${report.matchedProducts}/${report.totalErpItems} ERP eşleşti, ` +
      `${report.pricesUpdated} fiyat güncellendi, ${report.restoredItems} web kürasyonlu ürün korundu/onarıldı, ` +
      `${report.unpublishedMissing} eksik ERP ürünü yayından çekildi.`
    );

    // Invalidate product caches
    await invalidateCachePattern('products:*');

    return report;
  } catch (err: unknown) {
    report.errors++;
    console.error('[CatalogSync] Senkronizasyon sırasında beklenmeyen hata:', err);
    return report;
  } finally {
    // Release advisory lock
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID});`;
  }
}

/**
 * Start the background catalog synchronization loop.
 */
export function startCatalogSyncJob(): void {
  if (syncTimer) {
    console.log('[CatalogSync] İş zaten çalışıyor.');
    return;
  }

  console.log('[CatalogSync] 15 dakikalık periyodik katalog senkronizasyon işi kuruldu.');

  const tick = async () => {
    if (isJobRunning) return;
    isJobRunning = true;
    try {
      await runCatalogSync();
    } catch (err) {
      console.error('[CatalogSync] Döngü hatası:', err);
    } finally {
      isJobRunning = false;
    }
  };

  // Run first sync 15 seconds after server boot, then every 15 minutes
  setTimeout(() => {
    tick();
  }, 15000);

  syncTimer = setInterval(tick, SYNC_INTERVAL_MS);
}

/**
 * Gracefully stop the catalog sync job.
 */
export function stopCatalogSyncJob(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.log('[CatalogSync] Katalog senkronizasyon işi durduruldu.');
  }
}
