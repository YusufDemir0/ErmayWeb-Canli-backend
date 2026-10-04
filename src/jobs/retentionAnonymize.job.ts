import { prisma } from '../config/database';

const ADVISORY_LOCK_ID = 42002;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETENTION_DAYS = 180;
let retentionTimer: NodeJS.Timeout | null = null;
let isJobRunning = false;

export interface RetentionReport {
  anonymizedCount: number;
  durationMs: number;
  cutoffDate: string;
}

/**
 * Anonymize personal identifiable information (PII) from completed or cancelled order requests
 * older than RETENTION_DAYS (180 days) in compliance with KVKK / GDPR data minimization rules.
 */
export async function runRetentionAnonymization(): Promise<RetentionReport | null> {
  const startTime = Date.now();

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    return await prisma.$transaction(
      async (tx) => {
        const lockResult = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_ID}) AS acquired;
        `;

        const acquired = lockResult?.[0]?.acquired ?? false;
        if (!acquired) {
          console.log('[RetentionJob] Başka bir instance veri anonimleştirme işini yürütüyor (Advisory Lock meşgul).');
          return null;
        }

        console.log(`[RetentionJob] ${RETENTION_DAYS} günden eski (${cutoffDate.toISOString()}) tamamlanan/iptal/spam talepler taranıyor...`);

        const eligibleRequests = await tx.orderRequest.findMany({
          where: {
            status: { in: ['COMPLETED', 'CANCELLED', 'SPAM', 'EXPIRED'] },
            createdAt: { lt: cutoffDate },
            anonymizedAt: null,
            customerName: { not: 'ANONİM MÜŞTERİ' },
          },
          select: { id: true, code: true },
        });

        let anonymizedCount = 0;

        for (const req of eligibleRequests) {
          await tx.orderRequest.update({
            where: { id: req.id },
            data: {
              customerName: 'ANONİM MÜŞTERİ',
              customerPhone: '+900000000000',
              customerEmail: null,
              addressLine: null,
              note: '[KVKK 180 GÜN VERİ SAKLAMA POLİTİKASI GEREĞİ ANONİMLEŞTİRİLDİ]',
              anonymizedAt: new Date(),
            },
          });

          await tx.orderRequestEvent.create({
            data: {
              requestId: req.id,
              type: 'KVKK_ANONYMIZED',
              note: '180 günlük yasal saklama süresi dolduğu için kişisel veriler anonimleştirildi.',
            },
          });

          anonymizedCount++;
        }

        const durationMs = Date.now() - startTime;
        console.log(`[RetentionJob] Tamamlandı (${durationMs}ms): ${anonymizedCount} talep anonimleştirildi.`);

        return {
          anonymizedCount,
          durationMs,
          cutoffDate: cutoffDate.toISOString(),
        };
      },
      { timeout: 60000 }
    );
  } catch (err: unknown) {
    console.error('[RetentionJob] Anonimleştirme hatası:', err);
    return null;
  }
}

/**
 * Start the daily background retention loop.
 */
export function startRetentionJob(): void {
  if (retentionTimer) {
    return;
  }

  console.log('[RetentionJob] Günlük KVKK veri anonimleştirme işi kuruldu (180 gün kuralı).');

  const tick = async () => {
    if (isJobRunning) return;
    isJobRunning = true;
    try {
      await runRetentionAnonymization();
    } catch (err) {
      console.error('[RetentionJob] Döngü hatası:', err);
    } finally {
      isJobRunning = false;
    }
  };

  // Run first check 60 seconds after server startup, then every 24 hours
  setTimeout(() => {
    tick();
  }, 60000);

  retentionTimer = setInterval(tick, RETENTION_INTERVAL_MS);
}

/**
 * Gracefully stop the retention job.
 */
export function stopRetentionJob(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
    console.log('[RetentionJob] Veri anonimleştirme işi durduruldu.');
  }
}
