import { Request, Response } from 'express';
import { prisma } from '../config/database';

export async function getCmsBlock(req: Request, res: Response): Promise<void> {
  try {
    const key = req.params.key as string;

    const block = await prisma.cmsBlock.findUnique({
      where: { key },
    });

    if (!block) {
      res.status(404).json({ success: false, message: `"${key}" anahtarlı CMS bloğu bulunamadı.` });
      return;
    }

    res.status(200).json({ success: true, key: block.key, content: block.content });
  } catch (error: unknown) {
    console.error('CMS Get Block Error:', error);
    const msg = error instanceof Error ? error.message : 'CMS verisi alınamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function getAllCmsBlocks(req: Request, res: Response): Promise<void> {
  try {
    const blocks = await prisma.cmsBlock.findMany();
    const result: Record<string, unknown> = {};
    for (const b of blocks) {
      result[b.key] = b.content;
    }
    res.status(200).json({ success: true, cms: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Tüm CMS içerikleri alınamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function updateCmsBlock(req: Request, res: Response): Promise<void> {
  try {
    const key = req.params.key as string;
    const { content } = req.body;

    if (!content) {
      res.status(400).json({ success: false, message: 'CMS içerik verisi boş olamaz.' });
      return;
    }

    const updatedBlock = await prisma.cmsBlock.upsert({
      where: { key },
      update: { content },
      create: { key, content },
    });

    res.status(200).json({
      success: true,
      message: `"${key}" CMS bloğu başarıyla güncellendi.`,
      block: updatedBlock,
    });
  } catch (error: unknown) {
    console.error('CMS Update Error:', error);
    const msg = error instanceof Error ? error.message : 'CMS bloğu güncellenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}
