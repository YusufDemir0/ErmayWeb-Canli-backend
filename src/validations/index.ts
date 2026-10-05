import { z } from 'zod';
import { normalizeTurkishPhone } from './request.validation';
import { TURKEY_PROVINCE_NAMES, isDistrictOf } from './provinces';
import {
  line,
  optionalLine,
  optionalMultiline,
  idString,
  erpId,
  slugString,
  imageUrl,
  optionalImageUrl,
  optionalEmail,
  phoneString,
  money,
  intRange,
  hexColor,
  queryText,
  queryInt,
  queryBool,
} from './common';

export * from './common';
export * from './cms';

// ── Auth ─────────────────────────────────────────────────────────────────────

export const LoginSchema = z
  .object({
    email: z.string().trim().max(150).optional(),
    username: z.string().trim().max(150).optional(),
    password: z.string().min(1, 'Şifre zorunludur.').max(200, 'Şifre en fazla 200 karakter olabilir.'),
  })
  .refine((v) => Boolean(v.email || v.username), { message: 'Kullanıcı adı veya e-posta zorunludur.', path: ['username'] });

export const RegisterSchema = z.object({
  name: line(100, 2, 'Ad Soyad'),
  email: z.string().trim().max(150).email('Geçerli bir e-posta adresi giriniz.'),
  password: z.string().min(10, 'Şifre en az 10 karakter olmalıdır.').max(128),
  phone: z.string().trim().max(25).optional(),
});

/** Password policy (NIST SP 800-63B: length over complexity; at least one letter and one digit as a minimum bar). */
export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Mevcut şifre zorunludur.').max(200),
    newPassword: z
      .string()
      .min(10, 'Yeni şifre en az 10 karakter olmalıdır.')
      .max(128, 'Yeni şifre en fazla 128 karakter olabilir.')
      .refine((v) => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(v) && /\d/.test(v), 'Yeni şifre en az bir harf ve bir rakam içermelidir.'),
  })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'Yeni şifre mevcut şifreyle aynı olamaz.', path: ['newPassword'] });

// ── Products ─────────────────────────────────────────────────────────────────

/** '' / null from empty number inputs -> null; otherwise an integer in range */
const optionalInt = (min: number, max: number, label: string) =>
  z
    .union([z.literal(''), z.null(), intRange(min, max, label)])
    .optional()
    .transform((v) => (v === '' ? null : v));

const ColorVariant = z.union([
  line(60, 1, 'Renk adı'),
  z.object({
    id: z.string().trim().max(64).optional(),
    name: line(60, 1, 'Renk adı'),
    color: z.union([hexColor, z.literal('')]).optional(),
    hex: z.union([hexColor, z.literal('')]).optional(),
    image: z.union([imageUrl, z.literal('')]).optional(),
    tag: z.string().trim().max(40).optional(),
  }),
]);

const SetPiece = z.object({
  id: z.string().trim().max(64).optional(),
  title: line(120, 1, 'Parça adı'),
  dimensions: z.string().trim().max(120).optional(),
  isOptional: z.boolean().optional(),
  pieceProductId: z.union([idString, z.literal('')]).optional(),
});

const ProductFields = z.object({
  name: line(150, 2, 'Ürün adı'),
  price: money.refine((v) => v > 0, 'Fiyat 0\'dan büyük olmalıdır.'),
  originalPrice: z.union([money, z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
  categoryId: idString.optional(),
  category: z
    .union([
      z.string().trim().regex(/^[A-Za-z0-9_-]{1,120}$/, 'Geçersiz kategori.'),
      z.object({ id: idString.optional(), slug: z.string().trim().max(120).optional() }),
    ])
    .optional(),
  description: optionalMultiline(5000, 'Açıklama'),
  material: optionalLine(200, 'Malzeme'),
  dimensions: optionalLine(120, 'Ölçü özeti'),
  stock: intRange(0, 100_000, 'Stok').optional(),
  inStock: z.boolean().optional(),
  image: optionalImageUrl,
  images: z.array(imageUrl).max(12, 'En fazla 12 görsel eklenebilir.').optional(),
  image1: optionalImageUrl,
  image2: optionalImageUrl,
  image3: optionalImageUrl,
  features: z.array(line(160, 1, 'Özellik')).max(20, 'En fazla 20 özellik eklenebilir.').optional(),
  colors: z.array(ColorVariant).max(40, 'En fazla 40 renk eklenebilir.').optional(),
  setPieces: z.array(SetPiece).max(30, 'En fazla 30 parça eklenebilir.').optional(),
  isPublished: z.boolean().optional(),
  // KDV oranı ondalık: 0, 0.01, 0.10, 0.20
  vatRate: z.coerce.number().refine((v) => [0, 0.01, 0.1, 0.2].includes(Number(v.toFixed(2))), 'KDV oranı %0, %1, %10 veya %20 olmalıdır.').optional(),
  widthCm: optionalInt(1, 2000, 'Genişlik'),
  depthCm: optionalInt(1, 2000, 'Derinlik'),
  heightCm: optionalInt(1, 500, 'Yükseklik'),
  drawerCount: optionalInt(0, 50, 'Çekmece sayısı'),
  leadTimeDays: optionalInt(0, 365, 'Teslim süresi'),
  unitCount: optionalInt(1, 1000, 'Parça adedi'),
  badge: optionalLine(40, 'Rozet'),
  erpItemId: erpId,
  erpItemCode: z.union([z.string().trim().max(100), z.null()]).optional(),
});

export const CreateProductSchema = ProductFields.refine(
  (v) => v.originalPrice == null || v.originalPrice > v.price,
  { message: 'Eski fiyat, satış fiyatından büyük olmalıdır.', path: ['originalPrice'] }
);
export const UpdateProductSchema = ProductFields.partial().refine(
  (v) => v.originalPrice == null || v.price === undefined || v.originalPrice > v.price,
  { message: 'Eski fiyat, satış fiyatından büyük olmalıdır.', path: ['originalPrice'] }
);

export const BulkLinkSchema = z.object({
  erpItemIds: z.array(erpId).min(1, 'En az bir ERP ürünü seçilmelidir.').max(500, 'Tek seferde en fazla 500 ürün eşlenebilir.'),
  categoryId: idString,
  isPublished: z.boolean().optional(),
});

export const ProductListQuerySchema = z.object({
  category: queryText(120),
  search: queryText(100),
  minPrice: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Geçersiz fiyat.').optional(),
  maxPrice: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Geçersiz fiyat.').optional(),
  sort: z.enum(['default', 'newest', 'price_asc', 'price_desc', 'popular']).optional(),
  page: queryInt(1, 10_000, 1),
  limit: queryInt(1, 1000, 24),
  includeUnpublished: queryBool,
});

export const ProductRefParamSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,160}$/, 'Geçersiz ürün.'),
});

