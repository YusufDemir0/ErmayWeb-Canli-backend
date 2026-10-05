import { z } from 'zod';

/**
 * Shared field builders for request validation.
 *
 * Every string has an explicit maximum length, control characters are rejected and surrounding whitespace is trimmed.
 * Database access goes through Prisma (parameterised queries), so these rules are not the SQL injection defence by
 * themselves; they keep stored data well-formed, bound payload sizes and stop script URLs from reaching the pages.
 */

// C0 control characters except tab/newline/carriage return, plus DEL
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// Single-line fields must not contain line breaks either
const LINE_BREAKS = /[\r\n\u2028\u2029]/;

const noControl = (v: string) => !CONTROL_CHARS.test(v);

/** Required single-line text. */
export const line = (max: number, min = 1, label = 'Bu alan') =>
  z
    .string({ required_error: `${label} zorunludur.`, invalid_type_error: `${label} metin olmalıdır.` })
    .trim()
    .min(min, min <= 1 ? `${label} boş bırakılamaz.` : `${label} en az ${min} karakter olmalıdır.`)
    .max(max, `${label} en fazla ${max} karakter olabilir.`)
    .refine(noControl, `${label} geçersiz karakter içeriyor.`)
    .refine((v) => !LINE_BREAKS.test(v), `${label} tek satır olmalıdır.`);

/** Required multi-line text (paragraphs). */
export const multiline = (max: number, min = 1, label = 'Bu alan') =>
  z
    .string({ required_error: `${label} zorunludur.`, invalid_type_error: `${label} metin olmalıdır.` })
    .trim()
    .min(min, min <= 1 ? `${label} boş bırakılamaz.` : `${label} en az ${min} karakter olmalıdır.`)
    .max(max, `${label} en fazla ${max} karakter olabilir.`)
    .refine(noControl, `${label} geçersiz karakter içeriyor.`);

/** Optional single-line text: '' and null are stored as null. */
export const optionalLine = (max: number, label = 'Bu alan') =>
  z
    .union([z.string().trim().max(max, `${label} en fazla ${max} karakter olabilir.`), z.null()])
    .optional()
    .refine((v) => v == null || (noControl(v) && !LINE_BREAKS.test(v)), `${label} geçersiz karakter içeriyor.`)
    .transform((v) => (v === '' ? null : v));

/** Optional multi-line text: '' and null are stored as null. */
export const optionalMultiline = (max: number, label = 'Bu alan') =>
  z
    .union([z.string().trim().max(max, `${label} en fazla ${max} karakter olabilir.`), z.null()])
    .optional()
    .refine((v) => v == null || noControl(v), `${label} geçersiz karakter içeriyor.`)
    .transform((v) => (v === '' ? null : v));

/** Database ids (uuid / cuid / slug-like). */
export const idString = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Geçersiz kimlik.');

/** ERP item ids/codes may contain dots, colons and slashes. */
export const erpId = z.string().trim().regex(/^[A-Za-z0-9_.:/-]{1,100}$/, 'Geçersiz ERP kimliği.');

export const slugString = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Adres (slug) yalnız küçük harf, rakam ve tire içerebilir.')
  .max(120, 'Adres (slug) en fazla 120 karakter olabilir.');

/** Site-relative path (/uploads/...) or https URL. Protocol-relative (//host) and script URLs are rejected. */
export const imageUrl = z
  .string()
  .trim()
  .max(500, 'Görsel adresi en fazla 500 karakter olabilir.')
  .regex(/^(\/(?!\/)[^\s]*|https:\/\/[^\s]+)$/, 'Görsel adresi site içi bir yol (/...) ya da https:// ile başlamalıdır.');

