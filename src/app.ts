import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import crypto from 'crypto';
import routes from './routes';
import { prisma } from './config/database';
import { imageOptimizerMiddleware } from './middlewares/imageOptimizer.middleware';
import { logger, errorFields, requestContext } from './utils/logger';

export const app = express();

// 1. Trust Proxy Configuration: yalnızca loopback ve RFC1918/ULA özel ağlar (Docker ağları, Next.js proxy, host nginx).
// 'uniquelocal' = 10/8, 172.16/12, 192.168/16, fc00::/7. Önceki `ip.startsWith('172.')` kontrolü 172.217.x gibi
// herkese açık adreslere de güveniyor ve X-Forwarded-For ile hız sınırının atlatılmasına izin veriyordu.
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

// 2. Disable Fingerprinting & Info Disclosure
app.disable('x-powered-by');

// 3. High-Performance Gzip / Deflate Compression
app.use(compression({
  threshold: 1024, // Compress responses larger than 1KB
}));

// 4. Enterprise Security Headers (Helmet)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // Managed via frontend reverse proxy
}));

// 5. Enterprise CORS Configuration with Strict Whitelist Enforcement
const rawOrigins = (process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().toLowerCase())
  .filter(Boolean);

const LOCALHOST_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/;
const OFFICIAL_DOMAINS = [
  'https://ermaymobilya.com',
  'https://www.ermaymobilya.com',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser clients (curl, mobile, server-side SSR)
    if (!origin) return callback(null, true);
    
    const lowerOrigin = origin.toLowerCase().trim();

    // Check against configured allowed origins from environment
    if (rawOrigins.includes(lowerOrigin) || (process.env.NODE_ENV !== 'production' && rawOrigins.includes('*'))) {
      return callback(null, true);
    }

    // Check official production domains
    if (OFFICIAL_DOMAINS.includes(lowerOrigin)) {
      return callback(null, true);
    }

    // In development mode only: allow exact localhost & 127.0.0.1 origins
    if (process.env.NODE_ENV !== 'production' && LOCALHOST_REGEX.test(lowerOrigin)) {
      return callback(null, true);
    }

    // Explicitly reject unauthorized foreign origins without throwing 500 error
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Accept', 'Idempotency-Key', 'x-integration-key'],
}));

// 6. URL Normalization & Malicious Path Traversal Protection
app.use((req, res, next) => {
  try {
    decodeURIComponent(req.path);
  } catch (e) {
    res.status(400).json({ success: false, message: 'Geçersiz URL kodlaması (Malformed URI).' });
    return;
  }

  if (req.path.includes('..') || req.path.includes('//')) {
    res.status(400).json({ success: false, message: 'Güvenlik İhlali: Yetkisiz yol gezintisi (Path Traversal).' });
    return;
  }
  next();
});

