import { Router, Request, Response } from 'express';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { getOrSetCache, delCache } from '../utils/cache';

const router = Router();
const inMemoryGeoCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DELIVERY_ZONES_CACHE_KEY = 'geo:delivery_zones';
const DELIVERY_ZONES_CACHE_TTL = 1800; // 30 minutes

export interface DeliveryZonesConfig {
  disabledCityIds: number[];
  disabledCityNames: string[];
  noticeMessage?: string;
  updatedAt?: string;
}

/**
 * GET /api/v1/geo/delivery-zones
 * Returns the currently active delivery zones configuration (disabled cities, announcements).
 */
router.get('/delivery-zones', async (_req: Request, res: Response): Promise<void> => {
  try {
    const zonesData = await getOrSetCache(DELIVERY_ZONES_CACHE_KEY, DELIVERY_ZONES_CACHE_TTL, async () => {
      const block = await prisma.cmsBlock.findUnique({
        where: { key: 'delivery_zones' },
      });

      if (!block || !block.content) {
        return {
          disabledCityIds: [],
          disabledCityNames: [],
          noticeMessage: '',
        };
      }
      return block.content;
    });

    res.status(200).json({
      success: true,
      zones: zonesData,
      data: zonesData,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Teslimat bölgeleri verisi alınamadı.';
    res.status(500).json({ success: false, message: msg });
  }
});

/**
 * PUT /api/v1/geo/delivery-zones
 * Update which cities are enabled/disabled for shipping & assembly.
 */
router.put('/delivery-zones', async (req: Request, res: Response): Promise<void> => {
  try {
    const { disabledCityIds = [], disabledCityNames = [], noticeMessage = '' } = req.body;

    const payload = {
      disabledCityIds: Array.isArray(disabledCityIds) ? disabledCityIds.map(Number) : [],
      disabledCityNames: Array.isArray(disabledCityNames) ? disabledCityNames.map(String) : [],
      noticeMessage: typeof noticeMessage === 'string' ? noticeMessage.trim() : '',
      updatedAt: new Date().toISOString(),
    };

    const savedBlock = await prisma.cmsBlock.upsert({
      where: { key: 'delivery_zones' },
      update: { content: payload },
      create: { key: 'delivery_zones', content: payload },
    });

    // Invalidate delivery zones Redis cache
    await delCache(DELIVERY_ZONES_CACHE_KEY).catch(() => {});

    res.status(200).json({
      success: true,
      message: 'Teslimat ve şehir hizmet durumu başarıyla güncellendi.',
      zones: savedBlock.content,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Teslimat bölgeleri güncellenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
});

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
