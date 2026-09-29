import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Live E2E API and Route Integration Verification', () => {
  const BACKEND_URL = 'http://127.0.0.1:5000/api/v1';
  const FRONTEND_URL = 'http://localhost:1717';

  let adminToken = '';
  let createdProductId = '';

  // 1. Check Public Products Endpoint Serialization
  test('GET /products returns published products with drawerCount, vatRate and dimensions', async () => {
    const res = await fetch(`${BACKEND_URL}/products`);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.products), 'products should be an array');
    assert.ok(data.products.length >= 20, `expected at least 20 products, got ${data.products.length}`);

    // Verify first product specifications
    const p = data.products[0];
    assert.ok('price' in p, 'product must contain price');
    assert.ok('vatRate' in p, 'product must contain vatRate');
    assert.ok(typeof p.vatRate === 'number', 'vatRate must be serialized as number');
    assert.ok('drawerCount' in p, 'product must contain drawerCount');
    assert.ok('dimensions' in p, 'product must contain dimensions string');
    assert.ok('material' in p, 'product must contain material string');
    assert.ok('leadTimeDays' in p, 'product must contain leadTimeDays');
  });

  // 2. Check Categories Endpoint
  test('GET /categories returns 10 root categories', async () => {
    const res = await fetch(`${BACKEND_URL}/categories`);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.categories));
    assert.ok(data.categories.length >= 10, `expected >= 10 categories, got ${data.categories.length}`);
  });

  // 3. Admin Authentication Login
  test('POST /auth/login authenticates with username asdyusuf3 / Test123!', async () => {
    const res = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'asdyusuf3',
        password: 'Test123!',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.token, 'token must be returned upon successful login');
    assert.equal(data.user?.role, 'ADMIN');

    adminToken = data.token;
  });

  // 4. Admin CRUD Product with All Technical Specifications
  test('POST /products creates product with full modular chunked specs', async () => {
    assert.ok(adminToken, 'Admin token required');

    const testItem = {
      name: 'E2E Otomasyon Makam Masası',
      price: 32500,
      originalPrice: 38000,
      stock: 5,
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp'],
      widthCm: 220,
      depthCm: 95,
      heightCm: 75,
      drawerCount: 4,
      leadTimeDays: 7,
      vatRate: 0.20,
      dimensions: 'G: 220cm × D: 95cm × Y: 75cm',
      material: '1. Sınıf E1 Melamin & DKP Çelik Profil',
      features: ['Test Kablo Kanalı', 'Frenli Ray'],
      erpItemId: `E2E-TEST-${Date.now()}`,
      erpItemCode: 'MBL-E2E-99',
      badge: 'Test Serisi',
      isPublished: true,
    };

    const res = await fetch(`${BACKEND_URL}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(testItem),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.product?.id);
    assert.equal(data.product.name, testItem.name);
    assert.equal(data.product.drawerCount, 4);
    assert.equal(data.product.leadTimeDays, 7);
    assert.equal(data.product.widthCm, 220);

    createdProductId = data.product.id;
  });

  // 5. Admin Update Product
  test('PUT /products/:id updates technical specifications correctly', async () => {
    assert.ok(createdProductId, 'Created product id required');

    const updatePayload = {
      widthCm: 240,
      depthCm: 100,
      drawerCount: 6,
      leadTimeDays: 12,
      dimensions: 'G: 240cm × D: 100cm × Y: 75cm',
    };

    const res = await fetch(`${BACKEND_URL}/products/${createdProductId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(updatePayload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.product.widthCm, 240);
    assert.equal(data.product.depthCm, 100);
    assert.equal(data.product.drawerCount, 6);
    assert.equal(data.product.leadTimeDays, 12);
  });

  // 6. Admin Delete Product (Soft delete)
  test('DELETE /products/:id soft-deletes the product', async () => {
    assert.ok(createdProductId, 'Created product id required');

    const res = await fetch(`${BACKEND_URL}/products/${createdProductId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
  });

  // 7. Frontend Routing Verification
  test('Frontend root URL (/) performs HTTP 307 temporary redirect to /kategori/aksesuar-ve-diger', async () => {
    const res = await fetch(`${FRONTEND_URL}/`, { redirect: 'manual' });
    assert.equal(res.status, 307);
    const location = res.headers.get('location');
    assert.equal(location, '/kategori/aksesuar-ve-diger');
  });

  test('Frontend /bayiler returns HTTP 200 OK and renders Turkey map container', async () => {
    const res = await fetch(`${FRONTEND_URL}/bayiler`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('svg') || html.includes('bayi') || html.includes('mağaza'), 'bayiler HTML must contain store/map elements');
  });

  test('Frontend /anasayfa returns HTTP 200 OK', async () => {
    const res = await fetch(`${FRONTEND_URL}/anasayfa`);
    assert.equal(res.status, 200);
  });
});