// 7. Traceability: request id (header'dan gelirse güvenli biçimdeyse kullanılır) + istek bağlamı (AsyncLocalStorage)
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,100}$/;
app.use((req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const requestId =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
      ? incoming
      : `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  requestContext.run({ requestId }, () => next());
});

// 8. Structured HTTP access log (ECS fields). Client IP is truncated (last IPv4 octet / IPv6 lower bits) for KVKK/GDPR.
const maskIp = (ip: string): string => {
  if (ip.includes('.')) return ip.replace(/\.\d+$/, '.0');
  if (ip.includes(':')) return `${ip.split(':').slice(0, 4).join(':')}::`;
  return ip;
};
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health') return;
    const durationNs = Number(process.hrtime.bigint() - start);
    const status = res.statusCode;
    const fields = {
      'event.category': ['web'],
      'event.duration': durationNs,
      'http.request.method': req.method,
      'url.path': req.originalUrl.split('?')[0],
      'http.response.status_code': status,
      'http.response.body.bytes': Number(res.getHeader('content-length')) || undefined,
      'client.ip_prefix': maskIp(req.ip || req.socket.remoteAddress || '-'),
    };
    const msg = `${req.method} ${fields['url.path']} ${status}`;
    if (status >= 500) logger.error(msg, fields);
    else if (status >= 400) logger.warn(msg, fields);
    else logger.info(msg, fields);
  });
  next();
});

// 8b. Audit trail: every state-changing API call (create/update/delete/login) is recorded once it completes.
// Action names are derived from the route: POST /api/v1/stores -> "stores.create", PATCH .../status -> "requests.update".
const AUDIT_VERB: Record<string, string> = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };
const AUDIT_SKIP = new Set(['/api/v1/requests/quote', '/api/v1/cart/quote', '/api/v1/orders/quote']);
app.use((req, res, next) => {
  const verb = AUDIT_VERB[req.method];
  const path = req.originalUrl.split('?')[0];
  if (!verb || !path.startsWith('/api/v1/') || AUDIT_SKIP.has(path)) return next();
  res.on('finish', () => {
    const segments = path.replace('/api/v1/', '').split('/').filter(Boolean);
    const resource = segments[0] || 'unknown';
    const action =
      resource === 'auth' && segments[1] ? `auth.${segments[1].replace(/-/g, '_')}` : `${resource}.${verb}`;
    logger.audit(action, res.statusCode < 400 ? 'success' : 'failure', {
      'url.path': path,
      'http.request.method': req.method,
      'http.response.status_code': res.statusCode,
    });
  });
  next();
});

// 9. Rate limits
// Public catalogue reads (CMS, products, categories, stores, blog) are cheap and cached, and a single page view makes
// several of them; writes are what needs protecting. A single global 300/15 min bucket made normal browsing hit 429,
// and because server-side rendering calls come from the frontend server's address, every visitor's SSR shared one
// bucket. Specific endpoints (login, order requests, contact, quote) keep their own stricter limiters.
const isInternalRender = (req: express.Request): boolean => {
  // Next.js server-side fetches: direct socket from a private/loopback address with no forwarded client address
  const remote = req.socket.remoteAddress || '';
  const privateAddr = /^(::1|127\.|::ffff:127\.|10\.|::ffff:10\.|192\.168\.|::ffff:192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:172\.(1[6-9]|2\d|3[01])\.)/.test(remote);
  return privateAddr && !req.headers['x-forwarded-for'];
};
const isRead = (req: express.Request) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
const limitMessage = { success: false, message: 'Çok fazla istek gönderdiniz. Lütfen biraz sonra tekrar deneyiniz.' };

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600, // 600 reads / minute / client IP
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  skip: (req) => !isRead(req) || isInternalRender(req),
  message: limitMessage,
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300, // 300 writes / 15 minutes / client IP
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  skip: (req) => isRead(req),
  message: limitMessage,
});

app.use(readLimiter);
app.use(writeLimiter);

// 10. Parsers
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 200 }));

// 11. High-Performance Static Media (Block Private Uploads from static root)
app.use('/uploads/private', (_req, res) => {
  res.status(403).json({ success: false, message: 'Yetkisiz erişim: Özel dizin doğrudan sunulamaz.' });
});

app.use('/uploads', imageOptimizerMiddleware);
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  maxAge: '30d',
  immutable: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

// 12. Deep Enterprise Health & Readiness Checks
app.get('/health', async (req, res) => {
  const startTime = Date.now();
  let dbStatus = 'UNKNOWN';
  let dbLatencyMs = 0;

  // Test Database
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = 'HEALTHY';
  } catch (err) {
    dbStatus = 'DEGRADED';
  }

  const memoryUsage = process.memoryUsage();

  res.status(dbStatus === 'HEALTHY' ? 200 : 503).json({
    status: dbStatus === 'HEALTHY' ? 'OK' : 'DEGRADED',
    service: 'ErmayWeb REST API',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    components: {
      database: {
        provider: 'PostgreSQL (Prisma)',
        status: dbStatus,
        latencyMs: dbLatencyMs,
      },
      cache: {
        provider: 'In-Memory LRU',
        status: 'HEALTHY',
      },
      memory: {
        rssMb: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      },
    },
    requestId: req.headers['x-request-id'],
    totalCheckDurationMs: Date.now() - startTime,
  });
});

// 12. API Routes
app.use('/api/v1', routes);

// 13. 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'İstenen kaynak veya uç nokta bulunamadı.',
    requestId: req.headers['x-request-id'],
  });
});

// 14. Global Error Handler
// Client errors raised by body parsers / multer (invalid JSON, payload too large, file too large) keep their 4xx status;
// everything else is a 500 whose details stay in the log.
app.use((err: Error | unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = req.headers['x-request-id'];
  const e = err as { status?: number; statusCode?: number; type?: string; code?: string };
  const status = e?.status || e?.statusCode;
  const path = req.originalUrl.split('?')[0];
  if (e?.type === 'entity.too.large' || e?.code === 'LIMIT_FILE_SIZE') {
    logger.warn('Payload too large', { 'url.path': path, 'http.request.method': req.method });
    res.status(413).json({ success: false, message: 'Gönderilen veri izin verilen boyutu aşıyor.', requestId });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    logger.info('Malformed JSON body', { 'url.path': path, 'http.request.method': req.method });
    res.status(400).json({ success: false, message: 'İstek gövdesi geçerli JSON değil.', requestId });
    return;
  }
  if (status && status >= 400 && status < 500) {
    logger.info('Client error', { 'url.path': path, 'http.request.method': req.method, 'http.response.status_code': status });
    res.status(status).json({ success: false, message: 'İstek işlenemedi.', requestId });
    return;
  }
  logger.error('Unhandled error', { ...errorFields(err), 'url.path': path, 'http.request.method': req.method });
  res.status(500).json({ success: false, message: 'Sunucu tarafında beklenmeyen bir hata oluştu.', requestId });
});
