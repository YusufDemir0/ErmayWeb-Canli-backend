import { sendServerError } from '../utils/httpError';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { slugifyTurkish } from '../utils/slug';
import { getOrSetCache, invalidateCachePattern } from '../utils/cache';
import { erpIntegrationService } from '../services/erpIntegration.service';
import { logger, errorFields } from '../utils/logger';

/**
 * Tek ve merkezi yayınlanabilirlik kuralı (canPublish).
 * Kural: En az 1 görsel, Fiyat > 0, ERP Item ID mevcut ve arşivlenmemiş olmalı.
 */
export function canPublishProduct(data: {
  images?: string[];
  image?: string;
  price?: number | Prisma.Decimal;
  erpItemId?: string | null;
  archivedAt?: Date | null;
}): boolean {
  const cleanImages = (data.images || []).filter((img) => typeof img === 'string' && img.trim().length > 0);
  const hasImage = cleanImages.length > 0 || (typeof data.image === 'string' && data.image.trim().length > 0);
  const priceVal = data.price ? Number(data.price) : 0;
  const hasPrice = priceVal > 0;
  const hasErpId = Boolean(data.erpItemId && String(data.erpItemId).trim().length > 0);
  const notArchived = !data.archivedAt;

  return Boolean(hasImage && hasPrice && hasErpId && notArchived);
}

export async function getProducts(req: Request, res: Response): Promise<void> {
  try {
    const { category, search, minPrice, maxPrice, sort, page = '1', limit = '24' } = req.query;

    const parsedPage = parseInt(page as string, 10);
    const pageNum = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
    const userRole = (req as { user?: { role?: string } }).user?.role;
    const isAdmin = userRole === 'ADMIN';
    const includeUnpublished = isAdmin && req.query.includeUnpublished === 'true';

    // Admin paneli tüm kataloğu (taslaklar dahil) tek seferde yükler; vitrin istekleri 60 ile sınırlı kalır.
    const maxLimit = includeUnpublished ? 1000 : 60;
    const parsedLimit = parseInt(limit as string, 10);
    const limitNum = Number.isFinite(parsedLimit) && parsedLimit >= 1 ? Math.min(maxLimit, parsedLimit) : 24;
    const skip = (pageNum - 1) * limitNum;

    const cacheKey = `products:list:${pageNum}:${limitNum}:${category || ''}:${search || ''}:${minPrice || ''}:${maxPrice || ''}:${sort || ''}:${includeUnpublished}`;

    const cachedResult = await getOrSetCache(cacheKey, 120, async () => {
      const where: Prisma.ProductWhereInput = {};
      const andFilters: Prisma.ProductWhereInput[] = [];

      // Silinen (arşivlenen) ürünler admin listesinde de gösterilmez; taslaklar yalnızca admin'e görünür
      andFilters.push(includeUnpublished ? { archivedAt: null } : { isPublished: true, archivedAt: null });

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

      let orderBy: Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[] = { createdAt: 'desc' };
      if (sort === 'price_asc') orderBy = { price: 'asc' };
      if (sort === 'price_desc') orderBy = { price: 'desc' };
      if (sort === 'popular') orderBy = [{ salesCount: 'desc' }, { createdAt: 'desc' }];

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
            description: true,
            price: true,
            originalPrice: true,
            stock: true,
            inStock: true,
            salesCount: true,
            image: true,
            images: true,
            features: true,
            colors: true,
            badge: true,
            isPublished: true,
            material: true,
            dimensions: true,
            widthCm: true,
            heightCm: true,
            depthCm: true,
            leadTimeDays: true,
            drawerCount: true,
            vatRate: true,
            setPieces: true,
            erpItemId: true,
            erpItemCode: true,
            category: {
              select: { id: true, name: true, slug: true },
            },
          },
        }),
        prisma.product.count({ where }),
      ]);

      const serializedProducts = products.map((p) => ({
        ...p,
        price: Number(p.price),
        originalPrice: p.originalPrice ? Number(p.originalPrice) : null,
        vatRate: p.vatRate ? Number(p.vatRate) : 0.20,
        salesCount: p.salesCount ?? 0,
      }));

      return {
        products: serializedProducts,
        total: totalCount,
        page: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
      };
    });

    res.status(200).json({
      success: true,
      ...cachedResult,
    });
  } catch (error: unknown) {
    logger.error('Product list failed', errorFields(error));
    res.status(500).json({ success: false, message: 'Ürünler yüklenirken bir sorun oluştu.' });
  }
}

