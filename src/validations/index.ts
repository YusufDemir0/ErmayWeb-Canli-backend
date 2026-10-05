import { z } from 'zod';
import { normalizeTurkishPhone } from './request.validation';
import { TURKEY_PROVINCE_NAMES } from './provinces';

export const LoginSchema = z.object({
  email: z.string().optional(),
  username: z.string().optional(),
  password: z.string().min(1, 'Şifre zorunludur.'),
});

export const RegisterSchema = z.object({
  name: z.string().min(2, 'Ad Soyad en az 2 karakter olmalıdır.'),
  email: z.string().email('Geçerli bir e-posta adresi giriniz.'),
  password: z.string().min(6, 'Şifreniz en az 6 karakter olmalıdır.'),
  phone: z.string().optional(),
});

export const CreateProductSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, 'Ürün adı en az 2 karakter olmalıdır.'),
  price: z.coerce.number().positive('Fiyat 0\'dan büyük olmalıdır.'),
  originalPrice: z.coerce.number().optional().nullable(),
  categoryId: z.string().optional(),
  category: z.union([z.string(), z.record(z.unknown())]).optional(),
  description: z.string().optional(),
  material: z.string().optional(),
  dimensions: z.string().optional(),
  dimensionSpec: z.unknown().optional(),
  stock: z.coerce.number().int().nonnegative().optional(),
  image: z.string().optional(),
  images: z.array(z.string()).optional(),
  image1: z.string().optional(),
  image2: z.string().optional(),
  image3: z.string().optional(),
  features: z.array(z.string()).optional(),
  isPublished: z.boolean().optional(),
  vatRate: z.coerce.number().optional(),
  widthCm: z.coerce.number().optional().nullable(),
  depthCm: z.coerce.number().optional().nullable(),
  heightCm: z.coerce.number().optional().nullable(),
  drawerCount: z.coerce.number().optional().nullable(),
  leadTimeDays: z.coerce.number().optional().nullable(),
  unitCount: z.coerce.number().optional().nullable(),
  colors: z.array(z.union([z.string(), z.record(z.unknown())])).optional(),
  setPieces: z.array(z.unknown()).optional(),
  badge: z.string().optional(),
  rating: z.number().optional(),
  reviewsCount: z.number().optional(),
  salesCount: z.number().optional(),
  erpItemId: z.string().min(1, 'CRM ERP Ürün Eşleştirmesi (erpItemId) zorunludur.'),
  erpItemCode: z.string().optional().nullable(),
});

export const UpdateProductSchema = CreateProductSchema.partial();

export const BulkLinkSchema = z.object({
  erpItemIds: z.array(z.string().min(1)).min(1, 'En az bir ERP ürünü seçilmelidir.'),
  categoryId: z.string().min(1, 'Hedef kategori seçilmelidir.'),
  isPublished: z.boolean().optional(),
});

export const CreateCategorySchema = z.object({
  name: z.string().min(2, 'Kategori adı en az 2 karakter olmalıdır.'),
  slug: z.string().min(2).optional(),
  description: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
  displayOrder: z.number().int().optional(),
});

export const UpdateCategorySchema = CreateCategorySchema.partial();

export const ReorderCategoriesSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1, 'Kategori ID zorunludur.'),
      parentId: z.string().nullable().optional(),
      sortOrder: z.number().int(),
    })
  ).min(1, 'En az bir kategori öğesi gönderilmelidir.'),
});

export const UpdateCmsBlockSchema = z.object({
  content: z.union([z.record(z.unknown()), z.array(z.unknown()), z.string(), z.number(), z.boolean()]),
  description: z.string().optional(),
});

export const CreateContactMessageSchema = z.object({
  name: z.string().trim().min(2, 'Ad Soyad en az 2 karakter olmalıdır.').max(100, 'Ad Soyad en fazla 100 karakter olabilir.'),
  phone: z
    .string()
    .trim()
    .transform(normalizeTurkishPhone)
    // Kurumsal müşteriler sabit hat / yurt dışı numarası da yazabilir (frontend ile aynı kural: 8-15 hane)
    .refine((val) => /^[0-9+()\s-]+$/.test(val) && val.replace(/\D/g, '').length >= 8 && val.replace(/\D/g, '').length <= 15, {
      message: 'Lütfen geçerli bir telefon numarası giriniz.',
    }),
  email: z
    .string()
    .trim()
    .max(150)
    .email('Geçerli bir e-posta adresi giriniz.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  subject: z.string().trim().min(2, 'Konu en az 2 karakter olmalıdır.').max(150).default('Genel İletişim'),
  message: z.string().trim().min(10, 'Mesajınız en az 10 karakter olmalıdır.').max(3000, 'Mesajınız en fazla 3000 karakter olabilir.'),
});

export * from './request.validation';

// Backward compatibility alias
export { CreateOrderRequestSchema as CreateOrderSchema } from './request.validation';
export { UpdateOrderRequestStatusSchema as UpdateOrderStatusSchema } from './request.validation';


// ── Mağaza / bayi ─────────────────────────────────────────────────────────────
// İl serbest metin değil: 81 ilden biri olmalı (admin panelinde seçim listesiyle girilir)
const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]).optional().transform((v) => (v === '' ? null : v));
const imagePath = z
  .union([z.string().trim().max(500).regex(/^(\/(?!\/)|https:\/\/)/, 'Görsel adresi site içi bir yol (/...) ya da https:// ile başlamalıdır.'), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

export const CreateStoreSchema = z.object({
  name: z.string().trim().min(2, 'Mağaza adı en az 2 karakter olmalıdır.').max(120),
  city: z.enum(TURKEY_PROVINCE_NAMES, { errorMap: () => ({ message: 'Geçerli bir il seçiniz.' }) }),
  district: optionalText(60),
  address: z.string().trim().min(5, 'Adres en az 5 karakter olmalıdır.').max(300),
  phone: z
    .string()
    .trim()
    .refine((v) => /^[0-9+()\s-]+$/.test(v) && v.replace(/\D/g, '').length >= 10 && v.replace(/\D/g, '').length <= 15, {
      message: 'Geçerli bir telefon numarası giriniz.',
    }),
  email: z.union([z.string().trim().email('Geçerli bir e-posta giriniz.'), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
  hours: optionalText(200),
  image: imagePath,
  mapUrl: z
    .union([z.string().trim().url('Harita bağlantısı geçerli bir adres olmalıdır.').max(1000), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v)),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});
export const UpdateStoreSchema = CreateStoreSchema.partial();

// ── Blog ──────────────────────────────────────────────────────────────────────
export const CreateBlogPostSchema = z.object({
  title: z.string().trim().min(3, 'Başlık en az 3 karakter olmalıdır.').max(200),
  summary: optionalText(500),
  content: z.string().trim().min(1, 'İçerik zorunludur.').max(100_000),
  coverImage: imagePath,
  category: optionalText(80),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  author: optionalText(80),
  isPublished: z.boolean().optional(),
});
export const UpdateBlogPostSchema = CreateBlogPostSchema.partial();
