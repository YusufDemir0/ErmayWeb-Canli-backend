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

  const lockResult = await prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
    SELECT pg_try_advisory_lock(${ADVISORY_LOCK_ID});
  `;

  const acquired = lockResult?.[0]?.pg_try_advisory_lock ?? false;
  if (!acquired) {
    console.log('[RetentionJob] Başka bir instance veri anonimleştirme işini yürütüyor (Advisory Lock meşgul).');
    return null;
  }

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    console.log(`[RetentionJob] ${RETENTION_DAYS} günden eski (${cutoffDate.toISOString()}) tamamlanan/iptal edilen talepler taranıyor...`);

    const eligibleRequests = await prisma.orderRequest.findMany({
      where: {
        status: { in: ['COMPLETED', 'CANCELLED'] },
        createdAt: { lt: cutoffDate },
        // Don't re-anonymize already anonymized records
        customerName: { not: 'ANONİM MÜŞTERİ' },
      },
      select: { id: true, code: true },
    });

    let anonymizedCount = 0;

    for (const req of eligibleRequests) {
      await prisma.$transaction([
        prisma.orderRequest.update({
          where: { id: req.id },
          data: {
            customerName: 'ANONİM MÜŞTERİ',
            customerPhone: '+900000000000',
            customerEmail: null,
            addressLine: null,
            note: '[KVKK 180 GÜN VERİ SAKLAMA POLİTİKASI GEREĞİ ANONİMLEŞTİRİLDİ]',
            anonymizedAt: new Date(),
          },
        }),
        prisma.orderRequestEvent.create({
          data: {
            requestId: req.id,
            type: 'KVKK_ANONYMIZED',
            note: '180 günlük yasal saklama süresi dolduğu için kişisel veriler anonimleştirildi.',
          },
        }),
      ]);
      anonymizedCount++;
    }

    const durationMs = Date.now() - startTime;
    console.log(`[RetentionJob] Tamamlandı (${durationMs}ms): ${anonymizedCount} talep anonimleştirildi.`);

    return {
      anonymizedCount,
      durationMs,
      cutoffDate: cutoffDate.toISOString(),
    };
  } catch (err: unknown) {
    console.error('[RetentionJob] Anonimleştirme hatası:', err);
    return null;
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID});`;
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
