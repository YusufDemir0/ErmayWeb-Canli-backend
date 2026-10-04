import { prisma } from '../config/database';
import { erpIntegrationService, ErpItem } from '../services/erpIntegration.service';
import { canPublishProduct } from '../controllers/product.controller';
import { invalidateCachePattern } from '../utils/cache';
import { telegramService } from '../services/telegram.service';
import { isCuratedErpId } from '../utils/erp';

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
  aborted?: boolean;
  abortReason?: string;
}

// Bir senkronda yayındaki ERP bağlı ürünlerin en fazla bu oranı "ERP'de yok" sayılıp kaldırılabilir.
const MAX_MISSING_RATIO = Number(process.env.CATALOG_SYNC_MAX_MISSING_RATIO || '0.3');
// Bu sayının altındaki kayıplarda oran kontrolü uygulanmaz (küçük kataloglarda tek ürün silmek normaldir).
const MIN_MISSING_FOR_GUARD = 5;

/**
 * Pure decision for the mass-unpublish guard: returns an abort reason when applying this ERP snapshot
 * would unpublish an implausible share of the published, ERP-linked catalog.
 */
export function evaluateMassUnpublishGuard(
  publishedProducts: Array<{ erpItemId: string; erpItemCode: string | null }>,
  erpKeys: { has(key: string): boolean; size: number },
  maxMissingRatio = MAX_MISSING_RATIO
): string | null {
  const erpLinked = publishedProducts.filter((p) => p.erpItemId && !isCuratedErpId(p.erpItemId));

  if (erpLinked.length === 0) return null;

  if (erpKeys.size === 0) {
    return `ERP 0 ürün döndürdü; yayındaki ${erpLinked.length} ERP bağlı ürünün tamamı yayından kalkacaktı.`;
  }

  const missing = erpLinked.filter(
    (p) => !erpKeys.has(p.erpItemId) && !(p.erpItemCode && erpKeys.has(p.erpItemCode))
  ).length;
  const ratio = missing / erpLinked.length;

  if (missing >= MIN_MISSING_FOR_GUARD && ratio > maxMissingRatio) {
    return `Yayındaki ${erpLinked.length} ERP bağlı ürünün ${missing} tanesi (%${Math.round(ratio * 100)}) ERP yanıtında yok; eşik %${Math.round(maxMissingRatio * 100)}.`;
  }
  return null;
}

