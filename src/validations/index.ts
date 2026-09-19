import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email('Geçerli bir e-posta adresi giriniz.'),
  password: z.string().min(6, 'Şifreniz en az 6 karakter olmalıdır.'),
});

export const RegisterSchema = z.object({
  name: z.string().min(2, 'Ad Soyad en az 2 karakter olmalıdır.'),
  email: z.string().email('Geçerli bir e-posta adresi giriniz.'),
  password: z.string().min(6, 'Şifreniz en az 6 karakter olmalıdır.'),
  phone: z.string().optional(),
});

export const CreateProductSchema = z.object({
  name: z.string().min(2, 'Ürün adı en az 2 karakter olmalıdır.'),
  price: z.coerce.number().positive('Fiyat 0\'dan büyük olmalıdır.'),
  originalPrice: z.coerce.number().optional().nullable(),
  categoryId: z.string().optional(),
  category: z.string().optional(), // ✅ Zod'un category slug'ını silmesini engeller
  description: z.string().optional(),
  material: z.string().optional(),
  dimensions: z.string().optional(),
  stock: z.coerce.number().int().nonnegative().optional(),
  image: z.string().optional(),
  images: z.array(z.string()).optional(),
  image1: z.string().optional(),
  image2: z.string().optional(),
  image3: z.string().optional(),
  features: z.array(z.string()).optional(),
  vatRate: z.coerce.number().optional(),
  widthCm: z.coerce.number().optional().nullable(),
  depthCm: z.coerce.number().optional().nullable(),
  heightCm: z.coerce.number().optional().nullable(),
  drawerCount: z.coerce.number().optional().nullable(),
  unitCount: z.coerce.number().optional().nullable(),
  colors: z.array(z.string()).optional(),
});

export const UpdateProductSchema = CreateProductSchema.partial();

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

export const ProcessPaymentSchema = z.object({
  conversationId: z.string().optional(),
  orderId: z.string().min(1, 'Sipariş ID (orderId) zorunludur.'),
  totalAmount: z.number().optional(),
  installment: z.number().int().min(1).max(12).optional(),
  cardHolderName: z.string().min(2, 'Kart üzerindeki isim en az 2 karakter olmalıdır.'),
  cardNumber: z.string().min(12, 'Kart numarası eksik veya geçersiz.'),
  expireMonth: z.union([z.string(), z.number()]),
  expireYear: z.union([z.string(), z.number()]),
  cvv: z.string().min(3).max(4, 'CVV 3 veya 4 haneli olmalıdır.'),
  savedCardId: z.string().optional(),
  cardToken: z.string().optional(),
  buyer: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    surname: z.string().optional(),
    gsmNumber: z.string().optional(),
    email: z.string().email().optional(),
    identityNumber: z.string().optional(),
    registrationAddress: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    ip: z.string().optional(),
  }).optional(),
});

export const CreateOrderSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().optional(),
      product: z.object({ id: z.string() }).optional(),
      variantId: z.string().nullable().optional(),
      quantity: z.number().int().positive('Miktar en az 1 olmalıdır.'),
      price: z.number().positive().optional(),
    })
  ).min(1, 'Sipariş en az 1 ürün içermelidir.'),
  shippingAddress: z.object({
    fullName: z.string().min(2),
    phone: z.string(),
    city: z.string(),
    district: z.string(),
    addressLine: z.string(),
    zipCode: z.string().optional(),
    title: z.string().optional(),
  }).optional(),
  shippingAddressId: z.string().optional(),
  invoiceType: z.enum(['INDIVIDUAL', 'CORPORATE']).optional(),
  tcKn: z.string().optional(),
  companyTitle: z.string().optional(),
  taxNo: z.string().optional(),
  taxOffice: z.string().optional(),
  paymentMethod: z.enum(['CREDIT_CARD', 'BANK_TRANSFER', 'CASH_ON_DELIVERY']).optional(),
  couponCode: z.string().optional(),
  totalAmount: z.number().positive().optional(),
  discountAmount: z.number().optional(),
  receiptUrl: z.string().optional(),
  deviceInfo: z.record(z.unknown()).optional(),
  regionCode: z.string().optional(),
  kvkkAccepted: z.boolean().optional(),
});

export const UpdateOrderStatusSchema = z.object({
  orderStatus: z.enum([
    'PENDING', 'PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED',
    'Ödeme Bekliyor', 'Ödeme Onaylandı', 'Hazırlanıyor', 'Kargoya Verildi', 'Teslim Edildi', 'İptal Edildi', 'İade Edildi'
  ], { required_error: 'Sipariş durumu zorunludur.' }),
  trackingNumber: z.string().optional(),
  shippingCarrier: z.string().optional(),
});
