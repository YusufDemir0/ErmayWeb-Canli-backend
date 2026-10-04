import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { prisma } from '../config/database';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { AdminRole } from '@prisma/client';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * POST /api/v1/auth/login or /api/v1/admin/auth/login
 * Admin & Staff Login. Sets secure httpOnly cookie 'ermay_admin'.
 */
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const rawIdentifier = String(req.body.email || req.body.username || '').toLowerCase().trim();
    const password = String(req.body.password || '').trim();

    if (!rawIdentifier || !password) {
      res.status(400).json({ success: false, message: 'Lütfen kullanıcı adı / e-posta ve şifrenizi giriniz.' });
      return;
    }

    const adminUser = await prisma.adminUser.findFirst({
      where: {
        OR: [
          { email: rawIdentifier },
          { email: `${rawIdentifier}@ermaymobilya.com` },
        ],
      },
    });

    if (!adminUser || !adminUser.isActive) {
      res.status(401).json({ success: false, message: 'Geçersiz e-posta veya şifre.' });
      return;
    }

    const isMatch = await comparePassword(password, adminUser.passwordHash);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Geçersiz e-posta veya şifre.' });
      return;
    }

    // Update lastLoginAt
    await prisma.adminUser.update({
      where: { id: adminUser.id },
      data: { lastLoginAt: new Date() },
    });

    const token = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });

    const isSecureCookie = req.secure || req.headers['x-forwarded-proto'] === 'https' || (isProduction && !req.headers.host?.includes('localhost') && !req.headers.host?.includes('127.0.0.1'));

    // Set secure cross-origin compatible HttpOnly Cookie
    res.cookie('ermay_admin', token, {
      httpOnly: true,
      secure: isSecureCookie,
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000, // 12 hours
      path: '/',
    });

    res.status(200).json({
      success: true,
      message: 'Giriş başarılı.',
      token,
      user: {
        id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Giriş yapılırken bir hata oluştu.';
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: msg });
  }
}

/**
 * POST /api/v1/auth/logout
 * Clears the auth cookie.
 */
export async function logout(_req: Request, res: Response): Promise<void> {
  res.clearCookie('ermay_admin', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  });
  res.clearCookie('auth_token', { path: '/' });
  res.status(200).json({ success: true, message: 'Başarıyla çıkış yapıldı.' });
}

/**
 * GET /api/v1/auth/profile or /api/v1/admin/auth/me
 * Retrieves current admin/staff profile.
 */
export async function getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Oturum açılmamış.' });
      return;
    }

    const adminUser = await prisma.adminUser.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (!adminUser || !adminUser.isActive) {
      res.status(404).json({ success: false, message: 'Kullanıcı hesabı bulunamadı veya pasif.' });
      return;
    }

    res.status(200).json({
      success: true,
      user: adminUser,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Profil yüklenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

/**
 * POST /api/v1/auth/change-password
 * Allows logged-in user to change their password.
 */
export async function changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Oturum açılmamış.' });
      return;
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword || newPassword.length < 8) {
      res.status(400).json({
        success: false,
        message: 'Yeni şifre en az 8 karakter olmalıdır.',
      });
      return;
    }

    const adminUser = await prisma.adminUser.findUnique({
      where: { id: req.user.userId },
    });

    if (!adminUser) {
      res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });
      return;
    }

    const isMatch = await comparePassword(currentPassword, adminUser.passwordHash);
    if (!isMatch) {
      res.status(400).json({ success: false, message: 'Mevcut şifreniz hatalı.' });
      return;
    }

    const hashedNew = await hashPassword(newPassword);
    await prisma.adminUser.update({
      where: { id: adminUser.id },
      data: { passwordHash: hashedNew },
    });

    res.status(200).json({ success: true, message: 'Şifreniz başarıyla güncellendi.' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Şifre güncellenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

// -------------------------------------------------------------------------------------
// FAZ 1: Kapatılan Müşteri Uçları (Geriye Dönük Uyumluluk için 404/410 Dönüşleri)
// -------------------------------------------------------------------------------------
export async function register(_req: Request, res: Response): Promise<void> {
  res.status(410).json({
    success: false,
    message: 'Müşteri kayıt sistemi KVKK veri minimizasyonu gereği kapatılmıştır. Siparişler talep formuyla alınmaktadır.',
  });
}

export async function getAddresses(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ success: true, addresses: [] });
}

export async function addAddress(_req: Request, res: Response): Promise<void> {
  res.status(410).json({ success: false, message: 'Kayıtlı adres özelliği kaldırılmıştır.' });
}

export async function updateAddress(_req: Request, res: Response): Promise<void> {
  res.status(410).json({ success: false, message: 'Kayıtlı adres özelliği kaldırılmıştır.' });
}

export async function deleteAddress(_req: Request, res: Response): Promise<void> {
  res.status(410).json({ success: false, message: 'Kayıtlı adres özelliği kaldırılmıştır.' });
}

export async function getCards(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ success: true, cards: [] });
}

export async function addCard(_req: Request, res: Response): Promise<void> {
  res.status(410).json({ success: false, message: 'Kart saklama özelliği kaldırılmıştır.' });
}

export async function deleteCard(_req: Request, res: Response): Promise<void> {
  res.status(410).json({ success: false, message: 'Kart saklama özelliği kaldırılmıştır.' });
}
