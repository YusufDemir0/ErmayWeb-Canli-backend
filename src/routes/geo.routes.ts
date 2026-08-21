import { Router, Request, Response } from 'express';
import { redis } from '../config/redis';

const router = Router();
const inMemoryGeoCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

router.get('/reverse', async (req: Request, res: Response): Promise<void> => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      res.status(400).json({ success: false, message: 'Enlem (lat) ve Boylam (lng) parametreleri zorunludur.' });
      return;
    }

    const roundedLat = Number(lat).toFixed(3);
    const roundedLng = Number(lng).toFixed(3);
    const cacheKey = `geo:reverse:${roundedLat}:${roundedLng}`;

    // 1. Try Redis Cache
    try {
      const redisCached = await redis.get(cacheKey);
      if (redisCached) {
        res.status(200).json({ success: true, data: JSON.parse(redisCached), cached: true });
        return;
      }
    } catch {
      // Redis unavailable fallback
    }

    // 2. Try In-Memory Cache fallback
    const memCached = inMemoryGeoCache.get(cacheKey);
    if (memCached && Date.now() - memCached.timestamp < CACHE_TTL_MS) {
      res.status(200).json({ success: true, data: memCached.data, cached: true });
      return;
    }

    // 3. Fetch from Nominatim API with custom User-Agent
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${roundedLat}&lon=${roundedLng}`,
      {
        headers: {
          'User-Agent': 'ErmayWeb-Furniture-ECommerce/2.0 (contact@ermaymobilya.com)',
          'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        },
      }
    );

    if (!response.ok) {
      res.status(502).json({ success: false, message: 'Harita geocoding servisine ulaşılamadı.' });
      return;
    }

    const data = await response.json();

    // Cache the reverse geocoding result
    try {
      await redis.setex(cacheKey, 86400, JSON.stringify(data));
    } catch {
      // LRU Eviction: ensure memory cache does not exceed 500 entries
      if (inMemoryGeoCache.size >= 500) {
        const firstKey = inMemoryGeoCache.keys().next().value;
        if (firstKey) inMemoryGeoCache.delete(firstKey);
      }
      inMemoryGeoCache.set(cacheKey, { data, timestamp: Date.now() });
    }

    res.status(200).json({ success: true, data, cached: false });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Geocoding işlemi başarısız.';
    res.status(500).json({ success: false, message: msg });
  }
});

export default router;
