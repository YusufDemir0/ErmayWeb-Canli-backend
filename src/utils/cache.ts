import { redis } from '../config/redis';

// In-flight deduplication against cache stampedes
const pendingFetches = new Map<string, Promise<unknown>>();

/**
 * High-performance safe Redis caching utility with automatic fallback & in-flight stampede protection.
 * If Redis is unavailable or times out, it directly executes the fetcher function.
 */
export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  try {
    if (redis.status === 'ready') {
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    }
  } catch (err) {
    // Silently proceed to database query on cache miss or Redis read error
  }

  // Deduplicate concurrent in-flight executions for the same cache key
  const existingPromise = pendingFetches.get(key);
  if (existingPromise) {
    return existingPromise as Promise<T>;
  }

  const fetchPromise = (async () => {
    try {
      const freshData = await fetcher();

      if (redis.status === 'ready' && freshData !== undefined && freshData !== null) {
        await redis.setex(key, ttlSeconds, JSON.stringify(freshData)).catch(() => {});
      }

      return freshData;
    } finally {
      pendingFetches.delete(key);
    }
  })();

  pendingFetches.set(key, fetchPromise);
  return fetchPromise;
}

/**
 * Invalidate all Redis keys matching a pattern (e.g. "products:*", "categories:*") safely awaiting stream completion.
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  try {
    if (redis.status !== 'ready') return;
    const stream = redis.scanStream({
      match: pattern,
      count: 200,
    });

    await new Promise<void>((resolve, reject) => {
      stream.on('data', async (keys: string[]) => {
        if (keys.length > 0) {
          try {
            const pipeline = redis.pipeline();
            keys.forEach((k) => pipeline.del(k));
            await pipeline.exec();
          } catch (delErr) {
            console.warn('Pipeline delete warning:', delErr);
          }
        }
      });
      stream.on('end', () => resolve());
      stream.on('error', (err) => {
        console.warn(`Scan stream error for pattern ${pattern}:`, err);
        resolve(); // resolve gracefully so caller is never blocked
      });
    });
  } catch (err) {
    console.warn(`Cache invalidation failed for pattern ${pattern}:`, err);
  }
}

/**
 * Delete a specific cache key.
 */
export async function delCache(key: string): Promise<void> {
  try {
    if (redis.status === 'ready') {
      await redis.del(key);
    }
  } catch (err) {
    // Non-critical
  }
}
