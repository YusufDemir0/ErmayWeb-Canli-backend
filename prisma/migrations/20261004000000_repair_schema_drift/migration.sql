-- Repair schema drift between schema.prisma and the databases in the wild.
--
-- Two different starting points exist:
--   * Fresh installs (init_clean_baseline): products.colors is JSONB and products.salesCount is missing.
--   * Databases migrated from the archived 20260821 schema where init_clean_baseline was only marked as
--     applied (`migrate resolve`): contact_messages, several indexes and the preferredStore FK are missing.
--
-- Every statement is idempotent and non-destructive, so this migration is a no-op where the object already
-- matches the schema. Legacy tables (orders, users, ...) are intentionally left untouched.

-- 1. contact_messages (İletişim formu)
CREATE TABLE IF NOT EXISTS "contact_messages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- 2. products.salesCount (popüler sıralama)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "salesCount" INTEGER NOT NULL DEFAULT 0;

-- 3. products.colors: JSONB -> TEXT[] (only when still JSONB). String elements keep their value,
--    object elements are preserved as their JSON text.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'products' AND column_name = 'colors' AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE "products" ADD COLUMN "colors_text_tmp" TEXT[] DEFAULT ARRAY[]::TEXT[];

    UPDATE "products" p
    SET "colors_text_tmp" = COALESCE(
      (
        SELECT array_agg(CASE WHEN jsonb_typeof(e.value) = 'string' THEN e.value #>> '{}' ELSE e.value::text END ORDER BY e.ordinality)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p."colors") = 'array' THEN p."colors" ELSE '[]'::jsonb END) WITH ORDINALITY AS e(value, ordinality)
      ),
      ARRAY[]::TEXT[]
    );

    ALTER TABLE "products" DROP COLUMN "colors";
    ALTER TABLE "products" RENAME COLUMN "colors_text_tmp" TO "colors";
  END IF;
END $$;

-- 4. Missing indexes
CREATE INDEX IF NOT EXISTS "products_isPublished_categoryId_idx" ON "products"("isPublished", "categoryId");
CREATE INDEX IF NOT EXISTS "products_isPublished_createdAt_idx" ON "products"("isPublished", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "products_inStock_isPublished_idx" ON "products"("inStock", "isPublished");
CREATE INDEX IF NOT EXISTS "products_isPublished_price_idx" ON "products"("isPublished", "price");
CREATE INDEX IF NOT EXISTS "order_requests_status_createdAt_idx" ON "order_requests"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "order_requests_erpSyncStatus_erpNextAttemptAt_idx" ON "order_requests"("erpSyncStatus", "erpNextAttemptAt");
CREATE INDEX IF NOT EXISTS "order_request_items_requestId_idx" ON "order_request_items"("requestId");
CREATE INDEX IF NOT EXISTS "order_request_items_productId_idx" ON "order_request_items"("productId");
CREATE INDEX IF NOT EXISTS "order_request_events_requestId_createdAt_idx" ON "order_request_events"("requestId", "createdAt");
CREATE INDEX IF NOT EXISTS "stores_city_isActive_idx" ON "stores"("city", "isActive");

-- 5. order_requests.preferredStoreId -> stores.id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_requests_preferredStoreId_fkey') THEN
    -- Orphan references would make the FK fail; the store no longer exists, so drop the dangling link.
    UPDATE "order_requests" r SET "preferredStoreId" = NULL
    WHERE r."preferredStoreId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "stores" s WHERE s."id" = r."preferredStoreId");

    ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_preferredStoreId_fkey"
      FOREIGN KEY ("preferredStoreId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
