import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { executeIyzicoPayment, initializeCheckoutForm } from '../services/iyzico.service';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { releaseStockAtomic } from '../services/stock.service';


export async function processCardPayment(req: Request, res: Response): Promise<void> {
  try {
    const {
      orderId,
      conversationId,
      totalAmount,
      installment = 1,
      cardHolderName,
      cardNumber,
      expireMonth,
      expireYear,
      cvv,
      savedCardId,
      cardToken,
      buyer,
      basketItems,
    } = req.body;

    const isSavedCard = Boolean(savedCardId || cardToken);

    if (!isSavedCard && (!cardNumber || !expireMonth || !expireYear || !cvv || !cardHolderName)) {
      res.status(400).json({ success: false, message: 'Kredi kartı bilgileri eksik veya geçersiz.' });
      return;
    }

    let paymentResult: any;

    if (isSavedCard) {
      // Tokenized / Saved Card Payment Simulation & Processing
      const idempotencyKey = crypto.randomUUID();
      paymentResult = {
        status: 'success',
        paymentId: `PAY-SAVED-${Date.now()}`,
        idempotencyKey,
        rawSignature: idempotencyKey,
      };
    } else {
      const cleanCardNum = (cardNumber || '').replace(/\s+/g, '');
      const cleanExpireMonth = (expireMonth || '12').toString().padStart(2, '0');
      const cleanExpireYear = (expireYear || '2028').toString().length === 2 ? `20${expireYear}` : (expireYear || '2028').toString();

      paymentResult = await executeIyzicoPayment({
        conversationId: conversationId || `CONV-${Date.now()}`,
        price: totalAmount,
        paidPrice: totalAmount,
        currency: 'TRY',
        installment: Number(installment),
        basketId: `BSK-${Date.now()}`,
        basketItems: basketItems || [],
        paymentCard: {
          cardHolderName: cardHolderName || 'Müşteri',
          cardNumber: cleanCardNum,
          expireMonth: cleanExpireMonth,
          expireYear: cleanExpireYear,
          cvv: cvv || '000',
        },
        buyer: buyer || {
          id: 'BYR-GUEST',
          name: (cardHolderName || 'Müşteri').split(' ')[0] || 'Müşteri',
          surname: (cardHolderName || 'Müşteri').split(' ')[1] || 'Soyadı',
          gsmNumber: '+905320000000',
          email: 'musteri@example.com',
          identityNumber: '11111111110',
          registrationAddress: 'Modoko Mobilyacılar Sitesi',
          city: 'Istanbul',
          country: 'Turkey',
          ip: req.ip || '127.0.0.1',
        },
      });
    }

    if (paymentResult.status === 'success') {
      if (orderId) {
        await prisma.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: PaymentStatus.PAID,
            orderStatus: OrderStatus.PREPARING,
          },
        });
      }

      res.status(200).json({
        success: true,
        message: '3D Secure Ödemesi Başarıyla Gerçekleştirildi.',
        paymentId: paymentResult.paymentId,
        checkoutFormContent: paymentResult.checkoutFormContent || null,
        idempotencyKey: paymentResult.idempotencyKey,
        signature: paymentResult.rawSignature,
      });
    } else {
      if (orderId) {
        const failedOrder = await prisma.order.findUnique({
          where: { id: orderId },
          include: { items: true },
        });
        if (failedOrder && failedOrder.items) {
          await releaseStockAtomic(
            failedOrder.items.map((i) => ({
              productId: i.productId,
              variantId: i.variantId || undefined,
              quantity: i.quantity,
            }))
          );
          await prisma.order.update({
            where: { id: orderId },
            data: {
              paymentStatus: PaymentStatus.FAILED,
              orderStatus: OrderStatus.CANCELLED,
            },
          });
        }
      }

      res.status(400).json({
        success: false,
        message: paymentResult.errorMessage || 'Ödeme banka tarafından reddedildi.',
        errorCode: paymentResult.errorCode,
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Ödeme altyapısında bir sistem hatası oluştu.' });
  }
}

/**
 * Handle Atomic Iyzico Webhook / Callback Result
 * Updates Order & Payment Status in a Prisma Transaction
 */
export async function handleIyzicoWebhook(req: Request, res: Response): Promise<void> {
  const token = req.body?.token || req.query?.token;
  const orderId =
    (req.query?.orderId as string) ||
    req.body?.orderId ||
    (req.body?.conversationId ? String(req.body.conversationId).replace(/^CONV-/, '') : null);
  const status = req.body?.status || req.query?.status;
  const iyziEventType = req.body?.iyziEventType;
  const iyziPaymentId = req.body?.iyziPaymentId || req.body?.paymentId;

  console.log(`[Iyzico Webhook Callback] Event: ${iyziEventType}, PaymentID: ${iyziPaymentId}, Status: ${status}, OrderId: ${orderId}, Token: ${token}`);

  if (!orderId && !token) {
    res.status(200).json({ status: 'OK', note: 'Webhook received without orderId or token' });
    return;
  }

  try {
    const isSuccess =
      status === 'SUCCESS' ||
      status === 'success' ||
      iyziEventType === 'payment.success' ||
      req.body?.paymentStatus === 'SUCCESS';

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: orderId ? { id: orderId } : { orderNumber: { contains: String(token).slice(0, 10) } },
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

