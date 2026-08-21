import 'dotenv/config';
import { app } from './app';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';

const PORT = process.env.PORT || 5000;

async function startServer() {
  await connectDatabase();
  await connectRedis();

  app.listen(PORT, () => {
    console.log(`🚀 ErmayWeb Bağımsız Backend API Servisi http://localhost:${PORT} üzerinde başarıyla başlatıldı.`);
    console.log(`📋 Health Check: http://localhost:${PORT}/health`);
    console.log(`📡 REST API Endpoint Base: http://localhost:${PORT}/api/v1`);
  });
}

startServer();
