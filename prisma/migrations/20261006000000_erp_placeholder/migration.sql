-- ERP'de karşılığı olmayan ürünler için deneme ürün eşlemesi (admin kabulüyle)
CREATE TYPE "ErpPlaceholder" AS ENUM ('MOBILYA', 'TAKIM', 'KOLTUK', 'MASA');

ALTER TABLE "products" ADD COLUMN "erpPlaceholder" "ErpPlaceholder",
ADD COLUMN "erpPlaceholderAckAt" TIMESTAMP(3);
