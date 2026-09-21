import { Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { reserveStockAtomic, releaseStockAtomic } from '../services/stock.service';
import { validateOrderStateTransition } from '../services/orderStateMachine.service';
import { telegramService } from '../services/telegram.service';
import { emailService } from '../services/email.service';
import { dailyReportService } from '../services/dailyReport.service';
import { erpIntegrationService } from '../services/erpIntegration.service';
import { OrderStatus, PaymentMethod, PaymentStatus, InvoiceType } from '@prisma/client';
import { calculateOrderFinancials, toKurus } from '../utils/financial';

interface CartItemInput {
  productId?: string;
  product?: { id: string };
  variantId?: string | null;
  quantity: number;
}

export async function createOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.userId || null;
  const {
    items,
    shippingAddressId,
    shippingAddress,
    customerName,
    customerEmail,
    customerPhone,
    customerPhone2,
    shippingCity,
    shippingDistrict,
    shippingAddressLine,
    orderNote,
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

  // Combine client-detected device info with server-side network signals
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
  const serverAgent = req.headers['user-agent'] || 'Bilinmiyor';
  const enrichedDeviceInfo = {
    ...(typeof deviceInfo === 'object' && deviceInfo !== null ? deviceInfo : {}),
    ip: clientIp,
    userAgent: serverAgent,
    capturedAt: new Date().toISOString(),
  };

  // Synthesize customer and shipping information (supports Guest Checkout)
  const finalCustomerName = (customerName || shippingAddress?.fullName || '').trim();
  const finalPhone = (customerPhone || shippingAddress?.phone || '').trim();
  const finalPhone2 = (customerPhone2 || shippingAddress?.phone2 || '').trim();
  const finalEmail = (customerEmail || req.user?.email || '').trim();
  const finalCity = (shippingCity || shippingAddress?.city || 'İstanbul').trim();
  const finalDistrict = (shippingDistrict || shippingAddress?.district || '').trim();
  const finalAddressLine = (shippingAddressLine || shippingAddress?.addressLine || '').trim();

  if (!finalCustomerName || !finalPhone || !finalAddressLine) {
    res.status(400).json({
      success: false,
      message: 'Lütfen Ad Soyad, Telefon Numarası ve Teslimat Adresini eksiksiz doldurunuz.',
    });
    return;
  }

  // Check City Serviceability (Delivery Zone)
  try {
    const deliveryBlock = await prisma.cmsBlock.findUnique({
      where: { key: 'delivery_zones' },
    });

    if (deliveryBlock && deliveryBlock.content) {
      const zones = deliveryBlock.content as { disabledCityNames?: string[] };
      const disabled = zones.disabledCityNames || [];
      const isCityDisabled = disabled.some(
        (c) => c.toLocaleLowerCase('tr-TR') === finalCity.toLocaleLowerCase('tr-TR')
      );
      if (isCityDisabled) {
        res.status(400).json({
          success: false,
          message: `Üzgünüz, geçici olarak ${finalCity} iline mobilya teslimat ve kurulum hizmetimiz bulunmamaktadır. Lütfen aktif bir teslimat ili seçiniz veya WhatsApp hattımızdan (0532 419 41 51) özel nakliye danışınız.`,
        });
        return;
      }
    }
  } catch (err: unknown) {
    console.warn('Delivery zone check failed, proceeding with fallback:', err);
  }

  let addressId = shippingAddressId;
  const isUuid = typeof addressId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(addressId);
  if (!isUuid) {
    addressId = undefined;
  }

  const itemCalculationInputs: Array<{ unitPrice: number; quantity: number; vatRate: number }> = [];
  const orderItemsData: Array<{ productId: string; variantId: string | null; quantity: number; unitPrice: number; totalPrice: number }> = [];
  const itemsForErp: Array<{ itemId: string; quantity: number; price: number; name: string }> = [];
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

    itemsForErp.push({
      itemId: dbProduct.erpItemId || '1',
      quantity: item.quantity,
      price: finalUnitPrice,
      name: dbProduct.name,
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

    if (!addressId && shippingAddress && userId) {
      const createdAddr = await prisma.userAddress.create({
        data: {
          userId,
          title: shippingAddress.title || 'Teslimat Adresi',
          fullName: finalCustomerName,
          phone: finalPhone,
          city: finalCity,
          district: finalDistrict,
          addressLine: finalAddressLine,
          zipCode: shippingAddress.zipCode || '34000',
        },
      });
      addressId = createdAddr.id;
    }

    const financials = calculateOrderFinancials(itemCalculationInputs, calculatedCouponKurus);

    // 4. Generate Web Depo sequence (WDS00001, WDS00002...)
    const lastWdsOrder = await prisma.order.findFirst({
      where: { orderNumber: { startsWith: 'WDS' } },
      orderBy: { createdAt: 'desc' },
      select: { orderNumber: true },
    });
    let nextWdsSeq = 1;
    if (lastWdsOrder?.orderNumber) {
      const match = lastWdsOrder.orderNumber.match(/WDS(\d+)/i);
      if (match && match[1]) {
        nextWdsSeq = parseInt(match[1], 10) + 1;
      }
    }
    const orderNumber = `WDS${String(nextWdsSeq).padStart(5, '0')}`;
    const invoiceNumber = `FAT-${orderNumber}`;

    // 5. Submit web order to ERP Web Depo
    let erpSaleId: string | null = null;
    let erpSaleCode: string | null = null;

    try {
      const erpRes = await erpIntegrationService.submitWebOrderToErp({
        warehouse: 'Web Depo',
        warehouseCode: 'WDS',
        webOrderNumber: orderNumber,
        customerType: invoiceType === 'CORPORATE' ? 'CORPORATE' : 'INDIVIDUAL',
        fullName: finalCustomerName,
        phone1: finalPhone,
        phone2: finalPhone2 || undefined,
        email: finalEmail || 'siparis@ermaymobilya.com',
        city: finalCity,
        district: finalDistrict,
        address: finalAddressLine,
        taxOffice: (invoiceType === 'CORPORATE' ? taxOffice : undefined) || undefined,
        taxNumber: (invoiceType === 'CORPORATE' ? taxNo : tcKn) || undefined,
        orderNote: orderNote || undefined,
        totalAmount: financials.finalTotal,
        paymentMethod: (paymentMethod as string) || 'WHATSAPP_SIPARIS',
        items: itemsForErp,
      });

      if (erpRes && erpRes.saleCode) {
        erpSaleId = erpRes.saleId;
        erpSaleCode = erpRes.saleCode;
        console.log(`[ERP ORDER CREATED] Web Order: ${orderNumber} -> ERP Sale: ${erpSaleCode}, ID: ${erpSaleId}`);
      }
    } catch (erpError: any) {
      console.warn('[ERP INTEGRATION WARNING] Sale could not be synced immediately to ERP:', erpError.message);
    }

    let finalPaymentMethod: PaymentMethod = PaymentMethod.BANK_TRANSFER;
    if (paymentMethod === 'CREDIT_CARD') {
      finalPaymentMethod = PaymentMethod.CREDIT_CARD;
    } else if (paymentMethod === 'CASH_ON_DELIVERY') {
      finalPaymentMethod = PaymentMethod.CASH_ON_DELIVERY;
    } else {
      finalPaymentMethod = PaymentMethod.BANK_TRANSFER;
    }

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
          userId: userId || null,
          customerName: finalCustomerName,
          customerEmail: finalEmail || null,
          customerPhone: finalPhone,
          customerPhone2: finalPhone2 || null,
          shippingCity: finalCity,
          shippingDistrict: finalDistrict,
          shippingAddressLine: finalAddressLine,
          orderNote: orderNote || null,
          erpSaleId,
          erpSaleCode,
          shippingAddressId: addressId || null,
          totalAmount: financials.finalTotal,
          discountAmount: financials.discountAmount,
          taxAmount: financials.taxAmount,
          paymentMethod: finalPaymentMethod,
          paymentStatus: PaymentStatus.PENDING,
          orderStatus: OrderStatus.PENDING_PAYMENT,
          invoiceType: invoiceType === 'CORPORATE' ? InvoiceType.CORPORATE : InvoiceType.INDIVIDUAL,
          tcKn: invoiceType === 'INDIVIDUAL' ? (tcKn || null) : null,
          companyTitle: invoiceType === 'CORPORATE' ? (companyTitle || null) : null,
          taxNo: invoiceType === 'CORPORATE' ? (taxNo || null) : null,
          taxOffice: invoiceType === 'CORPORATE' ? (taxOffice || null) : null,
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
        customerName: newOrder.customerName || newOrder.shippingAddress?.fullName || newOrder.user?.name || 'Değerli Müşteri',
        customerPhone: newOrder.customerPhone || newOrder.shippingAddress?.phone || newOrder.user?.phone || '-',
        totalAmount: Number(newOrder.totalAmount),
        paymentMethod: String(newOrder.paymentMethod),
        city: newOrder.shippingCity || newOrder.shippingAddress?.city,
        district: newOrder.shippingDistrict || newOrder.shippingAddress?.district,
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
    const targetEmail = newOrder.customerEmail || newOrder.user?.email || req.body.customerEmail;
    if (targetEmail) {
      emailService
        .sendOrderConfirmation({
          orderNumber: newOrder.orderNumber,
          customerName: newOrder.customerName || newOrder.shippingAddress?.fullName || newOrder.user?.name || 'Değerli Müşteri',
          customerEmail: targetEmail,
          customerPhone: newOrder.customerPhone || newOrder.shippingAddress?.phone || newOrder.user?.phone || '-',
          totalAmount: Number(newOrder.totalAmount),
          taxAmount: Number(newOrder.taxAmount),
          discountAmount: Number(newOrder.discountAmount),
          paymentMethod: String(newOrder.paymentMethod),
          shippingAddress: {
            fullName: newOrder.customerName || newOrder.shippingAddress?.fullName || 'Değerli Müşteri',
            phone: newOrder.customerPhone || newOrder.shippingAddress?.phone || '-',
            city: newOrder.shippingCity || newOrder.shippingAddress?.city || 'İstanbul',
            district: newOrder.shippingDistrict || newOrder.shippingAddress?.district || 'Modoko',
            addressLine: newOrder.shippingAddressLine || newOrder.shippingAddress?.addressLine || 'Adres detayı',
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

    // Notify customer by email when their order is shipped
    if (orderStatus === OrderStatus.SHIPPED && existingOrder.orderStatus !== OrderStatus.SHIPPED && existingOrder.customerEmail) {
      emailService
        .sendShippingNotificationEmail({
          orderNumber: existingOrder.orderNumber,
          customerName: existingOrder.customerName || 'Değerli Müşterimiz',
          customerEmail: existingOrder.customerEmail,
          shippingCarrier: shippingCarrier || existingOrder.shippingCarrier || undefined,
          trackingNumber: trackingNumber || existingOrder.trackingNumber || undefined,
          shippingCity: existingOrder.shippingCity || '',
          shippingDistrict: existingOrder.shippingDistrict || '',
        })
        .catch((err) => console.error('[SHIPPING EMAIL TRIGGER ERROR]:', err));
    }

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

export async function getOrderByNumber(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const orderNumber = req.params.orderNumber as string;

    const order = await prisma.order.findUnique({
      where: { orderNumber },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                image: true,
                images: true,
                price: true,
                erpItemCode: true,
              },
            },
          },
        },
        shippingAddress: true,
      },
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });
      return;
    }

    res.status(200).json({ success: true, order });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || 'Sipariş yüklenemedi.' });
  }
}

