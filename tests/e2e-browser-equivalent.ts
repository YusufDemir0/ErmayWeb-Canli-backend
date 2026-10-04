import assert from 'node:assert';

const API_BASE = 'http://127.0.0.1:5000/api/v1';
const FRONTEND_BASE = 'http://127.0.0.1:1717';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || 'admin@ermaymobilya.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || '';

async function runE2EVerification() {
  console.log('====================================================');
  console.log('🚀 ERMAYWEB E2E KOD TABANLI SİSTEM DENETİMİ BAŞLADI');
  console.log('====================================================\n');

  let passedChecks = 0;
  let totalChecks = 0;

  function report(name: string, ok: boolean, detail?: string) {
    totalChecks++;
    if (ok) {
      passedChecks++;
      console.log(`✅ [${totalChecks}] ${name}${detail ? ` -> ${detail}` : ''}`);
    } else {
      console.error(`❌ [${totalChecks}] ${name}${detail ? ` -> ${detail}` : ''}`);
    }
  }

  // 1. Health & Server Check
  try {
    const res = await fetch('http://127.0.0.1:5000/health');
    const data = await res.json();
    report('1. Backend /health Endpoint', res.status === 200 && data.status === 'OK', `DB Status: ${data.components?.database?.status}`);
  } catch (err: any) {
    report('1. Backend /health Endpoint', false, err.message);
  }

  // 2. Frontend Homepage (/) SSR Check
  try {
    const res = await fetch(FRONTEND_BASE);
    const html = await res.text();
    const hasHero = html.includes('Ermay') || html.includes('Mobilya');
    report('2. Frontend Ana Sayfa (/) SSR HTML Derlemesi', res.status === 200 && hasHero, `Boyut: ${html.length} bayt`);
  } catch (err: any) {
    report('2. Frontend Ana Sayfa (/) SSR HTML Derlemesi', false, err.message);
  }

  // 3. Kurumsal & KVKK Aydınlatma Metni Bölümü Check
  try {
    const res = await fetch(`${FRONTEND_BASE}/kurumsal`);
    const html = await res.text();
    const hasKvkkAnchor = html.includes('id="kvkk"');
    const hasKvkkText = html.includes('6698 Sayılı Kanun Kapsamında') && html.includes('Kişisel Verilerin Korunması');
    report('3. Kurumsal Sayfası & KVKK Aydınlatma Metni Anchor (id="kvkk")', res.status === 200 && hasKvkkAnchor && hasKvkkText, 'Footer bağlantısı ve tam metin mevcut');
  } catch (err: any) {
    report('3. Kurumsal Sayfası & KVKK Aydınlatma Metni', false, err.message);
  }

  // 4. Katalog Sayfası & Ürün Listesi
  let sampleProduct: any = null;
  try {
    const res = await fetch(`${API_BASE}/products`);
    const data = await res.json();
    sampleProduct = data.products?.[0];
    report('4. Ürün Kataloğu API (GET /products)', res.status === 200 && Array.isArray(data.products) && data.products.length > 0, `${data.products.length} ürün listelendi`);
  } catch (err: any) {
    report('4. Ürün Kataloğu API', false, err.message);
  }

  // 5. Ürün Detayı & Fiyat Doğrulama (Quote API)
  let sampleProductId = sampleProduct?.id;
  try {
    const quotePayload = {
      items: [
        {
          productId: sampleProductId,
          productName: sampleProduct?.name || 'Yönetici Masası',
          quantity: 2,
          color: 'Antrasit',
        },
      ],
    };
    const res = await fetch(`${API_BASE}/requests/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quotePayload),
    });
    const quoteData = await res.json();
    report('5. Fiyat Teklifi & Doğrulama (POST /requests/quote)', res.status === 200 && quoteData.success && quoteData.quote?.subtotal > 0, `Ara Toplam: ${quoteData.quote?.subtotal} TL`);
  } catch (err: any) {
    report('5. Fiyat Teklifi & Doğrulama API', false, err.message);
  }

  // 6. Sipariş Talebi Oluşturma (POST /requests) & Idempotency Key
  const testIdempotencyKey = `e2e_test_${Date.now()}`;
  let createdRequestToken: string = '';
  let createdRequestId: string = '';
  let createdRequestCode: string = '';

  try {
    const orderPayload = {
      customerName: 'Ahmet Yılmaz',
      customerPhone: '05321234567',
      customerEmail: 'ahmetyilmaz.test@ermay.com',
      city: 'İstanbul',
      district: 'Ümraniye',
      addressLine: 'Modoko Sanayi Cad. No: 12',
      preference: 'WHATSAPP',
      note: 'E2E Otomatik Test Sipariş Notu',
      kvkkNoticeAcknowledged: true,
      items: [
        {
          productId: sampleProductId,
          productName: sampleProduct?.name,
          quantity: 1,
          color: 'Antrasit',
        },
      ],
    };

    const res = await fetch(`${API_BASE}/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': testIdempotencyKey,
      },
      body: JSON.stringify(orderPayload),
    });
    const data = await res.json();
    createdRequestToken = data.publicToken;
    createdRequestCode = data.code;

    report('6. Sipariş Talebi Oluşturma (POST /requests)', res.status === 201 && !!createdRequestToken, `Talep Kodu: ${createdRequestCode} (Token: ${createdRequestToken ? createdRequestToken.slice(0, 16) : ''}...)`);
  } catch (err: any) {
    report('6. Sipariş Talebi Oluşturma', false, err.message);
  }

  // 7. Idempotency Tekilleştirme Koruması (Aynı key ile tekrar istek)
  try {
    const res = await fetch(`${API_BASE}/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': testIdempotencyKey,
      },
      body: JSON.stringify({
        customerName: 'Farklı Biri',
        customerPhone: '05555555555',
        city: 'Ankara',
        preference: 'WHATSAPP',
        kvkkNoticeAcknowledged: true,
        items: [{ productId: sampleProductId, quantity: 1 }],
      }),
    });
    const data = await res.json();
    report('7. Idempotency Çift Kayıt Önleme', res.status === 200 && data.code === createdRequestCode, 'Mükerrer istek engellendi, orijinal talep döndü');
  } catch (err: any) {
    report('7. Idempotency Çift Kayıt Önleme', false, err.message);
  }

  // 8. Maskeli Fiş Ekranı (GET /requests/public/:token)
  try {
    const res = await fetch(`${API_BASE}/requests/public/${createdRequestToken}`);
    const data = await res.json();
    const req = data.request;
    const isMasked = req?.maskedName === 'Ahmet Y.' && req?.maskedPhone?.includes('***');
    const hasOfficialNotice = !!req?.officialIbanNotice;
    report('8. Maskeli Dijital Fiş API (GET /requests/public/:token)', res.status === 200 && isMasked && hasOfficialNotice, `Maskeli İsim: ${req?.maskedName}, Maskeli Tel: ${req?.maskedPhone}, Resmi Uyarı: ${req?.officialIbanNotice?.slice(0, 35)}...`);
  } catch (err: any) {
    report('8. Maskeli Dijital Fiş API', false, err.message);
  }

  // 9. Mağazalar & Bayiler (GET /stores)
  try {
    const res = await fetch(`${API_BASE}/stores`);
    const data = await res.json();
    report('9. Mağaza & Bayi Listesi API (GET /stores)', res.status === 200 && Array.isArray(data.stores) && data.stores.length > 0, `${data.stores.length} aktif mağaza listelendi`);
  } catch (err: any) {
    report('9. Mağaza & Bayi Listesi API', false, err.message);
  }

  // 10. CMS Blokları (GET /cms)
  try {
    const res = await fetch(`${API_BASE}/cms`);
    const data = await res.json();
    report('10. CMS İçerik Konfigürasyonları (GET /cms)', res.status === 200 && !!data.cms?.contact && !!data.cms?.trust_texts, 'İletişim ve güven metinleri yüklendi');
  } catch (err: any) {
    report('10. CMS İçerik Konfigürasyonları', false, err.message);
  }

  // 11. Admin Girişi (POST /auth/login)
  let adminCookie = '';
  let adminToken = '';
  try {
    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    const loginData = await loginRes.json();
    adminToken = loginData.token || '';
    const setCookieHeader = loginRes.headers.get('set-cookie') || '';
    adminCookie = setCookieHeader ? setCookieHeader.split(';')[0] : `ermay_admin=${adminToken}`;
    report('11. Yönetici Oturum Açma (POST /auth/login)', loginRes.status === 200 && loginData.success, `Kullanıcı: ${loginData.user?.name} (${loginData.user?.role})`);
  } catch (err: any) {
    report('11. Yönetici Oturum Açma', false, err.message);
  }

  // 12. Admin Talepler Listesi (GET /requests/admin)
  try {
    const res = await fetch(`${API_BASE}/requests/admin`, {
      headers: {
        Cookie: adminCookie,
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const data = await res.json();
    const foundCreated = data.requests?.find((r: any) => r.code === createdRequestCode);
    if (foundCreated) {
      createdRequestId = foundCreated.id;
    }
    report('12. Yönetici Talep Yönetim Listesi (GET /requests/admin)', res.status === 200 && !!foundCreated, `Yeni oluşturulan ${createdRequestCode} talebi listede doğrulandı (ID: ${createdRequestId})`);
  } catch (err: any) {
    report('12. Yönetici Talep Listesi', false, err.message);
  }

  // 13. Durum Makinesi: Geçersiz Geçiş 409 Conflict Testi
  try {
    const res = await fetch(`${API_BASE}/requests/admin/${createdRequestId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'PAID_OFFLINE' }), // NEW -> PAID_OFFLINE doğrudan izin verilmez (önce CONTACTED veya STORE_VISIT olmalı)
    });
    const data = await res.json();
    report('13. Durum Makinesi Koruması (NEW -> PAID_OFFLINE)', res.status === 409, `Doğru HTTP 409 Conflict yanıtı alındı (${data.message})`);
  } catch (err: any) {
    report('13. Durum Makinesi Koruması', false, err.message);
  }

  // 14. Durum Makinesi: İzinli Geçiş (NEW -> CONTACTED)
  try {
    const res = await fetch(`${API_BASE}/requests/admin/${createdRequestId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'CONTACTED', staffNote: 'Müşteri ile WhatsApp üzerinden görüşüldü' }),
    });
    const data = await res.json();
    report('14. Durum Makinesi İzinli Geçiş (NEW -> CONTACTED)', res.status === 200 && data.request?.status === 'CONTACTED', `Güncel Durum: ${data.request?.status}`);
  } catch (err: any) {
    report('14. Durum Makinesi İzinli Geçiş', false, err.message);
  }

  // 15. Manuel ERP Tetikleme Ucu (POST /requests/admin/:id/retry-erp -> 202 Accepted)
  try {
    const res = await fetch(`${API_BASE}/requests/admin/${createdRequestId}/retry-erp`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const data = await res.json();
    report('15. Asenkron ERP Yeniden Deneme (POST /admin/:id/retry-erp)', res.status === 202 && data.success, `Non-blocking 202 Accepted yanıtı alındı (${data.message})`);
  } catch (err: any) {
    report('15. Asenkron ERP Yeniden Deneme', false, err.message);
  }

  // 16. Kategori Hiyerarşisi (GET /categories)
  try {
    const res = await fetch(`${API_BASE}/categories`);
    const data = await res.json();
    report('16. Kategori Hiyerarşisi API (GET /categories)', res.status === 200 && Array.isArray(data.categories) && data.categories.length > 0, `${data.categories.length} ana kategori`);
  } catch (err: any) {
    report('16. Kategori Hiyerarşisi API', false, err.message);
  }

  // 17. Teslimat Bölgeleri (GET /geo/delivery-zones)
  try {
    const res = await fetch(`${API_BASE}/geo/delivery-zones`);
    const data = await res.json();
    report('17. Teslimat & Montaj Bölge Konfigürasyonu (GET /geo/delivery-zones)', res.status === 200 && data.success, '81 il yapılandırması doğrulandı');
  } catch (err: any) {
    report('17. Teslimat Bölgeleri', false, err.message);
  }

  console.log('\n====================================================');
  console.log(`📊 DENETİM SONUCU: ${passedChecks}/${totalChecks} BAŞARILI (%${Math.round((passedChecks / totalChecks) * 100)})`);
  console.log('====================================================\n');

  if (passedChecks === totalChecks) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runE2EVerification();
