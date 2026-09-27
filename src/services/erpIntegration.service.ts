import http from 'http';
import https from 'https';
import fs from 'fs';
import { URL } from 'url';
import { prisma } from '../config/database';
import { slugifyTurkish } from '../utils/slug';
import { invalidateCachePattern } from '../utils/cache';
import type { Product } from '@prisma/client';

export interface ErpItem {
  id: string;
  code: string;
  name: string;
  salePrice: number;
  totalStock: number;
  image: string | null;
  kdv: number;
  description: string;
  itemTypeId: string | null;
  typeName: string;
}

export interface SyncProductInput {
  erpItemId: string;
  isPublished: boolean;
  images: string[];
  categoryId?: string;
  name?: string;
  description?: string;
  dimensions?: string;
  material?: string;
}

export interface CatalogItem {
  erpId: string;
  erpCode: string;
  erpName: string;
  erpSalePrice: number;
  erpStock: number;
  erpType: string;
  erpImage: string | null;
  webProduct: {
    id: string;
    name: string;
    slug: string;
    price: number;
    stock: number;
    isPublished: boolean;
    images: string[];
    image: string;
    categoryId: string;
    categoryName: string;
    description: string;
    dimensions: string;
    material: string;
  } | null;
}

export interface ErpOrderItemInput {
  itemId: string;
  quantity: number;
  price: number;
  name: string;
}

export interface ErpWebOrderInput {
  orderNumber?: string;
  warehouse?: string;
  warehouseCode?: string;
  customerType?: 'CORPORATE' | 'INDIVIDUAL' | string;
  fullName?: string;
  customerName?: string;
  phone1?: string;
  phone2?: string;
  customerPhone?: string;
  email?: string;
  customerEmail?: string;
  city?: string;
  district?: string;
  address?: string;
  addressLine?: string;
  taxOffice?: string;
  taxNumber?: string;
  orderNote?: string;
  totalAmount: number;
  discountAmount?: number;
  paymentMethod?: string;
  items: ErpOrderItemInput[];
  isDealer?: boolean;
}

