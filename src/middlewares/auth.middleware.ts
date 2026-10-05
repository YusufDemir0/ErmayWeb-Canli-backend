import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt';
import { prisma } from '../config/database';
import { requestContext } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const rawVal = trimmed.slice(eqIdx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawVal);
    } catch {
      cookies[key] = rawVal;
    }
  }
  return cookies;
}

export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  let token: string | undefined;

  // 1. Try Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // 2. Try httpOnly Cookie fallback if header not present
  if (!token && req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies['ermay_admin'] || cookies['admin_jwt_token'] || cookies['auth_token'];
  }

  if (!token) {
    res.status(401).json({ success: false, message: 'Yetkilendirme tokenı bulunamadı. Lütfen giriş yapınız.' });
    return;
  }

  try {
    const decoded = verifyToken(token);

    // S-06: Database verification for token revocation and user active state
    const adminUser = await prisma.adminUser.findUnique({
      where: { id: decoded.userId },
      select: { id: true, isActive: true, role: true },
    });

    if (!adminUser || !adminUser.isActive) {
      res.status(401).json({ success: false, message: 'Kullanıcı hesabı aktif değil veya bulunamadı.' });
      return;
    }

    req.user = {
      ...decoded,
      role: adminUser.role,
    };
    // Log bağlamına kullanıcı kimliği (kişisel veri değil, UUID) ve rolü eklenir
    const ctx = requestContext.getStore();
    if (ctx) {
      ctx.userId = String(decoded.userId);
      ctx.userRole = adminUser.role;
    }
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Geçersiz veya süresi dolmuş token. Lütfen tekrar giriş yapınız.' });
  }
}

export function authorizeRoles(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: 'Bu işleme erişim yetkiniz bulunmamaktadır.' });
      return;
    }
    next();
  };
}

export async function authenticateOptionalToken(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token && req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies['ermay_admin'] || cookies['admin_jwt_token'] || cookies['auth_token'];
  }

  if (token) {
    try {
      const decoded = verifyToken(token);
      // Pasif / silinmiş kullanıcının tokenı yetki kazandırmasın (rol DB'den okunur)
      const adminUser = await prisma.adminUser.findUnique({
        where: { id: decoded.userId },
        select: { isActive: true, role: true },
      });
      if (adminUser?.isActive) {
        req.user = { ...decoded, role: adminUser.role };
      }
    } catch {
      // Non-blocking for optional auth
    }
  }
  next();
}
