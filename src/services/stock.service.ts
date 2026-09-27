import { prisma } from '../config/database';
import { redis } from '../config/redis';

export interface ReserveStockItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

export class StockReservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockReservationError';
  }
}

/**
 * Redis Tabanlı Dağıtılmış Kilit (Distributed Lock) Edinme
 */
async function acquireRedisLock(lockKey: string, ttlMs: number = 5000): Promise<string | null> {
  const lockValue = `LOCK-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  try {
    const result = await redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');
    if (result === 'OK') {
      return lockValue;
    }
  } catch (e) {
    // Fallback if Redis is unavailable
  }
  return null;
}

/**
 * Redis Kilidini Bırakma
 */
async function releaseRedisLock(lockKey: string, lockValue: string): Promise<void> {
  try {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(script, 1, lockKey, lockValue);
  } catch (e) {
    // Fallback
  }
}

/**
 * Gerçek Redis Dağıtılmış Kilitli ve PostgreSQL Atomik Stok Kilitleme Algoritması (Race-Condition Free)
 */
export async function reserveStockAtomic(items: ReserveStockItem[]): Promise<void> {
  const acquiredLocks: { lockKey: string; lockValue: string }[] = [];

  try {
    // 1. Redis Distribütör Kilitlerini Edin (Deadlock Önleme için Alfabetik Sıralandı)
    const uniqueLockKeys = Array.from(
      new Set(items.map((item) => `stock_lock:${item.variantId || item.productId}`).filter(Boolean))
    ).sort();

    for (const lockKey of uniqueLockKeys) {
      let lockAcquired = false;

      // Sadece Redis bağlı ve çalışıyorsa kilit almayı dene
      if (redis.status === 'ready') {
        for (let attempt = 0; attempt < 5; attempt++) {
          const lockValue = await acquireRedisLock(lockKey, 3000);
          if (lockValue) {
            acquiredLocks.push({ lockKey, lockValue });
            lockAcquired = true;
            break;
          }
          // Kilit başkasında ise rastgele jitter ile 40-70ms bekle ve tekrar dene
          await new Promise((r) => setTimeout(r, 40 + Math.random() * 30));
        }

        if (!lockAcquired) {
          throw new StockReservationError('Ürün stoku için eşzamanlı işlem yoğunluğu var. Lütfen birkaç saniye sonra tekrar deneyiniz.');
        }
      }
    }

    // 2. PostgreSQL Atomik Stok Düşürme İşlemi (Stok eksiye serbestçe düşebilir)
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (item.quantity <= 0) {
          throw new StockReservationError('Stok rezervasyon miktarı 1 veya daha fazla olmalıdır.');
        }

        if (item.variantId) {
          const variant = await tx.productVariant.findUnique({
            where: { id: item.variantId },
          });

          if (!variant) {
            throw new StockReservationError('Ürün varyantı bulunamadı.');
          }

          // Atomik varyant stok düşürme (Stok negatif değerlere inebilir)
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: {
              stock: { decrement: item.quantity },
            },
          });

          // Atomik ana ürün stok senkronizasyonu
          await tx.product.update({
            where: { id: variant.productId },
            data: {
              stock: { decrement: item.quantity },
              salesCount: { increment: item.quantity },
            },
          });
        } else {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });

          if (!product) {
            throw new StockReservationError('Sipariş edilmek istenen ürün bulunamadı.');
          }

          // Atomik ana ürün stok düşürme (Stok negatif değerlere inebilir)
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: { decrement: item.quantity },
              salesCount: { increment: item.quantity },
            },
          });
        }
      }
    });
  } finally {
    // 3. Redis Kilitlerini Serbest Bırak
    for (const { lockKey, lockValue } of acquiredLocks) {
      await releaseRedisLock(lockKey, lockValue);
    }
  }
}

/**
 * İptal / İade Durumunda Atomik Stok Geri Yükleme (Negatif Satış Sayısı Korumalı)
 */
export async function releaseStockAtomic(items: ReserveStockItem[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      if (item.quantity <= 0) continue;

      if (item.variantId) {
        const variant = await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        });

        // Atomic update on PostgreSQL level preventing lost updates
        await tx.$executeRaw`
          UPDATE "products" 
          SET "stock" = "stock" + ${item.quantity}, 
              "inStock" = true, 
              "salesCount" = GREATEST(0, "salesCount" - ${item.quantity}) 
          WHERE "id" = ${variant.productId}
        `;
      } else if (item.productId) {
        await tx.$executeRaw`
          UPDATE "products" 
          SET "stock" = "stock" + ${item.quantity}, 
              "inStock" = true, 
              "salesCount" = GREATEST(0, "salesCount" - ${item.quantity}) 
          WHERE "id" = ${item.productId}
        `;
      }
    }
  });
}
