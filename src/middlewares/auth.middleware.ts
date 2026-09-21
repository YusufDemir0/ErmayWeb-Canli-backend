import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  let token: string | undefined;

  // 1. Try Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // 2. Try httpOnly Cookie fallback if header not present
  if (!token && req.headers.cookie) {
    const cookies = req.headers.cookie.split(';').reduce((acc: Record<string, string>, cur) => {
      const [k, v] = cur.trim().split('=');
      if (k && v) acc[k] = decodeURIComponent(v);
      return acc;
    }, {});
    token = cookies['auth_token'] || cookies['admin_jwt_token'];
  }

  if (!token) {
    res.status(401).json({ success: false, message: 'Yetkilendirme tokenı bulunamadı. Lütfen giriş yapınız.' });
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ success: false, message: 'Geçersiz veya süresi dolmuş token.' });
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

export function authenticateOptionalToken(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token && req.headers.cookie) {
    const cookies = req.headers.cookie.split(';').reduce((acc: Record<string, string>, cur) => {
      const [k, v] = cur.trim().split('=');
      if (k && v) acc[k] = decodeURIComponent(v);
      return acc;
    }, {});
    token = cookies['auth_token'] || cookies['admin_jwt_token'];
  }

  if (token) {
    try {
      req.user = verifyToken(token);
    } catch {
      // Non-blocking for optional auth
    }
  }
  next();
}
