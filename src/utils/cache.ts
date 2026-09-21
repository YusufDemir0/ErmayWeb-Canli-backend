import { redis } from '../config/redis';

/**
 * High-performance safe Redis caching utility with automatic fallback.
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

  const freshData = await fetcher();

  try {
    if (redis.status === 'ready' && freshData !== undefined && freshData !== null) {
      await redis.setex(key, ttlSeconds, JSON.stringify(freshData));
    }
  } catch (err) {
    // Non-critical if write fails
  }

  return freshData;
}

/**
 * Invalidate all Redis keys matching a pattern (e.g. "products:*", "categories:*").
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  try {
    if (redis.status !== 'ready') return;
    const stream = redis.scanStream({
      match: pattern,
      count: 100,
    });

    stream.on('data', async (keys: string[]) => {
      if (keys.length > 0) {
        const pipeline = redis.pipeline();
        keys.forEach((k) => pipeline.del(k));
        await pipeline.exec();
      }
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
