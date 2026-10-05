import 'dotenv/config';
import { app } from './app';
import { connectDatabase } from './config/database';
import { startErpOutboxWorker, stopErpOutboxWorker } from './jobs/erpOutbox.job';
import { startCatalogSyncJob, stopCatalogSyncJob } from './jobs/erpCatalogSync.job';
import { startRetentionJob, stopRetentionJob } from './jobs/retentionAnonymize.job';
import { logger, errorFields } from './utils/logger';

const PORT = process.env.PORT || 5000;

async function startServer() {
  await connectDatabase();

  // Arka plan işleri (ERP outbox, katalog senkronu, KVKK anonimleştirme). Birden fazla API örneği çalıştırılırken
  // yalnız bir örnekte açık olmalı: diğerlerinde DISABLE_BACKGROUND_JOBS=true.
  if (process.env.DISABLE_BACKGROUND_JOBS === 'true') {
    logger.info('Background jobs disabled by configuration');
  } else {
    startErpOutboxWorker();
    startCatalogSyncJob();
    startRetentionJob();
  }

  const server = app.listen(PORT, () => {
    logger.info('API server started', { 'server.port': Number(PORT), 'url.path': '/api/v1' });
  });

  const shutdown = () => {
    logger.info('Shutdown signal received, stopping workers');
    stopErpOutboxWorker();
    stopCatalogSyncJob();
    stopRetentionJob();
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