// ── Categories ───────────────────────────────────────────────────────────────

export const CreateCategorySchema = z.object({
  name: line(80, 2, 'Kategori adı'),
  slug: slugString.optional(),
  description: optionalMultiline(1000, 'Açıklama'),
  image: optionalImageUrl,
  parentId: z.union([idString, z.null()]).optional(),
  sortOrder: intRange(0, 100_000, 'Sıra').optional(),
  displayOrder: intRange(0, 100_000, 'Sıra').optional(),
});

export const UpdateCategorySchema = CreateCategorySchema.partial();

export const ReorderCategoriesSchema = z.object({
  items: z
    .array(
      z.object({
        id: idString,
        parentId: z.union([idString, z.null()]).optional(),
        sortOrder: intRange(0, 100_000, 'Sıra'),
      })
    )
    .min(1, 'En az bir kategori öğesi gönderilmelidir.')
    .max(500),
});

export const DeleteCategoryQuerySchema = z.object({ reassignTo: idString.optional() });

// ── Contact form ─────────────────────────────────────────────────────────────

export const CreateContactMessageSchema = z.object({
  name: line(100, 2, 'Ad Soyad'),
  phone: z
    .string()
    .trim()
    .max(25, 'Telefon en fazla 25 karakter olabilir.')
    .transform(normalizeTurkishPhone)
    // Kurumsal müşteriler sabit hat / yurt dışı numarası da yazabilir (frontend ile aynı kural: 8-15 hane)
    .refine((val) => /^[0-9+()\s-]+$/.test(val) && val.replace(/\D/g, '').length >= 8 && val.replace(/\D/g, '').length <= 15, {
      message: 'Lütfen geçerli bir telefon numarası giriniz.',
    }),
  email: optionalEmail.transform((v) => v ?? undefined),
  subject: line(150, 2, 'Konu').default('Genel İletişim'),
  message: z
    .string()
    .trim()
    .min(10, 'Mesajınız en az 10 karakter olmalıdır.')
    .max(3000, 'Mesajınız en fazla 3000 karakter olabilir.')
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), 'Mesaj geçersiz karakter içeriyor.'),
  website: z.string().max(200).optional(), // honeypot
});

export const ContactListQuerySchema = z.object({
  status: z.enum(['open', 'handled', 'all']).optional().default('open'),
  page: queryInt(1, 10_000, 1),
  limit: queryInt(1, 100, 25),
});

// ── Order requests (admin list) ──────────────────────────────────────────────

export const RequestListQuerySchema = z.object({
  status: z.enum(['all', 'NEW', 'CONTACTED', 'STORE_VISIT_SCHEDULED', 'AWAITING_PAYMENT', 'PAID_OFFLINE', 'COMPLETED', 'CANCELLED', 'SPAM', 'EXPIRED']).optional(),
  preference: z.enum(['all', 'WHATSAPP', 'STORE_VISIT']).optional(),
  erpSyncStatus: z.enum(['all', 'PENDING', 'IN_PROGRESS', 'SYNCED', 'FAILED']).optional(),
  search: queryText(100),
  page: queryInt(1, 10_000, 1),
  limit: queryInt(1, 200, 25),
});

export * from './request.validation';

