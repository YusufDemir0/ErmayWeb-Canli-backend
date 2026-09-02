import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { prisma } from '../config/database';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { Role } from '@prisma/client';

const isProduction = process.env.NODE_ENV === 'production';

export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password || !phone) {
      res.status(400).json({ success: false, message: 'Lütfen tüm zorunlu alanları doldurunuz.' });
      return;
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      res.status(409).json({ success: false, message: 'Bu e-posta adresi ile kayıtlı bir hesap zaten mevcuttur.' });
      return;
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        phone,
        password: hashedPassword,
        role: Role.CUSTOMER,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        addresses: true,
      },
    });

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Set secure cross-origin compatible Cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(201).json({
      success: true,
      message: 'Hesabınız başarıyla oluşturuldu.',
      token,
      user,
    });
  } catch (error) {
    console.error('Kayıt Hatası:', error);
    res.status(500).json({ success: false, message: 'Sunucu tarafında bir hata oluştu.' });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, message: 'E-posta ve şifre zorunludur.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        addresses: true,
      },
    });

    if (!user) {
      res.status(401).json({ success: false, message: 'E-posta veya şifre hatalı.' });
      return;
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'E-posta veya şifre hatalı.' });
      return;
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Set secure cross-origin compatible Cookie
    const cookieName = user.role === 'ADMIN' ? 'admin_jwt_token' : 'auth_token';
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      success: true,
      message: 'Giriş başarılı.',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        addresses: user.addresses || [],
      },
    });
  } catch (error) {
    console.error('Giriş Hatası:', error);
    res.status(500).json({ success: false, message: 'Sunucu tarafında bir hata oluştu.' });
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  res.clearCookie('auth_token', { sameSite: isProduction ? 'none' : 'lax', secure: isProduction });
  res.clearCookie('admin_jwt_token', { sameSite: isProduction ? 'none' : 'lax', secure: isProduction });
  res.status(200).json({ success: true, message: 'Çıkış yapıldı.' });
}

export async function getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Yetkisiz erişim.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        addresses: true,
        cards: true,
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });
      return;
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Profil bilgileri alınamadı.' });
  }
}

export async function changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { currentPassword, newPassword } = req.body;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Yetkisiz erişim.' });
      return;
    }

    if (!currentPassword) {
      res.status(400).json({ success: false, message: 'Mevcut şifrenizi girmelisiniz.' });
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ success: false, message: 'Yeni şifreniz en az 6 karakter olmalıdır.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });
      return;
    }

    const isMatch = await comparePassword(currentPassword, user.password);
    if (!isMatch) {
      res.status(400).json({ success: false, message: 'Mevcut şifreniz hatalıdır.' });
      return;
    }

    const hashedPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    res.status(200).json({ success: true, message: 'Şifreniz başarıyla güncellendi.' });
  } catch (error) {
    console.error('Şifre Değiştirme Hatası:', error);
    res.status(500).json({ success: false, message: 'Şifre güncellenirken bir hata oluştu.' });
  }
}

/**
 * Kullanıcı Adreslerini Listeleme
 */
export async function getAddresses(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Yetkisiz erişim.' });
      return;
    }

    const addresses = await prisma.userAddress.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ success: true, addresses });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Adresler getirilemedi.' });
  }
}

/**
 * Yeni Kullanıcı Adresi Ekleme (PostgreSQL Prisma Kaydı)
 */
export async function addAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Yetkisiz erişim.' });
      return;
    }

    const { title, fullName, phone, city, district, addressLine, zipCode } = req.body;

    if (!title || !fullName || !phone || !city || !district || !addressLine) {
      res.status(400).json({ success: false, message: 'Lütfen tüm zorunlu adres alanlarını doldurunuz.' });
      return;
    }

    const address = await prisma.userAddress.create({
      data: {
        userId,
        title,
        fullName,
        phone,
        city,
        district,
        addressLine,
        zipCode: zipCode || '34000',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Adres başarıyla kaydedildi.',
      address,
    });
  } catch (error) {
    console.error('Adres Ekleme Hatası:', error);
    res.status(500).json({ success: false, message: 'Adres kaydedilemedi.' });
  }
}

/**
 * Kullanıcı Adresi Güncelleme
 */
