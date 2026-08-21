import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6380';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  lazyConnect: true,
});

redis.on('connect', () => {
  console.log('⚡ Redis Eşzamanlılık & Stok Kilit Bağlantısı Başarılı.');
});

redis.on('error', (err) => {
  console.warn('⚠️ Redis Bağlantı Uyarısı (Geriye Dönük Veritabanı Modu):', err.message);
});

export async function connectRedis(): Promise<void> {
  try {
    await redis.connect();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
    console.warn('Redis bağlantısı kurulamadı, varsayılan DB kilitleme kullanılacak:', msg);
  }
}
