import { z } from 'zod';
import { RequestStatus } from '@prisma/client';

/**
 * Normalizes Turkish phone numbers to E.164 format (+905XXXXXXXXX).
 * Accepts:
 *   "0532 123 45 67" -> "+905321234567"
 *   "+90 532 123 4567" -> "+905321234567"
 *   "5321234567" -> "+905321234567"
 */
export function normalizeTurkishPhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/[^0-9]/g, '');

  if (digits.startsWith('905') && digits.length === 12) {
    return `+${digits}`;
  }
  if (digits.startsWith('05') && digits.length === 11) {
    return `+90${digits.slice(1)}`;
  }
  if (digits.startsWith('5') && digits.length === 10) {
    return `+90${digits}`;
  }
  return phone.trim();
}

/**
 * Masks customer name for public receipt DTO.
 * Example: "Ahmet Yılmaz" -> "Ahmet Y."
 * Example: "Yusuf" -> "Yusuf"
 */
export function maskCustomerName(fullName: string): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const firstNames = parts.slice(0, -1).join(' ');
  const lastName = parts[parts.length - 1];
  return `${firstNames} ${lastName.charAt(0)}.`;
}

/**
 * Masks customer phone for public receipt DTO.
 * Example: "+905321234567" -> "+90 532 *** ** 67"
 */
export function maskCustomerPhone(phone: string): string {
  const normalized = normalizeTurkishPhone(phone);
  if (/^\+905[0-9]{9}$/.test(normalized)) {
    const operator = normalized.slice(3, 6); // 532
    const last2 = normalized.slice(-2); // 67
    return `+90 ${operator} *** ** ${last2}`;
  }
  return '*** *** ** **';
}

/**
 * Sepet Teklifi Doğrulama Şeması (POST /api/v1/cart/quote)
 */
export const QuoteCartSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string({ required_error: 'Ürün ID (productId) zorunludur.' }).min(1),
        colorKey: z.string().optional().nullable(),
        quantity: z.coerce.number().int().min(1, 'Miktar en az 1 olmalıdır.').max(20, 'En fazla 20 adet seçilebilir.').default(1),
      })
    )
    .min(1, 'Sepet boş olamaz.')
    .max(30, 'Bir teklifte en fazla 30 farklı ürün bulunabilir.'),
});

export type QuoteCartInput = z.infer<typeof QuoteCartSchema>;

/**
 * Sipariş Talebi Oluşturma Şeması (POST /api/v1/requests)
 */
export const CreateOrderRequestSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string({ required_error: 'Ürün ID (productId) zorunludur.' }).min(1),
        colorKey: z.string().optional().nullable(),
        colorLabel: z.string().optional().nullable(),
        quantity: z.coerce.number().int().min(1, 'Miktar en az 1 olmalıdır.').max(20, 'En fazla 20 adet seçilebilir.').default(1),
      })
    )
    .min(1, 'Sipariş talebi için sepette en az 1 ürün bulunmalıdır.')
    .max(30, 'Bir talepte en fazla 30 farklı ürün bulunabilir.'),
  customerName: z
    .string({ required_error: 'Lütfen Ad Soyad alanını doldurunuz.' })
    .trim()
    .min(2, 'Ad Soyad en az 2 karakter olmalıdır.')
    .max(100, 'Ad Soyad en fazla 100 karakter olabilir.'),
  customerPhone: z
    .string({ required_error: 'Lütfen İletişim Telefonu alanını doldurunuz.' })
    .trim()
    .transform(normalizeTurkishPhone)
    .refine((val) => /^\+905[0-9]{9}$/.test(val), {
      message: 'Lütfen geçerli bir Türkiye cep telefonu numarası giriniz (05XX XXX XX XX).',
    }),
  customerEmail: z
    .string()
    .trim()
    .email('Geçerli bir e-posta adresi giriniz.')
    .optional()
    .nullable()
    .or(z.literal('')),
  city: z
    .string({ required_error: 'Lütfen il seçiniz veya giriniz.' })
    .trim()
    .min(2, 'Şehir adı en az 2 karakter olmalıdır.')
    .max(50, 'Şehir adı en fazla 50 karakter olabilir.'),
  district: z.string().trim().max(50).optional().nullable(),
  addressLine: z.string().trim().max(255).optional().nullable(),
  preference: z.enum(['WHATSAPP', 'STORE_VISIT'], {
    required_error: 'Lütfen talep tamamlama tercihinizi seçiniz (WhatsApp veya Mağaza).',
  }),
  preferredStoreId: z.string().optional().nullable(),
  note: z.string().trim().max(500, 'Not en fazla 500 karakter olabilir.').optional().nullable(),
  kvkkNoticeAcknowledged: z.boolean({
    required_error: 'KVKK Aydınlatma Metni onayı zorunludur.',
  }).refine((val) => val === true, {
    message: 'Lütfen KVKK Aydınlatma Metni\'ni okuyup onaylayınız.',
  }),
  marketingConsent: z.boolean().optional().default(false),
  website: z.string().optional(), // Honeypot (bot tuzağı)
});

export type CreateOrderRequestInput = z.infer<typeof CreateOrderRequestSchema>;

/**
 * Admin Talep Durum Güncelleme Şeması (PATCH /api/v1/admin/requests/:id/status)
 */
export const UpdateOrderRequestStatusSchema = z.object({
  status: z.nativeEnum(RequestStatus, {
    required_error: 'Geçerli bir talep durumu belirtilmelidir.',
  }),
  note: z.string().trim().max(500, 'Not en fazla 500 karakter olabilir.').optional().nullable(),
  staffNote: z.string().trim().max(500, 'Not en fazla 500 karakter olabilir.').optional().nullable(),
  assignedToId: z.string().optional().nullable(),
});

export type UpdateOrderRequestStatusInput = z.infer<typeof UpdateOrderRequestStatusSchema>;
