import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { slugifyTurkish } from '../utils/slug';
import { getOrSetCache, invalidateCachePattern, delCache } from '../utils/cache';
import { erpIntegrationService } from '../services/erpIntegration.service';

export async function getProducts(req: Request, res: Response): Promise<void> {
  try {
    const { category, search, minPrice, maxPrice, sort, page = '1', limit = '24' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(48, Math.max(1, parseInt(limit as string, 10) || 24));
    const skip = (pageNum - 1) * limitNum;

    const cacheKey = `products:list:${pageNum}:${limitNum}:${category || ''}:${search || ''}:${minPrice || ''}:${maxPrice || ''}:${sort || ''}:${req.query.includeUnpublished || ''}`;

    const cachedResult = await getOrSetCache(cacheKey, 120, async () => {
      const where: Prisma.ProductWhereInput = {};
      const andFilters: Prisma.ProductWhereInput[] = [];

      const includeUnpublished = req.query.includeUnpublished === 'true';
      if (!includeUnpublished) {
        andFilters.push({
          isPublished: true,
          erpItemId: { not: null },
        });
      }

      if (category && category !== 'all' && category !== 'hepsi') {
        const catParam = (category as string).trim();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(catParam);

        if (isUuid) {
          andFilters.push({ categoryId: catParam });
        } else {
          const slug = slugifyTurkish(catParam);
          andFilters.push({
            category: {
              OR: [
                { slug: catParam.toLowerCase() },
                { slug: slug },
              ],
            },
          });
        }
      }

      if (search) {
        const q = (search as string).trim();
        andFilters.push({
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { material: { contains: q, mode: 'insensitive' } },
          ],
        });
      }

      if (minPrice || maxPrice) {
        const priceFilter: Prisma.DecimalFilter = {};
        if (minPrice) priceFilter.gte = parseFloat(minPrice as string);
        if (maxPrice) priceFilter.lte = parseFloat(maxPrice as string);
        andFilters.push({ price: priceFilter });
      }

      if (andFilters.length > 0) {
        where.AND = andFilters;
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
          select: {
            id: true,
            slug: true,
            name: true,
            price: true,
            originalPrice: true,
            stock: true,
            inStock: true,
            salesCount: true,
            image: true,
            images: true,
            isPublished: true,
            material: true,
            widthCm: true,
            heightCm: true,
            depthCm: true,
            erpItemId: true,
            category: {
              select: { id: true, name: true, slug: true },
            },
            variants: {
              select: {
                id: true,
                sku: true,
                color: true,
                price: true,
                stock: true,
              },
            },
          },
        }),
        prisma.product.count({ where }),
      ]);

      return {
        pagination: {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(totalCount / limitNum),
        },
        products,
      };
    });

    res.status(200).json({
      success: true,
      ...cachedResult,
    });
  } catch (error: unknown) {
    console.error('Ürün Listeleme Hatası:', error);
    res.status(500).json({ success: false, message: 'Ürünler yüklenirken bir sorun oluştu.' });
  }
}

export async function getProductById(req: Request, res: Response): Promise<void> {
  try {
    const productId = req.params.id as string;
    const includeUnpublished = req.query.includeUnpublished === 'true';
    const cacheKey = `products:detail:${productId}:${includeUnpublished}`;

    const product = await getOrSetCache(cacheKey, 300, async () => {
      return prisma.product.findFirst({
        where: {
          OR: [{ id: productId }, { slug: productId }],
        },
        include: {
          category: true,
          variants: true,
        },
      });
    });

    if (!product) {
      res.status(404).json({ success: false, message: 'İstenen ürün bulunamadı.' });
      return;
    }

    if (!product.isPublished && !includeUnpublished) {
      res.status(404).json({
        success: false,
        message: 'Bu mobilya modeli şu anda satışta değildir veya geçici olarak yayından kaldırılmıştır.',
      });
      return;
    }

    res.status(200).json({ success: true, product });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: 'Ürün detayı alınamadı.' });
  }
}

