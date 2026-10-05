import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { telegramService } from '../services/telegram.service';
import { getOrSetCache, delCache } from '../utils/cache';
import { logger, errorFields } from '../utils/logger';

const CMS_ALL_CACHE_KEY = 'cms:all';
const CMS_CACHE_TTL = 3600; // 1 hour

const KEY_ALIASES: Record<string, string> = {
  contact_info: 'contact',
  ticker_items: 'ticker',
  campaign_popup: 'popup',
};

const REVERSE_ALIASES: Record<string, string> = {
  contact: 'contact_info',
  ticker: 'ticker_items',
  popup: 'campaign_popup',
};

export async function getCmsBlock(req: Request, res: Response): Promise<void> {
  try {
    const rawKey = req.params.key as string;
    const canonicalKey = KEY_ALIASES[rawKey] || rawKey;

    const block = await getOrSetCache(`cms:block:${canonicalKey}`, CMS_CACHE_TTL, async () => {
      const found = await prisma.cmsBlock.findUnique({ where: { key: canonicalKey } });
      if (found) return found;
      return prisma.cmsBlock.findUnique({ where: { key: rawKey } });
    });

    if (!block) {
      res.status(404).json({ success: false, message: `"${rawKey}" anahtarlı CMS bloğu bulunamadı.` });
      return;
    }

    res.status(200).json({ success: true, key: block.key, content: block.content });
  } catch (error: unknown) {
    logger.error('CMS block read failed', errorFields(error));
    const msg = error instanceof Error ? error.message : 'CMS verisi alınamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function getAllCmsBlocks(req: Request, res: Response): Promise<void> {
  try {
    const result = await getOrSetCache(CMS_ALL_CACHE_KEY, CMS_CACHE_TTL, async () => {
      const blocks = await prisma.cmsBlock.findMany();
      const map: Record<string, unknown> = {};
      for (const b of blocks) {
        map[b.key] = b.content;
        const alt = REVERSE_ALIASES[b.key] || KEY_ALIASES[b.key];
        if (alt && !map[alt]) {
          map[alt] = b.content;
        }
      }
      return map;
    });

    res.status(200).json({ success: true, cms: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Tüm CMS içerikleri alınamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function updateCmsBlock(req: Request, res: Response): Promise<void> {
  try {
    const rawKey = req.params.key as string;
    const canonicalKey = KEY_ALIASES[rawKey] || rawKey;
    const { content } = req.body;

    if (!content) {
      res.status(400).json({ success: false, message: 'CMS içerik verisi boş olamaz.' });
      return;
    }

    const updatedBlock = await prisma.cmsBlock.upsert({
      where: { key: canonicalKey },
      update: { content },
      create: { key: canonicalKey, content },
    });

    // Mirror to reverse alias for total client backward compatibility
    const altKey = REVERSE_ALIASES[canonicalKey] || KEY_ALIASES[canonicalKey];
    if (altKey && altKey !== canonicalKey) {
      await prisma.cmsBlock.upsert({
        where: { key: altKey },
        update: { content },
        create: { key: altKey, content },
      }).catch(() => {});
    }

    // Invalidate Redis caches
    await Promise.all([
      delCache(CMS_ALL_CACHE_KEY),
      delCache(`cms:block:${canonicalKey}`),
      delCache(`cms:block:${rawKey}`),
    ]).catch(() => {});

    res.status(200).json({
      success: true,
      message: `"${canonicalKey}" CMS bloğu başarıyla güncellendi.`,
      block: updatedBlock,
    });
  } catch (error: unknown) {
    logger.error('CMS block update failed', errorFields(error));
    const msg = error instanceof Error ? error.message : 'CMS bloğu güncellenemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function testTelegramConnection(req: Request, res: Response): Promise<void> {
  try {
    const { botToken, chatId } = req.body;
    const result = await telegramService.sendTestMessage(botToken, chatId);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Telegram test işlemi başarısız.';
    res.status(500).json({ success: false, message: msg });
  }
}

