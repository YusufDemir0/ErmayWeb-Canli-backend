import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authenticateToken } from '../middlewares/auth.middleware';

const publicUploadsDir = path.join(__dirname, '../../uploads');
const privateUploadsDir = path.join(__dirname, '../../uploads/private');

if (!fs.existsSync(publicUploadsDir)) {
  fs.mkdirSync(publicUploadsDir, { recursive: true });
}
if (!fs.existsSync(privateUploadsDir)) {
  fs.mkdirSync(privateUploadsDir, { recursive: true });
}

// Memory storage to inspect buffer magic bytes before writing to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB strict limit
  fileFilter: (_req, file, cb) => {
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Yalnızca güvenli görsel (PNG, JPEG, WEBP) formatları yüklenebilir.'));
    }
  },
});

/**
 * Validate Buffer Magic Bytes for Image Security (Stored XSS / File Upload Bypass Prevention)
 */
function isValidFileBuffer(buffer: Buffer, ext: string): boolean {
  if (buffer.length < 12) return false;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (ext === '.png') {
    const pngMagic = buffer.subarray(0, 8).toString('hex').toUpperCase();
    return pngMagic === '89504E470D0A1A0A';
  }

  // JPEG: FF D8 FF
  if (ext === '.jpg' || ext === '.jpeg') {
    const jpgMagic = buffer.subarray(0, 3).toString('hex').toUpperCase();
    return jpgMagic === 'FFD8FF';
  }

  // WEBP: Bytes 0-3 = "RIFF", Bytes 8-11 = "WEBP"
  if (ext === '.webp') {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    return riff === 'RIFF' && webp === 'WEBP';
  }

  return false;
}

import sharp from 'sharp';

const router = Router();

// Upload Route with Authentication, Magic Byte Verification, WebP Optimization & SHA-256 Deduplication
router.post('/', authenticateToken, upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ success: false, message: 'Lütfen geçerli bir dosya seçin.' });
      return;
    }

    const rawExt = path.extname(req.file.originalname).toLowerCase();
    const cleanExt = rawExt.replace(/[^a-z0-9.]/g, '');

    // Perform Magic Byte inspection
    if (!isValidFileBuffer(req.file.buffer, cleanExt)) {
      res.status(400).json({
        success: false,
        message: 'Güvenlik İhlali: Dosya içeriği geçerli bir görsel imzası taşımıyor veya bozuk/zararlı içerik barındırıyor.',
      });
      return;
    }

    const isPrivate = req.query.isPrivate === '1' || req.query.isPrivate === 'true' || req.body.isPrivate === 'true';
    const targetDir = isPrivate ? privateUploadsDir : publicUploadsDir;

    // Cryptographic SHA-256 hash for deduplication and unique collision-free naming
    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex').substring(0, 32);
    const isImage = ['.jpg', '.jpeg', '.png', '.webp'].includes(cleanExt);

    let finalFileName = `${Date.now()}_${fileHash}${cleanExt}`;

    if (isImage && !isPrivate) {
      // Automatic upload-time WebP optimization & instant deduplication
      finalFileName = `${fileHash}.webp`;
      const destinationPath = path.join(targetDir, finalFileName);

      if (fs.existsSync(destinationPath)) {
        res.status(200).json({
          success: true,
          message: 'Görsel mevcut arşivden başarıyla eşleştirildi (Deduplicated).',
          url: `/uploads/${finalFileName}`,
          isPrivate: false,
          deduplicated: true,
        });
        return;
      }

      await sharp(req.file.buffer, { limitInputPixels: 25000000 })
        .rotate()
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toFile(destinationPath);
    } else {
      const destinationPath = path.join(targetDir, finalFileName);
      fs.writeFileSync(destinationPath, req.file.buffer);
    }

    const fileUrl = isPrivate ? `/api/v1/upload/private/${finalFileName}` : `/uploads/${finalFileName}`;

    res.status(200).json({
      success: true,
      message: 'Dosya başarıyla doğrulandı ve optimize edilerek yüklendi.',
      url: fileUrl,
      isPrivate,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Dosya yükleme başarısız.';
    res.status(500).json({ success: false, message: msg });
  }
});

// Authenticated Private File Retrieval (KVKK & Financial Document Protection)
router.get('/private/:fileName', authenticateToken, (req: Request, res: Response): void => {
  try {
    const rawParam = req.params.fileName;
    const fileName = path.basename(Array.isArray(rawParam) ? rawParam[0] : (rawParam || '')); // Prevent path traversal
    const filePath = path.join(privateUploadsDir, fileName);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, message: 'İstenen özel belge bulunamadı.' });
      return;
    }

    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Belge okunurken bir hata oluştu.' });
  }
});

export default router;
