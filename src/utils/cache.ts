// In-memory LRU / TTL cache implementation for single-instance catalog caching
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const memoryStore = new Map<string, CacheEntry<unknown>>();
const pendingFetches = new Map<string, Promise<unknown>>();
const MAX_CACHE_ENTRIES = 2000;

// Periodic cleanup of expired keys (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * In-memory safe cache utility with in-flight stampede protection.
 */
export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const cached = memoryStore.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  // Deduplicate concurrent in-flight executions for the same cache key
  const existingPromise = pendingFetches.get(key);
  if (existingPromise) {
    return existingPromise as Promise<T>;
  }

  const fetchPromise = (async () => {
    try {
      const freshData = await fetcher();

      if (freshData !== undefined && freshData !== null) {
        if (memoryStore.size >= MAX_CACHE_ENTRIES) {
          // Evict the oldest key
          const firstKey = memoryStore.keys().next().value;
          if (firstKey) memoryStore.delete(firstKey);
        }
        memoryStore.set(key, {
          data: freshData,
          expiresAt: Date.now() + ttlSeconds * 1000,
        });
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
 * Invalidate all in-memory keys matching a regex or prefix pattern (e.g. "products:*", "categories:*").
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  const regexStr = '^' + pattern.replace(/\*/g, '.*') + '$';
  const regex = new RegExp(regexStr);

  for (const key of memoryStore.keys()) {
    if (regex.test(key)) {
      memoryStore.delete(key);
    }
  }
}

/**
 * Delete a specific cache key.
 */
export async function delCache(key: string): Promise<void> {
  memoryStore.delete(key);
}
