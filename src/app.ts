import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import crypto from 'crypto';
import routes from './routes';
import { prisma } from './config/database';
import { imageOptimizerMiddleware } from './middlewares/imageOptimizer.middleware';

export const app = express();

// 1. Trust Proxy Configuration (Reverse Proxy + Next.js hop count)
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 2));

// 2. Disable Fingerprinting & Info Disclosure
app.disable('x-powered-by');

// 3. High-Performance Gzip / Deflate Compression
app.use(compression({
  threshold: 1024, // Compress responses larger than 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
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

// 7. Traceability: Request ID Middleware
app.use((req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string) || `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

// 8. Structured HTTP Request Logging with Request ID and Client IP
morgan.token('req-id', (req: express.Request) => (req.headers['x-request-id'] as string) || '-');
morgan.token('real-ip', (req: express.Request) => req.ip || req.socket.remoteAddress || '-');
app.use(morgan('[:date[iso]] [:req-id] [:real-ip] :method :url :status :response-time ms - :res[content-length]'));

// 9. Resilient Rate Limiter (No bypass header, trusted client IP)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300, // 300 requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Çok fazla istek gönderdiniz. Lütfen 15 dakika sonra tekrar deneyiniz.' },
});

app.use(limiter);

// 10. Parsers
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

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
    message: `İstenen kaynak veya uç nokta bulunamadı: [${req.method}] ${req.originalUrl}`,
    requestId: req.headers['x-request-id'],
  });
});

// 14. Global Error Handler
app.use((err: Error | unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const requestId = req.headers['x-request-id'];
  console.error(`[ERROR] [${requestId}] Unhandled System Error:`, err);
  const msg = err instanceof Error ? err.message : 'Sunucu tarafında beklenmeyen bir hata oluştu.';
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Sunucu tarafında beklenmeyen bir hata oluştu.' : msg,
    requestId,
  });
});
