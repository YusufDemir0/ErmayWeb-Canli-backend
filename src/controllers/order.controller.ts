import { Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { reserveStockAtomic, releaseStockAtomic } from '../services/stock.service';
import { validateOrderStateTransition } from '../services/orderStateMachine.service';
import { telegramService } from '../services/telegram.service';
import { emailService } from '../services/email.service';
import { dailyReportService } from '../services/dailyReport.service';
import { OrderStatus, PaymentMethod, PaymentStatus, InvoiceType } from '@prisma/client';
import { calculateOrderFinancials, toKurus } from '../utils/financial';

interface CartItemInput {
  productId?: string;
  product?: { id: string };
  variantId?: string | null;
  quantity: number;
}

export async function createOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const {
    items,
    shippingAddressId,
    shippingAddress,
    invoiceType,
    tcKn,
    companyTitle,
    taxNo,
    taxOffice,
    paymentMethod,
    couponCode,
    deviceInfo,
    regionCode,
    kvkkAccepted,
  } = req.body;

  if (!items || items.length === 0) {
    res.status(400).json({ success: false, message: 'Sipariş sepeti boş olamaz.' });
    return;
  }

  if (!userId) {
    res.status(401).json({ success: false, message: 'Sipariş vermek için giriş yapmalısınız.' });
    return;
  }

  // Combine client-detected device info with server-side network signals
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
  const serverAgent = req.headers['user-agent'] || 'Bilinmiyor';
  const enrichedDeviceInfo = {
    ...(typeof deviceInfo === 'object' && deviceInfo !== null ? deviceInfo : {}),
    ip: clientIp,
    userAgent: serverAgent,
    capturedAt: new Date().toISOString(),
  };

    // 1. Ürün ve Adres Doğrulamalarını Stok Rezerve Etmeden ÖNCE Yap
    let addressId = shippingAddressId;
    const isUuid = typeof addressId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(addressId);
    if (!isUuid) {
      addressId = undefined;
    }

    if (!addressId && !shippingAddress) {
      res.status(400).json({ success: false, message: 'Geçerli bir teslimat adresi seçilmeli veya girilmelidir.' });
      return;
    }

    const itemCalculationInputs: Array<{ unitPrice: number; quantity: number; vatRate: number }> = [];
    const orderItemsData: Array<{ productId: string; variantId: string | null; quantity: number; unitPrice: number; totalPrice: number }> = [];
    let subTotalKurus = 0;

    for (const item of items) {
      const pId = item.productId || item.product?.id;
      if (!pId) {
        res.status(400).json({
          success: false,
          message: 'Siparişteki ürünün geçerli bir kimlik bilgisi (productId) bulunamadı.',
        });
        return;
      }

      const dbProduct = await prisma.product.findUnique({
        where: { id: pId },
        include: { variants: true },
      });

      if (!dbProduct || !dbProduct.inStock) {
        res.status(400).json({
          success: false,
          message: `Sipariş edilmek istenen ürün (${pId || item.product?.name || 'Bilinmeyen'}) stokta yok veya satıştan kaldırılmıştır.`,
        });
        return;
      }

      let finalUnitPrice = Number(dbProduct.price);

      if (item.variantId) {
        const variant = dbProduct.variants.find((v) => v.id === item.variantId);
        if (!variant) {
          res.status(400).json({
            success: false,
            message: `Ürüne ait geçerli bir varyant bulunamadı (Variant ID: ${item.variantId}).`,
          });
          return;
        }
        finalUnitPrice = Number(variant.price);
      }

      const vatRate = dbProduct.vatRate ? Number(dbProduct.vatRate) : 0.20;

      itemCalculationInputs.push({
        unitPrice: finalUnitPrice,
        quantity: item.quantity,
        vatRate,
      });

      subTotalKurus += toKurus(finalUnitPrice * item.quantity);

      orderItemsData.push({
        productId: dbProduct.id,
        variantId: item.variantId || null,
        quantity: item.quantity,
        unitPrice: finalUnitPrice,
        totalPrice: Number((finalUnitPrice * item.quantity).toFixed(2)),
      });
    }

    // 2. Doğrulanmış Ürünler için Atomik Stok Rezervasyonu
    const stockItems = items.map((i: CartItemInput) => ({
      productId: i.productId || i.product?.id,
      variantId: i.variantId,
      quantity: i.quantity,
    }));

    let stockReserved = false;

    try {
      await reserveStockAtomic(stockItems);
      stockReserved = true;
    } catch (stockError: unknown) {
      const msg = stockError instanceof Error ? stockError.message : 'Stok rezervasyonu başarısız.';
      res.status(409).json({ success: false, message: msg });
      return;
    }

    // 3. Siparişi Veritabanına Transaction ile Kaydet
    try {
      let calculatedCouponKurus = 0;
      let couponIdToIncrement: string | null = null;

      if (couponCode && typeof couponCode === 'string' && couponCode.trim().length > 0) {
        const dbCoupon = await prisma.coupon.findUnique({
          where: { code: couponCode.trim().toUpperCase() },
        });

        if (dbCoupon && dbCoupon.isActive) {
          let isExpired = false;
          if (dbCoupon.expiryDate) {
            const exp = new Date(dbCoupon.expiryDate);
            exp.setHours(23, 59, 59, 999);
            isExpired = exp.getTime() < Date.now();
          }

          if (!isExpired) {
            if (!dbCoupon.maxUses || dbCoupon.usedCount < dbCoupon.maxUses) {
              if (dbCoupon.discountType === 'percentage') {
                calculatedCouponKurus = Math.round((subTotalKurus * Number(dbCoupon.discount)) / 100);
              } else {
                calculatedCouponKurus = toKurus(Number(dbCoupon.discount || dbCoupon.discountAmount));
              }
              couponIdToIncrement = dbCoupon.id;
            }
          }
        }
      }

      if (!addressId && shippingAddress) {
        const createdAddr = await prisma.userAddress.create({
          data: {
            userId,
            title: shippingAddress.title || 'Teslimat Adresi',
            fullName: shippingAddress.fullName || 'Değerli Müşterimiz',
            phone: shippingAddress.phone || '',
            city: shippingAddress.city || 'İstanbul',
            district: shippingAddress.district || 'Ümraniye',
            addressLine: shippingAddress.addressLine || 'Modoko',
            zipCode: shippingAddress.zipCode || '34000',
          },
        });
        addressId = createdAddr.id;
      }

      const financials = calculateOrderFinancials(itemCalculationInputs, calculatedCouponKurus);

      const year = new Date().getFullYear();
      const randomSeq = Math.floor(100000 + Math.random() * 900000);
      const orderNumber = `ERM-${year}-${randomSeq}`;
      const invoiceNumber = `ERM${year}${randomSeq}`;

      const newOrder = await prisma.$transaction(async (tx) => {
        if (couponIdToIncrement) {
          await tx.coupon.update({
            where: { id: couponIdToIncrement },
            data: { usedCount: { increment: 1 } },
          });
        }

        return tx.order.create({
          data: {
            orderNumber,
            invoiceNumber,
            userId,
            shippingAddressId: addressId,
            totalAmount: financials.finalTotal,
            discountAmount: financials.discountAmount,
            taxAmount: financials.taxAmount,
            paymentMethod: (paymentMethod as PaymentMethod) || PaymentMethod.CREDIT_CARD,
            paymentStatus: PaymentStatus.PENDING,
            orderStatus: OrderStatus.PENDING_PAYMENT,
            invoiceType: invoiceType === 'CORPORATE' ? InvoiceType.CORPORATE : InvoiceType.INDIVIDUAL,
            tcKn: invoiceType === 'INDIVIDUAL' ? tcKn : null,
            companyTitle: invoiceType === 'CORPORATE' ? companyTitle : null,
            taxNo: invoiceType === 'CORPORATE' ? taxNo : null,
            taxOffice: invoiceType === 'CORPORATE' ? taxOffice : null,
            deviceInfo: enrichedDeviceInfo,
            regionCode: typeof regionCode === 'string' ? regionCode : null,
            kvkkAccepted: Boolean(kvkkAccepted ?? true),
            items: {
              create: orderItemsData,
            },
          },
          include: {
            items: {
              include: { product: true },
            },
            shippingAddress: true,
            user: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        });
      });

      // 1. Asynchronous Telegram Real-time Order Alert
      telegramService
        .notifyNewOrder({
          orderNumber: newOrder.orderNumber,
          customerName: newOrder.shippingAddress?.fullName || newOrder.user?.name || 'Değerli Müşteri',
          customerPhone: newOrder.shippingAddress?.phone || newOrder.user?.phone || '-',
          totalAmount: Number(newOrder.totalAmount),
          paymentMethod: String(newOrder.paymentMethod),
          city: newOrder.shippingAddress?.city,
          district: newOrder.shippingAddress?.district,
          regionCode: newOrder.regionCode || undefined,
          deviceInfo: (newOrder.deviceInfo as any) || undefined,
          items: newOrder.items.map((i) => ({
            name: i.product?.name || 'Mobilya',
            quantity: i.quantity,
            price: Number(i.totalPrice),
          })),
        })
        .catch((err) => console.error('[TELEGRAM BG ERROR]', err));

      // 2. Asynchronous Customer Order Confirmation Email
      if (newOrder.user?.email || req.body.customerEmail) {
        const targetEmail = newOrder.user?.email || req.body.customerEmail;
        emailService
          .sendOrderConfirmation({
            orderNumber: newOrder.orderNumber,
            customerName: newOrder.shippingAddress?.fullName || newOrder.user?.name || 'Değerli Müşteri',
            customerEmail: targetEmail,
            customerPhone: newOrder.shippingAddress?.phone || newOrder.user?.phone || '-',
            totalAmount: Number(newOrder.totalAmount),
            taxAmount: Number(newOrder.taxAmount),
            discountAmount: Number(newOrder.discountAmount),
            paymentMethod: String(newOrder.paymentMethod),
            shippingAddress: {
              fullName: newOrder.shippingAddress?.fullName || 'Değerli Müşteri',
              phone: newOrder.shippingAddress?.phone || '-',
              city: newOrder.shippingAddress?.city || 'İstanbul',
              district: newOrder.shippingAddress?.district || 'Modoko',
              addressLine: newOrder.shippingAddress?.addressLine || 'Adres detayı',
            },
            items: newOrder.items.map((i) => ({
              name: i.product?.name || 'Mobilya',
              quantity: i.quantity,
              unitPrice: Number(i.unitPrice),
              totalPrice: Number(i.totalPrice),
            })),
          })
          .catch((err) => console.error('[EMAIL BG ERROR]', err));
      }

      res.status(201).json({
        success: true,
        message: 'Siparişiniz başarıyla alındı.',
        order: newOrder,
      });
    } catch (orderError: unknown) {
      if (stockReserved) {
        console.error('Sipariş oluşturma hatası, rezerve edilen stoklar iade ediliyor...', orderError);
        try {
          await releaseStockAtomic(stockItems);
        } catch (releaseError: unknown) {
          console.error('UYARI: Stok iadesi başarısız oldu! Manuel müdahale gerekiyor:', releaseError);
        }
      }

      const msg = orderError instanceof Error ? orderError.message : 'Sipariş işlenirken bir sunucu hatası oluştu.';
      res.status(500).json({
        success: false,
        message: msg,
      });
    }
}

export async function getUserOrders(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;

    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: { product: true },
        },
        shippingAddress: true,
      },
    });

    res.status(200).json({ success: true, orders });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Siparişleriniz getirilemedi.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function getAllOrders(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, role: true },
        },
        items: {
          include: { product: true },
        },
        shippingAddress: true,
      },
    });

    res.status(200).json({ success: true, orders });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Sipariş listesi alınamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function uploadReceipt(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const orderId = req.params.id as string;
    const { receiptUrl } = req.body;
    const userId = req.user?.userId;

    if (!receiptUrl) {
      res.status(400).json({ success: false, message: 'Dekont bağlantısı veya dosyası zorunludur.' });
      return;
    }

    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!existingOrder) {
      res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });
      return;
    }

    // Check ownership or admin
    if (existingOrder.userId !== userId && req.user?.role !== 'ADMIN') {
      res.status(403).json({ success: false, message: 'Bu siparişe dekont yükleme yetkiniz yok.' });
      return;
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        receiptUrl: receiptUrl,
        shippingCarrier: existingOrder.shippingCarrier || 'Havale/EFT Doğrulama',
      },
      include: { items: { include: { product: true } }, shippingAddress: true },
    });

    res.status(200).json({
      success: true,
      message: 'Havale/EFT dekontu başarıyla sisteme iletildi. Yetkili onayından sonra siparişiniz hazırlanacaktır.',
      order: {
        ...updated,
        receiptUrl,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Dekont yüklenirken bir hata oluştu.';
    res.status(500).json({ success: false, message: msg });
  }
}

export async function approveOrderPayment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const orderId = req.params.id as string;

    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!existingOrder) {
      res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });
      return;
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: PaymentStatus.PAID,
        orderStatus: OrderStatus.PREPARING,
      },
      include: { items: { include: { product: true } }, shippingAddress: true },
    });

    res.status(200).json({
      success: true,
      message: `Sipariş #${existingOrder.orderNumber} ödemesi onaylandı ve hazırlık aşamasına alındı.`,
      order: updated,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Ödeme onaylanamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}

function normalizeOrderStatus(rawStatus?: string): OrderStatus | undefined {
  if (!rawStatus) return undefined;
  const s = rawStatus.toUpperCase().trim();
  if (s === 'PENDING' || s === 'PENDING_PAYMENT' || s === 'ÖDEME BEKLIYOR' || s === 'ÖDEME BEKLİYOR') return OrderStatus.PENDING_PAYMENT;
  if (s === 'PAYMENT_CONFIRMED' || s === 'ÖDEME ONAYLANDI') return OrderStatus.PAYMENT_CONFIRMED;
  if (s === 'PREPARING' || s === 'HAZIRLANIYOR') return OrderStatus.PREPARING;
  if (s === 'SHIPPED' || s === 'KARGOYA VERILDI' || s === 'KARGOYA VERİLDİ') return OrderStatus.SHIPPED;
  if (s === 'DELIVERED' || s === 'TESLIM EDILDI' || s === 'TESLİM EDİLDİ') return OrderStatus.DELIVERED;
  if (s === 'CANCELLED' || s === 'İPTAL EDILDI' || s === 'İPTAL EDİLDİ') return OrderStatus.CANCELLED;
  if (s === 'REFUNDED' || s === 'İADE EDILDI' || s === 'İADE EDİLDİ') return OrderStatus.REFUNDED;
  return Object.values(OrderStatus).includes(rawStatus as OrderStatus) ? (rawStatus as OrderStatus) : undefined;
}

export async function updateOrderStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const orderId = req.params.id as string;
    const { orderStatus: rawStatus, trackingNumber, shippingCarrier } = req.body;
    const orderStatus = normalizeOrderStatus(rawStatus);

    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!existingOrder) {
      res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });
      return;
    }

    if (orderStatus) {
      validateOrderStateTransition(existingOrder.orderStatus, orderStatus);

      if (orderStatus === OrderStatus.CANCELLED || orderStatus === OrderStatus.REFUNDED) {
        const releaseItems = existingOrder.items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId || undefined,
          quantity: i.quantity,
        }));
        await releaseStockAtomic(releaseItems);
      }
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        orderStatus: orderStatus || undefined,
        trackingNumber: trackingNumber !== undefined ? trackingNumber : existingOrder.trackingNumber,
        shippingCarrier: shippingCarrier !== undefined ? shippingCarrier : existingOrder.shippingCarrier,
      },
    });

    res.status(200).json({
      success: true,
      message: `Sipariş #${existingOrder.orderNumber} durumu güncellendi.`,
      order: updatedOrder,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Sipariş durumu güncellenirken hata oluştu.';
    res.status(400).json({
      success: false,
      message: msg,
    });
  }
}

export async function triggerDailySalesReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const result = await dailyReportService.generateAndSendDailyReport();
    res.status(200).json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Günlük rapor oluşturulamadı.';
    res.status(500).json({ success: false, message: msg });
  }
}
