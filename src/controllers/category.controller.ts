import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { slugifyTurkish } from '../utils/slug';
import { getOrSetCache, invalidateCachePattern } from '../utils/cache';

const CATEGORIES_CACHE_KEY = 'categories:all';
const CATEGORIES_CACHE_TTL = 3600; // 1 hour

export async function getCategories(req: Request, res: Response): Promise<void> {
  try {
    const categories = await getOrSetCache(
      CATEGORIES_CACHE_KEY,
      CATEGORIES_CACHE_TTL,
      async () => {
        return prisma.category.findMany({
          orderBy: { name: 'asc' },
          include: { children: true },
        });
      }
    );
    res.status(200).json({ success: true, categories });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: 'Kategoriler yüklenemedi.' });
  }
}

export async function getCategoryBySlug(req: Request, res: Response): Promise<void> {
  try {
    const slug = req.params.slug as string;
    const category = await prisma.category.findUnique({
      where: { slug },
      include: { children: true },
    });

    if (!category) {
      res.status(404).json({ success: false, message: 'Kategori bulunamadı.' });
      return;
    }

    res.status(200).json({ success: true, category });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: 'Kategori bilgisi alınamadı.' });
  }
}

export async function createCategory(req: Request, res: Response): Promise<void> {
  try {
    const { name, description, image, parentId } = req.body;
    if (!name) {
      res.status(400).json({ success: false, message: 'Kategori adı zorunludur.' });
      return;
    }

    const slug = slugifyTurkish(name);

    const category = await prisma.category.create({
      data: {
        name,
        slug,
        description,
        image,
        parentId: parentId || null,
      },
    });

    await invalidateCachePattern('categories:*');

    res.status(201).json({ success: true, message: 'Kategori eklendi.', category });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Kategori eklenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function updateCategory(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { name, description, image, parentId } = req.body;

    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Güncellenecek kategori bulunamadı.' });
      return;
    }

    const dataToUpdate: Prisma.CategoryUpdateInput = {};
    if (name) {
      dataToUpdate.name = name;
      dataToUpdate.slug = slugifyTurkish(name);
    }
    if (description !== undefined) dataToUpdate.description = description;
    if (image !== undefined) dataToUpdate.image = image;
    if (parentId !== undefined) dataToUpdate.parent = parentId ? { connect: { id: parentId } } : { disconnect: true };

    const category = await prisma.category.update({
      where: { id },
      data: dataToUpdate,
    });

    await invalidateCachePattern('categories:*');

    res.status(200).json({ success: true, message: 'Kategori güncellendi.', category });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Kategori güncellenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function deleteCategory(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { reassignTo } = req.query;

    const existingCategory = await prisma.category.findUnique({
      where: { id },
    });

    if (!existingCategory) {
      res.status(200).json({
        success: true,
        message: 'Kategori zaten silinmiş veya bulunamadı.',
      });
      return;
    }

    const productCount = await prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      let targetCatId = typeof reassignTo === 'string' && reassignTo ? reassignTo : null;
      if (!targetCatId) {
        const otherCat = await prisma.category.findFirst({
          where: { id: { not: id } },
          orderBy: { name: 'asc' },
        });
        if (otherCat) {
          targetCatId = otherCat.id;
        } else {
          const defaultCat = await prisma.category.create({
            data: { name: 'Genel', slug: 'genel', description: 'Genel Kategori' },
          });
          targetCatId = defaultCat.id;
        }
      }

      await prisma.product.updateMany({
        where: { categoryId: id },
        data: { categoryId: targetCatId },
      });
    }

    const hasChildren = await prisma.category.findFirst({ where: { parentId: id } });
    if (hasChildren) {
      await prisma.category.updateMany({
        where: { parentId: id },
        data: { parentId: null },
      });
    }

    try {
      await prisma.category.delete({ where: { id } });
    } catch (delError: unknown) {
      if (
        delError instanceof Prisma.PrismaClientKnownRequestError &&
        delError.code === 'P2025'
      ) {
        res.status(200).json({
          success: true,
          message: 'Kategori zaten silinmiş.',
        });
        return;
      }
      throw delError;
    }

    await invalidateCachePattern('categories:*');
    await invalidateCachePattern('products:*');

    res.status(200).json({
      success: true,
      message: productCount > 0
        ? `Kategori silindi. İçindeki ${productCount} adet ürün "${existingCategory.name}" kategorisinden aktarıldı.`
        : 'Kategori başarıyla silindi.',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Kategori silinemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}
