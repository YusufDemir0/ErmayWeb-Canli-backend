import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';

const uploadsDir = path.join(__dirname, '../../uploads');
const cacheDir = path.join(uploadsDir, '.optimized');

if (!fs.existsSync(cacheDir)) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch (err) {
    console.warn('Cache directory could not be created:', err);
  }
}

/**
 * On-the-fly Image Optimization Middleware
 * Automatically converts multi-megabyte JPEG/PNG images into lightweight WebP (40-70KB)
 * and caches them on disk for sub-millisecond future responses.
 */
export async function imageOptimizerMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Only handle GET and HEAD requests
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  // If client explicitly requests raw original image
  if (req.query.raw === '1' || req.query.raw === 'true') {
    return next();
  }

  const cleanPath = req.path.replace(/^\//, '');
  const ext = path.extname(cleanPath).toLowerCase();

  // Only optimize JPEG, JPG, PNG, WEBP images
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    return next();
  }

  // Prevent path traversal
  const safeFileName = path.basename(cleanPath);
  const originalFilePath = path.join(uploadsDir, safeFileName);

  if (!fs.existsSync(originalFilePath)) {
    return next();
  }

  try {
    const widthParam = req.query.w ? parseInt(req.query.w as string, 10) : 1200;
    const targetWidth = Math.min(Math.max(widthParam || 1200, 100), 1920);
    const targetQuality = 75;

    // Fast ETag check based on original file size, mtime, and requested width
    const stat = fs.statSync(originalFilePath);
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}-w${targetWidth}"`;

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    const cacheKey = `${path.parse(safeFileName).name}_w${targetWidth}_q${targetQuality}.webp`;
    const cachedFilePath = path.join(cacheDir, cacheKey);

    // If already optimized and cached, serve from cache instantly
    if (fs.existsSync(cachedFilePath)) {
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      res.setHeader('ETag', etag);
      res.setHeader('X-Image-Optimized', 'cached');
      res.sendFile(cachedFilePath);
      return;
    }

    // Process original file with sharp
    const optimizedBuffer = await sharp(originalFilePath)
      .resize({
        width: targetWidth,
        withoutEnlargement: true,
        fit: 'inside',
      })
      .webp({ quality: targetQuality, effort: 4 })
      .toBuffer();

    // Asynchronously write to disk cache
    fs.writeFile(cachedFilePath, optimizedBuffer, (err) => {
      if (err) console.warn('[IMAGE OPTIMIZER CACHE WRITE ERROR]', err.message);
    });

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.setHeader('ETag', etag);
    res.setHeader('X-Image-Optimized', 'processed');
    res.send(optimizedBuffer);
  } catch (err: unknown) {
    console.warn('[IMAGE OPTIMIZER FALLBACK TO STATIC]', (err as Error).message);
    next();
  }
}