export async function getProductById(req: Request, res: Response): Promise<void> {
  try {
    const productId = req.params.id as string;
    const userRole = (req as { user?: { role?: string } }).user?.role;
    const isAdmin = userRole === 'ADMIN';
    const includeUnpublished = isAdmin && req.query.includeUnpublished === 'true';
    const cacheKey = `products:detail:${productId}:${includeUnpublished}`;

    const product = await getOrSetCache(cacheKey, 300, async () => {
      return prisma.product.findFirst({
        where: {
          OR: [{ id: productId }, { slug: productId }],
          ...(includeUnpublished ? {} : { archivedAt: null }),
        },
        include: {
          category: true,
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

    const serialized = {
      ...product,
      price: Number(product.price),
      originalPrice: product.originalPrice ? Number(product.originalPrice) : null,
      vatRate: Number(product.vatRate),
    };

    res.status(200).json({ success: true, product: serialized });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: 'Ürün detayı alınamadı.' });
  }
}

export async function createProduct(req: Request, res: Response): Promise<void> {
  try {
    const {
      name,
      categoryId,
      category,
      description,
      material,
      dimensions,
      price,
      originalPrice,
      stock,
      image,
      images,
      features,
      colors,
      erpItemId,
      erpItemCode,
      widthCm,
      heightCm,
      depthCm,
      drawerCount,
      leadTimeDays,
      vatRate,
      badge,
      isPublished,
    } = req.body;

    if (!name || price === undefined || price === null) {
      res.status(400).json({ success: false, message: 'Ürün adı ve fiyatı zorunludur.' });
      return;
    }

    if (!erpItemId || String(erpItemId).trim() === '') {
      res.status(400).json({
        success: false,
        message: 'CRM ERP sisteminde bulunmayan veya ERP ID (erpItemId) eşleşmesi yapılmamış ürün eklenemez.',
      });
      return;
    }

    let catId = categoryId;
    const catSearch = typeof category === 'object' && category !== null ? (category as { id?: string; slug?: string }).id || (category as { id?: string; slug?: string }).slug : category;
    if (!catId && catSearch) {
      const found = await prisma.category.findFirst({
        where: { OR: [{ id: String(catSearch) }, { slug: String(catSearch) }] },
      });
      if (found) catId = found.id;
    }

    if (!catId) {
      const firstCat = await prisma.category.findFirst();
      catId = firstCat ? firstCat.id : (await prisma.category.create({ data: { name: 'Genel', slug: 'genel' } })).id;
    }

    const cleanImages = Array.isArray(images)
      ? images.filter((img: unknown) => typeof img === 'string' && img.trim().length > 0)
      : image
      ? [image]
      : [];

    const mainImage = image || cleanImages[0] || '';
    const stockNum = stock !== undefined && stock !== '' ? parseInt(String(stock), 10) : 0;
    const priceNum = parseFloat(String(price));

    const publishAllowed = canPublishProduct({
      images: cleanImages,
      image: mainImage,
      price: priceNum,
      erpItemId: String(erpItemId),
      archivedAt: null,
    });

    const targetPublish = Boolean(isPublished) && publishAllowed;

    const slug = `${slugifyTurkish(name)}-${Date.now().toString().slice(-5)}`;

    const cleanColors: string[] = Array.isArray(colors)
      ? colors
          .map((c: unknown) => {
            if (typeof c === 'string') return c.trim();
            if (c && typeof c === 'object') {
              const cObj = c as { name?: string; id?: string };
              return (cObj.name || cObj.id || '').trim();
            }
            return String(c).trim();
          })
          .filter(Boolean)
      : typeof colors === 'string' && colors.trim().length > 0
      ? [colors.trim()]
      : [];

    const productData = {
      name: name.trim(),
      slug,
      categoryId: catId,
      description: description || '',
      material: material || '',
      dimensions: dimensions || '',
      price: priceNum,
      originalPrice: originalPrice ? parseFloat(String(originalPrice)) : null,
      stock: stockNum,
      inStock: stockNum > 0,
      image: mainImage,
      images: cleanImages,
      features: Array.isArray(features) ? features : [],
      colors: cleanColors,
      badge: badge || null,
      widthCm: widthCm ? parseInt(String(widthCm), 10) : null,
      heightCm: heightCm ? parseInt(String(heightCm), 10) : null,
      depthCm: depthCm ? parseInt(String(depthCm), 10) : null,
      drawerCount: drawerCount !== undefined ? parseInt(String(drawerCount), 10) : 0,
      leadTimeDays: leadTimeDays !== undefined ? parseInt(String(leadTimeDays), 10) : 15,
      vatRate: vatRate !== undefined ? parseFloat(String(vatRate)) : 0.20,
      erpItemId: String(erpItemId),
      erpItemCode: erpItemCode || null,
      isPublished: targetPublish,
    };

    const existingProduct = await prisma.product.findUnique({
      where: { erpItemId: String(erpItemId) },
    });

    // Aktif bir ürün varsa çift kayıt açılmaz.
    if (existingProduct && !existingProduct.archivedAt) {
      res.status(409).json({
        success: false,
        message: `Bu ERP ID (${erpItemId}) ile eşleşen bir ürün zaten mevcut: "${existingProduct.name}". Yeni ürün eklemek yerine mevcut ürünü güncelleyiniz.`,
      });
      return;
    }

    // Daha önce silinmiş (arşivlenmiş) ürün aynı ERP ID ile yeniden eklenirse kayıt geri getirilir ve yeni verilerle
    // güncellenir. erpItemId UNIQUE olduğundan yeni kayıt açılamaz; önceden 409 dönüp admin'in göremediği arşivli
    // ürünü işaret ediyordu. Slug korunur (eski bağlantılar çalışmaya devam eder).
    const savedProduct = existingProduct
      ? await prisma.product.update({
          where: { id: existingProduct.id },
          data: { ...productData, slug: existingProduct.slug, archivedAt: null, erpMissingSince: null },
        })
      : await prisma.product.create({ data: productData });

    await invalidateCachePattern('products:*');

    res.status(201).json({
      success: true,
      message: existingProduct ? 'Daha önce silinmiş ürün geri getirildi ve güncellendi.' : 'Ürün başarıyla kaydedildi.',
      product: savedProduct,
    });
  } catch (error: unknown) {
    logger.error('Product create failed', errorFields(error));
    sendServerError(res, error, 'Ürün oluşturulamadı.');
  }
}

export async function updateProduct(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const body = req.body;

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Güncellenecek ürün bulunamadı.' });
      return;
    }

    let cleanImages = body.images !== undefined
      ? (Array.isArray(body.images) ? body.images.filter((img: unknown) => typeof img === 'string' && img.trim().length > 0) : [])
      : [...existing.images];

    const mainImage = body.image !== undefined ? body.image : (cleanImages[0] || existing.image);

    if (mainImage && !cleanImages.includes(mainImage)) {
      cleanImages = [mainImage, ...cleanImages];
    }

    const priceNum = body.price !== undefined ? parseFloat(String(body.price)) : Number(existing.price);

    const publishCandidate = body.isPublished !== undefined ? Boolean(body.isPublished) : existing.isPublished;
    const publishAllowed = canPublishProduct({
      images: cleanImages,
      image: mainImage,
      price: priceNum,
      erpItemId: existing.erpItemId,
      archivedAt: existing.archivedAt,
    });

    const isPublished = publishCandidate && publishAllowed;

    const cleanUpdateColors = body.colors !== undefined
      ? (Array.isArray(body.colors)
          ? body.colors
              .map((c: unknown) => {
                if (typeof c === 'string') return c.trim();
                if (c && typeof c === 'object') {
                  const cObj = c as { name?: string; id?: string };
                  return (cObj.name || cObj.id || '').trim();
                }
                return String(c).trim();
              })
              .filter(Boolean)
          : typeof body.colors === 'string' && body.colors.trim().length > 0
          ? [body.colors.trim()]
          : [])
      : undefined;

    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name.trim() }),
        ...(body.categoryId && { categoryId: body.categoryId }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.material !== undefined && { material: body.material }),
        ...(body.dimensions !== undefined && { dimensions: body.dimensions }),
        ...(body.price !== undefined && { price: priceNum }),
        ...(body.originalPrice !== undefined && { originalPrice: body.originalPrice ? parseFloat(String(body.originalPrice)) : null }),
        ...(body.stock !== undefined && { stock: parseInt(String(body.stock), 10), inStock: parseInt(String(body.stock), 10) > 0 }),
        ...(mainImage !== undefined && { image: mainImage }),
        images: cleanImages,
        ...(body.features !== undefined && { features: Array.isArray(body.features) ? body.features : [] }),
        ...(cleanUpdateColors !== undefined && { colors: cleanUpdateColors }),
        ...(body.badge !== undefined && { badge: body.badge }),
        ...(body.widthCm !== undefined && { widthCm: body.widthCm ? parseInt(String(body.widthCm), 10) : null }),
        ...(body.heightCm !== undefined && { heightCm: body.heightCm ? parseInt(String(body.heightCm), 10) : null }),
        ...(body.depthCm !== undefined && { depthCm: body.depthCm ? parseInt(String(body.depthCm), 10) : null }),
        ...(body.drawerCount !== undefined && { drawerCount: parseInt(String(body.drawerCount), 10) }),
        ...(body.leadTimeDays !== undefined && { leadTimeDays: parseInt(String(body.leadTimeDays), 10) }),
        ...(body.vatRate !== undefined && { vatRate: parseFloat(String(body.vatRate)) }),
        ...(body.erpItemCode !== undefined && { erpItemCode: body.erpItemCode }),
        isPublished,
      },
    });

    await invalidateCachePattern('products:*');

    res.status(200).json({ success: true, message: 'Ürün güncellendi.', product: updated });
  } catch (error: unknown) {
    logger.error('Product update failed', errorFields(error));
    sendServerError(res, error, 'Ürün güncellenemedi.');
  }
}

