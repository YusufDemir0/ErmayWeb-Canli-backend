
import { logger, errorFields } from '../utils/logger';/**
 * Telegram Bot Notification Service
 * Sends masked, KVKK-compliant notifications to Telegram without customer PII (Finding N8).
 */

export interface RequestNotificationPayload {
  code: string;
  subtotal: number | string;
  preference: string;
  city?: string;
  district?: string;
  itemCount: number;
}

function escapeHtml(text?: string | null): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class TelegramService {
  private getBotCredentials(): { botToken: string | null; chatId: string | null } {
    const botToken = process.env.TELEGRAM_BOT_TOKEN || null;
    const chatId = process.env.TELEGRAM_CHAT_ID || null;
    return { botToken, chatId };
  }

  async sendTestMessage(customToken?: string, customChatId?: string): Promise<{ success: boolean; message: string }> {
    const botToken = customToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = customChatId || process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      return { success: false, message: 'Bot Token veya Chat ID eksik.' };
    }

    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '✅ <b>ErmayWeb Telegram Test Bildirimi</b>\n\nSistem bildirim kanalı başarıyla bağlandı.',
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, message: `Telegram API hatası: ${errText}` };
      }

      return { success: true, message: 'Test mesajı başarıyla iletildi.' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Bağlantı hatası: ${msg}` };
    }
  }

  /**
   * Generic HTML Message sender
   */
  async sendMessage(htmlMessage: string): Promise<boolean> {
    const { botToken, chatId } = this.getBotCredentials();
    if (!botToken || !chatId) {
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlMessage,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      return response.ok;
    } catch (err) {
      logger.warn('Telegram API send failed', errorFields(err));
      return false;
    }
  }

  /**
   * Format and send masked notification for a new OrderRequest.
   * STRICT KVKK COMPLIANCE: NO phone numbers, full names, addresses or device fingerprints.
   */
  async notifyNewRequest(req: RequestNotificationPayload): Promise<{ success: boolean; message: string }> {
    const { botToken, chatId } = this.getBotCredentials();

    if (!botToken || !chatId) {
      return { success: false, message: 'Telegram Bot yapılandırması eksik (isteğe bağlı).' };
    }

    const cleanCity = escapeHtml(req.city);
    const cleanDistrict = escapeHtml(req.district);
    const cleanCode = escapeHtml(req.code);
    const locationStr = [cleanCity, cleanDistrict].filter(Boolean).join(' / ') || 'Belirtilmedi';
    const preferenceLabel = req.preference === 'WHATSAPP' ? '🟢 WhatsApp Görüşmesi' : '🔵 Mağaza Ziyareti';
    const amountStr = typeof req.subtotal === 'number' ? req.subtotal.toLocaleString('tr-TR') : escapeHtml(String(req.subtotal));

    const message = [
      `🛋️ <b>YENİ SİPARİŞ TALEBİ</b>`,
      ``,
      `🔖 <b>Talep No:</b> <code>${cleanCode}</code>`,
      `📍 <b>Bölge:</b> ${locationStr}`,
      `📦 <b>Ürün Çeşidi:</b> ${req.itemCount} kalem`,
      `💰 <b>Tahmini Tutar:</b> <b>${amountStr} TL</b>`,
      `🎯 <b>Müşteri Tercihi:</b> ${preferenceLabel}`,
      ``,
      `🔗 <a href="${process.env.PUBLIC_SITE_URL || 'https://ermaymobilya.com'}/admin">Admin Paneli Talepleri Aç</a>`,
    ].join('\n');

    const ok = await this.sendMessage(message);
    return {
      success: ok,
      message: ok ? 'Bildirim iletildi.' : 'Telegram bildirimi gönderilemedi.',
    };
  }

  /**
   * Masked notification for a new contact form message (only the subject, no PII).
   */
  async notifyNewContactMessage(payload: { subject: string }): Promise<void> {
    const message = [
      `✉️ <b>YENİ İLETİŞİM MESAJI</b>`,
      ``,
      `📝 <b>Konu:</b> ${escapeHtml(payload.subject.slice(0, 150))}`,
      ``,
      `🔗 <a href="${process.env.PUBLIC_SITE_URL || 'https://ermaymobilya.com'}/admin">Admin Paneli Mesajları Aç</a>`,
    ].join('\n');

    await this.sendMessage(message);
  }

  /**
   * Alert admin when the 15-minute catalog sync is aborted by the mass-unpublish guard.
   */
  async notifyCatalogSyncAborted(payload: { reason: string }): Promise<void> {
    const message = [
      `🛑 <b>KATALOG SENKRONİZASYONU DURDURULDU</b>`,
      ``,
      `⚠️ ${escapeHtml(payload.reason.slice(0, 300))}`,
      ``,
      `<i>Web kataloğunda hiçbir ürün değiştirilmedi. Lütfen ERP /integration/items yanıtını kontrol ediniz.</i>`,
    ].join('\n');

    await this.sendMessage(message);
  }

  /**
   * Alert admin when ERP sync fails permanently after retries.
   */
  async notifyErpSyncFailed(payload: { code: string; attempts: number; error: string }): Promise<void> {
    const rawError = payload.error || 'Bilinmeyen Entegrasyon Hatası';
    const sanitizedError = rawError
      .replace(/https?:\/\/[^\s]+/gi, '[URL_REDACTED]')
      .replace(/postgres(ql)?:\/\/[^\s]+/gi, '[DB_REDACTED]')
      .replace(/(key|token|secret|password|auth)=([^\s&]+)/gi, '$1=[REDACTED]')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .slice(0, 200);

    const message = [
      `🚨 <b>ERP SENKRONİZASYON ALARMI</b>`,
      ``,
      `🔖 <b>Talep No:</b> <code>${payload.code}</code>`,
      `⚠️ <b>Hata Sayısı:</b> ${payload.attempts} deneme başarısız`,
      `❌ <b>Son Hata:</b> <code>${sanitizedError}</code>`,
      ``,
      `⚠️ <i>Bu talep otomatik deneme sınırına ulaştı. Lütfen ERP bağlantısını ve stok kodlarını kontrol edip admin panelinden manuel tekrar gönderiniz.</i>`,
    ].join('\n');

    await this.sendMessage(message);
  }

  // Geriye dönük uyumluluk takma adı
  async notifyNewOrder(order: any): Promise<{ success: boolean; message: string }> {
    return this.notifyNewRequest({
      code: order.orderNumber || order.code || 'WEB-TALEP',
      subtotal: order.totalAmount || order.subtotal || 0,
      preference: 'WHATSAPP',
      city: order.city,
      district: order.district,
      itemCount: Array.isArray(order.items) ? order.items.length : 1,
    });
  }
}

export const telegramService = new TelegramService();
