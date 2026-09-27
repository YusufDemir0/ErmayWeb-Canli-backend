import { prisma } from '../config/database';
import { emailService } from './email.service';

export interface DailyReportSummary {
  dateStr: string;
  totalRevenue: number;
  orderCount: number;
  deviceBreakdown: Record<string, number>;
  topProducts: Array<{ name: string; count: number; revenue: number }>;
}

export class DailyReportService {
  /**
   * Aggregate yesterday's sales data from PostgreSQL and send email to admin
   */
  async generateAndSendDailyReport(targetDate?: Date): Promise<{
    success: boolean;
    data: DailyReportSummary | null;
    message: string;
  }> {
    const baseDate = targetDate || new Date();
    // Yesterday start: 00:00:00
    const startOfYesterday = new Date(baseDate);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);

    // Yesterday end: 23:59:59
    const endOfYesterday = new Date(baseDate);
    endOfYesterday.setDate(endOfYesterday.getDate() - 1);
    endOfYesterday.setHours(23, 59, 59, 999);

    const dateStr = startOfYesterday.toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    try {
      // Query orders from yesterday (or last 24h fallback if no orders yesterday)
      let orders = await prisma.order.findMany({
        where: {
          createdAt: {
            gte: startOfYesterday,
            lte: endOfYesterday,
          },
        },
        include: {
          items: {
            include: { product: true },
          },
          shippingAddress: true,
          user: true,
        },
      });

      // If no orders yesterday, fetch recent 10 orders to provide meaningful data
      const isFallback = orders.length === 0;
      if (isFallback) {
        orders = await prisma.order.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              include: { product: true },
            },
            shippingAddress: true,
            user: true,
          },
        });
      }

      // Calculations
      let totalRevenue = 0;
      const paymentBreakdown: Record<string, number> = {};
      const statusBreakdown: Record<string, number> = {};
      const deviceBreakdown: Record<string, number> = { Mobil: 0, Masaüstü: 0, Tablet: 0, Bilinmiyor: 0 };
      const productSalesCount: Record<string, { name: string; count: number; revenue: number }> = {};

      for (const o of orders) {
        const amount = Number(o.totalAmount || 0);
        totalRevenue += amount;

        // Payment
        const pm = o.paymentMethod || 'Diğer';
        paymentBreakdown[pm] = (paymentBreakdown[pm] || 0) + amount;

        // Status
        const st = o.orderStatus || 'Hazırlanıyor';
        statusBreakdown[st] = (statusBreakdown[st] || 0) + 1;

        // Device
        const devInfo = (o.deviceInfo && typeof o.deviceInfo === 'object') ? (o.deviceInfo as { deviceType?: string }) : null;
        const devType = devInfo?.deviceType || 'Bilinmiyor';
        if (devType.toLowerCase().includes('mobil') || devType.toLowerCase().includes('telefon')) {
          deviceBreakdown['Mobil'] = (deviceBreakdown['Mobil'] || 0) + 1;
        } else if (devType.toLowerCase().includes('tablet') || devType.toLowerCase().includes('ipad')) {
          deviceBreakdown['Tablet'] = (deviceBreakdown['Tablet'] || 0) + 1;
        } else if (devType.toLowerCase().includes('masaüstü') || devType.toLowerCase().includes('laptop') || devType.toLowerCase().includes('desktop')) {
          deviceBreakdown['Masaüstü'] = (deviceBreakdown['Masaüstü'] || 0) + 1;
        } else {
          deviceBreakdown['Bilinmiyor'] = (deviceBreakdown['Bilinmiyor'] || 0) + 1;
        }

        // Items
        for (const item of o.items) {
          const pName = item.product?.name || 'Mobilya';
          const pId = item.productId;
          if (!productSalesCount[pId]) {
            productSalesCount[pId] = { name: pName, count: 0, revenue: 0 };
          }
          productSalesCount[pId].count += item.quantity;
          productSalesCount[pId].revenue += Number(item.totalPrice || 0);
        }
      }

      const topProducts = Object.values(productSalesCount)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const reportHtml = `
        <div style="font-family: Arial, sans-serif; background-color: #FAF8F5; padding: 24px; color: #171717;">
          <div style="max-width: 600px; margin: 0 auto; background: #fff; border: 1px solid #EAE3D2; border-radius: 6px; padding: 24px;">
            <h2 style="margin-top: 0; color: #C5A880; font-family: serif;">ERMAY MOBİLYA - GÜNLÜK SATIŞ BÜLTENİ</h2>
            <p style="font-size: 13px; color: #737373;"><strong>Rapor Tarihi:</strong> ${dateStr} ${isFallback ? '(Son Veriler Özeti)' : ''}</p>
            
            <div style="display: flex; gap: 12px; margin: 18px 0;">
              <div style="flex: 1; background: #F7F4EE; padding: 14px; border-radius: 4px; border: 1px solid #EAE3D2;">
                <span style="font-size: 11px; text-transform: uppercase; color: #737373;">Toplam Ciro</span>
                <h3 style="margin: 4px 0 0; color: #171717; font-size: 18px;">${totalRevenue.toLocaleString('tr-TR')} TL</h3>
              </div>
              <div style="flex: 1; background: #F7F4EE; padding: 14px; border-radius: 4px; border: 1px solid #EAE3D2;">
                <span style="font-size: 11px; text-transform: uppercase; color: #737373;">Sipariş Adedi</span>
                <h3 style="margin: 4px 0 0; color: #171717; font-size: 18px;">${orders.length} Adet</h3>
              </div>
            </div>

            <h4 style="border-bottom: 1px solid #EAE3D2; padding-bottom: 6px; margin: 20px 0 10px; font-size: 13px;">Cihaz Dağılımı</h4>
            <p style="font-size: 12px; color: #525252;">
              📱 Mobil: <strong>${deviceBreakdown['Mobil']}</strong> | 
              💻 Masaüstü/Laptop: <strong>${deviceBreakdown['Masaüstü']}</strong> | 
              📟 Tablet: <strong>${deviceBreakdown['Tablet']}</strong>
            </p>

            <h4 style="border-bottom: 1px solid #EAE3D2; padding-bottom: 6px; margin: 20px 0 10px; font-size: 13px;">En Çok Satan Mobilyalar</h4>
            <ul style="font-size: 12px; color: #525252; padding-left: 20px;">
              ${topProducts.map((p) => `<li><strong>${p.name}</strong>: ${p.count} adet satıldı (${p.revenue.toLocaleString('tr-TR')} TL)</li>`).join('')}
            </ul>

            <div style="margin-top: 24px; text-align: center; border-top: 1px solid #EAE3D2; padding-top: 14px;">
              <a href="http://localhost:1717/admin?tab=orders" style="background: #171717; color: #fff; padding: 10px 20px; font-size: 12px; text-decoration: none; border-radius: 3px; font-weight: bold;">
                Admin Paneline Git
              </a>
            </div>
          </div>
        </div>
      `;

      await emailService.sendDailyAdminReport(reportHtml, dateStr);

      return {
        success: true,
        data: {
          dateStr,
          totalRevenue,
          orderCount: orders.length,
          deviceBreakdown,
          topProducts,
        },
        message: `${dateStr} tarihli satış raporu oluşturuldu ve admin mailine iletildi.`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Rapor oluşturulamadı.';
      console.error('[DAILY REPORT ERROR]:', err);
      return { success: false, data: null, message: msg };
    }
  }
}

export const dailyReportService = new DailyReportService();
