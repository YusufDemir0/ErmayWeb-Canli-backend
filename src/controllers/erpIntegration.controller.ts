import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { erpIntegrationService } from '../services/erpIntegration.service';
import { emailService } from '../services/email.service';
import { OrderStatus, PaymentStatus } from '@prisma/client';

export async function getErpCatalog(_req: Request, res: Response): Promise<void> {
  try {
    const catalog = await erpIntegrationService.getCombinedCatalog();
    res.status(200).json({
      success: true,
      count: catalog.length,
      catalog,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'ERP ürün kataloğu alınamadı.';
    console.error('ERP Catalog Error:', error);
    res.status(500).json({
      success: false,
      message: errorMsg,
    });
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
    console.error('ERP Sync Error:', error);
    res.status(400).json({
      success: false,
      message: errorMsg,
    });
  }
}

export async function handleErpSaleApprovedWebhook(req: Request, res: Response): Promise<void> {
  try {
    const providedKey = req.headers['x-integration-key'];
    const expectedKey = process.env.ERP_INTEGRATION_KEY || 'ermay_web_erp_secure_key_2026';

    if (!providedKey || providedKey !== expectedKey) {
      res.status(401).json({ success: false, message: 'Geçersiz entegrasyon anahtarı.' });
      return;
    }

    const { saleCode, saleId, customerEmail } = req.body;

    if (!saleCode && !saleId) {
      res.status(400).json({ success: false, message: 'saleCode veya saleId eksik.' });
      return;
    }

    // Find the order in ErmayWeb database
    const order = await prisma.order.findFirst({
      where: {
        OR: [
          { orderNumber: saleCode },
          { erpSaleCode: saleCode },
          { erpSaleId: String(saleId) },
        ],
      },
      include: {
        items: {
          include: {
            product: true,
            variant: true,
          },
        },
      },
    });

    if (order) {
      // Update order to confirmed status
      await prisma.order.update({
        where: { id: order.id },
        data: {
          orderStatus: OrderStatus.PAYMENT_CONFIRMED,
          paymentStatus: PaymentStatus.PAID,
        },
      });

      // Send branded order & payment approved confirmation email
      const emailToSend = customerEmail || order.customerEmail;
      if (emailToSend) {
        try {
          await emailService.sendOrderApprovedEmail({
            orderNumber: order.orderNumber,
            customerName: order.customerName || 'Değerli Müşterimiz',
            customerEmail: emailToSend,
            customerPhone: order.customerPhone || '',
            totalAmount: Number(order.totalAmount),
            taxAmount: Number(order.taxAmount),
            discountAmount: Number(order.discountAmount),
            paymentMethod: order.paymentMethod,
            shippingAddress: {
              fullName: order.customerName || '',
              phone: order.customerPhone || '',
              city: order.shippingCity || '',
              district: order.shippingDistrict || '',
              addressLine: order.shippingAddressLine || '',
            },
            items: order.items.map((it) => ({
              name: it.product?.name || 'Mobilya',
              quantity: it.quantity,
              unitPrice: Number(it.unitPrice),
              totalPrice: Number(it.totalPrice),
              variant: it.variant?.color || undefined,
            })),
          });
        } catch (emailErr: unknown) {
          console.error('Order approval email sending failed:', emailErr);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'ERP Satış onayı başarıyla işlendi ve müşteriye bilgilendirme maili iletildi.',
      orderFound: Boolean(order),
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Webhook işlenemedi.';
    console.error('ERP Webhook Error:', error);
    res.status(500).json({ success: false, message: errorMsg });
  }
}
