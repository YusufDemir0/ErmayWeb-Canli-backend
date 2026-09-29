-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('NEW', 'CONTACTED', 'STORE_VISIT_SCHEDULED', 'AWAITING_PAYMENT', 'PAID_OFFLINE', 'COMPLETED', 'CANCELLED', 'SPAM', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RequestPreference" AS ENUM ('WHATSAPP', 'STORE_VISIT');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('WHATSAPP_TRANSFER', 'IN_STORE');

-- CreateEnum
CREATE TYPE "ErpSyncStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SYNCED', 'FAILED');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "material" TEXT NOT NULL DEFAULT '',
    "dimensions" TEXT NOT NULL DEFAULT '',
    "widthCm" INTEGER,
    "depthCm" INTEGER,
    "heightCm" INTEGER,
    "drawerCount" INTEGER DEFAULT 0,
    "unitCount" INTEGER DEFAULT 1,
    "price" DECIMAL(12,2) NOT NULL,
    "originalPrice" DECIMAL(12,2),
    "vatRate" DECIMAL(4,2) NOT NULL DEFAULT 0.20,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "inStock" BOOLEAN NOT NULL DEFAULT false,
    "leadTimeDays" INTEGER DEFAULT 15,
    "image" TEXT NOT NULL DEFAULT '',
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "colors" JSONB NOT NULL DEFAULT '[]',
    "setPieces" JSONB NOT NULL DEFAULT '[]',
    "badge" TEXT,
    "erpItemId" TEXT NOT NULL,
    "erpItemCode" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "erpMissingSince" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_requests" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'NEW',
    "preference" "RequestPreference" NOT NULL,
    "preferredStoreId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "addressLine" TEXT,
    "note" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "kvkkNoticeAckAt" TIMESTAMP(3) NOT NULL,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "paymentChannel" "PaymentChannel",
    "erpSyncStatus" "ErpSyncStatus" NOT NULL DEFAULT 'PENDING',
    "erpSaleId" TEXT,
    "erpSaleCode" TEXT,
    "erpAttempts" INTEGER NOT NULL DEFAULT 0,
    "erpNextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "erpLastError" TEXT,
    "assignedToId" TEXT,
    "closedAt" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_request_items" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productNameSnap" TEXT NOT NULL,
    "erpItemCodeSnap" TEXT,
    "colorKey" TEXT,
    "colorLabel" TEXT,
    "unitPriceSnap" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "order_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_request_events" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "RequestStatus",
    "toStatus" "RequestStatus",
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "hours" TEXT,
    "image" TEXT,
    "mapUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
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

-- CreateTable
CREATE TABLE "cms_blocks" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_erpItemId_key" ON "products"("erpItemId");

-- CreateIndex
CREATE INDEX "products_isPublished_categoryId_idx" ON "products"("isPublished", "categoryId");

-- CreateIndex
CREATE INDEX "products_isPublished_createdAt_idx" ON "products"("isPublished", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "products_inStock_isPublished_idx" ON "products"("inStock", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "order_requests_code_key" ON "order_requests"("code");

-- CreateIndex
CREATE UNIQUE INDEX "order_requests_publicToken_key" ON "order_requests"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "order_requests_idempotencyKey_key" ON "order_requests"("idempotencyKey");

-- CreateIndex
CREATE INDEX "order_requests_status_createdAt_idx" ON "order_requests"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "order_requests_erpSyncStatus_erpNextAttemptAt_idx" ON "order_requests"("erpSyncStatus", "erpNextAttemptAt");

-- CreateIndex
CREATE INDEX "order_request_items_requestId_idx" ON "order_request_items"("requestId");

-- CreateIndex
CREATE INDEX "order_request_items_productId_idx" ON "order_request_items"("productId");

-- CreateIndex
CREATE INDEX "order_request_events_requestId_createdAt_idx" ON "order_request_events"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "stores_city_isActive_idx" ON "stores"("city", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "cms_blocks_key_key" ON "cms_blocks"("key");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_preferredStoreId_fkey" FOREIGN KEY ("preferredStoreId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_request_items" ADD CONSTRAINT "order_request_items_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "order_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_request_items" ADD CONSTRAINT "order_request_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_request_events" ADD CONSTRAINT "order_request_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "order_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