/**
 * DELETE /api/v1/admin/products/:id
 * Soft delete: sets archivedAt = now() and isPublished = false.
 */
export async function deleteProduct(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;

    await prisma.product.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        isPublished: false,
      },
    });

    await invalidateCachePattern('products:*');

    res.status(200).json({ success: true, message: 'Ürün arşive kaldırıldı (Soft Delete).' });
  } catch (error: unknown) {
    logger.error('Product delete failed', errorFields(error));
    sendServerError(res, error, 'Ürün silinemedi.');
  }
}

export async function bulkLinkErpProducts(req: Request, res: Response): Promise<void> {
  try {
    const { erpItemIds, categoryId } = req.body;

    if (!Array.isArray(erpItemIds) || erpItemIds.length === 0) {
      res.status(400).json({ success: false, message: 'En az bir ERP ürünü seçilmelidir.' });
      return;
    }

    if (!categoryId) {
      res.status(400).json({ success: false, message: 'Hedef kategori seçilmelidir.' });
      return;
    }

    const targetCat = await prisma.category.findFirst({
      where: { OR: [{ id: String(categoryId) }, { slug: String(categoryId) }] },
    });

    if (!targetCat) {
      res.status(404).json({ success: false, message: 'Belirtilen hedef kategori bulunamadı.' });
      return;
    }

    const erpMap = new Map<string, { erpId: string; erpCode: string; erpName: string; erpSalePrice: number; erpStock: number; erpImage: string | null }>();
    try {
      const erpItems = await erpIntegrationService.fetchErpItems();
      for (const item of erpItems) {
        erpMap.set(String(item.id), {
          erpId: String(item.id),
          erpCode: item.code,
          erpName: item.name,
          erpSalePrice: item.salePrice,
          erpStock: item.totalStock,
          erpImage: item.image,
        });
      }
    } catch {
      // ERP servisine ulaşılamazsa işlem yapılamaz
      res.status(503).json({ success: false, message: 'ERP servisine ulaşılamadı. Toplu bağlama ertelendi.' });
      return;
    }

    let processedCount = 0;

    for (const rawErpId of erpItemIds) {
      const erpIdStr = String(rawErpId).trim();
      if (!erpIdStr) continue;

      const erpInfo = erpMap.get(erpIdStr);
      if (!erpInfo) continue; // ERP'de kaydı olmayan ürünü bağlama

      const existingProduct = await prisma.product.findUnique({
        where: { erpItemId: erpIdStr },
      });

      const images = erpInfo.erpImage ? [erpInfo.erpImage] : [];
      const image = erpInfo.erpImage || '';

      if (existingProduct) {
        await prisma.product.update({
          where: { id: existingProduct.id },
          data: {
            categoryId: targetCat.id,
            price: erpInfo.erpSalePrice,
            stock: erpInfo.erpStock,
            inStock: erpInfo.erpStock > 0,
            erpItemCode: erpInfo.erpCode,
            lastSyncedAt: new Date(),
          },
        });
      } else {
        const prodName = erpInfo.erpName;
        const prodSlug = slugifyTurkish(prodName) + '-' + erpIdStr.slice(-5);

        // Görsel yoksa isPublished kesinlikle false kalır!
        const canPublish = canPublishProduct({
          images,
          image,
          price: erpInfo.erpSalePrice,
          erpItemId: erpIdStr,
        });

        await prisma.product.create({
          data: {
            name: prodName,
            slug: prodSlug,
            categoryId: targetCat.id,
            erpItemId: erpIdStr,
            erpItemCode: erpInfo.erpCode,
            price: erpInfo.erpSalePrice,
            stock: erpInfo.erpStock,
            inStock: erpInfo.erpStock > 0,
            image,
            images,
            description: `${prodName} - Ermay Mobilya Atölye Üretimi`,
            material: 'Lüks Ermay Mobilya Atölye Üretimi',
            dimensions: 'G: Standart | D: Standart | Y: Standart',
            isPublished: canPublish,
            lastSyncedAt: new Date(),
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
    logger.error('Bulk category link failed', errorFields(error));
    sendServerError(res, error, 'Toplu eşleme yapılırken bir hata oluştu.');
  }
}
