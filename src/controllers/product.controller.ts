import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { slugifyTurkish } from '../utils/slug';

export async function getProducts(req: Request, res: Response): Promise<void> {
  try {
    const { category, search, minPrice, maxPrice, sort, page = '1', limit = '100' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.ProductWhereInput = {};

    if (category && category !== 'all' && category !== 'hepsi') {
      const catParam = (category as string).trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(catParam);

      if (isUuid) {
        where.categoryId = catParam;
      } else {
        const slug = slugifyTurkish(catParam);
        where.category = {
          OR: [
            { slug: catParam.toLowerCase() },
            { slug: slug },
          ],
        };
      }
    }

    if (search) {
      const q = (search as string).trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { material: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = parseFloat(minPrice as string);
      if (maxPrice) where.price.lte = parseFloat(maxPrice as string);
    }

    let orderBy: Prisma.ProductOrderByWithRelationInput = { createdAt: 'desc' };
    if (sort === 'price_asc') orderBy = { price: 'asc' };
    if (sort === 'price_desc') orderBy = { price: 'desc' };
    if (sort === 'popular') orderBy = { salesCount: 'desc' };

    const [products, totalCount] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limitNum,
        include: {
          category: {
            select: { id: true, name: true, slug: true },
          },
          variants: true,
        },
      }),
      prisma.product.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
      },
      products,
    });
  } catch (error: unknown) {
    console.error('Ürün Listeleme Hatası:', error);
    res.status(500).json({ success: false, message: 'Ürünler yüklenirken bir sorun oluştu.' });
  }
}

export async function getProductById(req: Request, res: Response): Promise<void> {
  try {
    const productId = req.params.id as string;

    const product = await prisma.product.findFirst({
      where: {
        OR: [{ id: productId }, { slug: productId }],
      },
      include: {
        category: true,
        variants: true,
      },
    });

    if (!product) {
      res.status(404).json({ success: false, message: 'İstenen ürün bulunamadı.' });
      return;
    }

    res.status(200).json({ success: true, product });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: 'Ürün detayı alınamadı.' });
  }
}

export async function createProduct(req: Request, res: Response): Promise<void> {
  try {
    const { name, categoryId, category, description, material, dimensions, price, originalPrice, stock, image, images, features, vatRate } = req.body;

    if (!name || !price) {
      res.status(400).json({ success: false, message: 'Ürün adı ve fiyatı zorunludur.' });
      return;
    }

    let catId = categoryId;
    // Slug veya ID üzerinden dinamik kategori bulma:
    if (!catId && category) {
      const found = await prisma.category.findFirst({
        where: { OR: [{ id: String(category) }, { slug: String(category) }] },
      });
      if (found) catId = found.id;
    } else if (catId) {
      const found = await prisma.category.findFirst({
        where: { OR: [{ id: String(catId) }, { slug: String(catId) }] },
      });
      if (found) catId = found.id;
    }

    if (!catId) {
      const firstCat = await prisma.category.findFirst();
      catId = firstCat ? firstCat.id : (await prisma.category.create({ data: { name: 'Genel', slug: 'genel' } })).id;
    }

    const slug = slugifyTurkish(name) + '-' + Date.now().toString().slice(-6);

    const normalizedImages = Array.isArray(images)
      ? images.filter((img: unknown) => typeof img === 'string' && img.trim().length > 0)
      : image
      ? [image]
      : [];

    const mainImage = image || normalizedImages[0] || 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&q=80&w=1000';

    const stockNum = stock !== undefined && stock !== '' ? parseInt(String(stock), 10) : 10;

    const createInput: Prisma.ProductCreateInput = {
      name,
      slug,
      category: { connect: { id: catId } },
      description: description || '',
      material: material || 'Masif Ahşap & Kumaş',
      dimensions: dimensions || 'G: 220cm | D: 95cm | Y: 75cm',
      price: parseFloat(price),
      originalPrice: originalPrice ? parseFloat(originalPrice) : null,
      stock: stockNum,
      inStock: stockNum > 0,
      image: mainImage,
      images: normalizedImages.length > 0 ? normalizedImages : [mainImage],
      features: Array.isArray(features) ? features.filter((f: unknown): f is string => typeof f === 'string') : [],
      vatRate: vatRate ? parseFloat(vatRate) : 0.20,
    };

    const product = await prisma.product.create({
      data: createInput,
    });

    res.status(201).json({ success: true, message: 'Ürün başarıyla eklendi.', product });
  } catch (error: unknown) {
    console.error('Ürün Ekleme Hatası:', error);
    const msg = error instanceof Error ? error.message : 'Ürün eklenirken bir hata oluştu.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function updateProduct(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { name, categoryId, category, description, material, dimensions, price, originalPrice, stock, inStock, image, images, features, vatRate } = req.body;

    const dataToUpdate: Prisma.ProductUpdateInput = {};
    if (name) dataToUpdate.name = name;

    let targetCatId = categoryId;
    if (!targetCatId && category) {
      const found = await prisma.category.findFirst({
        where: { OR: [{ id: String(category) }, { slug: String(category) }] },
      });
      if (found) targetCatId = found.id;
    } else if (targetCatId) {
      const found = await prisma.category.findFirst({
        where: { OR: [{ id: String(targetCatId) }, { slug: String(targetCatId) }] },
      });
      if (found) targetCatId = found.id;
    }

    if (targetCatId) dataToUpdate.category = { connect: { id: targetCatId } };
    if (description !== undefined) dataToUpdate.description = description;
    if (material !== undefined) dataToUpdate.material = material;
    if (dimensions !== undefined) dataToUpdate.dimensions = dimensions;
    if (price !== undefined) dataToUpdate.price = parseFloat(price);
    if (originalPrice !== undefined) dataToUpdate.originalPrice = originalPrice ? parseFloat(originalPrice) : null;
    
    if (stock !== undefined && stock !== '') {
      const parsedStock = parseInt(String(stock), 10);
      dataToUpdate.stock = parsedStock;
      dataToUpdate.inStock = inStock !== undefined ? Boolean(inStock) : parsedStock > 0;
    } else if (inStock !== undefined) {
      dataToUpdate.inStock = Boolean(inStock);
    }

    if (image !== undefined) dataToUpdate.image = image;
    if (images !== undefined) {
      const cleanImages = Array.isArray(images) ? images.filter((img: unknown): img is string => typeof img === 'string' && img.trim().length > 0) : [];
      dataToUpdate.images = cleanImages;
      if (cleanImages.length > 0 && !image) {
        dataToUpdate.image = cleanImages[0];
      }
    }
    if (features !== undefined) dataToUpdate.features = Array.isArray(features) ? features.filter((f: unknown): f is string => typeof f === 'string') : [];
    if (vatRate !== undefined) dataToUpdate.vatRate = parseFloat(vatRate);

    const product = await prisma.product.update({
      where: { id },
      data: dataToUpdate,
    });

    res.status(200).json({ success: true, message: 'Ürün güncellendi.', product });
  } catch (error: unknown) {
    console.error('Ürün Güncelleme Hatası:', error);
    const msg = error instanceof Error ? error.message : 'Ürün güncellenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function deleteProduct(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;

    await prisma.product.delete({
      where: { id },
    });

    res.status(200).json({ success: true, message: 'Ürün silindi.' });
  } catch (error: unknown) {
    console.error('Ürün Silme Hatası:', error);
    const msg = error instanceof Error ? error.message : 'Ürün silinemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}
