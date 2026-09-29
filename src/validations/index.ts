import { z } from 'zod';

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
  slug: z.string().min(2, 'Kategori slug en az 2 karakter olmalıdır.'),
  description: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  displayOrder: z.number().int().optional(),
});

export const UpdateCategorySchema = CreateCategorySchema.partial();

export const UpdateCmsBlockSchema = z.object({
  content: z.union([z.record(z.unknown()), z.array(z.unknown()), z.string(), z.number(), z.boolean()]),
  description: z.string().optional(),
});

export * from './request.validation';

// Backward compatibility alias
export { CreateOrderRequestSchema as CreateOrderSchema } from './request.validation';
export { UpdateOrderRequestStatusSchema as UpdateOrderStatusSchema } from './request.validation';

