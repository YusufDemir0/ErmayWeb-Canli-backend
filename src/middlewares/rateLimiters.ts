import rateLimit from 'express-rate-limit';

/**
 * Shared limiter instances: every alias route (/requests, /orders, /admin/orders ...) must use the SAME
 * instance so they share one counter per IP and cannot be used to bypass each other.
 */

// Talep oluşturma: 10 istek / 1 saat / IP
export const requestCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  message: {
    success: false,
    message: 'Çok fazla sipariş talebi oluşturdunuz. Lütfen daha sonra tekrar deneyiniz veya doğrudan WhatsApp hattımızdan iletişime geçiniz.',
  },
});

// Sepet fiyat teklifi: 60 istek / 15 dakika / IP
export const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  message: {
    success: false,
    message: 'Çok fazla fiyat teklif sorgusu yaptınız. Lütfen bir süre sonra tekrar deneyiniz.',
  },
});

// Maskeli fiş görüntüleme: 60 istek / 15 dakika / IP
export const publicReceiptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  message: {
    success: false,
    message: 'Fiş görüntüleme istek limiti aşıldı. Lütfen daha sonra tekrar deneyiniz.',
  },
});