export const optionalImageUrl = z
  .union([imageUrl, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

/**
 * Link targets shown on public pages (buttons, menu items). Only safe schemes are allowed:
 * site paths, in-page anchors, https, tel:, mailto:. `javascript:` / `data:` URLs are rejected (stored XSS).
 */
export const safeHref = z
  .string()
  .trim()
  .max(500, 'Bağlantı en fazla 500 karakter olabilir.')
  .regex(
    /^(\/(?!\/)[^\s]*|#[A-Za-z0-9_-]+|https:\/\/[^\s]+|tel:\+?[0-9\s()-]{3,20}|mailto:[^\s@]+@[^\s@]+)$/,
    'Bağlantı /sayfa, #bolum, https://, tel: veya mailto: ile başlamalıdır.'
  );

export const hexColor = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, 'Renk #RRGGBB biçiminde olmalıdır.');

/**
 * Türkiye telefonu: girişi E.164'e normalize eder ("0532 419 41 51" -> "+905324194151") ve doğrular.
 * Sabit hat 2xx–4xx, cep 5xx, kurumsal 850. Harf veya eksik hane kabul edilmez.
 */
export function normalizeTrPhone(raw: string): string {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('90') && d.length > 10) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d.length === 10 ? `+90${d}` : String(raw || '').trim();
}
const TR_PHONE = /^\+90(?:[2-5]\d{9}|850\d{7})$/;
const TR_MOBILE = /^\+905\d{9}$/;
const PHONE_CHARS = /^[0-9+()\s-]*$/;

export const trPhone = (opts: { mobile?: boolean } = {}) =>
  z
    .string()
    .trim()
    .max(25, 'Telefon en fazla 25 karakter olabilir.')
    .refine((v) => PHONE_CHARS.test(v), 'Telefon yalnız rakam içermelidir.')
    .transform(normalizeTrPhone)
    .refine((v) => (opts.mobile ? TR_MOBILE : TR_PHONE).test(v), {
      message: opts.mobile ? 'Geçerli bir cep telefonu yazın (+90 5XX XXX XX XX).' : 'Geçerli bir Türkiye telefon numarası yazın (+90 XXX XXX XX XX).',
    });

export const phoneString = trPhone();

/** Boş bırakılabilen telefon: '' kalır, doluysa trPhone kuralı */
export const optionalTrPhone = (opts: { mobile?: boolean } = {}) =>
  z.union([z.literal(''), trPhone(opts)]).optional().default('');

export const emailString = z.string().trim().max(150, 'E-posta en fazla 150 karakter olabilir.').email('Geçerli bir e-posta adresi giriniz.');

export const optionalEmail = z
  .union([emailString, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

/** Money in TRY: non-negative, at most 2 decimals, below 100 million. */
export const money = z.coerce
  .number({ invalid_type_error: 'Tutar sayı olmalıdır.' })
  .finite()
  .min(0, 'Tutar negatif olamaz.')
  .max(99_999_999, 'Tutar çok büyük.')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Tutar en fazla 2 ondalık basamak içerebilir.');

/** Integer within a range (accepts numeric strings from form inputs). */
export const intRange = (min: number, max: number, label = 'Değer') =>
  z.coerce
    .number({ invalid_type_error: `${label} sayı olmalıdır.` })
    .int(`${label} tam sayı olmalıdır.`)
    .min(min, `${label} en az ${min} olabilir.`)
    .max(max, `${label} en fazla ${max} olabilir.`);

// ── Query string / route params ──────────────────────────────────────────────
// Express parses `?a=1&a=2` as an array; single-value params must be strings.

/** Optional query string param; arrays are rejected. */
export const queryText = (max: number) =>
  z
    .string({ invalid_type_error: 'Sorgu parametresi tek değer olmalıdır.' })
    .trim()
    .max(max, `Sorgu en fazla ${max} karakter olabilir.`)
    .refine(noControl, 'Sorgu geçersiz karakter içeriyor.')
    .optional();

export const queryInt = (min: number, max: number, fallback: number) =>
  z
    .string({ invalid_type_error: 'Sorgu parametresi tek değer olmalıdır.' })
    .regex(/^\d{1,9}$/, 'Sayı bekleniyor.')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))
    .optional()
    .transform((v) => v ?? fallback);

export const queryBool = z.enum(['true', 'false']).optional();

export const IdParamSchema = z.object({ id: idString });
export const SlugParamSchema = z.object({ slug: z.string().trim().regex(/^[A-Za-z0-9-]{1,160}$/, 'Geçersiz adres.') });
export const TokenParamSchema = z.object({ token: z.string().trim().regex(/^[A-Za-z0-9_-]{8,128}$/, 'Geçersiz bağlantı.') });
