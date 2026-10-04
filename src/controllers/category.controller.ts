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
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            children: {
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            },
          },
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
      include: {
        children: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
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
    const { name, description, image, parentId, sortOrder, slug: manualSlug } = req.body;
    if (!name) {
      res.status(400).json({ success: false, message: 'Kategori adı zorunludur.' });
      return;
    }

    const slug = manualSlug ? slugifyTurkish(manualSlug) : slugifyTurkish(name);

    // Eğer sortOrder verilmemişse o seviyedeki en son kategori + 1 yap
    let finalSortOrder = typeof sortOrder === 'number' ? sortOrder : 0;
    if (typeof sortOrder !== 'number') {
      const lastCat = await prisma.category.findFirst({
        where: { parentId: parentId || null },
        orderBy: { sortOrder: 'desc' },
      });
      finalSortOrder = lastCat ? lastCat.sortOrder + 1 : 0;
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug,
        description,
        image,
        parentId: parentId || null,
        sortOrder: finalSortOrder,
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
    const { name, description, image, parentId, sortOrder, slug: manualSlug } = req.body;

    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Güncellenecek kategori bulunamadı.' });
      return;
    }

    // Döngüsel ebeveynlik kontrolü (Doğrudan ve dolaylı döngüler)
    if (parentId) {
      if (parentId === id) {
        res.status(400).json({ success: false, message: 'Bir kategori kendi kendisinin alt kategorisi olamaz.' });
        return;
      }

      // Ancestor ağacını gezerek A -> B -> C -> A döngüsünü engelle
      let currentParentId: string | null = parentId;
      const visited = new Set<string>([id]);
      while (currentParentId) {
        if (visited.has(currentParentId)) {
          res.status(400).json({
            success: false,
            message: 'Döngüsel kategori hiyerarşisi oluşturulamaz (Seçilen üst kategori, bu kategorinin bir alt dalıdır).',
          });
          return;
        }
        visited.add(currentParentId);
        const parentCat = await prisma.category.findUnique({
          where: { id: currentParentId },
          select: { parentId: true },
        });
        currentParentId = parentCat ? parentCat.parentId : null;
      }
    }

    const dataToUpdate: Prisma.CategoryUpdateInput = {};
    if (name) {
      dataToUpdate.name = name;
      dataToUpdate.slug = manualSlug ? slugifyTurkish(manualSlug) : slugifyTurkish(name);
    }
    if (description !== undefined) dataToUpdate.description = description;
    if (image !== undefined) dataToUpdate.image = image;
    if (parentId !== undefined) {
      dataToUpdate.parent = parentId ? { connect: { id: parentId } } : { disconnect: true };
    }
    if (typeof sortOrder === 'number') {
      dataToUpdate.sortOrder = sortOrder;
    }

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

export async function reorderCategories(req: Request, res: Response): Promise<void> {
  try {
    const { items } = req.body as {
      items: Array<{ id: string; parentId?: string | null; sortOrder: number }>;
    };

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, message: 'Geçerli bir kategori sıralama listesi gönderilmelidir.' });
      return;
    }

    // Döngüsel ebeveyn kontrolü (id === parentId ve hiyerarşi döngüleri)
    const parentMap = new Map<string, string | null>();
    for (const item of items) {
      if (item.parentId && item.id === item.parentId) {
        res.status(400).json({
          success: false,
          message: `Kategori (${item.id}) kendi kendisinin alt kategorisi olamaz.`,
        });
        return;
      }
      parentMap.set(item.id, item.parentId || null);
    }

    for (const item of items) {
      let curr = item.parentId;
      const seen = new Set<string>([item.id]);
      while (curr) {
        if (seen.has(curr)) {
          res.status(400).json({
            success: false,
            message: 'Döngüsel kategori hiyerarşisi tespit edildi. Lütfen kategori ebeveyn ilişkilerini kontrol edin.',
          });
          return;
        }
        seen.add(curr);
        curr = parentMap.has(curr) ? parentMap.get(curr)! : null;
      }
    }

    // Toplu güncelleme işlemi (Transaction)
    await prisma.$transaction(
      items.map((item) =>
        prisma.category.update({
          where: { id: item.id },
          data: {
            parentId: item.parentId || null,
            sortOrder: item.sortOrder,
          },
        })
      )
    );

    await invalidateCachePattern('categories:*');

    const updatedCategories = await prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        children: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    res.status(200).json({
      success: true,
      message: 'Kategori hiyerarşisi ve sıralaması başarıyla güncellendi.',
      categories: updatedCategories,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Sıralama güncellenemedi.';
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
      const targetCatId = typeof reassignTo === 'string' ? reassignTo.trim() : '';
      if (!targetCatId) {
        res.status(400).json({
          success: false,
          message: `Bu kategoride ${productCount} adet ürün bulunmaktadır. Kategoriyi silmeden önce ürünlerin aktarılacağı hedef kategoriyi (reassignTo parametresi ile) belirtmelisiniz.`,
        });
        return;
      }

      if (targetCatId === id) {
        res.status(400).json({
          success: false,
          message: 'Ürünler silinmekte olan kategoriye yeniden atanamaz.',
        });
        return;
      }

      const targetCat = await prisma.category.findUnique({ where: { id: targetCatId } });
      if (!targetCat) {
        res.status(404).json({
          success: false,
          message: 'Ürünlerin aktarılacağı hedef kategori bulunamadı.',
        });
        return;
      }

      await prisma.product.updateMany({
        where: { categoryId: id },
        data: { categoryId: targetCat.id },
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
