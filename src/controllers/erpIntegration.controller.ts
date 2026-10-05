import { sendServerError } from '../utils/httpError';
import { ErpSaleWebhookSchema } from '../validations';
import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { erpIntegrationService } from '../services/erpIntegration.service';
import { runCatalogSync } from '../jobs/erpCatalogSync.job';
import { invalidateCachePattern } from '../utils/cache';
import { RequestStatus, PaymentChannel } from '@prisma/client';
import { logger, errorFields } from '../utils/logger';

export async function getErpCatalog(_req: Request, res: Response): Promise<void> {
  try {
    const catalog = await erpIntegrationService.getCombinedCatalog();
    res.status(200).json({
      success: true,
      count: catalog.length,
      catalog,
    });
  } catch (error: unknown) {
    sendServerError(res, error, 'ERP ürün kataloğu alınamadı.', 'ERP catalog fetch failed');
  }
}

export async function triggerManualCatalogSync(_req: Request, res: Response): Promise<void> {
  try {
    const report = await runCatalogSync();
    if (!report) {
      res.status(409).json({
        success: false,
        message: 'Katalog senkronizasyonu şu anda başka bir işlem tarafından yürütülüyor. Lütfen birkaç saniye sonra tekrar deneyin.',
      });
      return;
    }

    if (report.aborted) {
      res.status(502).json({
        success: false,
        message: `Katalog senkronizasyonu durduruldu, web kataloğunda değişiklik yapılmadı. ${report.abortReason || ''}`.trim(),
        report,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Katalog senkronizasyonu başarıyla tamamlandı.',
      report,
    });
  } catch (error: unknown) {
    sendServerError(res, error, 'Katalog senkronizasyonu başarısız oldu.', 'Manual catalog sync failed');
  }
}

export async function syncProduct(req: Request, res: Response): Promise<void> {
  try {
    const { erpItemId, isPublished, images, categoryId, name, description, dimensions, material } = req.body;

    if (!erpItemId) {
      res.status(400).json({ success: false, message: 'ERP ürün ID (erpItemId) zorunludur.' });
      return;
    }

    const savedProduct = await erpIntegrationService.syncProduct({
      erpItemId,
      isPublished: Boolean(isPublished),
      images: Array.isArray(images) ? images : [],
      categoryId,
      name,
      description,
      dimensions,
      material,
    });

    res.status(200).json({
      success: true,
      message: savedProduct.isPublished
        ? 'Ürün başarıyla web satışına açıldı ve görseller senkronize edildi.'
        : 'Ürün web satışına kapatıldı / güncellendi.',
      product: savedProduct,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Ürün senkronizasyonu başarısız oldu.';
    logger.error('ERP product sync failed', errorFields(error));
    res.status(400).json({
      success: false,
      message: errorMsg,
    });
  }
}

export async function handleErpSaleApprovedWebhook(req: Request, res: Response): Promise<void> {
  try {
    const providedKey = req.headers['x-integration-key'];
    const expectedKey = process.env.ERP_INTEGRATION_KEY;

    if (!expectedKey || !providedKey || typeof providedKey !== 'string') {
      res.status(401).json({ success: false, message: 'Geçersiz veya eksik entegrasyon anahtarı.' });
      return;
    }

    const providedBuf = Buffer.from(providedKey);
    const expectedBuf = Buffer.from(expectedKey);

    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      res.status(401).json({ success: false, message: 'Geçersiz entegrasyon anahtarı.' });
      return;
    }

    const parsed = ErpSaleWebhookSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Webhook gövdesi geçersiz.' });
      return;
    }
    const { saleCode, saleId, externalRef, status } = parsed.data;

    if (!saleCode && !saleId && !externalRef) {
      res.status(400).json({ success: false, message: 'saleCode, saleId veya externalRef eksik.' });
      return;
    }

    // S-17: Validate webhook status if provided
    if (status) {
      const normalizedStatus = String(status).toUpperCase();
      const approvedStatuses = ['APPROVED', 'PAID', 'COMPLETED', 'SUCCESS'];
      if (!approvedStatuses.includes(normalizedStatus)) {
        res.status(200).json({
          success: true,
          message: 'ERP webhook durumu onaylı durumlar arasında olmadığından talep durumu güncellenmedi.',
        });
        return;
      }
    }

    // Find the request in ErmayWeb database
    const orderRequest = await prisma.orderRequest.findFirst({
      where: {
        OR: [
          ...(externalRef ? [{ id: String(externalRef) }] : []),
          ...(saleCode ? [{ erpSaleCode: String(saleCode) }] : []),
          ...(saleId ? [{ erpSaleId: String(saleId) }] : []),
        ],
      },
      include: {
        items: true,
      },
    });

    if (orderRequest) {
      // Transition to PAID_OFFLINE if eligible
      const eligibleStatuses: RequestStatus[] = [
        RequestStatus.NEW,
        RequestStatus.CONTACTED,
        RequestStatus.STORE_VISIT_SCHEDULED,
        RequestStatus.AWAITING_PAYMENT,
      ];
      const canTransition = eligibleStatuses.includes(orderRequest.status);

      await prisma.$transaction(async (tx) => {
        if (canTransition) {
          await tx.orderRequest.update({
            where: { id: orderRequest.id },
            data: {
              status: RequestStatus.PAID_OFFLINE,
              paymentChannel: PaymentChannel.WHATSAPP_TRANSFER,
              erpSaleId: saleId ? String(saleId) : orderRequest.erpSaleId,
              erpSaleCode: saleCode ? String(saleCode) : orderRequest.erpSaleCode,
              erpSyncStatus: 'SYNCED',
            },
          });

          // V-14: Increment product salesCount
          for (const item of orderRequest.items) {
            if (item.productId) {
              await tx.product.update({
                where: { id: item.productId },
                data: { salesCount: { increment: item.quantity } },
              }).catch(() => {});
            }
          }
        }

        await tx.orderRequestEvent.create({
          data: {
            requestId: orderRequest.id,
            type: 'WEBHOOK',
            fromStatus: orderRequest.status,
            toStatus: canTransition ? RequestStatus.PAID_OFFLINE : orderRequest.status,
            note: `ERP satış onay webhook'u işlendi (SaleCode: ${saleCode || '-'}).`,
          },
        });
      });

      if (canTransition) {
        await invalidateCachePattern('products:*').catch(() => {});
      }
    }

    res.status(200).json({
      success: true,
      message: 'ERP Satış onayı başarıyla işlendi.',
    });
  } catch (error: unknown) {
    logger.error('ERP webhook processing failed', errorFields(error));
    res.status(500).json({ success: false, message: 'Webhook işlenirken hata oluştu.' });
  }
}
