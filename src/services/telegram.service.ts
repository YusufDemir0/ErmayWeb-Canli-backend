/**
 * Telegram Bot Notification Service
 * Sends real-time order alerts and administrative digests to Telegram channels or chats.
 */

interface OrderNotificationPayload {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  totalAmount: number | string;
  paymentMethod: string;
  city?: string;
  district?: string;
  regionCode?: string;
  deviceInfo?: {
    deviceType?: string;
    os?: string;
    browser?: string;
    screenResolution?: string;
  } | null;
  items: Array<{
    name: string;
    quantity: number;
    price: number | string;
    variant?: string;
  }>;
}

export class TelegramService {
  private getBotCredentials(): { botToken: string | null; chatId: string | null } {
    const botToken = process.env.TELEGRAM_BOT_TOKEN || null;
    const chatId = process.env.TELEGRAM_CHAT_ID || null;
    return { botToken, chatId };
  }

  /**
   * Format and send real-time notification on new web order
   */
  async notifyNewOrder(order: OrderNotificationPayload): Promise<{ success: boolean; message: string }> {
    const { botToken, chatId } = this.getBotCredentials();

    const deviceStr = order.deviceInfo
      ? `${order.deviceInfo.deviceType || 'Bilinmiyor'} • ${order.deviceInfo.os || ''} (${order.deviceInfo.browser || ''})`
      : 'Tespit Edilemedi';

    const locationStr = [order.city, order.district].filter(Boolean).join(' / ') || 'Belirtilmedi';
    const regionBadge = order.regionCode ? `[${order.regionCode}]` : '';

function escapeHtml(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

    const customerNameSafe = escapeHtml(order.customerName);
    const customerPhoneSafe = escapeHtml(order.customerPhone);
    const locationStrSafe = escapeHtml(locationStr);
    const deviceStrSafe = escapeHtml(deviceStr);

    const itemsText = order.items
      .map(
        (i) =>
          `• <b>${i.quantity}x ${escapeHtml(i.name)}</b> ${i.variant ? `(${escapeHtml(i.variant)})` : ''} - <i>${Number(i.price).toLocaleString('tr-TR')} TL</i>`
      )
      .join('\n');

    const paymentText =
      order.paymentMethod === 'CREDIT_CARD' || order.paymentMethod === 'credit_card'
        ? '💳 Kredi Kartı (3D Secure)'
        : order.paymentMethod === 'BANK_TRANSFER' || order.paymentMethod === 'bank_transfer'
        ? '🏦 Banka Havalesi / EFT'
        : escapeHtml(order.paymentMethod);

    const adminPanelUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:1717';

    const messageHtml = [
      `🚨 <b>YENİ ERMAY MOBİLYA SİPARİŞİ!</b> 🚨`,
      ``,
      `📦 <b>Sipariş No:</b> <code>#${order.orderNumber}</code>`,
      `👤 <b>Müşteri:</b> ${customerNameSafe}`,
      `📞 <b>Telefon:</b> ${customerPhoneSafe}`,
      `💰 <b>Toplam Tutar:</b> <b>${Number(order.totalAmount).toLocaleString('tr-TR')} TL</b>`,
      `💳 <b>Ödeme Şekli:</b> ${paymentText}`,
      `📍 <b>Teslimat Bölgesi:</b> ${regionBadge} ${locationStrSafe}`,
      `📱 <b>Sipariş Verilen Cihaz:</b> ${deviceStrSafe}`,
      ``,
      `📋 <b>Sipariş Edilen Mobilyalar:</b>`,
      itemsText,
      ``,
      `🔗 <a href="${adminPanelUrl}/admin?tab=orders">Yönetim Panelinden Siparişi İncele</a>`,
    ].join('\n');

    if (!botToken || !chatId) {
      console.log(`[TELEGRAM NOTIFICATION (SIMULATED - NO TOKEN)]:\n${messageHtml.replace(/<[^>]*>/g, '')}`);
      return {
        success: true,
        message: 'Telegram bilgileri (.env) henüz tanımlanmadı. Bildirim sunucu loglarına kaydedildi.',
      };
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: messageHtml,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      });

      const resData = (await response.json()) as { ok?: boolean; description?: string };

      if (resData.ok) {
        return { success: true, message: 'Telegram bildirimi başarıyla iletildi.' };
      } else {
        console.warn('[TELEGRAM ERROR]:', resData);
        return { success: false, message: resData.description || 'Telegram bildirim hatası.' };
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[TELEGRAM NETWORK ERROR]:', msg);
      return { success: false, message: 'Telegram sunucusuna erişilemedi.' };
    }
  }

  /**
   * Test Telegram connection from Admin Panel
   */
  async sendTestMessage(customToken?: string, customChatId?: string): Promise<{ success: boolean; message: string }> {
    const { botToken: envToken, chatId: envChatId } = this.getBotCredentials();
    const token = customToken || envToken;
    const chatId = customChatId || envChatId;

    if (!token || !chatId) {
      return {
        success: false,
        message: 'Lütfen Telegram Bot Token ve Chat ID bilgilerini giriniz veya .env dosyasına ekleyiniz.',
      };
    }

    const testText = [
      `✅ <b>ERMAY MOBİLYA TELEGRAM ENTEGRASYONU BAŞARILI!</b>`,
      ``,
      `Bu mesaj, Ermay Mobilya E-Ticaret sisteminden gönderilen canlı test bildirimidir.`,
      `Artık web sitenizden gelen her siparişte anında bu kanala müşteri bilgileri ve sipariş özeti düşecektir.`,
      ``,
      `🕒 <b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}`,
      `🚀 <b>Durum:</b> Aktif ve Dinlemede`,
    ].join('\n');

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: testText,
          parse_mode: 'HTML',
        }),
      });

      const data = (await response.json()) as { ok?: boolean; description?: string };
      if (data.ok) {
        return { success: true, message: 'Test mesajı Telegram hesabınıza başarıyla ulaştı!' };
      } else {
        return { success: false, message: `Telegram Hatası: ${data.description}` };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Telegram API ile iletişim kurulamadı.';
      return { success: false, message: `Ağ Hatası: ${msg}` };
    }
  }
}

export const telegramService = new TelegramService();
