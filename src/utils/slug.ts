/**
 * Turkish Character Aware URL Slug Generator
 * Converts Turkish characters (ğ, ü, ş, ı, ö, ç, İ, Ğ, Ü, Ş, Ö, Ç)
 * cleanly into standard URL-safe slugs without dropping letters.
 */
export function slugifyTurkish(text: string): string {
  if (!text) return '';

  const trMap: Record<string, string> = {
    'ç': 'c', 'Ç': 'c',
    'ğ': 'g', 'Ğ': 'g',
    'ı': 'i', 'I': 'i', 'İ': 'i',
    'ö': 'o', 'Ö': 'o',
    'ş': 's', 'Ş': 's',
    'ü': 'u', 'Ü': 'u',
  };

  const normalized = text
    .split('')
    .map((char) => trMap[char] || char)
    .join('');

  return normalized
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // remove invalid characters
    .replace(/\s+/g, '-')         // collapse whitespace into -
    .replace(/-+/g, '-')         // collapse multiple -
    .replace(/(^-|-$)+/g, '');   // trim leading/trailing -
}

/**
 * Normalizes Turkish text for comparison, folding all diacritics and dotless/dotted I/İ safely to lowercase ASCII.
 * Guarantees that "Istanbul", "İstanbul", "ıstanbul", "İSTANBUL", "ISTANBUL" all normalize to "istanbul".
 */
export function normalizeTurkishText(text: string): string {
  if (!text) return '';
  return text
    .trim()
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/Ğ/g, 'g')
    .replace(/ğ/g, 'g')
    .replace(/Ü/g, 'u')
    .replace(/ü/g, 'u')
    .replace(/Ş/g, 's')
    .replace(/ş/g, 's')
    .replace(/Ö/g, 'o')
    .replace(/ö/g, 'o')
    .replace(/Ç/g, 'c')
    .replace(/ç/g, 'c')
    .toLowerCase();
}

