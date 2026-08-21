import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

export async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log('✅ PostgreSQL Veritabanı bağlantısı başarıyla kuruldu.');
  } catch (error) {
    console.warn('⚠️ Veritabanına doğrudan bağlanılamadı (Mock/Memory modunda çalışıyor):', error);
  }
}
