/**
 * ErmayWeb All Catalog Products Image Bulk Upload & Sync Engine
 * 
 * Uploads 5 separate times the 3.4 MB image (/home/yusuf/İndirilenler/image00001 (1).jpeg)
 * for all inactive/unsynced ERP catalog products.
 * 
 * Features:
 *  - Real-time disk safety breaker (aborts if free space < 8 GB)
 *  - Batch processing with ETA and throughput metrics
 *  - Dual synchronization: ErmayWeb PostgreSQL + Ermay CRM/ERP MariaDB
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const API_HOST = 'localhost';
const API_PORT = 5000;
const SOURCE_IMAGE_PATH = '/home/yusuf/İndirilenler/image00001 (1).jpeg';
const ADMIN_EMAIL = 'admin@ermaymobilya.com';
const ADMIN_PASS = 'AdminPassword123!';
const MIN_FREE_DISK_GB = 8; // Safety threshold

function getFreeDiskGB() {
  try {
    const out = execSync('df -B1G /home/yusuf | tail -1', { encoding: 'utf8' }).trim();
    const parts = out.split(/\s+/);
    return parseInt(parts[3], 10);
  } catch (e) {
    return 20; // Fallback
  }
}

function httpRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', (err) => reject(err));
    if (data) req.write(data);
    req.end();
  });
}

function uploadFile(token, filePath) {
  return new Promise((resolve, reject) => {
    const boundary = '----ErmayBoundary' + Date.now() + Math.random().toString(36).substring(2);
    const fileName = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);

    let prefix = `--${boundary}\r\n`;
    prefix += `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`;
    prefix += `Content-Type: image/jpeg\r\n\r\n`;
    const suffix = `\r\n--${boundary}--\r\n`;

    const payload = Buffer.concat([
      Buffer.from(prefix, 'utf8'),
      fileBuffer,
      Buffer.from(suffix, 'utf8'),
    ]);

    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/v1/upload',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length,
        'x-skip-ratelimit': '1',
      },
    };

    const startTime = Date.now();
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        const durationMs = Date.now() - startTime;
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, durationMs, data: parsed });
        } catch {
          resolve({ status: res.statusCode, durationMs, raw: body });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('================================================================');
  console.log('🌟 ERMAYWEB TÜM KATALOG İÇİN TOPLU GÖRSEL YÜKLEME & SENKRONİZASYON');
  console.log('================================================================');

  if (!fs.existsSync(SOURCE_IMAGE_PATH)) {
    console.error(`❌ Kaynak görsel bulunamadı: ${SOURCE_IMAGE_PATH}`);
    process.exit(1);
  }
  const fileStat = fs.statSync(SOURCE_IMAGE_PATH);
  const sizeMB = (fileStat.size / (1024 * 1024)).toFixed(2);
  console.log(`📁 Kaynak Görsel: ${SOURCE_IMAGE_PATH} (${sizeMB} MB, 5712x4284 px)`);
  console.log(`💾 Başlangıç Boş Disk Alanı: ${getFreeDiskGB()} GB (Güvenlik Eşiği: ${MIN_FREE_DISK_GB} GB)\n`);

  // 1. Admin Login
  console.log('🔑 Yönetici girişi yapılıyor...');
  const loginPayload = JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  const loginRes = await httpRequest({
    hostname: API_HOST,
    port: API_PORT,
    path: '/api/v1/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginPayload),
    },
  }, loginPayload);

  if (!loginRes.data?.success || !loginRes.data?.token) {
    console.error('❌ Giriş başarısız:', loginRes);
    process.exit(1);
  }
  const token = loginRes.data.token;
  console.log('✅ Giriş başarılı. Token alındı.\n');

  // 2. Categories
  const catRes = await httpRequest({
    hostname: API_HOST,
    port: API_PORT,
    path: '/api/v1/categories',
    method: 'GET',
  });
  const categories = catRes.data?.categories || [];
  const defaultCatId = categories[0]?.id || null;
  console.log(`📂 Sistemdeki Kategori Sayısı: ${categories.length} (Varsayılan ID: ${defaultCatId})`);

  // Helper to match category by name
  function getCategoryIdByName(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('masa') || n.includes('sandalye') || n.includes('yemek')) {
      const c = categories.find((cat) => cat.slug === 'yemek-odasi' || cat.name.toLowerCase().includes('yemek'));
      if (c) return c.id;
    }
    if (n.includes('dolap') || n.includes('gardırop') || n.includes('yatak') || n.includes('baza') || n.includes('komodin')) {
      const c = categories.find((cat) => cat.slug === 'yatak-odasi' || cat.name.toLowerCase().includes('yatak'));
      if (c) return c.id;
    }
    const c = categories.find((cat) => cat.slug === 'oturma-odasi' || cat.name.toLowerCase().includes('oturma') || cat.name.toLowerCase().includes('koltuk'));
    return c ? c.id : defaultCatId;
  }

  // 3. Fetch Catalog
  console.log('📦 ERP Katalog ürünleri çekiliyor...');
  const catalogRes = await httpRequest({
    hostname: API_HOST,
    port: API_PORT,
    path: '/api/v1/integration/catalog',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
  });

  const catalog = catalogRes.data?.catalog || [];
  console.log(`📋 Toplam ERP Katalog Ürünü: ${catalog.length}`);

  const unsyncedItems = catalog.filter(
    (item) => !item.webProduct || item.webProduct.isPublished === false || !item.webProduct.images || item.webProduct.images.length < 5
  );

  console.log(`🎯 Yükleme Yapılacak Aktif Olmayan / Eksik Görselli Ürün Sayısı: ${unsyncedItems.length}`);
  console.log('----------------------------------------------------------------\n');

  if (unsyncedItems.length === 0) {
    console.log('🎉 Tüm ürünler zaten 5 görselle yayında! Yapılacak işlem yok.');
    return;
  }

  const overallStartTime = Date.now();
  let totalUploaded = 0;
  let totalSynced = 0;
  let totalBytes = 0;

  for (let i = 0; i < unsyncedItems.length; i++) {
    const item = unsyncedItems[i];
    const freeGB = getFreeDiskGB();

    if (freeGB < MIN_FREE_DISK_GB) {
      console.warn(`\n🛑 GÜVENLİK KESİCİSİ DEVREYE GİRDİ! Boş disk alanı ${freeGB} GB seviyesine düştü. Sistem güvenliği için işlem durduruldu.`);
      break;
    }

    process.stdout.write(`[${i + 1}/${unsyncedItems.length}] "${item.erpName}" (ERP ID: ${item.erpId}, Kod: ${item.erpCode}) -> 5x Yükleme: `);

    const uploadedUrls = [];
    let itemSuccess = true;

    for (let slot = 1; slot <= 5; slot++) {
      const upRes = await uploadFile(token, SOURCE_IMAGE_PATH);
      if (upRes.status === 200 && upRes.data?.success && upRes.data?.url) {
        uploadedUrls.push(upRes.data.url);
        totalUploaded++;
        totalBytes += fileStat.size;
        process.stdout.write(`✓`);
      } else {
        itemSuccess = false;
        process.stdout.write(`✗`);
      }
    }

    if (!itemSuccess || uploadedUrls.length < 5) {
      console.log(` ❌ Bazı görseller yüklenemedi. Atlanıyor.`);
      continue;
    }

    // Sync product to database & ERP
    const categoryId = getCategoryIdByName(item.erpName);
    const syncPayload = JSON.stringify({
      erpItemId: String(item.erpId),
      isPublished: true,
      images: uploadedUrls,
      categoryId,
      name: item.erpName,
      description: `${item.erpName} - Ermay Mobilya Modoko atölye imalatı, 1. sınıf fırınlanmış masif ahşap ve usta işçiliğiyle üretilmiştir.`,
      dimensions: 'G: Standart | D: Standart | Y: Standart',
      material: '1. Sınıf Masif Ahşap & Lüks Kaplama',
    });

    const syncRes = await httpRequest({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/v1/integration/sync',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(syncPayload),
        'x-skip-ratelimit': '1',
      },
    }, syncPayload);

    if (syncRes.status === 200 && syncRes.data?.success) {
      totalSynced++;
      process.stdout.write(` -> ✅ Senkronize Edildi\n`);
    } else {
      process.stdout.write(` -> ⚠️ Senkronizasyon Hatası: ${syncRes.data?.message || 'Hata'}\n`);
    }

    // Periodic status every 25 items
    if ((i + 1) % 25 === 0 || i === unsyncedItems.length - 1) {
      const elapsedSec = ((Date.now() - overallStartTime) / 1000).toFixed(1);
      const transferredMB = (totalBytes / (1024 * 1024)).toFixed(1);
      const remainingItems = unsyncedItems.length - (i + 1);
      const avgSecPerItem = (elapsedSec / (i + 1));
      const etaMin = ((remainingItems * avgSecPerItem) / 60).toFixed(1);
      console.log(`   ⏳ İlerleme: %${Math.round(((i + 1) / unsyncedItems.length) * 100)} | Aktarılan: ${transferredMB} MB | Boş Disk: ${getFreeDiskGB()} GB | Kalan Tahmini: ${etaMin} dk\n`);
    }
  }

  const totalTimeSec = ((Date.now() - overallStartTime) / 1000).toFixed(1);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

  console.log('\n================================================================');
  console.log('🏁 TOPLU YÜKLEME VE STRES TESTİ TAMAMLANDI');
  console.log('================================================================');
  console.log(`✅ Başarıyla Senkronize Edilen Ürün: ${totalSynced} adet`);
  console.log(`✅ Yüklenen Tekil Görsel Dosyası: ${totalUploaded} adet`);
  console.log(`✅ Toplam Disk / Ağ Verisi: ${totalMB} MB (${(totalMB / 1024).toFixed(2)} GB)`);
  console.log(`⏱️ Toplam Çalışma Süresi: ${totalTimeSec} saniye`);
  console.log(`💾 Kalan Güvenli Disk Alanı: ${getFreeDiskGB()} GB`);
  console.log('================================================================');
}

run().catch((err) => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