// Backward compatibility alias
export { CreateOrderRequestSchema as CreateOrderSchema } from './request.validation';
export { UpdateOrderRequestStatusSchema as UpdateOrderStatusSchema } from './request.validation';

// ── Stores ───────────────────────────────────────────────────────────────────
// İl ve ilçe serbest metin değil: resmî listeden seçilir ve ilçe seçilen ile ait olmalıdır.

const StoreFields = z.object({
  name: line(120, 2, 'Mağaza adı'),
  city: z.enum(TURKEY_PROVINCE_NAMES, { errorMap: () => ({ message: 'Geçerli bir il seçiniz.' }) }),
  district: optionalLine(60, 'İlçe'),
  address: line(300, 5, 'Adres'),
  phone: phoneString,
  email: optionalEmail,
  hours: optionalLine(200, 'Çalışma saatleri'),
  image: optionalImageUrl,
  mapUrl: z
    .union([z.string().trim().max(1000).regex(/^https:\/\/[^\s]+$/, 'Harita bağlantısı https:// ile başlamalıdır.'), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v)),
  isActive: z.boolean().optional(),
  sortOrder: intRange(0, 10_000, 'Sıra').optional(),
});

const districtIssue = { message: 'İlçe seçilen ile ait değil. Listeden seçiniz.', path: ['district'] };

export const CreateStoreSchema = StoreFields.refine((v) => !v.district || isDistrictOf(v.city, v.district), districtIssue);
export const UpdateStoreSchema = StoreFields.partial()
  .refine((v) => !v.district || Boolean(v.city), { message: 'İlçe güncellenirken il de gönderilmelidir.', path: ['city'] })
  .refine((v) => !v.district || !v.city || isDistrictOf(v.city, v.district), districtIssue);

export const StoreListQuerySchema = z.object({ all: queryBool });

// ── Blog ─────────────────────────────────────────────────────────────────────

export const CreateBlogPostSchema = z.object({
  title: line(200, 3, 'Başlık'),
  summary: optionalMultiline(500, 'Özet'),
  content: z
    .string()
    .trim()
    .min(1, 'İçerik zorunludur.')
    .max(100_000, 'İçerik en fazla 100.000 karakter olabilir.')
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), 'İçerik geçersiz karakter içeriyor.'),
  coverImage: optionalImageUrl,
  category: optionalLine(80, 'Kategori'),
  tags: z.array(line(40, 1, 'Etiket')).max(20, 'En fazla 20 etiket eklenebilir.').optional(),
  author: optionalLine(80, 'Yazar'),
  isPublished: z.boolean().optional(),
});
export const UpdateBlogPostSchema = CreateBlogPostSchema.partial();

export const BlogListQuerySchema = z.object({
  category: queryText(80),
  search: queryText(100),
  page: queryInt(1, 10_000, 1),
  limit: queryInt(1, 100, 12),
  all: queryBool,
});

// ── Delivery zones / geo ─────────────────────────────────────────────────────

export const DeliveryZonesSchema = z.object({
  disabledCityIds: z.array(intRange(1, 81, 'Plaka kodu')).max(81).default([]),
  disabledCityNames: z.array(z.enum(TURKEY_PROVINCE_NAMES)).max(81).default([]),
  noticeMessage: z.string().trim().max(300, 'Uyarı metni en fazla 300 karakter olabilir.').default(''),
});

export const ReverseGeoQuerySchema = z.object({
  lat: z.string().regex(/^-?\d{1,3}(\.\d{1,10})?$/, 'Geçersiz enlem.'),
  lng: z.string().regex(/^-?\d{1,3}(\.\d{1,10})?$/, 'Geçersiz boylam.'),
});

// ── Integrations ─────────────────────────────────────────────────────────────

export const TelegramTestSchema = z.object({
  botToken: z.union([z.string().trim().regex(/^\d{5,12}:[A-Za-z0-9_-]{30,50}$/, 'Bot token biçimi geçersiz.'), z.literal('')]).optional(),
  chatId: z.union([z.string().trim().regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/, 'Sohbet kimliği biçimi geçersiz.'), z.literal('')]).optional(),
});

export const ErpSyncSchema = z.object({
  erpItemId: erpId,
  isPublished: z.boolean().optional(),
  images: z.array(imageUrl).max(12).optional(),
  categoryId: idString.optional(),
  name: optionalLine(150, 'Ürün adı'),
  description: optionalMultiline(5000, 'Açıklama'),
  dimensions: optionalLine(120, 'Ölçü özeti'),
  material: optionalLine(200, 'Malzeme'),
});

/** ERP -> web sale status webhook (authenticated by x-integration-key before parsing). */
const erpRef = z.union([z.string().trim().regex(/^[A-Za-z0-9_.:/-]{1,100}$/), z.number().int().nonnegative()]).transform(String);
export const ErpSaleWebhookSchema = z.object({
  saleCode: erpRef.optional(),
  saleId: erpRef.optional(),
  externalRef: erpRef.optional(),
  status: z.string().trim().max(40).optional(),
});
