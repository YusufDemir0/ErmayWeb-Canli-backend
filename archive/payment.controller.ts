import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { executeIyzicoPayment, initializeCheckoutForm, retrieveCheckoutFormResult } from '../services/iyzico.service';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { releaseStockAtomic } from '../services/stock.service';

export async function processCardPayment(req: Request, res: Response): Promise<void> {
  try {
    const {
      orderId,
      conversationId,
      installment = 1,
      cardHolderName,
      cardNumber,
      expireMonth,
      expireYear,
      cvv,
      buyer,
    } = req.body;

    if (!orderId) {
      res.status(400).json({ success: false, message: 'Ödeme için sipariş numarası (orderId) zorunludur.' });
      return;
    }

    // 1. FİYATI ASLA CLIENT'TAN ALMA! Siparişi DB'den çek ve kesin tutarı doğrula (Zero-Trust Security)
    const dbOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        shippingAddress: true,
        user: true,
      },
    });

    if (!dbOrder) {
      res.status(404).json({ success: false, message: 'Ödeme yapılacak sipariş bulunamadı.' });
      return;
    }

    if (dbOrder.paymentStatus === PaymentStatus.PAID) {
      res.status(400).json({ success: false, message: 'Bu siparişin ödemesi zaten başarıyla tahsil edilmiştir.' });
      return;
    }

    // Doğrulanmış sunucu sipariş tutarı
    const verifiedTotalAmount = Number(dbOrder.totalAmount);

    if (!cardNumber || !expireMonth || !expireYear || !cvv || !cardHolderName) {
      res.status(400).json({ success: false, message: 'Kredi kartı bilgileri eksik veya geçersiz.' });
      return;
    }

    const cleanCardNum = (cardNumber || '').replace(/\s+/g, '');
    const cleanExpireMonth = (expireMonth || '12').toString().padStart(2, '0');
    const cleanExpireYear = (expireYear || '2028').toString().length === 2 ? `20${expireYear}` : (expireYear || '2028').toString();

    const verifiedBasketItems = dbOrder.items.map((item, idx) => ({
      id: item.productId,
      name: item.product?.name || `Mobilya Kalemi ${idx + 1}`,
      category1: 'Mobilya',
      price: Number(item.totalPrice || item.unitPrice),
    }));

    const paymentResult = await executeIyzicoPayment({
      conversationId: conversationId || `CONV-${dbOrder.id}`,
      price: verifiedTotalAmount,
      paidPrice: verifiedTotalAmount,
      currency: 'TRY',
      installment: Number(installment),
      basketId: `BSK-${dbOrder.id}`,
      basketItems: verifiedBasketItems,
      paymentCard: {
        cardHolderName: cardHolderName.trim(),
        cardNumber: cleanCardNum,
        expireMonth: cleanExpireMonth,
        expireYear: cleanExpireYear,
        cvv: cvv.trim(),
      },
      buyer: buyer || {
        id: dbOrder.userId,
        name: dbOrder.shippingAddress?.fullName?.split(' ')[0] || cardHolderName.split(' ')[0] || 'Müşteri',
        surname: dbOrder.shippingAddress?.fullName?.split(' ').slice(1).join(' ') || 'Soyadı',
        gsmNumber: dbOrder.shippingAddress?.phone || '+905320000000',
        email: dbOrder.user?.email || 'musteri@ermaymobilya.com',
        identityNumber: dbOrder.tcKn || '11111111110',
        registrationAddress: dbOrder.shippingAddress?.addressLine || 'Modoko Mobilyacılar Sitesi',
        city: dbOrder.shippingAddress?.city || 'Istanbul',
        country: 'Turkey',
        ip: req.ip || '127.0.0.1',
      },
    });

    if (paymentResult.status === 'success') {
      await prisma.order.update({
        where: { id: dbOrder.id },
        data: {
          paymentStatus: PaymentStatus.PAID,
          orderStatus: OrderStatus.PREPARING,
        },
      });

      res.status(200).json({
        success: true,
        message: '3D Secure Ödemesi Başarıyla Gerçekleştirildi.',
        paymentId: paymentResult.paymentId,
        checkoutFormContent: paymentResult.checkoutFormContent || null,
        idempotencyKey: paymentResult.idempotencyKey,
        signature: paymentResult.rawSignature,
      });
    } else {
      // Ödeme başarısız ise stokları geri iade et ve sipariş durumunu güncelle
      if (dbOrder.items && dbOrder.items.length > 0) {
        await releaseStockAtomic(
          dbOrder.items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId || undefined,
            quantity: i.quantity,
          }))
        );
      }

      await prisma.order.update({
        where: { id: dbOrder.id },
        data: {
          paymentStatus: PaymentStatus.FAILED,
          orderStatus: OrderStatus.CANCELLED,
        },
      });

      res.status(400).json({
        success: false,
        message: paymentResult.errorMessage || 'Ödeme banka tarafından reddedildi.',
        errorCode: paymentResult.errorCode,
      });
    }
  } catch (error) {
    console.error('processCardPayment Hatası:', error);
    res.status(500).json({ success: false, message: 'Ödeme altyapısında bir sistem hatası oluştu.' });
  }
}

