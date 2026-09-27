import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { getOrSetCache, delCache } from '../utils/cache';

const STORES_CACHE_KEY = 'stores:all';
const STORES_CACHE_TTL = 3600; // 1 hour

/**
 * Tüm Mağazaları ve Bayileri Listeleme
 */
export async function getStores(req: Request, res: Response): Promise<void> {
  try {
    const stores = await getOrSetCache(STORES_CACHE_KEY, STORES_CACHE_TTL, async () => {
      return prisma.store.findMany({
        orderBy: { createdAt: 'asc' },
      });
    });

    res.status(200).json({
      success: true,
      stores,
    });
  } catch (error: unknown) {
    console.error('Mağaza Listeleme Hatası:', error);
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

    const store = await prisma.store.create({
      data: {
        name,
        city,
        district,
        address,
        phone,
        email,
        hours: hours || 'Haftanın her günü 09:00 - 20:00',
        image,
        mapUrl,
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    await delCache(STORES_CACHE_KEY).catch(() => {});

    res.status(201).json({
      success: true,
      message: 'Yeni mağaza/bayi başarıyla eklendi.',
      store,
    });
  } catch (error: unknown) {
    console.error('Mağaza Ekleme Hatası:', error);
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

    const store = await prisma.store.update({
      where: { id },
      data: {
        name: name || existing.name,
        city: city || existing.city,
        district: district !== undefined ? district : existing.district,
        address: address || existing.address,
        phone: phone || existing.phone,
        email: email !== undefined ? email : existing.email,
        hours: hours || existing.hours,
        image: image !== undefined ? image : existing.image,
        mapUrl: mapUrl !== undefined ? mapUrl : existing.mapUrl,
        isActive: isActive !== undefined ? isActive : existing.isActive,
      },
    });

    await delCache(STORES_CACHE_KEY).catch(() => {});

    res.status(200).json({
      success: true,
      message: 'Mağaza bilgileri başarıyla güncellendi.',
      store,
    });
  } catch (error: unknown) {
    console.error('Mağaza Güncelleme Hatası:', error);
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

    await prisma.store.delete({ where: { id } });

    await delCache(STORES_CACHE_KEY).catch(() => {});

    res.status(200).json({
      success: true,
      message: 'Mağaza başarıyla silindi.',
    });
  } catch (error: unknown) {
    console.error('Mağaza Silme Hatası:', error);
    res.status(500).json({ success: false, message: 'Mağaza silinemedi.' });
  }
}
