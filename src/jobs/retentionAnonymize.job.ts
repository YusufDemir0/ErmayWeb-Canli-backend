import { prisma } from '../config/database';
import { logger, errorFields } from '../utils/logger';

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
          logger.info('Retention job skipped: another instance holds the lock');
          return null;
        }

        logger.info('Retention job started', { 'retention.days': RETENTION_DAYS, 'retention.cutoff': cutoffDate.toISOString() });

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
        logger.audit('order_request.anonymized', 'success', { 'retention.anonymized_count': anonymizedCount, 'event.duration': durationMs * 1e6 });

        return {
          anonymizedCount,
          durationMs,
          cutoffDate: cutoffDate.toISOString(),
        };
      },
      { timeout: 60000 }
    );
  } catch (err: unknown) {
    logger.error('Retention job failed', errorFields(err));
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

  logger.info('Retention job scheduled', { 'retention.days': 180 });

  const tick = async () => {
    if (isJobRunning) return;
    isJobRunning = true;
    try {
      await runRetentionAnonymization();
    } catch (err) {
      logger.error('Retention job tick failed', errorFields(err));
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
    logger.info('Retention job stopped');
  }
}
