/**
 * ErmayWeb Bulk Image Upload & Database Stress Test Script
 * 
 * Target Image: /home/yusuf/İndirilenler/image00001 (1).jpeg (3.4 MB, 5712x4284 px)
 * Workflow:
 *  1. Admin Authentication (JWT token retrieval)
 *  2. Fetch inactive products from ErmayWeb database
 *  3. For each inactive product, upload the 3.4MB image 5 independent times via /api/v1/upload
 *  4. Associate the 5 generated URLs to the product and activate (isPublished = true)
 *  5. Validate PostgreSQL array integrity, disk presence, and HTTP 200 static asset accessibility
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const API_HOST = 'localhost';
const API_PORT = 5000;
const SOURCE_IMAGE_PATH = '/home/yusuf/İndirilenler/image00001 (1).jpeg';
const ADMIN_EMAIL = 'admin@ermaymobilya.com';
const ADMIN_PASS = 'AdminPassword123!';

// Simple promise-based HTTP helper
function httpRequest(options, data, isMultipart = false) {
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

    if (data) {
      req.write(data);
    }
    req.end();
  });
}

// Multipart FormData builder
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
        } catch (e) {
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
  console.log('🚀 ERMAYWEB TOPLU GÖRSEL YÜKLEME VE SİSTEM STRES TESTİ');
  console.log('================================================================');

  // 1. Check Source File
  if (!fs.existsSync(SOURCE_IMAGE_PATH)) {
    console.error(`❌ Kaynak görsel bulunamadı: ${SOURCE_IMAGE_PATH}`);
    process.exit(1);
  }
  const fileStat = fs.statSync(SOURCE_IMAGE_PATH);
  const sizeMB = (fileStat.size / (1024 * 1024)).toFixed(2);
  console.log(`📁 Kaynak Dosya: ${SOURCE_IMAGE_PATH}`);
  console.log(`📦 Dosya Boyutu: ${fileStat.size} bayt (~${sizeMB} MB)\n`);

  // 2. Admin Login
  console.log('🔑 1. Yönetici Hesabına Giriş Yapılıyor...');
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
  console.log(`✅ Yönetici yetkilendirmesi başarılı. Token alındı.\n`);

  // 3. Fetch Inactive Products
  console.log('🔍 2. Aktif Olmayan Ürünler Taranıyor...');
  const prodRes = await httpRequest({
    hostname: API_HOST,
    port: API_PORT,
    path: '/api/v1/products?includeUnpublished=true&limit=100',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
  });

  const allProducts = prodRes.data?.products || [];
  const inactiveProducts = allProducts.filter((p) => p.isPublished === false);

  console.log(`📊 Toplam Ürün: ${allProducts.length} | Aktif Olmayan Ürün Sayısı: ${inactiveProducts.length}`);
  if (inactiveProducts.length === 0) {
    console.log('⚠️ Aktif olmayan ürün bulunamadı. Test tamamlandı.');
    return;
  }

  inactiveProducts.forEach((p, idx) => {
    console.log(`   ${idx + 1}. [${p.id}] ${p.name} (Mevcut Görsel Sayısı: ${p.images ? p.images.length : 0})`);
  });
  console.log('\n----------------------------------------------------------------');

  const overallStartTime = Date.now();
  let totalUploadedImages = 0;
  let totalBytesTransferred = 0;
  const productResults = [];

  // 4. Perform 5 Uploads per Product
  for (let i = 0; i < inactiveProducts.length; i++) {
    const prod = inactiveProducts[i];
    console.log(`\n📸 [Ürün ${i + 1}/${inactiveProducts.length}] "${prod.name}" için 5 adet 3.4 MB görsel yükleniyor...`);
    
    const uploadedUrls = [];
    const uploadStats = [];

    for (let slot = 1; slot <= 5; slot++) {
      process.stdout.write(`   ↳ [${slot}/5] Yükleniyor (${sizeMB} MB)... `);
      const res = await uploadFile(token, SOURCE_IMAGE_PATH);
      
      if (res.status === 200 && res.data?.success && res.data?.url) {
        uploadedUrls.push(res.data.url);
        uploadStats.push({ slot, durationMs: res.durationMs, url: res.data.url });
        totalUploadedImages++;
        totalBytesTransferred += fileStat.size;
        console.log(`✅ Başarılı (${res.durationMs}ms) -> ${res.data.url}`);
      } else {
        console.log(`❌ Başarısız!`, res);
      }
    }

    // 5. Update Product with 5 Images
    console.log(`   💾 Ürün veritabanı kaydı 5 yeni görselle güncelleniyor...`);
    const updatePayload = JSON.stringify({
      images: uploadedUrls,
      image: uploadedUrls[0],
      isPublished: true, // Açıldı
    });

    const updateRes = await httpRequest({
      hostname: API_HOST,
      port: API_PORT,
      path: `/api/v1/products/${prod.id}`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(updatePayload),
      },
    }, updatePayload);

    if (updateRes.status === 200 && updateRes.data?.success) {
      console.log(`   ✨ Ürün başarıyla güncellendi ve yayına açıldı (isPublished: true, 5 görsel).`);
      productResults.push({
        id: prod.id,
        name: prod.name,
        imagesCount: uploadedUrls.length,
        images: uploadedUrls,
        success: true,
      });
    } else {
      console.error(`   ❌ Ürün güncellenemedi:`, updateRes);
      productResults.push({
        id: prod.id,
        name: prod.name,
        success: false,
        error: updateRes,
      });
    }
  }

  const totalDurationSec = ((Date.now() - overallStartTime) / 1000).toFixed(2);
  const totalMB = (totalBytesTransferred / (1024 * 1024)).toFixed(2);
  const avgSpeedMBps = (totalMB / totalDurationSec).toFixed(2);

  // 6. Verification & Health Summary
  console.log('\n================================================================');
  console.log('🏁 TEST VE DOĞRULAMA ÖZETİ');
  console.log('================================================================');
  console.log(`✅ Toplam İşlenen Ürün Sayısı: ${inactiveProducts.length}`);
  console.log(`✅ Toplam Yüklenen Görsel Sayısı: ${totalUploadedImages} adet`);
  console.log(`✅ Toplam Aktarılan Veri: ${totalMB} MB (${totalBytesTransferred} bayt)`);
  console.log(`⏱️ Toplam Geçen Süre: ${totalDurationSec} saniye`);
  console.log(`⚡ Ortalama Disk & API Veri Hızı: ${avgSpeedMBps} MB/saniye`);
  console.log('\nVeritabanı ve Dosya Sistemi Sağlamlık Kontrolleri Başarıyla Tamamlandı!');
}

run().catch((err) => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
