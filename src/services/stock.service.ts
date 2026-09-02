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

    // 2. PostgreSQL Atomik Stok Düşürme İşlemi
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (item.quantity <= 0) {
          throw new StockReservationError('Stok rezervasyon miktarı 1 veya daha fazla olmalıdır.');
        }

        if (item.variantId) {
          const variant = await tx.productVariant.findUnique({
            where: { id: item.variantId },
          });

          if (!variant || variant.stock < item.quantity) {
            throw new StockReservationError(
              `Ürün varyantı stokta tükenmiş veya yetersiz. İstenen: ${item.quantity}, Mevcut: ${variant?.stock || 0}`
            );
          }

          // Atomik varyant stok düşürme
          const updatedVariant = await tx.productVariant.updateMany({
            where: {
              id: item.variantId,
              stock: { gte: item.quantity },
            },
            data: {
              stock: { decrement: item.quantity },
            },
          });

          if (updatedVariant.count === 0) {
            throw new StockReservationError('Eşzamanlı sipariş nedeniyle ürün varyantı stoku tükendi.');
          }

          // Atomik ana ürün stok senkronizasyonu (Bellekte hesaplanan sabit sayı yerine atomic decrement)
          const updatedParent = await tx.product.updateMany({
            where: {
              id: variant.productId,
              stock: { gte: item.quantity },
            },
            data: {
              stock: { decrement: item.quantity },
              salesCount: { increment: item.quantity },
            },
          });

          if (updatedParent.count === 0) {
            // Ana ürün stoku yetersiz kalırsa varyantı geri al
            throw new StockReservationError('Ana ürün toplam stoku eşzamanlı sipariş nedeniyle tükendi.');
          }
        } else {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });

          if (!product || product.stock < item.quantity || !product.inStock) {
            throw new StockReservationError(
              `"${product?.name || 'Ürün'}" stokta tükenmiş veya yetersiz. İstenen: ${item.quantity}, Mevcut: ${product?.stock || 0}`
            );
          }

          const updatedProduct = await tx.product.updateMany({
            where: {
              id: item.productId,
              stock: { gte: item.quantity },
            },
            data: {
              stock: { decrement: item.quantity },
              salesCount: { increment: item.quantity },
            },
          });

          if (updatedProduct.count === 0) {
            throw new StockReservationError(`"${product.name}" için eşzamanlı stok tükenmesi yaşandı.`);
          }
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

        // Parent product recovery with guaranteed non-negative sales count
        const parent = await tx.product.findUnique({ where: { id: variant.productId } });
        const safeSalesCount = parent ? Math.max(0, parent.salesCount - item.quantity) : 0;

        await tx.product.update({
          where: { id: variant.productId },
          data: {
            stock: { increment: item.quantity },
            inStock: true,
            salesCount: safeSalesCount,
          },
        });
      } else {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        const safeSalesCount = product ? Math.max(0, product.salesCount - item.quantity) : 0;

        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { increment: item.quantity },
            inStock: true,
            salesCount: safeSalesCount,
          },
        });
      }
    }
  });
}
