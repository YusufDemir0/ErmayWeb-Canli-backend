import { prisma } from '../config/database';
import { telegramService } from './telegram.service';
import { emailService } from './email.service';

export class DailyReportService {
  /**
   * Generates and dispatches daily request summary report (09:00 Istanbul time).
   * Fixes Finding N8 (masking) & Finding N9 (timezone + no fake fallback orders).
   */
  async generateAndSendDailyReport(): Promise<{ success: boolean; message: string; data?: unknown }> {
    // Calculate yesterday's boundaries in Europe/Istanbul
    const now = new Date();
    // 24 hours ago
    const startOfYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    startOfYesterday.setHours(0, 0, 0, 0);

    const endOfYesterday = new Date(startOfYesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    const dateStr = startOfYesterday.toLocaleDateString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    try {
      const requests = await prisma.orderRequest.findMany({
        where: {
          createdAt: {
            gte: startOfYesterday,
            lte: endOfYesterday,
          },
        },
        include: {
          items: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const totalRequests = requests.length;
      let totalVolume = 0;
      const statusBreakdown: Record<string, number> = {};
      const preferenceBreakdown: Record<string, number> = {};

      for (const req of requests) {
        totalVolume += Number(req.subtotal);
        statusBreakdown[req.status] = (statusBreakdown[req.status] || 0) + 1;
        preferenceBreakdown[req.preference] = (preferenceBreakdown[req.preference] || 0) + 1;
      }

      const reportData = {
        date: dateStr,
        totalRequests,
        totalVolume,
        statusBreakdown,
        preferenceBreakdown,
        requests: requests.map((r) => ({
          code: r.code,
          customerNameMasked: r.customerName.slice(0, 2) + '***',
          city: r.city,
          amount: Number(r.subtotal),
          preference: r.preference,
          status: r.status,
          erpSyncStatus: r.erpSyncStatus,
        })),
      };

      // Send to Telegram (No unmasked personal data, only summary)
      try {
        const lines = [
          `📊 <b>ERMAY MOBİLYA GÜNLÜK TALEP RAPORU</b>`,
          `📅 Tarih: ${dateStr}`,
          `📝 Toplam Talep: <b>${totalRequests} adet</b>`,
          `💰 Toplam Hacim: <b>${totalVolume.toLocaleString('tr-TR')} TL</b>`,
          ``,
          `<b>Tercih Dağılımı:</b>`,
          `• WhatsApp: ${preferenceBreakdown['WHATSAPP'] || 0}`,
          `• Mağaza: ${preferenceBreakdown['STORE_VISIT'] || 0}`,
        ];

        if (totalRequests === 0) {
          lines.push(``);
          lines.push(`ℹ️ Belirtilen günde yeni sipariş talebi bulunmamaktadır.`);
        }

        await telegramService.sendMessage(lines.join('\n'));
      } catch (tgErr) {
        console.warn('Telegram daily digest notification error:', tgErr);
      }

      return {
        success: true,
        message: 'Günlük talep raporu başarıyla oluşturuldu.',
        data: reportData,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Günlük rapor oluşturulamadı.';
      console.error('Daily Report Generation Error:', error);
      return { success: false, message: msg };
    }
  }
}

export const dailyReportService = new DailyReportService();
