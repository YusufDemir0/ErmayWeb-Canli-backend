import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateStoreSchema,
  CreateProductSchema,
  UpdateProductSchema,
  CreateOrderRequestSchema,
  ProductListQuerySchema,
  CMS_SCHEMAS,
  safeHref,
  line,
  ChangePasswordSchema,
  CreateContactMessageSchema,
  trPhone,
} from '../src/validations';
import { TURKEY_DISTRICTS } from '../src/validations/provinces';

const store = {
  name: 'Modoko Showroom',
  city: 'İstanbul',
  district: 'Ümraniye',
  address: 'Modoko Mobilyacılar Sitesi 1. Cadde No: 42',
  phone: '0532 419 41 51',
};

describe('Validation: reference data', () => {
  test('has 81 provinces and 973 districts', () => {
    assert.equal(Object.keys(TURKEY_DISTRICTS).length, 81);
    assert.equal(Object.values(TURKEY_DISTRICTS).reduce((n, d) => n + d.length, 0), 973);
    assert.equal(TURKEY_DISTRICTS['İstanbul'].length, 39);
  });
});

describe('Validation: stores', () => {
  test('accepts an official district of the province', () => {
    assert.equal(CreateStoreSchema.safeParse(store).success, true);
  });
  test('rejects free-text district values', () => {
    assert.equal(CreateStoreSchema.safeParse({ ...store, district: 'Ümraniye / Modoko' }).success, false);
  });
  test('rejects a district from another province', () => {
    assert.equal(CreateStoreSchema.safeParse({ ...store, district: 'İzmit' }).success, false);
  });
  test('rejects over-long names', () => {
    assert.equal(CreateStoreSchema.safeParse({ ...store, name: 'x'.repeat(121) }).success, false);
  });
});

describe('Validation: text and links', () => {
  test('single-line text rejects line breaks and control characters', () => {
    assert.equal(line(50).safeParse('a\nb').success, false);
    assert.equal(line(50).safeParse('a\u0000b').success, false);
    assert.equal(line(50).safeParse("Robert'); DROP TABLE stores;--").success, true); // stored as plain text, queries are parameterised
  });
  test('links allow only safe schemes', () => {
    for (const ok of ['/katalog', '#kvkk', 'https://wa.me/905324194151', 'tel:+905324194151', 'mailto:info@ermaymobilya.com']) {
      assert.equal(safeHref.safeParse(ok).success, true, ok);
    }
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', '//evil.example', 'http://insecure.example']) {
      assert.equal(safeHref.safeParse(bad).success, false, bad);
    }
  });
});

describe('Validation: products and orders', () => {
  const product = { name: 'Toplantı Masası', price: 18500, erpItemId: 'ERM-101' };
  test('accepts a minimal product and maps empty numbers to null', () => {
    const r = CreateProductSchema.safeParse({ ...product, widthCm: '' });
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data.widthCm, null);
  });
  test('empty original price stays empty (not coerced to 0)', () => {
    const r = CreateProductSchema.safeParse({ ...product, originalPrice: null });
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data.originalPrice, null);
  });
  test('rejects negative or 3-decimal prices and original price below price', () => {
    assert.equal(CreateProductSchema.safeParse({ ...product, price: -1 }).success, false);
    assert.equal(CreateProductSchema.safeParse({ ...product, price: 10.123 }).success, false);
    assert.equal(CreateProductSchema.safeParse({ ...product, originalPrice: 100 }).success, false);
  });
  test('order request requires a listed province', () => {
    const base = {
      items: [{ productId: 'abc-123', quantity: 1 }],
      customerName: 'Ayşe Kaya',
      customerPhone: '0532 111 22 33',
      city: 'İstanbul',
      district: 'Kadıköy',
      preference: 'WHATSAPP',
      kvkkNoticeAcknowledged: true,
    };
    assert.equal(CreateOrderRequestSchema.safeParse(base).success, true);
    assert.equal(CreateOrderRequestSchema.safeParse({ ...base, city: 'Gotham' }).success, false);
  });
  test('query params reject arrays and out-of-range numbers', () => {
    assert.equal(ProductListQuerySchema.safeParse({ search: ['a', 'b'] }).success, false);
    assert.equal(ProductListQuerySchema.safeParse({ page: '0' }).success, false);
    const ok = ProductListQuerySchema.safeParse({ page: '2' });
    assert.equal(ok.success && ok.data.page, 2);
  });
  test('password policy', () => {
    assert.equal(ChangePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'short1' }).success, false);
    assert.equal(ChangePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'longenough12' }).success, true);
  });
});