export async function createProduct(req: Request, res: Response): Promise<void> {
  try {
    const { name, categoryId, category, description, material, dimensions, price, originalPrice, stock, image, images, features, colors, vatRate, erpItemId, erpItemCode, widthCm, heightCm, depthCm } = req.body;

    if (!name || !price) {
      res.status(400).json({ success: false, message: 'Ürün adı ve fiyatı zorunludur.' });
      return;
    }

    if (!erpItemId || String(erpItemId).trim() === '') {
      res.status(400).json({
        success: false,
        message: 'CRM ERP sisteminde bulunmayan veya ERP ID (erpItemId) eşleşmesi yapılmamış ürün eklenemez. Lütfen ürünü ERP Sisteminden içe aktarınız / senkronize ediniz.',
      });
      return;
    }

    let catId = categoryId;
    // Slug veya ID üzerinden dinamik kategori bulma:
    const catSearch = typeof category === 'object' && category !== null ? (category as { id?: string; slug?: string }).id || (category as { id?: string; slug?: string }).slug : category;
    if (!catId && catSearch) {
      const found = await prisma.category.findFirst({
        where: { OR: [{ id: String(catSearch) }, { slug: String(catSearch) }] },
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

    const normalizedImages = Array.isArray(images)
      ? images.filter((img: unknown) => typeof img === 'string' && img.trim().length > 0)
      : image
      ? [image]
      : [];

    const mainImage = image || normalizedImages[0] || '';
    const stockNum = stock !== undefined && stock !== '' ? parseInt(String(stock), 10) : 10;

    const normalizedColors = Array.isArray(colors)
      ? colors.map((c: unknown) => {
          if (typeof c === 'string') return c;
          if (c && typeof c === 'object' && 'name' in c && typeof (c as { name?: unknown }).name === 'string') {
            return (c as { name: string }).name;
          }
          return JSON.stringify(c);
        })
      : [];

    // ERP ID ile eşleşen mevcut bir ürün var mı kontrol et (Upsert mantığı)
    const existingProduct = await prisma.product.findUnique({
      where: { erpItemId: String(erpItemId) },
    });

    if (existingProduct) {
      const updated = await prisma.product.update({
        where: { id: existingProduct.id },
        data: {
          name: name.trim(),
          category: { connect: { id: catId } },
          description: description !== undefined ? description : existingProduct.description,
          material: material || existingProduct.material,
          dimensions: dimensions || existingProduct.dimensions,
          price: parseFloat(price),
          originalPrice: originalPrice ? parseFloat(originalPrice) : null,
          stock: stockNum,
          inStock: stockNum > 0,
          image: mainImage,
          images: normalizedImages.length > 0 ? normalizedImages : (mainImage ? [mainImage] : []),
          features: Array.isArray(features) ? features.filter((f: unknown): f is string => typeof f === 'string') : existingProduct.features,
          colors: normalizedColors.length > 0 ? normalizedColors : existingProduct.colors,
          vatRate: vatRate ? parseFloat(vatRate) : existingProduct.vatRate,
          widthCm: widthCm ? parseInt(String(widthCm), 10) : existingProduct.widthCm,
          heightCm: heightCm ? parseInt(String(heightCm), 10) : existingProduct.heightCm,
          depthCm: depthCm ? parseInt(String(depthCm), 10) : existingProduct.depthCm,
          erpItemCode: erpItemCode ? String(erpItemCode) : existingProduct.erpItemCode,
          isPublished: true,
        },
      });

      await invalidateCachePattern('products:*');
      res.status(200).json({ success: true, message: 'ERP ile eşleşen ürün başarıyla güncellendi ve yayına alındı.', product: updated });
      return;
    }

    const slug = slugifyTurkish(name) + '-' + Date.now().toString().slice(-6);

    const createInput: Prisma.ProductCreateInput = {
      name: name.trim(),
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
      images: normalizedImages.length > 0 ? normalizedImages : (mainImage ? [mainImage] : []),
      features: Array.isArray(features) ? features.filter((f: unknown): f is string => typeof f === 'string') : [],
      colors: normalizedColors,
      vatRate: vatRate ? parseFloat(vatRate) : 0.20,
      widthCm: widthCm ? parseInt(String(widthCm), 10) : null,
      heightCm: heightCm ? parseInt(String(heightCm), 10) : null,
      depthCm: depthCm ? parseInt(String(depthCm), 10) : null,
      erpItemId: String(erpItemId),
      erpItemCode: erpItemCode ? String(erpItemCode) : null,
      isPublished: true,
    };

    const product = await prisma.product.create({
      data: createInput,
    });

    await invalidateCachePattern('products:*');

    res.status(201).json({ success: true, message: 'Ürün başarıyla eklendi.', product });
  } catch (error: unknown) {
    console.error('Ürün Ekleme Hatası:', error);
    const msg = error instanceof Error ? error.message : 'Ürün eklenirken bir hata oluştu.';
    res.status(400).json({ success: false, message: msg });
  }
}

export async function updateProduct(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { name, categoryId, category, description, material, dimensions, price, originalPrice, stock, inStock, image, images, features, vatRate, isPublished, erpItemId, erpItemCode } = req.body;

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
    if (isPublished !== undefined) dataToUpdate.isPublished = Boolean(isPublished);
    if (erpItemId !== undefined) dataToUpdate.erpItemId = erpItemId ? String(erpItemId) : null;
    if (erpItemCode !== undefined) dataToUpdate.erpItemCode = erpItemCode ? String(erpItemCode) : null;

    const product = await prisma.product.update({
      where: { id },
      data: dataToUpdate,
    });

    await invalidateCachePattern('products:*');

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

    await invalidateCachePattern('products:*');

    res.status(200).json({ success: true, message: 'Ürün silindi.' });
  } catch (error: unknown) {
    console.error('Ürün Silme Hatası:', error);
    const msg = error instanceof Error ? error.message : 'Ürün silinemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function bulkLinkErpProducts(req: Request, res: Response): Promise<void> {
  try {
    const { erpItemIds, categoryId, isPublished = true } = req.body;

    if (!Array.isArray(erpItemIds) || erpItemIds.length === 0) {
      res.status(400).json({ success: false, message: 'En az bir ERP ürünü seçilmelidir.' });
      return;
    }

    if (!categoryId) {
      res.status(400).json({ success: false, message: 'Hedef kategori seçilmelidir.' });
      return;
    }

    // Kategori var mı doğrula (ID veya Slug üzerinden)
    const targetCat = await prisma.category.findFirst({
      where: { OR: [{ id: String(categoryId) }, { slug: String(categoryId) }] },
    });

    if (!targetCat) {
      res.status(404).json({ success: false, message: 'Belirtilen hedef kategori bulunamadı.' });
      return;
    }

    // CRM ERP'den güncel katalog bilgilerini çek (isim, fiyat vb. için)
    const erpMap = new Map<string, { erpId: string; erpCode: string; erpName: string; erpSalePrice: number; erpStock: number }>();
    try {
      const erpItems = await erpIntegrationService.fetchErpItems();
      for (const item of erpItems) {
        erpMap.set(String(item.id), {
          erpId: String(item.id),
          erpCode: item.code,
          erpName: item.name,
          erpSalePrice: item.salePrice,
          erpStock: item.totalStock,
        });
      }
    } catch {
      // ERP servisi o an erişilemezse sadece ID üzerinden bağlama yapılır
    }

    let processedCount = 0;

    for (const rawErpId of erpItemIds) {
      const erpIdStr = String(rawErpId).trim();
      if (!erpIdStr) continue;

      const erpInfo = erpMap.get(erpIdStr);
      const existingProduct = await prisma.product.findUnique({
        where: { erpItemId: erpIdStr },
      });

      if (existingProduct) {
        await prisma.product.update({
          where: { id: existingProduct.id },
          data: {
            categoryId: targetCat.id,
            isPublished: Boolean(isPublished),
            ...(erpInfo && {
              erpItemCode: erpInfo.erpCode,
            }),
          },
        });
      } else {
        const prodName = erpInfo?.erpName || `ERP Ürün #${erpIdStr}`;
        const prodSlug = slugifyTurkish(prodName) + '-' + erpIdStr;
        const prodPrice = erpInfo?.erpSalePrice ? Number(erpInfo.erpSalePrice) : 1000;
        const prodStock = erpInfo?.erpStock ? Number(erpInfo.erpStock) : 10;

        await prisma.product.create({
          data: {
            name: prodName,
            slug: prodSlug,
            categoryId: targetCat.id,
            erpItemId: erpIdStr,
            erpItemCode: erpInfo?.erpCode || null,
            price: prodPrice,
            stock: prodStock,
            inStock: prodStock > 0,
            image: '',
            images: [],
            description: `${prodName} - Ermay Mobilya Atölye Üretimi`,
            material: 'Masif Ahşap & Kumaş',
            dimensions: 'G: Standart | D: Standart | Y: Standart',
            isPublished: Boolean(isPublished),
          },
        });
      }
      processedCount++;
    }

    await invalidateCachePattern('products:*');

    res.status(200).json({
      success: true,
      message: `${processedCount} adet ERP ürünü "${targetCat.name}" kategorisine başarıyla bağlandı.`,
      count: processedCount,
      categoryId: targetCat.id,
    });
  } catch (error: unknown) {
    console.error('Toplu Kategori Eşleme Hatası:', error);
    const msg = error instanceof Error ? error.message : 'Toplu eşleme yapılırken bir hata oluştu.';
    res.status(500).json({ success: false, message: msg });
  }
}