export async function updateAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const id = req.params.id as string;
    if (!userId || !id) {
      res.status(401).json({ success: false, message: 'Yetkisiz erişim.' });
      return;
    }

    const existing = await prisma.userAddress.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Güncellenecek adres bulunamadı.' });
      return;
    }

    const { title, fullName, phone, city, district, addressLine, zipCode } = req.body;

    const updated = await prisma.userAddress.update({
      where: { id },
      data: {
        title: title || existing.title,
        fullName: fullName || existing.fullName,
        phone: phone || existing.phone,
        city: city || existing.city,
        district: district || existing.district,
        addressLine: addressLine || existing.addressLine,
        zipCode: zipCode || existing.zipCode,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Adres başarıyla güncellendi.',
      address: updated,
    });
  } catch (error) {
    console.error('Adres Güncelleme Hatası:', error);
    res.status(500).json({ success: false, message: 'Adres güncellenemedi.' });
  }
}

/**
 * Kullanıcı Adresi Silme
 */
export async function deleteAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const id = req.params.id as string;
    if (!userId || !id) {
      res.status(401).json({ success: false, message: 'Yetkisiz erişim.' });
      return;
    }

    const existing = await prisma.userAddress.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Silinecek adres bulunamadı.' });
      return;
    }

    // Geçmiş siparişlerde kullanılmış mı kontrol et
    const hasOrders = await prisma.order.findFirst({
      where: { shippingAddressId: id },
    });

    if (hasOrders) {
      res.status(400).json({
        success: false,
        message: 'Geçmiş siparişlerinizde kullanılan adresler yasal fatura kaydı nedeniyle silinemez. Dilerseniz yeni bir adres ekleyebilirsiniz.',
      });
      return;
    }

    await prisma.userAddress.delete({
      where: { id },
    });

    res.status(200).json({ success: true, message: 'Adres başarıyla silindi.' });
  } catch (error) {
    console.error('Adres Silme Hatası:', error);
    res.status(500).json({ success: false, message: 'Adres silinemedi.' });
  }
}

/**
 * Kullanıcı Kayıtlı Kartlarını Listeleme
 */
export async function getCards(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Yetkisiz erişim.' });
      return;
    }

    const cards = await prisma.userCard.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ success: true, cards });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Kayıtlı kartlar getirilemedi.' });
  }
}

/**
 * Yeni Kart Kaydetme (Maskelenmiş Güvenli Token Kaydı)
 */
export async function addCard(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Yetkisiz erişim.' });
      return;
    }

    const { cardTitle, cardHolder, cardNumber, cardNumberMasked, expiry, cardType } = req.body;

    if (!cardHolder || !expiry) {
      res.status(400).json({ success: false, message: 'Kart bilgileri eksik veya geçersiz.' });
      return;
    }

    // Mask card number if raw card number was provided
    let masked = cardNumberMasked;
    if (!masked && cardNumber) {
      const cleanNum = cardNumber.replace(/\s+/g, '');
      const first4 = cleanNum.slice(0, 4);
      const last4 = cleanNum.slice(-4);
      masked = `${first4} •••• •••• ${last4}`;
    }

    const card = await prisma.userCard.create({
      data: {
        userId,
        cardTitle: cardTitle || 'Kayıtlı Kartım',
        cardHolder: cardHolder.toUpperCase(),
        cardNumberMasked: masked || '•••• •••• •••• ••••',
        expiry,
        cardType: cardType || 'generic',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Kartınız güvenle profilinize kaydedildi.',
      card,
    });
  } catch (error) {
    console.error('Kart Kaydetme Hatası:', error);
    res.status(500).json({ success: false, message: 'Kart kaydedilemedi.' });
  }
}

/**
 * Kayıtlı Kart Silme
 */
export async function deleteCard(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const id = req.params.id as string;
    if (!userId || !id) {
      res.status(401).json({ success: false, message: 'Yetkisiz erişim.' });
      return;
    }

    const existing = await prisma.userCard.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Silinecek kart bulunamadı.' });
      return;
    }

    await prisma.userCard.delete({
      where: { id },
    });

    res.status(200).json({ success: true, message: 'Kart başarıyla silindi.' });
  } catch (error) {
    console.error('Kart Silme Hatası:', error);
    res.status(500).json({ success: false, message: 'Kart silinemedi.' });
  }
}