describe('Validation: CMS', () => {
  test('ticker style requires hex colors', () => {
    assert.equal(CMS_SCHEMAS.ticker_style.safeParse({ backgroundColor: 'red', textColor: '#000000', speedSeconds: 30 }).success, false);
  });
  test('page layout keeps system sections and validates free sections', () => {
    const doc = {
      version: 1,
      sections: [
        { id: 'hero', type: 'hero', props: { slides: [] } },
        { id: 'categories', type: 'categories', hidden: true, props: {} },
        { id: 'sets', type: 'curated_sets', props: {} },
        { id: 'products', type: 'product_grid', label: 'Yeni', props: { title: 'Ürünler', limit: 12 } },
        { id: 'kvkk', type: 'rich_text', props: { blocks: [{ type: 'heading', text: 'Haklarınız' }, { type: 'paragraph', text: 'Metin' }] } },
      ],
    };
    assert.equal(CMS_SCHEMAS.page_home.safeParse(doc).success, true);
    assert.equal(CMS_SCHEMAS.page_home.safeParse({ ...doc, sections: doc.sections.slice(1) }).success, false, 'hero removed');
    const xss = { ...doc, sections: [...doc.sections, { id: 'c', type: 'cta', props: { title: 'x', buttons: [{ label: 'a', href: 'javascript:alert(1)' }] } }] };
    assert.equal(CMS_SCHEMAS.page_home.safeParse(xss).success, false, 'script link');
    assert.equal(CMS_SCHEMAS.page_corporate.safeParse({ sections: [{ id: 'h', type: 'hero', props: {} }] }).success, false, 'hero not allowed on corporate');
  });
});

describe('Validation: Turkish phone numbers (E.164 +90)', () => {
  test('normalises common spellings to +90XXXXXXXXXX', () => {
    for (const raw of ['0532 419 41 51', '+90 532 419 41 51', '905324194151', '5324194151', '(0216) 365 00 00']) {
      const r = trPhone().safeParse(raw);
      assert.equal(r.success, true, raw);
    }
    const r = trPhone().safeParse('0532 419 41 51');
    assert.equal(r.success && r.data, '+905324194151');
  });
  test('rejects letters, short numbers and foreign numbers', () => {
    for (const bad of ['0532 abc 41 51', '532 419', '+1 202 555 0143', '+44 20 7946 0958', '0100 000 00 00']) {
      assert.equal(trPhone().safeParse(bad).success, false, bad);
    }
  });
  test('mobile-only fields reject landlines', () => {
    assert.equal(trPhone({ mobile: true }).safeParse('0216 365 00 00').success, false);
    assert.equal(trPhone({ mobile: true }).safeParse('0532 419 41 51').success, true);
  });
  test('stores and contact form use the rule', () => {
    assert.equal(CreateStoreSchema.safeParse({ ...store, phone: '0532 41A 41 51' }).success, false);
    const c = CreateContactMessageSchema.safeParse({ name: 'Ayşe Kaya', phone: '+1 202 555 0143', message: 'Merhaba, fiyat bilgisi rica ederim.' });
    assert.equal(c.success, false);
  });
  test('CMS whatsapp is stored in wa.me digits', () => {
    const r = CMS_SCHEMAS.contact.safeParse({ whatsapp: '0532 419 41 51', phone: '0216 365 00 00' });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal((r.data as { whatsapp: string }).whatsapp, '905324194151');
      assert.equal((r.data as { phone: string }).phone, '+902163650000');
    }
  });
});

describe('Validation: ERP placeholder consent', () => {
  const base = { name: 'Lizbon Kanepe', price: 21500, category: 'kanepe-takimlari' };
  test('product without ERP match needs placeholder + explicit consent', () => {
    assert.equal(CreateProductSchema.safeParse(base).success, false);
    assert.equal(CreateProductSchema.safeParse({ ...base, erpPlaceholder: 'KOLTUK' }).success, false);
    assert.equal(CreateProductSchema.safeParse({ ...base, erpPlaceholder: 'KOLTUK', erpPlaceholderAck: false }).success, false);
    assert.equal(CreateProductSchema.safeParse({ ...base, erpPlaceholder: 'SANDALYE', erpPlaceholderAck: true }).success, false);
    assert.equal(CreateProductSchema.safeParse({ ...base, erpPlaceholder: 'KOLTUK', erpPlaceholderAck: true }).success, true);
  });
  test('ERP-matched product needs no consent', () => {
    assert.equal(CreateProductSchema.safeParse({ ...base, erpItemId: '412' }).success, true);
  });
  test('changing placeholder on update requires consent again', () => {
    assert.equal(UpdateProductSchema.safeParse({ erpPlaceholder: 'MASA' }).success, false);
    assert.equal(UpdateProductSchema.safeParse({ erpPlaceholder: 'MASA', erpPlaceholderAck: true }).success, true);
    assert.equal(UpdateProductSchema.safeParse({ erpPlaceholder: null }).success, true);
  });
});
