import { randomUUID } from 'crypto';

/**
 * Web'de kürasyonu yapılan (ERP depo listesinde karşılığı OLMAYAN) ürünlerin ERP ID önekleri.
 * Bu ürünler katalog senkronunda ERP'de aranmaz ve ERP'ye satış olarak gönderilemez.
 */
export const CURATED_ERP_PREFIXES = ['ERM-', 'WEB-', 'ATELIER-'];

export function isCuratedErpId(erpItemId: string): boolean {
  return CURATED_ERP_PREFIXES.some((prefix) => erpItemId.startsWith(prefix));
}

/**
 * ERP'de karşılığı olmayan web ürünlerinin bağlanabildiği ERP deneme ürünleri (ERP kodu `DNM-<değer>`).
 * Admin kabulüyle seçilir; talep ERP'ye bu ürünle, gerçek ad satır açıklamasında ve web fiyatıyla düşer.
 */
export const ERP_PLACEHOLDERS = ['MOBILYA', 'TAKIM', 'KOLTUK', 'MASA'] as const;
export type ErpPlaceholderValue = (typeof ERP_PLACEHOLDERS)[number];

/** Yeni ERP'siz ürün için web kürasyon kimliği (erpItemId tekil ve zorunludur). */
export function newCuratedErpId(): string {
  return `WEB-${randomUUID()}`;
}

/** ERP'nin HTTP hata yanıtı (durum kodu korunur ki kalıcı / geçici hata ayrımı yapılabilsin). */
export class ErpHttpError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'ErpHttpError';
  }
}

/** Tekrar denemekle düzelmeyecek hata: talep beklemeden FAILED'a alınır ve admin uyarılır. */
export class ErpPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErpPermanentError';
  }
}

/**
 * 4xx yanıtlar (doğrulama, ürün bulunamadı) kalıcıdır; 401/403 (anahtar/konfigürasyon), 408 ve 429 ise
 * ayar düzeltilince veya yük azalınca geçer, bu yüzden tekrar denenir.
 */
export function isPermanentErpError(err: unknown): boolean {
  if (err instanceof ErpPermanentError) return true;
  if (err instanceof ErpHttpError) {
    const s = err.statusCode;
    return s >= 400 && s < 500 && ![401, 403, 408, 429].includes(s);
  }
  return false;
}
