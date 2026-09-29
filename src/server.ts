import 'dotenv/config';
import { app } from './app';
import { connectDatabase } from './config/database';
import { startErpOutboxWorker, stopErpOutboxWorker } from './jobs/erpOutbox.job';
import { startCatalogSyncJob, stopCatalogSyncJob } from './jobs/erpCatalogSync.job';
import { startRetentionJob, stopRetentionJob } from './jobs/retentionAnonymize.job';

const PORT = process.env.PORT || 5000;

async function startServer() {
  await connectDatabase();

  // Start background Outbox worker for safe, deduplicated ERP forwarding
  startErpOutboxWorker();

  // Start periodic 15-minute ERP catalog sync job
  startCatalogSyncJob();

  // Start daily KVKK retention anonymization job
  startRetentionJob();

  const server = app.listen(PORT, () => {
    console.log(`🚀 ErmayWeb Bağımsız Backend API Servisi http://localhost:${PORT} üzerinde başarıyla başlatıldı.`);
    console.log(`📋 Health Check: http://localhost:${PORT}/health`);
    console.log(`📡 REST API Endpoint Base: http://localhost:${PORT}/api/v1`);
  });

  const shutdown = () => {
    console.log('\n🛑 Kapatma sinyali alındı, servisler güvenli bir şekilde durduruluyor...');
    stopErpOutboxWorker();
    stopCatalogSyncJob();
    stopRetentionJob();
    server.close(() => {
      console.log('✅ HTTP sunucusu kapatıldı.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
