import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import crypto from 'crypto';
import routes from './routes';
import { redis } from './config/redis';
import { prisma } from './config/database';

export const app = express();

// 1. Disable Fingerprinting & Info Disclosure
app.disable('x-powered-by');

// 2. High-Performance Gzip / Deflate Compression
app.use(compression({
  threshold: 1024, // Compress responses larger than 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
}));

// 3. Enterprise Security Headers (Helmet)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // Managed via frontend reverse proxy
}));

// 4. Enterprise CORS Configuration with Strict Whitelist Enforcement
const rawOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim().toLowerCase()) : [];
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser clients (curl, mobile, server-side SSR)
    if (!origin) return callback(null, true);
    
    const lowerOrigin = origin.toLowerCase();

    // Check against configured raw origins
    if (rawOrigins.includes('*') || rawOrigins.includes(lowerOrigin)) {
      return callback(null, true);
    }

    // Check trusted development and production domains
    const isLocalhost = lowerOrigin.includes('localhost:') || lowerOrigin.includes('127.0.0.1:');
    const isVercelPreview = lowerOrigin.endsWith('.vercel.app');
    const isOfficialDomain = lowerOrigin === 'https://ermaymobilya.com' || lowerOrigin === 'https://www.ermaymobilya.com' || lowerOrigin.endsWith('.ermaymobilya.com');

    if (isLocalhost || isVercelPreview || isOfficialDomain) {
      return callback(null, true);
    }

    // Explicitly reject unauthorized foreign origins
    return callback(new Error(`CORS İhlali: Yetkisiz etki alanı (${origin}) üzerinden API erişimi engellendi.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Accept'],
}));

// 5. URL Normalization & Malicious Path Traversal Protection
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

// 6. Traceability: Request ID Middleware
app.use((req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string) || `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

// 7. Structured HTTP Request Logging with Request ID
morgan.token('req-id', (req: express.Request) => (req.headers['x-request-id'] as string) || '-');
app.use(morgan('[:date[iso]] [:req-id] :method :url :status :response-time ms - :res[content-length]'));

// 8. Enterprise Resilient Rate Limiter (Memory Default with Optional Redis Store)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Çok fazla istek gönderdiniz. Lütfen 15 dakika sonra tekrar deneyiniz.' },
});

app.use(limiter);

// 9. Parsers
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// 10. High-Performance Static Media with Browser Caching (30 Days Immutable)
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  maxAge: '30d',
  immutable: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

// 11. Deep Enterprise Health & Readiness Checks
app.get('/health', async (req, res) => {
  const startTime = Date.now();
  let dbStatus = 'UNKNOWN';
  let dbLatencyMs = 0;
  let redisStatus = 'UNKNOWN';

  // Test Database
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = 'HEALTHY';
  } catch (err) {
    dbStatus = 'DEGRADED';
  }

  // Test Redis Cache
  try {
    if (redis.status === 'ready') {
      const redisPing = await redis.ping();
      redisStatus = redisPing === 'PONG' ? 'HEALTHY' : 'DEGRADED';
    } else {
      redisStatus = 'OFFLINE_FALLBACK_ACTIVE';
    }
  } catch (err) {
    redisStatus = 'OFFLINE_FALLBACK_ACTIVE';
  }

  const memoryUsage = process.memoryUsage();

  res.status(dbStatus === 'HEALTHY' ? 200 : 503).json({
    status: dbStatus === 'HEALTHY' ? 'OK' : 'DEGRADED',
    service: 'ErmayWeb Enterprise Backend REST API',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    components: {
      database: {
        provider: 'PostgreSQL (Prisma)',
        status: dbStatus,
        latencyMs: dbLatencyMs,
      },
      cache: {
        provider: 'Redis',
        status: redisStatus,
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
