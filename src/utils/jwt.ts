import jwt from 'jsonwebtoken';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('FATAL: JWT_SECRET ortam değişkeni tanımlanmamıştır! Sunucu güvenlik sebebiyle durduruluyor.');
      process.exit(1);
    }
    return 'ermayweb_dev_only_secret_key_2026';
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
