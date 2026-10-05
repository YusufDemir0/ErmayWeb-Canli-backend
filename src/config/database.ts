import { PrismaClient, Prisma } from '@prisma/client';
import { logger, errorFields } from '../utils/logger';

// Prisma logları da yapılandırılmış logger'a gider. SQL sorguları yalnız LOG_LEVEL=debug iken yazılır
// (parametre değerleri loglanmaz: kişisel veri içerebilir).
const queryLogging = (process.env.LOG_LEVEL || '').toLowerCase() === 'debug';

export const prisma = new PrismaClient({
  log: [
    ...(queryLogging ? [{ emit: 'event' as const, level: 'query' as const }] : []),
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
});

if (queryLogging) {
  prisma.$on('query' as never, (e: Prisma.QueryEvent) => {
    logger.debug('Database query', { 'db.system': 'postgresql', 'db.statement': e.query, 'event.duration': e.duration * 1e6 });
  });
}
prisma.$on('warn' as never, (e: Prisma.LogEvent) => logger.warn('Database warning', { 'db.system': 'postgresql', 'error.message': e.message }));
prisma.$on('error' as never, (e: Prisma.LogEvent) => logger.error('Database error', { 'db.system': 'postgresql', 'error.message': e.message }));

export async function connectDatabase() {
  try {
    await prisma.$connect();
    logger.info('Database connected', { 'db.system': 'postgresql' });
  } catch (error) {
    logger.warn('Database connection failed', { 'db.system': 'postgresql', ...errorFields(error) });
  }
}
