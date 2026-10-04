import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canPublishProduct } from '../src/controllers/product.controller';
import {
  validateRequestStateTransition,
  InvalidRequestStateTransitionError,
} from '../src/services/orderStateMachine.service';
import { slugifyTurkish, normalizeTurkishText } from '../src/utils/slug';
import { normalizeTurkishPhone, maskCustomerName } from '../src/validations/request.validation';
import { generateToken, verifyToken } from '../src/utils/jwt';
import { hashPassword, comparePassword } from '../src/utils/password';
import { RequestStatus } from '@prisma/client';
import { evaluateMassUnpublishGuard } from '../src/jobs/erpCatalogSync.job';
import { CreateContactMessageSchema } from '../src/validations';
import { isPermanentErpError, ErpHttpError, ErpPermanentError, isCuratedErpId } from '../src/utils/erp';

describe('Unit Test: Core Domain Logic & Security Verifications', () => {
  describe('1. canPublishProduct Rules', () => {
    test('allows publishing when product has image, positive price, valid ERP ID and is not archived', () => {
      const allowed = canPublishProduct({
        images: ['/uploads/desk-1.webp'],
        image: '/uploads/desk-1.webp',
        price: 24500,
        erpItemId: 'ERM-101',
        archivedAt: null,
      });
      assert.equal(allowed, true);
    });

    test('rejects publishing when price is 0 or negative', () => {
      assert.equal(
        canPublishProduct({
          images: ['/uploads/sample.webp'],
          price: 0,
          erpItemId: 'ERM-102',
          archivedAt: null,
        }),
        false
      );

      assert.equal(
        canPublishProduct({
          images: ['/uploads/sample.webp'],
          price: -1500,
          erpItemId: 'ERM-102',
          archivedAt: null,
        }),
        false
      );
    });

    test('rejects publishing when images array and main image are empty', () => {
      assert.equal(
        canPublishProduct({
          images: [],
          image: '',
          price: 15000,
          erpItemId: 'ERM-103',
          archivedAt: null,
        }),
        false
      );
    });

    test('rejects publishing when erpItemId is missing or blank', () => {
      assert.equal(
        canPublishProduct({
          images: ['/uploads/chair.webp'],
          price: 5000,
          erpItemId: '',
          archivedAt: null,
        }),
        false
      );

      assert.equal(
        canPublishProduct({
          images: ['/uploads/chair.webp'],
          price: 5000,
          erpItemId: null,
          archivedAt: null,
        }),
        false
      );
    });

    test('rejects publishing when product is archived', () => {
      assert.equal(
        canPublishProduct({
          images: ['/uploads/desk.webp'],
          price: 12000,
          erpItemId: 'ERM-104',
          archivedAt: new Date(),
        }),
        false
      );
    });
  });

  describe('2. Request State Machine Matrix (V-01, V-02)', () => {
    test('allows legitimate forward transitions', () => {
      assert.equal(validateRequestStateTransition(RequestStatus.NEW, RequestStatus.CONTACTED), true);
      assert.equal(validateRequestStateTransition(RequestStatus.CONTACTED, RequestStatus.STORE_VISIT_SCHEDULED), true);
      assert.equal(validateRequestStateTransition(RequestStatus.CONTACTED, RequestStatus.AWAITING_PAYMENT), true);
      assert.equal(validateRequestStateTransition(RequestStatus.STORE_VISIT_SCHEDULED, RequestStatus.AWAITING_PAYMENT), true);
      assert.equal(validateRequestStateTransition(RequestStatus.AWAITING_PAYMENT, RequestStatus.PAID_OFFLINE), true);
      assert.equal(validateRequestStateTransition(RequestStatus.PAID_OFFLINE, RequestStatus.COMPLETED), true);
      assert.equal(validateRequestStateTransition(RequestStatus.NEW, RequestStatus.CANCELLED), true);
      assert.equal(validateRequestStateTransition(RequestStatus.NEW, RequestStatus.SPAM), true);
      assert.equal(validateRequestStateTransition(RequestStatus.NEW, RequestStatus.EXPIRED), true);
    });

    test('returns false for no-op same status transitions', () => {
      assert.equal(validateRequestStateTransition(RequestStatus.NEW, RequestStatus.NEW), false);
      assert.equal(validateRequestStateTransition(RequestStatus.CONTACTED, RequestStatus.CONTACTED), false);
    });

    test('throws InvalidRequestStateTransitionError for illegal transitions', () => {
      assert.throws(
        () => validateRequestStateTransition(RequestStatus.NEW, RequestStatus.COMPLETED),
        (err: unknown) => err instanceof InvalidRequestStateTransitionError
      );

      assert.throws(
        () => validateRequestStateTransition(RequestStatus.COMPLETED, RequestStatus.NEW),
        (err: unknown) => err instanceof InvalidRequestStateTransitionError
      );

      assert.throws(
        () => validateRequestStateTransition(RequestStatus.CANCELLED, RequestStatus.CONTACTED),
        (err: unknown) => err instanceof InvalidRequestStateTransitionError
      );

      assert.throws(
        () => validateRequestStateTransition(RequestStatus.SPAM, RequestStatus.NEW),
        (err: unknown) => err instanceof InvalidRequestStateTransitionError
      );
    });
  });

  describe('3. Turkish Slugify & Text Normalization (V-16)', () => {
    test('converts Turkish special characters properly into clean URL slugs', () => {
      const input = 'Çalışma Koltuğu & Makam Masası (Lüks)';
      const slug = slugifyTurkish(input);
      assert.equal(slug, 'calisma-koltugu-makam-masasi-luks');
    });

    test('handles Turkish dotted/dotless I and eliminates repeated dashes', () => {
      const input = 'İzmir Şık Işıltılı Örtü --- Modeli';
      const slug = slugifyTurkish(input);
      assert.equal(slug, 'izmir-sik-isiltili-ortu-modeli');
    });

    test('normalizes Turkish text safely for city and search comparisons (V-16)', () => {
      // Both English ASCII 'Istanbul' and Turkish 'İstanbul' / 'ıstanbul' must match!
      assert.equal(normalizeTurkishText('İSTANBUL'), 'istanbul');
      assert.equal(normalizeTurkishText('Istanbul'), 'istanbul');
      assert.equal(normalizeTurkishText('ıstanbul'), 'istanbul');
      assert.equal(normalizeTurkishText('IĞDIR'), normalizeTurkishText('ığdır'));
      assert.equal(normalizeTurkishText('DİYARBAKIR'), normalizeTurkishText('diyarbakır'));
    });
  });

  describe('4. Phone Number Normalization & Masking (KVKK Compliance)', () => {
    test('normalizes various Turkish phone input formats to E.164 (+905XXXXXXXXX)', () => {
      assert.equal(normalizeTurkishPhone('0532 123 45 67'), '+905321234567');
      assert.equal(normalizeTurkishPhone('5321234567'), '+905321234567');
      assert.equal(normalizeTurkishPhone('+90 532 123 4567'), '+905321234567');
      assert.equal(normalizeTurkishPhone('0 (532) 123-45-67'), '+905321234567');
    });

    test('masks customer name for public receipt disclosure', () => {
      assert.equal(maskCustomerName('Ahmet Yılmaz'), 'Ahmet Y.');
      assert.equal(maskCustomerName('Mehmet Ali Şahin'), 'Mehmet Ali Ş.');
      assert.equal(maskCustomerName('Yusuf'), 'Yusuf');
    });
  });

  describe('5. Cryptographic JWT and Password Security (S-04, S-05)', () => {
    test('generates and verifies JWT payload successfully', () => {
      const payload = { userId: 'admin-1', email: 'admin@ermaymobilya.com', role: 'ADMIN' };
      const token = generateToken(payload);
      assert.ok(token);

      const verified = verifyToken(token);
      assert.equal(verified.userId, 'admin-1');
      assert.equal(verified.role, 'ADMIN');
    });

    test('rejects tampered JWT tokens', () => {
      const token = generateToken({ userId: 'u1', role: 'ADMIN' });
      const tampered = token.slice(0, -5) + 'abcde';
      assert.throws(() => verifyToken(tampered));
    });

    test('hashes password with bcrypt cost 12 and verifies correctly', async () => {
      const plain = 'GucluSifre2026!';
      const hash = await hashPassword(plain);
      assert.ok(hash.startsWith('$2a$12$') || hash.startsWith('$2b$12$'));

      const isMatch = await comparePassword(plain, hash);
      assert.equal(isMatch, true);

      const wrongMatch = await comparePassword('YanlisSifre', hash);
      assert.equal(wrongMatch, false);
    });
  });
  describe('7. Catalog Sync Mass-Unpublish Guard', () => {
    const published = Array.from({ length: 20 }, (_, i) => ({ erpItemId: `ERP-${i}`, erpItemCode: `C${i}` }));

    test('aborts when ERP returns zero items while ERP-linked products are published', () => {
      assert.match(evaluateMassUnpublishGuard(published, new Set<string>()) || '', /0 ürün/);
    });

    test('aborts when more than the threshold of published products disappear', () => {
      const erpKeys = new Set(published.slice(0, 10).map((p) => p.erpItemId)); // %50 kayıp
      assert.ok(evaluateMassUnpublishGuard(published, erpKeys, 0.3));
    });

    test('allows normal churn below the threshold and matches by item code', () => {
      const erpKeys = new Set([...published.slice(0, 17).map((p) => p.erpItemId), 'C17']); // 2 kayıp
      assert.equal(evaluateMassUnpublishGuard(published, erpKeys, 0.3), null);
    });

    test('ignores web-curated products (ERM-/WEB-/ATELIER-)', () => {
      const curated = [{ erpItemId: 'ERM-1', erpItemCode: null }, { erpItemId: 'WEB-2', erpItemCode: null }];
      assert.equal(evaluateMassUnpublishGuard(curated, new Set<string>()), null);
    });
  });

  describe('8. Contact Message Validation', () => {
    test('normalizes phone and accepts empty email', () => {
      const parsed = CreateContactMessageSchema.parse({
        name: 'Ayşe Demir',
        phone: '0532 123 45 67',
        email: '',
        subject: 'Toplu Alım',
        message: 'Ofisimiz için 20 adet masa fiyatı rica ederiz.',
      });
      assert.equal(parsed.phone, '+905321234567');
      assert.equal(parsed.email, undefined);
    });

    test('accepts landline numbers for corporate contacts', () => {
      const parsed = CreateContactMessageSchema.safeParse({ name: 'Firma Yetkilisi', phone: '0216 365 00 00', message: 'Kurumsal teklif almak istiyoruz.' });
      assert.equal(parsed.success, true);
    });

    test('rejects short messages and invalid phones', () => {
      assert.equal(CreateContactMessageSchema.safeParse({ name: 'Ali', phone: '123', message: 'kısa' }).success, false);
    });
  });
  describe('9. ERP Error Classification', () => {
    test('validation / not-found responses are permanent (no 10x retry)', () => {
      assert.equal(isPermanentErpError(new ErpHttpError('property externalRef should not exist', 400)), true);
      assert.equal(isPermanentErpError(new ErpHttpError('ürün bulunamadı', 404)), true);
      assert.equal(isPermanentErpError(new ErpPermanentError('web kürasyonu ürün')), true);
    });

    test('auth, throttling, server and network errors stay retryable', () => {
      assert.equal(isPermanentErpError(new ErpHttpError('Geçersiz anahtar', 401)), false);
      assert.equal(isPermanentErpError(new ErpHttpError('Too many', 429)), false);
      assert.equal(isPermanentErpError(new ErpHttpError('Internal', 500)), false);
      assert.equal(isPermanentErpError(new Error('ERP API Bağlantı Hatası: ECONNREFUSED')), false);
    });

    test('curated web-only ERP ids are detected', () => {
      assert.equal(isCuratedErpId('ERM-B2B-001'), true);
      assert.equal(isCuratedErpId('8f2c1a9e-real-erp-id'), false);
    });
  });
});