async function checkMassUnpublishGuard(erpMap: Map<string, ErpItem>): Promise<string | null> {
  const publishedProducts = await prisma.product.findMany({
    where: { archivedAt: null, isPublished: true },
    select: { erpItemId: true, erpItemCode: true },
  });
  return evaluateMassUnpublishGuard(publishedProducts, erpMap);
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

  // 1. Fetch fresh items from ERP
  let erpItems: ErpItem[] = [];
  try {
    erpItems = await erpIntegrationService.fetchErpItems(true);
    report.totalErpItems = erpItems.length;
  } catch (err: unknown) {
    console.error('[CatalogSync] ERP API ürün listesi alınamadı:', err);
    report.aborted = true;
    report.abortReason = `ERP ürün listesi alınamadı: ${err instanceof Error ? err.message : String(err)}`;
    report.errors++;
    report.durationMs = Date.now() - startTime;
    return report;
  }

  const erpMap = new Map<string, ErpItem>();
  erpItems.forEach((item) => {
    erpMap.set(item.id, item);
    if (item.code) {
      erpMap.set(item.code, item);
    }
  });

  // 2. Toplu yayından kaldırma kalkanı: ERP'nin hatalı/eksik bir yanıtı tüm kataloğu boşaltmasın.
  const guardReason = await checkMassUnpublishGuard(erpMap);
  if (guardReason) {
    console.error(`[CatalogSync] DURDURULDU: ${guardReason}`);
    report.aborted = true;
    report.abortReason = guardReason;
    report.durationMs = Date.now() - startTime;
    telegramService
      .notifyCatalogSyncAborted({ reason: guardReason })
      .catch((tgErr) => console.warn('Telegram bildirim hatası:', tgErr));
    return report;
  }

  try {
    const syncSuccess = await prisma.$transaction(
      async (tx) => {
        // Transaction-level advisory lock: Automatically and safely released on commit or rollback
        const lockResult = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_ID}) AS acquired;
        `;
        const acquired = lockResult?.[0]?.acquired ?? false;
        if (!acquired) {
          console.log('[CatalogSync] Başka bir instance katalog senkronizasyonunu yürütüyor (Advisory Lock meşgul).');
          return null;
        }

        console.log('[CatalogSync] 15 dakikalık ERP katalog senkronizasyonu başlatıldı...');

        // 2. Fetch all non-archived products from ErmayWeb DB
        const dbProducts = await tx.product.findMany({
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

        let changesMade = false;

        for (const prod of dbProducts) {
          if (!prod.erpItemId) {
            if (prod.isPublished) {
              await tx.product.update({
                where: { id: prod.id },
                data: { isPublished: false },
              });
              report.unpublishedMissing++;
              changesMade = true;
            }
            continue;
          }

          const isCurated = isCuratedErpId(prod.erpItemId);

          if (isCurated) {
            const canPublish = canPublishProduct({
              images: prod.images,
              image: prod.image,
              price: prod.price,
              erpItemId: prod.erpItemId,
              archivedAt: prod.archivedAt,
            });

            if (prod.erpMissingSince || (!prod.isPublished && canPublish)) {
              await tx.product.update({
                where: { id: prod.id },
                data: {
                  isPublished: canPublish,
                  erpMissingSince: null,
                },
              });
              if (canPublish) report.restoredItems++;
              changesMade = true;
            }
            report.matchedProducts++;
            continue;
          }

          const erpMatch = erpMap.get(prod.erpItemId) || (prod.erpItemCode ? erpMap.get(prod.erpItemCode) : undefined);

          if (erpMatch) {
            report.matchedProducts++;
            const erpPrice = Number(erpMatch.salePrice || 0);
            const erpStock = Number(erpMatch.totalStock || 0);
            const currentPrice = Number(prod.price);

            const priceChanged = Math.abs(currentPrice - erpPrice) > 0.01;
            const stockChanged = prod.stock !== erpStock;

            if (priceChanged) report.pricesUpdated++;
            if (stockChanged) report.stocksUpdated++;

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
              await tx.product.update({
                where: { id: prod.id },
                data: updateData,
              });
              changesMade = true;
            }
          } else {
            if (prod.isPublished || !prod.erpMissingSince) {
              await tx.product.update({
                where: { id: prod.id },
                data: {
                  isPublished: false,
                  erpMissingSince: prod.erpMissingSince || new Date(),
                },
              });
              report.unpublishedMissing++;
              changesMade = true;
            }
          }
        }

        return changesMade;
      },
      { timeout: 60000 }
    );

    if (syncSuccess === null) {
      return null; // Advisory lock meşgul
    }
    const changesMade = Boolean(syncSuccess);

    report.durationMs = Date.now() - startTime;
    console.log(
      `[CatalogSync] Tamamlandı (${report.durationMs}ms): ${report.matchedProducts}/${report.totalErpItems} ERP eşleşti, ` +
      `${report.pricesUpdated} fiyat güncellendi, ${report.stocksUpdated} stok güncellendi, ` +
      `${report.restoredItems} web kürasyonlu ürün korundu/onarıldı, ` +
      `${report.unpublishedMissing} eksik ERP ürünü yayından çekildi.`
    );

    // Yalnızca veritabanında gerçekten değişiklik yapıldıysa ürün cache'ini düşür (V-19)
    if (changesMade) {
      await invalidateCachePattern('products:*');
    }

    return report;
  } catch (err: unknown) {
    report.errors++;
    console.error('[CatalogSync] Senkronizasyon sırasında beklenmeyen hata:', err);
    return report;
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
