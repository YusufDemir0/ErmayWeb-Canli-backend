import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { getOrSetCache, delCache } from '../utils/cache';
import { logger, errorFields } from '../utils/logger';

const STORES_CACHE_TTL = 3600; // 1 hour

async function invalidateStoreCaches(): Promise<void> {
  await Promise.allSettled([
    delCache('stores:active'),
    delCache('stores:all:admin'),
    delCache('stores:all'),
  ]);
}

/**
 * Tüm Mağazaları ve Bayileri Listeleme
 * Varsayılan olarak yalnızca aktif (isActive: true) mağazalar listelenir.
 * Admin kullanıcılar ?all=true ile kapalı mağazaları da görebilir.
 */
export async function getStores(req: Request, res: Response): Promise<void> {
  try {
    const userRole = (req as { user?: { role?: string } }).user?.role;
    const isAdmin = userRole === 'ADMIN';
    const includeInactive = isAdmin && req.query.all === 'true';

    const cacheKey = includeInactive ? 'stores:all:admin' : 'stores:active';

    const stores = await getOrSetCache(cacheKey, STORES_CACHE_TTL, async () => {
      return prisma.store.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
    });

    res.status(200).json({
      success: true,
      stores,
    });
  } catch (error: unknown) {
    logger.error('Store list failed', errorFields(error));
    res.status(500).json({ success: false, message: 'Mağazalar yüklenemedi.' });
  }
}

/**
 * Yeni Mağaza / Bayi Ekleme (Admin)
 */
export async function createStore(req: Request, res: Response): Promise<void> {
  try {
    const { name, city, district, address, phone, email, hours, image, mapUrl, isActive } = req.body;

    if (!name || !city || !address || !phone) {
      res.status(400).json({ success: false, message: 'Mağaza adı, şehir, adres ve telefon zorunludur.' });
      return;
    }

    const sanitizedIsActive = isActive !== undefined
      ? (typeof isActive === 'boolean' ? isActive : isActive === 'true' || isActive === 1 || isActive === '1')
      : true;

    const store = await prisma.store.create({
      data: {
        name: String(name).trim(),
        city: String(city).trim(),
        district: district ? String(district).trim() : null,
        address: String(address).trim(),
        phone: String(phone).trim(),
        email: email ? String(email).trim() : null,
        hours: hours ? String(hours).trim() : null,
        image: image || null,
        mapUrl: mapUrl || null,
        isActive: sanitizedIsActive,
      },
    });

    await invalidateStoreCaches();

    res.status(201).json({
      success: true,
      message: 'Yeni mağaza/bayi başarıyla eklendi.',
      store,
    });
  } catch (error: unknown) {
    logger.error('Store create failed', errorFields(error));
    res.status(500).json({ success: false, message: 'Mağaza eklenemedi.' });
  }
}

/**
 * Mağaza / Bayi Güncelleme (Admin)
 */
export async function updateStore(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { name, city, district, address, phone, email, hours, image, mapUrl, isActive } = req.body;

    const existing = await prisma.store.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Güncellenecek mağaza bulunamadı.' });
      return;
    }

    const sanitizedIsActive = isActive !== undefined
      ? (typeof isActive === 'boolean' ? isActive : isActive === 'true' || isActive === 1 || isActive === '1')
      : existing.isActive;

    const store = await prisma.store.update({
      where: { id },
      data: {
        name: name !== undefined ? String(name).trim() : existing.name,
        city: city !== undefined ? String(city).trim() : existing.city,
        district: district !== undefined ? (district ? String(district).trim() : null) : existing.district,
        address: address !== undefined ? String(address).trim() : existing.address,
        phone: phone !== undefined ? String(phone).trim() : existing.phone,
        email: email !== undefined ? (email ? String(email).trim() : null) : existing.email,
        hours: hours !== undefined ? (hours ? String(hours).trim() : '') : existing.hours,
        image: image !== undefined ? image : existing.image,
        mapUrl: mapUrl !== undefined ? mapUrl : existing.mapUrl,
        isActive: sanitizedIsActive,
      },
    });

    await invalidateStoreCaches();

    res.status(200).json({
      success: true,
      message: 'Mağaza bilgileri başarıyla güncellendi.',
      store,
    });
  } catch (error: unknown) {
    logger.error('Store update failed', errorFields(error));
    res.status(500).json({ success: false, message: 'Mağaza güncellenemedi.' });
  }
}

/**
 * Mağaza / Bayi Silme (Admin)
 */
export async function deleteStore(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;

    const existing = await prisma.store.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Silinecek mağaza bulunamadı.' });
      return;
    }

    const linkedRequestCount = await prisma.orderRequest.count({
      where: { preferredStoreId: id },
    });

    if (linkedRequestCount > 0) {
      // Geçmiş taleplerde kullanılmış mağaza için FK constraint hatası almamak ve geçmiş veriyi korumak için pasife al
      await prisma.store.update({
        where: { id },
        data: { isActive: false },
      });
      await invalidateStoreCaches();
      res.status(200).json({
        success: true,
        message: `Bu mağaza ${linkedRequestCount} adet geçmiş sipariş talebiyle ilişkilidir. Sipariş geçmişinin korunması için mağaza silinmek yerine pasife alındı.`,
      });
      return;
    }

    await prisma.store.delete({ where: { id } });

    await invalidateStoreCaches();

    res.status(200).json({
      success: true,
      message: 'Mağaza başarıyla silindi.',
    });
  } catch (error: unknown) {
    logger.error('Store delete failed', errorFields(error));
    res.status(500).json({ success: false, message: 'Mağaza silinemedi.' });
  }
}