export class ErpIntegrationService {
  private getErpApiUrl(): string {
    const rawUrl = process.env.ERP_API_URL || '';
    const isDocker = fs.existsSync('/.dockerenv');
    if (rawUrl) {
      if (isDocker && (rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1'))) {
        return rawUrl.replace('localhost', '172.17.0.1').replace('127.0.0.1', '172.17.0.1');
      }
      return rawUrl;
    }
    return isDocker ? 'http://172.17.0.1:5143/api' : 'http://localhost:5143/api';
  }

  private getErpKey(): string {
    return process.env.ERP_INTEGRATION_KEY || 'ermay_web_erp_secure_key_2026';
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const cleanBase = this.getErpApiUrl().replace(/\/$/, '');
    const cleanPath = path.replace(/^\//, '');
    const fullUrl = new URL(`${cleanBase}/${cleanPath}`);
    const isHttps = fullUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const payload = body ? JSON.stringify(body) : undefined;

    return new Promise((resolve, reject) => {
      const req = client.request(
        fullUrl,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-integration-key': this.getErpKey(),
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
          timeout: 8000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(parsed);
              } else {
                reject(new Error(parsed.message || `ERP API Hatası: ${res.statusCode}`));
              }
            } catch {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(data as unknown as T);
              } else {
                reject(new Error(`ERP API Yanıtı Çözümlenemedi (${res.statusCode}): ${data}`));
              }
            }
          });
        },
      );

      req.on('error', (err) => reject(new Error(`ERP API Bağlantı Hatası: ${err.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('ERP API Bağlantısı Zaman Aşımına Uğradı.'));
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  private cachedErpItems: { items: ErpItem[]; timestamp: number } | null = null;

  /**
   * Fetch all syncable items from ERP with 30s TTL in-memory caching
   */
  async fetchErpItems(forceFresh = false): Promise<ErpItem[]> {
    const now = Date.now();
    if (!forceFresh && this.cachedErpItems && (now - this.cachedErpItems.timestamp < 30000)) {
      return this.cachedErpItems.items;
    }
    try {
      const res = await this.request<{ success: boolean; count: number; items: ErpItem[] }>(
        'GET',
        '/integration/items',
      );
      const items = res.items || [];
      this.cachedErpItems = { items, timestamp: now };
      return items;
    } catch (err: unknown) {
      if (this.cachedErpItems) {
        return this.cachedErpItems.items; // Fallback to existing cache if ERP throttled
      }
      throw err;
    }
  }

  /**
   * Fetch combined catalog: ERP items joined with ErmayWeb Product publish/image state
   */
  async getCombinedCatalog(): Promise<CatalogItem[]> {
    const erpItems = await this.fetchErpItems();

    const webProducts = await prisma.product.findMany({
      where: {
        erpItemId: { not: null },
      },
      include: {
        category: true,
      },
    });

    const webProductMap = new Map<string, typeof webProducts[number]>();
    webProducts.forEach((wp) => {
      if (wp.erpItemId) webProductMap.set(wp.erpItemId, wp);
    });

    return erpItems.map((erp) => {
      const matched = webProductMap.get(erp.id);
      return {
        erpId: erp.id,
        erpCode: erp.code,
        erpName: erp.name,
        erpSalePrice: erp.salePrice,
        erpStock: erp.totalStock,
        erpType: erp.typeName,
        erpImage: erp.image,
        webProduct: matched
          ? {
              id: matched.id,
              name: matched.name,
              slug: matched.slug,
              price: Number(matched.price),
              stock: matched.stock,
              isPublished: matched.isPublished,
              images: matched.images || [],
              image: matched.image || '',
              categoryId: matched.categoryId,
              categoryName: matched.category?.name || '',
              description: matched.description,
              dimensions: matched.dimensions,
              material: matched.material,
            }
          : null,
      };
    });
  }

  /**
   * Synchronize (Save or update) an ERP item in ErmayWeb and toggle publish state
   * Rule: Min 1 image, Max 5 images. If images is empty, isPublished CANNOT be true!
   */
  async syncProduct(input: SyncProductInput): Promise<Product> {
    const { erpItemId, isPublished, images, categoryId, name, description, dimensions, material } = input;

    // Enforce 1-5 images rule for published products
    const cleanImages = (images || []).filter((img) => typeof img === 'string' && img.trim().length > 0);

    if (cleanImages.length > 5) {
      throw new Error('Bir ürün için en fazla 5 görsel eklenebilir.');
    }

    if (isPublished && cleanImages.length < 1) {
      throw new Error('Ürünün webde yayına açılabilmesi için en az 1 adet görsel yüklenmelidir.');
    }

    // Fetch fresh ERP info
    const erpItems = await this.fetchErpItems();
    const erpItem = erpItems.find((it) => String(it.id) === String(erpItemId));
    if (!erpItem) {
      throw new Error(`ERP sisteminde ID: ${erpItemId} olan ürün bulunamadı.`);
    }

    // Default category fallback
    let targetCatId = categoryId;
    if (!targetCatId) {
      const defaultCat = await prisma.category.findFirst();
      if (defaultCat) {
        targetCatId = defaultCat.id;
      } else {
        const createdCat = await prisma.category.create({
          data: { name: 'Genel', slug: 'genel' },
        });
        targetCatId = createdCat.id;
      }
    }

    const prodName = name?.trim() || erpItem.name;
    const mainImage = cleanImages[0] || erpItem.image || '';

    // Check if product already exists with erpItemId
    const existing = await prisma.product.findUnique({
      where: { erpItemId: String(erpItemId) },
    });

    let savedProduct;

    if (existing) {
      savedProduct = await prisma.product.update({
        where: { id: existing.id },
        data: {
          name: prodName,
          price: erpItem.salePrice > 0 ? erpItem.salePrice : existing.price,
          stock: erpItem.totalStock,
          inStock: erpItem.totalStock > 0,
          isPublished: isPublished && cleanImages.length >= 1,
          image: mainImage,
          images: cleanImages,
          categoryId: targetCatId,
          description: description !== undefined ? description : existing.description,
          dimensions: dimensions !== undefined ? dimensions : existing.dimensions,
          material: material !== undefined ? material : existing.material,
          lastSyncedAt: new Date(),
        },
      });
    } else {
      const slug = `${slugifyTurkish(prodName)}-${Date.now().toString().slice(-5)}`;
      savedProduct = await prisma.product.create({
        data: {
          name: prodName,
          slug,
          price: erpItem.salePrice > 0 ? erpItem.salePrice : 0,
          stock: erpItem.totalStock,
          inStock: erpItem.totalStock > 0,
          isPublished: isPublished && cleanImages.length >= 1,
          image: mainImage,
          images: cleanImages,
          categoryId: targetCatId,
          description: description || erpItem.description || '',
          dimensions: dimensions || 'G: Standart | D: Standart | Y: Standart',
          material: material || 'Lüks Ermay Mobilya Atölye Üretimi',
          erpItemId: String(erpItemId),
          erpItemCode: erpItem.code,
          lastSyncedAt: new Date(),
        },
      });
    }

    // Sync the primary image back to ERP if we have images
    if (mainImage && mainImage.startsWith('/uploads')) {
      try {
        await this.request('PATCH', `/integration/items/${erpItemId}/image`, {
          imageUrl: mainImage,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`ERP image update warning: ${msg}`);
      }
    }

    await invalidateCachePattern('products:*');

    return savedProduct;
  }

  /**
   * Submit web order directly to ERP sales pipeline
   */
  async submitWebOrderToErp(orderData: ErpWebOrderInput): Promise<{ saleId: string; saleCode: string; orderNumber: string; grandTotal: number | string; partyId: string }> {
    const res = await this.request<{
      success: boolean;
      saleId: string;
      saleCode: string;
      orderNumber?: string;
      grandTotal: number | string;
      partyId: string;
    }>('POST', '/integration/orders', orderData);

    return {
      saleId: res.saleId,
      saleCode: res.saleCode,
      orderNumber: res.orderNumber || res.saleCode,
      grandTotal: res.grandTotal,
      partyId: res.partyId,
    };
  }
}

export const erpIntegrationService = new ErpIntegrationService();
