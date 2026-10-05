import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { slugifyTurkish } from '../utils/slug';
import crypto from 'crypto';

/**
 * GET /api/v1/blogs
 * Blog yazılarını listeler (Arama, kategori ve sayfalama destekli)
 */
export async function getBlogPosts(req: Request, res: Response): Promise<void> {
  try {
    const { category, search, page = '1', limit = '12', all } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 12));
    const skip = (pageNum - 1) * limitNum;

    const userRole = (req as { user?: { role?: string } }).user?.role;
    const isAdmin = userRole === 'ADMIN';

    const where: any = {};
    if (!isAdmin || all !== 'true') {
      where.isPublished = true;
    }

    if (category && category !== 'all') {
      where.category = String(category);
    }

    if (search) {
      const q = String(search).trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [posts, total] = await Promise.all([
      prisma.blogPost.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.blogPost.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      posts,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      pagination: {
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        limit: limitNum,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Blog yazıları getirilemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

/**
 * GET /api/v1/blogs/:slug
 * Tekil blog yazısını getirir
 */
export async function getBlogPostBySlug(req: Request, res: Response): Promise<void> {
  try {
    const slug = req.params.slug as string;

    const post = await prisma.blogPost.findUnique({
      where: { slug },
    });

    const userRole = (req as { user?: { role?: string } }).user?.role;
    const isAdmin = userRole === 'ADMIN';

    if (!post || (!post.isPublished && !isAdmin)) {
      res.status(404).json({ success: false, message: 'Blog yazısı bulunamadı.' });
      return;
    }

    res.status(200).json({ success: true, post });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Blog detayı alınamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}

/**
 * POST /api/v1/blogs (Admin)
 * Yeni blog yazısı oluşturur
 */
export async function createBlogPost(req: Request, res: Response): Promise<void> {
  try {
    const { title, summary, content, coverImage, category, tags, author, isPublished } = req.body;

    if (!title || !content) {
      res.status(400).json({ success: false, message: 'Başlık ve içerik zorunludur.' });
      return;
    }

    let slug = slugifyTurkish(title);
    const existingSlug = await prisma.blogPost.findUnique({ where: { slug } });
    if (existingSlug) {
      slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
    }

    // Basit okuma süresi hesabı (~200 kelime / dakika)
    const wordCount = content.trim().split(/\s+/).length;
    const readTimeMin = Math.max(1, Math.ceil(wordCount / 200));

    const post = await prisma.blogPost.create({
      data: {
        id: crypto.randomUUID(),
        title,
        slug,
        summary: summary || null,
        content,
        coverImage: coverImage || null,
        category: category || 'Dekorasyon & Tasarım',
        tags: Array.isArray(tags) ? tags : [],
        author: author || 'Ermay Mobilya',
        readTimeMin,
        isPublished: isPublished !== undefined ? Boolean(isPublished) : true,
        publishedAt: new Date(),
      },
    });

    res.status(201).json({ success: true, message: 'Blog yazısı başarıyla oluşturuldu.', post });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Blog yazısı eklenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

/**
 * PUT /api/v1/blogs/:id (Admin)
 * Blog yazısını günceller
 */
export async function updateBlogPost(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { title, summary, content, coverImage, category, tags, author, isPublished } = req.body;

    const existing = await prisma.blogPost.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Güncellenecek blog yazısı bulunamadı.' });
      return;
    }

    const data: any = {};
    if (title) {
      data.title = title;
      if (title !== existing.title) {
        data.slug = slugifyTurkish(title);
      }
    }
    if (summary !== undefined) data.summary = summary;
    if (content) {
      data.content = content;
      const wordCount = content.trim().split(/\s+/).length;
      data.readTimeMin = Math.max(1, Math.ceil(wordCount / 200));
    }
    if (coverImage !== undefined) data.coverImage = coverImage;
    if (category !== undefined) data.category = category;
    if (tags !== undefined) data.tags = Array.isArray(tags) ? tags : [];
    if (author !== undefined) data.author = author;
    if (isPublished !== undefined) data.isPublished = Boolean(isPublished);

    const updated = await prisma.blogPost.update({
      where: { id },
      data,
    });

    res.status(200).json({ success: true, message: 'Blog yazısı güncellendi.', post: updated });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Blog yazısı güncellenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

/**
 * DELETE /api/v1/blogs/:id (Admin)
 * Blog yazısını siler
 */
export async function deleteBlogPost(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;

    const existing = await prisma.blogPost.findUnique({ where: { id } });
    if (!existing) {
      res.status(200).json({ success: true, message: 'Blog yazısı zaten silinmiş veya bulunamadı.' });
      return;
    }

    await prisma.blogPost.delete({ where: { id } });

    res.status(200).json({ success: true, message: 'Blog yazısı başarıyla silindi.' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Blog yazısı silinemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}
