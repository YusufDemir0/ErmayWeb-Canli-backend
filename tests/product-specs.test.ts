import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Product Specifications & ERP Feature Logic', () => {
  // 1. Dimensions formatting logic
  test('formats dimensions summary correctly from width, depth and height', () => {
    const formatDimensions = (w: number | string, d: number | string, h: number | string) => {
      return `G: ${w}cm × D: ${d}cm × Y: ${h}cm`;
    };

    assert.equal(formatDimensions(220, 95, 75), 'G: 220cm × D: 95cm × Y: 75cm');
    assert.equal(formatDimensions(160, 80, 75), 'G: 160cm × D: 80cm × Y: 75cm');
    assert.equal(formatDimensions(280, 120, 75), 'G: 280cm × D: 120cm × Y: 75cm');
  });

  // 2. Preset furniture dimension templates
  test('standard office furniture dimension presets are strictly calibrated', () => {
    const DIMENSION_PRESETS = [
      { label: 'Makam Masası', w: 220, d: 95, h: 75 },
      { label: 'Yönetici Masası', w: 200, d: 90, h: 75 },
      { label: 'Çalışma Masası', w: 160, d: 80, h: 75 },
      { label: 'Operasyonel Masa', w: 140, d: 70, h: 75 },
      { label: 'Toplantı Masası (K)', w: 200, d: 100, h: 75 },
      { label: 'Toplantı Masası (B)', w: 280, d: 120, h: 75 },
      { label: 'Ofis Bankosu', w: 200, d: 75, h: 110 },
      { label: 'Dosya Dolabı (Orta)', w: 160, d: 45, h: 120 },
      { label: 'Yüksek Dosya Dolabı', w: 80, d: 40, h: 198 },
      { label: 'Müdür Koltuğu', w: 68, d: 68, h: 120 },
      { label: 'Personel Koltuğu', w: 60, d: 60, h: 100 },
      { label: 'Ofis Sehpası', w: 100, d: 60, h: 45 },
    ];

    assert.equal(DIMENSION_PRESETS.length, 12);
    const makam = DIMENSION_PRESETS.find((p) => p.label === 'Makam Masası');
    assert.deepEqual(makam, { label: 'Makam Masası', w: 220, d: 95, h: 75 });

    const dolap = DIMENSION_PRESETS.find((p) => p.label === 'Yüksek Dosya Dolabı');
    assert.deepEqual(dolap, { label: 'Yüksek Dosya Dolabı', w: 80, d: 40, h: 198 });
  });

  // 3. VAT and Net Price Calculation
  test('calculates net price and tax amounts dynamically across standard brackets', () => {
    const calculateTaxes = (grossPrice: number, vatRate: number) => {
      const netPrice = grossPrice > 0 ? grossPrice / (1 + vatRate) : 0;
      const vatAmount = grossPrice > 0 ? grossPrice - netPrice : 0;
      return {
        netPrice: Math.round(netPrice),
        vatAmount: Math.round(vatAmount),
        grossPrice,
      };
    };

    // Standard 20% VAT on 24,000 TL
    const res20 = calculateTaxes(24000, 0.20);
    assert.equal(res20.netPrice, 20000);
    assert.equal(res20.vatAmount, 4000);
    assert.equal(res20.grossPrice, 24000);

    // 10% VAT on 11,000 TL
    const res10 = calculateTaxes(11000, 0.10);
    assert.equal(res10.netPrice, 10000);
    assert.equal(res10.vatAmount, 1000);

    // 0% VAT (Exempt) on 15,000 TL
    const res0 = calculateTaxes(15000, 0.0);
    assert.equal(res0.netPrice, 15000);
    assert.equal(res0.vatAmount, 0);
  });

  // 4. Turkish Uppercase String Normalization
  test('normalizes Turkish characters correctly for standard catalog titles', () => {
    const toTurkishUpper = (str: string) => str.toLocaleUpperCase('tr-TR');

    assert.equal(toTurkishUpper('viyana yönetici masası'), 'VİYANA YÖNETİCİ MASASI');
    assert.equal(toTurkishUpper('çelik çekmeceli etajer'), 'ÇELİK ÇEKMECELİ ETAJER');
    assert.equal(toTurkishUpper('ışıklı makam takımı'), 'IŞIKLI MAKAM TAKIMI');
    assert.equal(toTurkishUpper('ağaç gövdeli sehpa'), 'AĞAÇ GÖVDELİ SEHPA');
  });

  // 5. WhatsApp Message Template with Specs
  test('formats WhatsApp order query including dimensions, material, and drawer count', () => {
    const formatWhatsAppMsg = (product: {
      name: string;
      dimensions: string;
      material: string;
      drawerCount?: number;
      price: number;
      id: string;
    }) => {
      const drawerLine = product.drawerCount ? `\n• Çekmece: ${product.drawerCount} Adet` : '';
      return (
        `Merhaba Ermay Mobilya, web sitenizden "${product.name}" modeli hakkında bilgi almak ve sipariş vermek istiyorum.` +
        `\n• Ölçüler: ${product.dimensions}` +
        `\n• Malzeme: ${product.material}` +
        `${drawerLine}` +
        `\n• Fiyat: ${product.price.toLocaleString('tr-TR')} TL` +
        `\n• Ürün Linki: https://ermaymobilya.com/urun/${product.id}`
      );
    };

    const msg = formatWhatsAppMsg({
      name: 'Viyana Yönetici Masası',
      dimensions: 'G: 220cm × D: 95cm × Y: 75cm',
      material: 'E1 Kalite Çizilmez Melamin & DKP Çelik Profil',
      drawerCount: 3,
      price: 24500,
      id: 'prod-viyana-01',
    });

    assert.ok(msg.includes('Viyana Yönetici Masası'));
    assert.ok(msg.includes('G: 220cm × D: 95cm × Y: 75cm'));
    assert.ok(msg.includes('E1 Kalite Çizilmez Melamin'));
    assert.ok(msg.includes('Çekmece: 3 Adet'));
    assert.ok(msg.includes('24.500 TL'));
  });

  // 6. Lead Time & Shipping Status
  test('generates accurate factory shipping status based on stock and lead time', () => {
    const getShippingStatus = (inStock: boolean, leadTimeDays?: number) => {
      return inStock
        ? 'Stokta Hazır (1-2 İş Günü Sevkiyat)'
        : `Fabrika Seri İmalatı (${leadTimeDays || 15} İş Günü)`;
    };

    assert.equal(getShippingStatus(true, 10), 'Stokta Hazır (1-2 İş Günü Sevkiyat)');
    assert.equal(getShippingStatus(false, 10), 'Fabrika Seri İmalatı (10 İş Günü)');
    assert.equal(getShippingStatus(false, undefined), 'Fabrika Seri İmalatı (15 İş Günü)');
  });
});
