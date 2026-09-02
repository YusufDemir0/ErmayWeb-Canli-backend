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
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Yalnızca güvenli görsel (PNG, JPEG, WEBP) ve PDF belgeleri yüklenebilir.'));
    }
  },
});

/**
 * Validate Buffer Magic Bytes for Image & Document Security (Stored XSS / File Upload Bypass Prevention)
 */
function isValidFileBuffer(buffer: Buffer, ext: string): boolean {
  if (buffer.length < 4) return false;

  const headerHex = buffer.subarray(0, 8).toString('hex').toUpperCase();

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (ext === '.png' && headerHex.startsWith('89504E47')) return true;

  // JPEG: FF D8 FF
  if ((ext === '.jpg' || ext === '.jpeg') && headerHex.startsWith('FFD8FF')) return true;

  // WEBP: 52 49 46 46 (RIFF) ... 57 45 42 50 (WEBP)
  if (ext === '.webp' && headerHex.startsWith('52494646')) return true;

  // PDF: 25 50 44 46 (%PDF-)
  if (ext === '.pdf' && headerHex.startsWith('25504446')) return true;

  return false;
}

const router = Router();

// Upload Route with Authentication & Strict File Verification
router.post('/', authenticateToken, upload.single('file'), (req: Request, res: Response): void => {
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

    const isPrivate = req.query.isPrivate === '1' || req.query.isPrivate === 'true' || req.body.isPrivate === 'true' || cleanExt === '.pdf';
    const targetDir = isPrivate ? privateUploadsDir : publicUploadsDir;

    // High-entropy 256-bit cryptographically secure random filename
    const randomHash = crypto.randomBytes(24).toString('hex');
    const uniqueName = `${Date.now()}_${randomHash}${cleanExt}`;
    const destinationPath = path.join(targetDir, uniqueName);
    
    fs.writeFileSync(destinationPath, req.file.buffer);

    const fileUrl = isPrivate ? `/api/v1/upload/private/${uniqueName}` : `/uploads/${uniqueName}`;

    res.status(200).json({
      success: true,
      message: 'Dosya başarıyla doğrulandı ve yüklendi.',
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
