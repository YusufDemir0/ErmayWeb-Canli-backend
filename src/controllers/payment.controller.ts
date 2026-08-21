import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { executeIyzicoPayment } from '../services/iyzico.service';
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
      buyer,
      basketItems,
    } = req.body;

    if (!cardNumber || !expireMonth || !expireYear || !cvv || !cardHolderName) {
      res.status(400).json({ success: false, message: 'Kredi kartı bilgileri eksik veya geçersiz.' });
      return;
    }

    const cleanCardNum = cardNumber.replace(/\s+/g, '');
    const cleanExpireMonth = expireMonth.toString().padStart(2, '0');
    const cleanExpireYear = expireYear.toString().length === 2 ? `20${expireYear}` : expireYear.toString();

    const paymentResult = await executeIyzicoPayment({
      conversationId: conversationId || `CONV-${Date.now()}`,
      price: totalAmount,
      paidPrice: totalAmount,
      currency: 'TRY',
      installment: Number(installment),
      basketId: `BSK-${Date.now()}`,
      basketItems: basketItems || [],
      paymentCard: {
        cardHolderName,
        cardNumber: cleanCardNum,
        expireMonth: cleanExpireMonth,
        expireYear: cleanExpireYear,
        cvv,
      },
      buyer: buyer || {
        id: 'BYR-GUEST',
        name: cardHolderName.split(' ')[0] || 'Müşteri',
        surname: cardHolderName.split(' ')[1] || 'Soyadı',
        gsmNumber: '+905320000000',
        email: 'musteri@example.com',
        identityNumber: '11111111110',
        registrationAddress: 'Modoko Mobilyacılar Sitesi',
        city: 'Istanbul',
        country: 'Turkey',
        ip: req.ip || '127.0.0.1',
      },
    });

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
  const { iyziEventType, iyziPaymentId, status, orderId } = req.body;
  console.log(`[Iyzico Webhook Callback] Event: ${iyziEventType}, PaymentID: ${iyziPaymentId}, Status: ${status}, OrderId: ${orderId}`);

  if (!orderId) {
    res.status(200).json({ status: 'OK', note: 'Webhook received without orderId' });
    return;
  }

  try {
    const isSuccess = status === 'SUCCESS' || iyziEventType === 'payment.success';

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) return;

      if (isSuccess) {
        await tx.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: PaymentStatus.PAID,
            orderStatus: OrderStatus.PREPARING,
          },
        });
      } else {
        await tx.order.update({
          where: { id: orderId },
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

    res.status(200).json({ status: 'OK', processed: true });
  } catch (error) {
    console.error('Webhook işleme hatası:', error);
    res.status(500).json({ status: 'ERROR', message: 'Webhook işlenemedi' });
  }
}
