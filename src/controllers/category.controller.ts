import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { slugifyTurkish } from '../utils/slug';

export async function getCategories(req: Request, res: Response): Promise<void> {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { children: true },
    });
    res.status(200).json({ success: true, categories });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: 'Kategoriler yüklenemedi.' });
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

    res.status(200).json({ success: true, message: 'Kategori güncellendi.', category });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Kategori güncellenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function deleteCategory(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;

    const hasProducts = await prisma.product.findFirst({ where: { categoryId: id } });
    if (hasProducts) {
      res.status(400).json({ success: false, message: 'Bu kategoriye ait ürünler olduğu için silinemez! Lütfen önce ilişkili ürünleri siliniz veya başka bir kategoriye taşıyınız.' });
      return;
    }

    const hasChildren = await prisma.category.findFirst({ where: { parentId: id } });
    if (hasChildren) {
      res.status(400).json({ success: false, message: 'Bu kategoriye ait alt kategoriler bulunmaktadır. Lütfen önce alt kategorileri siliniz veya taşıyınız.' });
      return;
    }

    await prisma.category.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Kategori başarıyla silindi.' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Kategori silinemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}