/**
 * Handle Atomic Iyzico Webhook / Callback Result
 * Updates Order & Payment Status in a Prisma Transaction using Verified Token Data
 */
export async function handleIyzicoWebhook(req: Request, res: Response): Promise<void> {
  const token = (req.body?.token || req.query?.token) as string | undefined;
  let orderId =
    (req.query?.orderId as string) ||
    req.body?.orderId ||
    (req.body?.conversationId ? String(req.body.conversationId).replace(/^CONV-/, '') : null);

  let isSuccess =
    req.body?.status === 'SUCCESS' ||
    req.body?.status === 'success' ||
    req.body?.iyziEventType === 'payment.success';

  console.log(`[Iyzico Webhook / Callback] Token: ${token}, OrderId: ${orderId}, Status: ${req.body?.status}`);

  try {
    // If Iyzico Checkout Form token is present, retrieve authentic payment data directly from Iyzico API
    if (token) {
      const tokenResult = await retrieveCheckoutFormResult(token);
      if (tokenResult.conversationId) {
        orderId = tokenResult.conversationId.replace(/^CONV-/, '');
      }
      isSuccess = tokenResult.status === 'success';
    }

    if (!orderId) {
      res.status(200).json({ status: 'OK', note: 'Webhook received without orderId' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) return;

      if (isSuccess) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: PaymentStatus.PAID,
            orderStatus: OrderStatus.PREPARING,
          },
        });
      } else {
        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: PaymentStatus.FAILED,
            orderStatus: OrderStatus.CANCELLED,
          },
        });

        // Release locked stock if payment failed
        const releaseItems = order.items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId || undefined,
          quantity: i.quantity,
        }));
        await releaseStockAtomic(releaseItems);
      }
    });

    // Browser form callback / 3D redirect vs server-to-server webhook distinction:
    const isBrowserCallback =
      Boolean(token) ||
      req.headers['sec-fetch-dest'] === 'document' ||
      req.headers.accept?.includes('text/html') ||
      req.headers['content-type']?.includes('application/x-www-form-urlencoded') ||
      !req.headers['x-iyzi-rnd'];

    if (isBrowserCallback) {
      const frontendUrl = process.env.APP_URL || process.env.CORS_ORIGIN || 'http://localhost:3000';
      const redirectTarget = isSuccess
        ? `${frontendUrl}/hesabim?paymentSuccess=1&orderId=${orderId || ''}`
        : `${frontendUrl}/odeme?paymentFailed=1&orderId=${orderId || ''}`;
      return res.redirect(redirectTarget);
    }

    res.status(200).json({ status: 'OK', processed: true });
  } catch (error) {
    console.error('Webhook işleme hatası:', error);
    res.status(500).json({ status: 'ERROR', message: 'Webhook işlenemedi' });
  }
}

/**
 * PCI-DSS Uyumlu Iyzico Hosted Checkout Form Başlatma Endpoint'i
 */
export async function initCheckoutForm(req: Request, res: Response): Promise<void> {
  try {
    const { orderId, callbackUrl, buyer, basketItems } = req.body;

    if (!orderId) {
      res.status(400).json({ success: false, message: 'Sipariş ID (orderId) zorunludur.' });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, shippingAddress: true, user: true },
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });
      return;
    }

    const price = Number(order.totalAmount);

    const result = await initializeCheckoutForm({
      conversationId: `CONV-${order.id}`,
      price,
      paidPrice: price,
      currency: 'TRY',
      basketId: `BSK-${order.id}`,
      callbackUrl: callbackUrl || `${process.env.APP_URL || 'http://localhost:3000'}/api/v1/payments/webhook?orderId=${order.id}`,
      basketItems: basketItems || order.items.map((i) => ({
        id: i.productId,
        name: i.product?.name || 'Mobilya Ürünü',
        category1: 'Mobilya',
        price: Number(i.totalPrice),
      })),
      buyer: buyer || {
        id: order.userId || 'GUEST-USER',
        name: order.user?.name?.split(' ')[0] || order.shippingAddress?.fullName?.split(' ')[0] || 'Değerli',
        surname: order.user?.name?.split(' ').slice(1).join(' ') || order.shippingAddress?.fullName?.split(' ').slice(1).join(' ') || 'Müşterimiz',
        gsmNumber: order.user?.phone || order.shippingAddress?.phone || '+905320000000',
        email: order.user?.email || 'musteri@ermaymobilya.com',
        identityNumber: order.tcKn || '11111111110',
        registrationAddress: order.shippingAddress?.addressLine || 'Modoko Mobilyacılar Sitesi',
        city: order.shippingAddress?.city || 'İstanbul',
        country: 'Turkey',
        ip: req.ip || '127.0.0.1',
      },
    });

    if (result.status === 'success') {
      res.status(200).json({
        success: true,
        checkoutFormContent: result.checkoutFormContent,
        token: result.token,
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.errorMessage || 'Ödeme formu oluşturulamadı.',
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Ödeme altyapısı başlatılamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}

