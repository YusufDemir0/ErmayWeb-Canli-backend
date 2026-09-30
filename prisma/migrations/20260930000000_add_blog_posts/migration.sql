-- CreateTable
CREATE TABLE IF NOT EXISTS "blog_posts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "coverImage" TEXT,
    "category" TEXT DEFAULT 'Dekorasyon & Tasarım',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "author" TEXT NOT NULL DEFAULT 'Ermay Mobilya Mimari Ekibi',
    "readTimeMin" INTEGER NOT NULL DEFAULT 4,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "blog_posts_slug_idx" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "blog_posts_isPublished_publishedAt_idx" ON "blog_posts"("isPublished", "publishedAt" DESC);
