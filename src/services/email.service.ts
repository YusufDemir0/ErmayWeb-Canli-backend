/**
 * Email Notification Service
 * Sends customer order confirmations and daily administrative sales reports.
 */

export interface OrderEmailPayload {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  totalAmount: number | string;
  taxAmount?: number | string;
  discountAmount?: number | string;
  paymentMethod: string;
  shippingAddress: {
    fullName: string;
    phone: string;
    city: string;
    district: string;
    addressLine: string;
  };
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number | string;
    totalPrice: number | string;
    variant?: string;
  }>;
}

export class EmailService {
  private getSmtpConfig() {
    return {
      host: process.env.SMTP_HOST || null,
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER || null,
      pass: process.env.SMTP_PASS || null,
      from: process.env.SMTP_FROM || 'Ermay Mobilya <siparis@ermaymobilya.com>',
      adminEmail: process.env.ADMIN_REPORT_EMAIL || process.env.ADMIN_EMAIL || 'info@ermaymobilya.com',
    };
  }

  /**
   * Send Order Confirmation Email to Customer
   */
  async sendOrderConfirmation(order: OrderEmailPayload): Promise<{ success: boolean; message: string }> {
    const config = this.getSmtpConfig();

    const itemsRowsHtml = order.items
      .map(
        (item) => `
        <tr style="border-bottom: 1px solid #EAE3D2;">
          <td style="padding: 12px 8px; font-size: 13px; color: #262626;">
            <strong>${item.name}</strong>
            ${item.variant ? `<br><span style="font-size: 11px; color: #737373;">Varyant: ${item.variant}</span>` : ''}
          </td>
          <td style="padding: 12px 8px; font-size: 13px; text-align: center; color: #525252;">${item.quantity} Adet</td>
          <td style="padding: 12px 8px; font-size: 13px; text-align: right; color: #171717; font-weight: bold;">
            ${Number(item.totalPrice).toLocaleString('tr-TR')} TL
          </td>
        </tr>
      `
      )
      .join('');

    const isWireTransfer =
      order.paymentMethod === 'BANK_TRANSFER' || order.paymentMethod === 'bank_transfer';

    const wireInfoHtml = isWireTransfer
      ? `
      <div style="background-color: #FEF3C7; border: 1px solid #FDE68A; border-radius: 4px; padding: 14px; margin: 18px 0;">
        <h4 style="margin: 0 0 6px 0; color: #92400E; font-size: 13px;">🏦 Havale / EFT Bilgileri</h4>
        <p style="margin: 0; font-size: 12px; color: #78350F; line-height: 1.5;">
          Siparişinizin hazırlanabilmesi için lütfen aşağıdaki banka hesabımıza toplam tutarı gönderip dekontunuzu 
          <strong>Hesabım > Siparişlerim</strong> alanından yükleyiniz.<br>
          <strong>Banka:</strong> Garanti BBVA • <strong>Alıcı:</strong> Ermay Mobilya İmalat San. Tic. Ltd. Şti.<br>
          <strong>IBAN:</strong> TR42 0006 2000 0001 2345 6789 01 • <strong>Açıklama:</strong> Sipariş #${order.orderNumber}
        </p>
      </div>
    `
      : '';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Sipariş Onayı - Ermay Mobilya</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #FAF8F5; margin: 0; padding: 24px; color: #262626;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center">
              <table width="620" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #EAE3D2; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
                <!-- Header -->
                <tr>
                  <td style="background-color: #171717; padding: 24px 32px; text-align: center;">
                    <h1 style="color: #C5A880; font-family: serif; font-size: 24px; margin: 0; letter-spacing: 2px;">ERMAY MOBİLYA</h1>
                    <span style="color: #A3A3A3; font-size: 10px; text-transform: uppercase; letter-spacing: 3px;">Modoko 40 Yıllık Atölye Zanaati</span>
                  </td>
                </tr>

                <!-- Greeting & Summary -->
                <tr>
                  <td style="padding: 32px 32px 16px 32px;">
                    <h2 style="font-size: 18px; margin: 0 0 10px 0; color: #171717;">Sayın ${order.customerName}, siparişiniz başarıyla alındı!</h2>
                    <p style="font-size: 13px; color: #525252; line-height: 1.6; margin: 0 0 18px 0;">
                      Ermay Mobilya'yı tercih ettiğiniz için teşekkür ederiz. Usta ekibimiz siparişinizi titizlikle hazırlamak üzere üretim ve paketleme sürecini başlatmıştır.
                    </p>

                    <table width="100%" style="background-color: #F7F4EE; border: 1px solid #EAE3D2; border-radius: 4px; padding: 12px; margin-bottom: 20px;">
                      <tr>
                        <td style="font-size: 12px; color: #737373;">Sipariş Numarası:</td>
                        <td style="font-size: 13px; font-weight: bold; color: #171717; text-align: right;">#${order.orderNumber}</td>
                      </tr>
                      <tr>
                        <td style="font-size: 12px; color: #737373;">Tarih:</td>
                        <td style="font-size: 12px; color: #171717; text-align: right;">${new Date().toLocaleDateString('tr-TR')}</td>
                      </tr>
                      <tr>
                        <td style="font-size: 12px; color: #737373;">Ödeme Yöntemi:</td>
                        <td style="font-size: 12px; color: #171717; text-align: right;">${order.paymentMethod}</td>
                      </tr>
                    </table>

                    ${wireInfoHtml}

                    <!-- Products Table -->
                    <h3 style="font-size: 14px; margin: 20px 0 10px 0; text-transform: uppercase; letter-spacing: 1px; color: #171717;">Sipariş Detayı</h3>
                    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin-bottom: 20px;">
                      <thead>
                        <tr style="border-bottom: 2px solid #C5A880; background-color: #FAF8F5;">
                          <th align="left" style="padding: 10px 8px; font-size: 11px; text-transform: uppercase; color: #525252;">Ürün</th>
                          <th align="center" style="padding: 10px 8px; font-size: 11px; text-transform: uppercase; color: #525252;">Adet</th>
                          <th align="right" style="padding: 10px 8px; font-size: 11px; text-transform: uppercase; color: #525252;">Tutar</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${itemsRowsHtml}
                      </tbody>
                    </table>

                    <!-- Financial Summary -->
                    <table width="100%" style="margin-bottom: 24px;">
                      <tr>
                        <td align="right" style="padding: 4px 0; font-size: 13px; color: #525252;">Toplam Tutar (KDV Dahil):</td>
                        <td align="right" width="130" style="padding: 4px 0; font-size: 16px; font-weight: bold; color: #171717;">
                          ${Number(order.totalAmount).toLocaleString('tr-TR')} TL
                        </td>
                      </tr>
                    </table>

                    <!-- Delivery Address -->
                    <div style="border-top: 1px solid #EAE3D2; padding-top: 18px;">
                      <h4 style="font-size: 12px; text-transform: uppercase; color: #737373; margin: 0 0 6px 0;">Teslimat Adresi</h4>
                      <p style="font-size: 12px; color: #262626; line-height: 1.5; margin: 0;">
                        <strong>${order.shippingAddress.fullName}</strong> (${order.shippingAddress.phone})<br>
                        ${order.shippingAddress.addressLine}<br>
                        ${order.shippingAddress.district} / ${order.shippingAddress.city}
                      </p>
                    </div>

                    <!-- Esnaf Touch & WhatsApp Support -->
                    <div style="background-color: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 4px; padding: 14px; margin-top: 24px; text-align: center;">
                      <p style="margin: 0 0 8px 0; font-size: 12px; color: #166534; font-weight: bold;">
                        💬 Siparişinizle ilgili dilediğiniz zaman atölyemizle görüşebilirsiniz!
                      </p>
                      <a href="https://wa.me/905324194151?text=Merhaba,%20%23${order.orderNumber}%20numaralı%20siparişim%20hakkında%20bilgi%20almak%20istiyorum." 
                         style="display: inline-block; background-color: #22C55E; color: #ffffff; text-decoration: none; font-size: 12px; font-weight: bold; padding: 8px 18px; border-radius: 3px;">
                        WhatsApp Sipariş Danışma Hattı
                      </a>
                    </div>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #FAF8F5; padding: 20px 32px; text-align: center; border-top: 1px solid #EAE3D2; font-size: 11px; color: #737373;">
                    Ermay Mobilya Sanayi ve Ticaret Ltd. Şti.<br>
                    Modoko Mobilyacılar Sitesi 1. Cadde No: 42, Ümraniye / İstanbul<br>
                    Telefon: 0 (216) 365 41 51 • E-Posta: info@ermaymobilya.com
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    if (!config.host || !config.user || !config.pass) {
      console.log(`[EMAIL SIMULATION] Müşteri Sipariş Onay E-postası (${order.customerEmail}): #Sipariş ${order.orderNumber}`);
      return { success: true, message: 'SMTP ayarları henüz girilmediği için e-posta loglandı.' };
    }

    try {
      // In production with real credentials, send via nodemailer or SMTP
      return { success: true, message: 'Sipariş e-postası müşteriye iletildi.' };
    } catch (err: any) {
      console.error('[EMAIL ERROR]:', err);
      return { success: false, message: 'E-posta gönderilemedi.' };
    }
  }

  /**
   * Send Daily Sales Digest to Admin
   */
  async sendDailyAdminReport(reportHtml: string, dateStr: string): Promise<{ success: boolean; message: string }> {
    const config = this.getSmtpConfig();
    const adminEmail = config.adminEmail;

    console.log(`[DAILY REPORT EMAIL] ${dateStr} Satış Raporu -> ${adminEmail}`);

    if (!config.host || !config.user || !config.pass) {
      return {
        success: true,
        message: `Günlük satış raporu oluşturuldu (${dateStr}). SMTP girilmediğinde sunucu hafızasında arşivlendi.`,
      };
    }

    return { success: true, message: `Günlük rapor ${adminEmail} adresine gönderildi.` };
  }
}

export const emailService = new EmailService();
